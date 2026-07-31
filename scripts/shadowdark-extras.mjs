// v13+ FilePicker namespaced under foundry.applications.apps.
const FilePicker = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;

/**
 * Shadowdark Extras Module
 * Adds Renown tracking, additional light sources, NPC inventory, and Party management to Shadowdark RPG
 */

import PartySheetSD, { syncPartyTokenLight, getPartiesContainingActor, registerPartyTravelSocket, registerPartySheetRerenderHooks, isPartyActor, registerPartyCleanupHooks } from "./party/PartySheetSD.mjs";
import TradeWindowSD, { initializeTradeSocket, showTradeDialog, ensureTradeJournal, nativeTransferItems, nativeTransferCoins } from "./inventory/TradeWindowSD.mjs";
import { CombatSettingsApp, registerCombatSettings, injectDamageCard, setupCombatSocket, setupScrollingCombatText, setupSummonExpiryHook, trackSummonedTokensForExpiry, spawnSummonedCreatures, getSocket } from "./combat/CombatSettingsSD.mjs";
import { EffectsSettingsApp, registerEffectsSettings } from "./effects/EffectsSettingsSD.mjs";
import { patchArmorActiveEffects } from "./effects/ArmorAEPatchSD.mjs";
import { HpWavesSettingsApp, registerHpWavesSettings, getHpWaveColor, isHpWavesEnabled } from "./character-sheet/HpWavesSettingsSD.mjs";
import { TravelActivitiesSettingsApp, registerTravelActivitiesSettings, getTravelActivities } from "./party/TravelActivitiesSettingsSD.mjs";
import { TravelSpeedsSettingsApp, registerTravelSpeedsSettings, getTravelSpeeds } from "./party/TravelSpeedsSettingsSD.mjs";
import { registerPartyWeatherSettings } from "./party/PartyWeatherSettingsSD.mjs";
import { generateSpellConfig, generatePotionConfig, generateScrollConfig, generateWandConfig } from "./item-sheets/ItemTypeConfigs.mjs";
import { activateTemplateTargetingListeners } from "./item-sheets/TemplateTargetingConfig.mjs";
import { activateTemplateTokenMagicStackHandlers, setupActivityRadioToggles, activateAnimationFxListeners } from "./item-sheets/activity-tab-widgets.mjs";
import { enhanceSpellSheet, injectSpellAlignmentField } from "./item-sheets/spell-sheet-enhance.mjs";
import { enhancePotionSheet } from "./item-sheets/potion-sheet-enhance.mjs";
import { enhanceScrollSheet } from "./item-sheets/scroll-sheet-enhance.mjs";
import { enhanceWandSheet } from "./item-sheets/wand-sheet-enhance.mjs";
import {
	injectWeaponBonusTab,
	getWeaponBonuses,
	getWeaponEffectsToApply,
	evaluateRequirements,
	calculateWeaponBonusDamage,
	injectWeaponBonusDisplay,
	injectWeaponAnimationButton,
	getPromptableHitBonuses,
	getPromptableDamageBonuses,
	injectWeaponDamageTypeDropdown
} from "./combat/WeaponBonusConfig.mjs";
import { setupRollAttackPatches, setupRollConfigPatches } from "./combat/roll-patches.mjs";
import { processWeaponBonuses } from "./combat/hit-bonus.mjs";
import { registerFreyasOmenHooks } from "./combat/freyas-omen.mjs";
import { registerChatCardHooks } from "./combat/chat-card-hooks.mjs";

import { initAutoAnimationsIntegration } from "./animation/AutoAnimationsSD.mjs";
import { AnimationFxSD } from "./animation/AnimationFxSD.mjs";
import { registerAnimationFxMenu } from "./animation/AnimationFxListApp.mjs";
import { initTorchAnimations } from "./animation/TorchAnimationSD.mjs";
import { initWeaponAnimations } from "./animation/WeaponAnimationSD.mjs";
import { initLevelUpAnimations } from "./animation/LevelUpAnimationSD.mjs";
import { openWeaponAnimationConfig } from "./animation/WeaponAnimationConfig.mjs";
import { initFocusSpellTracker, endFocusSpell, linkEffectToFocusSpell, getActiveFocusSpells, isFocusingOnSpell, startDurationSpell, endDurationSpell, registerSpellModification, getActiveDurationSpells } from "./effects/FocusSpellTrackerSD.mjs";
import { initBreakOnDamage, breakEffectOnDamage, clearBreakOnDamage, applySpellEffect } from "./effects/BreakOnDamageSD.mjs";
import { initCarousing, injectCarousingButton, ensureCarousingJournal, ensureCarousingTablesJournal, initCarousingSocket, getCustomCarousingTables, getCarousingTableById, setCarousingTable, migrateLegacyRenown } from "./party/carousing/CarousingSD.mjs";
import { migrateWebpAssetPaths, sweepWorldCompendiums } from "./shared/WebpMigrationSD.mjs";
import { openCarousingOverlay, refreshCarousingOverlay } from "./party/carousing/CarousingOverlaySD.mjs";
import { openCarousingTablesEditor } from "./party/carousing/CarousingTablesApp.mjs";
import { openExpandedCarousingTablesEditor } from "./party/carousing/ExpandedCarousingTablesApp.mjs";
import { initTemplateEffects, processTemplateTurnEffects, setupTemplateEffectFlags } from "./effects/TemplateEffectsSD.mjs";
import { filterEditor as openTMFXFilterEditor } from "./animation/TMFXFilterEditor.mjs";
import { initAuraEffects, createAuraOnActor, getActiveAuras, getTokensInAura } from "./effects/AuraEffectsSD.mjs";
import { registerDisplayNpcEnricher } from "./journal/DisplayNpc.mjs";
import { registerDisplayTableEnricher } from "./journal/DisplayTable.mjs";
import { registerDisplayItemEnricher } from "./journal/DisplayItem.mjs";
import { initEasyReferenceMenu, registerEasyReferenceSettings } from "./journal/easy-reference/EasyReferenceMenu.mjs";
import { CreatureTypesApp, getCreatureTypes, getEffectiveCreatureType, getMappedType } from "./npc/CreatureTypesApp.mjs";
import SheetEditorConfig from "./character-sheet/SheetEditorConfig.mjs";
import PotionSheetSD from "./item-sheets/PotionSheetSD.mjs";
import BackgroundSheetSD from "./character-sheet/BackgroundSheetSD.mjs";
import NPCAttackSheetSD from "./npc/NPCAttackSheetSD.mjs";
import NPCSpecialAttackSheetSD from "./npc/NPCSpecialAttackSheetSD.mjs";
import { initPlaceableNotes } from "./journal/PlaceableNotesSD.mjs";
import NPCFeatureSheetSD from "./npc/NPCFeatureSheetSD.mjs";
import ClassAbilitySheetSD from "./item-sheets/ClassAbilitySheetSD.mjs";
import { initTokenToolbar, registerTokenToolbarSettings } from "./canvas/TokenToolbarSD.mjs";
import { initTray, registerTraySettings } from "./tray/TraySD.mjs";
import { initAppearanceSettings } from "./character-sheet/AppearanceSettingsSD.mjs";
import AmmunitionSelector from "./inventory/AmmunitionSelector.mjs";
import StaffSpellManager from "./item-sheets/StaffSpellManager.mjs";
import { injectStaffSpellButton, injectStaffSpellsUI, injectWeaponSpellRechargeButtons, patchCanUseMagicItems, registerStaffSpellHooks } from "./item-sheets/staff-spells.mjs";
import { initJournalNarration } from "./journal/JournalNarrationSD.mjs";
import { initMedkit, registerMedkitPack, unregisterMedkitPack, getMedkitPacks, scanWorldForUpdates, applyWorldMedkitUpdates, medkitScanWorld, MedkitWorldScanMenu } from "./combat/MedkitSD.mjs";
import { LightTrackerAppSD, initLightTrackerApp } from "./canvas/LightTrackerAppSD.mjs";
import { initMarchingMode } from "./combat/MarchingModeSD.mjs";
import { SceneExporter } from "./scene/SceneExporter.mjs";
import { SceneImporter } from "./scene/SceneImporter.mjs";
import { initJournalPins } from "./journal/JournalPinsSD.mjs";
import { registerPinStyleSettings } from "./journal/PinStyleEditorSD.mjs";
import { registerJournalUIHooks } from "./journal/journal-ui.mjs";
import SheetLockManager from "./character-sheet/SheetLockManager.mjs";
import { enhanceInventoryTab, applyHpQuickAdjust, setActorHpValue, attachNativeHpQuickControls, HP_QUICK_ADJUST_TOOLTIP } from "./character-sheet/enhanced-inventory-tab.mjs";
import { enhanceGemSheet, enhanceGemBag, enhanceGemInventory } from "./inventory/gem-enhancements.mjs";
import { injectSkillsBox } from "./character-sheet/skills-box.mjs";
import { applySheetDecorationStyles } from "./character-sheet/sheet-decoration.mjs";
import { DEFAULT_INVENTORY_STYLES, InventoryStylesApp, applyInventoryStylesToSheet } from "./inventory/inventory-styles.mjs";
import { enhanceInventoryWithDeleteAndMultiSelect } from "./inventory/inventory-multi-select.mjs";
import { enhanceSpellsTab } from "./character-sheet/enhanced-spells-tab.mjs";
import { getConditionsData, injectConditionsToggles, showConditionsModal, registerConditionEffectHooks } from "./character-sheet/conditions.mjs";
import { registerBackgroundAdvancementHooks } from "./character-sheet/background-advancement.mjs";
import "./item-macros/SpellMacrosSD.mjs";
import { initMysteriousCasting } from "./npc/MysteriousCasting.mjs";
import { TomSD } from "./tom/TomSD.mjs";
import { WallContextMenuSD } from "./canvas/WallContextMenuSD.mjs";
import { sdxDrawingTool } from "./canvas/SDXDrawingTool.mjs";
import { sdxDrawingToolbar } from "./canvas/SDXDrawingToolbar.mjs";
import { SDXRollerApp } from "./tray/SDXRollerApp.mjs";
import { ensureMutableItemCompendiumIndexes } from "./shared/CompendiumIndexSD.mjs";
import { registerAppV2HeaderBridge } from "./shared/appv2-header-bridge.mjs";
import { initSDXCoords, registerSDXCoordsSettings, registerSDXCoordsMenu } from "./hex/SDXCoordsSD.mjs";
import { SDXCoordsSettingsApp } from "./hex/SDXCoordsSettingsSD.mjs";
import { initHexTooltip } from "./hex/HexTooltipSD.mjs";
import { initHexFog } from "./hex/SDXHexFogSD.mjs";
import { registerMaphubHooks } from "./MaphubSD.mjs";
import { initUnidentifiedGMDisplay } from "./inventory/UnidentifiedDisplaySD.mjs";
import { initTemplateElevationBadge } from "./effects/TemplateElevationBadgeSD.mjs";
import { registerInvisibilityHooks } from "./effects/invisibility.mjs";
import { initMacroExecuteSocket } from "./item-macros/macro-socket.mjs";
import { hasItemMacro, executeItemMacro, registerItemMacroSocket } from "./item-macros/item-macro-engine.mjs";
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
import { registerContainerHooks, isContainerItem, isItemPilesEnabledActor, calculateSlotsCostForItemData, recomputeContainerSlots, calculateContainedItemSlots, getContainedItems, getPackedContainedItemData, syncContainerPackedItems } from "./inventory/containers.mjs";
import { isUnidentified, getUnidentifiedName, getUnidentifiedNameFromData } from "./shared/sd4Compat.mjs";
import { transferItemToPlayer, transferCoinsToPlayer, showCoinTransferDialog, showTransferDialog, patchPlayerSheetForTransfers } from "./inventory/player-transfers.mjs";
import { injectEnhancedHeader, injectHeaderCustomization, injectPartyHeaderCustomization, injectAddCoinsButton, injectTradeButton } from "./character-sheet/enhanced-header.mjs";
import { DEFAULT_LIGHT_TEMPLATES, getCustomLightSources, LightTemplateEditor } from "./canvas/light-templates.mjs";
import { patchCtrlMoveOnActorSheetDrops } from "./inventory/default-move-drops.mjs";
import { injectNpcCreatureType, injectNpcInventoryTab } from "./npc/npc-sheet-inventory.mjs";
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
/**
 * Allow SDX-painted hex tiles to keep their true (possibly negative) x/y when
 * they overhang the scene's left or top edge.
 *
 * Hex art tiles are intentionally larger than the grid cell — the visible hex
 * sits centered inside a transparent canvas — so a tile centered on an edge hex
 * is anchored at a slightly negative x/y. Foundry v14's
 * `TileDocument#prepareDerivedData` clamps x/y into [0, sceneWidth/Height]
 * (`this.x = Math.clamp(this.x, 0, d.width)`), which shoves the whole tile
 * inward and shifts the entire first column / top row off their grid cells.
 *
 * We re-apply the unclamped position (preserved in `_source`) for our painted
 * tiles after core prep runs, so the visible hex stays aligned to its grid cell
 * and only the transparent overhang is clipped at the scene boundary. Scoped to
 * SDX-painted tiles only; all other tiles keep core clamping behavior.
 */
function patchHexTilePositionClamp() {
	const restoreSourcePosition = function () {
		const flags = this._source?.flags?.[MODULE_ID];
		if (!flags?.painted || !this.parent) return;
		const sx = this._source.x;
		const sy = this._source.y;
		if (this.x === sx && this.y === sy) return;  // not clamped — nothing to do
		this.x = sx;
		this.y = sy;
		// Rebuild the derived shape so bounds/occlusion match the true position.
		const ShapeCls = this.shape?.constructor;
		if (ShapeCls) {
			this.shape = new ShapeCls({
				x: sx,
				y: sy,
				width: this.width,
				height: this.height,
				anchorX: this.texture?.anchorX ?? 0,
				anchorY: this.texture?.anchorY ?? 0
			});
		}
	};

	const wrapperPath = "CONFIG.Tile.documentClass.prototype.prepareDerivedData";
	if (globalThis.libWrapper?.register) {
		libWrapper.register(MODULE_ID, wrapperPath, function (wrapped, ...args) {
			wrapped(...args);
			restoreSourcePosition.call(this);
		}, "WRAPPER");
	} else {
		// Fallback: direct prototype wrap (idempotent).
		const proto = CONFIG.Tile.documentClass.prototype;
		if (!proto.__sdxClampPatched) {
			const orig = proto.prepareDerivedData;
			proto.prepareDerivedData = function (...args) {
				orig.apply(this, args);
				restoreSourcePosition.call(this);
			};
			proto.__sdxClampPatched = true;
		}
	}
}

Hooks.once("init", () => {
	// Register GSAP Plugins (GSAP is loaded by Foundry core)
	try {
		if (typeof gsap !== "undefined" && typeof PixiPlugin !== "undefined") {
			gsap.registerPlugin(PixiPlugin);
			console.log("Shadowdark Extras | Registered GSAP PixiPlugin");
		}
	} catch (err) {
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
			game.user.updateTokenTargets = function (tokenIds = []) {
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
		"stonehen", "times_new_yorker", "venus-rising-rg"
	];

	if (CONFIG.fontFamilies instanceof Set) {
		for (const font of SDX_FONTS) CONFIG.fontFamilies.add(font);
	} else {
		CONFIG.fontFamilies = [...new Set([...(CONFIG.fontFamilies || []), ...SDX_FONTS])];
	}

	if (window.FontsLoader) {
		window.FontsLoader.load({
			custom: {
				families: SDX_FONTS,
				urls: ["modules/shadowdark-extras/styles/fonts.css"]
			}
		});
	}
});


// ============================================
// UNIDENTIFIED ITEMS — thin wrappers to SD 4.x native identification
// ============================================


// ============================================
// BASIC ITEM CONTAINERS (non-invasive)
// ============================================



function isBasicItem(item) {
	return item?.type === "Basic";
}


/**
 * SD 4.x made `isPhysical` a hardcoded getter, so setting it to false via
 * item.update() no longer hides items from inventory. Patch getPhysicalItems()
 * on the base data-model prototype to also exclude items that have a containerId
 * (i.e. are stored inside an SDX container).
 */
function patchGetPhysicalItemsForContainers() {
	const PlayerSD = CONFIG.Actor.dataModels?.Player;
	if (!PlayerSD) return;

	// Walk up to ActorBaseSD (the prototype that defines getPhysicalItems) so the
	// patch applies to both PlayerSD and NpcSD in a single write.
	const baseProto = Object.getPrototypeOf(PlayerSD.prototype);
	const target = (typeof baseProto?.getPhysicalItems === "function") ? baseProto : PlayerSD.prototype;

	if (!target.getPhysicalItems || target.__sdxContainerItemsPatched) return;

	const _original = target.getPhysicalItems;
	target.getPhysicalItems = function (group = true) {
		return _original.call(this, group).filter(
			i => !i.getFlag(MODULE_ID, "containerId")
		);
	};
	target.__sdxContainerItemsPatched = true;
}

function getPackedKeyFromItemData(itemData) {
	return itemData?.flags?.[MODULE_ID]?.packedKey ?? null;
}

function ensurePackedKeyOnItemData(itemData) {
	itemData.flags = itemData.flags ?? {};
	itemData.flags[MODULE_ID] = itemData.flags[MODULE_ID] ?? {};
	if (!itemData.flags[MODULE_ID].packedKey) itemData.flags[MODULE_ID].packedKey = foundry.utils.randomID();
	return itemData.flags[MODULE_ID].packedKey;
}

async function packItemToContainerData(sourceItem) {
	if (!sourceItem || !(sourceItem instanceof Item)) return null;
	// If the source is a container owned by a normal actor, ensure its packed snapshot is current before copying.
	try {
		if (isContainerItem(sourceItem) && sourceItem.parent && !isItemPilesEnabledActor(sourceItem.parent)) {
			await syncContainerPackedItems(sourceItem);
		}
	} catch {
		// Ignore snapshot refresh errors
	}

	const data = foundry.utils.duplicate(sourceItem.toObject());
	delete data._id;
	// Remove relationships that don't make sense outside ownership contexts
	data.flags = data.flags ?? {};
	data.flags[MODULE_ID] = data.flags[MODULE_ID] ?? {};
	// ContainerId will be rewritten on unpack/contain
	data.flags[MODULE_ID].containerId = null;
	// Clear the unpacked flag so the container can be unpacked on the new actor
	delete data.flags[MODULE_ID].containerUnpacked;
	// Clear the "unpacked on actor" flag so it can be unpacked on a different actor
	delete data.flags[MODULE_ID].containerUnpackedOnActor;
	// Ensure packed entries have a stable key for UI removal
	ensurePackedKeyOnItemData(data);
	return data;
}


async function restoreContainerBaseSlots(containerItem) {
	if (!containerItem) return;
	const base = containerItem.getFlag(MODULE_ID, "containerBaseSlots");
	if (!base || typeof base !== "object") return;
	await containerItem.update({
		"system.slots.slots_used": Number(base.slots_used ?? 1) || 1,
		"system.slots.per_slot": Number(base.per_slot ?? 1) || 1,
		"system.slots.max": Number(base.max ?? 1) || 1,
	}, { sdxInternal: true });
}


async function setContainedState(item, containerId) {
	if (!item) return;
	const makeContained = Boolean(containerId);
	const actor = item.parent;
	const previousContainerId = item.getFlag(MODULE_ID, "containerId");
	const isItemPilesActor = isItemPilesEnabledActor(actor);

	if (makeContained) {
		// Preserve original isPhysical so we can restore.
		const origPhysical = item.getFlag(MODULE_ID, "containerOrigIsPhysical");
		if (origPhysical === undefined) {
			await item.setFlag(MODULE_ID, "containerOrigIsPhysical", Boolean(item.system?.isPhysical));
		}
		await item.update({
			"system.isPhysical": false,
			[`flags.${MODULE_ID}.containerId`]: containerId,
			// If the item is on an Item Piles actor, also hide it from the Item Piles UI
			...(isItemPilesActor ? { "flags.item-piles.item.hidden": true } : {}),
		}, { sdxInternal: true });
		const container = actor?.items?.get(containerId);
		if (container) {
			// Mark container as unpacked on this actor to prevent duplicate unpack attempts
			if (actor && !container.getFlag(MODULE_ID, "containerUnpackedOnActor")) {
				await container.setFlag(MODULE_ID, "containerUnpackedOnActor", actor.id);
			}
			await recomputeContainerSlots(container);
		}
		return;
	}

	// Remove from container: restore physical state
	const restorePhysical = item.getFlag(MODULE_ID, "containerOrigIsPhysical");
	await item.update({
		"system.isPhysical": (restorePhysical === undefined) ? true : Boolean(restorePhysical),
		[`flags.${MODULE_ID}.containerId`]: null,
		[`flags.${MODULE_ID}.containerOrigIsPhysical`]: null,
		...(isItemPilesActor ? { "flags.item-piles.item.hidden": false } : {}),
	}, { sdxInternal: true });
	await item.unsetFlag(MODULE_ID, "containerId");
	await item.unsetFlag(MODULE_ID, "containerOrigIsPhysical");
	// Refresh the container we removed it from
	if (actor && previousContainerId) {
		const container = actor.items.get(previousContainerId);
		if (container) await recomputeContainerSlots(container);
	}
}

async function setItemContainerId(item, containerId) {
	if (!item) return;
	if (containerId) return item.setFlag(MODULE_ID, "containerId", containerId);
	return item.unsetFlag(MODULE_ID, "containerId");
}

function injectBasicContainerUI(app, html) {
	// Check if containers are enabled
	if (!game.settings.get(MODULE_ID, "enableContainers")) return;

	const item = app?.item;
	if (!isBasicItem(item)) return;

	// Only for Shadowdark system
	if (game.system.id !== "shadowdark") return;

	// De-dupe on re-render
	html.find(".sdx-container-toggle").remove();
	html.find(".sdx-container-box").remove();

	const detailsTab = html.find('.tab[data-tab="details"], .tab[data-tab="tab-details"], .tab.details').first();
	if (!detailsTab.length) return;

	const isOwned = Boolean(item.parent);
	const isEditable = Boolean(app.isEditable);
	const labelSlots = (game.i18n.localize("SHADOWDARK.inventory.slots") || "Slots").toLowerCase();
	let slotsBox = null;

	// Try to find the SLOTS box to add the toggle under it
	detailsTab.find(".SD-box").each(function () {
		const label = $(this).find('.header label').first().text().trim().toLowerCase();
		if (label && (label === labelSlots || label.includes(labelSlots))) {
			slotsBox = $(this);
			return false;
		}
	});

	const containerLabel = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.is_container");
	const containerHint = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.is_container_hint");
	const toggleHtml = `
		<div class="sdx-container-toggle">
			<label title="${foundry.utils.escapeHTML(containerHint)}">${foundry.utils.escapeHTML(containerLabel)}</label>
			<input type="checkbox" ${isContainerItem(item) ? "checked" : ""} ${isEditable ? "" : "disabled"} />
		</div>
	`;

	if (slotsBox?.length) {
		slotsBox.find('.content').first().append(toggleHtml);
	} else {
		// Fallback: append to the top of Details
		detailsTab.prepend(toggleHtml);
	}

	// Bind toggle
	const toggle = html.find(".sdx-container-toggle input[type=checkbox]").first();
	toggle.on("change", async (ev) => {
		if (!isEditable) return;
		const enabled = Boolean(ev.currentTarget.checked);

		// Check if trying to make this a container while it's inside another container
		if (enabled) {
			const allowNestedContainers = game.settings.get(MODULE_ID, "enableNestedContainers");
			const containerId = item.getFlag(MODULE_ID, "containerId");
			if (!allowNestedContainers && containerId) {
				ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.item.container.nested_not_allowed"));
				ev.currentTarget.checked = false;
				return;
			}
		}

		await item.setFlag(MODULE_ID, "isContainer", enabled);

		// If disabling, release contained items and restore base slots
		if (!enabled && item.parent) {
			const contained = getContainedItems(item);
			for (const child of contained) {
				await setContainedState(child, null);
			}
			await restoreContainerBaseSlots(item);
		}

		app.render();
	});

	// Handle container-specific slot field modifications
	if (isContainerItem(item)) {
		// Disable per_slot input for containers (always 1)
		const perSlotInput = html.find('input[name="system.slots.per_slot"]');
		if (perSlotInput.length) {
			perSlotInput.prop('disabled', true);
			perSlotInput.css('opacity', '0.5');
			perSlotInput.attr('title', 'Cannot edit for containers');
		}

		// Replace free_carry number input with checkbox
		const freeCarryInput = html.find('input[name="system.slots.free_carry"]');
		if (freeCarryInput.length) {
			const currentValue = Number(item.system?.slots?.free_carry ?? 0);
			const isChecked = currentValue > 0;
			const freeCarryLabel = freeCarryInput.closest('.SD-grid').find('h3').filter(function () {
				return $(this).text().trim().toLowerCase().includes('free');
			});

			const checkboxHtml = `
				<input type="checkbox" 
					data-sdx-free-carry 
					${isChecked ? 'checked' : ''} 
					${isEditable ? '' : 'disabled'}
					style="width: auto; height: auto;"
				/>
			`;

			freeCarryInput.replaceWith(checkboxHtml);

			// Bind checkbox change event
			html.find('[data-sdx-free-carry]').on('change', async (ev) => {
				if (!isEditable) return;
				const checked = ev.currentTarget.checked;
				// Set to 1 if checked, 0 if unchecked
				await item.update({ "system.slots.free_carry": checked ? 1 : 0 });
			});
		}
	}

	// Only render contents area when enabled
	if (!isContainerItem(item)) return;

	const title = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.contents_title");
	const dropHint = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.drop_hint");
	const removeTip = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.remove_tooltip");
	const slotsLabel = game.i18n.localize("SHADOWDARK.inventory.slots") || "Slots";

	const onItemPilesActor = isItemPilesEnabledActor(item.parent);
	const packedOnly = !isOwned || onItemPilesActor;
	const contained = packedOnly ? [] : getContainedItems(item);
	const packed = packedOnly ? getPackedContainedItemData(item) : [];

	// Track totals for GP, CP, SP
	let totalGP = 0;
	let totalCP = 0;
	let totalSP = 0;

	const rows = (packedOnly ? packed : contained).map((entry, index) => {
		const isData = !(entry instanceof Item);
		// Check if this individual item is unidentified and mask accordingly
		const isItemUnidentified = isData
			? (entry.flags?.[MODULE_ID]?.unidentified === true)
			: isUnidentified(entry);
		const name = isItemUnidentified && !game.user?.isGM
			? (isData ? getUnidentifiedNameFromData(entry) : getUnidentifiedName(entry))
			: (isData ? (entry.name ?? "") : entry.name);
		const img = isData ? (entry.img ?? "") : entry.img;
		const qty = Number(entry.system?.quantity ?? 1);
		// Use recursive calculation to show total slots including nested container contents
		const slots = isData ? calculateSlotsCostForItemData(entry, { recursive: true }) : calculateContainedItemSlots(entry);
		const packedKey = isData ? (getPackedKeyFromItemData(entry) ?? String(index)) : null;

		// Extract cost values
		const costGP = Number(entry.system?.cost?.gp ?? 0);
		const costCP = Number(entry.system?.cost?.cp ?? 0);
		const costSP = Number(entry.system?.cost?.sp ?? 0);

		// Add to totals (multiplied by quantity)
		totalGP += costGP * qty;
		totalCP += costCP * qty;
		totalSP += costSP * qty;

		const liAttrs = isData
			? `data-packed-key="${foundry.utils.escapeHTML(String(packedKey))}"`
			: `data-item-id="${entry.id}"`;
		const canRemove = isEditable && !onItemPilesActor;
		const removeAction = canRemove ? `<a class=\"fa-solid fa-xmark\" data-action=\"remove-from-container\" title=\"${foundry.utils.escapeHTML(removeTip)}\"></a>` : "";
		return `
			<li class="item" ${liAttrs}>
				<div class="item-image" style="background-image: url(${img})" data-action="open-item"></div>
				<a class="item-name" data-action="open-item">${foundry.utils.escapeHTML(name)}</a>
				<div class="quantity">${Number.isFinite(qty) ? qty : ""}</div>
				<div class="cost-gp">${costGP > 0 ? costGP : ""}</div>
				<div class="cost-sp">${costSP > 0 ? costSP : ""}</div>
				<div class="cost-cp">${costCP > 0 ? costCP : ""}</div>
				<div class="slots">${Number.isFinite(slots) ? slots : ""}</div>
				<div class="actions">${removeAction}</div>
			</li>
		`;
	}).join("");

	// Build total row if there are items
	const totalRow = (packedOnly ? packed.length : contained.length) > 0 ? `
		<li class="item sdx-container-total">
			<div class="item-image"></div>
			<div class="item-name" style="font-weight: bold;">${foundry.utils.escapeHTML(game.i18n.localize("SHADOWDARK_EXTRAS.item.container.total") || "Total")}</div>
			<div class="quantity"></div>
			<div class="cost-gp" style="font-weight: bold;">${totalGP > 0 ? totalGP : ""}</div>
			<div class="cost-sp" style="font-weight: bold;">${totalSP > 0 ? totalSP : ""}</div>
			<div class="cost-cp" style="font-weight: bold;">${totalCP > 0 ? totalCP : ""}</div>
			<div class="slots"></div>
			<div class="actions"></div>
		</li>
	` : "";

	// Get container coins
	const containerCoins = item.getFlag(MODULE_ID, "containerCoins") || {};
	const coinGP = Number(containerCoins.gp ?? 0);
	const coinSP = Number(containerCoins.sp ?? 0);
	const coinCP = Number(containerCoins.cp ?? 0);

	// Calculate coin slots (1 slot per 100 coins, regardless of denomination)
	const totalCoins = coinGP + coinSP + coinCP;
	const coinSlots = Math.floor(totalCoins / 100);

	// Build coin row for container's own coins
	const coinRow = `
		<li class="sdx-container-coins-row">
			<div class="item-image"><i class="fas fa-coins"></i></div>
			<div class="item-name">${foundry.utils.escapeHTML(game.i18n.localize("SHADOWDARK_EXTRAS.item.container.coins") || "Coins")}</div>
			<div class="quantity"></div>
			<div class="cost-gp">
				<input type="number" class="sdx-container-coin-input" data-coin-type="gp" value="${coinGP}" min="0" ${isEditable ? "" : "disabled"} />
			</div>
			<div class="cost-sp">
				<input type="number" class="sdx-container-coin-input" data-coin-type="sp" value="${coinSP}" min="0" ${isEditable ? "" : "disabled"} />
			</div>
			<div class="cost-cp">
				<input type="number" class="sdx-container-coin-input" data-coin-type="cp" value="${coinCP}" min="0" ${isEditable ? "" : "disabled"} />
			</div>
			<div class="slots">${coinSlots > 0 ? coinSlots : ""}</div>
			<div class="actions"></div>
		</li>
	`;

	let contentsHtml = `
		<div class="sdx-container-dropzone ${isEditable ? "editable" : ""}" data-sdx-dropzone="1">
			${(packedOnly ? packed.length : contained.length) ? "" : `<p class="sdx-container-hint">${foundry.utils.escapeHTML(dropHint)}</p>`}
			<ol class="SD-list item-list sdx-container-list">
				<li class="header">
					<div class="item-name">${foundry.utils.escapeHTML(game.i18n.localize("SHADOWDARK_EXTRAS.party.item_name"))}</div>
					<div class="quantity">${foundry.utils.escapeHTML(game.i18n.localize("SHADOWDARK_EXTRAS.party.qty"))}</div>
					<div class="cost-gp">GP</div>
					<div class="cost-sp">SP</div>
					<div class="cost-cp">CP</div>
					<div class="slots">${foundry.utils.escapeHTML(slotsLabel)}</div>
					<div class="actions"></div>
				</li>
				${coinRow}
				${rows}
				${totalRow}
			</ol>
		</div>
	`;

	const boxHtml = `
		<div class="SD-box sdx-container-box">
			<div class="header"><label>${foundry.utils.escapeHTML(title)}</label><span></span></div>
			<div class="content">${contentsHtml}</div>
		</div>
	`;

	// Insert after the top grid of the Details tab, if present
	const topGrid = detailsTab.find('.grid-3-columns, .grid-3, .grid-3col, .grid-3columms, .grid-3-columns').first();
	if (topGrid.length) topGrid.after(boxHtml);
	else detailsTab.append(boxHtml);

	async function openPackedItemSheet(packedItemData, { containerItem, packedKey } = {}) {
		if (!packedItemData) return;
		// Foundry v13: safest is constructing an in-memory document (no DB/world creation).
		try {
			const data = foundry.utils.duplicate(packedItemData);
			if (!data._id) data._id = foundry.utils.randomID();
			const DocClass = CONFIG?.Item?.documentClass ?? Item?.implementation ?? Item;
			const temp = new DocClass(data, { temporary: true });

			// If this packed entry belongs to a container item (sidebar/compendium), persist edits back into the container's packed array.
			if (containerItem && packedKey) {
				const originalUpdate = temp.update?.bind(temp);
				temp.update = async (changes = {}, options = {}) => {
					// Update the in-memory doc source so the sheet reflects changes.
					try {
						temp.updateSource(changes);
					} catch {
						// If updateSource isn't available for some reason, fall back to default update.
						return originalUpdate ? originalUpdate(changes, options) : temp;
					}

					// Write back to the container's packed list.
					const current = getPackedContainedItemData(containerItem);
					const idx = current.findIndex(d => String(getPackedKeyFromItemData(d)) === String(packedKey));
					if (idx < 0) return temp;

					const nextEntry = temp.toObject();
					delete nextEntry._id;
					nextEntry.flags = nextEntry.flags ?? {};
					nextEntry.flags[MODULE_ID] = nextEntry.flags[MODULE_ID] ?? {};
					nextEntry.flags[MODULE_ID].containerId = null;
					nextEntry.flags[MODULE_ID].packedKey = packedKey;
					nextEntry.system = nextEntry.system ?? {};
					// Packed entries should remain hidden from normal inventory listings.
					nextEntry.system.isPhysical = false;

					const next = current.slice();
					next[idx] = nextEntry;
					await containerItem.setFlag(MODULE_ID, "containerPackedItems", next);
					await recomputeContainerSlots(containerItem);
					return temp;
				};
			}

			temp?.sheet?.render(true);
		} catch {
			// Give up silently
		}
	}

	// Wire up actions
	html.find('.sdx-container-box [data-action="open-item"]').on('click', async (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		const li = ev.currentTarget.closest('li.item');
		const actor = item.parent;

		// Owned container contents: open the real embedded item.
		const itemId = li?.dataset?.itemId;
		if (actor && itemId) {
			const target = actor.items?.get(itemId);
			target?.sheet?.render(true);
			return;
		}

		// Packed-only contents (sidebar/compendium/Item Piles): open a temporary sheet.
		const packedKey = li?.dataset?.packedKey;
		if (!packedKey) return;
		const packedItems = getPackedContainedItemData(item);
		const packedEntry = packedItems.find(d => String(getPackedKeyFromItemData(d)) === String(packedKey));
		await openPackedItemSheet(packedEntry, { containerItem: item, packedKey });
	});

	html.find('.sdx-container-box [data-action="remove-from-container"]').on('click', async (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		if (!isEditable) return;
		const li = ev.currentTarget.closest('li.item');
		const packedKey = li?.dataset?.packedKey;
		if (packedKey) {
			const current = getPackedContainedItemData(item);
			const next = current.filter(d => getPackedKeyFromItemData(d) !== packedKey);
			await item.setFlag(MODULE_ID, "containerPackedItems", next);
			await recomputeContainerSlots(item);
			app.render();
			return;
		}

		const itemId = li?.dataset?.itemId;
		const actor = item.parent;
		const target = actor?.items?.get(itemId);
		if (!target) return;
		await setContainedState(target, null);
		await recomputeContainerSlots(item);
		app.render();
	});

	// Bind coin input changes
	html.find('.sdx-container-box .sdx-container-coin-input').on('change', async (ev) => {
		if (!isEditable) return;
		const coinType = ev.currentTarget.dataset.coinType;
		const value = Math.max(0, parseInt(ev.currentTarget.value) || 0);
		const currentCoins = item.getFlag(MODULE_ID, "containerCoins") || {};
		const nextCoins = { ...currentCoins, [coinType]: value };
		await item.setFlag(MODULE_ID, "containerCoins", nextCoins);
		await recomputeContainerSlots(item);
	});

	// Drag/drop assignment (actor-owned or packed-only)
	const dropzone = html.find('.sdx-container-box .sdx-container-dropzone').first();
	if (dropzone.length) {
		dropzone.on('dragover', (ev) => {
			if (!isEditable) return;
			ev.preventDefault();
		});
		dropzone.on('drop', async (ev) => {
			if (!isEditable) return;
			ev.preventDefault();
			const originalEvent = ev.originalEvent ?? ev;
			const ctrlMove = Boolean(originalEvent?.ctrlKey);
			const getDragEventData = foundry?.applications?.ux?.TextEditor?.implementation?.getDragEventData ?? TextEditor.getDragEventData;
			const data = getDragEventData(originalEvent);
			if (!data || data.type !== 'Item') return;
			const dropped = await fromUuid(data.uuid);
			if (!dropped || !(dropped instanceof Item)) return;
			if (dropped.id === item.id && dropped.parent === item.parent) return;

			// Check if nested containers are allowed
			const allowNestedContainers = game.settings.get(MODULE_ID, "enableNestedContainers");
			if (!allowNestedContainers && isContainerItem(dropped)) {
				ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.item.container.nested_not_allowed"));
				return;
			}

			// Actor-owned container: ensure the dropped item becomes owned by the same actor, then contain it.
			if (item.parent) {
				if (dropped.parent && dropped.parent === item.parent) {
					await setContainedState(dropped, item.id);
					await recomputeContainerSlots(item);
					app.render();
					return;
				}

				const packedData = await packItemToContainerData(dropped);
				if (!packedData) return;
				// Create an owned copy on this actor, then contain that copy.
				const created = await item.parent.createEmbeddedDocuments("Item", [packedData], { sdxInternal: true });
				const createdItem = created?.[0];
				if (createdItem) {
					await setContainedState(createdItem, item.id);
					await recomputeContainerSlots(item);
				}

				// Optional move: delete the source if CTRL is held and the user can.
				if (ctrlMove && dropped.parent && dropped.parent !== item.parent) {
					try {
						await dropped.delete({ sdxInternal: true });
					} catch {
						// Ignore delete failures
					}
				}

				app.render();
				return;
			}

			// Packed-only container (sidebar/compendium or Item Piles): store dropped item as packed data.
			const packedData = await packItemToContainerData(dropped);
			if (!packedData) return;
			const current = getPackedContainedItemData(item);
			current.push(packedData);
			await item.setFlag(MODULE_ID, "containerPackedItems", current);
			await recomputeContainerSlots(item);

			// Optional move: delete the source if CTRL is held and the user can.
			if (ctrlMove && dropped.parent) {
				try {
					await dropped.delete({ sdxInternal: true });
				} catch {
					// Ignore delete failures
				}
			}

			app.render();
		});
	}
}

function buildContainerTooltip(containerItem) {
	const actor = containerItem?.parent;
	if (!actor) return null;
	const packed = getPackedContainedItemData(containerItem);
	const isItemPiles = isItemPilesEnabledActor(actor);
	const contained = isItemPiles ? [] : actor.items.filter(i => i.getFlag(MODULE_ID, "containerId") === containerItem.id);
	const label = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.contains_label");

	// Prefer embedded contents on normal actors, but fall back to packed snapshot when needed.
	const hasEmbedded = contained.length > 0;
	const entries = hasEmbedded ? contained : packed;
	if (!entries.length) {
		const empty = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.contains_empty");
		return `${label} ${empty}`;
	}

	// Build a plain text list for tooltip
	const items = entries
		.slice(0, 50)
		.map(entry => {
			const isOwnedItem = entry instanceof Item;
			const name = entry?.name ?? "";
			const qty = Number(entry?.system?.quantity ?? 1);
			const qtySuffix = Number.isFinite(qty) && qty > 1 ? ` x${qty}` : "";
			return `• ${name}${qtySuffix}`;
		})
		.join('\n');

	const more = entries.length > 50 ? `\n• ... and ${entries.length - 50} more` : "";
	return `${label}\n${items}${more}`;
}

function attachContainerContentsToActorSheet(app, html) {
	// Check if containers are enabled
	if (!game.settings.get(MODULE_ID, "enableContainers")) return;

	const actor = app?.actor;
	if (!actor) return;

	// Add tooltips to container items in inventory
	html.find('.item[data-item-id]').each((_, el) => {
		const $el = $(el);
		const itemId = $el.data('itemId') ?? $el.attr('data-item-id');
		if (!itemId) return;
		const item = actor.items?.get?.(itemId);
		if (!item) return;
		if (!(item.type === "Basic" && Boolean(item.getFlag(MODULE_ID, "isContainer")))) return;

		// Build tooltip content
		const tooltip = buildContainerTooltip(item);
		if (!tooltip) return;

		// Add tooltip to the item row
		$el.attr('title', tooltip);
		$el.addClass('sdx-has-container-tooltip');
	});
}






/**
 * Enable chat icon on item images to show item in chat
 * NOTE: This only handles items that Shadowdark doesn't natively handle.
 * Shadowdark's PlayerSheetSD already has _onItemChatClick which calls displayCard()
 * for all items via .item-image click. We only need to handle NPC items.
 */
function enableItemChatIcon(app, html) {
	const actor = app?.actor;
	if (!actor) return;

	// Skip for player sheets - Shadowdark handles these natively via _onItemChatClick
	// This prevents duplicate chat messages when clicking item images
	if (actor.type === "Player") return;

	// Handle click on item image (when it has the chat icon)
	html.find('.item-image').off('click.sdxChat').on('click.sdxChat', async function (ev) {
		// Only handle if this item-image has a comment icon
		if (!$(this).find('.fa-comment').length) return;

		ev.preventDefault();
		ev.stopPropagation();

		const $itemRow = $(this).closest('.item[data-item-id]');
		const itemId = $itemRow.data('itemId') ?? $itemRow.attr('data-item-id');
		if (!itemId) return;

		const item = actor.items.get(itemId);
		if (!item) return;

		// Check if unidentified (and user is not GM)
		if (!game.user?.isGM && isUnidentified(item)) {
			ui.notifications.warn("Cannot show unidentified item in chat");
			return;
		}

		// Show item in chat - Shadowdark uses displayCard()
		await item.displayCard();
	});
}

/**
 * Register module settings
 * 
 * Settings are registered in order to match the section headers:
 * 1. Configuration Menus (Combat, Effects, HP Waves, Inventory Styles)
 * 2. Combat & Spells (Focus Tracker, Enhance Spells)
 * 3. Character Sheet (Enhanced Header, Renown, Journal Notes, Add Coins, Conditions Theme)
 * 4. Inventory (Containers, Trading, Unidentified, Multi-select)
 * 5. Carousing (Enable, Mode, Tables)
 * 6. NPC Features (NPC Inventory, Creature Type)
 * 7. Visual & Animation (Torch Animations)
 */


function registerSettings() {
	// ═══════════════════════════════════════════════════════════════
	// 1. CONFIGURATION MENUS
	// ═══════════════════════════════════════════════════════════════

	// Combat Settings Menu (registered via registerCombatSettings)
	registerCombatSettings();

	// Effects Settings Menu (registered via registerEffectsSettings)
	registerEffectsSettings();

	// HP Waves Settings Menu (registered via registerHpWavesSettings)
	registerHpWavesSettings();

	// Travel Activities Settings Menu (registered via registerTravelActivitiesSettings)
	registerTravelActivitiesSettings();

	// Travel Speeds Settings Menu (registered via registerTravelSpeedsSettings)
	registerTravelSpeedsSettings();

	// Party Weather RollTable Settings Menu
	registerPartyWeatherSettings();

	// Inventory Styles data setting (hidden)
	game.settings.register(MODULE_ID, "itemacroMigrationDone", {
		scope: "world",
		config: false,
		default: false,
		type: Boolean
	});

	// Gate for the one-time PNG/JPG -> WebP stored-path migration.
	game.settings.register(MODULE_ID, "webpMigrationDone", {
		scope: "world",
		config: false,
		default: false,
		type: Boolean
	});

	// Separate gate for the world-compendium sweep: packs that were locked (or
	// whose update failed) must be retried on later loads, so this only flips
	// once a sweep completes cleanly.
	game.settings.register(MODULE_ID, "webpPackSweepDone", {
		scope: "world",
		config: false,
		default: false,
		type: Boolean
	});

	game.settings.register(MODULE_ID, "inventoryStyles", {
		name: "Inventory Styles Configuration",
		scope: "world",
		config: false,
		type: Object,
		default: foundry.utils.deepClone(DEFAULT_INVENTORY_STYLES)
	});

	// Inventory Styles Menu
	game.settings.registerMenu(MODULE_ID, "inventoryStylesMenu", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.inventory_styles.name"),
		label: game.i18n.localize("SHADOWDARK_EXTRAS.settings.inventory_styles.label"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.inventory_styles.hint"),
		icon: "fas fa-palette",
		type: InventoryStylesApp,
		restricted: true
	});

	// Sheet Style Editor Menu
	game.settings.registerMenu(MODULE_ID, "sheetEditorMenu", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.menuName"),
		label: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.menuLabel"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.menuHint"),
		icon: "fas fa-paint-brush",
		type: SheetEditorConfig,
		restricted: true
	});

	// ═══════════════════════════════════════════════════════════════
	// 2. COMBAT & SPELLS
	// ═══════════════════════════════════════════════════════════════

	game.settings.register(MODULE_ID, "enableFogEffects", {
		name: "Enable Fog Effects",
		hint: "Enable shader effects for hex fog (right-click the Hex Fog button to pick an effect). Disable to save performance.",
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
	});

	game.settings.register(MODULE_ID, "enableFocusTracker", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_focus_tracker.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_focus_tracker.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	game.settings.register(MODULE_ID, "autoRollFocusOnTurn", {
		name: "Auto-Roll Focus on Turn",
		hint: "At the start of a caster's turn, automatically roll the focus check for each active focus spell instead of posting a manual reminder. On success the spell's per-turn effect applies; on failure the spell ends. Requires the Focus Tracker.",
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
		requiresReload: false,
	});

	game.settings.register(MODULE_ID, "enhanceSpells", {
		name: "Enhance Spells",
		hint: "Add damage/heal configuration to spell items for automatic spell damage application similar to weapon attacks.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true
	});

	// Custom Light Templates data setting (hidden)
	game.settings.register(MODULE_ID, "customLightTemplates", {
		name: "Custom Light Templates",
		scope: "world",
		config: false,
		type: Array,
		default: foundry.utils.deepClone(DEFAULT_LIGHT_TEMPLATES)
	});

	game.settings.register(MODULE_ID, "customDecorAssets", {
		name: "Custom Decor Assets",
		scope: "world",
		config: false,
		type: Array,
		default: []
	});

	game.settings.register(MODULE_ID, "decorDungeondraftPacks", {
		name: "Dungeondraft Decor Packs",
		scope: "world",
		config: false,
		type: Array,
		default: []
	});

	game.settings.registerMenu(MODULE_ID, "decorDungeondraftPacksMenu", {
		name: "Dungeondraft Decor Packs",
		label: "Manage Packs",
		hint: "Import, enable, or hide Dungeondraft object packs in the SDX Decor tray.",
		icon: "fas fa-cubes",
		type: class extends foundry.applications.api.ApplicationV2 {
			static DEFAULT_OPTIONS = { id: "sdx-ddpack-settings-menu-stub", window: { title: "" } };
			async render() {
				const { DDPackSettingsApp } = await import("./dungeon/DDPackSettingsAppSD.mjs");
				new DDPackSettingsApp().render(true);
				return this;
			}
		},
		restricted: true
	});

	// Custom Light Templates Menu
	game.settings.registerMenu(MODULE_ID, "customLightTemplatesMenu", {
		name: "Light Templates",
		label: "Light Templates",
		hint: "Configure custom light templates for items.",
		icon: "fas fa-lightbulb",
		type: LightTemplateEditor,
		restricted: true
	});

	game.settings.register(MODULE_ID, "enableWandUses", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_wand_uses.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_wand_uses.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true
	});

	// ═══════════════════════════════════════════════════════════════
	// 3. CHARACTER SHEET
	// ═══════════════════════════════════════════════════════════════
	game.settings.register(MODULE_ID, "showMedkitIcon", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.show_medkit_icon.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.show_medkit_icon.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: false,
	});

	// Medkit World Scan — GM-only button that scans every actor and applies
	// available spell updates in one pass (no per-actor sheet clicking).
	game.settings.registerMenu(MODULE_ID, "medkitWorldScanMenu", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.medkit_world_scan.name"),
		label: game.i18n.localize("SHADOWDARK_EXTRAS.settings.medkit_world_scan.label"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.medkit_world_scan.hint"),
		icon: "fas fa-kit-medical",
		type: MedkitWorldScanMenu,
		restricted: true
	});
	game.settings.register(MODULE_ID, "enableEnhancedHeader", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_enhanced_header.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_enhanced_header.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	game.settings.register(MODULE_ID, "enableNpcPlayerTheme", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_npc_player_theme.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_npc_player_theme.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: false,
		onChange: () => {
			for (const app of Object.values(ui.windows ?? {})) {
				if (app.actor?.type === "NPC") app.render(false);
			}
		},
	});

	game.settings.register(MODULE_ID, "enableDefaultHeaderBg", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_default_header_bg.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_default_header_bg.hint"),
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
	});

	game.settings.register(MODULE_ID, "defaultHeaderBgPath", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.default_header_bg_path.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.default_header_bg_path.hint"),
		scope: "world",
		config: true,
		default: "",
		type: String,
		filePicker: "imagevideo",
	});

	// Internal setting - always enabled, not shown in UI
	game.settings.register(MODULE_ID, "enableEnhancedDetails", {
		name: "Enable Player Sheet Tabs Theme Enhancement",
		hint: "Enhances the Details tab with improved styling and organization to match the enhanced header theme.",
		scope: "world",
		config: false,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	// Sheet Decoration Settings - Border and Panel Styles
	const borderChoices = {};
	for (let i = 0; i <= 31; i++) {
		const num = String(i).padStart(3, '0');
		borderChoices[`panel-border-${num}.png`] = `Border Style ${i}`;
	}

	const panelChoices = {};
	for (let i = 0; i <= 31; i++) {
		const num = String(i).padStart(3, '0');
		panelChoices[`panel-${num}.png`] = `Panel Style ${i}`;
	}

	const transparentCenterChoices = {};
	for (let i = 0; i <= 31; i++) {
		const num = String(i).padStart(3, '0');
		transparentCenterChoices[`panel-transparent-center-${num}.png`] = `Panel Style ${i}`;
	}

	game.settings.register(MODULE_ID, "sheetBorderStyle", {
		name: "Sheet Border Style",
		hint: "Choose the decorative border frame around the player character sheet.",
		scope: "world",
		config: false,
		default: "panel-border-004.webp",
		type: String,
		choices: borderChoices,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "abilityPanelStyle", {
		name: "Ability Panel Style",
		hint: "Choose the panel background for ability stat boxes (STR, DEX, etc.).",
		scope: "world",
		config: false,
		default: "panel-013.webp",
		type: String,
		choices: panelChoices,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "acPanelStyle", {
		name: "AC Panel Style",
		hint: "Choose the panel background for the Armor Class box.",
		scope: "world",
		config: false,
		default: "panel-transparent-center-004.webp",
		type: String,
		choices: transparentCenterChoices,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "statPanelStyle", {
		name: "Init/Level/Luck Panel Style",
		hint: "Choose the panel background for Initiative, Level, and Luck boxes.",
		scope: "world",
		config: false,
		default: "panel-transparent-center-015.webp",
		type: String,
		choices: transparentCenterChoices,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "borderImageWidth", {
		name: "Border Image Width",
		scope: "world",
		config: false,
		default: 16,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "borderImageSlice", {
		name: "Border Image Slice",
		scope: "world",
		config: false,
		default: 12,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "borderImageOutset", {
		name: "Border Image Outset",
		scope: "world",
		config: false,
		default: 0,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "borderImageRepeat", {
		name: "Border Image Repeat",
		scope: "world",
		config: false,
		default: "stretch",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "borderBackgroundColor", {
		name: "Border Background Color",
		scope: "world",
		config: false,
		default: "",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "borderWidth", {
		name: "Border Width",
		scope: "world",
		config: false,
		default: 10,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "sdBoxBorderStyle", {
		name: "SD-Box Border Style",
		scope: "world",
		config: false,
		default: "panel-border-001.webp",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "sdBoxBorderWidth", {
		name: "SD-Box Border Image Width",
		scope: "world",
		config: false,
		default: 16,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "sdBoxBorderSlice", {
		name: "SD-Box Border Image Slice",
		scope: "world",
		config: false,
		default: 12,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "sdBoxBorderTransparencyWidth", {
		name: "SD-Box Border Width",
		scope: "world",
		config: false,
		default: 10,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	// Journal Border Settings
	game.settings.register(MODULE_ID, "journalBorderStyle", {
		name: "Journal Border Style",
		scope: "world",
		config: false,
		default: "panel-border-004.webp",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "journalBorderImageWidth", {
		name: "Journal Border Image Width",
		scope: "world",
		config: false,
		default: 16,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "journalBorderImageSlice", {
		name: "Journal Border Image Slice",
		scope: "world",
		config: false,
		default: 12,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "journalBorderImageOutset", {
		name: "Journal Border Image Outset",
		scope: "world",
		config: false,
		default: 0,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "journalBorderImageRepeat", {
		name: "Journal Border Image Repeat",
		scope: "world",
		config: false,
		default: "repeat",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	// Condition Modal Border Settings
	game.settings.register(MODULE_ID, "conditionModalBorderStyle", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.conditionModalBorder"),
		scope: "world",
		config: false,
		default: "panel-border-004.webp",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "conditionModalBorderImageWidth", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.conditionModalBorderImageWidth"),
		scope: "world",
		config: false,
		default: 16,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "conditionModalBorderImageSlice", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.conditionModalBorderImageSlice"),
		scope: "world",
		config: false,
		default: 12,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "conditionModalBorderImageOutset", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.conditionModalBorderImageOutset"),
		scope: "world",
		config: false,
		default: 0,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "conditionModalBorderImageRepeat", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.conditionModalBorderImageRepeat"),
		scope: "world",
		config: false,
		default: "repeat",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "abilityModColor", {
		name: "Ability Modifier Color",
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "levelValueColor", {
		name: "Level Value Color",
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "acValueColor", {
		name: "AC Value Color",
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "initModColor", {
		name: "Initiative Modifier Color",
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "luckValueColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.luckValueColor"),
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	// Extended Text Color Settings
	game.settings.register(MODULE_ID, "navLinkColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.navLinkColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "navLinkActiveColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.navLinkActiveColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "detailsRowColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.detailsRowColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "borderBackgroundColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.borderBackgroundColor"),
		scope: "world",
		config: false,
		default: "",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "sheetHeaderBackgroundColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.sheetHeaderBackgroundColor"),
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "luckContainerColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.luckContainerColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "actorNameColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.actorNameColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "windowHeaderColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.windowHeaderColor"),
		scope: "world",
		config: false,
		default: "#000000ff",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "navBackgroundColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.navBackgroundColor"),
		scope: "world",
		config: false,
		default: "#000000ff",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "navBorderColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.navBorderColor"),
		scope: "world",
		config: false,
		default: "rgba(0, 0, 0, 0.5)",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "effectsTextColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.effectsTextColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "talentsTextColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.talentsTextColor"),
		scope: "world",
		config: false,
		default: "#ffffffff",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "xpRowColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.xpRowColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "windowTitleBarBackgroundColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.windowTitleBarBackgroundColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "statsLabelColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.statsLabelColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "actorNameShadowColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.actorNameShadowColor"),
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "actorNameShadowAlpha", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.actorNameShadowAlpha"),
		scope: "world",
		config: false,
		default: 0.8,
		type: Number,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "actorNameFontWeight", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.actorNameFontWeight"),
		scope: "world",
		config: false,
		default: "bold",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	// Tab background gradient settings
	game.settings.register(MODULE_ID, "tabGradientStart", {
		name: "Tab Gradient Start Color",
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "tabGradientEnd", {
		name: "Tab Gradient End Color",
		scope: "world",
		config: false,
		default: "#2f2b2b",
		type: String,
		onChange: () => applySheetDecorationStyles()
	});

	game.settings.register(MODULE_ID, "enableJournalNotes", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_journal_notes.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_journal_notes.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true
	});


	game.settings.register(MODULE_ID, "enablePlaceableNotes", {
		name: "Enable Notes on placeables and Notes tab in tray",
		hint: "Adds a Notes button to configuration windows for Lights, Sounds, Tokens, Walls, and Tiles.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true
	});

	game.settings.register(MODULE_ID, "enableAddCoinsButton", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_add_coins_button.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_add_coins_button.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	game.settings.register(MODULE_ID, "conditionsTheme", {
		name: "Conditions theme",
		hint: "Choose a visual theme for the quick conditions toggles",
		scope: "world",
		config: true,
		default: "shadowdark",
		type: String,
		choices: {
			"shadowdark": "Shadowdark",
			"5e": "5e",
			parchment: "Parchment (Default)",
			stone: "Stone Tablet",
			leather: "Leather Bound",
			iron: "Iron & Rust",
			moss: "Moss & Decay",
			blood: "Blood & Shadow"
		},
		onChange: () => {
			// Re-render all open player sheets
			const PlayerSheetClass = globalThis.shadowdark?.apps?.PlayerSheetSD;
			if (PlayerSheetClass) {
				Object.values(ui.windows).filter(app => app instanceof PlayerSheetClass).forEach(app => app.render());
			}
		}
	});

	// ═══════════════════════════════════════════════════════════════
	// 4. INVENTORY
	// ═══════════════════════════════════════════════════════════════

	game.settings.register(MODULE_ID, "enableContainers", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_containers.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_containers.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	game.settings.register(MODULE_ID, "enableNestedContainers", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_nested_containers.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_nested_containers.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});

	game.settings.register(MODULE_ID, "enableTrading", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_trading.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_trading.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	game.settings.register(MODULE_ID, "enableMultiselect", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_multiselect.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_multiselect.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	// ═══════════════════════════════════════════════════════════════
	// 5. CAROUSING
	// ═══════════════════════════════════════════════════════════════

	game.settings.register(MODULE_ID, "enableCarousing", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_carousing.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_carousing.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true
	});

	game.settings.register(MODULE_ID, "carousingMode", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_mode.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_mode.hint"),
		scope: "world",
		config: true,
		default: "original",
		type: String,
		choices: {
			"original": game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_mode.original"),
			"expanded": game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_mode.expanded")
		},
		onChange: () => {
			// Re-render all open player sheets to update carousing tab
			Object.values(ui.windows).forEach(app => {
				if (app.actor?.type === "Player") app.render();
			});
		}
	});

	// Carousing - Show benefit descriptions to players
	game.settings.register(MODULE_ID, "carousingShowBenefitsToPlayers", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_show_benefits.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_show_benefits.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean
	});

	// Carousing - Show mishap descriptions to players
	game.settings.register(MODULE_ID, "carousingShowMishapsToPlayers", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_show_mishaps.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_show_mishaps.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean
	});

	// Carousing - What "N% of your total wealth" is measured against when the GM
	// applies an outcome. The deduction always comes out of coins; "coinsAndGear"
	// only widens the base so stockpiling gear can't dodge the penalty.
	game.settings.register(MODULE_ID, "carousingWealthBase", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_wealth_base.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_wealth_base.hint"),
		scope: "world",
		config: true,
		default: "coins",
		type: String,
		choices: {
			coins: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_wealth_base.coins"),
			coinsAndGear: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_wealth_base.coins_and_gear")
		}
	});

	// Carousing Tables Editor Menu Button
	// Opens a single editor that hosts both modes via an in-window Original/Expanded
	// switch. It opens on the mode currently selected in the Carousing Mode setting.
	game.settings.registerMenu(MODULE_ID, "carousingTablesMenu", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.manage_tables"),
		label: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.manage_tables"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.manage_tables_hint"),
		icon: "fas fa-beer",
		type: class extends foundry.applications.api.ApplicationV2 {
			static DEFAULT_OPTIONS = { id: "sdx-carousing-tables-menu-stub", window: { title: "" } };
			async render() {
				const mode = game.settings.get(MODULE_ID, "carousingMode") || "original";
				if (mode === "expanded") openExpandedCarousingTablesEditor();
				else openCarousingTablesEditor();
				return this;
			}
		},
		restricted: true
	});

	// Expanded Carousing Data Storage (hidden setting)
	game.settings.register(MODULE_ID, "expandedCarousingData", {
		name: "Expanded Carousing Data",
		scope: "world",
		config: false,
		default: null,
		type: Object
	});

	// ═══════════════════════════════════════════════════════════════
	// 6. NPC FEATURES
	// ═══════════════════════════════════════════════════════════════

	game.settings.register(MODULE_ID, "enableNpcInventory", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_npc_inventory.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_npc_inventory.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	game.settings.register(MODULE_ID, "enableNpcCreatureType", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_npc_creature_type.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_npc_creature_type.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: false,
	});

	// Custom creature types storage
	game.settings.register(MODULE_ID, "customCreatureTypes", {
		scope: "world",
		config: false,
		default: [],
		type: Array,
	});

	// Menu button to open creature types editor
	game.settings.registerMenu(MODULE_ID, "manageCreatureTypes", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.manage_creature_types.name"),
		label: game.i18n.localize("SHADOWDARK_EXTRAS.settings.manage_creature_types.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.manage_creature_types.hint"),
		icon: "fas fa-dragon",
		type: CreatureTypesApp,
		restricted: true,
	});

	// ═══════════════════════════════════════════════════════════════
	// 7. VISUAL & ANIMATION
	// ═══════════════════════════════════════════════════════════════

	game.settings.register(MODULE_ID, "enableTorchAnimations", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_torch_animations.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_torch_animations.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	game.settings.register(MODULE_ID, "enableLevelUpAnimation", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_level_up_animation.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_level_up_animation.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});
	game.settings.register(MODULE_ID, "pixelPerfectPins", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.pixel_perfect_pins.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.pixel_perfect_pins.hint"),
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
		requiresReload: false,
		onChange: () => {
			if (canvas?.scene && window.JournalPinRenderer) {
				const pins = window.JournalPinManager?.list({ sceneId: canvas.scene.id }) || [];
				window.JournalPinRenderer.loadScenePins(canvas.scene.id, pins);
			}
		}
	});

	game.settings.register(MODULE_ID, "pixelPerfectPinsAlpha", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.pixel_perfect_pins_alpha.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.pixel_perfect_pins_alpha.hint"),
		scope: "world",
		config: true,
		default: 100,
		type: Number,
		range: {
			min: 0,
			max: 255,
			step: 1
		},
		requiresReload: false,
		onChange: () => {
			if (canvas?.scene && window.JournalPinRenderer) {
				const pins = window.JournalPinManager?.list({ sceneId: canvas.scene.id }) || [];
				window.JournalPinRenderer.loadScenePins(canvas.scene.id, pins);
			}
		}
	});
	// ═══════════════════════════════════════════════════════════════
	// 9. EASY REFERENCE MENU
	// ═══════════════════════════════════════════════════════════════

	// Easy Reference ProseMirror menu settings
	registerEasyReferenceSettings();

	// 10. TOKEN TOOLBAR
	// ═══════════════════════════════════════════════════════════════

	// Token Toolbar settings
	registerTokenToolbarSettings();

	// Character Tray settings
	registerTraySettings();

	// 11. PIN STYLE EDITOR
	// ═══════════════════════════════════════════════════════════════

	// Pin Style Editor settings
	registerPinStyleSettings();

	// 11b. SDX COORDS
	// ═══════════════════════════════════════════════════════════════
	registerSDXCoordsSettings();
	registerSDXCoordsMenu(SDXCoordsSettingsApp);

	// ═══════════════════════════════════════════════════════════════
	// 12. DRAWING TOOLS
	// ═══════════════════════════════════════════════════════════════

	game.settings.register(MODULE_ID, "drawing.enablePlayerDrawing", {
		name: "Allow Player Drawing",
		hint: "When enabled, players can use the drawing tools to mark up the map.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});

	game.settings.register(MODULE_ID, "drawing.timedEraseTimeout", {
		name: "Timed Erase Timeout (seconds)",
		hint: "How long drawings persist before fading when Timed Erase is enabled.",
		scope: "world",
		config: true,
		default: 30,
		type: Number,
		range: { min: 5, max: 120, step: 5 },
	});

	game.settings.register(MODULE_ID, "drawing.hotkeyEnabled", {
		name: "Enable Drawing Hotkey",
		hint: "Allow using a hotkey (hold) to quickly draw without opening the toolbar.",
		scope: "client",
		config: true,
		default: true,
		type: Boolean,
	});

	game.settings.register(MODULE_ID, "drawing.blockWhenTyping", {
		name: "Block Drawing While Typing",
		hint: "Prevent the drawing hotkey from activating while typing in text fields.",
		scope: "client",
		config: true,
		default: true,
		type: Boolean,
	});

	// Hidden toolbar state settings (persist between sessions)
	game.settings.register(MODULE_ID, "drawing.toolbar.drawingMode", { scope: "client", config: false, default: "sketch", type: String });
	game.settings.register(MODULE_ID, "drawing.toolbar.stampStyle", { scope: "client", config: false, default: "plus", type: String });
	game.settings.register(MODULE_ID, "drawing.toolbar.symbolSize", { scope: "client", config: false, default: "medium", type: String });
	game.settings.register(MODULE_ID, "drawing.toolbar.lineWidth", { scope: "client", config: false, default: 6, type: Number });
	game.settings.register(MODULE_ID, "drawing.toolbar.lineStyle", { scope: "client", config: false, default: "solid", type: String });
	game.settings.register(MODULE_ID, "drawing.toolbar.color", { scope: "client", config: false, default: "", type: String });
	game.settings.register(MODULE_ID, "drawing.toolbar.timedEraseEnabled", { scope: "client", config: false, default: false, type: Boolean });
	game.settings.register(MODULE_ID, "drawing.toolbar.opacity", { scope: "client", config: false, default: 1.0, type: Number });
	game.settings.register(MODULE_ID, "drawing.toolbar.position", { scope: "client", config: false, default: "", type: String });

	// Keybinding: Hold to draw
	game.keybindings.register(MODULE_ID, "drawHotkey", {
		name: "Drawing Tool Hotkey (Hold)",
		hint: "Hold this key to draw on the canvas. Release to finish the stroke.",
		editable: [{ key: "KeyL" }],
		onDown: () => {
			if (!game.settings.get(MODULE_ID, "drawing.hotkeyEnabled")) return false;
			if (game.settings.get(MODULE_ID, "drawing.blockWhenTyping")) {
				const active = document.activeElement;
				if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return false;
			}
			if (!canvas?.ready) return false;
			if (game.shadowdarkExtras?.drawingTool) {
				game.shadowdarkExtras.drawingTool.onHoldKeyDown();
				return true;
			}
			return false;
		},
		onUp: () => {
			if (game.shadowdarkExtras?.drawingTool) {
				game.shadowdarkExtras.drawingTool.onHoldKeyUp();
				return true;
			}
			return false;
		},
		restricted: false,
		precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
	});
}

/**
 * Setup the renderSettingsConfig hook to organize settings with section headers
 * 
 * Settings are organized into these groups:
 * 1. Configuration Menus: Combat, Effects, HP Waves, Inventory Styles menus
 * 2. Combat & Spells: Focus Tracker, Enhance Spells
 * 3. Character Sheet: Enhanced Header, backgrounds, Renown, Journal Notes, Add Coins, Conditions Theme
 * 4. Inventory: Containers, Nested Containers, Trading, Unidentified, Multi-select
 * 5. Carousing: Enable Carousing, Mode, Table menus
 * 6. NPC Features: NPC Inventory, Creature Type
 * 7. Visual & Animation: Torch Animations
 * 8. SDX Rolls: All SDX Rolls settings
 */
function setupSettingsOrganization() {
	Hooks.on("renderSettingsConfig", (app, html, data) => {
		// In Foundry v13, html may be a native HTMLElement instead of jQuery
		const $html = html instanceof jQuery ? html : $(html);

		// Only process if we're looking at our module's settings section
		const sdxSection = $html.find(`[data-category="${MODULE_ID}"]`);
		if (sdxSection.length === 0) return;

		// Helper function to create a group header
		const createHeader = (text, icon = null) => {
			const iconHtml = icon ? `<i class="${icon}"></i> ` : '';
			return $('<div>').addClass('form-group group-header sdx-settings-header').html(`${iconHtml}${text}`);
		};

		// Helper to insert header before first found element
		const insertHeaderBefore = (selector, headerText, headerIcon) => {
			const element = sdxSection.find(selector);
			if (element.length) {
				const formGroup = element.closest('.form-group');
				if (formGroup.length && !formGroup.prev().hasClass('sdx-settings-header')) {
					createHeader(headerText, headerIcon).insertBefore(formGroup);
				}
			}
		};

		// ═══════════════════════════════════════════════════════════════
		// Insert section headers before specific settings
		// The setting listed is the FIRST setting in that group
		// ═══════════════════════════════════════════════════════════════

		// 1. CONFIGURATION MENUS - First is Combat Settings Menu
		insertHeaderBefore(
			'[data-key="shadowdark-extras.combatSettingsMenu"]',
			game.i18n.localize("SHADOWDARK_EXTRAS.settings.headers.configuration_menus"),
			"fas fa-cogs"
		);

		// 2. COMBAT & SPELLS - First is Focus Tracker
		insertHeaderBefore(
			'[name="shadowdark-extras.enableFocusTracker"]',
			game.i18n.localize("SHADOWDARK_EXTRAS.settings.headers.combat_spells"),
			"fas fa-magic"
		);

		// 3. CHARACTER SHEET - First is Enhanced Header
		insertHeaderBefore(
			'[name="shadowdark-extras.enableEnhancedHeader"]',
			game.i18n.localize("SHADOWDARK_EXTRAS.settings.headers.character_sheet"),
			"fas fa-user"
		);

		// 4. INVENTORY - First is Containers
		insertHeaderBefore(
			'[name="shadowdark-extras.enableContainers"]',
			game.i18n.localize("SHADOWDARK_EXTRAS.settings.headers.inventory"),
			"fas fa-box-open"
		);

		// 5. CAROUSING - First is Enable Carousing
		insertHeaderBefore(
			'[name="shadowdark-extras.enableCarousing"]',
			game.i18n.localize("SHADOWDARK_EXTRAS.settings.headers.carousing"),
			"fas fa-beer-mug-empty"
		);

		// 6. NPC FEATURES - First is NPC Inventory
		insertHeaderBefore(
			'[name="shadowdark-extras.enableNpcInventory"]',
			game.i18n.localize("SHADOWDARK_EXTRAS.settings.headers.npc_features"),
			"fas fa-skull"
		);

		// 7. VISUAL & ANIMATION - First is Torch Animations
		insertHeaderBefore(
			'[name="shadowdark-extras.enableTorchAnimations"]',
			game.i18n.localize("SHADOWDARK_EXTRAS.settings.headers.visual_features"),
			"fas fa-sparkles"
		);

		// 8. SDX ROLLS - First is Recap Message
		insertHeaderBefore(
			'[name="shadowdark-extras.SDXROLLSRecapMessage"]',
			game.i18n.localize("SHADOWDARK_EXTRAS.settings.headers.sdx_rolls"),
			"fas fa-dice-d20"
		);

		// 9. TOKEN TOOLBAR - First is Enable Token Toolbar
		insertHeaderBefore(
			'[name="shadowdark-extras.tokenToolbar.enabled"]',
			game.i18n.localize("SHADOWDARK_EXTRAS.settings.headers.token_toolbar"),
			"fas fa-id-badge"
		);

		// 10. DRAWING TOOLS - First is Enable Player Drawing
		insertHeaderBefore(
			'[name="shadowdark-extras.drawing.enablePlayerDrawing"]',
			"Drawing Tools",
			"fas fa-pencil"
		);
	});
}

// ============================================
// JOURNAL NOTES SYSTEM
// ============================================

/**
 * Default structure for journal pages
 */
const DEFAULT_JOURNAL_PAGE = {
	id: "",
	name: "New Page",
	content: ""
};

/**
 * Generate a unique ID for journal pages
 */
function generateJournalPageId() {
	return foundry.utils.randomID(16);
}

/**
 * Get journal pages for an actor
 */
function getJournalPages(actor) {
	return actor.getFlag(MODULE_ID, "journalPages") ?? [];
}

/**
 * Get the active page ID for an actor (or first page if none set)
 */
function getActiveJournalPageId(actor) {
	const activeId = actor.getFlag(MODULE_ID, "activeJournalPage");
	const pages = getJournalPages(actor);
	if (activeId && pages.find(p => p.id === activeId)) {
		return activeId;
	}
	return pages[0]?.id ?? null;
}

/**
 * Set the active journal page
 */
async function setActiveJournalPage(actor, pageId) {
	await actor.setFlag(MODULE_ID, "activeJournalPage", pageId);
}

/**
 * Add a new journal page
 */
async function addJournalPage(actor, name = null) {
	const pages = getJournalPages(actor);
	const newPage = {
		id: generateJournalPageId(),
		name: name || game.i18n.format("SHADOWDARK_EXTRAS.journal.default_page_name", { num: pages.length + 1 }),
		content: ""
	};
	pages.push(newPage);
	await actor.setFlag(MODULE_ID, "journalPages", pages);
	await setActiveJournalPage(actor, newPage.id);
	return newPage;
}

/**
 * Update a journal page
 */
async function updateJournalPage(actor, pageId, updates) {
	const pages = getJournalPages(actor);
	const pageIndex = pages.findIndex(p => p.id === pageId);
	if (pageIndex === -1) return null;

	pages[pageIndex] = foundry.utils.mergeObject(pages[pageIndex], updates);
	await actor.setFlag(MODULE_ID, "journalPages", pages);
	return pages[pageIndex];
}

/**
 * Delete a journal page
 */
async function deleteJournalPage(actor, pageId) {
	let pages = getJournalPages(actor);
	pages = pages.filter(p => p.id !== pageId);
	await actor.setFlag(MODULE_ID, "journalPages", pages);

	// If we deleted the active page, switch to first page
	const activeId = getActiveJournalPageId(actor);
	if (activeId === pageId || !activeId) {
		await setActiveJournalPage(actor, pages[0]?.id ?? null);
	}
	return pages;
}

/**
 * Inject the Journal Notes system into the player sheet Notes tab
 */
async function injectJournalNotes(app, html, actor) {
	// Check if journal notes is enabled
	try {
		if (!game.settings.get(MODULE_ID, "enableJournalNotes")) return;
	} catch {
		return;
	}

	// Use the app's element directly - more reliable than the html parameter
	const sheetElement = app.element;
	if (!sheetElement || sheetElement.length === 0) {
		//console.log("SDX Journal: Sheet element not found");
		return;
	}

	// Find the notes tab - it's a section with class "tab-notes" and data-tab="tab-notes"
	const notesTab = sheetElement.find('section.tab-notes[data-tab="tab-notes"]');
	if (notesTab.length === 0) {
		//console.log("SDX Journal: Notes tab section not found");
		return;
	}

	// Prevent duplicate injection - check inside the notes tab specifically
	if (notesTab.find('.sdx-journal-notes').length > 0) {
		return;
	}

	const targetTab = notesTab.first();

	// Get journal pages data
	let pages = getJournalPages(actor);

	// If no pages exist yet and there's existing notes content, migrate it
	if (pages.length === 0) {
		const existingNotes = actor.system?.notes || "";
		const firstPage = {
			id: generateJournalPageId(),
			name: game.i18n.localize("SHADOWDARK_EXTRAS.journal.default_first_page"),
			content: existingNotes
		};
		pages = [firstPage];
		await actor.setFlag(MODULE_ID, "journalPages", pages);
		await setActiveJournalPage(actor, firstPage.id);
	}

	// Get active page
	const activePageId = getActiveJournalPageId(actor);
	const activePage = pages.find(p => p.id === activePageId) || pages[0];

	// Mark pages as active/inactive
	const pagesWithActive = pages.map(p => ({
		...p,
		active: p.id === activePage?.id
	}));

	// Enrich the active page content
	let activePageContent = "";
	if (activePage) {
		const enrichHTMLImpl = foundry?.applications?.ux?.TextEditor?.implementation?.enrichHTML ?? TextEditor.enrichHTML;
		activePageContent = await enrichHTMLImpl(
			activePage.content || "",
			{
				secrets: actor.isOwner,
				async: true,
				relativeTo: actor,
			}
		);
	}

	// Render the journal template
	const templatePath = `modules/${MODULE_ID}/templates/journal-notes.hbs`;
	const renderTpl = foundry?.applications?.handlebars?.renderTemplate ?? renderTemplate;
	const journalHtml = await renderTpl(templatePath, {
		pages: pagesWithActive,
		activePage: activePage,
		activePageContent: activePageContent,
		editable: app.isEditable,
		actorId: actor.id
	});

	// Remove any existing journal notes first
	targetTab.find('.sdx-journal-notes').remove();

	// Hide ALL original content in the notes tab (the SD-hideable-section with the editor)
	targetTab.children().each(function () {
		if (!$(this).hasClass('sdx-journal-notes')) {
			$(this).hide();
		}
	});

	// Mark tab as having journal active
	targetTab.addClass("sdx-journal-active");

	// Append the journal inside the target tab only
	targetTab.append(journalHtml);

	// Activate event listeners
	activateJournalListeners(app, html, actor);
}

/**
 * Activate event listeners for the journal notes system
 */
function activateJournalListeners(app, html, actor) {
	// Find the journal section specifically within the notes tab
	const notesTab = app.element.find('section.tab-notes[data-tab="tab-notes"]');
	const journalSection = notesTab.find('.sdx-journal-notes');
	if (journalSection.length === 0) return;

	// Page selection
	journalSection.find('.sdx-journal-page-item').on('click', async (ev) => {
		// Don't trigger if clicking delete button
		if ($(ev.target).closest('.sdx-page-delete').length) return;

		const pageId = $(ev.currentTarget).data('page-id');
		await setActiveJournalPage(actor, pageId);
		app.render(false);
	});

	// Add page button
	journalSection.find('[data-action="add-page"]').on('click', async (ev) => {
		ev.preventDefault();
		await addJournalPage(actor);
		app.render(false);
	});

	// Delete page button
	journalSection.find('[data-action="delete-page"]').on('click', async (ev) => {
		ev.preventDefault();
		ev.stopPropagation();

		const pageId = $(ev.currentTarget).data('page-id');
		const pages = getJournalPages(actor);
		const page = pages.find(p => p.id === pageId);

		// Confirm deletion
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.journal.delete_page_title") },
			content: `<p>${game.i18n.format("SHADOWDARK_EXTRAS.journal.delete_page_confirm", { name: page?.name || "Page" })}</p>`,
			modal: true
		});

		if (confirmed) {
			await deleteJournalPage(actor, pageId);
			app.render(false);
		}
	});

	// Page title editing
	journalSection.find('.sdx-page-title-input').on('change', async (ev) => {
		const pageId = $(ev.currentTarget).data('page-id');
		const newName = $(ev.currentTarget).val().trim() || game.i18n.localize("SHADOWDARK_EXTRAS.journal.untitled");
		await updateJournalPage(actor, pageId, { name: newName });
		app.render(false);
	});

	// Edit page content button
	journalSection.find('[data-action="edit-page"]').on('click', async (ev) => {
		ev.preventDefault();
		const pageId = $(ev.currentTarget).data('page-id');
		await openJournalPageEditor(actor, pageId, app);
	});
}

/**
 * ApplicationV2-based journal page editor.
 *
 * Uses the native `<prose-mirror>` custom element (v14) instead of the legacy
 * `{{editor}}` Handlebars helper + `this.editors` map. The submit handler reads
 * the editor's serialized content from `formData.object.content`.
 */
class SdxJournalPageEditor extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {

	static SNIPPETS = {
		'callout-info': '<div class="sdx-callout sdx-callout-info"><p>Information text here...</p></div>',
		'callout-warning': '<div class="sdx-callout sdx-callout-warning"><p>Warning text here...</p></div>',
		'callout-danger': '<div class="sdx-callout sdx-callout-danger"><p>Danger text here...</p></div>',
		'callout-success': '<div class="sdx-callout sdx-callout-success"><p>Success text here...</p></div>',
		'callout-quest': '<div class="sdx-callout sdx-callout-quest"><p><strong>Quest:</strong> Quest details here...</p></div>',
		'callout-loot': '<div class="sdx-callout sdx-callout-loot"><p><strong>Loot:</strong> Treasure description here...</p></div>',
		'callout-npc': '<div class="sdx-callout sdx-callout-npc"><p>"NPC dialogue or quote here..."</p></div>',
		'divider-swords': '<div class="sdx-divider sdx-divider-swords"></div>',
		'divider-stars': '<div class="sdx-divider sdx-divider-stars"></div>',
		'divider-skulls': '<div class="sdx-divider sdx-divider-skulls"></div>',
		'divider-crowns': '<div class="sdx-divider sdx-divider-crowns"></div>',
		'divider-simple': '<div class="sdx-divider sdx-divider-simple"></div>'
	};

	static DEFAULT_OPTIONS = {
		id: "sdx-journal-page-editor-{id}",
		classes: ["shadowdark", "shadowdark-extras", "sdx-journal-editor-dialog"],
		tag: "form",
		window: {
			title: "SHADOWDARK_EXTRAS.journal.edit_page_title",
			resizable: true
		},
		position: {
			width: 650,
			height: 500
		},
		form: {
			handler: SdxJournalPageEditor.formHandler,
			submitOnChange: false,
			closeOnSubmit: true
		},
		actions: {
			insertSnippet: SdxJournalPageEditor._onInsertSnippet
		}
	};

	static PARTS = {
		form: {
			template: `modules/${MODULE_ID}/templates/journal-editor.hbs`,
			scrollable: [""]
		}
	};

	constructor({ actor, page, sheetApp, ...options } = {}) {
		super(options);
		this.actorDoc = actor;
		this.page = page;
		this.sheetApp = sheetApp;
	}

	// Resolve i18n title with the page name at render time.
	get title() {
		return game.i18n.format("SHADOWDARK_EXTRAS.journal.edit_page_title", { name: this.page?.name ?? "" });
	}

	async _prepareContext(options) {
		return {
			content: this.page?.content ?? "",
			pageName: this.page?.name ?? ""
		};
	}

	_onRender(context, options) {
		// V2 actions don't bubble out of the prose-mirror toolbar, so the snippet
		// buttons are wired here. Action attribute on the buttons (data-action=
		// "insertSnippet") drops through to `_onInsertSnippet` automatically;
		// this block is only a defensive backup if action dispatch isn't set up
		// on the form root.
	}

	static _onInsertSnippet(event, target) {
		event?.preventDefault?.();
		const insertType = target?.dataset?.insert;
		const snippet = SdxJournalPageEditor.SNIPPETS[insertType];
		if (!snippet) return;

		// `<prose-mirror>` element exposes its ProseMirror view via the `editor`
		// property once initialized.
		const root = this.element;
		const pmEl = root?.querySelector('prose-mirror[name="content"]');
		const view = pmEl?.editor?.view;
		if (view) {
			try {
				const state = view.state;
				const schema = state.schema;
				const PMDOMParser = view.constructor.DOMParser || pmEl.editor.constructor?.DOMParser || globalThis.ProseMirror?.DOMParser;
				if (PMDOMParser) {
					const parser = PMDOMParser.fromSchema(schema);
					const tmp = document.createElement('div');
					tmp.innerHTML = snippet;
					const doc = parser.parse(tmp);
					const tr = state.tr;
					tr.insert(state.doc.content.size, doc.content);
					view.dispatch(tr);
					view.focus();
					return;
				}
			} catch (err) {
				console.warn("SDX Journal: ProseMirror insertion failed:", err);
			}
		}

		// Last-resort fallback: append to the element's value attribute.
		if (pmEl) {
			const existing = pmEl.value ?? pmEl.getAttribute('value') ?? '';
			const next = existing + snippet;
			pmEl.value = next;
			pmEl.setAttribute('value', next);
		}
	}

	static async formHandler(event, form, formData) {
		const content = formData.object?.content ?? "";
		await updateJournalPage(this.actorDoc, this.page.id, { content });
		this.sheetApp.render(false);
	}
}

/**
 * Open the V2 journal page editor for a given actor + page id.
 */
async function openJournalPageEditor(actor, pageId, sheetApp) {
	const pages = getJournalPages(actor);
	const page = pages.find(p => p.id === pageId);
	if (!page) return;
	const editor = new SdxJournalPageEditor({ actor, page, sheetApp });
	editor.render({ force: true });
}

/**
 * Add custom light templates to the light source options
 */
function extendLightSources() {
	// Add to the config for dropdown options
	if (CONFIG.SHADOWDARK?.LIGHT_SETTING_NAMES) {
		const customSources = getCustomLightSources();
		for (const [key, source] of Object.entries(customSources)) {
			// If lang key starts with SHADOWDARK_EXTRAS, try to localize it, otherwise use raw string
			const label = source.lang.startsWith("SHADOWDARK_EXTRAS.")
				? game.i18n.localize(source.lang)
				: source.lang;

			CONFIG.SHADOWDARK.LIGHT_SETTING_NAMES[key] = label;
		}
	}
}

/**
 * Patch the light source mappings when they're loaded
 */
function patchLightSourceMappings() {
	// Store the original turnLightOn method
	const originalTurnLightOn = CONFIG.Actor.documentClass.prototype.turnLightOn;

	CONFIG.Actor.documentClass.prototype.turnLightOn = async function (itemId) {
		const item = this.items.get(itemId);
		const customSources = getCustomLightSources();

		// Check if this is one of our custom light sources
		if (item?.system?.light?.template && customSources[item.system.light.template]) {
			const lightData = customSources[item.system.light.template].light;
			await this.changeLightSettings(lightData);
			return;
		}

		// Otherwise use the original method
		return originalTurnLightOn.call(this, itemId);
	};
}


// ============================================
// ENHANCED DETAILS TAB
// ============================================

/**
 * Enhance the Details tab with improved styling and organization
 */
function enhanceDetailsTab(app, html, actor) {
	if (actor.type !== "Player") return;

	const $detailsTab = html.find('.tab[data-tab="tab-details"]');
	if (!$detailsTab.length) return;

	// Add enhanced class to the details tab
	$detailsTab.addClass('sdx-enhanced-details');

	// Hide the level box (it's already in the enhanced header)
	$detailsTab.find('.SD-box').first().hide();
}

// ============================================
// ENHANCED ABILITIES TAB
// ============================================

/**
 * Enhance the Abilities tab with improved styling and organization
 */
function enhanceAbilitiesTab(app, html, actor) {
	if (actor.type !== "Player") return;

	const $abilitiesTab = html.find('.tab[data-tab="tab-abilities"]');
	if (!$abilitiesTab.length) return;

	// Add enhanced class to the abilities tab
	$abilitiesTab.addClass('sdx-enhanced-abilities');

}


// ============================================
// ENHANCED TALENTS TAB
// ============================================

/**
 * Add inline control buttons to talent items
 */
function addInlineTalentControls($talentsTab, actor) {
	const $items = $talentsTab.find('.item');

	$items.each(function () {
		const $item = $(this);

		// Skip if already has controls
		if ($item.find('.sdx-talent-controls').length) return;

		const itemId = $item.data('item-id');

		if (!itemId) return;

		// Create control buttons
		const $controls = $(`
			<div class="sdx-talent-controls">
				<button type="button" class="sdx-talent-edit" data-tooltip="Edit" title="Edit">
					<i class="fas fa-edit"></i>
				</button>
				<button type="button" class="sdx-talent-transfer" data-tooltip="Transfer to Player" title="Transfer to Player">
					<i class="fas fa-share"></i>
				</button>
				<button type="button" class="sdx-talent-delete" data-tooltip="Delete" title="Delete">
					<i class="fas fa-trash"></i>
				</button>
			</div>
		`);

		// Add controls to the item
		$item.append($controls);

		// Edit button
		$controls.find('.sdx-talent-edit').on('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const item = actor.items.get(itemId);
			if (item) item.sheet.render(true);
		});

		// Transfer button
		$controls.find('.sdx-talent-transfer').on('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const item = actor.items.get(itemId);
			if (item && game.user.isGM) {
				const targetActorId = await showTransferDialog(actor, item);
				if (targetActorId) {
					await transferItemToPlayer(actor, item, targetActorId);
				}
			}
		});

		// Delete button
		$controls.find('.sdx-talent-delete').on('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const item = actor.items.get(itemId);
			if (item) {
				const confirm = await foundry.applications.api.DialogV2.confirm({
					window: { title: "Delete Talent" },
					content: `<p>Are you sure you want to delete <strong>${item.name}</strong>?</p>`,
					modal: true
				});

				if (confirm) {
					await item.delete();
					ui.notifications.info(`Deleted ${item.name}`);
				}
			}
		});
	});
}

/**
 * Enhance the Talents tab with improved styling and organization
 */
function enhanceTalentsTab(app, html, actor) {
	if (actor.type !== "Player") return;

	const $talentsTab = html.find('.tab[data-tab="tab-talents"]');
	if (!$talentsTab.length) return;

	// Add enhanced class to the talents tab
	$talentsTab.addClass('sdx-enhanced-talents');

	// Add inline control buttons to talent items
	addInlineTalentControls($talentsTab, actor);
}


// ============================================
// ENHANCED EFFECTS TAB
// ============================================

/**
 * Enhance the Effects tab with improved styling and organization
 */
function enhanceEffectsTab(app, html, actor) {
	if (actor.type !== "Player") return;

	const $effectsTab = html.find('.tab[data-tab="tab-effects"]');
	if (!$effectsTab.length) return;

	// Add enhanced class to the effects tab
	$effectsTab.addClass('sdx-enhanced-effects');
}





// ============================================
// PARTY FUNCTIONS
// ============================================

function patchLightSourceTrackerForParty() {
	const tracker = game.shadowdark?.lightSourceTracker;
	if (!tracker) {
		console.warn(`${MODULE_ID} | Light Source Tracker not found, skipping patch`);
		return;
	}

	// Store the original _gatherLightSources method
	const originalGatherLightSources = tracker._gatherLightSources.bind(tracker);

	// Override _gatherLightSources to also include Party actors
	tracker._gatherLightSources = async function () {
		// Call the original method first
		await originalGatherLightSources();

		// Track if we added anything
		let addedPartyActors = false;

		// Now add Party actors with active light sources
		const partyActors = game.actors.filter(actor => isPartyActor(actor));

		for (const actor of partyActors) {
			// Get active light sources for this party
			const activeLightSources = actor.items.filter(
				item => ["Basic", "Effect"].includes(item.type) &&
					item.system.light?.isSource &&
					item.system.light?.active
			);

			if (activeLightSources.length === 0) continue;

			const actorData = actor.toObject(false);
			actorData.lightSources = [];

			for (const item of activeLightSources) {
				actorData.lightSources.push(item.toObject(false));
			}

			// Only add if not already in the list
			if (!this.monitoredLightSources.some(a => a._id === actorData._id)) {
				this.monitoredLightSources.push(actorData);
				addedPartyActors = true;
			}
		}

		// Only re-sort if we actually added party actors
		if (addedPartyActors) {
			this.monitoredLightSources.sort((a, b) => {
				if (a.name < b.name) return -1;
				if (a.name > b.name) return 1;
				return 0;
			});
		}
	};

	//console.log(`${MODULE_ID} | Patched Light Source Tracker to include Party actors`);
}


/**
 * Register the Party sheet
 */
function registerPartySheet() {
	// Register the Party sheet for NPC actors that are flagged as parties
	foundry.documents.collections.Actors.registerSheet(MODULE_ID, PartySheetSD, {
		types: ["NPC"],
		makeDefault: false,
		label: game.i18n.localize("SHADOWDARK_EXTRAS.party.name")
	});

	// Override the _getSheetClass method to force Party sheet for party actors
	const originalGetSheetClass = CONFIG.Actor.documentClass.prototype._getSheetClass;
	CONFIG.Actor.documentClass.prototype._getSheetClass = function () {
		// Check if this is a party actor
		if (isPartyActor(this)) {
			return PartySheetSD;
		}
		return originalGetSheetClass.call(this);
	};

	//console.log(`${MODULE_ID} | Party sheet registered`);
}

/**
 * Register the AppV2 Potion item sheet
 */
function registerPotionSheet() {
	// Register the Potion sheet for Potion type items
	foundry.documents.collections.Items.registerSheet(MODULE_ID, PotionSheetSD, {
		types: ["Potion"],
		makeDefault: true,
		label: "Shadowdark Extras: Potion Sheet"
	});

	//console.log(`${MODULE_ID} | Potion sheet registered`);
}

/**
 * Register the AppV2 Background item sheet
 */
function registerBackgroundSheet() {
	// Register the Background sheet for Background type items
	foundry.documents.collections.Items.registerSheet(MODULE_ID, BackgroundSheetSD, {
		types: ["Background"],
		makeDefault: true,
		label: "Shadowdark Extras: Background Sheet"
	});

	//console.log(`${MODULE_ID} | Background sheet registered`);
}

/**
 * Register the AppV2 NPC Attack item sheet
 */
function registerNPCAttackSheet() {
	// Register the NPC Attack sheet for NPC Attack type items
	foundry.documents.collections.Items.registerSheet(MODULE_ID, NPCAttackSheetSD, {
		types: ["NPC Attack"],
		makeDefault: true,
		label: "Shadowdark Extras: NPC Attack Sheet"
	});

	//console.log(`${MODULE_ID} | NPC Attack sheet registered`);
}

/**
 * Register the AppV2 NPC Feature item sheet
 */
function registerNPCFeatureSheet() {
	// Register the NPC Feature sheet for NPC Feature and NPC Spell type items
	foundry.documents.collections.Items.registerSheet(MODULE_ID, NPCFeatureSheetSD, {
		types: ["NPC Feature", "NPC Spell"],
		makeDefault: true,
		label: "Shadowdark Extras: NPC Feature/Spell Sheet"
	});

	//console.log(`${MODULE_ID} | NPC Feature sheet registered`);
}

/**
 * Register the AppV2 Class Ability item sheet
 */
function registerClassAbilitySheet() {
	foundry.documents.collections.Items.registerSheet(MODULE_ID, ClassAbilitySheetSD, {
		types: ["Class Ability"],
		makeDefault: true,
		label: "Shadowdark Extras: Class Ability Sheet"
	});
}

/**
 * Add Party option to actor creation dialog
 */
function extendActorCreationDialog() {
	// Hook into various dialog rendering events to catch the Create Actor dialog

	// For Foundry v13+ with ApplicationV2
	Hooks.on("renderDocumentSheetConfig", (app, html, data) => {
		addPartyOptionToSelect(html);
	});

	// For standard Dialog
	Hooks.on("renderDialog", (app, html, data) => {
		addPartyOptionToSelect(html);
	});

	// For Application render
	Hooks.on("renderApplication", (app, html, data) => {
		addPartyOptionToSelect(html);
	});

	// For Foundry v13 - hook into the folder context or creation
	Hooks.on("renderActorDirectory", (app, html, data) => {
		// The create button opens a dialog - we need to intercept when it renders
	});

	// Use MutationObserver to catch dynamically created dialogs
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.nodeType === Node.ELEMENT_NODE) {
					const select = node.querySelector?.('select[name="type"]');
					if (select) {
						addPartyOptionToSelect($(node));
					}
				}
			}
		}
	});

	// Start observing the document body for dialog additions
	observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Add the Party option to a type select if it's in a Create Actor dialog
 */
function addPartyOptionToSelect(html) {
	// Convert to jQuery if needed
	const $html = html instanceof jQuery ? html : $(html);

	// Look for actor type select
	const typeSelect = $html.find('select[name="type"]');
	if (typeSelect.length === 0) return;

	// Check if this select has actor types (Light, NPC, Player)
	const hasActorTypes = typeSelect.find('option[value="NPC"]').length > 0 ||
		typeSelect.find('option[value="Player"]').length > 0;
	if (!hasActorTypes) return;

	// Check if Party option already exists
	if (typeSelect.find('option[value="Party"]').length > 0) return;

	// Add Party option
	const npcOption = typeSelect.find('option[value="NPC"]');
	if (npcOption.length > 0) {
		npcOption.after(`<option value="Party">${game.i18n.localize("SHADOWDARK_EXTRAS.party.name")}</option>`);
		//console.log(`${MODULE_ID} | Added Party option to actor type select`);
	} else {
		// Fallback: append to the end
		typeSelect.append(`<option value="Party">${game.i18n.localize("SHADOWDARK_EXTRAS.party.name")}</option>`);
		//console.log(`${MODULE_ID} | Added Party option to actor type select (appended)`);
	}

	// Also intercept form submission to convert Party to NPC before it's sent
	const form = typeSelect.closest('form');
	if (form.length > 0 && !form.data('party-intercepted')) {
		form.data('party-intercepted', true);
		form.on('submit', function (e) {
			const select = $(this).find('select[name="type"]');
			if (select.val() === 'Party') {
				select.val('NPC');
				// Store that this should be a party
				let hiddenInput = $(this).find('input[name="flags.shadowdark-extras.isParty"]');
				if (hiddenInput.length === 0) {
					$(this).append('<input type="hidden" name="flags.shadowdark-extras.isParty" value="true">');
				}
			}
		});
	}
}

/**
 * Wrap Actor.create to intercept Party type
 */
function wrapActorCreate() {
	const originalCreate = CONFIG.Actor.documentClass.create;

	CONFIG.Actor.documentClass.create = async function (data, options = {}) {
		// Handle single or array of data
		const createData = Array.isArray(data) ? data : [data];

		for (const d of createData) {
			if (d.type === "Party") {
				d.type = "NPC";
				d.img = d.img || "icons/environment/people/group.webp";
				foundry.utils.setProperty(d, "flags.shadowdark-extras.isParty", true);
				foundry.utils.setProperty(d, "prototypeToken.actorLink", true);

				// Set default prototype token settings (no vision/light like standard Shadowdark actors)
				foundry.utils.setProperty(d, "prototypeToken.sight", {
					enabled: true,
					range: 0,
					angle: 360,
					visionMode: "basic",
					color: null,
					attenuation: 0.1,
					brightness: 0,
					saturation: 0,
					contrast: 0
				});
				foundry.utils.setProperty(d, "prototypeToken.light", {
					negative: false,
					priority: 0,
					alpha: 0.2,
					angle: 360,
					bright: 0,
					color: "#d1c846",
					coloration: 1,
					dim: 0,
					attenuation: 0.5,
					luminosity: 0.5,
					saturation: 0,
					contrast: 0,
					shadows: 0,
					animation: {
						type: "torch",
						speed: 1,
						intensity: 1,
						reverse: false
					},
					darkness: {
						min: 0,
						max: 1
					}
				});
			}
		}

		return originalCreate.call(this, Array.isArray(data) ? createData : createData[0], options);
	};

	//console.log(`${MODULE_ID} | Wrapped Actor.create to handle Party type`);
}

/**
 * Handle Party actor creation - convert to flagged NPC
 */
async function handlePartyCreation(actor, options, userId) {
	// This runs after the actor is created
	// We can't intercept the type change before creation in a clean way,
	// so we'll handle it via the preCreateActor hook
}

/**
 * Patch NPC sheet to handle item drops with move vs copy behavior
 */
function patchNpcSheetForItemDrops(app) {
	// Only patch once per sheet instance
	if (app._sdxDropPatched) return;
	app._sdxDropPatched = true;

	// Store the original _onDrop if it exists
	const originalOnDrop = app._onDrop?.bind(app);

	// Override the _onDrop method to intercept drops on the inventory tab
	app._onDrop = async function (event) {
		// Check if we're on the inventory tab
		const inventoryTab = event.target.closest('.shadowdark-extras-npc-inventory');
		if (!inventoryTab) {
			// Not on inventory tab, use original handler
			if (originalOnDrop) return originalOnDrop(event);
			return;
		}

		// Get the drag data
		let data;
		try {
			data = JSON.parse(event.dataTransfer.getData('text/plain'));
		} catch (err) {
			return;
		}

		if (data.type !== "Item") return;

		// Get the source item
		const sourceItem = await fromUuid(data.uuid);
		if (!sourceItem) return;

		const targetActor = this.actor;
		const sourceActor = sourceItem.parent;

		// Check if we're moving or copying (Ctrl = copy, default = move)
		const isCopy = event.ctrlKey;

		// Don't do anything if dropping on same actor
		if (sourceActor === targetActor && !isCopy) return;

		// Create the item on target actor
		const itemData = sourceItem.toObject();
		delete itemData._id; // Remove the ID so a new one is created

		await targetActor.createEmbeddedDocuments("Item", [itemData]);

		// If moving (not copying), delete from source
		if (!isCopy && sourceActor && sourceActor !== targetActor) {
			await sourceItem.delete();
			ui.notifications.info(
				game.i18n.format("SHADOWDARK_EXTRAS.notifications.item_moved", {
					item: sourceItem.name,
					target: targetActor.name
				})
			);
		} else if (isCopy) {
			ui.notifications.info(
				game.i18n.format("SHADOWDARK_EXTRAS.notifications.item_copied", {
					item: sourceItem.name,
					target: targetActor.name
				})
			);
		}
	};
}


// ============================================
// FIX: PlayerSheetSD._onUseAbility missing methods
// ============================================

/**
 * Patch PlayerSheetSD._onUseAbility to fix missing getSkipPrompt/getAdvantage methods
 * The system calls this.getSkipPrompt() and this.getAdvantage() which don't exist on the sheet.
 * Other sheets correctly use this.actor.buildOptionsForSkipPrompt(event) instead.
 */
function patchPlayerSheetUseAbility() {
	const PlayerSheetSD = CONFIG.Actor.sheetClasses.Player?.["shadowdark.PlayerSheetSD"]?.cls;
	if (!PlayerSheetSD) {
		console.warn(`${MODULE_ID} | Could not find PlayerSheetSD class to patch _onUseAbility`);
		return;
	}

	// Only patch if getSkipPrompt is missing (i.e. the bug exists in this system version)
	if (typeof PlayerSheetSD.prototype.getSkipPrompt === "function") return;

	PlayerSheetSD.prototype._onUseAbility = async function (event) {
		event.preventDefault();
		// SD 4.x: abilities live on the data model and are resolved by UUID.
		// The system's own handler reads dataset.itemUuid and calls
		// actor.system.useAbility(uuid). Mirror that, with a bare-id fallback
		// for older templates that only expose data-item-id.
		const ds = event.currentTarget.dataset;
		let abilityUuid = ds.itemUuid;
		if (!abilityUuid && ds.itemId) {
			abilityUuid = this.actor.items.get(ds.itemId)?.uuid;
		}
		if (!abilityUuid) return;
		const options = this.actor.buildOptionsForSkipPrompt?.(event) ?? { skipPrompt: event.shiftKey };
		this.actor.system.useAbility(abilityUuid, options);
	};

	console.log(`${MODULE_ID} | Patched PlayerSheetSD._onUseAbility (getSkipPrompt fix)`);
}

// ============================================
// CHARACTER GENERATOR ROLL PATCH
// ============================================

/**
 * Patch CharacterGeneratorSD to show dice rolls in chat
 * So all players can see character generation results
 */
function patchCharacterGeneratorRolls() {
	// Get the CharacterGeneratorSD class from the shadowdark namespace
	const CharacterGeneratorSD = CONFIG.SHADOWDARK?.applications?.CharacterGeneratorSD
		|| globalThis.shadowdark?.apps?.CharacterGeneratorSD
		|| game.shadowdark?.apps?.CharacterGeneratorSD;

	if (!CharacterGeneratorSD) {
		console.warn(`${MODULE_ID} | CharacterGeneratorSD not found, skipping roll patch`);
		return;
	}

	// Correct ability order: STR, DEX, CON, INT, WIS, CHA
	const ABILITY_ORDER = ["str", "dex", "con", "int", "wis", "cha"];
	const ABILITY_NAMES = {
		str: "Strength",
		dex: "Dexterity",
		con: "Constitution",
		int: "Intelligence",
		wis: "Wisdom",
		cha: "Charisma"
	};

	// Override _randomizeStats to use correct order and show per-ability rolls
	// If no ability reaches 14+, all results are colored red
	CharacterGeneratorSD.prototype._randomizeStats = async function () {
		// Roll all abilities first (silently)
		const rolls = {};
		let hasHighStat = false;

		for (const key of ABILITY_ORDER) {
			const roll = await new Roll("3d6").evaluate();
			rolls[key] = roll;
			if (roll.total >= 14) hasHighStat = true;
		}

		// Collect message IDs if we need to update them
		const messageIds = [];

		// Send messages one at a time. roll.toMessage() handles render() +
		// ChatMessage.create + DSN hook properly (ChatMessage.create with just
		// `rolls: [...]` leaves the dice unrendered in v13+, only the formula shows).
		for (const key of ABILITY_ORDER) {
			const roll = rolls[key];
			const message = await roll.toMessage({
				speaker: ChatMessage.getSpeaker({ user: game.user }),
				flavor: `<b>Character Generator</b> - ${ABILITY_NAMES[key]}`
			});
			if (message) messageIds.push(message.id);

			// SD 4.x migrated abilities.base -> abilities.value (PlayerSD.mjs:15);
			// _calculateModifiers() reads `.value` to compute the modifier.
			this.formData.actor.system.abilities[key].value = roll.total;
		}

		// If no high stat, update all messages to show red totals
		if (!hasHighStat) {
			// Small delay to let messages render
			setTimeout(() => {
				for (const msgId of messageIds) {
					const msgElement = document.querySelector(`[data-message-id="${msgId}"] .dice-total`);
					if (msgElement) {
						msgElement.style.color = "#cc0000";
						msgElement.style.fontWeight = "bold";
					}
				}
			}, 100);
		}

		this._calculateModifiers();
	};

	// Override _randomizeGold to show gold roll
	CharacterGeneratorSD.prototype._randomizeGold = async function () {
		const roll = await new Roll("2d6").evaluate();
		const startingGold = roll.total * 5;

		// roll.toMessage triggers DSN automatically via Foundry hooks
		await roll.toMessage({
			speaker: ChatMessage.getSpeaker({ user: game.user }),
			flavor: `<b>Character Generator</b> - Starting Gold (×5 = ${startingGold} GP)`
		});

		this.formData.actor.system.coins.gp = startingGold;
	};

	// Override _randomizeAlignment to show alignment roll
	CharacterGeneratorSD.prototype._randomizeAlignment = async function () {
		const roll = await new Roll("d6").evaluate();
		let alignment;

		switch (roll.total) {
			case 1:
			case 2:
			case 3:
				alignment = "lawful";
				break;
			case 4:
			case 5:
				alignment = "neutral";
				break;
			default:
				alignment = "chaotic";
		}

		// roll.toMessage triggers DSN automatically via Foundry hooks
		await roll.toMessage({
			speaker: ChatMessage.getSpeaker({ user: game.user }),
			flavor: `<b>Character Generator</b> - Alignment (${alignment.charAt(0).toUpperCase() + alignment.slice(1)})`
		});

		this.formData.actor.system.alignment = alignment;
	};

	console.log(`${MODULE_ID} | Patched CharacterGeneratorSD to show rolls in chat`);
}

// ============================================
// HOOKS
// ============================================

// Initialize when Foundry is ready
Hooks.once("init", () => {
	//console.log(`${MODULE_ID} | Initializing Shadowdark Extras`);

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
	Handlebars.registerHelper("numberSigned", (value) => {
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
		`modules/${MODULE_ID}/templates/class-ability-sheet/macro.hbs`
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

	//console.log(`${MODULE_ID} | Setting up Shadowdark Extras`);

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
		//console.log(`${MODULE_ID} | Combat socket initialized`);
	} else {
		console.warn(`${MODULE_ID} | socketlib not found, damage application may not work for non-GMs`);
	}

	// Initialize Focus Spell Tracker if enabled
	if (game.settings.get(MODULE_ID, "enableFocusTracker")) {
		initFocusSpellTracker();
		//console.log(`${MODULE_ID} | Focus Spell Tracker initialized`);
	}

	// Break-on-damage effect expiry (marker-driven; hooks are inert until an
	// effect carries flags.shadowdark-extras.breakOnDamage). Safe to run always.
	initBreakOnDamage();

	// Setup wand uses blocking (prevent casting depleted wands)
	if (game.settings.get(MODULE_ID, "enableWandUses")) {
		setupWandUsesBlocker();
		//console.log(`${MODULE_ID} | Wand Uses Blocker initialized`);
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
	//console.log(`${MODULE_ID} | Template Effects System initialized`);

	// Initialize Aura Effects System (token-attached effects that follow bearer)
	initAuraEffects();
	//console.log(`${MODULE_ID} | Aura Effects System initialized`);

	// Initialize Marching Mode (GM-only token following system)
	initMarchingMode();
	//console.log(`${MODULE_ID} | Marching Mode initialized`);

	patchLightSourceTrackerForParty();

	// Patch NPC sheets to add _toggleLightSource method
	// The Shadowdark system's ActorSheetSD._deleteItem tries to call this method,
	// but it only exists on PlayerSheetSD, causing errors when deleting torch items from NPCs
	if (globalThis.shadowdark?.sheets?.NpcSheetSD) {
		const NpcSheetSD = globalThis.shadowdark.sheets.NpcSheetSD;
		if (!NpcSheetSD.prototype._toggleLightSource) {
			NpcSheetSD.prototype._toggleLightSource = async function (item, options = {}) {
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
			//console.log(`${MODULE_ID} | Patched NpcSheetSD with _toggleLightSource method`);
		}
	}

	// Wrap ActorSD._learnSpell to preserve spell damage flags from scrolls
	if (globalThis.shadowdark?.documents?.ActorSD) {
		const ActorSD = globalThis.shadowdark.documents.ActorSD;
		const RollSD = CONFIG.DiceSD;
		//console.log(`${MODULE_ID} | Monkey-patching ActorSD methods and DiceSD`);
		const original_learnSpell = ActorSD.prototype._learnSpell;

		ActorSD.prototype._learnSpell = async function (item) {
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

		//console.log(`${MODULE_ID} | Wrapped ActorSD._learnSpell to preserve spell damage flags`);
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
	game.socket.on(`module.${MODULE_ID}`, (data) => {
		if (data.action?.startsWith("sdxRoller")) {
			SDXRollerApp.handleSocketMessage(data);
		}
	});

	// Register global callback for carousing overlay refresh
	window.sdxCarousingOverlayRefresh = refreshCarousingOverlay;
	window.sdxOpenCarousingOverlay = openCarousingOverlay;
});

// Preserve flags when items are created (covers item-piles transfers, compendium drops, etc.)
Hooks.on("preCreateItem", (item, data, options, userId) => {
	// Note: This hook handles flag preservation for items created directly

	// Preserve spell damage flags when learning a spell from a scroll
	// This handles the "Learn Spell" button functionality
	if (item.type === "Spell" && item.parent) {
		// Check if there's a scroll being learned from (stored in temporary flag)
		const sourceScrollId = item.parent.getFlag(MODULE_ID, "_learningFromScroll");
		if (sourceScrollId) {
			const sourceScroll = item.parent.items.get(sourceScrollId);
			if (sourceScroll) {
				// Preserve the spell damage configuration from the scroll
				if (sourceScroll.flags?.[MODULE_ID]?.spellDamage) {
					item.updateSource({
						[`flags.${MODULE_ID}.spellDamage`]: foundry.utils.duplicate(sourceScroll.flags[MODULE_ID].spellDamage)
					});
					//console.log(`${MODULE_ID} | Preserved spell damage flags when learning from scroll:`, sourceScroll.name);
				}
				// Preserve targeting configuration from the scroll
				if (sourceScroll.flags?.[MODULE_ID]?.targeting) {
					item.updateSource({
						[`flags.${MODULE_ID}.targeting`]: foundry.utils.duplicate(sourceScroll.flags[MODULE_ID].targeting)
					});
					//console.log(`${MODULE_ID} | Preserved targeting flags when learning from scroll:`, sourceScroll.name);
				}
				// Preserve template effects configuration from the scroll
				if (sourceScroll.flags?.[MODULE_ID]?.templateEffects) {
					item.updateSource({
						[`flags.${MODULE_ID}.templateEffects`]: foundry.utils.duplicate(sourceScroll.flags[MODULE_ID].templateEffects)
					});
					//console.log(`${MODULE_ID} | Preserved templateEffects flags when learning from scroll:`, sourceScroll.name);
				}
				// Preserve aura effects configuration from the scroll
				if (sourceScroll.flags?.[MODULE_ID]?.auraEffects) {
					item.updateSource({
						[`flags.${MODULE_ID}.auraEffects`]: foundry.utils.duplicate(sourceScroll.flags[MODULE_ID].auraEffects)
					});
					//console.log(`${MODULE_ID} | Preserved auraEffects flags when learning from scroll:`, sourceScroll.name);
				}
			}
		}
	}

	// Preserve Item Macro trigger configuration flags
	if (data.flags?.[MODULE_ID]?.itemMacro) {
		item.updateSource({
			[`flags.${MODULE_ID}.itemMacro`]: foundry.utils.duplicate(data.flags[MODULE_ID].itemMacro)
		});
		//console.log(`${MODULE_ID} | Preserved itemMacro flags on item creation:`, item.name);
	}

	// Preserve Targeting configuration flags
	if (data.flags?.[MODULE_ID]?.targeting) {
		item.updateSource({
			[`flags.${MODULE_ID}.targeting`]: foundry.utils.duplicate(data.flags[MODULE_ID].targeting)
		});
		//console.log(`${MODULE_ID} | Preserved targeting flags on item creation:`, item.name);
	}

	// Preserve Template Effects configuration flags
	if (data.flags?.[MODULE_ID]?.templateEffects) {
		item.updateSource({
			[`flags.${MODULE_ID}.templateEffects`]: foundry.utils.duplicate(data.flags[MODULE_ID].templateEffects)
		});
		//console.log(`${MODULE_ID} | Preserved templateEffects flags on item creation:`, item.name);
	}

	// Preserve Aura Effects configuration flags
	if (data.flags?.[MODULE_ID]?.auraEffects) {
		item.updateSource({
			[`flags.${MODULE_ID}.auraEffects`]: foundry.utils.duplicate(data.flags[MODULE_ID].auraEffects)
		});
		//console.log(`${MODULE_ID} | Preserved auraEffects flags on item creation:`, item.name);
	}

	// Preserve Item Macro module's macro data (itemacro module)
	if (data.flags?.itemacro?.macro) {
		item.updateSource({
			"flags.itemacro.macro": foundry.utils.duplicate(data.flags.itemacro.macro)
		});
		//console.log(`${MODULE_ID} | Preserved itemacro macro on item creation:`, item.name);
	}
});


// Before party actor is created, ensure proper prototype token settings
Hooks.on("preCreateActor", (actor, data, options, userId) => {
	// Check if this is a party actor being created
	const isParty = data.flags?.[MODULE_ID]?.isParty === true ||
		actor.getFlag(MODULE_ID, "isParty") === true;

	if (isParty) {
		// Force the correct prototype token settings for party actors
		actor.updateSource({
			"prototypeToken.actorLink": true,
			"prototypeToken.sight.enabled": true,
			"prototypeToken.sight.range": 0,
			"prototypeToken.sight.angle": 360,
			"prototypeToken.sight.visionMode": "basic",
			"prototypeToken.light.bright": 0,
			"prototypeToken.light.dim": 0
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

function applyNpcPlayerTheme(app, html, actor) {
	if (actor?.type !== "NPC") return;
	if (isPartyActor(actor)) return;

	const $html = html instanceof jQuery ? html : $(html);
	const $sheet = $html.closest('.shadowdark.sheet.npc').length
		? $html.closest('.shadowdark.sheet.npc')
		: $html;

	if (!game.settings.get(MODULE_ID, "enableNpcPlayerTheme")) {
		$sheet.removeClass('sdx-npc-player-theme');
		$html.find('.SD-header').first().removeClass('sdx-npc-themed-header');
		$html.find('.SD-content-body').first().removeClass('sdx-npc-themed-content');
		return;
	}

	$sheet.addClass('sdx-npc-player-theme');

	$html.find('.SD-header').first().addClass('sdx-npc-themed-header');
	$html.find('.SD-content-body').first().addClass('sdx-npc-themed-content');
}

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
	} catch (err) {
		console.error(`${MODULE_ID} | Failed to inject Basic item container UI`, err);
	}

	try {
		enhanceSpellSheet(app, html);
	} catch (err) {
		console.error(`${MODULE_ID} | Failed to enhance spell sheet`, err);
	}

	try {
		injectSpellAlignmentField(app, html);
	} catch (err) {
		console.error(`${MODULE_ID} | Failed to inject spell alignment field`, err);
	}

	try {
		enhancePotionSheet(app, html);
	} catch (err) {
		console.error(`${MODULE_ID} | Failed to enhance potion sheet`, err);
	}

	try {
		enhanceScrollSheet(app, html);
	} catch (err) {
		console.error(`${MODULE_ID} | Failed to enhance scroll sheet`, err);
	}

	try {
		enhanceWandSheet(app, html);
	} catch (err) {
		console.error(`${MODULE_ID} | Failed to enhance wand sheet`, err);
	}

	// Inject weapon bonus tab
	try {
		const item = app.item || app.document;
		if (item?.type === "Weapon") {
			injectWeaponBonusTab(app, html, item);
			injectWeaponDamageTypeDropdown(app, html, item);
			injectStaffSpellButton(app, html, item);
		} else if (item?.type === "Armor") {
			// For shields (Armor), just inject the animation button
			injectWeaponAnimationButton(html, item);
		}
	} catch (err) {
		console.error(`${MODULE_ID} | Failed to inject weapon bonus tab`, err);
	}


	// Hide already-rendered Effects tab elements for non-GM players viewing unidentified items
	try {
		const item = app?.item;
		if (item && isUnidentified(item) && !game.user?.isGM) {
			html.find('a[data-tab="tab-effects"]').remove();
			html.find('.tab[data-tab="tab-effects"]').remove();
		}
	} catch (err) {
		console.error(`${MODULE_ID} | Failed to hide effects tab`, err);
	}

	// Enhance Gem item sheet with quantity field
	try {
		enhanceGemSheet(app, html);
	} catch (err) {
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
		} else if (value === "false" || value === false) {
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
		} else if (value === "false" || value === false) {
			foundry.utils.setProperty(updateData, effectsApplyToTargetPath, false);
		}
	}
});


// Chat-card target stash and damage-card injection; registered here to keep hook order
registerChatCardHooks();

// Wrap ItemSheet getData to modify context before rendering
Hooks.once("ready", () => {
	const ItemSheetClass = foundry.appv1?.sheets?.ItemSheet || globalThis.ItemSheet;
	if (!ItemSheetClass?.prototype?.getData) return;

	const originalGetData = ItemSheetClass.prototype.getData;
	ItemSheetClass.prototype.getData = async function (options = {}) {
		const data = await originalGetData.call(this, options);

		// Hide magicItem property for unidentified items for non-GM players
		const item = this?.item;
		if (item && isUnidentified(item) && !game.user?.isGM && data?.system) {
			// Deep clone the system data to avoid mutating the original
			data.system = foundry.utils.duplicate(data.system);
			data.system.magicItem = false;
		}

		return data;
	};

	// CRITICAL FIX: Wrap Shadowdark's createItemFromSpell to preserve our spell damage flags
	// The system's function only copies type/name/system/img, stripping all flags
	if (globalThis.shadowdark?.utils?.createItemFromSpell) {
		const originalCreateItemFromSpell = globalThis.shadowdark.utils.createItemFromSpell;

		globalThis.shadowdark.utils.createItemFromSpell = async function (type, spell) {
			// Call the original function to get the base item data
			const itemData = await originalCreateItemFromSpell.call(this, type, spell);

			// Initialize flags object if needed
			itemData.flags = itemData.flags || {};
			itemData.flags[MODULE_ID] = itemData.flags[MODULE_ID] || {};

			// Preserve spell damage configuration flags
			if (spell.flags?.[MODULE_ID]?.spellDamage) {
				itemData.flags[MODULE_ID].spellDamage = foundry.utils.duplicate(spell.flags[MODULE_ID].spellDamage);
				//console.log(`${MODULE_ID} | Preserved spell damage flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].spellDamage);
			}

			// Preserve Targeting configuration flags
			if (spell.flags?.[MODULE_ID]?.targeting) {
				itemData.flags[MODULE_ID].targeting = foundry.utils.duplicate(spell.flags[MODULE_ID].targeting);
				//console.log(`${MODULE_ID} | Preserved targeting flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].targeting);
			}

			// Preserve summoning configuration flags
			if (spell.flags?.[MODULE_ID]?.summoning) {
				itemData.flags[MODULE_ID].summoning = foundry.utils.duplicate(spell.flags[MODULE_ID].summoning);
				//console.log(`${MODULE_ID} | Preserved summoning flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].summoning);
			}

			// Preserve item give configuration flags
			if (spell.flags?.[MODULE_ID]?.itemGive) {
				itemData.flags[MODULE_ID].itemGive = foundry.utils.duplicate(spell.flags[MODULE_ID].itemGive);
				//console.log(`${MODULE_ID} | Preserved item give flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].itemGive);
			}

			// Preserve unidentified flags
			if (spell.flags?.[MODULE_ID]?.unidentified) {
				itemData.flags[MODULE_ID].unidentified = spell.flags[MODULE_ID].unidentified;
				itemData.flags[MODULE_ID].unidentifiedDescription = spell.flags[MODULE_ID].unidentifiedDescription || "";
			}

			// Preserve Item Macro trigger configuration flags
			if (spell.flags?.[MODULE_ID]?.itemMacro) {
				itemData.flags[MODULE_ID].itemMacro = foundry.utils.duplicate(spell.flags[MODULE_ID].itemMacro);
				//console.log(`${MODULE_ID} | Preserved itemMacro flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].itemMacro);
			}

			// Preserve Template Effects configuration flags
			if (spell.flags?.[MODULE_ID]?.templateEffects) {
				itemData.flags[MODULE_ID].templateEffects = foundry.utils.duplicate(spell.flags[MODULE_ID].templateEffects);
				//console.log(`${MODULE_ID} | Preserved templateEffects flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].templateEffects);
			}

			// Preserve Aura Effects configuration flags
			if (spell.flags?.[MODULE_ID]?.auraEffects) {
				itemData.flags[MODULE_ID].auraEffects = foundry.utils.duplicate(spell.flags[MODULE_ID].auraEffects);
				//console.log(`${MODULE_ID} | Preserved auraEffects flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].auraEffects);
			}

			// Preserve Item Macro module's macro data (itemacro module)
			if (spell.flags?.itemacro?.macro) {
				itemData.flags.itemacro = itemData.flags.itemacro || {};
				itemData.flags.itemacro.macro = foundry.utils.duplicate(spell.flags.itemacro.macro);
				//console.log(`${MODULE_ID} | Preserved itemacro macro for ${spell.name} -> ${itemData.name}`);
			}

			return itemData;
		};

		//console.log(`${MODULE_ID} | Wrapped shadowdark.utils.createItemFromSpell to preserve spell flags`);
	}
});

// Container hooks live in inventory/containers.mjs; registered here to keep source order.
registerContainerHooks();


// Release contained items BEFORE a container is deleted
Hooks.on("preDeleteItem", async (item, options, userId) => {
	if (options?.sdxInternal) return;

	// Only the user who deleted the item should release contained items
	if (userId !== game.user.id) return;

	const actor = item?.parent;
	if (!actor) return;

	// If a container item is being deleted, release all items that were inside it
	// (make them visible again in inventory) BEFORE the container is gone
	if (item.getFlag(MODULE_ID, "isContainer")) {
		const containedIds = [];
		for (const i of actor.items) {
			if (i.getFlag(MODULE_ID, "containerId") === item.id) {
				containedIds.push(i.id);
			}
		}

		if (containedIds.length > 0) {
			// Batch update all contained items to release them
			const updates = containedIds.map(id => {
				const child = actor.items.get(id);
				if (!child) return null;
				const restorePhysical = child.getFlag(MODULE_ID, "containerOrigIsPhysical");
				return {
					_id: id,
					"system.isPhysical": (restorePhysical === undefined) ? true : Boolean(restorePhysical),
					[`flags.${MODULE_ID}.containerId`]: null,
					[`flags.${MODULE_ID}.containerOrigIsPhysical`]: null,
				};
			}).filter(u => u !== null);

			if (updates.length > 0) {
				try {
					await actor.updateEmbeddedDocuments("Item", updates, { sdxInternal: true });
				} catch (e) {
					console.warn(`${MODULE_ID} | Could not release contained items`, e);
				}
			}
		}
	}
});

Hooks.on("deleteItem", async (item, options, userId) => {
	if (options?.sdxInternal) return;

	// Only the user who deleted the item should update container slots
	if (userId !== game.user.id) return;

	const actor = item?.parent;
	if (!actor) return;

	// If a contained item was deleted, update its container slots.
	const containerId = item.getFlag(MODULE_ID, "containerId");
	if (containerId) {
		const container = actor.items.get(containerId);
		if (container) await recomputeContainerSlots(container);
	}
});

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

// Condition toggles refresh when effects change; registered here to keep hook order
registerConditionEffectHooks();

// ============================================
// SIDEBAR & COMPENDIUM UNIDENTIFIED INDICATORS
// ============================================

/**
 * Mark unidentified items in the sidebar or compendium directory with a visual indicator (GM only)
 * Adds a red border around the thumbnail and a small question mark icon
 * @param {HTMLElement} html - The rendered HTML of the directory (plain DOM element in V13)
 * @param {Collection|Map|Array} items - The items to check for unidentified status
 */

// Simplify usesAmmunition to include all ranged weapons (and add weapon-sheet
// ammunition enhancement). Wrapped in `ready` because both rely on the system's
// `shadowdark` global being initialised.
Hooks.once("ready", () => {
	Object.defineProperty(shadowdark.documents.ItemSD.prototype, "usesAmmunition", {
		get: function () {
			return (game.settings.get("shadowdark", "autoConsumeAmmunition")
				&& this.isOwned
				&& this.actor.type === "Player"
				&& this.type === "Weapon"
				&& this.system.type === "ranged"
			);
		},
		configurable: true
	});


	const prepareGearSheetCompendiumIndexes = () => {
		ensureMutableItemCompendiumIndexes(game.packs, foundry.utils.deepClone);
	};

	// Shadowdark's armor and weapon sheet helpers request full Item system data
	// from every pack. Normalize any frozen v14 index entries first.
	const originalGetArmorSheetData = shadowdark.sheets.ItemSheetSD.prototype.getSheetDataForArmorItem;
	shadowdark.sheets.ItemSheetSD.prototype.getSheetDataForArmorItem = async function (context) {
		prepareGearSheetCompendiumIndexes();
		return originalGetArmorSheetData.call(this, context);
	};

	// Enhance weapon sheet to include actor's inventory ammunition in the dropdown
	const originalGetWeaponSheetData = shadowdark.sheets.ItemSheetSD.prototype.getSheetDataForWeaponItem;
	shadowdark.sheets.ItemSheetSD.prototype.getSheetDataForWeaponItem = async function (context) {
		prepareGearSheetCompendiumIndexes();
		await originalGetWeaponSheetData.call(this, context);

		const actor = context.item.actor;
		if (actor) {
			const actorAmmo = actor.items.filter(i => i.system.isAmmunition && i.system.quantity > 0);
			for (const ammo of actorAmmo) {
				const slug = ammo.name.slugify();
				if (!context.ammunition[slug]) {
					context.ammunition[slug] = ammo.name;
				}
			}
		}
	};
});

// ============================================
// AMMUNITION BONUS UI INJECTION
// ============================================
function injectAmmunitionBonuses(app, html) {
	const item = app?.item;
	if (item?.type !== "Basic") return;
	if (!item.system.isAmmunition) return;

	// De-dupe on re-render
	html.find(".sdx-ammunition-bonuses").remove();

	const hitBonus = item.getFlag(MODULE_ID, "ammoHitBonus") || "";
	const damageBonus = item.getFlag(MODULE_ID, "ammoDamageBonus") || "";

	const bonusesHtml = `
		<div class="sdx-ammunition-bonuses">
			<div class="SD-box">
				<div class="header light">
					<label>${game.i18n.localize("SHADOWDARK_EXTRAS.ammunition.bonuses.label")}</label>
				</div>
				<div class="content">
					<div class="SD-grid center">
						<div class="sdx-bonus-field">
							<label class="sdx-field-label">${game.i18n.localize("SHADOWDARK_EXTRAS.ammunition.bonuses.hit")}</label>
							<input type="text" name="flags.${MODULE_ID}.ammoHitBonus" value="${hitBonus}" placeholder="+0">
						</div>
						<div class="sdx-bonus-field">
							<label class="sdx-field-label">${game.i18n.localize("SHADOWDARK_EXTRAS.ammunition.bonuses.damage")}</label>
							<input type="text" name="flags.${MODULE_ID}.ammoDamageBonus" value="${damageBonus}" placeholder="+0">
						</div>
					</div>
				</div>
			</div>
		</div>
	`;

	// Inject at the bottom of the Details tab
	const detailsTab = html.find('.tab[data-tab="tab-details"]');
	if (detailsTab.length) {
		detailsTab.append(bonusesHtml);
	}
}

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

//console.log(`${MODULE_ID} | Invisibility effect enabled with auto-disable on attack/spell`);


// ============================================
// MACRO EXECUTE EFFECT HANDLERS
// ============================================

// Register socketlib handler on ready hook
// Dev-only Quench batches. These live under dev/ and are excluded from
// module.zip, so a released install has nothing to import - stay silent there
// rather than logging a spurious registration failure.
Hooks.on("quenchReady", async (quench) => {
	try {
		const { registerWebpMigrationBatch } = await import("../dev/tests/quench/webp-migration.batch.mjs");
		registerWebpMigrationBatch(quench);
	} catch (e) {
		// Expected in a packaged install: dev/ is not shipped.
	}
	try {
		const { registerStructuralBatch } = await import("../dev/tests/quench/structural.batch.mjs");
		registerStructuralBatch(quench);
	} catch (e) {
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

		//console.log(`${MODULE_ID} | Socketlib integration enabled for macro execution`);
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
	} catch (e) {
		console.error(`${MODULE_ID} | webp asset migration threw:`, e);
	}

	// World compendiums are swept separately and NOT awaited: the sweep has to
	// load every document of every world pack, which would stall world load.
	// It carries its own gate (webpPackSweepDone) so locked or failed packs are
	// retried on later loads instead of being stranded by the document gate.
	sweepWorldCompendiums().catch((e) =>
		console.error(`${MODULE_ID} | world compendium webp sweep failed:`, e)
	);

	// Run one-time itemacro data migration if not already done
	if (!game.settings.get(MODULE_ID, "itemacroMigrationDone")) {
		console.log(`${MODULE_ID} | Starting itemacro data migration...`);

		const migrateItem = async (item) => {
			const legacy = item.flags?.itemacro?.macro?.command;
			if (legacy && !item.getFlag(MODULE_ID, "macroCommand")) {
				await item.setFlag(MODULE_ID, "macroCommand", legacy);
				await item.setFlag(MODULE_ID, "macroName", item.flags?.itemacro?.macro?.name || item.name);
				await item.setFlag(MODULE_ID, "macroRunAsGM", item.flags?.itemacro?.macro?.runAsGM || false);
			}
		};

		// Migrate world items
		for (const item of game.items) await migrateItem(item);

		// Migrate actor items
		for (const actor of game.actors) {
			for (const item of actor.items) await migrateItem(item);
		}

		await game.settings.set(MODULE_ID, "itemacroMigrationDone", true);
		console.log(`${MODULE_ID} | itemacro data migration complete.`);
	}
});

// Moved to item-macros/effect-trigger-macros.mjs, all five hooks together with
// the two functions behind them. Called here so their position relative to every
// other registration is unchanged.
registerEffectTriggerHooks();

// ============================================
// NATIVE ITEM MACRO ENGINE
// ============================================
// Moved to item-macros/item-macro-engine.mjs. Both names stay on this module's
// public surface: they are pinned by the API-export snapshot, and AuraEffectsSD
// and TemplateEffectsSD reach them by dynamic import of this file.
export { hasItemMacro, executeItemMacro };

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

	revertBtn.addEventListener("click", async (event) => {
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

//console.log(`${MODULE_ID} | Module loaded - NPC Feature item macro hooks registered`);


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
				buildCellFloorMap: buildCellFloorMap
			}
		};
		//console.log(`${MODULE_ID} | Module API registered`);
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

/**
 * Inject a compendium filter dropdown into the SpellBookSD dialog
 * Allows users to filter spells by compendium
 */
function injectSpellbookCompendiumFilter(app, html) {
	const header = html.find(".SD-header");
	if (!header.length) return;

	// Get all compendiums that contain spells
	const spellPacks = [];
	for (const pack of game.packs) {
		if (pack.metadata.type !== "Item") continue;
		// Check if pack has any spells in its index
		const hasSpells = pack.index.some(i => i.type === "Spell");
		if (hasSpells) {
			spellPacks.push({
				id: pack.collection,
				name: pack.metadata.label
			});
		}
	}

	// Sort packs alphabetically
	spellPacks.sort((a, b) => a.name.localeCompare(b.name));

	// Build the dropdown options
	const allLabel = game.i18n.localize("SHADOWDARK_EXTRAS.spellbook.compendiumFilter.all");
	let optionsHtml = `<option value="">${allLabel}</option>`;
	for (const pack of spellPacks) {
		optionsHtml += `<option value="${pack.id}">${pack.name}</option>`;
	}

	// Create the filter dropdown
	const filterLabel = game.i18n.localize("SHADOWDARK_EXTRAS.spellbook.compendiumFilter.label");
	const filterHtml = `
		<div class="sdx-spellbook-filter">
			<label>${filterLabel}</label>
			<select class="sdx-spellbook-compendium-select">
				${optionsHtml}
			</select>
		</div>
	`;

	// Insert before navigation tabs
	const nav = html.find(".SD-nav");
	if (nav.length) {
		nav.before(filterHtml);
	} else {
		// Fallback: insert after header
		header.after(filterHtml);
	}

	// Add event listener
	const select = html.find(".sdx-spellbook-compendium-select");
	select.on("change", (event) => {
		const selectedCompendium = event.currentTarget.value;
		filterSpellsByCompendium(html, selectedCompendium);
	});
}

/**
 * Filter the spell list by hiding/showing items based on their compendium
 * @param {jQuery} html - The dialog HTML
 * @param {string} compendiumId - The compendium ID to filter by, or empty for all
 */
function filterSpellsByCompendium(html, compendiumId) {
	const spellItems = html.find(".SD-list .item[data-uuid]");

	spellItems.each((index, element) => {
		const $item = $(element);
		const uuid = $item.data("uuid");

		if (!compendiumId) {
			// Show all
			$item.show();
		} else {
			// Check if the UUID starts with the compendium ID
			// UUID format: Compendium.module.pack.itemId
			if (uuid && uuid.startsWith(`Compendium.${compendiumId}`)) {
				$item.show();
			} else {
				$item.hide();
			}
		}
	});

	// Update the count display if needed (future enhancement)
}

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
	$(document).on("click", ".sdx-table-roll-btn", async (event) => {
		event.preventDefault();
		const container = $(event.currentTarget).closest(".sdx-display-table-container");
		const uuid = container.data("table-uuid");
		if (!uuid) return;

		const table = fromUuidSync(uuid) || await fromUuid(uuid);
		if (table) {
			table.draw();
		}
	});


	// ============================================
	// ALIGNMENT-BASED SPELL FILTERING
	// ============================================

	// We can't replace the class due to read-only property, so we'll use a different approach:
	// Store alignment in a WeakMap and use hooks to set it
	const spellbookAlignments = new WeakMap();

	// Hook to capture when SpellBookSD is rendered and store alignment
	Hooks.on("renderSpellBookSD", (app, html, data) => {
		// The alignment should already be stored via our custom openSpellBook
		const alignment = spellbookAlignments.get(app);
		if (alignment) {
			app.alignment = alignment;
		}
	});

	// Patch SpellBookSD.getData() to filter spells by alignment
	const originalGetData = shadowdark.apps.SpellBookSD.prototype.getData;

	shadowdark.apps.SpellBookSD.prototype.getData = async function () {
		const data = await originalGetData.call(this);

		//console.log(`${MODULE_ID} | SpellBook getData called`);
		//console.log(`${MODULE_ID} | Actor alignment:`, this.alignment);
		//console.log(`${MODULE_ID} | Has spellList:`, !!data.spellList);

		// Filter spells by alignment if alignment is set
		if (this.alignment && data.spellList) {
			//console.log(`${MODULE_ID} | Filtering spells by alignment: ${this.alignment}`);

			for (const tier in data.spellList) {
				const originalCount = data.spellList[tier].length;
				//console.log(`${MODULE_ID} | Tier ${tier} - Original spell count:`, originalCount);

				// We need to load full spell documents to get flags
				// Compendium index doesn't include flags
				const spellsWithFlags = await Promise.all(
					data.spellList[tier].map(async (spell) => {
						// Load full document to get flags
						const fullSpell = await fromUuid(spell.uuid);
						return fullSpell || spell; // Fallback to original if load fails
					})
				);

				// Log first spell to see structure
				if (spellsWithFlags.length > 0) {
					const sample = spellsWithFlags[0];
					//console.log(`${MODULE_ID} | Sample spell from tier ${tier} (after loading):`, {
					//	name: sample.name,
					//	uuid: sample.uuid,
					//	hasFlags: !!sample.flags,
					//	flagKeys: sample.flags ? Object.keys(sample.flags) : 'no flags',
					//	sdxFlags: sample.flags?.[MODULE_ID],
					//	alignment: sample.flags?.[MODULE_ID]?.alignment
					//});
				}

				// Filter spells based on alignment
				data.spellList[tier] = spellsWithFlags.filter(spell => {
					const spellAlignment = spell.flags?.[MODULE_ID]?.alignment;
					const shouldShow = !spellAlignment || spellAlignment === this.alignment;

					// Log filtering decisions for spells with alignment
					if (spellAlignment) {
						//console.log(`${MODULE_ID} | Spell "${spell.name}" has alignment "${spellAlignment}", actor is "${this.alignment}" - ${shouldShow ? 'SHOW' : 'HIDE'}`);
					}

					return shouldShow;
				});

				const filteredCount = data.spellList[tier].length;
				//console.log(`${MODULE_ID} | Tier ${tier} - Filtered spell count:`, filteredCount, `(removed ${originalCount - filteredCount})`);
			}
		} else {
			//console.log(`${MODULE_ID} | No filtering applied - alignment: "${this.alignment}", has spellList: ${!!data.spellList}`);
		}

		return data;
	};

	// Patch ActorSD.openSpellBook() to pass alignment to SpellBookSD
	const originalOpenSpellBook = CONFIG.Actor.documentClass.prototype.openSpellBook;

	CONFIG.Actor.documentClass.prototype.openSpellBook = async function () {
		const playerSpellcasterClasses = await this.getSpellcasterClasses();
		const actorAlignment = this.system.alignment || '';


		//console.log(`${MODULE_ID} | Opening spellbook for actor: ${this.name}`);
		//console.log(`${MODULE_ID} | Actor alignment: "${actorAlignment}"`);
		//console.log(`${MODULE_ID} | Spellcaster classes:`, playerSpellcasterClasses.map(c => c.name));

		const openChosenSpellbook = classUuid => {
			//console.log(`${MODULE_ID} | Creating SpellBookSD with alignment: "${actorAlignment}"`);
			const app = new shadowdark.apps.SpellBookSD(
				classUuid,
				this.id
			);
			// Store alignment directly on the app instance
			app.alignment = actorAlignment;
			// Also store in WeakMap as backup
			spellbookAlignments.set(app, actorAlignment);
			app.render(true);
		};

		if (playerSpellcasterClasses.length <= 0) {
			return ui.notifications.error(
				game.i18n.localize("SHADOWDARK.item.errors.no_spellcasting_classes"),
				{ permanent: false }
			);
		}
		else if (playerSpellcasterClasses.length === 1) {
			return openChosenSpellbook(playerSpellcasterClasses[0].uuid);
		}
		else {
			return foundry.applications.handlebars.renderTemplate(
				"systems/shadowdark/templates/dialog/choose-spellbook.hbs",
				{ classes: playerSpellcasterClasses }
			).then(html => {
				const dialog = new foundry.applications.api.DialogV2({
					window: { title: game.i18n.localize("SHADOWDARK.dialog.spellbook.open_which_class.title") },
					content: html,
					buttons: [
						{
							action: "cancel",
							icon: "fas fa-times",
							label: game.i18n.localize("Cancel")
						}
					]
				});
				dialog.render({ force: true }).then(() => {
					dialog.element.querySelectorAll("[data-action='open-class-spellbook']").forEach(el => {
						el.addEventListener("click", event => {
							event.preventDefault();
							openChosenSpellbook(event.currentTarget.dataset.uuid);
							dialog.close();
						});
					});
				});
			});
		}
	};

	//console.log(`${MODULE_ID} | Alignment-based spell filtering initialized`);
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
Hooks.once('ready', () => {
	// Shadowdark 4.x: NPC display builders moved from ActorSD.prototype to the
	// NPC data model (CONFIG.Actor.dataModels.NPC.prototype). Inside these
	// methods `this` is the data model, and the parent actor is `this.parent`.
	const NpcModel = CONFIG.Actor.dataModels?.NPC;

	if (!NpcModel?.prototype || !NpcModel.prototype.buildNpcAttackDisplays) {
		console.warn("shadowdark-extras | Could not patch NpcSD.prototype.buildNpcAttackDisplays");
		return;
	}

	const originalBuildNpcAttackDisplays = NpcModel.prototype.buildNpcAttackDisplays;

	NpcModel.prototype.buildNpcAttackDisplays = async function (itemId) {
		const actor = this.parent;
		const item = actor?.items.get(itemId);

		// If getting item fails, fallback to original ensuring failure consistency
		if (!item) return originalBuildNpcAttackDisplays.call(this, itemId);

		const attackOptions = {
			attackType: item.system.attackType,
			attackName: item.name,
			// numAttacks: item.system.attack.num,
			attackBonus: parseInt(item.system.bonuses.attackBonus, 10),
			baseDamage: item.system.damage.value,
			bonusDamage: parseInt(item.system.bonuses.damageBonus, 10),
			itemId,
			special: item.system.damage.special || "", // Default to empty string
			ranges: item.system.ranges.map(s => game.i18n.localize(
				CONFIG.SHADOWDARK.RANGES[s])).join("/"),
		};

		// Coerce to a string first: enrichHTML returns "" for non-string input,
		// and Shadowdark 4.x stores attack.num as a NumberField (e.g. 3). Without
		// this, the attack count silently vanishes from the display. Enriching the
		// string still preserves free-form values like "1d4" attacks.
		attackOptions.numAttacks =
			await foundry.applications.ux.TextEditor.implementation.enrichHTML(
				String(item.system.attack.num ?? ""),
				{
					async: true,
				}
			);

		// --- SDX Extra Damage Logic ---
		const MODULE_ID = "shadowdark-extras";
		const sdxFlags = item.flags?.[MODULE_ID] || {};

		let extraText = "";

		// Base Damage Type
		if (sdxFlags.baseDamageType && sdxFlags.baseDamageType !== "physical") {
			const typeLabel = game.i18n.localize(`SHADOWDARK_EXTRAS.damage_type.${sdxFlags.baseDamageType}`);
			extraText += ` [${typeLabel}]`;
		}

		// Extra Damages
		const extraDamagesFlag = sdxFlags.extraDamages || [];
		const extraDamages = Array.isArray(extraDamagesFlag) ? extraDamagesFlag : Object.values(extraDamagesFlag);

		if (extraDamages.length > 0) {
			const parts = extraDamages
				.filter(d => d.formula)
				.map(d => {
					const label = game.i18n.localize(`SHADOWDARK_EXTRAS.damage_type.${d.damageType}`);
					return `${d.formula} [${label}]`;
				});
			if (parts.length > 0) {
				extraText += ` + ${parts.join(" + ")}`;
			}
		}

		if (extraText) {
			// Append to special
			if (attackOptions.special) {
				attackOptions.special += extraText;
			} else {
				attackOptions.special = extraText;
			}
		}
		// ------------------------------

		const baseHtml = await foundry.applications.handlebars.renderTemplate(
			"systems/shadowdark/templates/_partials/npc-attack.hbs",
			attackOptions
		);

		// Add item image if available and not the default
		const defaultIcon = "icons/svg/sword.svg";
		if (item.img && item.img !== defaultIcon) {
			const escapedName = foundry.utils.escapeHTML(item.name);
			const escapedImg = foundry.utils.escapeHTML(item.img);
			const imgHtml = `<img src="${escapedImg}" alt="${escapedName}" class="sdx-npc-item-img" style="width: 18px; height: 18px; vertical-align: text-bottom; margin-right: 2px; border: none; border-radius: 2px;" />`;
			// Insert image inside the anchor, right after the icon <i> tag
			return baseHtml.replace(/<i class="fas fa-dice-d20"><\/i>/, `<i class="fas fa-dice-d20"></i>${imgHtml}`);
		}

		return baseHtml;
	};

	console.log("shadowdark-extras | Patched NpcSD.prototype.buildNpcAttackDisplays");

	// Also patch buildNpcSpecialDisplays to include item images
	if (NpcModel.prototype.buildNpcSpecialDisplays) {
		const originalBuildNpcSpecialDisplays = NpcModel.prototype.buildNpcSpecialDisplays;

		NpcModel.prototype.buildNpcSpecialDisplays = async function (itemId) {
			const actor = this.parent;
			const item = actor?.items.get(itemId);

			// If getting item fails, fallback to original
			if (!item) return originalBuildNpcSpecialDisplays.call(this, itemId);

			const baseHtml = await originalBuildNpcSpecialDisplays.call(this, itemId);

			// Add item image if available and not the default
			const defaultIcon = "icons/svg/explosion.svg";
			if (item.img && item.img !== defaultIcon) {
				const escapedName = foundry.utils.escapeHTML(item.name);
				const escapedImg = foundry.utils.escapeHTML(item.img);
				const imgHtml = `<img src="${escapedImg}" alt="${escapedName}" class="sdx-npc-item-img" style="width: 18px; height: 18px; vertical-align: text-bottom; margin-right: 2px; border: none; border-radius: 2px;" />`;
				// Insert image inside the anchor, right after the icon <i> tag (could be dice-d20 or comment)
				return baseHtml.replace(/<i class="fas (fa-dice-d20|fa-comment)"><\/i>/, `<i class="fas $1"></i>${imgHtml}`);
			}

			return baseHtml;
		};

		console.log("shadowdark-extras | Patched NpcSD.prototype.buildNpcSpecialDisplays");
	}

	// PLAYER WEAPON IMAGES (buildWeaponDisplay) removed: the underlying
	// ActorSD.prototype.buildWeaponDisplay method no longer exists in
	// Shadowdark 4.x. The guard ensured the patch was a silent no-op on the
	// supported system; deleted to reduce dead code.
});

/**
 * Hook to add item images to NPC Features on the Abilities tab
 */
Hooks.on("renderNpcSheetSD", (app, html, data) => {
	const $html = html instanceof jQuery ? html : $(html);

	// Find all feature items and add images
	const featureItems = $html.find('.SD-box .content .item.attack[data-item-id]');
	featureItems.each((_, el) => {
		const $el = $(el);
		const itemId = $el.data('item-id');
		const item = app.actor.items.get(itemId);

		if (!item) return;

		// Check if this is actually a feature (not attack or special)
		if (item.type !== "NPC Feature") return;

		// Check if image is not the default
		const defaultIcon = "icons/svg/book.svg";
		if (item.img && item.img !== defaultIcon) {
			// Find the anchor element and insert image after the icon
			const anchor = $el.find('a.rollable');
			if (anchor.length && !anchor.find('.sdx-npc-item-img').length) {
				const escapedImg = foundry.utils.escapeHTML(item.img);
				const escapedName = foundry.utils.escapeHTML(item.name);
				const imgHtml = `<img src="${escapedImg}" alt="${escapedName}" class="sdx-npc-item-img" style="width: 18px; height: 18px; vertical-align: text-bottom; margin-right: 2px; border: none; border-radius: 2px;" />`;
				anchor.find('i.fas').after(imgHtml);
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
		callback: async (li) => {
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
		}
	});

	menuItems.push({
		label: "Import Scene from ZIP",
		icon: '<i class="fas fa-file-import"></i>',
		visible: () => game.user.isGM,
		callback: async () => {
			await SceneImporter.promptImport();
		}
	});
});

console.log(`${MODULE_ID} | Scene export context menu registered`);

// ============================================
// LIGHTS-OUT CAROUSEL DRAG FUNCTIONALITY
// ============================================

/**
 * Make the lights-out-carousel from shadowdark-crawl-helper draggable
 * Uses a dedicated drag handle icon
 */
function initCarouselDrag() {
	const STORAGE_KEY = "sdx-carousel-position";
	let isDragging = false;
	let dragStartX = 0;
	let dragStartY = 0;
	let carouselStartX = 0;
	let carouselStartY = 0;
	let hasMoved = false;

	// Create and inject the drag handle button
	function injectDragHandle(carousel) {
		// Check if already injected
		if (carousel.querySelector(".sdx-carousel-drag-btn")) return;

		// Find the first side-buttons container (top one with roll-all button)
		const sideButtons = carousel.querySelector(".side-buttons");
		if (!sideButtons) return;

		// Find the roll-all button to insert before it
		const rollAllBtn = sideButtons.querySelector("#rollAllInit");
		if (!rollAllBtn) return;

		// Create drag handle button
		const dragBtn = document.createElement("button");
		dragBtn.className = "ui-control icon fas fa-grip-vertical sdx-carousel-drag-btn";
		dragBtn.dataset.tooltip = "Drag to move carousel";
		dragBtn.type = "button";

		// Insert before roll-all button
		rollAllBtn.parentNode.insertBefore(dragBtn, rollAllBtn);

		// Attach drag handler
		dragBtn.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;

			isDragging = true;
			hasMoved = false;
			dragStartX = e.clientX;
			dragStartY = e.clientY;

			const currentCarousel = document.querySelector("#actorCarousel.lights-out-carousel");
			if (currentCarousel) {
				const rect = currentCarousel.getBoundingClientRect();
				carouselStartX = rect.left;
				carouselStartY = rect.top;
			}

			dragBtn.classList.add("sdx-carousel-dragging");
			document.body.style.userSelect = "none";
			e.preventDefault();
		});
	}

	// Setup drag on the carousel
	function setupCarouselDrag(carousel) {
		if (!carousel) return;

		// Don't restore position if actively dragging
		if (!isDragging) {
			// Always restore saved position (carousel may have been re-positioned by the app)
			const savedPos = localStorage.getItem(STORAGE_KEY);
			if (savedPos) {
				try {
					const { left, top } = JSON.parse(savedPos);
					// Only apply if position differs (avoid unnecessary style changes)
					const currentLeft = parseInt(carousel.style.left) || 0;
					const currentTop = parseInt(carousel.style.top) || 0;
					if (Math.abs(currentLeft - left) > 5 || Math.abs(currentTop - top) > 5) {
						carousel.style.left = `${left}px`;
						carousel.style.top = `${top}px`;
					}
				} catch (e) {
					console.warn("shadowdark-extras | Failed to restore carousel position:", e);
				}
			}
		}

		// Inject drag handle if not present
		injectDragHandle(carousel);
	}

	// Global mouse move handler
	document.addEventListener("mousemove", (e) => {
		if (!isDragging) return;

		const dx = e.clientX - dragStartX;
		const dy = e.clientY - dragStartY;

		// Only start moving after a small threshold to allow clicks
		if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
			hasMoved = true;

			const carousel = document.querySelector("#actorCarousel.lights-out-carousel");
			if (carousel) {
				const newLeft = carouselStartX + dx;
				const newTop = carouselStartY + dy;
				carousel.style.left = `${newLeft}px`;
				carousel.style.top = `${newTop}px`;
			}
		}
	});

	// Global mouse up handler
	document.addEventListener("mouseup", () => {
		if (!isDragging) return;

		isDragging = false;
		document.body.style.userSelect = "";

		// Remove dragging class from all portraits
		document.querySelectorAll(".sdx-carousel-dragging").forEach(el => {
			el.classList.remove("sdx-carousel-dragging");
		});

		// Save position if moved
		if (hasMoved) {
			const carousel = document.querySelector("#actorCarousel.lights-out-carousel");
			if (carousel) {
				const rect = carousel.getBoundingClientRect();
				localStorage.setItem(STORAGE_KEY, JSON.stringify({
					left: rect.left,
					top: rect.top
				}));
			}
		}
	});

	// Watch for carousel to appear using MutationObserver
	const observer = new MutationObserver((mutations) => {
		// Check for carousel and setup any new portraits
		const carousel = document.querySelector("#actorCarousel.lights-out-carousel");
		if (carousel) {
			setupCarouselDrag(carousel);
		}
	});

	// Observe the scene-controls area where the carousel is inserted
	Hooks.once("ready", () => {
		// Check if shadowdark-crawl-helper is enabled
		if (!game.modules.get("shadowdark-crawl-helper")?.active) return;

		// Start observing
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});

		// Also try to setup on any existing carousel
		const carousel = document.querySelector("#actorCarousel.lights-out-carousel");
		if (carousel) {
			setupCarouselDrag(carousel);
		}

		console.log(`${MODULE_ID} | Carousel drag functionality initialized`);
	});
}

// Initialize carousel drag
initCarouselDrag();

// ============================================
// CRAWL-HELPER: Override rollDeathTimer to let
// the player roll the d4 death timer instead of GM
// ============================================
Hooks.once("ready", () => {
	if (!game.modules.get("shadowdark-crawl-helper")?.active) return;

	const crawlerModel = CONFIG.Combatant?.dataModels?.["shadowdark-crawl-helper.crawler"];
	if (!crawlerModel) {
		console.warn(`${MODULE_ID} | Could not find crawl-helper combatant data model to override rollDeathTimer`);
		return;
	}

	crawlerModel.prototype.rollDeathTimer = async function () {
		const actor = this.parent.actor;
		const user = game.users.find(u => (u.character?.id === actor.id) && u.active) ?? game.users.activeGM;

		// Prompt the player to roll their death timer
		const defaultFormula = "d4 +" + actor.system.abilities.con.mod;
		const fields = foundry.applications.fields;
		const textInput = fields.createTextInput({ name: "formula", value: defaultFormula });
		const textGroup = fields.createFormGroup({ input: textInput, label: "Roll:" });

		const response = await user.query("dialog", {
			config: {
				window: { title: "Roll Death Timer" },
				content: `${textGroup.outerHTML}`,
				modal: true
			},
			type: "input"
		});

		const formula = Roll.validate(response?.formula) ? response.formula : defaultFormula;
		let roll = await new Roll(formula).evaluate();
		const total = Math.max(roll.total, 1);
		const msg = await ChatMessage.create({
			content: `<div class="shadowdark"><h3 style="color: white;">${actor.name} will die in ${total} rounds</h3><br>${await roll.render()}</div>`,
			speaker: { actor: actor.id },
			user: user,
			rolls: [roll.toJSON()]
		});
		if (game.dice3d) await game.dice3d.waitFor3DAnimationByMessageID(msg.id);
		await this.parent.update({ "system.dyingRounds": total });
	};

	console.log(`${MODULE_ID} | Overrode crawl-helper rollDeathTimer to let player roll`);
});

// Initialize Placeable Notes
Hooks.once("ready", () => {
	initPlaceableNotes();
});

Hooks.once("init", () => {
	// Register NPC Special Attack Sheet
	foundry.documents.collections.Items.registerSheet("shadowdark", NPCSpecialAttackSheetSD, {
		types: ["NPC Special Attack"],
		makeDefault: true,
		label: "SDX Special Attack Sheet (V2)"
	});
});

// ============================================
// GEM BAG ENHANCEMENT HOOK
// ============================================
Hooks.on("renderApplication", (app, html, data) => {
	try {
		enhanceGemBag(app, html);
	} catch (err) {
		console.error(`${MODULE_ID} | Failed to enhance gem bag`, err);
	}
});


