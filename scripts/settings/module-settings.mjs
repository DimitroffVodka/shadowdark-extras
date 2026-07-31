/**
 * Module settings registration.
 *
 * The single largest unit of the Phase 3 structural track: 108
 * `game.settings.register` calls and 17 `registerMenu` calls lifted verbatim
 * out of the composition root, where they had grown to a third of the file.
 *
 * WHY A NEW FOLDER RATHER THAN AN EXISTING FEATURE. Every other Phase 3 move
 * extended a module that already owned the feature, per handoff rule 3. This
 * one cannot: the keys registered here span inventory, combat, character
 * sheets, carousing, NPCs, hex, dungeon, tray and canvas, so no feature has a
 * claim on it and `shared/` is for compatibility helpers that earn their place
 * at a second consumer. Cross-cutting world configuration is its own concern,
 * and `settings/` is where a stranger would look for it.
 *
 * WHY THIS MOVED ALONE, IN ITS OWN COMMIT. Settings keys and menu ids are
 * stored in every GM's world. A rename does not throw — the stored value is
 * orphaned and the setting silently reverts to its default, so the damage is
 * to saved user data rather than to a render, and it surfaces weeks later as
 * "my config keeps resetting". The settings-key snapshot is the gate that
 * catches it, and it only reads as a proof of THIS move if this move is the
 * only thing in the commit.
 *
 * The body below is the source range verbatim. Exactly two edits were applied
 * on top of the carry, both forced by the change of directory:
 *
 *   1. `function registerSettings` gained `export`.
 *   2. The dynamic `import("./dungeon/DDPackSettingsAppSD.mjs")` inside the
 *      Dungeondraft packs menu stub became `"../dungeon/…"`. It is the only
 *      path-dependent string in the whole range, and it is exactly the shape
 *      the import resolver exists to catch — a literal dynamic import that a
 *      move silently breaks, with no error until a GM opens that menu.
 *
 * `MODULE_ID` is imported from `shared/module-id.mjs` rather than carried as a
 * local const. The composition root declares its own copy; both are the string
 * "shadowdark-extras", so the 108 keys this file writes are unchanged, which
 * the settings-key snapshot proves rather than assumes.
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
import { applySheetDecorationStyles } from "../character-sheet/sheet-decoration.mjs";
import { openCarousingTablesEditor } from "../party/carousing/CarousingTablesApp.mjs";
import { openExpandedCarousingTablesEditor } from "../party/carousing/ExpandedCarousingTablesApp.mjs";
import SheetEditorConfig from "../character-sheet/SheetEditorConfig.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";

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
				const { DDPackSettingsApp } = await import("../dungeon/DDPackSettingsAppSD.mjs");
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
