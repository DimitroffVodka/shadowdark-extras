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
import { initTray, registerPartyStatsSocket } from "./tray/TraySD.mjs";
import { registerTrayAppHooks } from "./tray/TrayApp.mjs";
import { initAppearanceSettings } from "./character-sheet/AppearanceSettingsSD.mjs";
import { injectStaffSpellButton, injectStaffSpellsUI, injectWeaponSpellRechargeButtons, patchCanUseMagicItems, registerStaffSpellHooks } from "./item-sheets/staff-spells.mjs";
import { initJournalNarration } from "./journal/JournalNarrationSD.mjs";
import { initMedkit, registerMedkitPack, unregisterMedkitPack, getMedkitPacks, scanWorldForUpdates, applyWorldMedkitUpdates, medkitScanWorld } from "./combat/MedkitSD.mjs";
import { initLightTrackerApp } from "./canvas/LightTrackerAppSD.mjs";
import { registerTileFlattenHooks } from "./canvas/TileFlattenSD.mjs";
import { initMarchingMode, initSidebarTools } from "./combat/MarchingModeSD.mjs";
import { initFormationSpawner } from "./combat/FormationSpawnerSD.mjs";
import { SceneExporter } from "./scene/SceneExporter.mjs";
import { SceneImporter } from "./scene/SceneImporter.mjs";
import { initJournalPins } from "./journal/JournalPinsSD.mjs";
import { registerPinListHooks } from "./journal/PinListApp.mjs";
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
import { assignBiomes, buildCellFloorMap, getBiomeDefs, getCustomBiomes, setCustomBiome, removeCustomBiome, resetCustomBiomes, getEnabledBiomeKeys, getDisabledBiomes, setBiomeEnabled, registerDungeonBiomeSettings } from "./dungeon/DungeonBiomesSD.mjs";
import { openBiomeEditor, registerBiomeEditorDelegation } from "./dungeon/BiomeEditorSD.mjs";
import { generateHexMap, clearGeneratedTiles } from "./hex/HexGeneratorSD.mjs";
import { buildHexcrawl, buildHexcrawlFromFile } from "./hex/HexcrawlBuilderSD.mjs";
import { getSceneLevelContext, applySceneLevelData, getDungeonBackground, registerDungeonPainterSettings } from "./dungeon/DungeonPainterSD.mjs";
import { placeChangeLevelRegion, placeDungeonSurface, placeDungeonDecor } from "./dungeon/DungeonRegionsSD.mjs";
import { registerSettings, setupSettingsOrganization } from "./settings/module-settings.mjs";
import { registerFeatureManagerSettings } from "./settings/FeatureManagerApp.mjs";
import { FEATURE_IDS, isFeatureEnabled } from "./settings/feature-gates.mjs";
import { registerDungeonMultiLevelHooks } from "./dungeon/DungeonMultiLevelSD.mjs";

// Backward-compatible declared-esmodule surface. These names were public before
// the reorganization; internal feature modules import from their owners instead.
export { getCustomLightSources } from "./canvas/light-templates.mjs";
export { executeItemMacro, hasItemMacro } from "./item-macros/item-macro-engine.mjs";

const MODULE_ID = "shadowdark-extras";
const featureEnabled = featureId => isFeatureEnabled(featureId);
const anyFeatureEnabled = (...featureIds) => featureIds.some(featureEnabled);

// Register the world gate first, then evaluate every feature-owned startup seam.
Hooks.once("init", registerFeatureManagerSettings);
/* eslint-disable indent -- keep the gated composition root mechanically stable */
Hooks.once("init", () => {

if (featureEnabled(FEATURE_IDS.ITEM_MACROS)) {
	import("./item-macros/SpellMacrosSD.mjs")
		.then(module => module.registerSpellMacrosApi())
		.catch(error => console.error(`${MODULE_ID} | Failed to load spell macro API`, error));
}

// ============================================
// JOURNAL NARRATION INITIALIZATION
// ============================================
if (featureEnabled(FEATURE_IDS.JOURNAL_NARRATION)) initJournalNarration();
if (featureEnabled(FEATURE_IDS.MEDKIT)) initMedkit();
if (featureEnabled(FEATURE_IDS.JOURNAL_PINS)) {
	initJournalPins();
	registerPinListHooks();
}
if (featureEnabled(FEATURE_IDS.COORDINATES)) initSDXCoords();
if (featureEnabled(FEATURE_IDS.HEX_TOOLTIP)) initHexTooltip();
if (featureEnabled(FEATURE_IDS.HEX_FOG)) initHexFog();
if (featureEnabled(FEATURE_IDS.MAP_GENERATORS)) registerMaphubHooks();
if (featureEnabled(FEATURE_IDS.UNIDENTIFIED_ITEMS)) initUnidentifiedGMDisplay();
if (featureEnabled(FEATURE_IDS.TEMPLATE_EFFECTS)) initTemplateElevationBadge();
if (featureEnabled(FEATURE_IDS.DUNGEON_PAINTER)) registerDungeonMultiLevelHooks();
if (featureEnabled(FEATURE_IDS.TILE_FLATTEN)) registerTileFlattenHooks();
if (featureEnabled(FEATURE_IDS.TRAY)) registerTrayAppHooks();
// patchHexTilePositionClamp moved to hex/hex-tile-clamp.mjs

function initializeEarlyFeatures() {
	// Register GSAP Plugins (GSAP is loaded by Foundry core)
	try {
		if (
			anyFeatureEnabled(
				FEATURE_IDS.JOURNAL_PINS,
				FEATURE_IDS.ANIMATION_FX,
				FEATURE_IDS.TORCH_ANIMATIONS,
				FEATURE_IDS.LEVEL_UP_ANIMATIONS,
				FEATURE_IDS.WEAPON_SPRITES,
				FEATURE_IDS.TMFX_EDITOR,
				FEATURE_IDS.SHEET_STYLING
			)
			&& typeof gsap !== "undefined"
			&& typeof PixiPlugin !== "undefined"
		) {
			gsap.registerPlugin(PixiPlugin);
			console.log("Shadowdark Extras | Registered GSAP PixiPlugin");
		}
	}
	catch(err) {
		console.error("Shadowdark Extras | Failed to register GSAP PixiPlugin:", err);
	}

	// Backport Shadowdark 4.0 fix: suppress AEs from stashed / unequipped / unidentified items
	if (featureEnabled(FEATURE_IDS.SOURCE_REQUIREMENTS)) patchArmorActiveEffects();
	if (featureEnabled(FEATURE_IDS.ITEM_PILES)) initItemPilesCompatibility();

	// Allow SDX-painted hex tiles to keep their true position at the scene's
	// left/top edge instead of being clamped inward (fixes first-column / top-row
	// hex misalignment). See patchHexTilePositionClamp for the full rationale.
	if (featureEnabled(FEATURE_IDS.HEX_PAINTER)) patchHexTilePositionClamp();

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
	if (anyFeatureEnabled(
		FEATURE_IDS.DRAWING_TOOLS,
		FEATURE_IDS.LIGHT_TRACKER,
		FEATURE_IDS.SPELL_ACTIVITY,
		FEATURE_IDS.MYSTERIOUS_CASTING,
		FEATURE_IDS.SHEET_LOCKING,
		FEATURE_IDS.TOM_SCENES,
		FEATURE_IDS.WALL_CONTEXT_MENU,
		FEATURE_IDS.SHEET_STYLING
	)) Hooks.once("ready", () => {
		// Add a bypass flag for template targeting to allow multi-targeting for players
		if (anyFeatureEnabled(FEATURE_IDS.DRAWING_TOOLS, FEATURE_IDS.SPELL_ACTIVITY)) {
			game.shadowdarkExtras = game.shadowdarkExtras || {};
		}
		if (featureEnabled(FEATURE_IDS.SPELL_ACTIVITY)) {
			game.shadowdarkExtras.allowMultiTarget = false;
		}

		// Initialize Drawing Tools
		if (featureEnabled(FEATURE_IDS.DRAWING_TOOLS)) {
			game.shadowdarkExtras.drawingTool = sdxDrawingTool;
			game.shadowdarkExtras.drawingToolbar = sdxDrawingToolbar;
			sdxDrawingTool.initialize();
		}

		// Initialize Light Tracker AppV2
		if (featureEnabled(FEATURE_IDS.LIGHT_TRACKER)) initLightTrackerApp();

		if (
			featureEnabled(FEATURE_IDS.SPELL_ACTIVITY)
			&& typeof game.user.updateTokenTargets !== "function"
		) {
			game.user.updateTokenTargets = function(tokenIds = []) {
				// If the bypass flag is set, don't restrict targeting
				if (game.shadowdarkExtras?.allowMultiTarget) {
					return;
				}
				// Clear current targets and set new ones
				const tokens = tokenIds.map(id => canvas.tokens.get(id)).filter(t => t);
				canvas.tokens.targetObjects(
					Object.fromEntries(tokens.map(t => [t.id, true])),
					{ releaseOthers: true }
				);
			};
			console.log("Shadowdark Extras | Added polyfill for game.user.updateTokenTargets");
		}
	});

	if (featureEnabled(FEATURE_IDS.MYSTERIOUS_CASTING)) initMysteriousCasting();
	if (featureEnabled(FEATURE_IDS.SHEET_LOCKING)) SheetLockManager.init();
	if (featureEnabled(FEATURE_IDS.TOM_SCENES)) TomSD.initialize();
	if (featureEnabled(FEATURE_IDS.WALL_CONTEXT_MENU)) WallContextMenuSD.initialize();

	// Register Custom Fonts
	const SDX_FONTS = featureEnabled(FEATURE_IDS.SHEET_STYLING) ? [
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
	] : [];

	if (SDX_FONTS.length) {
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
	}
}

initializeEarlyFeatures();


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

// Initialize during Foundry's init phase (the bootstrap imports this module there).
function initializeFeatures() {
	if (featureEnabled(FEATURE_IDS.DUNGEON_PAINTER)) {
		registerDungeonPainterSettings();
		registerDungeonBiomeSettings();
		registerBiomeEditorDelegation();
	}

	// Initialize Automated Animations integration
	if (featureEnabled(FEATURE_IDS.AUTOMATED_ANIMATIONS)) initAutoAnimationsIntegration();

	// Register SDX-native Sequencer animation FX settings + master-list menu
	if (featureEnabled(FEATURE_IDS.ANIMATION_FX)) AnimationFxSD.registerSettings();
	if (featureEnabled(FEATURE_IDS.ANIMATION_FX)) registerAnimationFxMenu();

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
	if (featureEnabled(FEATURE_IDS.ANIMATION_FX)) {
		Hooks.on("sequencer.ready", () => {
			Promise.resolve().then(() => AnimationFxSD.ensureJb2aRegistered());
		});
	}

	// First-run: seed the bundled preset libraries into any world that has
	// never been seeded, so new worlds come up fully populated (GM-only,
	// one-time, merge-not-overwrite — see AnimationFxSD.autoSeedIfNeeded).
	if (featureEnabled(FEATURE_IDS.ANIMATION_FX)) {
		Hooks.once("ready", () => AnimationFxSD.initializeDefaults());
	}

	// Patch CharacterGeneratorSD to show rolls in chat
	if (featureEnabled(FEATURE_IDS.CHARACTER_GENERATOR)) patchCharacterGeneratorRolls();


	// Register Handlebars helpers
	Handlebars.registerHelper("numberSigned", value => {
		const num = parseInt(value) || 0;
		return num >= 0 ? `+${num}` : `${num}`;
	});

	// Helper for simple math operations in templates
	Handlebars.registerHelper("add", (a, b) => {
		return (parseInt(a) || 0) + (parseInt(b) || 0);
	});

	// Preload only templates owned by enabled features.
	const templates = [];
	const addTemplates = (...paths) => templates.push(
		...paths.map(path => `modules/${MODULE_ID}/templates/${path}`)
	);
	if (featureEnabled(FEATURE_IDS.NPC_INVENTORY)) addTemplates("npc-inventory.hbs");
	if (featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) addTemplates("party.hbs");
	if (featureEnabled(FEATURE_IDS.TRADING)) addTemplates("trade-window.hbs");
	if (featureEnabled(FEATURE_IDS.JOURNAL_NOTES)) {
		addTemplates("journal-notes.hbs", "journal-editor.hbs");
	}
	if (featureEnabled(FEATURE_IDS.MAGIC_ITEM_SHEETS)) addTemplates(
		"potion-sheet/header.hbs",
		"potion-sheet/tabs.hbs",
		"potion-sheet/details.hbs",
		"potion-sheet/activity.hbs",
		"potion-sheet/description.hbs",
		"staff-spell-config.hbs"
	);
	if (featureEnabled(FEATURE_IDS.BACKGROUND_ADVANCEMENT)) addTemplates(
		"background-sheet/header.hbs",
		"background-sheet/tabs.hbs",
		"background-sheet/description.hbs",
		"background-sheet/advancement.hbs"
	);
	if (featureEnabled(FEATURE_IDS.NPC_CUSTOM_SHEETS)) addTemplates(
		"npc-attack-sheet/header.hbs",
		"npc-attack-sheet/tabs.hbs",
		"npc-attack-sheet/details.hbs",
		"npc-attack-sheet/description.hbs",
		"npc-attack-sheet/source.hbs"
	);
	if (featureEnabled(FEATURE_IDS.ITEM_MACROS)) addTemplates(
		"class-ability-sheet/header.hbs",
		"class-ability-sheet/tabs.hbs",
		"class-ability-sheet/details.hbs",
		"class-ability-sheet/description.hbs",
		"class-ability-sheet/macro.hbs"
	);
	if (templates.length) {
		(foundry.applications?.handlebars?.loadTemplates || loadTemplates)(templates);
	}

	// Register the Party sheet early
	if (featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) registerPartySheet();

	// Register the Potion sheet
	if (featureEnabled(FEATURE_IDS.MAGIC_ITEM_SHEETS)) registerPotionSheet();

	// Register the Background sheet
	if (featureEnabled(FEATURE_IDS.BACKGROUND_ADVANCEMENT)) registerBackgroundSheet();

	// Register the NPC Attack sheet
	if (featureEnabled(FEATURE_IDS.NPC_CUSTOM_SHEETS)) registerNPCAttackSheet();

	// Register the NPC Feature sheet
	if (featureEnabled(FEATURE_IDS.NPC_CUSTOM_SHEETS)) registerNPCFeatureSheet();

	// Register the Class Ability sheet
	if (featureEnabled(FEATURE_IDS.ITEM_MACROS)) registerClassAbilitySheet();

	// Wrap Actor.create to handle Party type conversion
	if (featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) wrapActorCreate();

	// Initialize settings and early styles
	registerSettings();
	if (featureEnabled(FEATURE_IDS.SHEET_STYLING)) applySheetDecorationStyles();
	setupSettingsOrganization();
}

initializeFeatures();

// Journal chrome: hide the internal sync journals, add the headings toggle
if (anyFeatureEnabled(
	FEATURE_IDS.JOURNAL_NOTES,
	FEATURE_IDS.TRADING,
	FEATURE_IDS.CAROUSING,
	FEATURE_IDS.HEX_TOOLTIP
)) {
	registerJournalUIHooks();
}

// Setup after Shadowdark system is ready
Hooks.once("ready", async () => {
	// Only run if Shadowdark system is active
	if (game.system.id !== "shadowdark") {
		console.warn(`${MODULE_ID} | This module requires the Shadowdark RPG system`);
		return;
	}

	// Shadowdark 4.x owns renown natively. Reconcile the retired SDX actor flag
	// once from the primary GM client, then remove it to keep one source of truth.
	if (
		featureEnabled(FEATURE_IDS.CAROUSING) && game.user.isGM
		&& (!game.users.activeGM || game.users.activeGM.id === game.user.id)
	) {
		const migratedRenown = await migrateLegacyRenown(game.actors);
		if (migratedRenown > 0) {
			console.log(`${MODULE_ID} | Migrated native renown for ${migratedRenown} actor(s)`);
		}
	}


	if (featureEnabled(FEATURE_IDS.MAGIC_ITEM_SHEETS)) {
		extendLightSources();
		patchLightSourceMappings();
		patchCanUseMagicItems();
	}
	if (featureEnabled(FEATURE_IDS.CHARACTER_GENERATOR)) extendActorCreationDialog();
	if (featureEnabled(FEATURE_IDS.PLAYER_TRANSFERS)) {
		patchCtrlMoveOnActorSheetDrops();
		patchPlayerSheetForTransfers();
	}
	if (featureEnabled(FEATURE_IDS.ENHANCED_TABS)) patchPlayerSheetUseAbility();
	if (featureEnabled(FEATURE_IDS.TRADING)) initializeTradeSocket();


	// Initialize the shared socket only when at least one owning feature needs it.
	const needsCombatSocket = anyFeatureEnabled(
		FEATURE_IDS.DAMAGE_CARDS,
		FEATURE_IDS.SCROLLING_COMBAT_TEXT,
		FEATURE_IDS.SPELL_ACTIVITY,
		FEATURE_IDS.PREDEFINED_EFFECTS,
		FEATURE_IDS.FOCUS_TRACKER,
		FEATURE_IDS.BREAK_ON_DAMAGE,
		FEATURE_IDS.TEMPLATE_EFFECTS,
		FEATURE_IDS.AURAS,
		FEATURE_IDS.TRADING,
		FEATURE_IDS.ITEM_MACROS,
		FEATURE_IDS.PLAYER_TRANSFERS,
		FEATURE_IDS.ENHANCED_HEADER
	);
	if (needsCombatSocket && typeof socketlib !== "undefined") {
		setupCombatSocket();
	}
	else if (featureEnabled(FEATURE_IDS.DAMAGE_CARDS)) {
		console.warn(`${MODULE_ID} | socketlib not found, damage application may not work for non-GMs`);
	}

	// Initialize Focus Spell Tracker if enabled
	if (featureEnabled(FEATURE_IDS.FOCUS_TRACKER) && game.settings.get(MODULE_ID, "enableFocusTracker")) {
		initFocusSpellTracker();
	}

	// Break-on-damage effect expiry (marker-driven; hooks are inert until an
	// effect carries flags.shadowdark-extras.breakOnDamage). Safe to run always.
	if (featureEnabled(FEATURE_IDS.BREAK_ON_DAMAGE)) initBreakOnDamage();

	// Setup wand uses blocking (prevent casting depleted wands)
	if (featureEnabled(FEATURE_IDS.MAGIC_ITEM_SHEETS) && game.settings.get(MODULE_ID, "enableWandUses")) {
		setupWandUsesBlocker();
	}

	// Setup silenced casting blocking
	if (featureEnabled(FEATURE_IDS.CASTING_BLOCKERS)) setupSilencedCastingBlocker();

	// Patch getPhysicalItems to exclude items inside SDX containers (SD 4.x
	// made isPhysical a hardcoded getter, so setting it to false no longer works)
	if (featureEnabled(FEATURE_IDS.CONTAINERS)) patchGetPhysicalItemsForContainers();

	// Setup consolidated rollAttack patches
	if (anyFeatureEnabled(
		FEATURE_IDS.DAMAGE_CARDS, FEATURE_IDS.AMMUNITION
	)) {
		setupRollAttackPatches();
	}

	// Setup roll config generators and dialog hooks
	if (anyFeatureEnabled(
		FEATURE_IDS.WEAPON_BONUSES,
		FEATURE_IDS.AMMUNITION,
		FEATURE_IDS.ENHANCED_TABS
	)) {
		setupRollConfigPatches();
	}

	// Setup scrolling combat text (floating damage/healing numbers)
	if (featureEnabled(FEATURE_IDS.SCROLLING_COMBAT_TEXT)) setupScrollingCombatText();

	// Setup torch animations (requires Sequencer and JB2A)
	if (featureEnabled(FEATURE_IDS.TORCH_ANIMATIONS)) initTorchAnimations();

	// Setup weapon animations (requires Sequencer)
	if (featureEnabled(FEATURE_IDS.WEAPON_SPRITES)) initWeaponAnimations();

	// Setup level-up token animations (requires Sequencer)
	if (featureEnabled(FEATURE_IDS.LEVEL_UP_ANIMATIONS)) initLevelUpAnimations();

	// Initialize Template Effects System (damage/effects for tokens in templates)
	if (featureEnabled(FEATURE_IDS.TEMPLATE_EFFECTS)) initTemplateEffects();

	// Initialize Aura Effects System (token-attached effects that follow bearer)
	if (featureEnabled(FEATURE_IDS.AURAS)) initAuraEffects();

	// Initialize Marching Mode (GM-only token following system)
	if (featureEnabled(FEATURE_IDS.MARCHING_MODE)) initMarchingMode();
	if (featureEnabled(FEATURE_IDS.FORMATION_SPAWNER)) initFormationSpawner();
	if (anyFeatureEnabled(
		FEATURE_IDS.MARCHING_MODE,
		FEATURE_IDS.FORMATION_SPAWNER,
		FEATURE_IDS.JOURNAL_PINS,
		FEATURE_IDS.CAROUSING
	)) initSidebarTools();

	if (featureEnabled(FEATURE_IDS.LIGHT_TRACKER)) patchLightSourceTrackerForParty();

	// Patch NPC sheets to add _toggleLightSource method
	// The Shadowdark system's ActorSheetSD._deleteItem tries to call this method,
	// but it only exists on PlayerSheetSD, causing errors when deleting torch items from NPCs
	if (featureEnabled(FEATURE_IDS.LIGHT_TRACKER) && globalThis.shadowdark?.sheets?.NpcSheetSD) {
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
	if (featureEnabled(FEATURE_IDS.SPELL_ACTIVITY) && globalThis.shadowdark?.documents?.ActorSD) {
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
	if (featureEnabled(FEATURE_IDS.TRADING)) await ensureTradeJournal();

	// Ensure carousing journal exists and initialize sync (GM only creates it)
	if (featureEnabled(FEATURE_IDS.CAROUSING)) {
		await ensureCarousingJournal();
		await ensureCarousingTablesJournal();
		initCarousingSocket();
	}

	// SDX Roller socket listener
	if (featureEnabled(FEATURE_IDS.SDX_ROLLER)) {
		game.socket.on(`module.${MODULE_ID}`, data => {
			if (data.action?.startsWith("sdxRoller")) {
				SDXRollerApp.handleSocketMessage(data);
			}
		});
	}

	// Register global callback for carousing overlay refresh
	if (featureEnabled(FEATURE_IDS.CAROUSING)) {
		window.sdxCarousingOverlayRefresh = refreshCarousingOverlay;
		window.sdxOpenCarousingOverlay = openCarousingOverlay;
	}
});

// Flag preservation on item creation moved to items/item-flag-preservation.mjs.
if (anyFeatureEnabled(
	FEATURE_IDS.SPELL_ACTIVITY,
	FEATURE_IDS.ITEM_MACROS,
	FEATURE_IDS.TEMPLATE_EFFECTS,
	FEATURE_IDS.AURAS
)) {
	registerItemCreateFlagPreservation();
}


// Before party actor is created, ensure proper prototype token settings
if (featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) Hooks.on("preCreateActor", (actor, data, options, userId) => {
	if (!featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) return;
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
if (featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) Hooks.on("createActor", async (actor, options, userId) => {
	if (!featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) return;
	if (game.user.id !== userId) return;

	// If this is a newly created party, set the party sheet as default
	if (isPartyActor(actor)) {
		// Set the Party sheet as the default for this actor
		await actor.setFlag("core", "sheetClass", `${MODULE_ID}.PartySheetSD`);
	}
});

// Inject Renown into player sheets
if (anyFeatureEnabled(
	FEATURE_IDS.ENHANCED_HEADER,
	FEATURE_IDS.ENHANCED_TABS,
	FEATURE_IDS.SKILLS_BOX,
	FEATURE_IDS.MAGIC_ITEM_SHEETS,
	FEATURE_IDS.GEM_ENHANCEMENTS,
	FEATURE_IDS.CONTAINERS,
	FEATURE_IDS.MULTI_SELECT,
	FEATURE_IDS.TRADING,
	FEATURE_IDS.ADD_COINS,
	FEATURE_IDS.INVENTORY_STYLING,
	FEATURE_IDS.SHEET_STYLING,
	FEATURE_IDS.JOURNAL_NOTES,
	FEATURE_IDS.QUICK_CONDITIONS,
	FEATURE_IDS.ITEM_MACROS
)) Hooks.on("renderPlayerSheetSD", async (app, html, data) => {
	if (app.actor?.type !== "Player") return;

	if (featureEnabled(FEATURE_IDS.ENHANCED_HEADER)) {
		await injectEnhancedHeader(app, html, app.actor);
		attachNativeHpQuickControls(app, html, app.actor);
	}
	if (featureEnabled(FEATURE_IDS.ENHANCED_TABS)) {
		enhanceDetailsTab(app, html, app.actor);
		enhanceAbilitiesTab(app, html, app.actor);
		enhanceSpellsTab(app, html, app.actor);
		enhanceTalentsTab(app, html, app.actor);
		enhanceInventoryTab(app, html, app.actor);
		enhanceEffectsTab(app, html, app.actor);
	}
	if (featureEnabled(FEATURE_IDS.SKILLS_BOX)) injectSkillsBox(html, app.actor);
	if (featureEnabled(FEATURE_IDS.MAGIC_ITEM_SHEETS)) {
		await injectStaffSpellsUI(app, html, data);
		injectWeaponSpellRechargeButtons(app, html, app.actor);
	}
	if (featureEnabled(FEATURE_IDS.GEM_ENHANCEMENTS)) {
		enhanceGemInventory(app, html, app.actor);
	}
	if (featureEnabled(FEATURE_IDS.CONTAINERS)) attachContainerContentsToActorSheet(app, html);
	if (featureEnabled(FEATURE_IDS.MULTI_SELECT)) {
		enhanceInventoryWithDeleteAndMultiSelect(app, html);
	}
	if (featureEnabled(FEATURE_IDS.TRADING)) injectTradeButton(html, app.actor);
	if (featureEnabled(FEATURE_IDS.ADD_COINS)) injectAddCoinsButton(html, app.actor);
	if (featureEnabled(FEATURE_IDS.INVENTORY_STYLING)) {
		applyInventoryStylesToSheet(html, app.actor);
	}
	if (featureEnabled(FEATURE_IDS.SHEET_STYLING)) {
		injectHeaderCustomization(app, html, app.actor);
	}
	if (featureEnabled(FEATURE_IDS.JOURNAL_NOTES)) {
		await injectJournalNotes(app, html, app.actor);
	}
	if (featureEnabled(FEATURE_IDS.QUICK_CONDITIONS)) {
		await injectConditionsToggles(app, html, app.actor);
	}
	// if (!game.settings.get(MODULE_ID, "tray.enabled")) {
	// 	await injectCarousingButton(app, html, app.actor);
	// }
	if (featureEnabled(FEATURE_IDS.ITEM_MACROS)) enableItemChatIcon(app, html);
});

// applyNpcPlayerTheme moved to npc/npc-sheet-inventory.mjs

// Inject Inventory tab into NPC sheets (but not Party sheets)
if (anyFeatureEnabled(
	FEATURE_IDS.SHEET_STYLING,
	FEATURE_IDS.ENHANCED_HEADER,
	FEATURE_IDS.NPC_INVENTORY,
	FEATURE_IDS.CONTAINERS,
	FEATURE_IDS.INVENTORY_STYLING,
	FEATURE_IDS.ITEM_MACROS,
	FEATURE_IDS.QUICK_CONDITIONS
)) Hooks.on("renderNpcSheetSD", async (app, html, data) => {
	if (app.actor?.type !== "NPC") return;

	// Don't inject into Party actors (they have their own inventory)
	if (isPartyActor(app.actor)) return;

	if (featureEnabled(FEATURE_IDS.SHEET_STYLING)) applyNpcPlayerTheme(app, html, app.actor);
	if (featureEnabled(FEATURE_IDS.ENHANCED_HEADER)) {
		attachNativeHpQuickControls(app, html, app.actor);
	}

	if (
		featureEnabled(FEATURE_IDS.NPC_INVENTORY)
		&& game.settings.get(MODULE_ID, "enableNpcInventory")
	) {
		await injectNpcInventoryTab(app, html, data);
		patchNpcSheetForItemDrops(app);
	}
	if (featureEnabled(FEATURE_IDS.CONTAINERS)) attachContainerContentsToActorSheet(app, html);
	if (featureEnabled(FEATURE_IDS.INVENTORY_STYLING)) {
		applyInventoryStylesToSheet(html, app.actor);
	}
	if (featureEnabled(FEATURE_IDS.ITEM_MACROS)) enableItemChatIcon(app, html);
	if (featureEnabled(FEATURE_IDS.QUICK_CONDITIONS)) {
		await injectConditionsToggles(app, html, app.actor);
	}
});

// Inject Creature Type dropdown into NPC sheets
if (featureEnabled(FEATURE_IDS.NPC_CREATURE_TYPES)) Hooks.on("renderNpcSheetSD", (app, html, data) => {
	if (!featureEnabled(FEATURE_IDS.NPC_CREATURE_TYPES)) return;
	if (app.actor?.type !== "NPC") return;

	// Don't inject into Party actors
	if (isPartyActor(app.actor)) return;

	if (featureEnabled(FEATURE_IDS.SHEET_STYLING)) applyNpcPlayerTheme(app, html, app.actor);
	if (featureEnabled(FEATURE_IDS.ENHANCED_HEADER)) {
		attachNativeHpQuickControls(app, html, app.actor);
	}

	// Inject the creature type dropdown (before ATTACKS section)
	injectNpcCreatureType(app, html, app.actor);
});

// Apply inventory styles to Party sheets
if (featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) Hooks.on("renderActorSheet", (app, html, data) => {
	if (!featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) return;
	// Only handle Party sheets
	if (!(app instanceof PartySheetSD)) return;
	if (!isPartyActor(app.actor)) return;

	if (featureEnabled(FEATURE_IDS.INVENTORY_STYLING)) {
		applyInventoryStylesToSheet(html, app.actor);
	}
	if (featureEnabled(FEATURE_IDS.SHEET_STYLING)) {
		injectPartyHeaderCustomization(app, html, app.actor);
	}
});

// Weapon ("staff") spells live in `item-sheets/staff-spells.mjs`. This call sits
// where that module's `updateItem` hook did, so its place in the registration
// order is unchanged.
if (featureEnabled(FEATURE_IDS.MAGIC_ITEM_SHEETS)) registerStaffSpellHooks();


// Inject container UI into Basic item sheets
if (anyFeatureEnabled(
	FEATURE_IDS.CONTAINERS,
	FEATURE_IDS.AMMUNITION,
	FEATURE_IDS.SPELL_ACTIVITY,
	FEATURE_IDS.SPELL_CONFIGS,
	FEATURE_IDS.TEMPLATE_EFFECTS,
	FEATURE_IDS.AURAS,
	FEATURE_IDS.MAGIC_ITEM_SHEETS,
	FEATURE_IDS.ITEM_MACROS,
	FEATURE_IDS.ANIMATION_ITEM_OVERRIDES,
	FEATURE_IDS.WEAPON_BONUSES,
	FEATURE_IDS.DAMAGE_TYPES,
	FEATURE_IDS.WEAPON_SPRITES,
	FEATURE_IDS.UNIDENTIFIED_ITEMS
)) Hooks.on("renderItemSheet", (app, html, data) => {
	try {
		if (featureEnabled(FEATURE_IDS.CONTAINERS)) injectBasicContainerUI(app, html);
		if (featureEnabled(FEATURE_IDS.AMMUNITION)) injectAmmunitionBonuses(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to inject Basic item container UI`, err);
	}

	try {
		if (anyFeatureEnabled(
			FEATURE_IDS.SPELL_ACTIVITY,
			FEATURE_IDS.SPELL_CONFIGS,
			FEATURE_IDS.TEMPLATE_EFFECTS,
			FEATURE_IDS.AURAS,
			FEATURE_IDS.ITEM_MACROS,
			FEATURE_IDS.ANIMATION_ITEM_OVERRIDES
		)) enhanceSpellSheet(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to enhance spell sheet`, err);
	}

	try {
		if (featureEnabled(FEATURE_IDS.SPELL_ACTIVITY)) injectSpellAlignmentField(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to inject spell alignment field`, err);
	}

	try {
		if (anyFeatureEnabled(
			FEATURE_IDS.MAGIC_ITEM_SHEETS,
			FEATURE_IDS.SPELL_CONFIGS,
			FEATURE_IDS.ITEM_MACROS
		)) enhancePotionSheet(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to enhance potion sheet`, err);
	}

	try {
		if (anyFeatureEnabled(
			FEATURE_IDS.MAGIC_ITEM_SHEETS,
			FEATURE_IDS.SPELL_CONFIGS,
			FEATURE_IDS.ITEM_MACROS,
			FEATURE_IDS.ANIMATION_ITEM_OVERRIDES
		)) enhanceScrollSheet(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to enhance scroll sheet`, err);
	}

	try {
		if (anyFeatureEnabled(
			FEATURE_IDS.MAGIC_ITEM_SHEETS,
			FEATURE_IDS.SPELL_CONFIGS,
			FEATURE_IDS.ITEM_MACROS,
			FEATURE_IDS.ANIMATION_ITEM_OVERRIDES
		)) enhanceWandSheet(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to enhance wand sheet`, err);
	}

	// Inject weapon bonus tab
	try {
		const item = app.item || app.document;
		if (item?.type === "Weapon") {
			if (featureEnabled(FEATURE_IDS.WEAPON_BONUSES)) {
				injectWeaponBonusTab(app, html, item);
			}
			// Attack FX and Equipped Sprite are independent controls and gates.
			injectWeaponAnimationButton(html, item);
			if (featureEnabled(FEATURE_IDS.DAMAGE_TYPES)) {
				injectWeaponDamageTypeDropdown(app, html, item);
			}
			if (featureEnabled(FEATURE_IDS.MAGIC_ITEM_SHEETS)) {
				injectStaffSpellButton(app, html, item);
			}
		}
		else if (featureEnabled(FEATURE_IDS.WEAPON_SPRITES) && item?.type === "Armor") {
			// Shields expose only Equipped Sprite.
			injectWeaponAnimationButton(html, item);
		}
		else if (item?.type === "Spell"
			&& featureEnabled(FEATURE_IDS.ANIMATION_ITEM_OVERRIDES)) injectWeaponAnimationButton(html, item);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to inject weapon bonus tab`, err);
	}


	// Hide already-rendered Effects tab elements for non-GM players viewing unidentified items
	try {
		const item = app?.item;
		if (
			featureEnabled(FEATURE_IDS.UNIDENTIFIED_ITEMS)
			&& item && isUnidentified(item) && !game.user?.isGM
		) {
			html.find('a[data-tab="tab-effects"]').remove();
			html.find('.tab[data-tab="tab-effects"]').remove();
		}
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to hide effects tab`, err);
	}

	// Enhance Gem item sheet with quantity field
	try {
		if (featureEnabled(FEATURE_IDS.GEM_ENHANCEMENTS)) enhanceGemSheet(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to enhance gem sheet`, err);
	}
});

// V1/V2 header button bridge for SDX's AppV2 item sheets
if (anyFeatureEnabled(
	FEATURE_IDS.MAGIC_ITEM_SHEETS,
	FEATURE_IDS.NPC_CUSTOM_SHEETS,
	FEATURE_IDS.BACKGROUND_ADVANCEMENT,
	FEATURE_IDS.ITEM_MACROS
)) registerAppV2HeaderBridge();

// Convert string values to booleans for spell damage flags
if (featureEnabled(FEATURE_IDS.SPELL_ACTIVITY)) Hooks.on("preUpdateItem", (item, updateData, options, userId) => {
	if (!featureEnabled(FEATURE_IDS.SPELL_ACTIVITY)) return;
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
if (anyFeatureEnabled(
	FEATURE_IDS.DAMAGE_CARDS,
	FEATURE_IDS.WEAPON_BONUSES,
	FEATURE_IDS.ITEM_MACROS,
	FEATURE_IDS.ANIMATION_FX
)) {
	registerChatCardHooks();
}

// The unidentified magicItem context wrap moved to
// inventory/UnidentifiedDisplaySD.mjs, beside the GM display it mirrors.
if (featureEnabled(FEATURE_IDS.UNIDENTIFIED_ITEMS)) initUnidentifiedSheetContext();

// Shadowdark's createItemFromSpell strips module flags; the wrap that puts
// them back lives in items/item-flag-preservation.mjs.
if (anyFeatureEnabled(
	FEATURE_IDS.SPELL_ACTIVITY,
	FEATURE_IDS.UNIDENTIFIED_ITEMS,
	FEATURE_IDS.ITEM_MACROS,
	FEATURE_IDS.TEMPLATE_EFFECTS,
	FEATURE_IDS.AURAS
)) registerSpellItemFlagPreservation();

// Container hooks live in inventory/containers.mjs; registered here to keep source order.
if (featureEnabled(FEATURE_IDS.CONTAINERS)) registerContainerHooks();


// The two container-deletion hooks moved into inventory/containers.mjs and
// now register at the end of registerContainerHooks() above, which keeps the
// original order: updateItem, createItem, preDeleteItem, deleteItem.

// Handle updates when the sheet is submitted
if (featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
	if (!featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) return;
	// Validate NPC coins
	if (changes.flags?.[MODULE_ID]?.coins) {
		const coins = changes.flags[MODULE_ID].coins;
		if (coins.gp !== undefined) coins.gp = Math.max(0, parseInt(coins.gp) || 0);
		if (coins.sp !== undefined) coins.sp = Math.max(0, parseInt(coins.sp) || 0);
		if (coins.cp !== undefined) coins.cp = Math.max(0, parseInt(coins.cp) || 0);
	}
});

// Party sheets re-render when a member changes; registered here to keep hook order
if (featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) registerPartySheetRerenderHooks();

// Background advancement grants on background-set and level-up; registered here to keep hook order
if (featureEnabled(FEATURE_IDS.BACKGROUND_ADVANCEMENT)) registerBackgroundAdvancementHooks();

// Freya's Omen reroll button on critically-failed spell cards; registered here to keep hook order
if (featureEnabled(FEATURE_IDS.FREYAS_OMEN)) registerFreyasOmenHooks();

// Party membership cleanup on actor delete; registered here to keep hook order
if (featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) registerPartyCleanupHooks();

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
if (featureEnabled(FEATURE_IDS.AMMUNITION)) registerAmmunitionPatches();

// ============================================
// AMMUNITION BONUS UI INJECTION
// ============================================
// injectAmmunitionBonuses moved to inventory/ammunition-bonuses.mjs

// ============================================
// ABILITY ADVANTAGE PREDEFINED EFFECTS
// ============================================
// Moved to effects/predefined-effects.mjs. Called here so its init hook keeps
// its position relative to every other registration.
if (featureEnabled(FEATURE_IDS.PREDEFINED_EFFECTS)) registerPredefinedEffects();

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
if (featureEnabled(FEATURE_IDS.INVISIBILITY)) registerInvisibilityHooks();


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
if (anyFeatureEnabled(
	FEATURE_IDS.ITEM_MACROS,
	FEATURE_IDS.SPELL_ACTIVITY,
	FEATURE_IDS.PARTY_MANAGEMENT,
	FEATURE_IDS.TEMPLATE_EFFECTS
)) Hooks.once("ready", () => {
	const macroExecuteSocket = anyFeatureEnabled(
		FEATURE_IDS.ITEM_MACROS,
		FEATURE_IDS.SPELL_ACTIVITY,
		FEATURE_IDS.PARTY_MANAGEMENT,
		FEATURE_IDS.TEMPLATE_EFFECTS
	) ? initMacroExecuteSocket() : null;
	if (macroExecuteSocket) {
		// Each feature registers its own handlers on the shared socket. They are
		// called here, in their original order, so this hook is the single place
		// socket registration order is decided — and the single place that has to
		// stay free of awaits.
		if (featureEnabled(FEATURE_IDS.ITEM_MACROS)) {
			registerEffectMacroSocket(macroExecuteSocket);
			registerItemMacroSocket(macroExecuteSocket);
		}
		if (featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) {
			registerPartyTravelSocket(macroExecuteSocket);
		}
		if (featureEnabled(FEATURE_IDS.TEMPLATE_EFFECTS)) {
			registerTemplateTargetSyncSocket(macroExecuteSocket);
		}
		if (featureEnabled(FEATURE_IDS.PARTY_MANAGEMENT)) {
			registerPartyStatsSocket(macroExecuteSocket);
		}

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
	if (featureEnabled(FEATURE_IDS.ITEM_MACROS)) await migrateLegacyItemMacros();
});

// Moved to item-macros/effect-trigger-macros.mjs, all five hooks together with
// the two functions behind them. Called here so their position relative to every
// other registration is unchanged.
if (featureEnabled(FEATURE_IDS.ITEM_MACROS)) registerEffectTriggerHooks();

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
if (featureEnabled(FEATURE_IDS.ITEM_MACROS)) registerSpellItemMacroSocket();

/**
 * Hook into chat message rendering to bind Shapechanger revert button
 */
if (featureEnabled(FEATURE_IDS.ITEM_MACROS)) Hooks.on("renderChatMessageHTML", (message, html, context) => {
	if (!featureEnabled(FEATURE_IDS.ITEM_MACROS)) return;
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
if (anyFeatureEnabled(FEATURE_IDS.ITEM_MACROS, FEATURE_IDS.ANIMATION_FX)) {
	registerChatDispatch();
}

// ============================================
// NPC FEATURE ITEM MACRO EXECUTION
// ============================================

// Moved to item-macros/npc-feature-macros.mjs. Called here so both of its ready
// registrations keep their position relative to every other registration. A
// third, empty ready hook ("Redundant handler removed") was dropped rather than
// carried — an empty callback has no behaviour to preserve.
if (featureEnabled(FEATURE_IDS.ITEM_MACROS)) registerNPCFeatureItemMacros();


// ============================================
// CLASS ABILITY ITEM MACRO EXECUTION
// ============================================
// Moved to item-macros/class-ability-macros.mjs. Called here so both of its
// ready registrations keep their position relative to every other registration.
if (featureEnabled(FEATURE_IDS.ITEM_MACROS)) registerClassAbilityItemMacros();


// ============================================
// SDX TEMPLATES API
// ============================================
// Moved to api/templates.mjs, together with the two scene-level helpers only
// it uses and the square-template rotation fix. Called here rather than run on
// import so `globalThis.SDX` is created at exactly this point in this file's
// evaluation — the DEV HELPERS block below assigns `SDX.dev` onto it.
// The call stays unconditional; its two effects are gated separately. The
// prototype override is Spell Activity's, but SDX.templates is co-owned with
// Damage Cards, whose targeting path calls SDX.templates.placeAndTarget.
registerTemplatesApi({
	installRotationFix: featureEnabled(FEATURE_IDS.SPELL_ACTIVITY),
	publishApi: featureEnabled(FEATURE_IDS.SPELL_ACTIVITY) || featureEnabled(FEATURE_IDS.DAMAGE_CARDS),
});

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

		// One owner or several: a key survives while ANY owner is still enabled, so
		// a shared API is not torn out from under a feature that never depended on
		// the one being disabled.
		const removeApi = (featureIds, keys) => {
			const owners = Array.isArray(featureIds) ? featureIds : [featureIds];
			if (owners.some(featureId => featureEnabled(featureId))) return;
			for (const key of keys) delete module.api[key];
		};
		// "dev" deliberately absent: SDX.dev.castSpell calls the SYSTEM's
		// actor.system.castSpell, so gating it here only broke the headless probe.
		removeApi(FEATURE_IDS.SPELL_ACTIVITY, ["templates", "applySpellEffect"]);
		removeApi([FEATURE_IDS.SPELL_ACTIVITY, FEATURE_IDS.ITEM_MACROS], ["startDurationSpell", "endDurationSpell", "registerSpellModification", "getActiveDurationSpells"]);
		removeApi(FEATURE_IDS.NPC_CREATURE_TYPES, ["getCreatureType", "getMappedCreatureType"]);
		removeApi(FEATURE_IDS.BREAK_ON_DAMAGE, ["breakEffectOnDamage", "clearBreakOnDamage"]);
		removeApi(FEATURE_IDS.MEDKIT, ["registerMedkitPack", "unregisterMedkitPack", "getMedkitPacks", "scanWorldForUpdates", "applyWorldMedkitUpdates", "medkitScanWorld"]);
		removeApi(FEATURE_IDS.QUICK_CONDITIONS, ["showConditionsModal", "getConditionsData"]);
		removeApi(FEATURE_IDS.DUNGEON_PAINTER, ["generateDungeon", "getGeneratorSettings", "setGeneratorSettings", "generateRandomSeed", "buildHexDungeonScene", "getBiomeDefinitions", "getCustomBiomes", "setCustomBiome", "removeCustomBiome", "resetCustomBiomes", "getEnabledBiomeKeys", "getDisabledBiomes", "setBiomeEnabled", "openBiomeEditor", "placeChangeLevelRegion", "placeDungeonSurface", "placeDungeonDecor", "internal"]);
		removeApi(FEATURE_IDS.HEX_PAINTER, ["generateHexMap", "clearGeneratedTiles", "buildHexcrawl", "buildHexcrawlFromFile"]);
	}
});

// ============================================
// PARTY TOKEN LIGHT SYNCHRONIZATION HOOKS
// ============================================

// Sync party light when an item is updated (e.g., light toggled)
if (featureEnabled(FEATURE_IDS.LIGHT_TRACKER)) Hooks.on("updateItem", async (item, changes, options, userId) => {
	if (!featureEnabled(FEATURE_IDS.LIGHT_TRACKER)) return;
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
if (featureEnabled(FEATURE_IDS.LIGHT_TRACKER)) Hooks.on("updateActor", async (actor, changes, options, userId) => {
	if (!featureEnabled(FEATURE_IDS.LIGHT_TRACKER)) return;
	// Check if this actor has party members and they changed
	if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.members`)) {
		await syncPartyTokenLight(actor);
	}
});

// Sync party light when party sheet is rendered (delayed to ensure canvas is ready)
if (featureEnabled(FEATURE_IDS.LIGHT_TRACKER)) Hooks.on("renderActorSheet", async (app, html, data) => {
	if (!featureEnabled(FEATURE_IDS.LIGHT_TRACKER)) return;
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
if (featureEnabled(FEATURE_IDS.LIGHT_TRACKER)) Hooks.on("createToken", async (tokenDoc, options, userId) => {
	if (!featureEnabled(FEATURE_IDS.LIGHT_TRACKER)) return;
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
if (featureEnabled(FEATURE_IDS.SPELLBOOK_FILTER)) Hooks.on("renderApplication", (app, html, data) => {
	if (!featureEnabled(FEATURE_IDS.SPELLBOOK_FILTER)) return;
	// Check if this is the SpellBookSD app
	if (app.constructor.name === "SpellBookSD") {
		injectSpellbookCompendiumFilter(app, html);
	}
});

// ============================================
// NPC CARD ENRICHER
// ============================================

// Register the DisplayNpcCard enricher
if (anyFeatureEnabled(
	FEATURE_IDS.SHEET_STYLING,
	FEATURE_IDS.DISPLAY_CARDS,
	FEATURE_IDS.EASY_REFERENCE,
	FEATURE_IDS.TOKEN_TOOLBAR,
	FEATURE_IDS.TRAY,
	FEATURE_IDS.SPELLBOOK_FILTER
)) Hooks.once("ready", () => {
	if (featureEnabled(FEATURE_IDS.SHEET_STYLING)) initAppearanceSettings();
	if (featureEnabled(FEATURE_IDS.DISPLAY_CARDS)) {
		registerDisplayNpcEnricher();
		registerDisplayTableEnricher();
		registerDisplayItemEnricher();
	}

	// Initialize Easy Reference ProseMirror menu
	if (featureEnabled(FEATURE_IDS.EASY_REFERENCE)) initEasyReferenceMenu();

	// Initialize Token Toolbar
	if (featureEnabled(FEATURE_IDS.TOKEN_TOOLBAR)) initTokenToolbar();

	// Initialize Character Tray
	if (featureEnabled(FEATURE_IDS.TRAY)) initTray();

	// Global listener for @DisplayTable roll buttons
	if (featureEnabled(FEATURE_IDS.DISPLAY_CARDS)) $(document).on("click", ".sdx-table-roll-btn", async event => {
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
	if (featureEnabled(FEATURE_IDS.SPELLBOOK_FILTER)) initAlignmentSpellFiltering();
});

// ===================================================================
// SOURCE REQUIREMENTS FOR ACTIVE EFFECTS
// ===================================================================

// Moved to effects/source-requirements.mjs, together with checkEffectRequirements
// and the five hooks below. The config-hook call stays here: it registers first
// and must keep doing so.

// Active Effect config hooks live in ./effects/effect-config.mjs; registered here to keep source order.
if (featureEnabled(FEATURE_IDS.SOURCE_REQUIREMENTS)) registerActiveEffectConfigHooks();
// The five source-requirement hooks, in their original order, immediately after
// the config hooks above.
if (featureEnabled(FEATURE_IDS.SOURCE_REQUIREMENTS)) registerSourceRequirementHooks();

/* ------------------------------------------------ */
/*  NPC Attack Display Patch                        */
/* ------------------------------------------------ */
if (featureEnabled(FEATURE_IDS.NPC_CUSTOM_SHEETS)) registerNpcDisplayPatches();

/**
 * Hook to add item images to NPC Features on the Abilities tab
 */
if (featureEnabled(FEATURE_IDS.NPC_CUSTOM_SHEETS)) Hooks.on("renderNpcSheetSD", (app, html, data) => {
	if (!featureEnabled(FEATURE_IDS.NPC_CUSTOM_SHEETS)) return;
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
if (featureEnabled(FEATURE_IDS.MAP_GENERATORS)) Hooks.on("getSceneContextOptions", (document, menuItems) => {
	if (!featureEnabled(FEATURE_IDS.MAP_GENERATORS)) return;
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
if (featureEnabled(FEATURE_IDS.CRAWL_HELPER_DEATH_TIMER)) initCarouselDrag();

// Crawl-helper's player-rolled death timer lives in
// combat/crawl-helper-death-timer.mjs.
if (featureEnabled(FEATURE_IDS.CRAWL_HELPER_DEATH_TIMER)) registerCrawlHelperDeathTimer();

// Initialize Placeable Notes
if (featureEnabled(FEATURE_IDS.PLACEABLE_NOTES)) Hooks.once("ready", () => {
	if (featureEnabled(FEATURE_IDS.PLACEABLE_NOTES)) initPlaceableNotes();
});

if (featureEnabled(FEATURE_IDS.NPC_CUSTOM_SHEETS)) {
	// Register NPC Special Attack Sheet
	foundry.documents.collections.Items.registerSheet("shadowdark", NPCSpecialAttackSheetSD, {
		types: ["NPC Special Attack"],
		makeDefault: true,
		label: "SDX Special Attack Sheet (V2)",
	});
}

// ============================================
// GEM BAG ENHANCEMENT HOOK
// ============================================
if (featureEnabled(FEATURE_IDS.GEM_ENHANCEMENTS)) Hooks.on("renderApplication", (app, html, data) => {
	if (!featureEnabled(FEATURE_IDS.GEM_ENHANCEMENTS)) return;
	try {
		enhanceGemBag(app, html);
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to enhance gem bag`, err);
	}
});

});
/* eslint-enable indent */
