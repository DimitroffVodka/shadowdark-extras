/**
 * The root's INVENTORY STYLES APP section, moved verbatim.
 *
 * The inventory styling settings app, its default style table, and the
 * function that applies the configured styles to a rendered sheet.
 *
 * Three exports because three names are used outside: the settings menu
 * registration further down the root names both `DEFAULT_INVENTORY_STYLES`
 * (as its default) and `InventoryStylesApp` (as its type), and the sheet
 * dispatch calls `applyInventoryStylesToSheet` from three places.
 *
 * inventory/ next to containers.mjs, whose `isContainerItem` this section
 * already used.
 *
 * Registration-free — no Hooks, libWrapper or socket call sites, and no
 * `game.settings.register` either; the menu that points at this app lives in
 * the root's settings block and is unchanged, so the settings snapshot is
 * untouched along with the registration one.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isPartyActor } from "../party/PartySheetSD.mjs";
import { isContainerItem } from "./containers.mjs";

// ============================================
// INVENTORY STYLES APP
// ============================================

/**
 * Default inventory style configuration
 */
export const DEFAULT_INVENTORY_STYLES = {
	enabled: false,
	categories: {
		magical: {
			enabled: true,
			label: "Magical Items",
			priority: 10, // Higher priority = applied first (can be overridden)
			backgroundColor: "#4a1a7a",
			useGradient: true,
			gradientEndColor: "transparent",
			textColor: "#e0b0ff",
			textShadow: "1px 1px 2px #000",
			borderLeft: "3px solid #9b59b6",
			descriptionTextColor: "",
			descriptionTextShadow: "",
		},
		unidentified: {
			enabled: true,
			label: "Unidentified Items",
			priority: 20,
			backgroundColor: "#5a3a1a",
			useGradient: true,
			gradientEndColor: "transparent",
			textColor: "#ffd700",
			textShadow: "1px 1px 2px #000",
			borderLeft: "3px solid #f39c12",
			descriptionTextColor: "",
			descriptionTextShadow: "",
		},
		container: {
			enabled: true,
			label: "Containers",
			priority: 5,
			backgroundColor: "#1a4a3a",
			useGradient: true,
			gradientEndColor: "transparent",
			textColor: "#98d8c8",
			textShadow: "1px 1px 2px #000",
			borderLeft: "3px solid #27ae60",
			descriptionTextColor: "",
			descriptionTextShadow: "",
		},
		Weapon: {
			enabled: false,
			label: "Weapons",
			priority: 1,
			backgroundColor: "#4a1a1a",
			useGradient: true,
			gradientEndColor: "transparent",
			textColor: "#ff9999",
			textShadow: "1px 1px 2px #000",
			borderLeft: "3px solid #c0392b",
			descriptionTextColor: "",
			descriptionTextShadow: "",
		},
		Armor: {
			enabled: false,
			label: "Armor",
			priority: 1,
			backgroundColor: "#1a3a5a",
			useGradient: true,
			gradientEndColor: "transparent",
			textColor: "#99ccff",
			textShadow: "1px 1px 2px #000",
			borderLeft: "3px solid #2980b9",
			descriptionTextColor: "",
			descriptionTextShadow: "",
		},
		Scroll: {
			enabled: false,
			label: "Scrolls",
			priority: 1,
			backgroundColor: "#5a4a1a",
			useGradient: true,
			gradientEndColor: "transparent",
			textColor: "#ffe4b5",
			textShadow: "1px 1px 2px #000",
			borderLeft: "3px solid #d4a574",
			descriptionTextColor: "",
			descriptionTextShadow: "",
		},
		Potion: {
			enabled: false,
			label: "Potions",
			priority: 1,
			backgroundColor: "#1a5a4a",
			useGradient: true,
			gradientEndColor: "transparent",
			textColor: "#98ff98",
			textShadow: "1px 1px 2px #000",
			borderLeft: "3px solid #2ecc71",
			descriptionTextColor: "",
			descriptionTextShadow: "",
		},
		Wand: {
			enabled: false,
			label: "Wands",
			priority: 1,
			backgroundColor: "#4a1a5a",
			useGradient: true,
			gradientEndColor: "transparent",
			textColor: "#dda0dd",
			textShadow: "1px 1px 2px #000",
			borderLeft: "3px solid #8e44ad",
			descriptionTextColor: "",
			descriptionTextShadow: "",
		},
		Basic: {
			enabled: false,
			label: "Basic Items",
			priority: 0,
			backgroundColor: "#3a3a3a",
			useGradient: true,
			gradientEndColor: "transparent",
			textColor: "#cccccc",
			textShadow: "1px 1px 2px #000",
			borderLeft: "3px solid #666666",
			descriptionTextColor: "",
			descriptionTextShadow: "",
		},
	},
};

/**
 * Application for editing inventory item styles
 */
export class InventoryStylesApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
	static _instance = null;

	static DEFAULT_OPTIONS = {
		id: "sdx-inventory-styles",
		classes: ["shadowdark", "shadowdark-extras", "inventory-styles-app"],
		tag: "form",
		window: {
			title: "SHADOWDARK_EXTRAS.inventory_styles.title",
			resizable: true,
		},
		position: {
			width: 900,
			height: 750,
		},
		form: {
			handler: InventoryStylesApp.formHandler,
			submitOnChange: true,
			closeOnSubmit: false,
		},
	};

	static PARTS = {
		form: {
			template: "modules/shadowdark-extras/templates/inventory-styles.hbs",
		},
	};

	static show() {
		if (!this._instance) {
			this._instance = new InventoryStylesApp();
		}
		this._instance.render({ force: true });
		return this._instance;
	}

	async _prepareContext(options) {
		// Get saved settings and merge with defaults to ensure all properties exist
		const savedStyles = game.settings.get(MODULE_ID, "inventoryStyles");
		const styles = foundry.utils.mergeObject(
			foundry.utils.deepClone(DEFAULT_INVENTORY_STYLES),
			savedStyles || {},
			{ inplace: false, recursive: true }
		);

		const containersEnabled = game.settings.get(MODULE_ID, "enableContainers");

		// Build category list with visibility flags
		const categories = Object.entries(styles.categories).map(([key, config]) => {
			// Hide container category if containers not enabled
			if (key === "container" && !containersEnabled) return null;
			// Hide unidentified category (SD 4.x handles identification natively)
			if (key === "unidentified") return null;

			// Convert "transparent" to a usable color picker value
			const gradientEndColorPicker = (!config.gradientEndColor || config.gradientEndColor === "transparent")
				? "#ffffff"
				: config.gradientEndColor;

			return {
				key,
				...config,
				gradientEndColorPicker,
				isSpecial: ["magical", "unidentified", "container"].includes(key),
			};
		}).filter(Boolean);

		// Sort by priority (descending) then by label
		categories.sort((a, b) => {
			if (b.priority !== a.priority) return b.priority - a.priority;
			return a.label.localeCompare(b.label);
		});

		return {
			enabled: styles.enabled,
			categories,
			MODULE_ID,
		};
	}

	_onRender(context, options) {
		const root = this.element;
		if (!root) return;
		// Pragmatic bridge: wrap with jQuery so the existing handler block keeps working.
		const html = $(root);

		// ---- Tab Navigation ----
		html.find(".sdx-tab").on("click", ev => {
			const $tab = $(ev.currentTarget);
			const categoryKey = $tab.data("category");

			// Update tab states
			html.find(".sdx-tab").removeClass("active");
			$tab.addClass("active");

			// Update panel states
			html.find(".sdx-panel").removeClass("active");
			html.find(`.sdx-panel[data-category="${categoryKey}"]`).addClass("active");
		});

		// ---- Color Pickers ----
		html.find('input[type="color"]').on("input", ev => {
			const input = ev.currentTarget;
			const fieldName = input.dataset.edit;
			if (fieldName) {
				const textInput = html.find(`input[type="text"][name="${fieldName}"]`);
				if (textInput.length) {
					textInput.val(input.value);
				}
			}
			this._updateLivePreview(html);
		});

		// Text input change for colors - sync back to color picker
		html.find(".sdx-color-text").on("input", ev => {
			const input = ev.currentTarget;
			const fieldName = input.name;
			const colorInput = html.find(`input[type="color"][data-edit="${fieldName}"]`);
			if (colorInput.length && this._isValidColor(input.value)) {
				colorInput.val(this._normalizeColor(input.value));
			}
			this._updateLivePreview(html);
		});

		// ---- Range Sliders ----
		html.find('input[type="range"]').on("input", ev => {
			const $input = $(ev.currentTarget);
			const $valueDisplay = $input.siblings(".sdx-range-value");
			const value = $input.val();

			// Update display value
			if ($input.hasClass("sdx-border-width")) {
				$valueDisplay.text(`${value}px`);
				this._updateBorderValue($input.closest(".sdx-border-builder"));
			}
			else if ($input.hasClass("sdx-shadow-x") || $input.hasClass("sdx-shadow-y") || $input.hasClass("sdx-shadow-blur")) {
				$valueDisplay.text(`${value}px`);
				this._updateShadowValue($input.closest(".sdx-shadow-popup"));
			}
			else if ($input.attr("name")?.includes("priority")) {
				$valueDisplay.text(value);
			}

			this._updateLivePreview(html);
		});

		// ---- Checkbox changes ----
		html.find('input[type="checkbox"]').on("change", ev => {
			const $checkbox = $(ev.currentTarget);
			const $panel = $checkbox.closest(".sdx-panel");

			// Update tab indicator when enabled state changes
			if ($checkbox.attr("name")?.includes(".enabled")) {
				const categoryKey = $panel.data("category");
				const $tab = html.find(`.sdx-tab[data-category="${categoryKey}"]`);
				const isEnabled = $checkbox.is(":checked");
				$tab.find(".sdx-tab-enabled").toggle(isEnabled);
			}

			this._updateLivePreview(html);
		});

		// ---- Shadow Builder Toggle ----
		html.find(".sdx-shadow-toggle").on("click", ev => {
			ev.preventDefault();
			const $btn = $(ev.currentTarget);
			const shadowType = $btn.data("target");
			const $section = $btn.closest(".sdx-control-section");
			const $popup = $section.find(`.sdx-shadow-popup[data-shadow-type="${shadowType}"]`);

			// Parse existing shadow value and populate controls
			const $valueInput = $section.find(`.sdx-shadow-value[data-shadow-type="${shadowType}"]`);
			const shadowValue = $valueInput.val() || "";
			this._parseShadowToControls($popup, shadowValue);

			$popup.slideToggle(200);
		});

		// ---- Shadow Control Updates ----
		html.find(".sdx-shadow-popup input").on("input", ev => {
			const $popup = $(ev.currentTarget).closest(".sdx-shadow-popup");
			this._updateShadowValue($popup);
			this._updateShadowPreview($popup);
			this._updateLivePreview(html);
		});

		// ---- Remove Shadow Button ----
		html.find(".sdx-shadow-remove").on("click", ev => {
			ev.preventDefault();
			const $popup = $(ev.currentTarget).closest(".sdx-shadow-popup");
			const shadowType = $popup.data("shadow-type");
			const $section = $popup.closest(".sdx-control-section");

			// Set shadow value to empty string (no shadow)
			$section.find(`.sdx-shadow-value[data-shadow-type="${shadowType}"]`).val("").trigger("change");

			// Reset preview
			$popup.find(".sdx-shadow-preview-text").css("text-shadow", "none");

			// Close the popup
			$popup.slideUp(200);

			// Update live preview
			this._updateLivePreview(html);
		});

		// ---- Border Builder Controls ----
		html.find(".sdx-border-builder input, .sdx-border-builder select").on("input change", ev => {
			const $builder = $(ev.currentTarget).closest(".sdx-border-builder");
			this._updateBorderValue($builder);
			this._updateLivePreview(html);
		});

		// ---- Initialize Border Controls from Values ----
		html.find(".sdx-border-builder").each((i, builder) => {
			this._parseBorderToControls($(builder));
		});

		// ---- Presets Panel Toggle ----
		html.find(".sdx-presets-btn").on("click", ev => {
			ev.preventDefault();
			html.find(".sdx-presets-panel").slideToggle(200);
		});

		// ---- Preset Selection ----
		html.find(".sdx-preset-card").on("click", async ev => {
			ev.preventDefault();
			const preset = $(ev.currentTarget).data("preset");
			await this._applyPreset(preset);
		});

		// ---- Export Theme ----
		html.find(".sdx-export-btn").on("click", async ev => {
			ev.preventDefault();
			await this._exportTheme();
		});

		// ---- Import Theme ----
		html.find(".sdx-import-btn").on("click", ev => {
			ev.preventDefault();
			this._importTheme();
		});

		// ---- Reset Button ----
		html.find(".sdx-reset-styles").on("click", async ev => {
			ev.preventDefault();
			const confirm = await foundry.applications.api.DialogV2.confirm({
				window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.inventory_styles.reset_confirm_title") },
				content: `<p>${game.i18n.localize("SHADOWDARK_EXTRAS.inventory_styles.reset_confirm_content")}</p>`,
				modal: true,
			});
			if (confirm) {
				await game.settings.set(MODULE_ID, "inventoryStyles", foundry.utils.deepClone(DEFAULT_INVENTORY_STYLES));
				applyInventoryStyles();
				this.render();
			}
		});

		// ---- Save Button - close after submit ----
		html.find('button[name="submit"]').on("click", () => {
			setTimeout(() => this.close(), 100);
		});

		// Initialize live previews
		this._updateLivePreview(html);
	}

	// ---- Helper Methods ----

	_isValidColor(color) {
		if (!color) return false;
		if (color === "transparent") return true;
		const s = new Option().style;
		s.color = color;
		return s.color !== "";
	}

	_normalizeColor(color) {
		if (!color || color === "transparent") return color;
		const ctx = document.createElement("canvas").getContext("2d");
		ctx.fillStyle = color;
		return ctx.fillStyle;
	}

	_parseShadowToControls($popup, shadowValue) {
		// Parse shadow string like "1px 2px 3px #000"
		const match = shadowValue.match(/(-?\d+)px\s+(-?\d+)px\s+(\d+)px\s+(#[0-9a-fA-F]{3,8}|[a-z]+)/);
		if (match) {
			$popup.find(".sdx-shadow-x").val(match[1]).siblings(".sdx-range-value").text(`${match[1]}px`);
			$popup.find(".sdx-shadow-y").val(match[2]).siblings(".sdx-range-value").text(`${match[2]}px`);
			$popup.find(".sdx-shadow-blur").val(match[3]).siblings(".sdx-range-value").text(`${match[3]}px`);
			$popup.find(".sdx-shadow-color").val(this._normalizeColor(match[4]) || "#000000");
		}
		this._updateShadowPreview($popup);
	}

	_updateShadowValue($popup) {
		const x = $popup.find(".sdx-shadow-x").val();
		const y = $popup.find(".sdx-shadow-y").val();
		const blur = $popup.find(".sdx-shadow-blur").val();
		const color = $popup.find(".sdx-shadow-color").val();
		const shadowType = $popup.data("shadow-type");
		const shadowValue = `${x}px ${y}px ${blur}px ${color}`;

		const $section = $popup.closest(".sdx-control-section");
		$section.find(`.sdx-shadow-value[data-shadow-type="${shadowType}"]`).val(shadowValue).trigger("change");
	}

	_updateShadowPreview($popup) {
		const x = $popup.find(".sdx-shadow-x").val();
		const y = $popup.find(".sdx-shadow-y").val();
		const blur = $popup.find(".sdx-shadow-blur").val();
		const color = $popup.find(".sdx-shadow-color").val();
		$popup.find(".sdx-shadow-preview-text").css("text-shadow", `${x}px ${y}px ${blur}px ${color}`);
	}

	_parseBorderToControls($builder) {
		const borderValue = $builder.find(".sdx-border-value").val() || "3px solid #9b59b6";
		const match = borderValue.match(/(\d+)px\s+(\w+)\s+(#[0-9a-fA-F]{3,8}|[a-z]+)/);
		if (match) {
			$builder.find(".sdx-border-width").val(match[1]).siblings(".sdx-range-value").text(`${match[1]}px`);
			$builder.find(".sdx-border-style").val(match[2]);
			$builder.find(".sdx-border-color").val(this._normalizeColor(match[3]) || "#9b59b6");
		}
	}

	_updateBorderValue($builder) {
		const width = $builder.find(".sdx-border-width").val();
		const style = $builder.find(".sdx-border-style").val();
		const color = $builder.find(".sdx-border-color").val();
		const borderValue = `${width}px ${style} ${color}`;
		$builder.find(".sdx-border-value").val(borderValue).trigger("change");
	}

	_updateLivePreview(html) {
		html.find(".sdx-live-preview").each((i, preview) => {
			const $preview = $(preview);
			const categoryKey = $preview.data("category");
			const $panel = $preview.closest(".sdx-panel");

			const enabled = $panel.find(`input[name="categories.${categoryKey}.enabled"]`).is(":checked");
			if (!enabled) {
				$preview.css({
					background: "#1a1a1a",
					borderLeft: "none",
				});
				$preview.find(".sdx-preview-name, .sdx-preview-qty, .sdx-preview-slots").css({
					color: "#e0e0e0",
					textShadow: "none",
				});
				$preview.find(".sdx-preview-details, .sdx-preview-details *").css({
					color: "#a0a0a0",
					textShadow: "none",
				});
				return;
			}

			const bgColor = $panel.find(`input[type="text"][name="categories.${categoryKey}.backgroundColor"]`).val();
			const useGradient = $panel.find(`input[name="categories.${categoryKey}.useGradient"]`).is(":checked");
			const gradientEnd = $panel.find(`input[type="text"][name="categories.${categoryKey}.gradientEndColor"]`).val();
			const textColor = $panel.find(`input[type="text"][name="categories.${categoryKey}.textColor"]`).val();
			const textShadow = $panel.find(`input[name="categories.${categoryKey}.textShadow"]`).val();
			const borderLeft = $panel.find(`input[name="categories.${categoryKey}.borderLeft"]`).val();
			const descColor = $panel.find(`input[type="text"][name="categories.${categoryKey}.descriptionTextColor"]`).val();
			const descShadow = $panel.find(`input[name="categories.${categoryKey}.descriptionTextShadow"]`).val();

			let background;
			if (useGradient) {
				const endColor = gradientEnd || "transparent";
				background = `linear-gradient(to right, ${bgColor}, ${endColor})`;
			}
			else {
				background = bgColor;
			}

			$preview.css({
				background: background,
				borderLeft: borderLeft,
				borderRadius: "10px",
			});

			$preview.find(".sdx-preview-name, .sdx-preview-qty, .sdx-preview-slots").css({
				color: textColor,
				textShadow: textShadow,
			});

			// Apply description styles
			const finalDescColor = descColor || "#a0a0a0";
			const finalDescShadow = descShadow || "none";
			$preview.find(".sdx-preview-details, .sdx-preview-details p, .sdx-preview-details b, .sdx-preview-details em").css({
				color: finalDescColor,
				textShadow: finalDescShadow,
			});
			$preview.find(".sdx-preview-tag").css({
				color: finalDescColor,
				textShadow: finalDescShadow,
				background: `${bgColor}66`,
			});
		});

		// Update tab indicators
		html.find(".sdx-tab").each((i, tab) => {
			const $tab = $(tab);
			const categoryKey = $tab.data("category");
			const $panel = html.find(`.sdx-panel[data-category="${categoryKey}"]`);
			const bgColor = $panel.find(`input[type="text"][name="categories.${categoryKey}.backgroundColor"]`).val();
			$tab.find(".sdx-tab-indicator").css("background", bgColor);
		});
	}

	// ---- Preset Definitions ----
	_getPresets() {
		return {
			default: DEFAULT_INVENTORY_STYLES,
			dark: {
				enabled: true,
				categories: {
					magical: { enabled: true, backgroundColor: "#1a1a2e", useGradient: true, gradientEndColor: "transparent", textColor: "#a78bfa", textShadow: "0px 0px 8px #8b5cf6", borderLeft: "3px solid #8b5cf6", descriptionTextColor: "#9ca3af", descriptionTextShadow: "" },
					unidentified: { enabled: true, backgroundColor: "#1f1a0a", useGradient: true, gradientEndColor: "transparent", textColor: "#fbbf24", textShadow: "0px 0px 6px #f59e0b", borderLeft: "3px solid #f59e0b", descriptionTextColor: "#9ca3af", descriptionTextShadow: "" },
					container: { enabled: true, backgroundColor: "#0a1f1a", useGradient: true, gradientEndColor: "transparent", textColor: "#34d399", textShadow: "0px 0px 6px #10b981", borderLeft: "3px solid #10b981", descriptionTextColor: "#9ca3af", descriptionTextShadow: "" },
				},
			},
			vibrant: {
				enabled: true,
				categories: {
					magical: { enabled: true, backgroundColor: "#7c3aed", useGradient: true, gradientEndColor: "#4c1d95", textColor: "#ffffff", textShadow: "2px 2px 4px #000", borderLeft: "4px solid #fbbf24", descriptionTextColor: "#e0e7ff", descriptionTextShadow: "" },
					unidentified: { enabled: true, backgroundColor: "#dc2626", useGradient: true, gradientEndColor: "#7f1d1d", textColor: "#fef2f2", textShadow: "2px 2px 4px #000", borderLeft: "4px solid #fbbf24", descriptionTextColor: "#fee2e2", descriptionTextShadow: "" },
					container: { enabled: true, backgroundColor: "#059669", useGradient: true, gradientEndColor: "#064e3b", textColor: "#ecfdf5", textShadow: "2px 2px 4px #000", borderLeft: "4px solid #fbbf24", descriptionTextColor: "#d1fae5", descriptionTextShadow: "" },
				},
			},
			parchment: {
				enabled: true,
				categories: {
					magical: { enabled: true, backgroundColor: "#92702c", useGradient: true, gradientEndColor: "#d4a574", textColor: "#1a0f00", textShadow: "none", borderLeft: "3px solid #5a3e1b", descriptionTextColor: "#3d2914", descriptionTextShadow: "" },
					unidentified: { enabled: true, backgroundColor: "#8b4513", useGradient: true, gradientEndColor: "#d2691e", textColor: "#fff8dc", textShadow: "1px 1px 1px #000", borderLeft: "3px solid #654321", descriptionTextColor: "#f5deb3", descriptionTextShadow: "" },
					container: { enabled: true, backgroundColor: "#6b5344", useGradient: true, gradientEndColor: "#a08679", textColor: "#f5f5dc", textShadow: "none", borderLeft: "3px solid #463830", descriptionTextColor: "#d2b48c", descriptionTextShadow: "" },
				},
			},
			neon: {
				enabled: true,
				categories: {
					magical: { enabled: true, backgroundColor: "#0a0a1a", useGradient: false, gradientEndColor: "transparent", textColor: "#00ffff", textShadow: "0px 0px 10px #00ffff, 0px 0px 20px #00ffff", borderLeft: "3px solid #00ffff", descriptionTextColor: "#00ff88", descriptionTextShadow: "0px 0px 5px #00ff88" },
					unidentified: { enabled: true, backgroundColor: "#0a0a1a", useGradient: false, gradientEndColor: "transparent", textColor: "#ff00ff", textShadow: "0px 0px 10px #ff00ff, 0px 0px 20px #ff00ff", borderLeft: "3px solid #ff00ff", descriptionTextColor: "#ff6b6b", descriptionTextShadow: "0px 0px 5px #ff6b6b" },
					container: { enabled: true, backgroundColor: "#0a0a1a", useGradient: false, gradientEndColor: "transparent", textColor: "#00ff00", textShadow: "0px 0px 10px #00ff00, 0px 0px 20px #00ff00", borderLeft: "3px solid #00ff00", descriptionTextColor: "#ffff00", descriptionTextShadow: "0px 0px 5px #ffff00" },
				},
			},
			minimal: {
				enabled: true,
				categories: {
					magical: { enabled: true, backgroundColor: "transparent", useGradient: false, gradientEndColor: "transparent", textColor: "#a78bfa", textShadow: "none", borderLeft: "2px solid #a78bfa", descriptionTextColor: "", descriptionTextShadow: "" },
					unidentified: { enabled: true, backgroundColor: "transparent", useGradient: false, gradientEndColor: "transparent", textColor: "#fbbf24", textShadow: "none", borderLeft: "2px solid #fbbf24", descriptionTextColor: "", descriptionTextShadow: "" },
					container: { enabled: true, backgroundColor: "transparent", useGradient: false, gradientEndColor: "transparent", textColor: "#34d399", textShadow: "none", borderLeft: "2px solid #34d399", descriptionTextColor: "", descriptionTextShadow: "" },
				},
			},
		};
	}

	async _applyPreset(presetName) {
		const presets = this._getPresets();
		const preset = presets[presetName];
		if (!preset) return;

		// Get current settings and merge preset
		const currentStyles = game.settings.get(MODULE_ID, "inventoryStyles") || foundry.utils.deepClone(DEFAULT_INVENTORY_STYLES);

		currentStyles.enabled = preset.enabled;
		for (const [key, config] of Object.entries(preset.categories)) {
			if (currentStyles.categories[key]) {
				Object.assign(currentStyles.categories[key], config);
			}
		}

		await game.settings.set(MODULE_ID, "inventoryStyles", currentStyles);
		applyInventoryStyles();
		this.render();

		ui.notifications.info(`Applied "${presetName}" theme preset`);
	}

	async _exportTheme() {
		const styles = game.settings.get(MODULE_ID, "inventoryStyles");
		const data = JSON.stringify(styles, null, 2);
		const blob = new Blob([data], { type: "application/json" });
		const url = URL.createObjectURL(blob);

		const a = document.createElement("a");
		a.href = url;
		a.download = "shadowdark-inventory-theme.json";
		a.click();
		URL.revokeObjectURL(url);

		ui.notifications.info("Theme exported successfully!");
	}

	_importTheme() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";
		input.onchange = async e => {
			const file = e.target.files[0];
			if (!file) return;

			try {
				const text = await file.text();
				const theme = JSON.parse(text);

				// Validate basic structure
				if (!theme.categories) {
					throw new Error("Invalid theme file");
				}

				// Merge with defaults to ensure all fields exist
				const mergedTheme = foundry.utils.mergeObject(
					foundry.utils.deepClone(DEFAULT_INVENTORY_STYLES),
					theme,
					{ inplace: false, recursive: true }
				);

				await game.settings.set(MODULE_ID, "inventoryStyles", mergedTheme);
				applyInventoryStyles();
				this.render();

				ui.notifications.info("Theme imported successfully!");
			}
			catch(err) {
				ui.notifications.error(`Failed to import theme: ${err.message}`);
			}
		};
		input.click();
	}

	_updatePreview(html) {
		// Legacy method - redirect to new one
		this._updateLivePreview(html);
	}

	static async formHandler(event, form, formData) {
		const expandedData = foundry.utils.expandObject(formData.object);

		const currentStyles = game.settings.get(MODULE_ID, "inventoryStyles") || foundry.utils.deepClone(DEFAULT_INVENTORY_STYLES);

		currentStyles.enabled = expandedData.enabled === true;

		if (expandedData.categories) {
			for (const [key, updates] of Object.entries(expandedData.categories)) {
				if (currentStyles.categories[key]) {
					updates.enabled = updates.enabled === true;
					updates.useGradient = updates.useGradient === true;
					Object.assign(currentStyles.categories[key], updates);
				}
			}
		}

		await game.settings.set(MODULE_ID, "inventoryStyles", currentStyles);
		applyInventoryStyles();
	}
}

/**
 * Apply inventory styles to all rendered sheets
 */
function applyInventoryStyles() {
	// Remove existing dynamic style element
	const existingStyle = document.getElementById("sdx-inventory-dynamic-styles");
	if (existingStyle) {
		existingStyle.remove();
	}

	// Apply styles directly to all open actor sheets without re-rendering
	// This preserves expanded items and allows live preview
	for (const app of Object.values(ui.windows)) {
		if (app.actor && (app.actor.type === "Player" || app.actor.type === "NPC" || isPartyActor(app.actor))) {
			const html = app.element;
			if (html?.length) {
				applyInventoryStylesToSheet(html, app.actor);
			}
		}
	}
}

/**
 * Apply inventory styles to items in a sheet
 * @param {jQuery} html - The sheet HTML
 * @param {Actor} actor - The actor
 */
export function applyInventoryStylesToSheet(html, actor) {
	const styles = game.settings.get(MODULE_ID, "inventoryStyles");

	// Find all item rows
	const itemRows = html.find(".item-list .item[data-item-id], .item-list .item[data-uuid]");

	// If styles are disabled, clear any existing inline styles and return
	if (!styles?.enabled) {
		itemRows.each((i, row) => {
			const rowEl = row;
			rowEl.style.removeProperty("background");
			rowEl.style.removeProperty("text-shadow");
			rowEl.style.removeProperty("border-left");
			$(row).find(".item-name, .effect-name, .quantity, .slots").each((j, el) => {
				el.style.removeProperty("color");
			});
			$(row).find(".item-details").each((j, el) => {
				el.style.removeProperty("color");
				el.style.removeProperty("text-shadow");
				$(el).find("p, b, em, span, .tag, .details-description, .details-footer, a").each((k, child) => {
					child.style.removeProperty("color");
					child.style.removeProperty("text-shadow");
				});
			});
		});
		return;
	}

	const containersEnabled = game.settings.get(MODULE_ID, "enableContainers");

	// Set up click handler to re-apply styles when items are expanded
	// Use event delegation and only attach once
	if (!html.data("sdx-expand-handler-attached")) {
		html.data("sdx-expand-handler-attached", true);
		html.on("click", ".item-name[data-action='show-details'], [data-action='show-details']", event => {
			const $row = $(event.target).closest(".item[data-item-id], .item[data-uuid]");
			if ($row.length) {
				// Delay slightly to allow the details to be rendered
				setTimeout(() => {
					applyStylesToSingleItem($row, actor, styles, containersEnabled);
				}, 50);
			}
		});
	}

	itemRows.each((i, row) => {
		const $row = $(row);
		applyStylesToSingleItem($row, actor, styles, containersEnabled);
	});
}

/**
 * Apply styles to a single item row
 * @param {jQuery} $row - The item row element
 * @param {Actor} actor - The actor
 * @param {Object} styles - The inventory styles settings
 * @param {boolean} containersEnabled - Whether containers feature is enabled
 */
function applyStylesToSingleItem($row, actor, styles, containersEnabled) {
	const itemId = $row.data("item-id") || $row.data("itemId");
	const item = actor.items.get(itemId);
	if (!item) return;

	// Determine which style category applies (by priority)
	let appliedStyle = null;
	let highestPriority = -1;

	// Magical
	if (styles.categories.magical?.enabled) {
		if (item.system?.magicItem && styles.categories.magical.priority > highestPriority) {
			appliedStyle = styles.categories.magical;
			highestPriority = styles.categories.magical.priority;
		}
	}

	// Container
	if (containersEnabled && styles.categories.container?.enabled) {
		if (isContainerItem(item) && styles.categories.container.priority > highestPriority) {
			appliedStyle = styles.categories.container;
			highestPriority = styles.categories.container.priority;
		}
	}

	// Item type categories
	const typeConfig = styles.categories[item.type];
	if (typeConfig?.enabled && typeConfig.priority > highestPriority) {
		appliedStyle = typeConfig;
		highestPriority = typeConfig.priority;
	}

	// Apply the style or clear it
	if (appliedStyle) {
		let background;
		if (appliedStyle.useGradient) {
			const endColor = appliedStyle.gradientEndColor || "transparent";
			background = `linear-gradient(to right, ${appliedStyle.backgroundColor}, ${endColor})`;
		}
		else {
			background = appliedStyle.backgroundColor;
		}

		// Apply row styles
		const rowEl = $row[0];
		rowEl.style.setProperty("background", background, "important");
		rowEl.style.setProperty("text-shadow", appliedStyle.textShadow, "important");
		rowEl.style.setProperty("border-left", appliedStyle.borderLeft, "important");

		// Style text elements - use setProperty with !important to override system CSS
		$row.find(".item-name, .effect-name").each((i, el) => {
			el.style.setProperty("color", appliedStyle.textColor, "important");
		});
		$row.find(".quantity, .slots").each((i, el) => {
			el.style.setProperty("color", appliedStyle.textColor, "important");
		});
		// Style the item details/description area - only if specific description colors are set
		$row.find(".item-details").each((i, el) => {
			const $details = $(el);
			if (appliedStyle.descriptionTextColor) {
				// Apply to container and all child elements to override their specific colors
				el.style.setProperty("color", appliedStyle.descriptionTextColor, "important");
				$details.find("p, b, em, span, .tag, .details-description, .details-footer, a").each((j, child) => {
					child.style.setProperty("color", appliedStyle.descriptionTextColor, "important");
				});
			}
			else {
				el.style.removeProperty("color");
				$details.find("p, b, em, span, .tag, .details-description, .details-footer, a").each((j, child) => {
					child.style.removeProperty("color");
				});
			}
			if (appliedStyle.descriptionTextShadow) {
				el.style.setProperty("text-shadow", appliedStyle.descriptionTextShadow, "important");
				$details.find("p, b, em, span, .tag, .details-description, .details-footer, a").each((j, child) => {
					child.style.setProperty("text-shadow", appliedStyle.descriptionTextShadow, "important");
				});
			}
			else {
				el.style.removeProperty("text-shadow");
				$details.find("p, b, em, span, .tag, .details-description, .details-footer, a").each((j, child) => {
					child.style.removeProperty("text-shadow");
				});
			}
		});
	}
	else {
		// Clear any existing styles if no category applies
		const rowEl = $row[0];
		rowEl.style.removeProperty("background");
		rowEl.style.removeProperty("text-shadow");
		rowEl.style.removeProperty("border-left");
		$row.find(".item-name, .effect-name, .quantity, .slots").each((i, el) => {
			el.style.removeProperty("color");
		});
		$row.find(".item-details").each((i, el) => {
			el.style.removeProperty("color");
			el.style.removeProperty("text-shadow");
			$(el).find("p, b, em, span, .tag, .details-description, .details-footer, a").each((j, child) => {
				child.style.removeProperty("color");
				child.style.removeProperty("text-shadow");
			});
		});
	}
}
