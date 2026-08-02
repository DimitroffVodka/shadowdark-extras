import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * Setup the renderSettingsConfig hook to organize settings with section headers.
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
export function setupSettingsOrganization() {
	Hooks.on("renderSettingsConfig", (app, html, data) => {
		// In Foundry v13, html may be a native HTMLElement instead of jQuery
		const $html = html instanceof jQuery ? html : $(html);

		// Only process if we're looking at our module's settings section
		const sdxSection = $html.find(`[data-category="${MODULE_ID}"]`);
		if (sdxSection.length === 0) return;

		// Helper function to create a group header
		const createHeader = (text, icon = null) => {
			const iconHtml = icon ? `<i class="${icon}"></i> ` : "";
			return $("<div>").addClass("form-group group-header sdx-settings-header").html(`${iconHtml}${text}`);
		};

		// Helper to insert header before first found element
		const insertHeaderBefore = (selector, headerText, headerIcon) => {
			const element = sdxSection.find(selector);
			if (element.length) {
				const formGroup = element.closest(".form-group");
				if (formGroup.length && !formGroup.prev().hasClass("sdx-settings-header")) {
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
