// Pin style + shared constants — extracted from scripts/journal/JournalPinsSD.mjs
// (Phase 5.1 split). Leaf module: no imports.

export const MODULE_ID = "shadowdark-extras";
export const FLAG_KEY = "journalPins";
export const FOLDER_FLAG_KEY = "pinFolders";
export const LAYER_NAME = "sdx-journal-pins-layer";

export const PIN_SCHEMA_VERSION = 1;

export const DEFAULT_PIN_STYLE = {
	size: 32,
	// when true, size the pin to the active scene's grid hex so it covers the tile
	fitToHexGrid: false,
	shape: "circle",
	ringColor: "#ffffff",
	fillColor: "#000000",
	ringWidth: 3,
	ringStyle: "solid",
	opacity: 1.0,
	fillOpacity: 1.0,
	ringOpacity: 1.0,
	hoverAnimation: "highlight", // "none", "scale", "pulse", "shake", "brightness", "hue", "highlight" — highlight = tint+border (default)
	pingAnimation: "ripple", // "ripple", "rotate", "shake", "none"
	bringAnimation: "ripple", // "ripple", "rotate", "shake", "none"
	imagePath: "", // Path to image for "image" shape
	imageTint: "", // Optional multiply tint for "image" shape (e.g. from a map note)
	hoverImageTint: "#ff7a00", // Highlight tint (used when hoverAnimation is "highlight")
	hoverRingColor: "#ff7a00", // Highlight border color (used when hoverAnimation is "highlight")
	hoverRingWidth: 6,  // Ring width while hovered (0 = no hover ring)
	contentType: "number", // "number", "icon", "text", "customIcon", "none"
	iconClass: "fa-solid fa-book-open",
	iconColor: "#ffffff",
	symbolColor: "#ffffff",
	customIconPath: "",
	customText: "",
	fontSize: 14,
	fontFamily: "Arial",
	fontColor: "#ffffff",
	fontWeight: "bold",
	fontItalic: false,
	fontStroke: "#000000",
	fontStrokeThickness: 0,
	// Label settings
	labelText: "",
	labelShowOnHover: true,
	labelFontFamily: "Arial",
	labelFontSize: 16,
	labelColor: "#ffffff",
	labelStroke: "#000000",
	labelStrokeThickness: 4,
	labelBackground: "none", // "none", "solid", "playerSheet"
	labelBackgroundColor: "#000000",
	labelBackgroundOpacity: 0.8,
	labelBorderColor: "#ffffff",
	labelBorderWidth: 2,
	labelBorderRadius: 4,
	labelBold: false,
	labelItalic: false,
	labelBorderImagePath: "", // Custom path for border image
	labelBorderSliceTop: 54,
	labelBorderSliceRight: 54,
	labelBorderSliceBottom: 54,
	labelBorderSliceLeft: 54,
	labelAnchor: "bottom", // "top", "bottom", "left", "right", "center"
	labelOffset: 5,
	// Hover tooltip popup text sizes (px)
	tooltipTitleFontSize: 17,
	tooltipContentFontSize: 13,
	hideTooltip: false,
};

/**
 * Normalize a pin image tint (hex string, number, or Color) to a Color.
 * Returns null for missing/invalid values and for white, which is the
 * multiply-tint no-op. Callers use Number(color) for PIXI and color.css
 * for HTML.
 */
export function normalizeImageTint(value) {
	if (!value) return null;
	const color = foundry.utils.Color.from(value);
	return (color.valid && Number(color) !== 0xFFFFFF) ? color : null;
}

/**
 * Get the current pin style settings
 */
export function getPinStyle() {
	try {
		const stored = game.settings.get(MODULE_ID, "pinStyleDefaults") || {};
		return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_PIN_STYLE), stored);
	}
	catch(e) {
		return foundry.utils.deepClone(DEFAULT_PIN_STYLE);
	}
}
