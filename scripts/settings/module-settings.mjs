/**
 * Register the module's world settings and configuration menus in their
 * established order. Persisted setting keys and menu ids are intentionally
 * kept in this coordinator; the drawing registrations and settings-page
 * organization hook live in focused sibling modules.
 */

import { registerCombatSettings } from "../combat/CombatSettingsSD.mjs";
import { registerEffectsSettings } from "../effects/EffectsSettingsSD.mjs";
import { registerHpWavesSettings } from "../character-sheet/HpWavesSettingsSD.mjs";
import { registerTravelActivitiesSettings } from "../party/TravelActivitiesSettingsSD.mjs";
import { registerTravelSpeedsSettings } from "../party/TravelSpeedsSettingsSD.mjs";
import { registerPartyWeatherSettings } from "../party/PartyWeatherSettingsSD.mjs";
import { registerEasyReferenceSettings } from "../journal/easy-reference/EasyReferenceMenu.mjs";
import { registerTokenToolbarSettings } from "../canvas/TokenToolbarSD.mjs";
import { registerTraySettings } from "../tray/TraySD.mjs";
import { registerPinStyleSettings } from "../journal/PinStyleEditorSD.mjs";
import { registerSDXCoordsSettings, registerSDXCoordsMenu } from "../hex/SDXCoordsSD.mjs";
import { SDXCoordsSettingsApp } from "../hex/SDXCoordsSettingsSD.mjs";
import { DEFAULT_INVENTORY_STYLES, InventoryStylesApp } from "../inventory/inventory-styles.mjs";
import { DEFAULT_LIGHT_TEMPLATES, LightTemplateEditor } from "../canvas/light-templates.mjs";
import { MedkitWorldScanMenu } from "../combat/MedkitSD.mjs";
import { CreatureTypesApp } from "../npc/CreatureTypesApp.mjs";
import { applySheetDecorationStyles as applyUnconditionalSheetDecorationStyles } from "../character-sheet/sheet-decoration.mjs";
import { openCarousingTablesEditor } from "../party/carousing/CarousingTablesApp.mjs";
import { openExpandedCarousingTablesEditor } from "../party/carousing/ExpandedCarousingTablesApp.mjs";
import SheetEditorConfig from "../character-sheet/SheetEditorConfig.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";
import { registerDrawingSettings } from "./drawing-settings.mjs";
import { FEATURE_IDS, anyFeatureEnabled, isFeatureEnabled } from "./feature-gates.mjs";
export { setupSettingsOrganization } from "./settings-organization.mjs";

const owners = (...featureIds) => Object.freeze(featureIds);

/**
 * The registration surface is feature data, not module-wide infrastructure.
 * `null` is reserved for compatibility state which must stay registered for
 * the migration code to be able to inspect it. Every other entry lists the
 * feature(s) whose runtime path owns or consumes that setting.
 */
/* eslint-disable quote-props, comma-dangle */
export const SETTING_OWNERS = Object.freeze({
	itemacroMigrationDone: owners(FEATURE_IDS.ITEM_MACROS),
	webpMigrationDone: null,
	webpPackSweepDone: null,
	inventoryStyles: owners(FEATURE_IDS.INVENTORY_STYLING),
	inventoryStylesMenu: owners(FEATURE_IDS.INVENTORY_STYLING),
	sheetEditorMenu: owners(FEATURE_IDS.SHEET_STYLING),
	enableFogEffects: owners(FEATURE_IDS.HEX_FOG),
	enableFocusTracker: owners(FEATURE_IDS.FOCUS_TRACKER),
	autoRollFocusOnTurn: owners(FEATURE_IDS.FOCUS_TRACKER),
	enhanceSpells: owners(
		FEATURE_IDS.SPELL_ACTIVITY,
		FEATURE_IDS.SPELL_CONFIGS,
		FEATURE_IDS.TEMPLATE_EFFECTS,
		FEATURE_IDS.AURAS,
		FEATURE_IDS.ITEM_MACROS,
		FEATURE_IDS.MAGIC_ITEM_SHEETS,
		FEATURE_IDS.ANIMATION_ITEM_OVERRIDES,
	),
	customLightTemplates: owners(
		FEATURE_IDS.LIGHT_TRACKER,
		FEATURE_IDS.PARTY_MANAGEMENT,
		FEATURE_IDS.MAGIC_ITEM_SHEETS,
	),
	customDecorAssets: owners(FEATURE_IDS.DECOR_PAINTER),
	decorDungeondraftPacks: owners(FEATURE_IDS.DECOR_PAINTER),
	decorDungeondraftPacksMenu: owners(FEATURE_IDS.DECOR_PAINTER),
	customLightTemplatesMenu: owners(FEATURE_IDS.LIGHT_TRACKER),
	enableWandUses: owners(FEATURE_IDS.MAGIC_ITEM_SHEETS),
	showMedkitIcon: owners(FEATURE_IDS.MEDKIT),
	medkitWorldScanMenu: owners(FEATURE_IDS.MEDKIT),
	enableEnhancedHeader: owners(FEATURE_IDS.ENHANCED_HEADER),
	enableNpcPlayerTheme: owners(FEATURE_IDS.SHEET_STYLING),
	enableDefaultHeaderBg: owners(FEATURE_IDS.ENHANCED_HEADER),
	defaultHeaderBgPath: owners(FEATURE_IDS.ENHANCED_HEADER),
	enableEnhancedDetails: owners(FEATURE_IDS.ENHANCED_TABS),
	sheetBorderStyle: owners(FEATURE_IDS.SHEET_STYLING),
	abilityPanelStyle: owners(FEATURE_IDS.SHEET_STYLING),
	acPanelStyle: owners(FEATURE_IDS.SHEET_STYLING),
	statPanelStyle: owners(FEATURE_IDS.SHEET_STYLING),
	borderImageWidth: owners(FEATURE_IDS.SHEET_STYLING),
	borderImageSlice: owners(FEATURE_IDS.SHEET_STYLING),
	borderImageOutset: owners(FEATURE_IDS.SHEET_STYLING),
	borderImageRepeat: owners(FEATURE_IDS.SHEET_STYLING),
	borderWidth: owners(FEATURE_IDS.SHEET_STYLING),
	sdBoxBorderStyle: owners(FEATURE_IDS.SHEET_STYLING),
	sdBoxBorderWidth: owners(FEATURE_IDS.SHEET_STYLING),
	sdBoxBorderSlice: owners(FEATURE_IDS.SHEET_STYLING),
	sdBoxBorderTransparencyWidth: owners(FEATURE_IDS.SHEET_STYLING),
	journalBorderStyle: owners(FEATURE_IDS.SHEET_STYLING),
	journalBorderImageWidth: owners(FEATURE_IDS.SHEET_STYLING),
	journalBorderImageSlice: owners(FEATURE_IDS.SHEET_STYLING),
	journalBorderImageOutset: owners(FEATURE_IDS.SHEET_STYLING),
	journalBorderImageRepeat: owners(FEATURE_IDS.SHEET_STYLING),
	conditionModalBorderStyle: owners(FEATURE_IDS.SHEET_STYLING),
	conditionModalBorderImageWidth: owners(FEATURE_IDS.SHEET_STYLING),
	conditionModalBorderImageSlice: owners(FEATURE_IDS.SHEET_STYLING),
	conditionModalBorderImageOutset: owners(FEATURE_IDS.SHEET_STYLING),
	conditionModalBorderImageRepeat: owners(FEATURE_IDS.SHEET_STYLING),
	abilityModColor: owners(FEATURE_IDS.SHEET_STYLING),
	levelValueColor: owners(FEATURE_IDS.SHEET_STYLING),
	acValueColor: owners(FEATURE_IDS.SHEET_STYLING),
	initModColor: owners(FEATURE_IDS.SHEET_STYLING),
	luckValueColor: owners(FEATURE_IDS.SHEET_STYLING),
	navLinkColor: owners(FEATURE_IDS.SHEET_STYLING),
	navLinkActiveColor: owners(FEATURE_IDS.SHEET_STYLING),
	detailsRowColor: owners(FEATURE_IDS.SHEET_STYLING),
	borderBackgroundColor: owners(FEATURE_IDS.SHEET_STYLING),
	sheetHeaderBackgroundColor: owners(FEATURE_IDS.SHEET_STYLING),
	luckContainerColor: owners(FEATURE_IDS.SHEET_STYLING),
	actorNameColor: owners(FEATURE_IDS.SHEET_STYLING),
	windowHeaderColor: owners(FEATURE_IDS.SHEET_STYLING),
	navBackgroundColor: owners(FEATURE_IDS.SHEET_STYLING),
	navBorderColor: owners(FEATURE_IDS.SHEET_STYLING),
	effectsTextColor: owners(FEATURE_IDS.SHEET_STYLING),
	talentsTextColor: owners(FEATURE_IDS.SHEET_STYLING),
	xpRowColor: owners(FEATURE_IDS.SHEET_STYLING),
	windowTitleBarBackgroundColor: owners(FEATURE_IDS.SHEET_STYLING),
	statsLabelColor: owners(FEATURE_IDS.SHEET_STYLING),
	actorNameShadowColor: owners(FEATURE_IDS.SHEET_STYLING),
	actorNameShadowAlpha: owners(FEATURE_IDS.SHEET_STYLING),
	actorNameFontWeight: owners(FEATURE_IDS.SHEET_STYLING),
	tabGradientStart: owners(FEATURE_IDS.SHEET_STYLING),
	tabGradientEnd: owners(FEATURE_IDS.SHEET_STYLING),
	enableJournalNotes: owners(FEATURE_IDS.JOURNAL_NOTES),
	enablePlaceableNotes: owners(FEATURE_IDS.PLACEABLE_NOTES),
	enableAddCoinsButton: owners(FEATURE_IDS.ADD_COINS),
	conditionsTheme: owners(FEATURE_IDS.QUICK_CONDITIONS),
	enableContainers: owners(FEATURE_IDS.CONTAINERS),
	enableNestedContainers: owners(FEATURE_IDS.CONTAINERS),
	enableTrading: owners(FEATURE_IDS.TRADING),
	enableMultiselect: owners(FEATURE_IDS.MULTI_SELECT),
	enableCarousing: owners(FEATURE_IDS.CAROUSING),
	carousingMode: owners(FEATURE_IDS.CAROUSING),
	carousingShowBenefitsToPlayers: owners(FEATURE_IDS.CAROUSING),
	carousingShowMishapsToPlayers: owners(FEATURE_IDS.CAROUSING),
	carousingWealthBase: owners(FEATURE_IDS.CAROUSING),
	carousingTablesMenu: owners(FEATURE_IDS.CAROUSING),
	expandedCarousingData: owners(FEATURE_IDS.CAROUSING),
	enableNpcInventory: owners(FEATURE_IDS.NPC_INVENTORY),
	enableNpcCreatureType: owners(FEATURE_IDS.NPC_CREATURE_TYPES),
	customCreatureTypes: owners(FEATURE_IDS.NPC_CREATURE_TYPES),
	manageCreatureTypes: owners(FEATURE_IDS.NPC_CREATURE_TYPES),
	enableTorchAnimations: owners(FEATURE_IDS.TORCH_ANIMATIONS),
	enableWeaponAnimations: owners(FEATURE_IDS.WEAPON_SPRITES),
	enableLevelUpAnimation: owners(FEATURE_IDS.LEVEL_UP_ANIMATIONS),
	pixelPerfectPins: owners(FEATURE_IDS.JOURNAL_PINS),
	pixelPerfectPinsAlpha: owners(FEATURE_IDS.JOURNAL_PINS),
	combatSettings: owners(
		FEATURE_IDS.DAMAGE_CARDS,
		FEATURE_IDS.SCROLLING_COMBAT_TEXT,
		FEATURE_IDS.WEAPON_BONUSES,
		FEATURE_IDS.SPELL_ACTIVITY,
		FEATURE_IDS.FOCUS_TRACKER,
		FEATURE_IDS.TEMPLATE_EFFECTS,
		FEATURE_IDS.AURAS,
	),
	combatSettingsMenu: owners(
		FEATURE_IDS.DAMAGE_CARDS,
		FEATURE_IDS.SCROLLING_COMBAT_TEXT,
		FEATURE_IDS.WEAPON_BONUSES,
		FEATURE_IDS.SPELL_ACTIVITY,
		FEATURE_IDS.FOCUS_TRACKER,
		FEATURE_IDS.TEMPLATE_EFFECTS,
		FEATURE_IDS.AURAS,
	),
	effectsSettings: owners(FEATURE_IDS.CASTING_BLOCKERS),
	effectsSettingsMenu: owners(FEATURE_IDS.CASTING_BLOCKERS),
	hpWavesSettings: owners(FEATURE_IDS.HP_WAVES),
	hpWavesSettingsMenu: owners(FEATURE_IDS.HP_WAVES),
	travelActivities: owners(FEATURE_IDS.PARTY_MANAGEMENT),
	travelActivitiesMenu: owners(FEATURE_IDS.PARTY_MANAGEMENT),
	travelSpeeds: owners(FEATURE_IDS.PARTY_MANAGEMENT),
	travelSpeedsMenu: owners(FEATURE_IDS.PARTY_MANAGEMENT),
	partyWeatherTableUuid: owners(FEATURE_IDS.PARTY_MANAGEMENT),
	partyWeatherTableMenu: owners(FEATURE_IDS.PARTY_MANAGEMENT),
	...Object.fromEntries([
		"showNpcCards",
		"showItemCards",
		"showTables",
		"showChecks",
		"showDice",
	].map(category => [`easyRef_${category}`, owners(FEATURE_IDS.EASY_REFERENCE)])),
	"tokenToolbar.enabled": owners(FEATURE_IDS.TOKEN_TOOLBAR),
	"tokenToolbar.visibility": owners(FEATURE_IDS.TOKEN_TOOLBAR),
	"tokenToolbar.combatOnly": owners(FEATURE_IDS.TOKEN_TOOLBAR),
	"tokenToolbar.showEffects": owners(FEATURE_IDS.TOKEN_TOOLBAR),
	"tokenToolbar.showEquipped": owners(FEATURE_IDS.TOKEN_TOOLBAR),
	"tray.enabled": owners(FEATURE_IDS.TRAY),
	"tray.showPartyTab": owners(FEATURE_IDS.PARTY_MANAGEMENT),
	"tray.partyName": owners(FEATURE_IDS.PARTY_MANAGEMENT),
	"tray.showHealthBars": owners(FEATURE_IDS.PARTY_MANAGEMENT),
	"tray.showNPCs": owners(FEATURE_IDS.PARTY_MANAGEMENT),
	"tray.hideNpcsFromPlayers": owners(FEATURE_IDS.PARTY_MANAGEMENT),
	"hexFog.defaultRevealRadius": owners(FEATURE_IDS.HEX_FOG),
	"hexPainter.customTileWidth": owners(FEATURE_IDS.HEX_PAINTER),
	"hexPainter.customTileHeight": owners(FEATURE_IDS.HEX_PAINTER),
	"hexPainter.poiScale": owners(FEATURE_IDS.HEX_PAINTER),
	"settlement.useLocalMaphub": owners(FEATURE_IDS.MAP_GENERATORS),
	pinStyleDefaults: owners(FEATURE_IDS.JOURNAL_PINS),
	pinStyleEditorMenu: owners(FEATURE_IDS.JOURNAL_PINS),
	sdxCoordsSettings: owners(FEATURE_IDS.COORDINATES),
	sdxCoordsMenu: owners(FEATURE_IDS.COORDINATES),
	"drawing.enablePlayerDrawing": owners(FEATURE_IDS.DRAWING_TOOLS),
	"drawing.timedEraseTimeout": owners(FEATURE_IDS.DRAWING_TOOLS),
	"drawing.hotkeyEnabled": owners(FEATURE_IDS.DRAWING_TOOLS),
	"drawing.blockWhenTyping": owners(FEATURE_IDS.DRAWING_TOOLS),
	"drawing.toolbar.drawingMode": owners(FEATURE_IDS.DRAWING_TOOLS),
	"drawing.toolbar.stampStyle": owners(FEATURE_IDS.DRAWING_TOOLS),
	"drawing.toolbar.symbolSize": owners(FEATURE_IDS.DRAWING_TOOLS),
	"drawing.toolbar.lineWidth": owners(FEATURE_IDS.DRAWING_TOOLS),
	"drawing.toolbar.lineStyle": owners(FEATURE_IDS.DRAWING_TOOLS),
	"drawing.toolbar.color": owners(FEATURE_IDS.DRAWING_TOOLS),
	"drawing.toolbar.timedEraseEnabled": owners(FEATURE_IDS.DRAWING_TOOLS),
	"drawing.toolbar.opacity": owners(FEATURE_IDS.DRAWING_TOOLS),
	"drawing.toolbar.position": owners(FEATURE_IDS.DRAWING_TOOLS),
});
/* eslint-enable quote-props, comma-dangle */

const settingOwnerEnabled = settingKey => {
	const featureIds = SETTING_OWNERS[settingKey];
	if (featureIds === undefined) throw new Error(`Unknown setting ownership: ${settingKey}`);
	return featureIds === null || anyFeatureEnabled(...featureIds);
};

const applySheetDecorationStyles = () => {
	if (isFeatureEnabled(FEATURE_IDS.SHEET_STYLING)) applyUnconditionalSheetDecorationStyles();
};

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


export function registerSettings() {
	// ═══════════════════════════════════════════════════════════════
	// 1. CONFIGURATION MENUS
	// ═══════════════════════════════════════════════════════════════

	// Combat Settings Menu (registered via registerCombatSettings)
	if (settingOwnerEnabled("combatSettings")) registerCombatSettings();

	// Effects Settings Menu (registered via registerEffectsSettings)
	if (settingOwnerEnabled("effectsSettings")) registerEffectsSettings();

	// HP Waves Settings Menu (registered via registerHpWavesSettings)
	if (settingOwnerEnabled("hpWavesSettings")) registerHpWavesSettings();

	// Travel Activities Settings Menu (registered via registerTravelActivitiesSettings)
	if (settingOwnerEnabled("travelActivities")) registerTravelActivitiesSettings();

	// Travel Speeds Settings Menu (registered via registerTravelSpeedsSettings)
	if (settingOwnerEnabled("travelSpeeds")) registerTravelSpeedsSettings();

	// Party Weather RollTable Settings Menu
	if (settingOwnerEnabled("partyWeatherTableUuid")) registerPartyWeatherSettings();

	// Inventory Styles data setting (hidden)
	if (settingOwnerEnabled("itemacroMigrationDone")) game.settings.register(MODULE_ID, "itemacroMigrationDone", {
		scope: "world",
		config: false,
		default: false,
		type: Boolean,
	});

	// Gate for the one-time PNG/JPG -> WebP stored-path migration.
	game.settings.register(MODULE_ID, "webpMigrationDone", {
		scope: "world",
		config: false,
		default: false,
		type: Boolean,
	});

	// Separate gate for the world-compendium sweep: packs that were locked (or
	// whose update failed) must be retried on later loads, so this only flips
	// once a sweep completes cleanly.
	game.settings.register(MODULE_ID, "webpPackSweepDone", {
		scope: "world",
		config: false,
		default: false,
		type: Boolean,
	});

	if (settingOwnerEnabled("inventoryStyles")) game.settings.register(MODULE_ID, "inventoryStyles", {
		name: "Inventory Styles Configuration",
		scope: "world",
		config: false,
		type: Object,
		default: foundry.utils.deepClone(DEFAULT_INVENTORY_STYLES),
	});

	// Inventory Styles Menu
	if (settingOwnerEnabled("inventoryStylesMenu")) game.settings.registerMenu(MODULE_ID, "inventoryStylesMenu", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.inventory_styles.name"),
		label: game.i18n.localize("SHADOWDARK_EXTRAS.settings.inventory_styles.label"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.inventory_styles.hint"),
		icon: "fas fa-palette",
		type: InventoryStylesApp,
		restricted: true,
	});

	// Sheet Style Editor Menu
	if (settingOwnerEnabled("sheetEditorMenu")) game.settings.registerMenu(MODULE_ID, "sheetEditorMenu", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.menuName"),
		label: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.menuLabel"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.menuHint"),
		icon: "fas fa-paint-brush",
		type: SheetEditorConfig,
		restricted: true,
	});

	// ═══════════════════════════════════════════════════════════════
	// 2. COMBAT & SPELLS
	// ═══════════════════════════════════════════════════════════════

	if (settingOwnerEnabled("enableFogEffects")) game.settings.register(MODULE_ID, "enableFogEffects", {
		name: "Enable Fog Effects",
		hint: "Enable shader effects for hex fog (right-click the Hex Fog button to pick an effect). Disable to save performance.",
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
	});

	if (settingOwnerEnabled("enableFocusTracker")) game.settings.register(MODULE_ID, "enableFocusTracker", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_focus_tracker.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_focus_tracker.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	if (settingOwnerEnabled("autoRollFocusOnTurn")) game.settings.register(MODULE_ID, "autoRollFocusOnTurn", {
		name: "Auto-Roll Focus on Turn",
		hint: "At the start of a caster's turn, automatically roll the focus check for each active focus spell instead of posting a manual reminder. On success the spell's per-turn effect applies; on failure the spell ends. Requires the Focus Tracker.",
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
		requiresReload: false,
	});

	if (settingOwnerEnabled("enhanceSpells")) game.settings.register(MODULE_ID, "enhanceSpells", {
		name: "Enhance Spells",
		hint: "Add damage/heal configuration to spell items for automatic spell damage application similar to weapon attacks.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	// Custom Light Templates data setting (hidden)
	if (settingOwnerEnabled("customLightTemplates")) game.settings.register(MODULE_ID, "customLightTemplates", {
		name: "Custom Light Templates",
		scope: "world",
		config: false,
		type: Array,
		default: foundry.utils.deepClone(DEFAULT_LIGHT_TEMPLATES),
	});

	if (settingOwnerEnabled("customDecorAssets")) game.settings.register(MODULE_ID, "customDecorAssets", {
		name: "Custom Decor Assets",
		scope: "world",
		config: false,
		type: Array,
		default: [],
	});

	if (settingOwnerEnabled("decorDungeondraftPacks")) game.settings.register(MODULE_ID, "decorDungeondraftPacks", {
		name: "Dungeondraft Decor Packs",
		scope: "world",
		config: false,
		type: Array,
		default: [],
	});

	if (settingOwnerEnabled("decorDungeondraftPacksMenu")) game.settings.registerMenu(MODULE_ID, "decorDungeondraftPacksMenu", {
		name: "Dungeondraft Decor Packs",
		label: "Manage Packs",
		hint: "Import, enable, or hide Dungeondraft object packs in the SDX Decor tray.",
		icon: "fas fa-cubes",
		type: class extends foundry.applications.api.ApplicationV2 {
			static DEFAULT_OPTIONS = { id: "sdx-ddpack-settings-menu-stub", window: { title: "" } };

			async render() {
				const { DDPackSettingsApp } = await import("../dungeon/DDPackSettingsAppSD.mjs");
				new DDPackSettingsApp().render(true);
				return this;
			}
		},
		restricted: true,
	});

	// Custom Light Templates Menu
	if (settingOwnerEnabled("customLightTemplatesMenu")) game.settings.registerMenu(MODULE_ID, "customLightTemplatesMenu", {
		name: "Light Templates",
		label: "Light Templates",
		hint: "Configure custom light templates for items.",
		icon: "fas fa-lightbulb",
		type: LightTemplateEditor,
		restricted: true,
	});

	if (settingOwnerEnabled("enableWandUses")) game.settings.register(MODULE_ID, "enableWandUses", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_wand_uses.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_wand_uses.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	// ═══════════════════════════════════════════════════════════════
	// 3. CHARACTER SHEET
	// ═══════════════════════════════════════════════════════════════
	if (settingOwnerEnabled("showMedkitIcon")) game.settings.register(MODULE_ID, "showMedkitIcon", {
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
	if (settingOwnerEnabled("medkitWorldScanMenu")) game.settings.registerMenu(MODULE_ID, "medkitWorldScanMenu", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.medkit_world_scan.name"),
		label: game.i18n.localize("SHADOWDARK_EXTRAS.settings.medkit_world_scan.label"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.medkit_world_scan.hint"),
		icon: "fas fa-kit-medical",
		type: MedkitWorldScanMenu,
		restricted: true,
	});
	if (settingOwnerEnabled("enableEnhancedHeader")) game.settings.register(MODULE_ID, "enableEnhancedHeader", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_enhanced_header.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_enhanced_header.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	if (settingOwnerEnabled("enableNpcPlayerTheme")) game.settings.register(MODULE_ID, "enableNpcPlayerTheme", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_npc_player_theme.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_npc_player_theme.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: false,
		onChange: () => {
			if (!isFeatureEnabled(FEATURE_IDS.SHEET_STYLING)) return;
			for (const app of Object.values(ui.windows ?? {})) {
				if (app.actor?.type === "NPC") app.render(false);
			}
		},
	});

	if (settingOwnerEnabled("enableDefaultHeaderBg")) game.settings.register(MODULE_ID, "enableDefaultHeaderBg", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_default_header_bg.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_default_header_bg.hint"),
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
	});

	if (settingOwnerEnabled("defaultHeaderBgPath")) game.settings.register(MODULE_ID, "defaultHeaderBgPath", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.default_header_bg_path.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.default_header_bg_path.hint"),
		scope: "world",
		config: true,
		default: "",
		type: String,
		filePicker: "imagevideo",
	});

	// Internal setting - always enabled, not shown in UI
	if (settingOwnerEnabled("enableEnhancedDetails")) game.settings.register(MODULE_ID, "enableEnhancedDetails", {
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
		const num = String(i).padStart(3, "0");
		borderChoices[`panel-border-${num}.png`] = `Border Style ${i}`;
	}

	const panelChoices = {};
	for (let i = 0; i <= 31; i++) {
		const num = String(i).padStart(3, "0");
		panelChoices[`panel-${num}.png`] = `Panel Style ${i}`;
	}

	const transparentCenterChoices = {};
	for (let i = 0; i <= 31; i++) {
		const num = String(i).padStart(3, "0");
		transparentCenterChoices[`panel-transparent-center-${num}.png`] = `Panel Style ${i}`;
	}

	if (settingOwnerEnabled("sheetBorderStyle")) game.settings.register(MODULE_ID, "sheetBorderStyle", {
		name: "Sheet Border Style",
		hint: "Choose the decorative border frame around the player character sheet.",
		scope: "world",
		config: false,
		default: "panel-border-004.webp",
		type: String,
		choices: borderChoices,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("abilityPanelStyle")) game.settings.register(MODULE_ID, "abilityPanelStyle", {
		name: "Ability Panel Style",
		hint: "Choose the panel background for ability stat boxes (STR, DEX, etc.).",
		scope: "world",
		config: false,
		default: "panel-013.webp",
		type: String,
		choices: panelChoices,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("acPanelStyle")) game.settings.register(MODULE_ID, "acPanelStyle", {
		name: "AC Panel Style",
		hint: "Choose the panel background for the Armor Class box.",
		scope: "world",
		config: false,
		default: "panel-transparent-center-004.webp",
		type: String,
		choices: transparentCenterChoices,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("statPanelStyle")) game.settings.register(MODULE_ID, "statPanelStyle", {
		name: "Init/Level/Luck Panel Style",
		hint: "Choose the panel background for Initiative, Level, and Luck boxes.",
		scope: "world",
		config: false,
		default: "panel-transparent-center-015.webp",
		type: String,
		choices: transparentCenterChoices,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("borderImageWidth")) game.settings.register(MODULE_ID, "borderImageWidth", {
		name: "Border Image Width",
		scope: "world",
		config: false,
		default: 16,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("borderImageSlice")) game.settings.register(MODULE_ID, "borderImageSlice", {
		name: "Border Image Slice",
		scope: "world",
		config: false,
		default: 12,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("borderImageOutset")) game.settings.register(MODULE_ID, "borderImageOutset", {
		name: "Border Image Outset",
		scope: "world",
		config: false,
		default: 0,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("borderImageRepeat")) game.settings.register(MODULE_ID, "borderImageRepeat", {
		name: "Border Image Repeat",
		scope: "world",
		config: false,
		default: "stretch",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("borderWidth")) game.settings.register(MODULE_ID, "borderWidth", {
		name: "Border Width",
		scope: "world",
		config: false,
		default: 10,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("sdBoxBorderStyle")) game.settings.register(MODULE_ID, "sdBoxBorderStyle", {
		name: "SD-Box Border Style",
		scope: "world",
		config: false,
		default: "panel-border-001.webp",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("sdBoxBorderWidth")) game.settings.register(MODULE_ID, "sdBoxBorderWidth", {
		name: "SD-Box Border Image Width",
		scope: "world",
		config: false,
		default: 16,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("sdBoxBorderSlice")) game.settings.register(MODULE_ID, "sdBoxBorderSlice", {
		name: "SD-Box Border Image Slice",
		scope: "world",
		config: false,
		default: 12,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("sdBoxBorderTransparencyWidth")) game.settings.register(MODULE_ID, "sdBoxBorderTransparencyWidth", {
		name: "SD-Box Border Width",
		scope: "world",
		config: false,
		default: 10,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	// Journal Border Settings
	if (settingOwnerEnabled("journalBorderStyle")) game.settings.register(MODULE_ID, "journalBorderStyle", {
		name: "Journal Border Style",
		scope: "world",
		config: false,
		default: "panel-border-004.webp",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("journalBorderImageWidth")) game.settings.register(MODULE_ID, "journalBorderImageWidth", {
		name: "Journal Border Image Width",
		scope: "world",
		config: false,
		default: 16,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("journalBorderImageSlice")) game.settings.register(MODULE_ID, "journalBorderImageSlice", {
		name: "Journal Border Image Slice",
		scope: "world",
		config: false,
		default: 12,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("journalBorderImageOutset")) game.settings.register(MODULE_ID, "journalBorderImageOutset", {
		name: "Journal Border Image Outset",
		scope: "world",
		config: false,
		default: 0,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("journalBorderImageRepeat")) game.settings.register(MODULE_ID, "journalBorderImageRepeat", {
		name: "Journal Border Image Repeat",
		scope: "world",
		config: false,
		default: "repeat",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	// Condition Modal Border Settings
	if (settingOwnerEnabled("conditionModalBorderStyle")) game.settings.register(MODULE_ID, "conditionModalBorderStyle", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.conditionModalBorder"),
		scope: "world",
		config: false,
		default: "panel-border-004.webp",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("conditionModalBorderImageWidth")) game.settings.register(MODULE_ID, "conditionModalBorderImageWidth", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.conditionModalBorderImageWidth"),
		scope: "world",
		config: false,
		default: 16,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("conditionModalBorderImageSlice")) game.settings.register(MODULE_ID, "conditionModalBorderImageSlice", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.conditionModalBorderImageSlice"),
		scope: "world",
		config: false,
		default: 12,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("conditionModalBorderImageOutset")) game.settings.register(MODULE_ID, "conditionModalBorderImageOutset", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.conditionModalBorderImageOutset"),
		scope: "world",
		config: false,
		default: 0,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("conditionModalBorderImageRepeat")) game.settings.register(MODULE_ID, "conditionModalBorderImageRepeat", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.conditionModalBorderImageRepeat"),
		scope: "world",
		config: false,
		default: "repeat",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("abilityModColor")) game.settings.register(MODULE_ID, "abilityModColor", {
		name: "Ability Modifier Color",
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("levelValueColor")) game.settings.register(MODULE_ID, "levelValueColor", {
		name: "Level Value Color",
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("acValueColor")) game.settings.register(MODULE_ID, "acValueColor", {
		name: "AC Value Color",
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("initModColor")) game.settings.register(MODULE_ID, "initModColor", {
		name: "Initiative Modifier Color",
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("luckValueColor")) game.settings.register(MODULE_ID, "luckValueColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.luckValueColor"),
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	// Extended Text Color Settings
	if (settingOwnerEnabled("navLinkColor")) game.settings.register(MODULE_ID, "navLinkColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.navLinkColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("navLinkActiveColor")) game.settings.register(MODULE_ID, "navLinkActiveColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.navLinkActiveColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("detailsRowColor")) game.settings.register(MODULE_ID, "detailsRowColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.detailsRowColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("borderBackgroundColor")) game.settings.register(MODULE_ID, "borderBackgroundColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.borderBackgroundColor"),
		scope: "world",
		config: false,
		default: "",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("sheetHeaderBackgroundColor")) game.settings.register(MODULE_ID, "sheetHeaderBackgroundColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.sheetHeaderBackgroundColor"),
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("luckContainerColor")) game.settings.register(MODULE_ID, "luckContainerColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.luckContainerColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("actorNameColor")) game.settings.register(MODULE_ID, "actorNameColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.actorNameColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("windowHeaderColor")) game.settings.register(MODULE_ID, "windowHeaderColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.windowHeaderColor"),
		scope: "world",
		config: false,
		default: "#000000ff",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("navBackgroundColor")) game.settings.register(MODULE_ID, "navBackgroundColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.navBackgroundColor"),
		scope: "world",
		config: false,
		default: "#000000ff",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("navBorderColor")) game.settings.register(MODULE_ID, "navBorderColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.navBorderColor"),
		scope: "world",
		config: false,
		default: "rgba(0, 0, 0, 0.5)",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("effectsTextColor")) game.settings.register(MODULE_ID, "effectsTextColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.effectsTextColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("talentsTextColor")) game.settings.register(MODULE_ID, "talentsTextColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.talentsTextColor"),
		scope: "world",
		config: false,
		default: "#ffffffff",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("xpRowColor")) game.settings.register(MODULE_ID, "xpRowColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.xpRowColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("windowTitleBarBackgroundColor")) game.settings.register(MODULE_ID, "windowTitleBarBackgroundColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.windowTitleBarBackgroundColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("statsLabelColor")) game.settings.register(MODULE_ID, "statsLabelColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.statsLabelColor"),
		scope: "world",
		config: false,
		default: "#ffffff",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("actorNameShadowColor")) game.settings.register(MODULE_ID, "actorNameShadowColor", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.actorNameShadowColor"),
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("actorNameShadowAlpha")) game.settings.register(MODULE_ID, "actorNameShadowAlpha", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.actorNameShadowAlpha"),
		scope: "world",
		config: false,
		default: 0.8,
		type: Number,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("actorNameFontWeight")) game.settings.register(MODULE_ID, "actorNameFontWeight", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.sheetEditor.actorNameFontWeight"),
		scope: "world",
		config: false,
		default: "bold",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	// Tab background gradient settings
	if (settingOwnerEnabled("tabGradientStart")) game.settings.register(MODULE_ID, "tabGradientStart", {
		name: "Tab Gradient Start Color",
		scope: "world",
		config: false,
		default: "#000000",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("tabGradientEnd")) game.settings.register(MODULE_ID, "tabGradientEnd", {
		name: "Tab Gradient End Color",
		scope: "world",
		config: false,
		default: "#2f2b2b",
		type: String,
		onChange: () => applySheetDecorationStyles(),
	});

	if (settingOwnerEnabled("enableJournalNotes")) game.settings.register(MODULE_ID, "enableJournalNotes", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_journal_notes.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_journal_notes.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});


	if (settingOwnerEnabled("enablePlaceableNotes")) game.settings.register(MODULE_ID, "enablePlaceableNotes", {
		name: "Enable Notes on placeables and Notes tab in tray",
		hint: "Adds a Notes button to configuration windows for Lights, Sounds, Tokens, Walls, and Tiles.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	if (settingOwnerEnabled("enableAddCoinsButton")) game.settings.register(MODULE_ID, "enableAddCoinsButton", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_add_coins_button.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_add_coins_button.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	if (settingOwnerEnabled("conditionsTheme")) game.settings.register(MODULE_ID, "conditionsTheme", {
		name: "Conditions theme",
		hint: "Choose a visual theme for the quick conditions toggles",
		scope: "world",
		config: true,
		default: "shadowdark",
		type: String,
		choices: {
			"shadowdark": "Shadowdark",
			"5e": "5e",
			"parchment": "Parchment (Default)",
			"stone": "Stone Tablet",
			"leather": "Leather Bound",
			"iron": "Iron & Rust",
			"moss": "Moss & Decay",
			"blood": "Blood & Shadow",
		},
		onChange: () => {
			if (!isFeatureEnabled(FEATURE_IDS.QUICK_CONDITIONS)) return;
			// Re-render all open player sheets
			const PlayerSheetClass = globalThis.shadowdark?.apps?.PlayerSheetSD;
			if (PlayerSheetClass) {
				Object.values(ui.windows)
					.filter(app => app instanceof PlayerSheetClass)
					.forEach(app => app.render());
			}
		},
	});

	// ═══════════════════════════════════════════════════════════════
	// 4. INVENTORY
	// ═══════════════════════════════════════════════════════════════

	if (settingOwnerEnabled("enableContainers")) game.settings.register(MODULE_ID, "enableContainers", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_containers.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_containers.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	if (settingOwnerEnabled("enableNestedContainers")) game.settings.register(MODULE_ID, "enableNestedContainers", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_nested_containers.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_nested_containers.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});

	if (settingOwnerEnabled("enableTrading")) game.settings.register(MODULE_ID, "enableTrading", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_trading.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_trading.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	if (settingOwnerEnabled("enableMultiselect")) game.settings.register(MODULE_ID, "enableMultiselect", {
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

	if (settingOwnerEnabled("enableCarousing")) game.settings.register(MODULE_ID, "enableCarousing", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_carousing.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_carousing.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	if (settingOwnerEnabled("carousingMode")) game.settings.register(MODULE_ID, "carousingMode", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_mode.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_mode.hint"),
		scope: "world",
		config: true,
		default: "original",
		type: String,
		choices: {
			original: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_mode.original"),
			expanded: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_mode.expanded"),
		},
		onChange: () => {
			if (!isFeatureEnabled(FEATURE_IDS.CAROUSING)) return;
			// Re-render all open player sheets to update carousing tab
			Object.values(ui.windows).forEach(app => {
				if (app.actor?.type === "Player") app.render();
			});
		},
	});

	// Carousing - Show benefit descriptions to players
	if (settingOwnerEnabled("carousingShowBenefitsToPlayers")) game.settings.register(MODULE_ID, "carousingShowBenefitsToPlayers", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_show_benefits.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_show_benefits.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});

	// Carousing - Show mishap descriptions to players
	if (settingOwnerEnabled("carousingShowMishapsToPlayers")) game.settings.register(MODULE_ID, "carousingShowMishapsToPlayers", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_show_mishaps.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_show_mishaps.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});

	// Carousing - What "N% of your total wealth" is measured against when the GM
	// applies an outcome. The deduction always comes out of coins; "coinsAndGear"
	// only widens the base so stockpiling gear can't dodge the penalty.
	if (settingOwnerEnabled("carousingWealthBase")) game.settings.register(MODULE_ID, "carousingWealthBase", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_wealth_base.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_wealth_base.hint"),
		scope: "world",
		config: true,
		default: "coins",
		type: String,
		choices: {
			coins: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_wealth_base.coins"),
			coinsAndGear: game.i18n.localize("SHADOWDARK_EXTRAS.settings.carousing_wealth_base.coins_and_gear"),
		},
	});

	// Carousing Tables Editor Menu Button
	// Opens a single editor that hosts both modes via an in-window Original/Expanded
	// switch. It opens on the mode currently selected in the Carousing Mode setting.
	if (settingOwnerEnabled("carousingTablesMenu")) game.settings.registerMenu(MODULE_ID, "carousingTablesMenu", {
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
		restricted: true,
	});

	// Expanded Carousing Data Storage (hidden setting)
	if (settingOwnerEnabled("expandedCarousingData")) game.settings.register(MODULE_ID, "expandedCarousingData", {
		name: "Expanded Carousing Data",
		scope: "world",
		config: false,
		default: null,
		type: Object,
	});

	// ═══════════════════════════════════════════════════════════════
	// 6. NPC FEATURES
	// ═══════════════════════════════════════════════════════════════

	if (settingOwnerEnabled("enableNpcInventory")) game.settings.register(MODULE_ID, "enableNpcInventory", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_npc_inventory.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_npc_inventory.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	if (settingOwnerEnabled("enableNpcCreatureType")) game.settings.register(MODULE_ID, "enableNpcCreatureType", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_npc_creature_type.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_npc_creature_type.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: false,
	});

	// Custom creature types storage
	if (settingOwnerEnabled("customCreatureTypes")) game.settings.register(MODULE_ID, "customCreatureTypes", {
		scope: "world",
		config: false,
		default: [],
		type: Array,
	});

	// Menu button to open creature types editor
	if (settingOwnerEnabled("manageCreatureTypes")) game.settings.registerMenu(MODULE_ID, "manageCreatureTypes", {
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

	if (settingOwnerEnabled("enableTorchAnimations")) game.settings.register(MODULE_ID, "enableTorchAnimations", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_torch_animations.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_torch_animations.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	if (settingOwnerEnabled("enableWeaponAnimations")) game.settings.register(MODULE_ID, "enableWeaponAnimations", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_weapon_animations.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_weapon_animations.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});

	if (settingOwnerEnabled("enableLevelUpAnimation")) game.settings.register(MODULE_ID, "enableLevelUpAnimation", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_level_up_animation.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.enable_level_up_animation.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true,
	});
	if (settingOwnerEnabled("pixelPerfectPins")) game.settings.register(MODULE_ID, "pixelPerfectPins", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.pixel_perfect_pins.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.pixel_perfect_pins.hint"),
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
		requiresReload: false,
		onChange: () => {
			if (!isFeatureEnabled(FEATURE_IDS.JOURNAL_PINS)) return;
			if (canvas?.scene && window.JournalPinRenderer) {
				const pins = window.JournalPinManager?.list({ sceneId: canvas.scene.id }) || [];
				window.JournalPinRenderer.loadScenePins(canvas.scene.id, pins);
			}
		},
	});

	if (settingOwnerEnabled("pixelPerfectPinsAlpha")) game.settings.register(MODULE_ID, "pixelPerfectPinsAlpha", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.pixel_perfect_pins_alpha.name"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.pixel_perfect_pins_alpha.hint"),
		scope: "world",
		config: true,
		default: 100,
		type: Number,
		range: {
			min: 0,
			max: 255,
			step: 1,
		},
		requiresReload: false,
		onChange: () => {
			if (!isFeatureEnabled(FEATURE_IDS.JOURNAL_PINS)) return;
			if (canvas?.scene && window.JournalPinRenderer) {
				const pins = window.JournalPinManager?.list({ sceneId: canvas.scene.id }) || [];
				window.JournalPinRenderer.loadScenePins(canvas.scene.id, pins);
			}
		},
	});
	// ═══════════════════════════════════════════════════════════════
	// 9. EASY REFERENCE MENU
	// ═══════════════════════════════════════════════════════════════

	// Easy Reference ProseMirror menu settings
	if (settingOwnerEnabled("easyRef_showNpcCards")) registerEasyReferenceSettings();

	// 10. TOKEN TOOLBAR
	// ═══════════════════════════════════════════════════════════════

	// Token Toolbar settings
	if (settingOwnerEnabled("tokenToolbar.enabled")) registerTokenToolbarSettings();

	// Character Tray settings
	if (anyFeatureEnabled(
		...SETTING_OWNERS["tray.enabled"],
		...SETTING_OWNERS["tray.showPartyTab"],
		...SETTING_OWNERS["hexFog.defaultRevealRadius"],
		...SETTING_OWNERS["hexPainter.customTileWidth"],
		...SETTING_OWNERS["settlement.useLocalMaphub"]
	)) registerTraySettings();

	// 11. PIN STYLE EDITOR
	// ═══════════════════════════════════════════════════════════════

	// Pin Style Editor settings
	if (settingOwnerEnabled("pinStyleDefaults")) registerPinStyleSettings();

	// 11b. SDX COORDS
	// ═══════════════════════════════════════════════════════════════
	if (settingOwnerEnabled("sdxCoordsSettings")) {
		registerSDXCoordsSettings();
		registerSDXCoordsMenu(SDXCoordsSettingsApp);
	}

	if (settingOwnerEnabled("drawing.enablePlayerDrawing")) registerDrawingSettings();
}
