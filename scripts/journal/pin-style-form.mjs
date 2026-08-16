// Pin style form reading and saving — extracted from
// scripts/journal/PinStyleEditorSD.mjs (Phase 5.3 split). Prototype mixin:
// _getFormData, the fifty-field table of selectors, coercions and defaults that
// turns the dialog back into a style, and _onSave, which writes it to a single
// pin or to the world default.
//
// readNumber lives here rather than in shared/ because both its consumers are
// this feature: _getFormData below, and _updatePreview in pin-style-preview.
//
// Merged via Object.assign(PinStyleEditorApp.prototype, PinStyleForm).

import {
	JournalPinManager, JournalPinRenderer, getPinStyle, isMediaPinShape,
} from "./JournalPinsSD.mjs";

const MODULE_ID = "shadowdark-extras";

/**
 * Read a number that may be missing, blank or unparseable.
 *
 * parseFloat returns NaN in all three cases, and `??` only substitutes for
 * null and undefined — so `parseFloat(x) ?? fallback` never falls back, and
 * the NaN travels into the saved style. Every opacity in this file goes
 * through here instead.
 */
export function readNumber(value, fallback) {
	const parsed = parseFloat(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

export const PinStyleForm = {
	_getFormData() {
		const html = this.element;
		const form = html?.querySelector("form");
		if (!form) {
			if (this.pinId) {
				const pin = JournalPinManager.get(this.pinId);
				return { ...getPinStyle(), ...(pin?.style || {}) };
			}
			return getPinStyle();
		}

		const formData = {
			size: parseInt(form.querySelector('[name="size"]')?.value) || 32,
			fitToHexGrid: form.querySelector('[name="fitToHexGrid"]')?.checked || false,
			tooltipTitleFontSize: parseInt(form.querySelector('[name="tooltipTitleFontSize"]')?.value) || 17,
			tooltipContentFontSize: parseInt(form.querySelector('[name="tooltipContentFontSize"]')?.value) || 13,
			shape: form.querySelector('[name="shape"]')?.value || "circle",
			iconShapePath: form.querySelector('[name="iconShapePath"]')?.value || "",
			iconShapeTint: form.querySelector('[name="iconShapeTint"]')?.value || "",
			imagePath: form.querySelector('[name="imagePath"]')?.value || "",
			imageTint: form.querySelector('[name="imageTint"]')?.value || "",
			// Highlight color — single swatch drives both tint and border color
			hoverImageTint: (() => {
				const v = form.querySelector('[name="hoverImageTint"]')?.value;
				if (v) return v;
				// No input (form not rendered yet) — keep existing value or fall back to global highlight tint
				const existing = this.pinId ? (form.querySelector('[name="hoverImageTint"]') ? null : null) : null;
				return (foundry.utils.deepClone(getPinStyle()).hoverImageTint || "#ff7a00");
			})(),
			hoverRingColor: (() => {
				const v = form.querySelector('[name="hoverImageTint"]')?.value;
				if (v) return v;
				return (foundry.utils.deepClone(getPinStyle()).hoverRingColor || "#ff7a00");
			})(),
			hoverRingWidth: form.querySelector('[name="hoverRingWidth"]') ? (parseInt(form.querySelector('[name="hoverRingWidth"]')?.value) || 0) : 6,
			hoverAnimation: form.querySelector('[name="hoverAnimation"]')?.value || "none",
			pingAnimation: form.querySelector('[name="pingAnimation"]')?.value || "ripple",
			bringAnimation: form.querySelector('[name="bringAnimation"]')?.value || "ripple",
			ringColor: form.querySelector('[name="ringColor"]')?.value || "#ffffff",
			fillColor: form.querySelector('[name="fillColor"]')?.value || "#000000",
			ringWidth: parseInt(form.querySelector('[name="ringWidth"]')?.value) || 3,
			ringStyle: form.querySelector('[name="ringStyle"]')?.value || "solid",

			// Get opacity based on shape (handle duplicate inputs)
			opacity: (() => {
				const shape = form.querySelector('[name="shape"]')?.value;
				if (isMediaPinShape(shape)) {
					return readNumber(form.querySelector('.image-opacity-option [name="opacity"]')?.value, 1.0);
				}
				else {
					return readNumber(form.querySelector('.standard-style-options [name="opacity"]')?.value, 1.0);
				}
			})(),

			fillOpacity: readNumber(form.querySelector('[name="fillOpacity"]')?.value, 1.0),
			ringOpacity: readNumber(form.querySelector('[name="ringOpacity"]')?.value, 1.0),
			contentType: form.querySelector('[name="contentType"]')?.value || "number",
			customText: form.querySelector('[name="customText"]')?.value || "",
			// Symbol (FontAwesome icons)
			symbolClass: form.querySelector('[name="symbolClass"]')?.value || form.querySelector('[name="iconClass"]')?.value || "fa-solid fa-book-open",
			symbolColor: form.querySelector('[name="symbolColor"]')?.value || "#ffffff",
			// Custom Icon (SVG from assets)
			customIconPath: form.querySelector('[name="customIconPath"]')?.value || "",
			iconColor: form.querySelector('[name="iconColor"]')?.value || "#ffffff",
			// Legacy support
			iconClass: form.querySelector('[name="symbolClass"]')?.value || form.querySelector('[name="iconClass"]')?.value || "fa-solid fa-book-open",
			fontSize: parseInt(form.querySelector('[name="fontSize"]')?.value) || 14,
			fontFamily: form.querySelector('[name="fontFamily"]')?.value || "Arial",
			fontColor: form.querySelector('[name="fontColor"]')?.value || "#ffffff",
			fontStroke: form.querySelector('[name="fontStroke"]')?.value || "#000000",
			fontStrokeThickness: parseInt(form.querySelector('[name="fontStrokeThickness"]')?.value) || 0,
			fontWeight: form.querySelector('[name="fontWeight"]')?.checked ? "bold" : "normal",
			fontItalic: form.querySelector('[name="fontItalic"]')?.checked || false,
			borderRadius: parseInt(form.querySelector('[name="borderRadius"]')?.value) || 4,
			// Label Settings
			labelText: form.querySelector('[name="labelText"]')?.value || "",
			labelShowOnHover: form.querySelector('[name="labelShowOnHover"]')?.checked || false,
			labelFontFamily: form.querySelector('[name="labelFontFamily"]')?.value || "Arial",
			labelFontSize: parseInt(form.querySelector('[name="labelFontSize"]')?.value) || 16,
			labelColor: form.querySelector('[name="labelColor"]')?.value || "#ffffff",
			labelStroke: form.querySelector('[name="labelStroke"]')?.value || "#000000",
			labelStrokeThickness: parseInt(form.querySelector('[name="labelStrokeThickness"]')?.value) || 0,
			labelBold: form.querySelector('[name="labelBold"]')?.checked || false,
			labelItalic: form.querySelector('[name="labelItalic"]')?.checked || false,
			labelBackground: form.querySelector('[name="labelBackground"]')?.value || "none",
			labelBackgroundColor: form.querySelector('[name="labelBackgroundColor"]')?.value || "#000000",
			labelBorderColor: form.querySelector('[name="labelBorderColor"]')?.value || "#ffffff",
			labelBorderWidth: parseInt(form.querySelector('[name="labelBorderWidth"]')?.value) || 0,
			labelBorderRadius: parseInt(form.querySelector('[name="labelBorderRadius"]')?.value) || 4,
			labelBorderImagePath: form.querySelector('[name="labelBorderImagePath"]')?.value || "",
			labelBorderSliceTop: parseInt(form.querySelector('[name="labelBorderSliceTop"]')?.value) || 15,
			labelBorderSliceRight: parseInt(form.querySelector('[name="labelBorderSliceRight"]')?.value) || 15,
			labelBorderSliceBottom: parseInt(form.querySelector('[name="labelBorderSliceBottom"]')?.value) || 15,
			labelBorderSliceLeft: parseInt(form.querySelector('[name="labelBorderSliceLeft"]')?.value) || 15,
			labelAnchor: form.querySelector('[name="labelAnchor"]')?.value || "bottom",
			labelOffset: parseInt(form.querySelector('[name="labelOffset"]')?.value) || 0,
		};

		// Handle conditional Background Color and Opacity inputs due to split UI
		if (formData.labelBackground === "image") {
			formData.labelBackgroundColor = form.querySelector('[name="labelImageBackgroundColor"]')?.value || "#000000";
			formData.labelBackgroundOpacity = readNumber(form.querySelector('[name="labelImageBackgroundOpacity"]')?.value, 0.8);
		}
		else {
			// Default/Solid inputs
			formData.labelBackgroundColor = form.querySelector('[name="labelBackgroundColor"]')?.value || "#000000";
			formData.labelBackgroundOpacity = readNumber(form.querySelector('[name="labelBackgroundOpacity"]')?.value, 0.8);
		}

		// Add pageId if editing individual pin
		if (this.pinId) {
			const pageIdSelect = form.querySelector('[name="pageId"]');
			if (pageIdSelect) {
				formData.pageId = pageIdSelect.value || null;
			}

			const requiresVisionCheckbox = form.querySelector('[name="requiresVision"]');
			if (requiresVisionCheckbox) {
				formData.requiresVision = requiresVisionCheckbox.checked;
			}

			const aboveFogCheckbox = form.querySelector('[name="aboveFog"]');
			if (aboveFogCheckbox) {
				formData.aboveFog = aboveFogCheckbox.checked;
			}

			const journalIdSelect = form.querySelector('[name="journalId"]');
			if (journalIdSelect) {
				formData.journalId = journalIdSelect.value || null;
			}

			const tooltipTitleInput = form.querySelector('[name="tooltipTitle"]');
			if (tooltipTitleInput) {
				formData.tooltipTitle = tooltipTitleInput.value || "";
			}

			const tooltipContentInput = form.querySelector('[name="tooltipContent"]');
			if (tooltipContentInput) {
				formData.tooltipContent = tooltipContentInput.value || "";
			}

			const nameSourceSelect = form.querySelector('[name="nameSource"]');
			if (nameSourceSelect) {
				formData.nameSource = nameSourceSelect.value || "auto";
			}

			const hideTooltipCheckbox = form.querySelector('[name="hideTooltip"]');
			if (hideTooltipCheckbox) {
				formData.hideTooltip = hideTooltipCheckbox.checked;
			}
		}

		return formData;
	},

	async _onSave() {
		this._isSaved = true;
		const style = this._getFormData();
		const pinId = this.pinId;

		// Close window IMMEDIATELY to feel snappy
		this.close({ animate: false });

		// Run the update in the background
		try {
			if (pinId) {
				// Save to individual pin
				const updateData = { style };

				// Include pageId and requiresVision if they were changed
				if (style.pageId !== undefined) {
					updateData.pageId = style.pageId;
					delete style.pageId;
				}

				if (style.requiresVision !== undefined) {
					updateData.requiresVision = style.requiresVision;
					delete style.requiresVision;
				}

				if (style.aboveFog !== undefined) {
					updateData.aboveFog = style.aboveFog;
					delete style.aboveFog;
				}

				if (style.journalId !== undefined) {
					updateData.journalId = style.journalId || null;
					delete style.journalId;
				}

				if (style.tooltipTitle !== undefined) {
					updateData.tooltipTitle = style.tooltipTitle;
					delete style.tooltipTitle;
				}

				if (style.tooltipContent !== undefined) {
					updateData.tooltipContent = style.tooltipContent;
					delete style.tooltipContent;
				}

				if (style.nameSource !== undefined) {
					updateData.nameSource = style.nameSource;
					delete style.nameSource;
				}

				if (style.hideTooltip !== undefined) {
					updateData.hideTooltip = style.hideTooltip;
					delete style.hideTooltip;
				}

				await JournalPinManager.update(pinId, updateData);
				ui.notifications.info(game.i18n.localize("SDX.pinStyleEditor.savedIndividual"));
			}
			else {
				// Save to global defaults
				await game.settings.set(MODULE_ID, "pinStyleDefaults", style);
				ui.notifications.info(game.i18n.localize("SDX.pinStyleEditor.saved"));

				// Refresh all pins on the current scene (only for global save)
				if (canvas?.scene) {
					const pins = JournalPinManager.list({ sceneId: canvas.scene.id });
					JournalPinRenderer.loadScenePins(canvas.scene.id, pins);
				}
			}
		}
		catch(err) {
			console.error("SDX | Error saving pin style:", err);
			ui.notifications.error("Error saving pin style settings.");
		}
	},
};
