/**
 * Marching Mode for Shadowdark Extras
 *
 * Allows a GM to designate a party leader and enable marching mode where
 * other tokens follow the leader's exact movement path.
 */

import { FormationSpawnerSD } from "./FormationSpawnerSD.mjs";
import { PinPlacer } from "../journal/JournalPinsSD.mjs";
import { PinListApp } from "../journal/PinListApp.mjs";
import { FEATURE_IDS, isFeatureEnabled } from "../settings/feature-gates.mjs";

const MODULE_ID = "shadowdark-extras";
const SETTING_KEY_LEADER = "marchingModeLeader";
const SETTING_KEY_ENABLED = "marchingModeEnabled";

// Marching mode state
let marchingModeEnabled = false;
let leaderTokenId = null;
let leaderMovementPath = []; // Array of {x, y, gridPos} points
let tokenFollowers = new Map(); // tokenId -> {marchPosition, moving}
let processingCongaMovement = false;
let congaMovementPending = false; // Flag to re-trigger conga after current cycle
let scheduledTimeouts = new Set(); // Track pending timeouts for cleanup
let combatSuspendKey = null; // "<combatId>:<sceneId>" of the episode that last suspended marching

/**
 * Save marching mode state to settings
 */
async function saveMarchingState() {
	if (!game.user.isGM) return;

	await game.settings.set(MODULE_ID, SETTING_KEY_LEADER, leaderTokenId || "");
	await game.settings.set(MODULE_ID, SETTING_KEY_ENABLED, marchingModeEnabled);
	console.log(`${MODULE_ID} | Saved marching state: leader=${leaderTokenId}, enabled=${marchingModeEnabled}`);
}

/**
 * Load marching mode state from settings
 */
function loadMarchingState() {


	const savedLeader = game.settings.get(MODULE_ID, SETTING_KEY_LEADER);
	const savedEnabled = game.settings.get(MODULE_ID, SETTING_KEY_ENABLED);

	leaderTokenId = savedLeader || null;
	marchingModeEnabled = savedEnabled || false;

	console.log(`${MODULE_ID} | Loaded marching state: leader=${leaderTokenId}, enabled=${marchingModeEnabled}`);
}

/**
 * Register game settings for marching mode
 */
function registerMarchingSettings() {
	game.settings.register(MODULE_ID, SETTING_KEY_LEADER, {
		name: "Marching Mode Leader",
		scope: "world",
		config: false,
		type: String,
		default: "",
		// Keep every client (players included) in sync when the GM changes the leader.
		onChange: value => {
			leaderTokenId = value || null;
			updateButtonStates();
		},
	});

	game.settings.register(MODULE_ID, SETTING_KEY_ENABLED, {
		name: "Marching Mode Enabled",
		scope: "world",
		config: false,
		type: Boolean,
		default: false,
		// Keep every client (players included) in sync when the GM toggles the mode.
		// Without this, players' local marchingModeEnabled stays stale and keeps
		// blocking their movement even after the GM switches to Free Movement.
		onChange: value => {
			marchingModeEnabled = !!value;
			if (!marchingModeEnabled) {
				leaderMovementPath = [];
				tokenFollowers.clear();
			}
			updateButtonStates();
		},
	});
}

/**
 * Schedule a timeout and track it for cleanup
 */
function scheduleTimeout(callback, delay) {
	const id = setTimeout(() => {
		scheduledTimeouts.delete(id);
		callback();
	}, delay);
	scheduledTimeouts.add(id);
	return id;
}

/**
 * Clear all scheduled timeouts
 */
function clearScheduledTimeouts() {
	for (const id of scheduledTimeouts) {
		clearTimeout(id);
	}
	scheduledTimeouts.clear();
}

/**
 * Initialize Marching Mode
 */
export function initMarchingMode() {


	console.log(`${MODULE_ID} | Initializing Marching Mode`);

	// Register settings
	registerMarchingSettings();

	// Load saved state
	loadMarchingState();

	// Hook into token movement
	Hooks.on("preUpdateToken", onPreUpdateToken);
	Hooks.on("updateToken", onUpdateToken);

	// Combat lifecycle (issue #99 + #101 + #104): suspend marching once per
	// combat episode. combatStart/updateCombat are gated on the active combat
	// for the current scene (game.combats.active?.id === combat.id, issue
	// #101); createCombat is scene-scoped only — (c.scene === null) ||
	// (c.scene === game.scenes.current) (foundry.mjs:39899-39901) — and
	// deliberately does not require c.active, because programmatic
	// Combat.create({round:1}) leaves it false (foundry.mjs:18149/39905).
	// Off-scene combats must not clear the current scene's trail; a global
	// combat (scene:null) is active on every scene.
	// combatStart fires when a combat begins (before its round-1 update, so
	// force-start); updateCombat catches an already-started combat created via
	// API/import or a manual round bump; createCombat catches an already-started
	// combat created/imported with round>0 (foundry.mjs:50729 started===round>0,
	// generic create 159-165 emits createCombat only); deleteCombat re-arms for
	// a replacement combat that never un-started.
	Hooks.on("combatStart", combat => {
		if (game.combats?.active?.id !== combat.id) return;
		handleCombatEpisode(combat, true);
	});
	Hooks.on("updateCombat", combat => {
		if (game.combats?.active?.id !== combat.id) return;
		// A round reset back to 0 on the keyed combat closes the episode: a later
		// restart of the SAME combat must re-arm, so drop the latch. The round-1
		// update that follows combatStart must not release it — started is already
		// true there (foundry.mjs:50729) and dropping the latch would re-suspend
		// on the next turn advance and clear the trail mid-combat.
		if (!combat.started && combatSuspendKey === `${combat.id}:${combat.scene?.id ?? ""}`) {
			combatSuspendKey = null;
			return;
		}
		handleCombatEpisode(combat);
	});
	Hooks.on("createCombat", combat => {
		if (!combat.started) return;
		// Scene-scoped like CombatEncounters#combats (foundry.mjs:39899-39901):
		// (c.scene === null) || (c.scene === game.scenes.current). A global
		// combat (scene:null) is active on every scene. Do not require
		// c.active — programmatic Combat.create({round:1}) leaves active false
		// (BooleanField no initial, foundry.mjs:18149; CombatEncounters#active
		// requires c.active, foundry.mjs:39905), so the previous active-id
		// guard was inert for the imported/API case this handler exists for.
		// Use game.scenes.current (not canvas.scene) to match Foundry's own
		// semantics. For stub scenes in tests, also accept an id match.
		if (!(combat.scene === null
			|| combat.scene === game.scenes?.current
			|| combat.scene?.id === game.scenes?.current?.id)) return;
		handleCombatEpisode(combat);
	});
	Hooks.on("deleteCombat", combat => {
		// The combat driving the suspension is gone. A replacement is a new
		// episode: re-arm the identity latch against whatever is active now.
		const active = game.combats?.active;
		if (active?.started) handleCombatEpisode(active);
		else combatSuspendKey = null;
	});

	// Restore leader crown when canvas is ready; a scene change can surface a
	// different active combat (or none), so re-key the suspension identity.
	Hooks.on("canvasReady", onCanvasReady);
	// Backfill for an already-active combat at load (e.g. refresh mid-combat
	// or an imported started combat that existed before this module init). The
	// canvasReady handler will also fire when the canvas reloads, but this
	// covers the case where the active combat is already present at init time.
	if (game.combats?.active?.started) handleCombatEpisode(game.combats.active);

	// Clean up crown when token is deleted
	Hooks.on("deleteToken", async (tokenDoc, options, userId) => {
		if (tokenDoc.id === leaderTokenId) {
			// Leader was deleted, clear leader
			await setLeader(null);
		}
	});

	// Show crown on newly created tokens if they're the leader
	Hooks.on("createToken", async (tokenDoc, options, userId) => {
		// Small delay to ensure token is fully initialized
		await new Promise(resolve => {
			setTimeout(resolve, 100);
		});

		if (tokenDoc.id === leaderTokenId) {
			const token = canvas.tokens.get(tokenDoc.id);
			if (token) {
				await showLeaderCrown(token);
			}
		}
	});
}

let sidebarToolsRegistered = false;

/** Register Foundry-sidebar fallbacks independently of Marching Mode. */
export function initSidebarTools() {
	if (sidebarToolsRegistered) return;
	sidebarToolsRegistered = true;
	Hooks.on("renderSidebar", onRenderSidebar);

	const sidebar = document.getElementById("sidebar");
	if (sidebar && shouldUseSidebarTools()) {
		injectSidebarButtons($(sidebar));
	}
}

function shouldUseSidebarTools() {
	return !isFeatureEnabled(FEATURE_IDS.TRAY) || !game.settings.get(MODULE_ID, "tray.enabled");
}

/**
 * Hook callback for renderSidebar
 */
function onRenderSidebar(sidebar, html) {
	if (shouldUseSidebarTools()) {
		injectSidebarButtons(html);
	}
}

/**
 * Inject sidebar buttons into the given HTML
 */
function injectSidebarButtons($html) {
	const $tabs = $html.find("#sidebar-tabs");
	if (!$tabs.length) {
		console.warn(`${MODULE_ID} | Could not find #sidebar-tabs`);
		return;
	}

	// Check if buttons already exist
	if ($tabs.find(".sdx-marching-btn-container").length) {
		console.log(`${MODULE_ID} | Marching buttons already exist, skipping injection`);
		return;
	}

	// Find the settings button to insert before it
	const $settingsBtn = $tabs.find('button[data-tab="settings"]').parent();
	if (!$settingsBtn.length) {
		console.warn(`${MODULE_ID} | Could not find settings button to insert marching buttons before`);
		return;
	}

	console.log(`${MODULE_ID} | Injecting marching mode buttons into sidebar`);

	// Create Leader button
	const $leaderBtn = $(`
        <li class="sdx-marching-btn-container">
            <button type="button" class="ui-control plain icon fa-solid fa-crown sdx-marching-leader-btn"
                    data-tooltip="Choose Party Leader" data-tooltip-direction="LEFT">
            </button>
        </li>
    `);

	// Create Movement Mode button
	const $movementBtn = $(`
        <li class="sdx-marching-btn-container">
            <button type="button" class="ui-control plain icon fa-solid fa-person-walking sdx-marching-mode-btn"
                    data-tooltip="Movement Mode" data-tooltip-direction="LEFT">
            </button>
        </li>
    `);

	// Create Formation Spawner button
	const $formationBtn = $(`
        <li class="sdx-marching-btn-container">
            <button type="button" class="ui-control plain icon fa-solid fa-users-viewfinder sdx-formation-btn"
                    data-tooltip="Formation Spawner" data-tooltip-direction="LEFT">
            </button>
        </li>
    `);

	// Create Add Pin button
	const $addPinBtn = $(`
        <li class="sdx-marching-btn-container">
            <button type="button" class="ui-control plain icon fa-solid fa-map-pin sdx-add-pin-btn"
                    data-tooltip="Add Journal Pin" data-tooltip-direction="LEFT">
            </button>
        </li>
    `);

	// Insert before settings
	if (game.user.isGM) {
		if (isFeatureEnabled(FEATURE_IDS.MARCHING_MODE)) {
			$settingsBtn.before($leaderBtn);
			$settingsBtn.before($movementBtn);
		}
		if (isFeatureEnabled(FEATURE_IDS.FORMATION_SPAWNER)) {
			$settingsBtn.before($formationBtn);
		}
		if (isFeatureEnabled(FEATURE_IDS.JOURNAL_PINS)) $settingsBtn.before($addPinBtn);
	}

	// Add event handlers
	if (game.user.isGM) {
		if (isFeatureEnabled(FEATURE_IDS.MARCHING_MODE)) {
			$leaderBtn.find("button").on("click", showLeaderDialog);
			$movementBtn.find("button").on("click", showMovementModeDialog);
		}
		if (isFeatureEnabled(FEATURE_IDS.FORMATION_SPAWNER)) {
			$formationBtn.find("button").on("click", () => FormationSpawnerSD.show());
		}

		// SDX Pins - Menu Dialog
		if (isFeatureEnabled(FEATURE_IDS.JOURNAL_PINS)) $addPinBtn.find("button").on("click", () => {
			new foundry.applications.api.DialogV2({
				window: { title: "SDX Pins" },
				content: "<p>Select an action:</p>",
				position: { width: 300 },
				buttons: [
					{
						action: "add",
						icon: "fas fa-map-pin",
						label: "Add Pin",
						default: true,
						callback: () => PinPlacer.activate(),
					},
					{
						action: "list",
						icon: "fas fa-list",
						label: "Pin List",
						callback: () => PinListApp.show(),
					},
				],
			}).render({ force: true });
		});
	}

	// Create Carousing button
	const $carousingBtn = $(`
        <li class="sdx-marching-btn-container">
            <button type="button" class="ui-control plain icon fa-solid fa-beer sdx-carousing-sidebar-btn"
                    data-tooltip="${game.i18n.localize("SHADOWDARK_EXTRAS.carousing.title")}" data-tooltip-direction="LEFT">
            </button>
        </li>
    `);

	if (isFeatureEnabled(FEATURE_IDS.CAROUSING)) $settingsBtn.before($carousingBtn);

	// Add Carousing handler
	if (isFeatureEnabled(FEATURE_IDS.CAROUSING)) $carousingBtn.find("button").on("click", () => {
		if (window.sdxOpenCarousingOverlay) {
			window.sdxOpenCarousingOverlay();
		}
		else {
			ui.notifications.warn("Carousing system not ready.");
		}
	});


	// Update button states
	updateButtonStates();
}

/**
 * Show leader selection dialog
 */
export function showLeaderDialog() {
	// Get all player-owned tokens on the current scene
	const playerTokens = canvas.tokens.placeables.filter(t => {
		const actor = t.actor;
		return actor && actor.type === "Player" && actor.hasPlayerOwner;
	});

	if (playerTokens.length === 0) {
		ui.notifications.warn("No player tokens found on the current scene.");
		return;
	}

	// Build options
	const options = playerTokens.map(t => {
		const ownerName = getTokenOwnerName(t);
		return `<option value="${t.id}" ${t.id === leaderTokenId ? "selected" : ""}>
            ${t.name}${ownerName ? ` (${ownerName})` : ""}
        </option>`;
	}).join("");

	const content = `
        <form>
            <div class="form-group">
                <label>Select Party Leader:</label>
                <select name="leaderId" style="width: 100%;">
                    <option value="">None</option>
                    ${options}
                </select>
            </div>
        </form>
    `;

	new foundry.applications.api.DialogV2({
		window: { title: "Set Party Leader" },
		content,
		buttons: [
			{
				action: "set",
				icon: "fas fa-check",
				label: "Set Leader",
				default: true,
				callback: (event, button) => {
					const leaderId = button.form?.elements?.leaderId?.value;
					setLeader(leaderId || null);
				},
			},
			{
				action: "cancel",
				icon: "fas fa-times",
				label: "Cancel",
			},
		],
	}).render({ force: true });
}

/**
 * Show movement mode configuration dialog
 */
export function showMovementModeDialog() {
	const content = `
        <form>
            <div class="sdx-movement-mode-options">
                <div class="sdx-movement-option ${!marchingModeEnabled ? "selected" : ""}" data-mode="free">
                    <i class="fas fa-person-walking"></i>
                    <div class="sdx-movement-option-content">
                        <h3>Free Movement</h3>
                        <p>All party members can move their tokens at will without limitations. Move wisely.</p>
                    </div>
                </div>
                <div class="sdx-movement-option ${marchingModeEnabled ? "selected" : ""}" data-mode="marching">
                    <i class="fas fa-people-line"></i>
                    <div class="sdx-movement-option-content">
                        <h3>Marching Mode</h3>
                        <p>The party leader moves freely while the remaining party will follow the exact path set by the leader.</p>
                    </div>
                </div>
            </div>
        </form>
    `;

	const dialog = new foundry.applications.api.DialogV2({
		window: { title: "Configure Movement Mode" },
		content,
		classes: ["sdx-movement-mode-dialog"],
		position: { width: 520, height: "auto" },
		buttons: [
			{
				action: "apply",
				icon: "fas fa-check",
				label: "Apply",
				default: true,
				callback: (event, button, dlg) => {
					const selected = dlg.element.querySelector(".sdx-movement-option.selected");
					const selectedMode = selected?.dataset?.mode;
					setMovementMode(selectedMode === "marching");
				},
			},
			{
				action: "close",
				icon: "fas fa-times",
				label: "Close",
			},
		],
	});
	dialog.render({ force: true }).then(() => {
		const options = dialog.element.querySelectorAll(".sdx-movement-option");
		options.forEach(opt => {
			opt.addEventListener("click", () => {
				options.forEach(o => o.classList.remove("selected"));
				opt.classList.add("selected");
			});
		});
	});
}

/**
 * Set the party leader
 */
async function setLeader(tokenId) {
	const oldLeaderId = leaderTokenId;

	// Normalize tokenId (convert empty string to null)
	const newLeaderId = tokenId || null;
	leaderTokenId = newLeaderId;

	// Always remove ALL crowns first (handles refresh case where oldLeaderId
	// is null but crowns persist)
	await removeAllLeaderCrowns();

	// Reset marching state when leader changes
	if (oldLeaderId !== newLeaderId) {
		// Clear the movement path
		leaderMovementPath = [];

		// Clear followers
		tokenFollowers.clear();

		// Cancel any pending movements
		clearScheduledTimeouts();
		processingCongaMovement = false;
		congaMovementPending = false;

		// If marching mode is enabled and we have a new leader, recalculate marching order
		if (marchingModeEnabled && newLeaderId) {
			const newLeaderToken = canvas.tokens.get(newLeaderId);
			if (newLeaderToken) {
				// Small delay to ensure state is settled
				await new Promise(resolve => {
					setTimeout(resolve, 100);
				});
				calculateMarchingOrder(newLeaderToken);
				console.log(`${MODULE_ID} | Recalculated marching order with new leader`);
			}
		}
	}

	// Add crown to new leader if one was selected
	if (newLeaderId) {
		const token = canvas.tokens.get(newLeaderId);
		if (token) {
			await showLeaderCrown(token);
			ui.notifications.info(`Party leader set to: ${token.name}`);
		}
		else {
			ui.notifications.info("Party leader set to: Unknown");
		}
	}
	else {
		ui.notifications.info("Party leader cleared.");
	}

	// Save state
	await saveMarchingState();

	updateButtonStates();
}

/**
 * Set movement mode
 */
async function setMovementMode(enabled) {
	marchingModeEnabled = enabled;

	if (enabled) {
		if (!leaderTokenId) {
			ui.notifications.warn("Please set a party leader first.");
			marchingModeEnabled = false;
			return;
		}
		ui.notifications.info("Marching Mode enabled. Followers will track the leader's path.");
	}
	else {
		ui.notifications.info("Free Movement enabled.");
		leaderMovementPath = [];
		tokenFollowers.clear();
		clearScheduledTimeouts(); // Cancel any pending follower movements
		processingCongaMovement = false;
		congaMovementPending = false;
	}

	// Save state
	await saveMarchingState();

	updateButtonStates();

	// Calculate initial marching order when enabled
	if (enabled && leaderTokenId) {
		const leaderToken = canvas.tokens.get(leaderTokenId);
		if (leaderToken) {
			calculateMarchingOrder(leaderToken);
		}
	}
}

/**
 * Update button states to show active mode
 */
function updateButtonStates() {
	const $leaderBtn = $("#sidebar-tabs .sdx-marching-leader-btn");
	const $modeBtn = $("#sidebar-tabs .sdx-marching-mode-btn");

	// Update leader button
	if (leaderTokenId) {
		$leaderBtn.addClass("active").css("color", "#ffd700");
	}
	else {
		$leaderBtn.removeClass("active").css("color", "");
	}

	// Update mode button
	if (marchingModeEnabled) {
		$modeBtn.addClass("active").css("color", "#4CAF50");
	}
	else {
		$modeBtn.removeClass("active").css("color", "");
	}
}

/**
 * Get the owner name of a token
 */
function getTokenOwnerName(token) {
	if (!token.actor) return null;

	const owners = Object.entries(token.actor.ownership || {})
		.filter(([userId, level]) => level === 3 && userId !== "default")
		.map(([userId]) => game.users.get(userId))
		.filter(user => user && !user.isGM);

	return owners.length > 0 ? owners[0].name : "Gamemaster";
}

/**
 * Predicate: is a combat currently started on the active scene?
 * Combat#started is true once round > 0; a created-but-unstarted tracker
 * (round 0) must not suspend marching. game.combats.active is the active
 * combat for the current canvas scene, unlike game.combat (the viewed
 * tracker encounter).
 *
 * This predicate is deliberately pure — the combat-suspend reset is driven by
 * the combat lifecycle hooks (see handleCombatEpisode), never by incidental
 * calls to this check.
 */
function isCombatStarted() {
	return game.combats?.active?.started === true;
}

/**
 * Reset the marching trail and conga flags when a combat episode begins.
 *
 * When marching suspends, followers freeze in place (the #87 bails stop the
 * conga mid-cycle), so the leftover leaderMovementPath points would otherwise
 * drag them back along the stale pre-combat route once combat ends. Emptying
 * the trail here makes the first post-combat leader move seed a fresh path
 * (see onUpdateToken), and clearing the conga flags guarantees a fresh cycle
 * can start from a clean slate.
 */
function suspendMarchingForCombat() {
	leaderMovementPath = [];
	resetCongaQueue();
	tokenFollowers.forEach(follower => {
		follower.moving = false;
	});
}

/**
 * Combat-episode transition handler (issue #99).
 *
 * Marching must suspend once per combat EPISODE. An episode is identified by
 * the active combat's document id plus the scene id, so a new combat replacing
 * an already-started one (combat A -> combat B with `started` never false) or a
 * scene switch that surfaces a different active combat re-arms the reset even
 * though `.started` never went false in between. The first time an episode's
 * identity is observed the stale pre-combat trail is discarded.
 *
 * @param {object} combat - The Combat document for the episode.
 * @param {boolean} forceStart - combatStart fires before round is applied, so
 * `combat.started` is still false there; treat the event itself as the signal.
 */
function handleCombatEpisode(combat, forceStart = false) {
	if (!combat) return;
	if (!forceStart && !combat.started) return;

	const key = `${combat.id}:${combat.scene?.id ?? ""}`;
	if (key === combatSuspendKey) return;

	combatSuspendKey = key;
	suspendMarchingForCombat();
}

/**
 * Single reset for every way the conga queue can end (issue #98): a rejected
 * follower update, a synchronous throw mid-step, the leader vanishing, or
 * combat bailing the cycle. Clearing both flags is what guarantees the next
 * leader move starts a fresh conga instead of short-circuiting at the
 * "already processing" guard. The normal-completion path does NOT use this —
 * it preserves pending waypoints and consumes them by re-triggering.
 *
 * Module-scope so the combat-suspend reset (issue #99) can reuse the same two
 * flag assignments instead of duplicating them.
 */
function resetCongaQueue() {
	processingCongaMovement = false;
	congaMovementPending = false;
}

/**
 * Hook: Before token update
 */
function onPreUpdateToken(tokenDoc, changes, options, userId) {
	// Skip if no position change (use === undefined so a move to x/y === 0 still counts)
	if (changes.x === undefined && changes.y === undefined) return true;

	// During started combat, let any token move freely — no marching blocking.
	if (isCombatStarted()) return true;

	if (!marchingModeEnabled) return true;
	if (!leaderTokenId) return true;

	// Allow GM to move any token
	if (game.user.isGM) return true;

	// The party leader moves freely; the GM client records the path and drives the
	// followers via processCongaMovement (see onUpdateToken).
	if (tokenDoc.id === leaderTokenId) return true;

	// Followers move automatically — block manual movement of any other token.
	ui.notifications.warn("In Marching Mode, only the leader can move. Other tokens follow automatically.");
	return false;
}

/**
 * Hook: After token update (record path and move followers)
 */
async function onUpdateToken(tokenDoc, changes, options, userId) {
	if (changes.x === undefined && changes.y === undefined) return;

	// During started combat, no path recording and no conga — followers act independently.
	if (isCombatStarted()) return;

	if (!marchingModeEnabled) return;
	if (!leaderTokenId) return;

	// Only process on GM client
	if (!game.user.isGM) return;

	const token = canvas.tokens.get(tokenDoc.id);
	if (!token) return;

	// Check if this is automated movement
	if (options.congaMovement || processingCongaMovement) {
		return;
	}

	// Check if this is the leader moving
	if (tokenDoc.id === leaderTokenId) {
		// Don't cancel pending follower movements — let in-progress conga movements finish.
		// New path points are prepended, so the next processing cycle will pick them up.

		// Record the leader's movement path
		const startPosition = {
			x: tokenDoc._source.x,
			y: tokenDoc._source.y,
			gridPos: getGridPositionKey(tokenDoc._source.x, tokenDoc._source.y),
		};

		const endPosition = {
			x: tokenDoc.x,
			y: tokenDoc.y,
			gridPos: getGridPositionKey(tokenDoc.x, tokenDoc.y),
		};

		// Add starting position if path is empty
		if (leaderMovementPath.length === 0) {
			leaderMovementPath.push(startPosition);
		}

		// Create path points from start to end
		const newPoints = createPathPoints(startPosition, endPosition);

		// Add points to the beginning of the path
		leaderMovementPath.unshift(...newPoints);

		// If no followers yet, calculate initial marching order
		if (tokenFollowers.size === 0) {
			calculateMarchingOrder(token);
		}

		// Process follower movement after a short delay using tracked timeout
		scheduleTimeout(() => {
			if (leaderMovementPath.length >= 2) {
				processCongaMovement();
			}
		}, 100);
	}
	else {
		// Non-leader token was moved manually - recalculate marching order to include it
		// This allows new tokens to join the formation by being positioned near the group
		const leaderToken = canvas.tokens.get(leaderTokenId);
		if (leaderToken) {
			// Clear the path when manually reordering
			leaderMovementPath = [];
			calculateMarchingOrder(leaderToken);
			console.log(`${MODULE_ID} | Recalculated marching order after ${token.name} was repositioned`);
		}
	}
}

/**
 * Calculate the grid position for a token
 */
function getGridPositionKey(x, y) {
	const gridSize = canvas.grid.size;
	const gridX = Math.round(x / gridSize) * gridSize;
	const gridY = Math.round(y / gridSize) * gridSize;
	return `${gridX},${gridY}`;
}

/**
 * Create path points between two positions
 */
function createPathPoints(startPos, endPos) {
	const gridSize = canvas.grid.size;
	const dx = endPos.x - startPos.x;
	const dy = endPos.y - startPos.y;
	const distance = Math.max(Math.abs(dx), Math.abs(dy));
	const steps = Math.max(Math.floor(distance / gridSize), 1);

	const result = [];
	for (let i = 1; i <= steps; i++) {
		const x = startPos.x + (dx * i / steps);
		const y = startPos.y + (dy * i / steps);
		const gridPos = getGridPositionKey(x, y);

		// Don't add duplicate positions
		if (result.length > 0 && result[result.length - 1].gridPos === gridPos) {
			continue;
		}

		result.push({ x, y, gridPos });
	}

	return result;
}

/**
 * Calculate the marching order based on proximity to leader
 */
function calculateMarchingOrder(leaderToken) {
	tokenFollowers.clear();

	// Find all player-owned tokens except the leader
	const followerTokens = canvas.tokens.placeables.filter(t =>
		t.id !== leaderToken.id
        && t.actor
        && t.actor.type === "Player"
        && t.actor.hasPlayerOwner
	);

	// Sort by distance from leader
	const sortedFollowers = followerTokens.map(token => {
		const distance = Math.sqrt(
			Math.pow(token.x - leaderToken.x, 2)
            + Math.pow(token.y - leaderToken.y, 2)
		);
		return { token, distance };
	}).sort((a, b) => a.distance - b.distance);

	// Assign marching positions
	sortedFollowers.forEach(({ token }, index) => {
		tokenFollowers.set(token.id, {
			marchPosition: index,
			moving: false,
		});
	});
}

/**
 * Process conga movement - tokens follow leader's exact path
 */
function processCongaMovement() {
	// Safety check
	if (leaderMovementPath.length < 2) return;
	if (tokenFollowers.size === 0) return;

	// Don't start a new queue while combat is running — the hook guards stop
	// path recording, so there is nothing new to process here.
	if (isCombatStarted()) return;

	// If already processing, signal that new path points need processing after current cycle
	if (processingCongaMovement) {
		congaMovementPending = true;
		console.log(`${MODULE_ID} | Conga movement already processing - flagged as pending`);
		return;
	}

	// Set processing flag
	processingCongaMovement = true;

	// Setup state is function-scoped so the step closure below can read it,
	// while the assignments themselves run inside the guarded setup try.
	let leaderToken = null;
	let sortedFollowers = [];
	let followerStates = [];

	// Move all tokens one step at a time.
	//
	// INNER guard: the whole step body runs inside a try/catch. A synchronous
	// throw (a torn-down token, an update() that throws before it returns a
	// promise) escapes any promise .catch entirely — it would leave
	// processingCongaMovement set forever and wedge the conga. This guard covers
	// the DISPATCH and every SCHEDULED step: the recursion runs on a later timer
	// tick, long after the outer guard around the setup below has exited, so
	// only this inner try can catch a throw there. Do not merge the two guards —
	// each covers a different call stack.
	function moveAllTokensOneStep() {
		try {
			if (!game.user.isGM) {
				resetCongaQueue();
				return;
			}

			// Combat started mid-cycle: stop the running queue at this step boundary.
			// Reset the flags so a fresh cycle can start once marching resumes.
			if (isCombatStarted()) {
				resetCongaQueue();
				return;
			}

			// Check if all tokens have reached their targets
			const allDone = followerStates.every(f => f.currentIndex <= f.targetIndex);
			if (allDone) {
				// Trim the path
				const highestIndex = Math.max(...followerStates.map(f => f.targetIndex));
				if (highestIndex < leaderMovementPath.length - 1) {
					leaderMovementPath = leaderMovementPath.slice(0, highestIndex + 1);
				}
				processingCongaMovement = false;

				// If new path points were added during processing, re-trigger
				if (congaMovementPending) {
					congaMovementPending = false;
					console.log(`${MODULE_ID} | Re-triggering conga movement for pending waypoints`);
					processCongaMovement();
				}
				return;
			}

			// Check if this is first-turn movement
			const isFirstTurn = followerStates.some(f => !f.isOnPath);

			// Move each token that hasn't reached its target yet
			const promises = followerStates.map((follower, index) => {
				// Skip if token has reached its target
				if (follower.currentIndex <= follower.targetIndex) {
					return Promise.resolve();
				}

				// For first turn, only move if previous tokens are on path
				if (isFirstTurn) {
					const previousTokensOnPath = followerStates
						.slice(0, index)
						.every(f => f.isOnPath || f.currentIndex <= f.targetIndex);

					if (!previousTokensOnPath) {
						return Promise.resolve();
					}
				}

				const position = leaderMovementPath[follower.currentIndex - 1];

				return follower.token.document.update({
					x: position.x,
					y: position.y,
				}, { congaMovement: true }).then(() => {
					follower.currentIndex--;
					if (!follower.isOnPath && follower.currentIndex < leaderMovementPath.length - 1) {
						follower.isOnPath = true;
					}
				});
			});

			// After all tokens have moved one step, wait then move again
			Promise.all(promises)
				.then(() => {
					// Combat may have started while the step's updates were in flight —
					// don't re-schedule another step; the queue stops here.
					if (isCombatStarted()) {
						resetCongaQueue();
						return;
					}
					scheduleTimeout(() => {
						moveAllTokensOneStep();
					}, 100);
				})
				.catch(error => {
					// A follower update rejected mid-step (e.g. the follower token was
					// deleted or lost ownership mid-drag). Never wedge the queue: the
					// normal completion reset never runs on this path, so reset here.
					//
					// Pending waypoints are intentionally DROPPED on the failure path
					// rather than re-triggered: a persistent failure (deleted follower,
					// lost ownership) would otherwise reject, retry, reject ... every
					// 100 ms. The stranded state is self-healing — the next leader move
					// restarts the queue from clean flags.
					resetCongaQueue();
					console.warn(`${MODULE_ID} | Conga step failed; queue state reset:`, error);
				});
		}
		catch(error) {
			// Synchronous failure while dispatching the step (torn-down token,
			// update() throwing before it returns a promise). Reset the flags and
			// log; do not rethrow — the queue stops here and the next leader move
			// starts a fresh one.
			resetCongaQueue();
			console.warn(`${MODULE_ID} | Conga step failed synchronously; queue state reset:`, error);
		}
	}

	// OUTER guard: the SETUP region plus the initial synchronous step call.
	// processingCongaMovement is set above, and everything in this try runs on
	// the same synchronous stack before moveAllTokensOneStep's inner try exists
	// to catch it — canvas.tokens.get(...), the marchPosition sort comparator,
	// and the token.x/token.y coordinate getters are exactly the accessors that
	// throw on a destroyed/torn-down token. A throw here would otherwise die as
	// an uncaught exception with the flag still set. This guard covers ONLY the
	// synchronous stack; the inner guard inside covers every scheduled step on a
	// later tick. Do not merge the two.
	try {
		// Get the leader token
		leaderToken = canvas.tokens.get(leaderTokenId);
		if (!leaderToken) {
			resetCongaQueue();
			return;
		}

		// Get sorted followers
		sortedFollowers = Array.from(tokenFollowers.entries())
			.sort((a, b) => a[1].marchPosition - b[1].marchPosition);

		// Store followers' current positions and target indices
		followerStates = sortedFollowers.map(([tokenId, state]) => {
			const token = canvas.tokens.get(tokenId);
			if (!token) return null;

			// Find where in the path the token currently is
			let currentIndex = leaderMovementPath.length - 1;
			let isOnPath = false;

			for (let i = 0; i < leaderMovementPath.length; i++) {
				const pathPoint = leaderMovementPath[i];
				if (Math.abs(pathPoint.x - token.x) < 1 && Math.abs(pathPoint.y - token.y) < 1) {
					currentIndex = i;
					isOnPath = true;
					break;
				}
			}

			return {
				token,
				currentIndex,
				targetIndex: state.marchPosition,
				state,
				isOnPath,
			};
		}).filter(f => f !== null);

		// Start the movement
		moveAllTokensOneStep();
	}
	catch(error) {
		// A synchronous throw while setting up the queue (torn-down token,
		// destroyed document, a stale marchPosition entry). Reset the flags and
		// log; do not rethrow — the queue never started and the next leader move
		// tries again from clean flags.
		resetCongaQueue();
		console.warn(`${MODULE_ID} | Conga setup failed; queue state reset:`, error);
	}
}

/**
 * Get the effect name for a token's leader crown
 */
function getLeaderCrownEffectName(token) {
	return `${MODULE_ID}-leader-crown-${token.id}`;
}

/**
 * Show the leader crown on a token
 */
async function showLeaderCrown(token) {
	// Check if Sequencer is available
	if (typeof Sequencer === "undefined") {
		console.warn(`${MODULE_ID} | Sequencer module required for leader crown visualization`);
		return;
	}

	const effectName = getLeaderCrownEffectName(token);

	// End any existing crown for this token
	await Sequencer.EffectManager.endEffects({ name: effectName, object: token });

	// Get token dimensions for positioning
	const tokenWidth = token.document.width;

	console.log(`${MODULE_ID} | Showing leader crown for ${token.name}`);

	// Build the crown effect sequence
	const seq = new Sequence();

	seq.effect()
		.name(effectName)
		.file("modules/shadowdark-extras/assets/crown.svg") // Foundry built-in crown icon
		.atLocation(token)
		.attachTo(token, { bindRotation: false, local: true, bindVisibility: true })
		.scaleToObject(0.35, { considerTokenScale: true })
		.scaleIn(0, 300, { ease: "easeOutBack" })
		.spriteOffset({
			x: 0,  // Top-center
			y: -tokenWidth * 0.45,
		}, { gridUnits: true })
		.filter("Glow", {
			distance: 8,
			outerStrength: 3,
			innerStrength: 1,
			color: 0xFFD700, // Gold glow
			quality: 0.2,
			knockout: false,
		})
		.loopProperty("sprite", "position.y", {
			from: 0,
			to: -0.03 * tokenWidth,
			duration: 800,
			ease: "easeInOutSine",
			pingPong: true,
			gridUnits: true,
		})
		.persist()
		.aboveLighting()
		.zIndex(10);

	await seq.play();
	console.log(`${MODULE_ID} | Leader crown displayed for ${token.name}`);
}

/**
 * Remove all leader crowns from all tokens
 */
async function removeAllLeaderCrowns() {
	if (typeof Sequencer === "undefined") return;

	// Get all tokens on the canvas
	const allTokens = canvas.tokens.placeables;

	// Remove crown from each token
	const promises = allTokens.map(token => {
		const effectName = getLeaderCrownEffectName(token);
		return Sequencer.EffectManager.endEffects({ name: effectName, object: token });
	});

	await Promise.all(promises);
	console.log(`${MODULE_ID} | Removed all leader crowns`);
}

/**
 * Hook: canvas ready — restore the leader crown, then re-key the combat-suspend
 * identity. A scene change can surface a different active combat (or none): if
 * one is already started on the new scene, its episode is handled now; otherwise
 * the latch is cleared so the next started combat on this scene re-arms (issue
 * #99, scene-change family).
 */
function onCanvasReady() {
	restoreLeaderCrown();

	const active = game.combats?.active;
	if (active?.started) handleCombatEpisode(active);
	else combatSuspendKey = null;
}

/**
 * Restore leader crown on canvas ready
 */
async function restoreLeaderCrown() {
	if (typeof Sequencer === "undefined") return;

	// Small delay to ensure canvas is ready
	await new Promise(resolve => {
		setTimeout(resolve, 500);
	});

	// First, clean up any stale crowns that may have persisted from before refresh
	await removeAllLeaderCrowns();

	// Only restore if we have a leader
	if (leaderTokenId) {
		const leaderToken = canvas.tokens.get(leaderTokenId);
		if (leaderToken) {
			await showLeaderCrown(leaderToken);
		}
	}
}

/**
 * Get current marching mode state
 */
export function getMarchingModeState() {
	return {
		enabled: marchingModeEnabled,
		leaderId: leaderTokenId,
	};
}
