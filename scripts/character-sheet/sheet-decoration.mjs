/**
 * Sheet decoration styles.
 *
 * Moved verbatim out of the composition root. Builds and injects the CSS that
 * skins the character sheets from the module's appearance settings.
 *
 * Not banner-led in the root — it sat between the light templates and
 * registerSettings with only a JSDoc to mark it, which is why it never showed
 * up as a section in any of the boundary scans.
 *
 * `hexToRgba` stays private: it has no callers outside this file.
 * `applySheetDecorationStyles` is exported because the root calls it from ~50
 * places — almost all of them `onChange` handlers inside registerSettings,
 * which re-apply the styles whenever an appearance setting changes.
 *
 * Zero registrations, so the registration snapshot is untouched.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * Convert hex color and alpha to rgba string
 * @param {string} hex - Hex color string
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} - rgba string
 */
function hexToRgba(hex, alpha) {
	if (!hex) return `rgba(0, 0, 0, ${alpha})`;

	// Handle rgba strings if already present
	if (hex.startsWith("rgba")) return hex;

	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);

	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Apply sheet decoration styles dynamically based on settings
 * Injects CSS custom properties for border and panel images
 */
export function applySheetDecorationStyles() {
	// Remove existing style if any
	const existingStyle = document.getElementById("sdx-decoration-styles");
	if (existingStyle) existingStyle.remove();

	// Get settings - with fallback defaults for when settings aren't registered yet
	let sheetBorder; let abilityPanel; let acPanel; let statPanel;
	let borderImageWidth; let borderImageSlice; let borderTransparencyWidth;
	let borderImageOutset; let borderImageRepeat; let borderBackgroundColor;
	let sheetHeaderBackgroundColor;
	let boxBorder; let boxBorderImageWidth; let boxBorderImageSlice; let boxBorderTransparencyWidth;
	let journalBorder; let journalBorderImageWidth; let journalBorderImageSlice; let journalBorderImageOutset; let journalBorderImageRepeat;
	let conditionModalBorder; let conditionModalBorderImageWidth; let conditionModalBorderImageSlice; let conditionModalBorderImageOutset; let conditionModalBorderImageRepeat;
	let abilityModColor; let levelValueColor; let acValueColor; let initModColor; let luckValueColor;
	let navLinkColor; let navLinkActiveColor; let detailsRowColor; let luckContainerColor; let actorNameColor; let windowHeaderColor;
	let navBackgroundColor; let navBorderColor; let effectsTextColor; let talentsTextColor; let xpRowColor; let windowTitleBarBackgroundColor; let statsLabelColor;
	let actorNameShadowColor; let actorNameShadowAlpha; let actorNameFontWeight;
	let tabGradientStart; let tabGradientEnd;
	try {
		sheetBorder = game.settings.get(MODULE_ID, "sheetBorderStyle") || "panel-border-004.webp";
		abilityPanel = game.settings.get(MODULE_ID, "abilityPanelStyle") || "panel-013.webp";
		acPanel = game.settings.get(MODULE_ID, "acPanelStyle") || "panel-transparent-center-004.webp";
		statPanel = game.settings.get(MODULE_ID, "statPanelStyle") || "panel-transparent-center-015.webp";
		borderImageWidth = game.settings.get(MODULE_ID, "borderImageWidth") ?? 16;
		borderImageSlice = game.settings.get(MODULE_ID, "borderImageSlice") ?? 12;
		borderImageOutset = game.settings.get(MODULE_ID, "borderImageOutset") ?? 0;
		borderImageRepeat = game.settings.get(MODULE_ID, "borderImageRepeat") || "stretch";
		borderImageRepeat = game.settings.get(MODULE_ID, "borderImageRepeat") || "stretch";
		borderBackgroundColor = game.settings.get(MODULE_ID, "borderBackgroundColor") || "";
		sheetHeaderBackgroundColor = game.settings.get(MODULE_ID, "sheetHeaderBackgroundColor") || "";
		borderTransparencyWidth = game.settings.get(MODULE_ID, "borderWidth") ?? 10;
		boxBorder = game.settings.get(MODULE_ID, "sdBoxBorderStyle") || "panel-border-001.webp";
		boxBorderImageWidth = game.settings.get(MODULE_ID, "sdBoxBorderWidth") ?? 16;
		boxBorderImageSlice = game.settings.get(MODULE_ID, "sdBoxBorderSlice") ?? 12;
		boxBorderTransparencyWidth = game.settings.get(MODULE_ID, "sdBoxBorderTransparencyWidth") ?? 10;
		journalBorder = game.settings.get(MODULE_ID, "journalBorderStyle") || "panel-border-004.webp";
		journalBorderImageWidth = game.settings.get(MODULE_ID, "journalBorderImageWidth") ?? 16;
		journalBorderImageSlice = game.settings.get(MODULE_ID, "journalBorderImageSlice") ?? 12;
		journalBorderImageOutset = game.settings.get(MODULE_ID, "journalBorderImageOutset") ?? 0;
		journalBorderImageRepeat = game.settings.get(MODULE_ID, "journalBorderImageRepeat") || "repeat";
		conditionModalBorder = game.settings.get(MODULE_ID, "conditionModalBorderStyle") || "panel-border-004.webp";
		conditionModalBorderImageWidth = game.settings.get(MODULE_ID, "conditionModalBorderImageWidth") ?? 16;
		conditionModalBorderImageSlice = game.settings.get(MODULE_ID, "conditionModalBorderImageSlice") ?? 12;
		conditionModalBorderImageOutset = game.settings.get(MODULE_ID, "conditionModalBorderImageOutset") ?? 0;
		conditionModalBorderImageRepeat = game.settings.get(MODULE_ID, "conditionModalBorderImageRepeat") || "repeat";
		abilityModColor = game.settings.get(MODULE_ID, "abilityModColor") || "#000000";
		levelValueColor = game.settings.get(MODULE_ID, "levelValueColor") || "#000000";
		acValueColor = game.settings.get(MODULE_ID, "acValueColor") || "#000000";
		initModColor = game.settings.get(MODULE_ID, "initModColor") || "#000000";
		luckValueColor = game.settings.get(MODULE_ID, "luckValueColor") || "#000000";
		navLinkColor = game.settings.get(MODULE_ID, "navLinkColor") || "#ffffff";
		navLinkActiveColor = game.settings.get(MODULE_ID, "navLinkActiveColor") || "#ffffff";
		detailsRowColor = game.settings.get(MODULE_ID, "detailsRowColor") || "#ffffff";
		luckContainerColor = game.settings.get(MODULE_ID, "luckContainerColor") || "#ffffff";
		actorNameColor = game.settings.get(MODULE_ID, "actorNameColor") || "#ffffff";
		windowHeaderColor = game.settings.get(MODULE_ID, "windowHeaderColor") || "#0000000";
		navBackgroundColor = game.settings.get(MODULE_ID, "navBackgroundColor") || "#000000";
		navBorderColor = game.settings.get(MODULE_ID, "navBorderColor") || "rgba(0, 0, 0, 0.5)";
		effectsTextColor = game.settings.get(MODULE_ID, "effectsTextColor") || "#ffffff";
		talentsTextColor = game.settings.get(MODULE_ID, "talentsTextColor") || "#ffffff";
		xpRowColor = game.settings.get(MODULE_ID, "xpRowColor") || "#ffffff";
		windowTitleBarBackgroundColor = game.settings.get(MODULE_ID, "windowTitleBarBackgroundColor") || "#ffffff";
		statsLabelColor = game.settings.get(MODULE_ID, "statsLabelColor") || "#ffffff";
		actorNameShadowColor = game.settings.get(MODULE_ID, "actorNameShadowColor") || "#000000";
		actorNameShadowAlpha = game.settings.get(MODULE_ID, "actorNameShadowAlpha") ?? 0.8;
		actorNameFontWeight = game.settings.get(MODULE_ID, "actorNameFontWeight") || "bold";
		tabGradientStart = game.settings.get(MODULE_ID, "tabGradientStart") || "#000000";
		tabGradientEnd = game.settings.get(MODULE_ID, "tabGradientEnd") || "#2f2b2b";
	}
	catch {
		// Settings not registered yet, use defaults
		sheetBorder = "panel-border-004.webp";
		abilityPanel = "panel-013.webp";
		acPanel = "panel-transparent-center-004.webp";
		statPanel = "panel-transparent-center-015.webp";
		borderImageWidth = 16;
		borderImageSlice = 12;
		borderImageOutset = 0;
		borderImageRepeat = "stretch";
		borderImageRepeat = "stretch";
		borderBackgroundColor = "";
		sheetHeaderBackgroundColor = "#000000ff";
		borderTransparencyWidth = 10;
		boxBorder = "panel-border-001.webp";
		boxBorderImageWidth = 16;
		boxBorderImageSlice = 12;
		boxBorderTransparencyWidth = 10;
		journalBorder = "panel-border-004.webp";
		journalBorderImageWidth = 16;
		journalBorderImageSlice = 12;
		journalBorderImageOutset = 0;
		journalBorderImageRepeat = "repeat";
		conditionModalBorder = "panel-border-004.webp";
		conditionModalBorderImageWidth = 16;
		conditionModalBorderImageSlice = 12;
		conditionModalBorderImageOutset = 0;
		conditionModalBorderImageRepeat = "repeat";
		abilityModColor = "#000000";
		levelValueColor = "#000000";
		acValueColor = "#000000";
		initModColor = "#000000";
		luckValueColor = "#000000";
		navLinkColor = "#ffffff";
		navLinkActiveColor = "#ffffff";
		detailsRowColor = "#ffffff";
		luckContainerColor = "#ffffff";
		actorNameColor = "#ffffff";
		windowHeaderColor = "#ffffff";
		navBackgroundColor = "#000000ff";
		navBorderColor = "rgba(0, 0, 0, 0.5)";
		effectsTextColor = "#ffffff";
		talentsTextColor = "#000000";
		xpRowColor = "#ffffff";
		windowTitleBarBackgroundColor = "#000000";
		statsLabelColor = "#ffffff";
		actorNameShadowColor = "#000000";
		actorNameShadowAlpha = 0.8;
		actorNameFontWeight = "bold";
		tabGradientStart = "#000000";
		tabGradientEnd = "#2f2b2b";
	}

	// Build paths via getRoute so they resolve under a Foundry route prefix AND
	// stay correct when consumed through a CSS variable. A url() carried in a
	// custom property is resolved by the browser relative to the stylesheet that
	// *references* the variable (styles/shadowdark-extras.css), so a bare relative
	// path like "modules/..." would double to "styles/modules/...". getRoute()
	// returns a root-absolute, prefix-aware path that resolves the same everywhere.
	const artBase = `modules/${MODULE_ID}/art/PNG/Default`;
	const borderPath = foundry.utils.getRoute(`${artBase}/Border/${sheetBorder}`);
	const abilityPanelPath = foundry.utils.getRoute(`${artBase}/Panel/${abilityPanel}`);
	const acPanelPath = foundry.utils.getRoute(`${artBase}/Transparent center/${acPanel}`);
	const statPanelPath = foundry.utils.getRoute(`${artBase}/Transparent center/${statPanel}`);
	const boxBorderPath = foundry.utils.getRoute(`${artBase}/Border/${boxBorder}`);
	const journalBorderPath = foundry.utils.getRoute(`${artBase}/Border/${journalBorder}`);
	const conditionModalBorderPath = foundry.utils.getRoute(`${artBase}/Border/${conditionModalBorder}`);

	// Create style element with CSS custom properties
	const style = document.createElement("style");
	style.id = "sdx-decoration-styles";
	style.textContent = `
		:root {
			--sdx-sheet-border: url('${borderPath}');
			--sdx-ability-panel: url('${abilityPanelPath}');
			--sdx-ac-panel: url('${acPanelPath}');
			--sdx-stat-panel: url('${statPanelPath}');
			--sdx-border-image-width: ${borderImageWidth}px;
			--sdx-border-image-slice: ${borderImageSlice};
			--sdx-border-image-outset: ${borderImageOutset}px;
			--sdx-border-image-repeat: ${borderImageRepeat};
			--sdx-border-image-repeat: ${borderImageRepeat};
			--sdx-border-background-color: ${borderBackgroundColor || "transparent"};
			--sdx-sheet-header-bg: ${sheetHeaderBackgroundColor || "transparent"};
			--sdx-border-width: ${borderTransparencyWidth}px;
			--sdx-box-border: url('${boxBorderPath}');
			--sdx-box-border-image-width: ${boxBorderImageWidth}px;
			--sdx-box-border-image-slice: ${boxBorderImageSlice};
			--sdx-box-border-width: ${boxBorderTransparencyWidth}px;
			--sdx-journal-border: url('${journalBorderPath}');
			--sdx-journal-border-image-width: ${journalBorderImageWidth}px;
			--sdx-journal-border-image-slice: ${journalBorderImageSlice};
			--sdx-journal-border-image-outset: ${journalBorderImageOutset}px;
			--sdx-journal-border-image-repeat: ${journalBorderImageRepeat};
			--sdx-condition-modal-border: url('${conditionModalBorderPath}');
			--sdx-condition-modal-border-image-width: ${conditionModalBorderImageWidth}px;
			--sdx-condition-modal-border-image-slice: ${conditionModalBorderImageSlice};
			--sdx-condition-modal-border-image-outset: ${conditionModalBorderImageOutset}px;
			--sdx-condition-modal-border-image-repeat: ${conditionModalBorderImageRepeat};
			--sdx-ability-mod-color: ${abilityModColor};
			--sdx-level-value-color: ${levelValueColor};
			--sdx-ac-value-color: ${acValueColor};
			--sdx-init-mod-color: ${initModColor};
			--sdx-luck-value-color: ${luckValueColor};
			--sdx-nav-link-color: ${navLinkColor};
			--sdx-nav-link-active-color: ${navLinkActiveColor};
			--sdx-details-row-color: ${detailsRowColor};
			--sdx-luck-container-color: ${luckContainerColor};
			--sdx-actor-name-color: ${actorNameColor};
			--sdx-window-header-color: ${windowHeaderColor};
			--sdx-nav-bg: ${navBackgroundColor};
			--sdx-nav-border-color: ${navBorderColor};
			--sdx-effects-text-color: ${effectsTextColor};
			--sdx-talents-text-color: ${talentsTextColor};
			--sdx-xp-row-color: ${xpRowColor};
			--sdx-window-title-bar-bg: ${windowTitleBarBackgroundColor};
			--sdx-stats-label-color: ${statsLabelColor};
			--sdx-tab-gradient-start: ${tabGradientStart};
			--sdx-tab-gradient-end: ${tabGradientEnd};
			--sdx-actor-name-shadow: 1px 1px 3px ${hexToRgba(actorNameShadowColor, actorNameShadowAlpha)};
			--sdx-actor-name-font-weight: ${actorNameFontWeight};
		}
	`;

	document.head.appendChild(style);

}
