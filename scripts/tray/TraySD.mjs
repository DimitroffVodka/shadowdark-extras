

import { TrayApp, registerTrayAppHooks } from "./TrayApp.mjs";
import { JournalPinManager, normalizeImageTint } from "../journal/JournalPinsSD.mjs";
// Imported from the module that owns it rather than through the JournalPinsSD
// re-export, which is a fixed public surface.
import { checkPinVisibility } from "../journal/pin-manager.mjs";
import { getPinJournalSubtitle } from "../journal/pin-access.mjs";
import { buildPlaceableNoteIndex, usesCoordinateFallback } from "../journal/placeable-note-index.mjs";
import { initSoloHexMode } from "../hex/SoloHexMode.mjs";
import { getHexPainterData, loadTileAssets, bindCanvasEvents, enablePainting, disablePainting, isPainting, setDecorMode, canUndoPoi, canRedoPoi } from "../hex/HexPainterSD.mjs";
import {
	getDungeonPainterData,
	loadDungeonAssets,
	reloadDungeonAssets,
	bindDungeonCanvasEvents,
	enableDungeonPainting,
	disableDungeonPainting,
	isDungeonPainting,
	setDungeonMode,
	getDungeonMode,
	nextDungeonMode,
	cleanupDungeonPainting,
	initDungeonSocket,
	canPlayerPaint,
} from "../dungeon/DungeonPainterSD.mjs";
import {
	FEATURE_IDS,
	getDisabledFeatureIds,
	getFeatureFlagContext,
	getVisibleTrayModes,
	isFeatureEnabled,
} from "../settings/feature-gates.mjs";

const MODULE_ID = "shadowdark-extras";

/**
 * The Token fields a tray rebuild would learn nothing from.
 *
 * A row is named from `customName`/`name`, grouped by the Actor a Token
 * represents, and panned to by reading the drawn placeable rather than anything
 * captured when the row was built — so moving and turning a token changes
 * nothing the tray shows. Everything NOT in here forces a rebuild, including
 * fields that do not exist yet: the tray is not required to keep a list of
 * every Token field that matters, only of the few that provably do not.
 *
 * Foundry 14 counts more fields than these as a movement action
 * (`BaseToken.MOVEMENT_FIELDS` adds `width`, `height`, `depth`, `shape` and
 * `level`); they are deliberately absent, because a token resized or moved
 * between levels is a cheap rebuild rather than a step-by-step one.
 */
const TRAY_BLIND_TOKEN_KEYS = new Set(["x", "y", "rotation", "elevation"]);

/**
 * Foundry's own bookkeeping on a document differential, which is never a reason
 * to rebuild anything. `_id` is how an update is routed to its document, so it
 * rides along with even a plain drag and must not be mistaken for a change.
 */
const DOCUMENT_METADATA_KEYS = new Set(["_id", "_stats"]);

/**
 * Foundry fields that can change a Drawing's geometry. A geometry-only update
 * is tray-blind when the row has a custom/native label, but it changes the
 * coordinate fallback for an unnamed Drawing and must rebuild in that case.
 */
const DRAWING_GEOMETRY_KEYS = new Set(["x", "y", "rotation", "shape", "bezierFactor"]);

/**
 * Foundry's Drawing presentation and placement fields are not read by the
 * Notes index. Keep this set explicit: an unknown key takes the safe rebuild
 * path rather than being guessed to be cosmetic.
 */
const DRAWING_TRAY_BLIND_KEYS = new Set([
	"author", "fillType", "fillColor", "fillAlpha", "strokeWidth", "strokeColor",
	"strokeAlpha", "textAlpha", "textColor", "fontFamily", "fontSize", "texture",
	"elevation", "levels", "sort", "hidden", "interface", "locked", "name",
]);

/**
 * Region fields that alter shape geometry and can therefore affect a
 * coordinate-fallback label. The index does not use behavior/style data.
 */
const REGION_GEOMETRY_KEYS = new Set(["shapes", "_shapeConstraints", "restriction"]);

/**
 * Region presentation, placement, and behavior fields the Notes index cannot
 * observe. Unknown keys deliberately remain rebuild-worthy.
 */
const REGION_TRAY_BLIND_KEYS = new Set([
	"color", "elevation", "levels", "locked", "visibility", "behaviors", "attachment",
	"ownership", "hidden", "highlightMode", "displayMeasurements",
]);

function shouldRefreshDrawingRegion(documentName, document, changes) {
	const changedKeys = Object.keys(changes ?? {})
		.filter(key => !DOCUMENT_METADATA_KEYS.has(key));
	if (changedKeys.length === 0) return false;

	const geometryKeys = documentName === "Drawing"
		? DRAWING_GEOMETRY_KEYS
		: REGION_GEOMETRY_KEYS;
	const trayBlindKeys = documentName === "Drawing"
		? DRAWING_TRAY_BLIND_KEYS
		: REGION_TRAY_BLIND_KEYS;

	if (changedKeys.every(key => trayBlindKeys.has(key))) return false;
	if (changedKeys.every(key => geometryKeys.has(key))) {
		return usesCoordinateFallback(document);
	}
	return true;
}

// Tray instance
let _trayApp = null;

// Bumped at the start of every tray render, so a render finishing after a later
// one started can tell that it has been overtaken. See renderTray.
let _renderGeneration = 0;

// Current view mode
let _viewMode = "player"; // "player" or "party"

// Hide NPCs from players (GM only). Cached from the world-scope setting
// tray.hideNpcsFromPlayers so it syncs to every client and survives reloads.
let _hideNpcsFromPlayers = true;

// Party/NPC stat snapshot broadcast by the GM, so players can render cards
// for tokens whose actors they can't fully read (limited ownership exposes
// no system data). Keyed by token id, scoped by scene id so a player on a
// different scene from the GM does not clobber their current-scene cards.
// _partyStats is a Map<sceneId, Map<tokenId, stats>>; _partyStatsKey is
// Map<sceneId, jsonKey>.
let _partyStats = new Map();
// Compat: legacy callers that read _partyStats as Map tokenId->stats keep
// working via the active scene's sub-map (see _scenePartyMap).
let _partyStatsKey = new Map();
// The socketlib socket, set by registerPartyStatsSocket at ready.
let _partySocket = null;
// Current canvas scene id, falling back to "" when no scene is active.
function _activeSceneId() {
	return canvas.scene?.id ?? "";
}

function _getPartySetting(key, fallback) {
	if (!isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) return fallback;
	return game.settings.get(MODULE_ID, key) ?? fallback;
}

function _scenePartyMap(sceneId = _activeSceneId()) {
	let m = _partyStats.get(sceneId);
	if (!m) {
		m = new Map(); _partyStats.set(sceneId, m);
	}
	return m;
}

function _broadcastKeyForScene(sceneId) {
	return _partyStatsKey.get(sceneId) ?? null;
}

function _setBroadcastKeyForScene(sceneId, key) {
	_partyStatsKey.set(sceneId, key);
}


// Current actor/token being displayed
let _currentActor = null;

/**
 * Initialize the Character Tray
 * Called from shadowdark-extras.mjs ready hook
 */
export function initTray() {
	// Check if tray is enabled
	if (!isFeatureEnabled(FEATURE_IDS.TRAY) || !game.settings.get(MODULE_ID, "tray.enabled")) {
		return;
	}
	registerTrayAppHooks();

	// Add class to body to enable tray-specific CSS
	document.body.classList.add("sdx-tray-enabled");

	// Cache the world-scope NPC visibility toggle (synced to all clients)
	_hideNpcsFromPlayers = _getPartySetting("tray.hideNpcsFromPlayers", true);

	// Create the tray app
	_trayApp = new TrayApp();
	_trayApp.render(true);

	// Initial render
	renderTray();
	if (isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) _broadcastScenePartyStats(_activeSceneId());

	// Players: ask the GM for the current party/NPC stat snapshot. The GM's
	// userConnected force-broadcast can race ahead of this client's socket
	// handler registration and be dropped, so a fresh client requests it
	// explicitly. (No GM connected: nothing to ask, the catch keeps the
	// rejection silent.)
	if (!game.user.isGM && isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) {
		_partySocket?.executeAsGM("sdxTrayRequestPartyStats", canvas.scene?.id)?.catch?.(() => {});
	}

	// Load hex tile assets for the painter tab
	if (isFeatureEnabled(FEATURE_IDS.HEX_PAINTER)) loadTileAssets().then(() => renderTray());

	// Initialize dungeon socket FIRST (so players can request tiles from GM)
	if (isFeatureEnabled(FEATURE_IDS.DUNGEON_PAINTER)) initDungeonSocket();

	// Initialize Solo Hex Mode (registers updateToken hook)
	if (isFeatureEnabled(FEATURE_IDS.SOLO_HEX_MODE)) initSoloHexMode();

	// Load dungeon tile assets (after socket init so players can request from GM)
	if (isFeatureEnabled(FEATURE_IDS.DUNGEON_PAINTER)) loadDungeonAssets().then(() => renderTray());

	// Bind canvas events now if canvas is already ready (page refresh)
	if (canvas?.stage) {
		if (isFeatureEnabled(FEATURE_IDS.HEX_PAINTER)) bindCanvasEvents();
		if (isFeatureEnabled(FEATURE_IDS.DUNGEON_PAINTER)) bindDungeonCanvasEvents();
	}

	// Hook into token selection changes
	Hooks.on("controlToken", async () => {
		await renderTray();
	});

	// Hook into actor updates (HP, etc.) - debounced to handle rapid updates
	let _actorUpdateTimer = null;
	Hooks.on("updateActor", async actor => {
		if (_actorUpdateTimer) clearTimeout(_actorUpdateTimer);
		_actorUpdateTimer = setTimeout(async () => {
			_actorUpdateTimer = null;
			if (isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) _broadcastActorPartyStats(actor);
			await renderTray();
		}, 100);
	});

	// An Actor arriving or leaving the world, which the Notes tab can see even
	// though an Actor is not on a scene.
	//
	// An Actor is in the note index because a Token on the active scene
	// represents it, so a Token being created or deleted usually carries the
	// Actor row with it — but not always, and the exception is the whole reason
	// these two exist. The Token can sit still the entire time: delete the
	// world Actor and its rendered row names something that is gone, create one
	// and a Token that was pointing nowhere resolves. Neither is a Token event,
	// and nothing else would rebuild.
	Hooks.on("createActor", async () => await renderTray());
	Hooks.on("deleteActor", async () => await renderTray());

	// Hook into effect changes
	Hooks.on("createActiveEffect", async () => await renderTray());
	Hooks.on("deleteActiveEffect", async () => await renderTray());
	Hooks.on("updateActiveEffect", async () => await renderTray());

	// Hook into item changes (Shadowdark stores conditions as Effect items)
	Hooks.on("createItem", async item => {
		if (item.type === "Effect") await renderTray();
	});
	Hooks.on("deleteItem", async item => {
		if (item.type === "Effect") await renderTray();
	});
	Hooks.on("updateItem", async item => {
		if (item.type === "Effect") await renderTray();
	});

	// Hook into token creation/deletion for party view & notes
	Hooks.on("createToken", async tokenDoc => {
		if (isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) {
			_broadcastScenePartyStats(tokenDoc.parent?.id ?? _activeSceneId());
		}
		await renderTray();
	});
	Hooks.on("deleteToken", async tokenDoc => {
		if (isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) {
			_broadcastScenePartyStats(tokenDoc.parent?.id ?? _activeSceneId());
		}
		await renderTray();
	});

	// Debounced token update handler to prevent lag during token movement
	// Token movement triggers many updateToken events per second - we only need to update
	// the tray for HP changes, not position changes
	let _tokenUpdateTimer = null;
	Hooks.on("updateToken", async (tokenDoc, changes) => {
		// Skip updates that only moved the token.
		//
		// Asked as "is EVERY changed field one the tray does not read", rather
		// than the other way round. A denylist — a movement key is present and
		// none of these three other keys are — has to be extended every time a
		// field starts mattering, and until it is, any compound update carrying
		// that field is silently filed as a drag. `{x, actorId}` reassigns which
		// Actor a Token represents, so one Actor row has to retire and another
		// appear; read the old way it was indistinguishable from a step.
		//
		// The cost of the safe direction is a rebuild nobody needed. The cost of
		// the other one is a tray showing a row the scene no longer has.
		const changedKeys = Object.keys(changes).filter(key => !DOCUMENT_METADATA_KEYS.has(key));

		// Nothing but Foundry's bookkeeping, or nothing at all. Rebuilding for
		// this would contradict what DOCUMENT_METADATA_KEYS says about it, and a
		// no-op save on a busy scene would cost a full re-enrichment.
		//
		// Both of these are a return and nothing else. Clearing the pending timer
		// on the way out would let bookkeeping traffic — which nobody asked for
		// and which arrives whenever it likes — postpone or swallow the rebuild a
		// real change already scheduled.
		if (changedKeys.length === 0) return;
		if (changedKeys.every(key => TRAY_BLIND_TOKEN_KEYS.has(key))) return;

		// Debounce other updates
		if (_tokenUpdateTimer) clearTimeout(_tokenUpdateTimer);
		_tokenUpdateTimer = setTimeout(async () => {
			_tokenUpdateTimer = null;
			if (isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) {
				_broadcastScenePartyStats(tokenDoc.parent?.id ?? _activeSceneId());
			}
			await renderTray();
		}, 100);
	});

	// Hook into other placeables for notes — debounced to survive bulk operations
	let _placeableRenderTimer = null;
	function debouncedPlaceableRender() {
		if (_placeableRenderTimer) clearTimeout(_placeableRenderTimer);
		_placeableRenderTimer = setTimeout(async () => {
			_placeableRenderTimer = null;
			// If painting is active, we don't need to re-render the tray for every tile placement.
			// This prevents massive lag and scroll resetting issues.
			// The only downside is if you place a tile that SHOULD trigger a note update, it won't
			// show until you stop painting.

			// Double check: if isPainting() is true OR if we are in hexes/dungeons view (which
			// implies painting mode)
			// This makes the check more robust against state desyncs
			if (!isPainting() && !isDungeonPainting() && getViewMode() !== "hexes" && getViewMode() !== "dungeons" && getViewMode() !== "decor") {
				await renderTray();
			}
		}, 300);
	}

	// Wall updates need special handling - door state changes (open/close) don't affect tray
	Hooks.on("createWall", debouncedPlaceableRender);
	Hooks.on("deleteWall", debouncedPlaceableRender);
	Hooks.on("updateWall", (wallDoc, changes) => {
		// Skip door state changes (ds = door state) - opening/closing doors doesn't affect tray
		// content
		const isDoorStateOnly = ("ds" in changes)
            && !("c" in changes)  // wall coordinates
            && !("flags" in changes);  // flags might contain notes
		if (isDoorStateOnly) return;
		debouncedPlaceableRender();
	});

	// Other placeables
	const placeableHooks = ["AmbientLight", "AmbientSound", "Tile", "Drawing", "Region"];
	placeableHooks.forEach(type => {
		Hooks.on(`create${type}`, debouncedPlaceableRender);
		Hooks.on(`update${type}`, (document, changes) => {
			if ((type === "Drawing" || type === "Region")
				&& !shouldRefreshDrawingRegion(type, document, changes)) return;
			debouncedPlaceableRender();
		});
		Hooks.on(`delete${type}`, debouncedPlaceableRender);
	});

	// Hook into canvas teardown (before scene change) to clean up
	Hooks.on("canvasTearDown", () => {
		if (isFeatureEnabled(FEATURE_IDS.DUNGEON_PAINTER)) cleanupDungeonPainting();
	});

	// Hook into scene changes
	Hooks.on("canvasReady", async () => {
		if (isFeatureEnabled(FEATURE_IDS.HEX_PAINTER)) bindCanvasEvents();
		if (isFeatureEnabled(FEATURE_IDS.DUNGEON_PAINTER)) bindDungeonCanvasEvents();
		if (isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) _broadcastScenePartyStats(_activeSceneId());
		// If this client is a player, the GM's broadcast for the previous
		// scene does not help — ask for a snapshot scoped to the scene we
		// just entered. The GM answers for that scene id even if they are
		// viewing a different scene themselves.
		if (!game.user.isGM && isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) {
			_partySocket?.executeAsGM("sdxTrayRequestPartyStats", canvas.scene?.id)?.catch?.(() => {});
		}
		await renderTray();
	});

	Hooks.on("sdx.tomOverlayChanged", () => renderTray());

	// Hook into Map Notes
	Hooks.on("createNote", async () => await renderTray());
	Hooks.on("updateNote", async () => await renderTray());
	Hooks.on("deleteNote", async () => await renderTray());

	// Hook for POI placement to update undo/redo buttons (DOM-only, no full re-render)
	Hooks.on("sdx.poiPlaced", () => {
		const elem = document.querySelector(".sdx-tray");
		if (!elem) return;
		elem.querySelector(".poi-undo-btn")?.classList.toggle("disabled", !canUndoPoi());
		elem.querySelector(".poi-redo-btn")?.classList.toggle("disabled", !canRedoPoi());
	});

	// Hook to update tray when pins change on scene
	Hooks.on("updateScene", (document, change, options, userId) => {
		// Check if the update involves the flags for this module (pins or pin folders)
		const sdxFlags = change.flags?.[MODULE_ID];
		if (sdxFlags && ("journalPins" in sdxFlags || "pinFolders" in sdxFlags)) {
			renderTray();
		}
	});

	// Hook to update tray when Tom scenes are modified
	Hooks.on("updateSetting", (setting, data, options, userId) => {
		// Check if the update involves Tom scenes
		if (setting.key === `${MODULE_ID}.tom-scenes`) {
			renderTray();
		}
		// GM toggled player dungeon-painting access: show/hide the Dungeons tab.
		// Fires on every client, so players' trays refresh in real time.
		if (setting.key === `${MODULE_ID}.allowPlayerDungeonPainting`) {
			renderTray();
		}
		// World-shared pin folders changed — refresh the Pins tab on every client.
		if (setting.key === `${MODULE_ID}.pinFoldersWorld`) {
			renderTray();
		}
		// GM toggled NPC visibility for players — every client picks it up.
		if (setting.key === `${MODULE_ID}.tray.hideNpcsFromPlayers`) {
			_hideNpcsFromPlayers = !!setting.value;
			renderTray();
		}
	});

	// Hook to reload dungeon tiles when GM comes online (for players)
	Hooks.on("userConnected", async (user, connected) => {
		if (
			isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)
			&& game.user.isGM && connected && !user.isGM
		) {
			// A player just joined: push the current party/NPC stat snapshot
			// (bypassing the dedupe, which would otherwise swallow it).
			_broadcastScenePartyStats(_activeSceneId(), true);
		}
		if (
			isFeatureEnabled(FEATURE_IDS.DUNGEON_PAINTER)
			&& !game.user.isGM && user.isGM && connected
		) {
			// GM just came online - try to reload dungeon tiles
			await reloadDungeonAssets();
			renderTray();
		}
	});

	// Keyboard shortcut: Ctrl cycles the Dungeons tab modes, in tab order.
	document.addEventListener("keydown", event => {
		// Only respond to Ctrl key without other modifiers. Held Ctrl
		// auto-repeats keydown on Chromium, which would spin the cycle.
		if (event.key !== "Control" || event.shiftKey || event.altKey || event.repeat) return;

		// Only when in dungeons view and tray is expanded
		if (_viewMode !== "dungeons" || !_trayApp?._isExpanded) return;

		// Advance to the next mode
		setDungeonMode(nextDungeonMode(getDungeonMode()));
		renderTray();
	});

}

/**
 * Register tray settings
 */
export function registerTraySettings() {
	if (isFeatureEnabled(FEATURE_IDS.TRAY)) game.settings.register(MODULE_ID, "tray.enabled", {
		name: "SHADOWDARK_EXTRAS.tray.settings.enabled.name",
		hint: "SHADOWDARK_EXTRAS.tray.settings.enabled.hint",
		scope: "client",
		config: true,
		type: Boolean,
		default: true,
		requiresReload: true,
	});

	if (isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) game.settings.register(MODULE_ID, "tray.showPartyTab", {
		name: "SHADOWDARK_EXTRAS.tray.settings.showPartyTab.name",
		hint: "SHADOWDARK_EXTRAS.tray.settings.showPartyTab.hint",
		scope: "client",
		config: true,
		type: Boolean,
		default: true,
	});

	if (isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) game.settings.register(MODULE_ID, "tray.partyName", {
		name: "SHADOWDARK_EXTRAS.tray.settings.partyName.name",
		hint: "SHADOWDARK_EXTRAS.tray.settings.partyName.hint",
		scope: "world",
		config: true,
		type: String,
		default: "Party",
	});

	if (isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) game.settings.register(MODULE_ID, "tray.showHealthBars", {
		name: "SHADOWDARK_EXTRAS.tray.settings.showHealthBars.name",
		hint: "SHADOWDARK_EXTRAS.tray.settings.showHealthBars.hint",
		scope: "client",
		config: true,
		type: Boolean,
		default: true,
	});

	if (isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) game.settings.register(MODULE_ID, "tray.showNPCs", {
		name: "SHADOWDARK_EXTRAS.tray.settings.showNPCs.name",
		hint: "SHADOWDARK_EXTRAS.tray.settings.showNPCs.hint",
		scope: "client",
		config: true,
		type: Boolean,
		default: true,
	});

	// World-scope GM toggle: hidden from the settings UI (the tray button is
	// the only control). Foundry's setting sync carries it to every client,
	// where the updateSetting hook in initTray refreshes the cache.
	if (isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) game.settings.register(MODULE_ID, "tray.hideNpcsFromPlayers", {
		name: "Hide NPCs from Players (tray)",
		hint: "Whether monsters and NPCs are hidden from players in the tray's Party view.",
		scope: "world",
		config: false,
		type: Boolean,
		default: true,
	});

	// Hidden settings for hex painter (not shown in config)
	if (isFeatureEnabled(FEATURE_IDS.HEX_FOG)) game.settings.register(MODULE_ID, "hexFog.defaultRevealRadius", {
		name: "Hex Fog: Default Reveal Radius",
		hint: "How many rings of hexes to reveal around a token when it moves. 0 = only the token's hex, 1 = token + adjacent hexes, 2 = two rings out, etc.",
		scope: "world",
		config: true,
		type: Number,
		default: 1,
		range: { min: 0, max: 5, step: 1 },
	});

	if (isFeatureEnabled(FEATURE_IDS.HEX_PAINTER)) game.settings.register(MODULE_ID, "hexPainter.customTileWidth", {
		scope: "client",
		config: false,
		type: Number,
		default: 296,
	});

	if (isFeatureEnabled(FEATURE_IDS.HEX_PAINTER)) game.settings.register(MODULE_ID, "hexPainter.customTileHeight", {
		scope: "client",
		config: false,
		type: Number,
		default: 256,
	});

	if (isFeatureEnabled(FEATURE_IDS.HEX_PAINTER)) game.settings.register(MODULE_ID, "hexPainter.poiScale", {
		scope: "client",
		config: false,
		type: Number,
		default: 0.5,
	});

	if (isFeatureEnabled(FEATURE_IDS.MAP_GENERATORS)) game.settings.register(MODULE_ID, "settlement.useLocalMaphub", {
		name: "Settlement Maps: Use Local Maphub",
		hint: "Load settlement map visuals from the locally-built maphub files (scripts/maphub/) instead of watabou.github.io. Enables offline use. Requires building and copying maphub files first — see module README.",
		scope: "world",
		config: true,
		type: Boolean,
		default: false,
	});
}

/**
 * Get the current actor to display
 * @returns {Actor|null}
 */
export function getCurrentActor() {
	const isGM = game.user.isGM;

	// For GM: use controlled token
	if (isGM && canvas.tokens) {
		const tokens = canvas.tokens.controlled;
		if (tokens.length === 1) {
			const token = tokens[0];
			if (token.document.actorLink) {
				_currentActor = game.actors.get(token.document.actorId);
			}
			else {
				_currentActor = token.actor;
			}
			return _currentActor;
		}
	}

	// For players: use assigned character or first owned actor
	let character = game.user.character;
	if (!character) {
		for (let actor of Array.from(game.actors.values())) {
			if (actor.isOwner && actor.type === "Player") {
				character = actor;
				break;
			}
		}
	}

	_currentActor = character;
	return character;
}

/**
 * Get all party tokens on the current scene
 * @param {Object} [opts]
 * @param {boolean} [opts.includeAllNPCs=false] - when true the GM's tray.showNPCs
 *  client setting is ignored so broadcasts always carry every NPC (players
 *  still receive only a percent). Callers that render the tray should leave
 *  this false so the GM's personal filter is respected.
 * @returns {{partyTokens: Array, npcTokens: Array}}
 */
export function getPartyTokens({ includeAllNPCs = false } = {}) {
	if (!canvas.tokens) return { partyTokens: [], npcTokens: [] };

	const tokens = canvas.tokens.placeables;
	const partyTokens = [];
	const npcTokens = [];

	for (const token of tokens) {
		const actor = token.actor;
		if (!actor) continue;

		// Players never see hidden tokens in the tracker, whether or not NPCs
		// are revealed to them — the canvas hidden flag wins over everything.
		if (!game.user.isGM && token.document?.hidden) continue;

		// Skip item-piles enabled tokens/actors (v14: getFlag throws when scope's
		// module isn't active, so guard against that case)
		let pileData;
		if (game.modules.get("item-piles")?.active) {
			pileData = token.document.getFlag("item-piles", "data") ?? actor.getFlag(
				"item-piles", "data"
			);
		}
		if (pileData?.enabled) continue;

		// Check if this is a player character
		if (actor.type === "Player") {
			partyTokens.push(buildPartyCardEntry(token, actor, { isOwner: actor.isOwner }));
		}
		else if (game.user.isGM) {
			// NPCs/monsters — the on-screen tray respects tray.showNPCs, but the
			// GM -> players broadcast must not be gated by that personal toggle.
			// Callers that build the broadcast pass includeAllNPCs:true.
			if (includeAllNPCs || _getPartySetting("tray.showNPCs", true)) {
				npcTokens.push(buildPartyCardEntry(token, actor, { isNPC: true, isOwner: true }));
			}
		}
		else if (!_hideNpcsFromPlayers && !actor.hasPlayerOwner) {
			// NPCs visible to players when GM allows it
			npcTokens.push(buildPartyCardEntry(token, actor, { isNPC: true, isOwner: false }));
		}
	}

	return { partyTokens, npcTokens };
}

/**
 * Build party/NPC card entries for a specific scene id (GM answering a
 * player's request for a scene that may not be the GM's current canvas).
 * Falls back to the live canvas when the requested scene is the active one.
 * @param {string} sceneId
 * @returns {{partyTokens: Array, npcTokens: Array}}
 */
function _getPartyTokensForScene(sceneId) {
	if (!sceneId || sceneId === _activeSceneId()) {
		return getPartyTokens({ includeAllNPCs: true });
	}
	const scene = game.scenes?.get?.(sceneId);
	if (!scene) return { partyTokens: [], npcTokens: [] };
	const partyTokens = [];
	const npcTokens = [];
	let docs = [];
	try {
		if (scene.tokens?.contents) docs = scene.tokens.contents;
		else if (scene.tokens && typeof scene.tokens.values === "function") docs = [...scene.tokens.values()];
		else if (scene.tokens) docs = [...scene.tokens];
	}
	catch{
		docs = [];
	}
	for (const doc of docs) {
		const actor = doc.actor ?? (doc.actorId ? game.actors?.get?.(doc.actorId) : null);
		if (!actor) continue;
		const isHidden = doc.hidden ?? doc.document?.hidden ?? false;
		if (isHidden) continue;
		let pileData;
		try {
			if (game.modules.get("item-piles")?.active) {
				pileData = doc.getFlag?.("item-piles", "data") ?? actor.getFlag?.("item-piles", "data");
			}
		}
		catch{}
		if (pileData?.enabled) continue;
		if (actor.type === "Player") {
			const wrapper = { id: doc.id, name: doc.name ?? actor.name, actor, document: doc };
			partyTokens.push(buildPartyCardEntry(wrapper, actor, { isOwner: !!actor.isOwner }));
		}
		else {
			const wrapper = { id: doc.id, name: doc.name ?? actor.name, actor, document: doc };
			npcTokens.push(buildPartyCardEntry(wrapper, actor, { isNPC: true, isOwner: true }));
		}
	}
	return { partyTokens, npcTokens };
}

/**
 * Build a party card entry for one token.
 *
 * HP/AC/luck come from the GM's stat snapshot when this client cannot read
 * the actor directly (limited ownership exposes no system data); otherwise
 * they are read live from the actor.
 */
function buildPartyCardEntry(token, actor, { isNPC = false, isOwner = false } = {}) {
	const stats = _scenePartyMap().get(token.id);
	const hp = stats?.hp ?? getActorHP(actor);
	const luck = stats?.luck ?? (isNPC ? null : getLuckTokens(actor));
	// The GM sees full numbers everywhere. Players see exact HP/AC only for
	// party members — monster/NPC cards show the bar but never the digits.
	const showFullStats = game.user.isGM || !isNPC;
	return {
		token,
		actor,
		id: token.id,
		name: token.name,
		img: actor.img,
		hp,
		healthbarStatus: getHealthbarStatusFromHP(hp),
		ac: stats?.ac ?? actor.system?.attributes?.ac?.value ?? 0,
		luck,
		hasLuck: luck !== null,
		showHpNumbers: showFullStats,
		showAc: showFullStats,
		isOwner,
		isNPC,
		isSelected: canvas.tokens.controlled.some(t => t.id === token.id),
	};
}

/**
 * Current luck token count for a player actor, mirroring the system's
 * hasLuckToken getter: pulp mode counts remaining luck points, standard
 * mode has a single available token.
 * @param {Actor} actor
 * @returns {number}
 */
function getLuckTokens(actor) {
	const luck = actor.system?.luck;
	if (!luck) return 0;
	return game.settings.get("shadowdark", "usePulpMode")
		? (luck.remaining ?? 0)
		: (luck.available ? 1 : 0);
}

/**
 * Get HP data for an actor
 * @param {Actor} actor
 * @returns {Object}
 */
export function getActorHP(actor) {
	const hp = actor.system?.attributes?.hp;
	if (!hp) return { value: 0, max: 0, percent: 0 };

	const value = hp.value ?? 0;
	const max = hp.max ?? 1;
	const percent = Math.max(0, Math.min(100, (value / max) * 100));

	return { value, max, percent };
}

/**
 * Get health bar status class
 * @param {Actor} actor
 * @returns {string}
 */
export function getHealthbarStatus(actor) {
	return getHealthbarStatusFromHP(getActorHP(actor));
}

/**
 * Get health bar status class from an HP object
 * @param {Object} hp - HP data { value, max, percent }
 * @returns {string}
 */
export function getHealthbarStatusFromHP(hp) {
	const percent = hp?.percent ?? 0;

	if (percent <= 0) return "dead";
	if (percent <= 25) return "critical";
	if (percent <= 50) return "bloodied";
	if (percent <= 75) return "injured";
	return "healthy";
}

/**
 * Get health overlay height for character portrait
 * @param {Object} hp - HP object with value and max (or percent only, for
 * players viewing NPCs — the overlay is a percentage, so exact HP is not
 * needed to render it)
 * @returns {string}
 */
export function getHealthOverlayHeight(hp) {
	if (!hp) return "0%";
	// Percent-only HP (players viewing NPCs): the wounded share is the
	// missing percentage.
	if (!hp.max) {
		const percent = 100 - (hp.percent ?? 0);
		if (!Number.isFinite(percent)) return "0%";
		return `${Math.min(100, Math.max(0, percent))}%`;
	}
	const missing = hp.max - hp.value;
	const percent = (missing / hp.max) * 100;
	if (!Number.isFinite(percent)) return "0%";
	return `${Math.min(100, Math.max(0, percent))}%`;
}

/**
 * Set the current view mode
 * @param {string} mode - "player" or "party"
 */
export async function setViewMode(mode) {
	const modes = getVisibleTrayModes({
		isGM: game.user.isGM,
		canPlayerPaint: canPlayerPaint(),
		showPartyTab: _getPartySetting("tray.showPartyTab", true),
		disabledFeatureIds: getDisabledFeatureIds(),
	});
	if (!modes.includes(mode)) mode = modes[0];
	_viewMode = mode;
	// Toggle hex painting based on active tab
	if (mode === "hexes") {
		setDecorMode(false);
		enablePainting();
		disableDungeonPainting();
	}
	else if (mode === "dungeons") {
		setDecorMode(false);
		disablePainting();
		enableDungeonPainting();
		// If player switching to dungeons and no tiles loaded, try to reload
		if (!game.user.isGM && canPlayerPaint()) {
			const data = await getDungeonPainterData();
			if (!data.hasFloorTiles) {
				await reloadDungeonAssets();
			}
		}
	}
	else if (mode === "decor") {
		setDecorMode(true);
		enablePainting();
		disableDungeonPainting();
	}
	else {
		setDecorMode(false);
		disablePainting();
		disableDungeonPainting();
	}
	renderTray();
}

/**
 * Get the current view mode/**
 * Get current view mode
 */
export function getViewMode() {
	return _viewMode;
}

/**
 * Toggle whether NPCs are hidden from players.
 *
 * Persists to the world-scope setting tray.hideNpcsFromPlayers; Foundry's
 * setting sync pushes it to every client, where the updateSetting hook in
 * initTray refreshes the cache and re-renders the tray.
 */
export function toggleHideNpcsFromPlayers() {
	if (!game.user.isGM || !isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) {
		return _hideNpcsFromPlayers;
	}
	const next = !_hideNpcsFromPlayers;
	_hideNpcsFromPlayers = next;
	game.settings.set(MODULE_ID, "tray.hideNpcsFromPlayers", next);
	renderTray();
	return next;
}

/**
 * Get whether NPCs are hidden from players
 */
export function getHideNpcsFromPlayers() {
	return _hideNpcsFromPlayers;
}

/**
 * Register the GM -> players party stat snapshot handler.
 *
 * Called from the composition root's ready hook alongside the other socket
 * handlers. The GM broadcasts HP/AC/luck for every scene token; players
 * store the snapshot and merge it into the party cards, because a limited
 * ownership actor exposes no system data to read locally.
 */
export function registerPartyStatsSocket(socket) {
	if (!socket || !isFeatureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) return;
	_partySocket = socket;
	socket.register("sdxTrayPartyStats", async payload => {
		// The GM already reads full actor data; only players need the snapshot.
		if (game.user.isGM) return true;
		// New wire shape is { sceneId, stats }; tolerate legacy plain stats for tests/compat.
		let sceneId;
		let stats;
		if (payload && typeof payload === "object" && "sceneId" in payload && "stats" in payload) {
			sceneId = payload.sceneId ?? _activeSceneId();
			stats = payload.stats;
		}
		else {
			sceneId = _activeSceneId();
			stats = payload;
		}
		_partyStats.set(sceneId, new Map(Object.entries(stats ?? {})));
		if (sceneId === _activeSceneId()) renderTray();
		return true;
	});
	socket.register("sdxTrayRequestPartyStats", async requestedSceneId => {
		// A player finished loading: push the snapshot for the scene they are
		// actually viewing. The GM's userConnected force-broadcast can race
		// ahead of the joining client's handler registration and be dropped,
		// so fresh clients ask for it explicitly.
		if (!game.user.isGM) return true;
		const sceneId = typeof requestedSceneId === "string" && requestedSceneId ? requestedSceneId : _activeSceneId();
		let partyTokens;
		let npcTokens;
		if (sceneId && sceneId !== _activeSceneId()) {
			({ partyTokens, npcTokens } = _getPartyTokensForScene(sceneId));
		}
		else {
			({ partyTokens, npcTokens } = getPartyTokens({ includeAllNPCs: true }));
		}
		_broadcastPartyStats(partyTokens, npcTokens, true, sceneId);
		return true;
	});
}

/**
 * Build the GM -> players stat payload for the current roster.
 *
 * Exported so the wire shape is testable: party members keep full
 * HP/AC/luck; monsters/NPCs are stripped to the HP percent (players may see
 * the bar and everything derived from it, never the exact numbers or AC);
 * hidden tokens are skipped entirely.
 * @param {Object[]} partyTokens - Party card entries from getPartyTokens
 * @param {Object[]} npcTokens - NPC card entries from getPartyTokens
 * @returns {Object} Payload keyed by token id
 */
export function buildPartyStatsPayload(partyTokens, npcTokens) {
	const stats = {};
	for (const t of [...partyTokens, ...npcTokens]) {
		if (!t.actor) continue;
		if (t.token?.document?.hidden) continue;
		stats[t.id] = t.isNPC
			? { hp: { percent: t.hp?.percent ?? 0 }, ac: null, luck: null }
			: { hp: t.hp, ac: t.ac, luck: t.hasLuck ? t.luck : null };
	}
	return stats;
}

/**
 * Broadcast the current party/NPC stat snapshot to every client (GM only).
 *
 * Party members get full HP/AC/luck. Monsters/NPCs get only the HP percent —
 * players may see the bar (and the wounded overlay / death skull derived
 * from it) but never the exact numbers or AC, even when NPCs are revealed
 * to them. Hidden tokens are skipped entirely: players can't see them, so
 * their stats are not broadcast either.
 *
 * Deduped by JSON comparison so token movement (which re-renders the tray
 * constantly) never spams the socket; `force` bypasses the dedupe for
 * players who join after the last broadcast.
 */
function _broadcastPartyStats(partyTokens, npcTokens, force = false, sceneId = _activeSceneId()) {
	if (!game.user.isGM || !_partySocket) return;
	const stats = buildPartyStatsPayload(partyTokens, npcTokens);
	const key = JSON.stringify(stats);
	const prev = _broadcastKeyForScene(sceneId);
	if (!force && key === prev) return;
	_setBroadcastKeyForScene(sceneId, key);
	_partySocket.executeForEveryone("sdxTrayPartyStats", { sceneId, stats });
}

/** Broadcast one scene's authoritative roster outside the render path. */
function _broadcastScenePartyStats(sceneId = _activeSceneId(), force = false) {
	if (!game.user.isGM || !sceneId) return;
	const roster = sceneId === _activeSceneId()
		? getPartyTokens({ includeAllNPCs: true })
		: _getPartyTokensForScene(sceneId);
	_broadcastPartyStats(roster.partyTokens, roster.npcTokens, force, sceneId);
}

/** Broadcast every scene containing an actor whose stats changed. */
function _broadcastActorPartyStats(actor) {
	if (!game.user.isGM || !actor?.id) return;
	const sceneIds = (game.scenes?.contents ?? [])
		.filter(scene => scene.tokens?.some(token =>
			(token.actorId ?? token.actor?.id) === actor.id))
		.map(scene => scene.id);
	if (!sceneIds.length && _activeSceneId()) sceneIds.push(_activeSceneId());
	for (const sceneId of new Set(sceneIds)) _broadcastScenePartyStats(sceneId);
}

/**
 * Cycle to the next view mode
 */
export function cycleViewMode() {
	const showParty = _getPartySetting("tray.showPartyTab", true);
	const isGM = game.user.isGM;
	const modes = getVisibleTrayModes({
		isGM,
		canPlayerPaint: canPlayerPaint(),
		showPartyTab: showParty,
		disabledFeatureIds: getDisabledFeatureIds(),
	});

	const currentIndex = modes.indexOf(_viewMode);
	// If current mode isn't in list (e.g. switched from player to GM view), start at 0
	const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length;
	_viewMode = modes[nextIndex];

	// Toggle painting based on active tab
	if (_viewMode === "hexes") {
		setDecorMode(false);
		enablePainting();
		disableDungeonPainting();
	}
	else if (_viewMode === "dungeons") {
		setDecorMode(false);
		disablePainting();
		enableDungeonPainting();
	}
	else if (_viewMode === "decor") {
		setDecorMode(true);
		enablePainting();
		disableDungeonPainting();
	}
	else {
		setDecorMode(false);
		disablePainting();
		disableDungeonPainting();
	}

	renderTray();
}

/**
 * Toggle tray expansion
 */
export function toggleTray() {
	if (_trayApp) {
		_trayApp.toggleExpanded();
	}
}

/**
 * Render the tray with current data
 */
export async function renderTray() {
	if (!_trayApp) return;

	// Which render this is. Building the context waits — notes are enriched,
	// painter catalogues are read — and the world does not wait with it. Two
	// renders can therefore be in flight over two different scenes and finish in
	// either order, so completion order must not decide what the user sees: the
	// render that STARTED last is the one describing the world as it is now.
	const generation = ++_renderGeneration;

	const disabledFeatureIds = getDisabledFeatureIds();
	const features = getFeatureFlagContext(disabledFeatureIds);
	const modes = getVisibleTrayModes({
		isGM: game.user.isGM,
		canPlayerPaint: canPlayerPaint(),
		showPartyTab: _getPartySetting("tray.showPartyTab", true),
		disabledFeatureIds,
	});
	if (!modes.includes(_viewMode)) _viewMode = modes[0];

	// What this render is describing, read once and then used throughout rather
	// than re-read after each await. Reading the active scene again on the far
	// side of enrichment is how a render built from one scene came to publish
	// its rows under another scene's name.
	const trayApp = _trayApp;
	const viewMode = _viewMode;
	const scene = canvas.scene ?? null;

	const actor = getCurrentActor();
	const { partyTokens, npcTokens } = features.partyManagement
		? getPartyTokens()
		: { partyTokens: [], npcTokens: [] };
	const showPartyTab = features.partyManagement
		&& _getPartySetting("tray.showPartyTab", true);
	const partyName = _getPartySetting("tray.partyName", "Party");
	const showHealthBars = _getPartySetting("tray.showHealthBars", true);

	// Calculate party totals
	let partyTotalHP = 0;
	let partyRemainingHP = 0;
	for (const member of partyTokens) {
		partyTotalHP += member.hp.max;
		partyRemainingHP += member.hp.value;
	}

	// Get other party members (for handle display)
	const otherPartyMembers = partyTokens.filter(m => !actor || m.actor.id !== actor.id);

	const data = {
		features,
		actor: actor,
		actorDisplayName: actor?.name || "Select a Character",
		viewMode: _viewMode,
		showTabParty: showPartyTab,
		isGM: game.user.isGM,
		partyName: partyName,
		showHealthBars: showHealthBars,
		hideNpcsFromPlayers: _hideNpcsFromPlayers,

		// Party data
		partyTokens: partyTokens,
		npcTokens: npcTokens,
		otherPartyMembers: otherPartyMembers,
		partyTotalHP: partyTotalHP,
		partyRemainingHP: partyRemainingHP,
		partyHealthbarStatus: getPartyHealthbarStatus(partyRemainingHP, partyTotalHP),

		// Actor HP if present
		actorHP: actor ? getActorHP(actor) : null,
		actorHealthbarStatus: actor ? getHealthbarStatus(actor) : null,

		// Selection info
		controlledTokenIds: canvas.tokens?.controlled.map(t => t.id) || [],
		selectionCount: canvas.tokens?.controlled.length || 0,
		showSelectionBox: canvas.tokens?.controlled.length > 1,

		// Pins Data
		pins: features.journalPins && game.user.isGM ? getPinsData() : [],
		mapNotes: features.journalPins ? getMapNotesData() : [],

		// Notes Data. Built for the tab that shows it and for nothing else:
		// enriching every note on the scene is the expensive part of this
		// context, and the other six views would only throw it away. Switching
		// into Notes rerenders the tray, so nothing is missing when it is needed.
		noteGroups: features.journalPlaceableNotes && viewMode === "notes"
			? await getNoteGroupsData(scene)
			: null,
		// Which scene those groups describe. The tray's session-only collapse
		// state is keyed by group id, and every scene reuses the same eight ids,
		// so the identity has to travel with them — and it is the identity this
		// render was built from, not whatever the canvas is showing by now.
		noteSceneId: scene?.id ?? null,

		// Hex Painter Data
		...(features.hexPainter || features.hexDecorPainter ? await getHexPainterData() : {}),

		// Dungeon Painter Data
		...(features.dungeonPainter ? await getDungeonPainterData() : {}),

		// Active Effects
		activeEffects: (() => {
			if (!actor) return [];
			// Use appliedEffects if available (V11+) to get currently active effects
			// This handles disabled state, suppression, etc.
			const effects = actor.appliedEffects || actor.effects;

			return effects.map(e => ({
				id: e.id,
				name: e.name,
				img: e.icon || e.img,
				disabled: e.disabled,
			}));
		})(),
	};

	// Everything above describes the world as it was when this render started.
	// Publishing it now is only honest if that is still the world.
	//
	// The generation is the decision: a newer render has started, so whatever
	// this one built has already been superseded and must not be shown, still
	// less reconciled against the tray's browsing state as though it were
	// current. The three identity checks catch the case where nothing has
	// replaced this render yet but what it describes is already gone — the tray
	// was rebuilt, the user changed tab, or the canvas changed scene — and the
	// render that will replace it has not begun.
	if (generation !== _renderGeneration) return;
	if (trayApp !== _trayApp || viewMode !== _viewMode) return;
	if ((canvas.scene ?? null) !== scene) return;

	trayApp.updateData(data);
}

/**
 * Get enriched pin data for the current scene
 * Logic adapted from PinListApp
 * @returns {Array}
 */
export function getPinsData() {
	if (!canvas.scene) return [];

	// Get the pins for the current scene this user may see. A row carries the
	// pin's name and opens its journal, so it is gated by the same predicate the
	// canvas renderer uses.
	const pins = JournalPinManager.list({ sceneId: canvas.scene.id })
		.filter(pin => checkPinVisibility(pin));

	// Enrich pin data
	const enrichedPins = pins.map(pin => {
		// Resolve display name honoring the pin's nameSource preference
		let pinName = JournalPinManager.getDisplayName(pin);
		const pageName = getPinJournalSubtitle(pin);

		// Determine Display Type & Content
		const style = pin.style || {};
		const contentType = style.contentType || (style.showIcon ? "symbol" : "number");
		const shape = style.shape || "circle";

		let displayType = "icon";
		let displayContent = "";
		let displayStyle = "";
		let displayClass = "";
		let displayTint = "";

		// Handle Image Shape (Icon is the image itself)
		if (shape === "image" && style.imagePath) {
			displayType = "image";
			displayContent = style.imagePath;
			displayTint = normalizeImageTint(style.imageTint)?.css || "";
		}
		// Handle Custom Icon Content
		else if (contentType === "customIcon" && style.customIconPath) {
			displayType = "image";
			displayContent = style.customIconPath;
		}
		// Handle FontAwesome Icon
		else if (contentType === "symbol" || contentType === "icon") {
			displayType = "icon";
			displayClass = style.symbolClass || style.iconClass || "fa-solid fa-map-pin";
			displayStyle = `color: ${style.symbolColor || style.fontColor || "#ffffff"};`;
		}
		// Handle Text/Number
		else {
			displayType = "text";
			displayStyle = `
                color: ${style.fontColor || "#ffffff"};
                font-family: ${style.fontFamily || "Arial"};
                font-weight: ${style.fontWeight || "bold"};
                font-size: 16px;
            `;

			if (contentType === "text") {
				displayContent = style.customText || "";
			}
			// Number logic
			else if (pin.journalId && pin.pageId) {
				const journal = game.journal.get(pin.journalId);
				if (journal) {
					const sortedPages = journal.pages.contents.sort((a, b) => a.sort - b.sort);
					const idx = sortedPages.findIndex(p => p.id === pin.pageId);
					displayContent = idx >= 0 ? idx : 0;
				}
				else {
					displayContent = "0";
				}
			}
			else {
				displayContent = "0";
			}
		}

		let backgroundColor = style.fillColor || "#000000";
		let borderColor = style.ringColor || "#ffffff";

		// Calculate Border Radius
		let borderRadius = "50%";
		if (shape !== "circle") {
			const r = style.borderRadius !== undefined ? style.borderRadius : 4;
			borderRadius = `${r}px`;
		}

		return {
			id: pin.id,
			x: pin.x,
			y: pin.y,
			name: pinName,
			pageName: pageName,
			displayType,
			displayContent,
			displayStyle,
			displayClass,
			displayTint,
			backgroundColor,
			borderColor,
			borderRadius,
			gmOnly: pin.gmOnly,
			requiresVision: pin.requiresVision,
			folderId: pin.folderId ?? null,
			sort: pin.sort ?? 0,
		};
	});

	// --- Group pins under folders into a flat, depth-ordered row list ---
	// Each row is either {rowType:"folder", ...} or {rowType:"pin", ...}.
	// `ancestors` is a space-joined list of ancestor folder ids (NOT incl self
	// for folders; incl parent folder for pins) used for client-side collapse
	// hiding and search. `hidden` reflects a currently-collapsed ancestor.
	const folders = JournalPinManager.listFolders({ sceneId: canvas.scene.id });

	const pinsByFolder = new Map();
	for (const p of enrichedPins) {
		const key = p.folderId ?? null;
		if (!pinsByFolder.has(key)) pinsByFolder.set(key, []);
		pinsByFolder.get(key).push(p);
	}
	// Names tie-break on `sort`, with digit runs compared as numbers so
	// "Room 2" precedes "Room 10" instead of following it.
	for (const arr of pinsByFolder.values()) {
		arr.sort((a, b) => (a.sort - b.sort)
			|| a.name.localeCompare(b.name, undefined, { numeric: true }));
	}

	const foldersByParent = new Map();
	for (const f of folders) {
		const key = f.parentId ?? null;
		if (!foldersByParent.has(key)) foldersByParent.set(key, []);
		foldersByParent.get(key).push(f);
	}
	for (const arr of foldersByParent.values()) {
		arr.sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0))
			|| a.name.localeCompare(b.name, undefined, { numeric: true }));
	}

	const collapsedSet = new Set(folders.filter(f => f.collapsed).map(f => f.id));
	const countPins = folderId => {
		let n = (pinsByFolder.get(folderId) || []).length;
		for (const child of (foldersByParent.get(folderId) || [])) n += countPins(child.id);
		return n;
	};

	const INDENT = 14;
	const isImagePath = s => !!s && (/\.(svg|png|jpe?g|webp|gif|avif)$/i.test(s) || s.includes(
		"/"
	));
	const rows = [];
	const emitFolder = (folder, depth, ancestors) => {
		const selfAncestors = ancestors.concat(folder.id);
		rows.push({
			rowType: "folder",
			id: folder.id,
			name: folder.name,
			depth,
			indent: depth * INDENT,
			parentId: folder.parentId ?? null,
			ancestors: ancestors.join(" "),
			hidden: ancestors.some(a => collapsedSet.has(a)),
			collapsed: !!folder.collapsed,
			color: folder.color || null,
			icon: folder.icon || null,
			iconIsImage: isImagePath(folder.icon),
			count: countPins(folder.id),
			scope: folder.scope || "scene",
		});
		for (const child of (foldersByParent.get(folder.id) || [])) {
			emitFolder(child, depth + 1, selfAncestors);
		}
		for (const p of (pinsByFolder.get(folder.id) || [])) {
			rows.push({
				...p, rowType: "pin", depth: depth + 1, indent: (depth + 1) * INDENT,
				parentId: folder.id, ancestors: selfAncestors.join(" "),
				hidden: selfAncestors.some(a => collapsedSet.has(a)),
			});
		}
	};

	for (const f of (foldersByParent.get(null) || [])) emitFolder(f, 0, []);
	for (const p of (pinsByFolder.get(null) || [])) {
		rows.push({
			...p, rowType: "pin", depth: 0, indent: 0, parentId: null, ancestors: "", hidden: false,
		});
	}

	return rows;
}

/**
 * The icon each supported source type is shown with.
 *
 * Presentation flows from the type the index recorded, never the other way
 * round: no command may work out what a row is by reading its icon back. It is
 * what tells a Token note from the Actor note beside it, since a GM who names
 * both after the same character leaves the rows reading identically.
 */
const NOTE_ICONS = {
	Token: "fa-solid fa-user",
	Actor: "fa-solid fa-address-card",
	Tile: "fa-solid fa-image",
	Drawing: "fa-solid fa-pencil",
	Wall: "fa-solid fa-block-brick",
	AmbientLight: "fa-solid fa-lightbulb",
	AmbientSound: "fa-solid fa-volume-high",
	Region: "fa-solid fa-draw-polygon",
};

/**
 * What each group of the Notes tab is called. The index names a group after the
 * scene collection it was gathered from; a reader wants a heading.
 *
 * Deliberately just a label. Which document type a group holds is the index's
 * knowledge, and the rows it hands back already say so — restating that mapping
 * here would be a second copy of it, free to drift.
 */
const NOTE_GROUP_LABELS = {
	tokens: "Tokens",
	actors: "Actors",
	tiles: "Tiles",
	drawings: "Drawings",
	walls: "Walls",
	lights: "Lights",
	sounds: "Sounds",
	regions: "Regions",
};

/**
 * A scene's notes, as the groups the tray renders.
 *
 * The scene index decides what is in here, who may see it, and what order it is
 * in. This adds only what the tray needs to draw it: a heading per group and an
 * icon per row.
 *
 * @param {Scene|null} [scene] The scene to index, defaulting to the active one.
 *   A render passes the scene it started on: enriching notes takes time, and the
 *   canvas can move on while it happens, so the answer must be about the scene
 *   that was asked about rather than whichever one is current when it returns.
 * @returns {Promise<Array>}
 */
export async function getNoteGroupsData(scene = canvas.scene ?? null) {
	const groups = await buildPlaceableNoteIndex(scene, { isGM: game.user.isGM });

	return groups.map(group => ({
		...group,
		label: NOTE_GROUP_LABELS[group.id],
		// A group's heading wears its rows' icon. The index emits no empty
		// group, and every row in one is the same type, so the first row is
		// where that type is already recorded.
		icon: NOTE_ICONS[group.rows[0]?.sourceType],
		rows: group.rows.map(row => ({ ...row, icon: NOTE_ICONS[row.sourceType] })),
	}));
}

/**
 * The active scene's notes as one flat list of rows.
 *
 * This export predates the grouped tab, and a name that is simply gone breaks an
 * importing module when it LINKS rather than when it calls: the failure is not a
 * wrong answer but a module that will not load. So it stays, forwarding to the
 * grouped builder rather than keeping a second copy of the index call.
 *
 * The tray no longer renders from this — the Notes view renders the groups
 * themselves, behind the view gate — so nothing here is on the path an inactive
 * view takes.
 *
 * @returns {Promise<Array>}
 */
export async function getNotesData() {
	const groups = await getNoteGroupsData();

	return groups.flatMap(group => group.rows);
}

/**
 * Get enriched Map Notes data for the current scene
 * @returns {Array}
 */
export function getMapNotesData() {
	if (!canvas.scene) return [];

	// Filter notes based on user permission
	const notes = canvas.scene.notes.filter(n => n.testUserPermission(game.user, "LIMITED"));

	const enrichedNotes = notes.map(note => {
		// NoteDocument links to a JournalEntry via `entryId` (not `journalId`)
		// and to a page via `pageId`. Use those getters so a blank Text Label
		// falls back to the linked page name, then the journal name.
		const journal = note.entry;
		const page = note.page;

		let name = note.text || page?.name || journal?.name || "Unnamed Note";

		return {
			id: note.id,
			uuid: note.uuid,
			name: name,
			img: note.texture?.src || "icons/svg/book.svg",
			x: note.x,
			y: note.y,
			journalId: note.entryId,
			pageId: note.pageId,
			global: note.global,
			canDelete: note.canUserModify(game.user, "delete"),
		};
	});

	// Sort alphabetically
	enrichedNotes.sort((a, b) => a.name.localeCompare(b.name));
	return enrichedNotes;
}

/**
 * Get party health bar status
 * @param {number} remaining
 * @param {number} total
 * @returns {string}
 */
function getPartyHealthbarStatus(remaining, total) {
	if (total === 0) return "healthy";
	const percent = (remaining / total) * 100;

	if (percent <= 0) return "dead";
	if (percent <= 25) return "critical";
	if (percent <= 50) return "bloodied";
	if (percent <= 75) return "injured";
	return "healthy";
}

/**
 * Open actor sheet for a token
 *
 * The LIMITED check is not redundant with the template gating the feather on
 * `isOwner`: NPC cards are built with `isOwner: true` for the GM and `false`
 * for everyone else, so a player who reaches this function anyway — a stale
 * card rendered before a permission change, or a future call site — would ask
 * Foundry to render a sheet it will refuse, which surfaces as a bare
 * "no permission" warning and no sheet. Declining here keeps the affordance
 * and the capability in agreement.
 * @param {string} tokenId
 */
export function openTokenSheet(tokenId) {
	const token = canvas.tokens.get(tokenId);
	if (token?.actor?.testUserPermission(game.user, "LIMITED")) {
		token.actor.sheet.render(true);
	}
}

/**
 * Select a token on the canvas
 * @param {string} tokenId
 */
export function selectToken(tokenId) {
	const token = canvas.tokens.get(tokenId);
	if (token) {
		token.control({ releaseOthers: true });
	}
}

/**
 * Center the canvas on a token.
 *
 * Works for tokens the user doesn't own (e.g. another player's character),
 * which is what the party tracker's double-click uses it for.
 * @param {string} tokenId
 */
export function centerOnToken(tokenId) {
	const token = canvas.tokens?.get(tokenId);
	if (!token) return;
	canvas.animatePan({ x: token.center.x, y: token.center.y });
	if (game.user.isGM || token.isOwner) {
		token.control({ releaseOthers: true });
	}
}

/**
 * Select all party tokens
 */
export function selectPartyTokens() {
	if (!canvas.tokens) return;

	const tokens = canvas.tokens.placeables;
	const partyTokens = [];

	for (const token of tokens) {
		const actor = token.actor;
		if (!actor) continue;

		// For GM: select all players, for players: select owned
		if (game.user.isGM) {
			if (actor.type === "Player") {
				partyTokens.push(token);
			}
		}
		else if (actor.isOwner) {
			partyTokens.push(token);
		}
	}

	// Release all tokens first
	canvas.tokens.releaseAll();

	// Control all party tokens
	for (const token of partyTokens) {
		token.control({ releaseOthers: false });
	}
}

/**
 * Clear all token selections
 */
export function clearTokenSelection() {
	canvas.tokens?.releaseAll();
}

/**
 * Switch to a specific actor (for players with multiple characters)
 * @param {string} actorId
 */
export function switchToActor(actorId) {
	const actor = game.actors.get(actorId);
	if (!actor) return;

	// Find a token for this actor on the current scene
	const token = canvas.tokens?.placeables.find(t => t.actor?.id === actorId);
	if (token) {
		token.control({ releaseOthers: true });
	}

	renderTray();
}
