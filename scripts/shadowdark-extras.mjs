// v13+ FilePicker namespaced under foundry.applications.apps.
const FilePicker = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;

/**
 * Shadowdark Extras — the composition root.
 *
 * Adds Renown tracking, additional light sources, NPC inventory, and Party
 * management to Shadowdark RPG.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS, AND WHY WHAT IS LEFT IS STILL HERE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This module started the structural track at 21,861 lines holding most of
 * SDX's implementation. It is now composition: it imports feature modules,
 * calls their register functions in a fixed order, builds the public
 * `module.api`, and carries the compatibility shims that have nowhere else to
 * live. Everything else moved out, one verified unit at a time, and every
 * module is mapped to a feature owner in `dev/tools/feature-ownership.mjs`.
 *
 * If you are looking for a FEATURE, it is not here — find its owner in the
 * ownership map or the cross-feature import matrix.
 *
 * THE ONE RULE THAT GOVERNS EDITS HERE. Hook order is observable behaviour,
 * and it is fixed by the POSITION OF THE REGISTER CALL, not by where the
 * callback is defined. `registerFoo()` installs its hooks when it is called.
 * Moving a call up or down this file reorders real behaviour even though
 * nothing else changes, and `dev/snapshots/registrations.json` will block the
 * commit. Add new registrations at the end of their phase, not wherever is
 * convenient.
 *
 * WHAT REMAINS, AND WHY EACH KIND STAYS — this is the step-39 acceptance
 * criterion, written down so a stranger does not have to infer it:
 *
 *   - ~36 bare `registerX()` / `initX()` calls. Ordered composition. This is
 *     the intended end state, not leftovers.
 *
 *   - Three compatibility re-exports from the original declared esmodule
 *     surface. Internal consumers import from the owning feature modules, so
 *     these preserve external callers without recreating a feature→root edge.
 *
 *   - The `Hooks.on("setup")` block that builds `module.api`. Public API
 *     construction belongs to the root by definition: it is the only place
 *     that legitimately knows every feature.
 *
 *   - The sheet dispatchers (`renderPlayerSheetSD`, the two
 *     `renderNpcSheetSD`, `renderActorSheet`, `renderItemSheet`). These are
 *     ordered call lists behind a type guard — `renderPlayerSheetSD` is 21
 *     imported calls in 22 lines of code. Pushing one into a feature module
 *     would make that feature own five other features' render order, which is
 *     the dependency inversion this whole track existed to remove.
 *
 *   - The `init` blocks: CONFIG wiring, document/sheet class registration,
 *     fonts, keybindings. Bootstrap, not feature logic.
 *
 *   - The six `registerXSheet()` functions. Each is a
 *     `documents.collections.*.registerSheet(...)` call plus its label; the
 *     Party one additionally patches `_getSheetClass`. Sheet registration is
 *     composition, and splitting six four-line functions across five folders
 *     would cost clarity and buy nothing.
 *
 *   - The `ready` migration block. Three ordered one-time migrations, whose
 *     implementations live with the flags they write. Their error handling is
 *     UNEVEN, which is worth knowing before editing: the webp path rewrite is
 *     wrapped in try/catch and the compendium sweep carries its own `.catch`,
 *     so neither can abort world load. `migrateLegacyItemMacros()` is awaited
 *     bare, so a throw there surfaces as an unhandled rejection. Since
 *     Phase 5.2.7 (issue #49) the itemacro sweep is idempotent and ungated —
 *     it runs on every load and retries naturally — so the failure recovery
 *     described here is now inherent to the sweep rather than tied to a
 *     one-shot flag (which no longer exists). Whether the bare await was
 *     intended or is simply older code is not recorded anywhere, so it is
 *     described here rather than "fixed" on a guess.
 *
 * The measure used to decide each block was mechanical rather than aesthetic:
 * bare calls to imported helpers versus everything else. Blocks scoring near
 * zero dispatch were prototype surgery spelled as hooks and left; blocks
 * scoring high were dispatch and stayed. The borderline cases are argued in
 * their commit messages.
 */

import PartySheetSD, { syncPartyTokenLight, getPartiesContainingActor, registerPartyTravelSocket, registerPartySheetRerenderHooks, isPartyActor, registerPartyCleanupHooks } from "./party/PartySheetSD.mjs";
import { initCarouselDrag } from "./canvas/carousel-drag.mjs";
import { extendActorCreationDialog, wrapActorCreate } from "./party/party-creation.mjs";
import { initializeTradeSocket, ensureTradeJournal } from "./inventory/TradeWindowSD.mjs";
import { setupCombatSocket, setupScrollingCombatText } from "./combat/CombatSettingsSD.mjs";
import { registerCrawlHelperDeathTimer } from "./combat/crawl-helper-death-timer.mjs";
import { patchArmorActiveEffects } from "./effects/ArmorAEPatchSD.mjs";
import { enhanceSpellSheet, injectSpellAlignmentField } from "./item-sheets/spell-sheet-enhance.mjs";
import { enhancePotionSheet } from "./item-sheets/potion-sheet-enhance.mjs";
import { enhanceScrollSheet } from "./item-sheets/scroll-sheet-enhance.mjs";
import { enhanceWandSheet } from "./item-sheets/wand-sheet-enhance.mjs";
import {
	injectWeaponBonusTab,
	injectWeaponAnimationButton,
	injectWeaponDamageTypeDropdown,
} from "./combat/WeaponBonusConfig.mjs";
import { setupRollAttackPatches, setupRollConfigPatches } from "./combat/roll-patches.mjs";
import { registerFreyasOmenHooks } from "./combat/freyas-omen.mjs";
import { registerChatCardHooks } from "./combat/chat-card-hooks.mjs";

import { initAutoAnimationsIntegration } from "./animation/AutoAnimationsSD.mjs";
import { AnimationFxSD } from "./animation/AnimationFxSD.mjs";
import { registerAnimationFxMenu } from "./animation/AnimationFxListApp.mjs";
import { initTorchAnimations } from "./animation/TorchAnimationSD.mjs";
import { initWeaponAnimations } from "./animation/WeaponAnimationSD.mjs";
import { initLevelUpAnimations } from "./animation/LevelUpAnimationSD.mjs";
import { initFocusSpellTracker, startDurationSpell, endDurationSpell, registerSpellModification, getActiveDurationSpells } from "./effects/FocusSpellTrackerSD.mjs";
import { initBreakOnDamage, breakEffectOnDamage, clearBreakOnDamage, applySpellEffect } from "./effects/BreakOnDamageSD.mjs";
import { injectCarousingButton, ensureCarousingJournal, ensureCarousingTablesJournal, initCarousingSocket, migrateLegacyRenown } from "./party/carousing/CarousingSD.mjs";
import { migrateWebpAssetPaths, sweepWorldCompendiums } from "./shared/WebpMigrationSD.mjs";
import { openCarousingOverlay, refreshCarousingOverlay } from "./party/carousing/CarousingOverlaySD.mjs";
import { initTemplateEffects } from "./effects/TemplateEffectsSD.mjs";
import { initAuraEffects } from "./effects/AuraEffectsSD.mjs";
import { registerDisplayNpcEnricher } from "./journal/DisplayNpc.mjs";
import { registerDisplayTableEnricher } from "./journal/DisplayTable.mjs";
import { registerDisplayItemEnricher } from "./journal/DisplayItem.mjs";
import { initEasyReferenceMenu } from "./journal/easy-reference/EasyReferenceMenu.mjs";
import { getEffectiveCreatureType, getMappedType } from "./npc/CreatureTypesApp.mjs";
import PotionSheetSD from "./item-sheets/PotionSheetSD.mjs";
import BackgroundSheetSD from "./character-sheet/BackgroundSheetSD.mjs";
import NPCAttackSheetSD from "./npc/NPCAttackSheetSD.mjs";
import NPCSpecialAttackSheetSD from "./npc/NPCSpecialAttackSheetSD.mjs";
import { initPlaceableNotes } from "./journal/PlaceableNotesSD.mjs";
import NPCFeatureSheetSD from "./npc/NPCFeatureSheetSD.mjs";
import ClassAbilitySheetSD from "./item-sheets/ClassAbilitySheetSD.mjs";
import { initTokenToolbar } from "./canvas/TokenToolbarSD.mjs";
import { initTray } from "./tray/TraySD.mjs";
import { initAppearanceSettings } from "./character-sheet/AppearanceSettingsSD.mjs";
import { injectStaffSpellButton, injectStaffSpellsUI, injectWeaponSpellRechargeButtons, patchCanUseMagicItems, registerStaffSpellHooks } from "./item-sheets/staff-spells.mjs";
import { initJournalNarration } from "./journal/JournalNarrationSD.mjs";
import { initMedkit, registerMedkitPack, unregisterMedkitPack, getMedkitPacks, scanWorldForUpdates, applyWorldMedkitUpdates, medkitScanWorld } from "./combat/MedkitSD.mjs";
import { initLightTrackerApp } from "./canvas/LightTrackerAppSD.mjs";
import { initMarchingMode } from "./combat/MarchingModeSD.mjs";
import { SceneExporter } from "./scene/SceneExporter.mjs";
import { SceneImporter } from "./scene/SceneImporter.mjs";
import { initJournalPins } from "./journal/JournalPinsSD.mjs";
import { registerJournalUIHooks } from "./journal/journal-ui.mjs";
import SheetLockManager from "./character-sheet/SheetLockManager.mjs";
import { enhanceInventoryTab, attachNativeHpQuickControls } from "./character-sheet/enhanced-inventory-tab.mjs";
import { enhanceGemSheet, enhanceGemBag, enhanceGemInventory } from "./inventory/gem-enhancements.mjs";
import { injectSkillsBox } from "./character-sheet/skills-box.mjs";
import { applySheetDecorationStyles } from "./character-sheet/sheet-decoration.mjs";
import { injectJournalNotes } from "./character-sheet/journal-notes.mjs";
import { applyInventoryStylesToSheet } from "./inventory/inventory-styles.mjs";
import { enhanceInventoryWithDeleteAndMultiSelect } from "./inventory/inventory-multi-select.mjs";
import { enhanceSpellsTab } from "./character-sheet/enhanced-spells-tab.mjs";
import { getConditionsData, injectConditionsToggles, showConditionsModal } from "./character-sheet/conditions.mjs";
import { registerBackgroundAdvancementHooks } from "./character-sheet/background-advancement.mjs";
import "./item-macros/SpellMacrosSD.mjs";
import { initMysteriousCasting } from "./npc/MysteriousCasting.mjs";
import { TomSD } from "./tom/TomSD.mjs";
import { WallContextMenuSD } from "./canvas/WallContextMenuSD.mjs";
import { sdxDrawingTool } from "./canvas/SDXDrawingTool.mjs";
import { sdxDrawingToolbar } from "./canvas/SDXDrawingToolbar.mjs";
import { SDXRollerApp } from "./tray/SDXRollerApp.mjs";
import { registerAppV2HeaderBridge } from "./shared/appv2-header-bridge.mjs";
import { initSDXCoords } from "./hex/SDXCoordsSD.mjs";
import { initHexTooltip } from "./hex/HexTooltipSD.mjs";
import { initHexFog } from "./hex/SDXHexFogSD.mjs";
import { registerMaphubHooks } from "./MaphubSD.mjs";
import { initUnidentifiedGMDisplay } from "./inventory/UnidentifiedDisplaySD.mjs";
import { initTemplateElevationBadge } from "./effects/TemplateElevationBadgeSD.mjs";
import { registerInvisibilityHooks } from "./effects/invisibility.mjs";
import { initMacroExecuteSocket } from "./item-macros/macro-socket.mjs";
import { registerItemMacroSocket, migrateLegacyItemMacros } from "./item-macros/item-macro-engine.mjs";
import { registerClassAbilityItemMacros } from "./item-macros/class-ability-macros.mjs";
import { registerTemplateTargetSyncSocket } from "./api/template-target-sync.mjs";
import { registerTemplatesApi } from "./api/templates.mjs";
import { registerSpellItemMacroSocket } from "./item-macros/spell-item-macros.mjs";
import { registerNPCFeatureItemMacros } from "./item-macros/npc-feature-macros.mjs";
import { registerChatDispatch } from "./item-macros/chat-dispatch.mjs";
import { registerEffectTriggerHooks, registerEffectMacroSocket } from "./item-macros/effect-trigger-macros.mjs";
import { registerActiveEffectConfigHooks } from "./effects/effect-config.mjs";
import { registerSourceRequirementHooks } from "./effects/source-requirements.mjs";
import { setupWandUsesBlocker, setupSilencedCastingBlocker } from "./effects/casting-blockers.mjs";
import { registerPredefinedEffects } from "./effects/predefined-effects.mjs";
import { registerContainerHooks, patchGetPhysicalItemsForContainers, injectBasicContainerUI, attachContainerContentsToActorSheet, enableItemChatIcon } from "./inventory/containers.mjs";
import { isUnidentified } from "./shared/sd4Compat.mjs";
import { initUnidentifiedSheetContext } from "./inventory/UnidentifiedDisplaySD.mjs";
import { registerItemCreateFlagPreservation, registerSpellItemFlagPreservation } from "./items/item-flag-preservation.mjs";
import { patchPlayerSheetForTransfers } from "./inventory/player-transfers.mjs";
import { enhanceDetailsTab, enhanceAbilitiesTab, enhanceTalentsTab, enhanceEffectsTab } from "./character-sheet/enhanced-tabs.mjs";
import { patchCharacterGeneratorRolls } from "./character-sheet/character-generator.mjs";
import { patchHexTilePositionClamp } from "./hex/hex-tile-clamp.mjs";
import { patchLightSourceTrackerForParty } from "./party/party-light-tracker.mjs";
import { patchPlayerSheetUseAbility } from "./character-sheet/player-sheet-patches.mjs";
import { injectAmmunitionBonuses, registerAmmunitionPatches } from "./inventory/ammunition-bonuses.mjs";
import { injectSpellbookCompendiumFilter, initAlignmentSpellFiltering } from "./character-sheet/spellbook-filter.mjs";
import { injectEnhancedHeader, injectHeaderCustomization, injectPartyHeaderCustomization, injectAddCoinsButton, injectTradeButton } from "./character-sheet/enhanced-header.mjs";
import { extendLightSources, patchLightSourceMappings } from "./canvas/light-templates.mjs";
import { patchCtrlMoveOnActorSheetDrops } from "./inventory/default-move-drops.mjs";
import { injectNpcCreatureType, injectNpcInventoryTab, patchNpcSheetForItemDrops, applyNpcPlayerTheme } from "./npc/npc-sheet-inventory.mjs";
import { registerNpcDisplayPatches } from "./npc/npc-display-patches.mjs";
import { initItemPilesCompatibility } from "./inventory/ItemPilesCompatSD.mjs";
// Map-builder entry points — pulled in so we can expose them on module.api
// for MCP / external automation. None of these modules register hooks at import
// time (verified), so this only adds the named exports to the bundle graph.
import { generateDungeon, getGeneratorSettings, setGeneratorSettings, generateRandomSeed, generateLayout, generateMixedLayout } from "./dungeon/DungeonGeneratorSD.mjs";
import { buildHexDungeonScene } from "./hex/HexDungeonBridgeSD.mjs";
import { generateCaveLayout, buildCaveLoops, traceBoundaryLoops } from "./dungeon/DungeonCaveSD.mjs";
import { assignBiomes, buildCellFloorMap, getBiomeDefs, getCustomBiomes, setCustomBiome, removeCustomBiome, resetCustomBiomes, getEnabledBiomeKeys, getDisabledBiomes, setBiomeEnabled } from "./dungeon/DungeonBiomesSD.mjs";
import { openBiomeEditor } from "./dungeon/BiomeEditorSD.mjs";
import { generateHexMap, clearGeneratedTiles } from "./hex/HexGeneratorSD.mjs";
import { buildHexcrawl, buildHexcrawlFromFile } from "./hex/HexcrawlBuilderSD.mjs";
import { getSceneLevelContext, applySceneLevelData, getDungeonBackground } from "./dungeon/DungeonPainterSD.mjs";
import { placeChangeLevelRegion, placeDungeonSurface, placeDungeonDecor } from "./dungeon/DungeonRegionsSD.mjs";
import { registerSettings, setupSettingsOrganization } from "./settings/module-settings.mjs";

// Backward-compatible declared-esmodule surface. These names were public before
// the reorganization; internal feature modules import from their owners instead.
export { getCustomLightSources } from "./canvas/light-templates.mjs";
export { executeItemMacro, hasItemMacro } from "./item-macros/item-macro-engine.mjs";

const MODULE_ID = "shadowdark-extras";

// ============================================
// JOURNAL NARRATION INITIALIZATION
// ============================================
initJournalNarration();
initMedkit();
initJournalPins();
initSDXCoords();
initHexTooltip();
initHexFog();
registerMaphubHooks();
initUnidentifiedGMDisplay();
initTemplateElevationBadge();
// patchHexTilePositionClamp moved to hex/hex-tile-clamp.mjs

Hooks.once("init", () => {
	// Register GSAP Plugins (GSAP is loaded by Foundry core)
	try {
		if (typeof gsap !== "undefined" && typeof PixiPlugin !== "undefined") {
			gsap.registerPlugin(PixiPlugin);
			console.log("Shadowdark Extras | Registered GSAP PixiPlugin");
		}
	}
	catch(err) {
		console.error("Shadowdark Extras | Failed to register GSAP PixiPlugin:", err);
	}

	// Backport Shadowdark 4.0 fix: suppress AEs from stashed / unequipped / unidentified items
	patchArmorActiveEffects();
	initItemPilesCompatibility();

	// Allow SDX-painted hex tiles to keep their true position at the scene's
	// left/top edge instead of being clamped inward (fixes first-column / top-row
	// hex misalignment). See patchHexTilePositionClamp for the full rationale.
	patchHexTilePositionClamp();

	// Fix system's removeTorchTimer error when chat messages don't have .light-source element
	// The system hook at hooks.mjs:168 calls html.querySelector(".light-source").remove() without null checking
	// Instead of a global monkeypatch, we inject a hidden dummy element during message rendering if it's missing.
	Hooks.on("renderChatMessageHTML", (message, html, context) => {
		const element = html instanceof HTMLElement ? html : html[0];
		if (element && !element.querySelector(".light-source")) {
			const dummy = document.createElement("div");
			dummy.className = "light-source sdx-dummy-light-source";
			dummy.style.display = "none";
			element.appendChild(dummy);
		}
	});

	// Monkeypatch: Fix system's targeting.mjs error - game.user.updateTokenTargets doesn't exist in modern Foundry
	// The system hook at targeting.mjs:11 calls game.user.updateTokenTargets([token.id]) which is deprecated/removed
	// We add a polyfill that implements the expected behavior
	// ALSO: The system restricts players to 1 target, which breaks template spells. We add a bypass flag.
	Hooks.once("ready", () => {
		// Add a bypass flag for template targeting to allow multi-targeting for players
		game.shadowdarkExtras = game.shadowdarkExtras || {};
		game.shadowdarkExtras.allowMultiTarget = false;

		// Initialize Drawing Tools
		game.shadowdarkExtras.drawingTool = sdxDrawingTool;
		game.shadowdarkExtras.drawingToolbar = sdxDrawingToolbar;
		sdxDrawingTool.initialize();

		// Initialize Light Tracker AppV2
		initLightTrackerApp();

		if (typeof game.user.updateTokenTargets !== "function") {
			game.user.updateTokenTargets = function(tokenIds = []) {
				// If the bypass flag is set, don't restrict targeting
				if (game.shadowdarkExtras?.allowMultiTarget) {
					return;
				}
				// Clear current targets and set new ones
				const tokens = tokenIds.map(id => canvas.tokens.get(id)).filter(t => t);
				canvas.tokens.targetObjects(Object.fromEntries(tokens.map(t => [t.id, true])), { releaseOthers: true });
			};
			console.log("Shadowdark Extras | Added polyfill for game.user.updateTokenTargets");
		}
	});

	initMysteriousCasting();
	SheetLockManager.init();
	TomSD.initialize();
	WallContextMenuSD.initialize();

	// Register Custom Fonts
	const SDX_FONTS = [
		"ACaslonPro-Bold", "ArabDances", "BaksoSapi", "BalletHarmony", "Cardinal", "CaslonAntique-Bold",
		"Cathallina", "ChildWriting-Regular", "Comic-ink", "DREAMERS-BRUSH", "DSnet_Stamped", "DUNGRG",
		"DancingVampyrish", "Dreamy-Land-Medium", "FairProsper", "Fast-In-My-Car", "FuturaHandwritten",
		"GODOFWAR", "Galactico-Basic", "Ghost-theory-2", "GhostChase", "Good-Brush", "Hamish", "Headache",
		"Hiroshio", "HoneyScript-SemiBold", "IronSans", "JIANGKRIK", "LPEducational", "LUMOS", "Lemon-Tuesday",
		"LinLibertine_RB", "Luna", "MLTWNII_", "Magiera_Script", "OldLondon", "Paul-Signature",
		"RifficFree-Bold", "Rooters", "STAMPACT", "SUBSCRIBER-Regular", "Signika-Bold",
		"Suplexmentary_Comic_NC", "Syemox-italic", "Times-New-Romance", "TrashHand", "Valentino",
		"VarsityTeam-Bold", "WEST", "YIKES!", "YOZAKURA-Regular", "Younger-than-me", "alamain1",
		"breakaway", "bwptype", "codex", "college", "ethnocentric-rg", "exmouth_", "fewriter_memesbruh03",
		"fontopoSUBWAY-Regular", "fontopoSunnyDay-Regular", "glashou", "go3v2", "happyfrushzero",
		"himagsikan", "kindergarten", "kirsty-rg", "makayla", "oko", "shoplift", "stereofidelic",
		"stonehen", "times_new_yorker", "venus-rising-rg",
	];

	if (CONFIG.fontFamilies instanceof Set) {
		for (const font of SDX_FONTS) CONFIG.fontFamilies.add(font);
	}
	else {
		CONFIG.fontFamilies = [...new Set([...(CONFIG.fontFamilies || []), ...SDX_FONTS])];
	}

	if (window.FontsLoader) {
		window.FontsLoader.load({
			custom: {
				families: SDX_FONTS,
				urls: ["modules/shadowdark-extras/styles/fonts.css"],
			},
		});
	}
});


// ============================================
// UNIDENTIFIED ITEMS — thin wrappers to SD 4.x native identification
// ============================================


// ============================================
// BASIC ITEM CONTAINERS (non-invasive)
// ============================================
// Moved to inventory/containers.mjs, which already held the slot accounting
// and the two container hooks. These twelve functions called eight of those
// directly, so co-locating them turns eight cross-module imports into local
// calls; four are imported back because the sheet dispatchers below use them.


// The four small tab enhancers moved to character-sheet/enhanced-tabs.mjs,
// together in one module because they are 12, 10, 12 and 9 lines. The
// actor-sheet dispatcher below still calls all four.


// ============================================
// PARTY FUNCTIONS
// ============================================

// patchLightSourceTrackerForParty moved to party/party-light-tracker.mjs


/**
 * Register the Party sheet
 */
function registerPartySheet() {
	// Register the Party sheet for NPC actors that are flagged as parties
	foundry.documents.collections.Actors.registerSheet(MODULE_ID, PartySheetSD, {
		types: ["NPC"],
		makeDefault: false,
		label: game.i18n.localize("SHADOWDARK_EXTRAS.party.name"),
	});

	// Override the _getSheetClass method to force Party sheet for party actors
	const originalGetSheetClass = CONFIG.Actor.documentClass.prototype._getSheetClass;
	CONFIG.Actor.documentClass.prototype._getSheetClass = function() {
		// Check if this is a party actor
		if (isPartyActor(this)) {
			return PartySheetSD;
		}
		return originalGetSheetClass.call(this);
	};

}

/**
 * Register the AppV2 Potion item sheet
 */
function registerPotionSheet() {
	// Register the Potion sheet for Potion type items
	foundry.documents.collections.Items.registerSheet(MODULE_ID, PotionSheetSD, {
		types: ["Potion"],
		makeDefault: true,
		label: "Shadowdark Extras: Potion Sheet",
	});

}

/**
 * Register the AppV2 Background item sheet
 */
function registerBackgroundSheet() {
	// Register the Background sheet for Background type items
	foundry.documents.collections.Items.registerSheet(MODULE_ID, BackgroundSheetSD, {
		types: ["Background"],
		makeDefault: true,
		label: "Shadowdark Extras: Background Sheet",
	});

}

/**
 * Register the AppV2 NPC Attack item sheet
 */
function registerNPCAttackSheet() {
	// Register the NPC Attack sheet for NPC Attack type items
	foundry.documents.collections.Items.registerSheet(MODULE_ID, NPCAttackSheetSD, {
		types: ["NPC Attack"],
		makeDefault: true,
		label: "Shadowdark Extras: NPC Attack Sheet",
	});

}

/**
 * Register the AppV2 NPC Feature item sheet
 */
function registerNPCFeatureSheet() {
	// Register the NPC Feature sheet for NPC Feature and NPC Spell type items
	foundry.documents.collections.Items.registerSheet(MODULE_ID, NPCFeatureSheetSD, {
		types: ["NPC Feature", "NPC Spell"],
		makeDefault: true,
		label: "Shadowdark Extras: NPC Feature/Spell Sheet",
	});

}

/**
 * Register the AppV2 Class Ability item sheet
 */
function registerClassAbilitySheet() {
	foundry.documents.collections.Items.registerSheet(MODULE_ID, ClassAbilitySheetSD, {
		types: ["Class Ability"],
		makeDefault: true,
		label: "Shadowdark Extras: Class Ability Sheet",
	});
}

// The party actor-creation cluster moved to party/party-creation.mjs. Its
// four Hooks.on registrations install when extendActorCreationDialog() is
// CALLED, so the call site below — not this position — is what fixes their
// order relative to the root's two other renderApplication handlers.

// patchNpcSheetForItemDrops moved to npc/npc-sheet-inventory.mjs


// ============================================
// FIX: PlayerSheetSD._onUseAbility missing methods
// ============================================

// patchPlayerSheetUseAbility moved to character-sheet/player-sheet-patches.mjs


// ============================================
// HOOKS
// ============================================

// Initialize when Foundry is ready
Hooks.once("init", () => {

	// Initialize Automated Animations integration
	initAutoAnimationsIntegration();

	// Register SDX-native Sequencer animation FX settings + master-list menu
	AnimationFxSD.registerSettings();
	registerAnimationFxMenu();

	// Defensive JB2A registration: spell presets reference `jb2a.*` Sequencer
	// DB keys, and JB2A's own sequencer.ready registration is load-order flaky.
	// We listen on the same hook but DEFER to a microtask so JB2A's own
	// registration (and every other sequencer.ready listener) runs first — our
	// entryExists guard then no-ops in the normal case and only registers when
	// JB2A genuinely didn't. Deferring makes us immune to listener attach-order,
	// so we never race JB2A into a duplicate-registration warning. Do NOT also
	// call this from `ready`: in some worlds that hook fires before Sequencer's
	// own ready emits sequencer.ready, which is exactly the race that warns.
	// See AnimationFxSD.ensureJb2aRegistered.
	Hooks.on("sequencer.ready", () => {
		Promise.resolve().then(() => AnimationFxSD.ensureJb2aRegistered());
	});

	// First-run: seed the bundled preset libraries into any world that has
	// never been seeded, so new worlds come up fully populated (GM-only,
	// one-time, merge-not-overwrite — see AnimationFxSD.autoSeedIfNeeded).
	Hooks.once("ready", () => AnimationFxSD.autoSeedIfNeeded());

	// Patch CharacterGeneratorSD to show rolls in chat
	patchCharacterGeneratorRolls();


	// Register Handlebars helpers
	Handlebars.registerHelper("numberSigned", value => {
		const num = parseInt(value) || 0;
		return num >= 0 ? `+${num}` : `${num}`;
	});

	// Helper for simple math operations in templates
	Handlebars.registerHelper("add", (a, b) => {
		return (parseInt(a) || 0) + (parseInt(b) || 0);
	});

	// Preload templates
	(foundry.applications?.handlebars?.loadTemplates || loadTemplates)([
		`modules/${MODULE_ID}/templates/npc-inventory.hbs`,
		`modules/${MODULE_ID}/templates/party.hbs`,
		`modules/${MODULE_ID}/templates/trade-window.hbs`,
		`modules/${MODULE_ID}/templates/journal-notes.hbs`,
		`modules/${MODULE_ID}/templates/journal-editor.hbs`,
		`modules/${MODULE_ID}/templates/potion-sheet/header.hbs`,
		`modules/${MODULE_ID}/templates/potion-sheet/tabs.hbs`,
		`modules/${MODULE_ID}/templates/potion-sheet/details.hbs`,
		`modules/${MODULE_ID}/templates/potion-sheet/activity.hbs`,
		`modules/${MODULE_ID}/templates/potion-sheet/description.hbs`,
		`modules/${MODULE_ID}/templates/background-sheet/header.hbs`,
		`modules/${MODULE_ID}/templates/background-sheet/tabs.hbs`,
		`modules/${MODULE_ID}/templates/background-sheet/description.hbs`,
		`modules/${MODULE_ID}/templates/background-sheet/advancement.hbs`,
		`modules/${MODULE_ID}/templates/npc-attack-sheet/header.hbs`,
		`modules/${MODULE_ID}/templates/npc-attack-sheet/tabs.hbs`,
		`modules/${MODULE_ID}/templates/npc-attack-sheet/details.hbs`,
		`modules/${MODULE_ID}/templates/npc-attack-sheet/description.hbs`,
		`modules/${MODULE_ID}/templates/npc-attack-sheet/source.hbs`,
		`modules/${MODULE_ID}/templates/staff-spell-config.hbs`,
		`modules/${MODULE_ID}/templates/class-ability-sheet/header.hbs`,
		`modules/${MODULE_ID}/templates/class-ability-sheet/tabs.hbs`,
		`modules/${MODULE_ID}/templates/class-ability-sheet/details.hbs`,
		`modules/${MODULE_ID}/templates/class-ability-sheet/description.hbs`,
		`modules/${MODULE_ID}/templates/class-ability-sheet/macro.hbs`,
	]);

	// Register the Party sheet early
	registerPartySheet();

	// Register the Potion sheet
	registerPotionSheet();

	// Register the Background sheet
	registerBackgroundSheet();

	// Register the NPC Attack sheet
	registerNPCAttackSheet();

	// Register the NPC Feature sheet
	registerNPCFeatureSheet();

	// Register the Class Ability sheet
	registerClassAbilitySheet();

	// Wrap Actor.create to handle Party type conversion
	wrapActorCreate();

	// Initialize settings and early styles
	registerSettings();
	applySheetDecorationStyles();
	setupSettingsOrganization();
});

// Journal chrome: hide the internal sync journals, add the headings toggle
registerJournalUIHooks();

// Setup after Shadowdark system is ready
Hooks.once("ready", async () => {
	// Only run if Shadowdark system is active
	if (game.system.id !== "shadowdark") {
		console.warn(`${MODULE_ID} | This module requires the Shadowdark RPG system`);
		return;
	}

	// Shadowdark 4.x owns renown natively. Reconcile the retired SDX actor flag
	// once from the primary GM client, then remove it to keep one source of truth.
	if (game.user.isGM && (!game.users.activeGM || game.users.activeGM.id === game.user.id)) {
		const migratedRenown = await migrateLegacyRenown(game.actors);
		if (migratedRenown > 0) {
			console.log(`${MODULE_ID} | Migrated native renown for ${migratedRenown} actor(s)`);
		}
	}


	extendLightSources();
	patchLightSourceMappings();
	extendActorCreationDialog();
	patchCtrlMoveOnActorSheetDrops();
	patchPlayerSheetForTransfers();
	patchPlayerSheetUseAbility();
	initializeTradeSocket();
	patchCanUseMagicItems();


	// Setup combat socket for damage application (requires socketlib)
	if (typeof socketlib !== "undefined") {
		setupCombatSocket();
	}
	else {
		console.warn(`${MODULE_ID} | socketlib not found, damage application may not work for non-GMs`);
	}

	// Initialize Focus Spell Tracker if enabled
	if (game.settings.get(MODULE_ID, "enableFocusTracker")) {
		initFocusSpellTracker();
	}

	// Break-on-damage effect expiry (marker-driven; hooks are inert until an
	// effect carries flags.shadowdark-extras.breakOnDamage). Safe to run always.
	initBreakOnDamage();

	// Setup wand uses blocking (prevent casting depleted wands)
	if (game.settings.get(MODULE_ID, "enableWandUses")) {
		setupWandUsesBlocker();
	}

	// Setup silenced casting blocking
	setupSilencedCastingBlocker();

	// Patch getPhysicalItems to exclude items inside SDX containers (SD 4.x
	// made isPhysical a hardcoded getter, so setting it to false no longer works)
	patchGetPhysicalItemsForContainers();

	// Setup consolidated rollAttack patches
	setupRollAttackPatches();

	// Setup roll config generators and dialog hooks
	setupRollConfigPatches();

	// Setup scrolling combat text (floating damage/healing numbers)
	setupScrollingCombatText();

	// Setup torch animations (requires Sequencer and JB2A)
	initTorchAnimations();

	// Setup weapon animations (requires Sequencer)
	initWeaponAnimations();

	// Setup level-up token animations (requires Sequencer)
	initLevelUpAnimations();

	// Initialize Template Effects System (damage/effects for tokens in templates)
	initTemplateEffects();

	// Initialize Aura Effects System (token-attached effects that follow bearer)
	initAuraEffects();

	// Initialize Marching Mode (GM-only token following system)
	initMarchingMode();

	patchLightSourceTrackerForParty();

	// Patch NPC sheets to add _toggleLightSource method
	// The Shadowdark system's ActorSheetSD._deleteItem tries to call this method,
	// but it only exists on PlayerSheetSD, causing errors when deleting torch items from NPCs
	if (globalThis.shadowdark?.sheets?.NpcSheetSD) {
		const NpcSheetSD = globalThis.shadowdark.sheets.NpcSheetSD;
		if (!NpcSheetSD.prototype._toggleLightSource) {
			NpcSheetSD.prototype._toggleLightSource = async function(item, options = {}) {
				// For NPCs, just toggle the light active state without the player-specific features
				const active = !item.system.light?.active;

				if (active) {
					// Turn off any currently active lights
					const activeLightSources = await this.actor.getActiveLightSources?.() || [];
					for (const lightSource of activeLightSources) {
						await this.actor.updateEmbeddedDocuments("Item", [{
							"_id": lightSource.id,
							"system.light.active": false,
						}]);
					}
				}

				const dataUpdate = {
					"_id": item.id,
					"system.light.active": active,
				};

				if (!item.system.light?.hasBeenUsed) {
					dataUpdate["system.light.hasBeenUsed"] = true;
				}

				await this.actor.updateEmbeddedDocuments("Item", [dataUpdate]);
				await this.actor.toggleLight?.(active, item.id);
			};
		}
	}

	// Wrap ActorSD._learnSpell to preserve spell damage flags from scrolls
	if (globalThis.shadowdark?.documents?.ActorSD) {
		const ActorSD = globalThis.shadowdark.documents.ActorSD;
		const RollSD = CONFIG.DiceSD;
		const original_learnSpell = ActorSD.prototype._learnSpell;

		ActorSD.prototype._learnSpell = async function(item) {
			// Store the scroll ID temporarily so preCreateItem can access it
			if (item && item.flags?.[MODULE_ID]?.spellDamage) {
				await this.setFlag(MODULE_ID, "_learningFromScroll", item._id);
			}

			// Call original method
			const result = await original_learnSpell.call(this, item);

			// Clean up the temporary flag
			await this.unsetFlag(MODULE_ID, "_learningFromScroll");

			return result;
		};

	}

	// The weapon hit-bonus writer used to live here, wrapped onto
	// `ItemSD.prototype.rollItem`. Shadowdark 4.0.6 does not define that method
	// — it is absent from both src/documents/ItemSD.mjs and the compiled bundle
	// — so the wrapper's `typeof original_rollItem === "function"` guard never
	// passed and it was never installed. SD 4.x also routes attacks through
	// `rollConfigGenerators` / `rollFromConfig`, never `rollItem`, so installing
	// it later would not have helped either.
	//
	// The bonus is now recorded where it is actually applied, by the
	// `renderRollDialogSD` handler in combat/roll-patches.mjs, and travels to the
	// card on the roll config as `_sdxHitBonusInfo`. See combat/hit-bonus.mjs.

	// Ensure trade journal exists (GM only creates it)
	await ensureTradeJournal();

	// Ensure carousing journal exists and initialize sync (GM only creates it)
	await ensureCarousingJournal();
	await ensureCarousingTablesJournal();
	initCarousingSocket();

	// SDX Roller socket listener
	game.socket.on(`module.${MODULE_ID}`, data => {
		if (data.action?.startsWith("sdxRoller")) {
			SDXRollerApp.handleSocketMessage(data);
		}
	});

	// Register global callback for carousing overlay refresh
	window.sdxCarousingOverlayRefresh = refreshCarousingOverlay;
	window.sdxOpenCarousingOverlay = openCarousingOverlay;
});

// Flag preservation on item creation moved to items/item-flag-preservation.mjs.
registerItemCreateFlagPreservation();


// Before party actor is created, ensure proper prototype token settings
Hooks.on("preCreateActor", (actor, data, options, userId) => {
	// Check if this is a party actor being created
	const isParty = data.flags?.[MODULE_ID]?.isParty === true
		|| actor.getFlag(MODULE_ID, "isParty") === true;

	if (isParty) {
		// Force the correct prototype token settings for party actors
		actor.updateSource({
			"prototypeToken.actorLink": true,
			"prototypeToken.sight.enabled": true,
			"prototypeToken.sight.range": 0,
			"prototypeToken.sight.angle": 360,
			"prototypeToken.sight.visionMode": "basic",
			"prototypeToken.light.bright": 0,
			"prototypeToken.light.dim": 0,
		});
	}
});

// After party actor is created, set the sheet
Hooks.on("createActor", async (actor, options, userId) => {
	if (game.user.id !== userId) return;

	// If this is a newly created party, set the party sheet as default
	if (isPartyActor(actor)) {
		// Set the Party sheet as the default for this actor
		await actor.setFlag("core", "sheetClass", `${MODULE_ID}.PartySheetSD`);
	}
});

// Inject Renown into player sheets
Hooks.on("renderPlayerSheetSD", async (app, html, data) => {
	if (app.actor?.type !== "Player") return;

	await injectEnhancedHeader(app, html, app.actor);
	attachNativeHpQuickControls(app, html, app.actor);
	enhanceDetailsTab(app, html, app.actor);
	enhanceAbilitiesTab(app, html, app.actor);
	injectSkillsBox(html, app.actor);
	enhanceSpellsTab(app, html, app.actor);
	await injectStaffSpellsUI(app, html, data);
	enhanceTalentsTab(app, html, app.actor);
	enhanceInventoryTab(app, html, app.actor);
	enhanceGemInventory(app, html, app.actor);
	injectWeaponSpellRechargeButtons(app, html, app.actor);
	enhanceEffectsTab(app, html, app.actor);
	attachContainerContentsToActorSheet(app, html);
	enhanceInventoryWithDeleteAndMultiSelect(app, html);
	injectTradeButton(html, app.actor);
	injectAddCoinsButton(html, app.actor);
	applyInventoryStylesToSheet(html, app.actor);
	injectHeaderCustomization(app, html, app.actor);
	await injectJournalNotes(app, html, app.actor);
	await injectConditionsToggles(app, html, app.actor);
	// if (!game.settings.get(MODULE_ID, "tray.enabled")) {
	// 	await injectCarousingButton(app, html, app.actor);
	// }
	enableItemChatIcon(app, html);
});

// applyNpcPlayerTheme moved to npc/npc-sheet-inventory.mjs

// Inject Inventory tab into NPC sheets (but not Party sheets)
Hooks.on("renderNpcSheetSD", async (app, html, data) => {
	if (app.actor?.type !== "NPC") return;

	// Don't inject into Party actors (they have their own inventory)
	if (isPartyActor(app.actor)) return;

	applyNpcPlayerTheme(app, html, app.actor);
	attachNativeHpQuickControls(app, html, app.actor);

	// Check if NPC inventory is enabled
	if (!game.settings.get(MODULE_ID, "enableNpcInventory")) return;

	await injectNpcInventoryTab(app, html, data);
	patchNpcSheetForItemDrops(app);
	attachContainerContentsToActorSheet(app, html);
	applyInventoryStylesToSheet(html, app.actor);
	enableItemChatIcon(app, html);
	await injectConditionsToggles(app, html, app.actor);
});

// Inject Creature Type dropdown into NPC sheets
Hooks.on("renderNpcSheetSD", (app, html, data) => {
	if (app.actor?.type !== "NPC") return;

	// Don't inject into Party actors
	if (isPartyActor(app.actor)) return;

	applyNpcPlayerTheme(app, html, app.actor);
	attachNativeHpQuickControls(app, html, app.actor);

	// Inject the creature type dropdown (before ATTACKS section)
	injectNpcCreatureType(app, html, app.actor);
});

// Apply inventory styles to Party sheets
Hooks.on("renderActorSheet", (app, html, data) => {
	// Only handle Party sheets
	if (!(app instanceof PartySheetSD)) return;
	if (!isPartyActor(app.actor)) return;

	applyInventoryStylesToSheet(html, app.actor);
	injectPartyHeaderCustomization(app, html, app.actor);
});

// Weapon ("staff") spells live in `item-sheets/staff-spells.mjs`. This call sits
// where that module's `updateItem` hook did, so its place in the registration
// order is unchanged.
registerStaffSpellHooks();


// Inject container UI into Basic item sheets
Hooks.on("renderItemSheet", (app, html, data) => {
	try {
		injectBasicContainerUI(app, html);
		injectAmmunitionBonuses(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to inject Basic item container UI`, err);
	}

	try {
		enhanceSpellSheet(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to enhance spell sheet`, err);
	}

	try {
		injectSpellAlignmentField(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to inject spell alignment field`, err);
	}

	try {
		enhancePotionSheet(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to enhance potion sheet`, err);
	}

	try {
		enhanceScrollSheet(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to enhance scroll sheet`, err);
	}

	try {
		enhanceWandSheet(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to enhance wand sheet`, err);
	}

	// Inject weapon bonus tab
	try {
		const item = app.item || app.document;
		if (item?.type === "Weapon") {
			injectWeaponBonusTab(app, html, item);
			injectWeaponDamageTypeDropdown(app, html, item);
			injectStaffSpellButton(app, html, item);
		}
		else if (item?.type === "Armor") {
			// For shields (Armor), just inject the animation button
			injectWeaponAnimationButton(html, item);
		}
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to inject weapon bonus tab`, err);
	}


	// Hide already-rendered Effects tab elements for non-GM players viewing unidentified items
	try {
		const item = app?.item;
		if (item && isUnidentified(item) && !game.user?.isGM) {
			html.find('a[data-tab="tab-effects"]').remove();
			html.find('.tab[data-tab="tab-effects"]').remove();
		}
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to hide effects tab`, err);
	}

	// Enhance Gem item sheet with quantity field
	try {
		enhanceGemSheet(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to enhance gem sheet`, err);
	}
});

// V1/V2 header button bridge for SDX's AppV2 item sheets
registerAppV2HeaderBridge();

// Convert string values to booleans for spell damage flags
Hooks.on("preUpdateItem", (item, updateData, options, userId) => {
	// Check if we're updating spell damage applyToTarget
	const applyToTargetPath = `flags.${MODULE_ID}.spellDamage.applyToTarget`;
	if (foundry.utils.hasProperty(updateData, applyToTargetPath)) {
		const value = foundry.utils.getProperty(updateData, applyToTargetPath);
		// Convert string to boolean
		if (value === "true" || value === true) {
			foundry.utils.setProperty(updateData, applyToTargetPath, true);
		}
		else if (value === "false" || value === false) {
			foundry.utils.setProperty(updateData, applyToTargetPath, false);
		}
	}

	// Check if we're updating spell effectsApplyToTarget
	const effectsApplyToTargetPath = `flags.${MODULE_ID}.spellDamage.effectsApplyToTarget`;
	if (foundry.utils.hasProperty(updateData, effectsApplyToTargetPath)) {
		const value = foundry.utils.getProperty(updateData, effectsApplyToTargetPath);
		// Convert string to boolean
		if (value === "true" || value === true) {
			foundry.utils.setProperty(updateData, effectsApplyToTargetPath, true);
		}
		else if (value === "false" || value === false) {
			foundry.utils.setProperty(updateData, effectsApplyToTargetPath, false);
		}
	}
});


// Chat-card target stash and damage-card injection; registered here to keep hook order
registerChatCardHooks();

// The unidentified magicItem context wrap moved to
// inventory/UnidentifiedDisplaySD.mjs, beside the GM display it mirrors.
initUnidentifiedSheetContext();

// Shadowdark's createItemFromSpell strips module flags; the wrap that puts
// them back lives in items/item-flag-preservation.mjs.
registerSpellItemFlagPreservation();

// Container hooks live in inventory/containers.mjs; registered here to keep source order.
registerContainerHooks();


// The two container-deletion hooks moved into inventory/containers.mjs and
// now register at the end of registerContainerHooks() above, which keeps the
// original order: updateItem, createItem, preDeleteItem, deleteItem.

// Handle updates when the sheet is submitted
Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
	// Validate NPC coins
	if (changes.flags?.[MODULE_ID]?.coins) {
		const coins = changes.flags[MODULE_ID].coins;
		if (coins.gp !== undefined) coins.gp = Math.max(0, parseInt(coins.gp) || 0);
		if (coins.sp !== undefined) coins.sp = Math.max(0, parseInt(coins.sp) || 0);
		if (coins.cp !== undefined) coins.cp = Math.max(0, parseInt(coins.cp) || 0);
	}
});

// Party sheets re-render when a member changes; registered here to keep hook order
registerPartySheetRerenderHooks();

// Background advancement grants on background-set and level-up; registered here to keep hook order
registerBackgroundAdvancementHooks();

// Freya's Omen reroll button on critically-failed spell cards; registered here to keep hook order
registerFreyasOmenHooks();

// Party membership cleanup on actor delete; registered here to keep hook order
registerPartyCleanupHooks();

// Condition-toggles refresh hooks were removed in 5.2.5 (issue #56): they
// were a permanent no-op (toggles live in the BODY modal, never the sheet),
// and the modal self-updates and closes on its own.

// ============================================
// SIDEBAR & COMPENDIUM UNIDENTIFIED INDICATORS
// ============================================

/**
 * Mark unidentified items in the sidebar or compendium directory with a visual indicator (GM only)
 * Adds a red border around the thumbnail and a small question mark icon
 * @param {HTMLElement} html - The rendered HTML of the directory (plain DOM element in V13)
 * @param {Collection|Map|Array} items - The items to check for unidentified status
 */

// The two ammunition-consumption patches moved to
// inventory/ammunition-bonuses.mjs, beside the sheet UI they enable.
registerAmmunitionPatches();

// ============================================
// AMMUNITION BONUS UI INJECTION
// ============================================
// injectAmmunitionBonuses moved to inventory/ammunition-bonuses.mjs

// ============================================
// ABILITY ADVANTAGE PREDEFINED EFFECTS
// ============================================
// Moved to effects/predefined-effects.mjs. Called here so its init hook keeps
// its position relative to every other registration.
registerPredefinedEffects();

// The "SILENCED EFFECT - PREVENT SPELL CASTING" ready hook that stood here was
// an empty husk and has been deleted. Every patch it once installed had already
// been migrated out or removed, leaving a hook that read two class references,
// used neither, and returned. The live silenced behaviour is
// setupSilencedCastingBlocker(), defined in effects/casting-blockers.mjs and
// called from the HOOKS block above; the effect definition is in
// effects/predefined-effects.mjs.

// ============================================
// INVISIBILITY EFFECT - MAKE TOKEN INVISIBLE
// ============================================


// Invisibility hooks live in ./effects/invisibility.mjs; registered here to keep source order.
registerInvisibilityHooks();


// ============================================
// MACRO EXECUTE EFFECT HANDLERS
// ============================================

// Register socketlib handler on ready hook
// Dev-only Quench batches. These live under dev/ and are excluded from
// module.zip, so a released install has nothing to import - stay silent there
// rather than logging a spurious registration failure.
Hooks.on("quenchReady", async quench => {
	try {
		const { registerWebpMigrationBatch } = await import("../dev/tests/quench/webp-migration.batch.mjs");
		registerWebpMigrationBatch(quench);
	}
	catch(e) {
		// Expected in a packaged install: dev/ is not shipped.
	}
	try {
		const { registerStructuralBatch } = await import("../dev/tests/quench/structural.batch.mjs");
		registerStructuralBatch(quench);
	}
	catch(e) {
		// Expected in a packaged install: dev/ is not shipped.
	}
	try {
		const { registerSplitBatch } = await import("../dev/tests/quench/split.batch.mjs");
		registerSplitBatch(quench);
	}
	catch(e) {
		// Expected in a packaged install: dev/ is not shipped.
	}
});

// Socket setup gets its own ready hook, with no await anywhere in it, so that
// nothing here can be delayed by unrelated work. It used to share a hook with
// the two migrations below and register only once both had finished, which left
// these four handlers unavailable for as long as a world migration took. The
// same await also stranded nine handlers belonging to other hooks (669e8a9).
//
// A socket handler is a promise made to other clients: a player who acts in
// that window gets "No socket handler with the name ... has been registered",
// not a retry. Registration therefore has to be synchronous with `ready`.
Hooks.once("ready", () => {
	const macroExecuteSocket = initMacroExecuteSocket();
	if (macroExecuteSocket) {
		// Each feature registers its own handlers on the shared socket. They are
		// called here, in their original order, so this hook is the single place
		// socket registration order is decided — and the single place that has to
		// stay free of awaits.
		registerEffectMacroSocket(macroExecuteSocket);
		registerItemMacroSocket(macroExecuteSocket);
		registerPartyTravelSocket(macroExecuteSocket);
		registerTemplateTargetSyncSocket(macroExecuteSocket);

	}
});

// The one-time data migrations, split out of the socket hook above. They keep
// their original position in the ready sequence — this hook is registered
// immediately after that one, where the combined hook used to sit — and their
// own internal order is unchanged.
Hooks.once("ready", async () => {
	// Rewrite stored .png/.jpg asset paths after the WebP conversion. Must run
	// before anything reads scene/actor artwork, or the GM sees broken images
	// for one session.
	try {
		await migrateWebpAssetPaths();
	}
	catch(e) {
		console.error(`${MODULE_ID} | webp asset migration threw:`, e);
	}

	// World compendiums are swept separately and NOT awaited: the sweep has to
	// load every document of every world pack, which would stall world load.
	// It carries its own gate (webpPackSweepDone) so locked or failed packs are
	// retried on later loads instead of being stranded by the document gate.
	sweepWorldCompendiums().catch(e =>
		console.error(`${MODULE_ID} | world compendium webp sweep failed:`, e)
	);

	// The legacy itemacro migration lives with the flag it writes, in
	// item-macros/item-macro-engine.mjs. Awaited here so its position in the
	// migration sequence is unchanged.
	await migrateLegacyItemMacros();
});

// Moved to item-macros/effect-trigger-macros.mjs, all five hooks together with
// the two functions behind them. Called here so their position relative to every
// other registration is unchanged.
registerEffectTriggerHooks();

// ============================================
// NATIVE ITEM MACRO ENGINE
// ============================================
// Moved to item-macros/item-macro-engine.mjs. AuraEffectsSD and
// TemplateEffectsSD now import it FROM THERE rather than dynamically importing
// this file, so the composition root exports nothing at all — it is a true
// leaf of the import graph, not merely a static-import leaf.

// ============================================
// WEAPON ITEM MACRO EXECUTION SYSTEM
// ============================================

// Moved to item-macros/weapon-item-macros.mjs. Both of its callers have since
// followed it out — the attack-card dispatch and the equip/unequip hook — so
// this file no longer references it at all.

// ============================================
// SPELL ITEM MACRO EXECUTION SYSTEM
// ============================================

// Moved to item-macros/spell-item-macros.mjs, together with the socket handlers
// its runAsGm path calls back through — the executor and its GM-side handler
// are two ends of one call. Registered here so that registration keeps its
// position relative to every other registration in this file.
registerSpellItemMacroSocket();

/**
 * Hook into chat message rendering to bind Shapechanger revert button
 */
Hooks.on("renderChatMessageHTML", (message, html, context) => {
	const revertBtn = html.querySelector(".sdx-revert-shape-btn");
	if (!revertBtn) return;

	revertBtn.addEventListener("click", async event => {
		event.preventDefault();
		event.stopPropagation();

		const actorId = revertBtn.dataset.actorId;
		const tokenId = revertBtn.dataset.tokenId;
		if (!actorId) return;

		// Try token-based resolution first (unlinked tokens), then world actor
		let actor = tokenId ? canvas.tokens?.get(tokenId)?.actor : null;
		if (!actor) actor = game.actors.get(actorId);
		if (!actor) {
			ui.notifications.error("Could not find the actor for this transformation.");
			return;
		}

		// Disable button to prevent double-clicks
		revertBtn.disabled = true;
		revertBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reverting...';

		const sdxModule = game.modules.get(MODULE_ID);
		if (sdxModule?.api?.revertShapechanger) {
			await sdxModule.api.revertShapechanger(actor);
		}
	});
});

// Moved to item-macros/chat-dispatch.mjs, together with the three per-concern
// dedupe Sets, the claim helper and the historical-message epoch guard — the
// handlers cannot be separated from that state. Called here so all three
// registrations keep their position: the shapechanger revert-button handler
// above still registers before them.
registerChatDispatch();

// ============================================
// NPC FEATURE ITEM MACRO EXECUTION
// ============================================

// Moved to item-macros/npc-feature-macros.mjs. Called here so both of its ready
// registrations keep their position relative to every other registration. A
// third, empty ready hook ("Redundant handler removed") was dropped rather than
// carried — an empty callback has no behaviour to preserve.
registerNPCFeatureItemMacros();


// ============================================
// CLASS ABILITY ITEM MACRO EXECUTION
// ============================================
// Moved to item-macros/class-ability-macros.mjs. Called here so both of its
// ready registrations keep their position relative to every other registration.
registerClassAbilityItemMacros();


// ============================================
// SDX TEMPLATES API
// ============================================
// Moved to api/templates.mjs, together with the two scene-level helpers only
// it uses and the square-template rotation fix. Called here rather than run on
// import so `globalThis.SDX` is created at exactly this point in this file's
// evaluation — the DEV HELPERS block below assigns `SDX.dev` onto it.
registerTemplatesApi();

// ============================================
// DEV HELPERS — headless test affordances
// These bypass interactive UI gates so probes / fixtures can drive the
// real cast pipeline without a sheet click or dialog. Wraps SD's actor
// data-model methods, NOT a reimplementation — so when SD changes the
// internals, the helper benefits without us patching anything.
// ============================================

SDX.dev = {
	/**
	 * Headless spell cast. Wraps `actor.system.castSpell(spellUuid, { skipPrompt: true, ...opts })`
	 * — `skipPrompt` short-circuits `shadowdark.dice.rollDialog` so the cast proceeds
	 * straight to `rollFromConfig` (the real roll + chat-card render path).
	 *
	 * @param {Actor|string} actorOrId  Actor doc or id/name to look up.
	 * @param {Item|string}  spellOrId  Spell item doc, id, or name on the actor.
	 * @param {Object}       opts       Forwarded to castSpell — e.g. `{ rollMode }`.
	 *                                  `skipPrompt: true` is always injected.
	 * @returns {Promise<boolean>}      castSpell's return — true on successful roll, false on cancel/fail.
	 */
	async castSpell(actorOrId, spellOrId, opts = {}) {
		const actor = actorOrId instanceof Actor
			? actorOrId
			: (game.actors.get(actorOrId) ?? game.actors.getName(actorOrId));
		if (!actor) throw new Error(`SDX.dev.castSpell: actor not found (${actorOrId})`);

		const spell = spellOrId instanceof Item
			? spellOrId
			: (actor.items.get(spellOrId) ?? actor.items.getName(spellOrId));
		if (!spell) throw new Error(`SDX.dev.castSpell: spell not found on ${actor.name} (${spellOrId})`);

		if (typeof actor.system?.castSpell !== "function") {
			throw new Error(`SDX.dev.castSpell: actor.system.castSpell unavailable — is ${actor.name} a Player type?`);
		}

		return actor.system.castSpell(spell.uuid, { skipPrompt: true, ...opts });
	},
};

// ============================================
// MODULE API
// Export functions for use in item macros
// ============================================

Hooks.on("setup", () => {
	const module = game.modules.get("shadowdark-extras");
	if (module) {
		function gmOnly(name, fn) {
			return async function(...args) {
				if (!game.user.isGM) {
					console.warn(`SDX.api.${name}: blocked, GM required (caller: ${game.user.name})`);
					throw new Error(`SDX | ${name}: requires GM permission`);
				}
				return fn.apply(this, args);
			};
		}

		function audited(name, fn) {
			return function(...args) {
				const caller = (new Error().stack || "").split("\n")[2]?.trim() ?? "?";
				console.log(`SDX.api.${name} called by`, caller);
				return fn.apply(this, args);
			};
		}

		module.api = {
			// --- Templates ---
			templates: SDX.templates,

			// --- Dev / test helpers ---
			dev: SDX.dev,

			// --- Maintenance ---
			// Re-run the PNG/JPG -> WebP stored-path migration over world
			// documents and this module's settings. Pass {dryRun:true} to see
			// what would change without writing anything.
			migrateWebpAssetPaths,
			// Same sweep across world-owned compendium packs. Unlocked packs are
			// migrated; locked ones are reported so the GM can unlock and re-run.
			sweepWorldCompendiums,

			// --- Creature types (read-only; safe for all users) ---
			// Effective type for an actor: manual flag override > bestiary map > "".
			getCreatureType: getEffectiveCreatureType,
			// Bestiary-mapped type for a raw name (ignores per-actor overrides).
			getMappedCreatureType: getMappedType,

			// --- Break-on-damage (mark an applied effect to expire on the bearer's next HP loss) ---
			// NOT gmOnly: a player's own effects must be able to break too.
			breakEffectOnDamage: audited("breakEffectOnDamage", breakEffectOnDamage),
			clearBreakOnDamage: audited("clearBreakOnDamage", clearBreakOnDamage),
			applySpellEffect: audited("applySpellEffect", applySpellEffect),

			// --- Medkit source packs (register your own spell pack to appear in the Medkit) ---
			registerMedkitPack: audited("registerMedkitPack", registerMedkitPack),
			unregisterMedkitPack: audited("unregisterMedkitPack", unregisterMedkitPack),
			getMedkitPacks: audited("getMedkitPacks", getMedkitPacks),

			// --- Medkit world-scale scan/apply (no per-actor sheet clicking) ---
			scanWorldForUpdates: audited("scanWorldForUpdates", scanWorldForUpdates),
			applyWorldMedkitUpdates: audited("applyWorldMedkitUpdates", gmOnly("applyWorldMedkitUpdates", applyWorldMedkitUpdates)),
			medkitScanWorld: audited("medkitScanWorld", gmOnly("medkitScanWorld", medkitScanWorld)),

			// --- Spells / Focus tracker ---
			startDurationSpell: audited("startDurationSpell", gmOnly("startDurationSpell", startDurationSpell)),
			endDurationSpell: audited("endDurationSpell", gmOnly("endDurationSpell", endDurationSpell)),
			registerSpellModification: audited("registerSpellModification", gmOnly("registerSpellModification", registerSpellModification)),
			getActiveDurationSpells: audited("getActiveDurationSpells", getActiveDurationSpells),
			showConditionsModal: audited("showConditionsModal", showConditionsModal),
			getConditionsData: audited("getConditionsData", getConditionsData),

			// --- Dungeon generator ---
			generateDungeon: audited("generateDungeon", gmOnly("generateDungeon", generateDungeon)),
			getGeneratorSettings: audited("getGeneratorSettings", getGeneratorSettings),
			setGeneratorSettings: audited("setGeneratorSettings", gmOnly("setGeneratorSettings", setGeneratorSettings)),
			generateRandomSeed: audited("generateRandomSeed", generateRandomSeed),
			buildHexDungeonScene: audited("buildHexDungeonScene", gmOnly("buildHexDungeonScene", buildHexDungeonScene)),

			// --- Biome presets (user-editable) ---
			getBiomeDefinitions: audited("getBiomeDefinitions", getBiomeDefs),
			getCustomBiomes: audited("getCustomBiomes", getCustomBiomes),
			setCustomBiome: audited("setCustomBiome", gmOnly("setCustomBiome", setCustomBiome)),
			removeCustomBiome: audited("removeCustomBiome", gmOnly("removeCustomBiome", removeCustomBiome)),
			resetCustomBiomes: audited("resetCustomBiomes", gmOnly("resetCustomBiomes", resetCustomBiomes)),
			getEnabledBiomeKeys: audited("getEnabledBiomeKeys", getEnabledBiomeKeys),
			getDisabledBiomes: audited("getDisabledBiomes", getDisabledBiomes),
			setBiomeEnabled: audited("setBiomeEnabled", gmOnly("setBiomeEnabled", setBiomeEnabled)),
			openBiomeEditor: audited("openBiomeEditor", openBiomeEditor),

			// --- Hex generator ---
			generateHexMap: audited("generateHexMap", gmOnly("generateHexMap", generateHexMap)),
			clearGeneratedTiles: audited("clearGeneratedTiles", gmOnly("clearGeneratedTiles", clearGeneratedTiles)),

			// --- Hexcrawl builder (data-driven; recreate a keyed hex map from a dataset) ---
			buildHexcrawl: audited("buildHexcrawl", gmOnly("buildHexcrawl", buildHexcrawl)),
			buildHexcrawlFromFile: audited("buildHexcrawlFromFile", gmOnly("buildHexcrawlFromFile", buildHexcrawlFromFile)),

			// --- Dungeon Regions / Decor (multi-level orchestration) ---
			placeChangeLevelRegion: audited("placeChangeLevelRegion", gmOnly("placeChangeLevelRegion", placeChangeLevelRegion)),
			placeDungeonSurface: audited("placeDungeonSurface", gmOnly("placeDungeonSurface", placeDungeonSurface)),
			placeDungeonDecor: audited("placeDungeonDecor", gmOnly("placeDungeonDecor", placeDungeonDecor)),

			// --- INTERNAL — subject to change without notice ---
			internal: {
				applySceneLevelData: audited("internal.applySceneLevelData", gmOnly("internal.applySceneLevelData", applySceneLevelData)),
				getSceneLevelContext: audited("internal.getSceneLevelContext", getSceneLevelContext),
				getDungeonBackground: audited("internal.getDungeonBackground", getDungeonBackground),
				caveLayout: generateCaveLayout,
				caveLoops: buildCaveLoops,
				traceBoundaryLoops: traceBoundaryLoops,
				layout: generateLayout,
				mixedLayout: generateMixedLayout,
				assignBiomes: assignBiomes,
				buildCellFloorMap: buildCellFloorMap,
			},
		};
	}
});

// ============================================
// PARTY TOKEN LIGHT SYNCHRONIZATION HOOKS
// ============================================

// Sync party light when an item is updated (e.g., light toggled)
Hooks.on("updateItem", async (item, changes, options, userId) => {
	// Only care about light-related changes
	if (!foundry.utils.hasProperty(changes, "system.light")) return;

	// Get the owning actor
	const actor = item.actor;
	if (!actor) return;

	// Find all parties containing this actor
	const parties = getPartiesContainingActor(actor);

	// Sync each party's token lights
	for (const party of parties) {
		await syncPartyTokenLight(party);
	}
});

// Sync party light when party members change
Hooks.on("updateActor", async (actor, changes, options, userId) => {
	// Check if this actor has party members and they changed
	if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.members`)) {
		await syncPartyTokenLight(actor);
	}
});

// Sync party light when party sheet is rendered (delayed to ensure canvas is ready)
Hooks.on("renderActorSheet", async (app, html, data) => {
	// Check if this actor has party members (indicates it's a party)
	const hasMembers = app.actor.getFlag(MODULE_ID, "members");
	if (hasMembers) {
		// Delay sync briefly to ensure canvas is ready
		setTimeout(async () => {
			await syncPartyTokenLight(app.actor);
		}, 100);
	}
});

// Sync party light when party token is placed on scene
Hooks.on("createToken", async (tokenDoc, options, userId) => {
	const actor = tokenDoc.actor;
	if (!actor) return;

	// Check if this is a party token
	const hasMembers = actor.getFlag(MODULE_ID, "members");
	if (hasMembers) {
		// Delay briefly to ensure token is fully created
		setTimeout(async () => {
			await syncPartyTokenLight(actor);
		}, 100);
	}
});

// ============================================
// SPELLBOOK COMPENDIUM FILTER
// ============================================

// injectSpellbookCompendiumFilter moved to character-sheet/spellbook-filter.mjs

// Hook into the SpellBookSD rendering
Hooks.on("renderApplication", (app, html, data) => {
	// Check if this is the SpellBookSD app
	if (app.constructor.name === "SpellBookSD") {
		injectSpellbookCompendiumFilter(app, html);
	}
});

// ============================================
// NPC CARD ENRICHER
// ============================================

// Register the DisplayNpcCard enricher
Hooks.once("ready", () => {
	initAppearanceSettings();
	registerDisplayNpcEnricher();
	registerDisplayTableEnricher();
	registerDisplayItemEnricher();

	// Initialize Easy Reference ProseMirror menu
	initEasyReferenceMenu();

	// Initialize Token Toolbar
	initTokenToolbar();

	// Initialize Character Tray
	initTray();

	// Global listener for @DisplayTable roll buttons
	$(document).on("click", ".sdx-table-roll-btn", async event => {
		event.preventDefault();
		const container = $(event.currentTarget).closest(".sdx-display-table-container");
		const uuid = container.data("table-uuid");
		if (!uuid) return;

		const table = fromUuidSync(uuid) || await fromUuid(uuid);
		if (table) {
			table.draw();
		}
	});


	// Alignment-based spell filtering joins the compendium filter in
	// character-sheet/spellbook-filter.mjs — same dialog, same feature.
	initAlignmentSpellFiltering();
});

// ===================================================================
// SOURCE REQUIREMENTS FOR ACTIVE EFFECTS
// ===================================================================

// Moved to effects/source-requirements.mjs, together with checkEffectRequirements
// and the five hooks below. The config-hook call stays here: it registers first
// and must keep doing so.

// Active Effect config hooks live in ./effects/effect-config.mjs; registered here to keep source order.
registerActiveEffectConfigHooks();
// The five source-requirement hooks, in their original order, immediately after
// the config hooks above.
registerSourceRequirementHooks();

/* ------------------------------------------------ */
/*  NPC Attack Display Patch                        */
/* ------------------------------------------------ */
registerNpcDisplayPatches();

/**
 * Hook to add item images to NPC Features on the Abilities tab
 */
Hooks.on("renderNpcSheetSD", (app, html, data) => {
	const $html = html instanceof jQuery ? html : $(html);

	// Find all feature items and add images
	const featureItems = $html.find(".SD-box .content .item.attack[data-item-id]");
	featureItems.each((_, el) => {
		const $el = $(el);
		const itemId = $el.data("item-id");
		const item = app.actor.items.get(itemId);

		if (!item) return;

		// Check if this is actually a feature (not attack or special)
		if (item.type !== "NPC Feature") return;

		// Check if image is not the default
		const defaultIcon = "icons/svg/book.svg";
		if (item.img && item.img !== defaultIcon) {
			// Find the anchor element and insert image after the icon
			const anchor = $el.find("a.rollable");
			if (anchor.length && !anchor.find(".sdx-npc-item-img").length) {
				const escapedImg = foundry.utils.escapeHTML(item.img);
				const escapedName = foundry.utils.escapeHTML(item.name);
				const imgHtml = `<img src="${escapedImg}" alt="${escapedName}" class="sdx-npc-item-img" style="width: 18px; height: 18px; vertical-align: text-bottom; margin-right: 2px; border: none; border-radius: 2px;" />`;
				anchor.find("i.fas").after(imgHtml);
			}
		}
	});
});

// ============================================
// SCENE EXPORT CONTEXT MENU
// ============================================

/**
 * Add "Export Scene as ZIP" option to scene context menu
 */
Hooks.on("getSceneContextOptions", (document, menuItems) => {
	menuItems.push({
		label: "Export Scene as ZIP",
		icon: '<i class="fas fa-file-archive"></i>',
		visible: () => game.user.isGM,
		callback: async li => {
			// In Foundry v13, li is an HTMLElement, not jQuery
			const element = li instanceof HTMLElement ? li : li[0];
			const sceneId = element?.dataset?.documentId || element?.dataset?.entryId;
			if (!sceneId) {
				ui.notifications.error("Could not determine scene ID");
				return;
			}

			// Get the scene document
			const scene = game.scenes.get(sceneId);
			if (!scene) {
				ui.notifications.error("Could not find scene");
				return;
			}

			// Export the scene
			await SceneExporter.exportScene(scene);
		},
	});

	menuItems.push({
		label: "Import Scene from ZIP",
		icon: '<i class="fas fa-file-import"></i>',
		visible: () => game.user.isGM,
		callback: async () => {
			await SceneImporter.promptImport();
		},
	});
});

console.log(`${MODULE_ID} | Scene export context menu registered`);

// ============================================
// LIGHTS-OUT CAROUSEL DRAG FUNCTIONALITY
// ============================================
// Moved to canvas/carousel-drag.mjs. Its one Hooks.once installs when the
// call below runs, so that call site — not this position — fixes its order.

// Initialize carousel drag
initCarouselDrag();

// Crawl-helper's player-rolled death timer lives in
// combat/crawl-helper-death-timer.mjs.
registerCrawlHelperDeathTimer();

// Initialize Placeable Notes
Hooks.once("ready", () => {
	initPlaceableNotes();
});

Hooks.once("init", () => {
	// Register NPC Special Attack Sheet
	foundry.documents.collections.Items.registerSheet("shadowdark", NPCSpecialAttackSheetSD, {
		types: ["NPC Special Attack"],
		makeDefault: true,
		label: "SDX Special Attack Sheet (V2)",
	});
});

// ============================================
// GEM BAG ENHANCEMENT HOOK
// ============================================
Hooks.on("renderApplication", (app, html, data) => {
	try {
		enhanceGemBag(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to enhance gem bag`, err);
	}
});


