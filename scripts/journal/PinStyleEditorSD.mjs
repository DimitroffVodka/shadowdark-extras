// v13+ FilePicker namespaced under foundry.applications.apps.
const FilePicker = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;

const MODULE_ID = "shadowdark-extras";

/**
 * We import style logic from JournalPinsSD to avoid circular dependencies
 */
import {
	getPinStyle, JournalPinManager, JournalPinRenderer, DEFAULT_PIN_STYLE, isMediaPinShape,
} from "./JournalPinsSD.mjs";
import { IconPickerApp } from "./IconPickerSD.mjs";
import { PinStyleForm } from "./pin-style-form.mjs";
import { PinStylePreview } from "./pin-style-preview.mjs";
import { PinStyleTMFX } from "./pin-style-tmfx.mjs";
import { FEATURE_IDS, isFeatureEnabled } from "../settings/feature-gates.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Bind a hidden icon path, its preset select, and its live preview. */
function bindIconPathControl({
	input, presetSelect, preview, clearButton = null, emptyMarkup,
	imageAlt = "", imageStyle = "", onUpdate,
}) {
	if (!input) return null;
	const sync = () => {
		const path = (input.value || "").trim();
		if (preview) {
			const style = imageStyle ? ` style="${imageStyle}"` : "";
			preview.innerHTML = path
				? `<img src="${foundry.utils.escapeHTML(path)}" alt="${foundry.utils.escapeHTML(imageAlt)}"${style} />`
				: emptyMarkup;
		}
		if (clearButton) clearButton.style.display = path ? "" : "none";
		if (presetSelect && presetSelect.value !== path) {
			const hasPreset = [...presetSelect.options].some(option => option.value === path);
			presetSelect.value = hasPreset ? path : "";
		}
	};
	const setPath = path => {
		input.value = path || "";
		sync();
		onUpdate?.();
	};
	input.addEventListener("change", sync);
	input.addEventListener("input", sync);
	presetSelect?.addEventListener("change", () => setPath(presetSelect.value));
	sync();
	return { setPath, sync };
}

/**
 * Pin Style Editor Application
 */
export class PinStyleEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "sdx-pin-style-editor",
		classes: ["sdx-pin-style-editor-app"],
		position: {
			width: 420,
			height: "auto",
		},
		window: {
			title: "SDX.pinStyleEditor.title",
			icon: "fa-solid fa-map-pin",
			resizable: true,
			animations: false,
			controls: [],
		},
	};

	static PARTS = {
		form: {
			template: `modules/${MODULE_ID}/templates/pin-style-editor.hbs`,
		},
	};

	constructor(options = {}) {
		super(options);
		this.pinId = options.pinId || null;
		this._previewPin = null;

		if (this.pinId) {
			this.options.window.title = "SDX.pinStyleEditor.titleIndividual";
			this._isSaved = false;
			this._canvasUpdateDebounce = foundry.utils.debounce(
				this._updateCanvasPreview.bind(this), 150
			);
		}
	}

	async _prepareContext(options) {
		let style;
		let journalPages = null;
		let currentPageId = null;
		let journalId = null;
		let currentJournalId = null;
		let allJournals = null;
		let requiresVision = false;
		let aboveFog = false;
		let tooltipTitle = "";
		let tooltipContent = "";
		let hideTooltip = false;
		let nameSource = "auto";

		if (this.pinId) {
			const pin = JournalPinManager.get(this.pinId);
			style = { ...DEFAULT_PIN_STYLE, ...getPinStyle(), ...(pin?.style || {}) };
			// Converted map notes store note.iconSize at pin.size (top-level),
			// not in pin.style. Seed the slider with the effective rendered
			// size so the editor doesn't snap the preview to the 32px global.
			if (pin?.size != null && pin.style?.size == null) style.size = pin.size;

			// Load all journals for the dropdown
			allJournals = game.journal.contents
				.filter(j => j.pages.size > 0)
				.sort((a, b) => a.name.localeCompare(b.name))
				.map(j => ({
					id: j.id,
					name: j.name,
				}));

			// Add "None" option
			allJournals.unshift({ id: "", name: "- None -" });

			// Load pin-specific settings (independent of journal linkage)
			requiresVision = pin.requiresVision || false;
			aboveFog = pin.aboveFog || false;
			tooltipTitle = pin.tooltipTitle || "";
			tooltipContent = pin.tooltipContent || "";
			hideTooltip = pin.hideTooltip || false;
			nameSource = pin.nameSource || "auto";

			// Load journal pages for individual pin editor
			if (pin?.journalId) {
				journalId = pin.journalId;
				currentJournalId = pin.journalId;
				currentPageId = pin.pageId;

				const journal = game.journal.get(pin.journalId);
				if (journal) {
					journalPages = journal.pages.contents
						.sort((a, b) => a.sort - b.sort)
						.map(page => ({
							id: page.id,
							name: page.name,
						}));

				}
			}
		}
		else {
			style = getPinStyle();
		}

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

		// Gather core fonts and merge with SDX fonts
		const coreFonts = game.settings.get("core", "fonts") || {};
		const allCustomFontFamilies = Object.keys(coreFonts);

		// Base standard fonts
		const standardFonts = [
			"Arial", "Verdana", "Georgia", "Times New Roman", "Courier New",
			"Old Newspaper Font", "Montserrat-medium", "JSL Blackletter",
		];

		// Merge and format
		const combinedFonts = [
			...new Set([...standardFonts, ...SDX_FONTS, ...allCustomFontFamilies]),
		];

		const fontFamilies = combinedFonts.map(f => {
			const cleanLabel = f.replace(/['"]/g, "") // remove quotes for label
				.split(/[-_]/)
				.map(w => w.charAt(0).toUpperCase() + w.slice(1))
				.join(" ");
			return {
				value: f.includes(" ") ? `'${f}'` : f, // quote values with spaces if they aren't already
				label: cleanLabel,
			};
		}).sort((a, b) => a.label.localeCompare(b.label));

		const shapes = [
			{ value: "circle", label: game.i18n.localize("SDX.pinStyleEditor.shapeCircle") },
			{ value: "square", label: game.i18n.localize("SDX.pinStyleEditor.shapeSquare") },
			{ value: "diamond", label: game.i18n.localize("SDX.pinStyleEditor.shapeDiamond") },
			{ value: "hexagon", label: "Hexagon (Point)" },
			{ value: "hexagonFlat", label: "Hexagon (Flat)" },
			{ value: "icon", label: game.i18n.localize("SDX.pinStyleEditor.shapeIcon") },
			{ value: "image", label: game.i18n.localize("SDX.pinStyleEditor.shapeImage") },
		];

		const ringStyles = [
			{ value: "solid", label: "Solid" },
			{ value: "dashed", label: "Dashed" },
			{ value: "dotted", label: "Dotted" },
		];

		const iconOptions = [
			{ value: "fa-solid fa-book-open", label: "Book Open" },
			{ value: "fa-solid fa-book", label: "Book" },
			{ value: "fa-solid fa-scroll", label: "Scroll" },
			{ value: "fa-solid fa-map", label: "Map" },
			{ value: "fa-solid fa-landmark", label: "Landmark" },
			{ value: "fa-solid fa-dungeon", label: "Dungeon" },
			{ value: "fa-solid fa-tower-observation", label: "Tower" },
			{ value: "fa-solid fa-skull", label: "Skull" },
			{ value: "fa-solid fa-star", label: "Star" },
			{ value: "fa-solid fa-gem", label: "Gem" },
			{ value: "fa-solid fa-coins", label: "Coins" },
			{ value: "fa-solid fa-crown", label: "Crown" },
			{ value: "fa-solid fa-shield", label: "Shield" },
			{ value: "fa-solid fa-sword", label: "Sword" },
			{ value: "fa-solid fa-wand-sparkles", label: "Wand" },
			{ value: "fa-solid fa-fire", label: "Fire" },
			{ value: "fa-solid fa-droplet", label: "Water" },
			{ value: "fa-solid fa-tree", label: "Tree" },
			{ value: "fa-solid fa-mountain", label: "Mountain" },
			{ value: "fa-solid fa-house", label: "House" },
		];

		// Generate list of border styles (0-36)
		const borderStyles = [];
		for (let i = 0; i < 37; i++) {
			borderStyles.push({
				value: i,
				label: `Style ${i + 1}`,
			});
		}

		// Normalize hoverAnimation to string for select compatibility
		if (typeof style.hoverAnimation === "boolean") {
			style.hoverAnimation = style.hoverAnimation ? "scale" : "none";
		}
		if (!style.hoverAnimation) style.hoverAnimation = "highlight";
		const ICON_BASE = `modules/${MODULE_ID}/assets/icons`;
		const svgIconPresets = [
			{ path: `${ICON_BASE}/delapouite/castle.svg`, label: "Castle" },
			{ path: `${ICON_BASE}/delapouite/castle-ruins.svg`, label: "Castle Ruins" },
			{ path: `${ICON_BASE}/delapouite/village.svg`, label: "Village" },
			{ path: `${ICON_BASE}/delapouite/huts-village.svg`, label: "Huts Village" },
			{ path: `${ICON_BASE}/caro-asercion/medieval-village-01.svg`, label: "Medieval Village" },
			{ path: `${ICON_BASE}/delapouite/church.svg`, label: "Church" },
			{ path: `${ICON_BASE}/delapouite/byzantin-temple.svg`, label: "Byzantine Temple" },
			{ path: `${ICON_BASE}/delapouite/greek-temple.svg`, label: "Greek Temple" },
			{ path: `${ICON_BASE}/delapouite/egyptian-temple.svg`, label: "Egyptian Temple" },
			{ path: `${ICON_BASE}/delapouite/crystal-shrine.svg`, label: "Crystal Shrine" },
			{ path: `${ICON_BASE}/delapouite/fire-shrine.svg`, label: "Fire Shrine" },
			{ path: `${ICON_BASE}/delapouite/cave-entrance.svg`, label: "Cave Entrance" },
			{ path: `${ICON_BASE}/delapouite/mountain-cave.svg`, label: "Mountain Cave" },
			{ path: `${ICON_BASE}/delapouite/forest.svg`, label: "Forest" },
			{ path: `${ICON_BASE}/delapouite/forest-camp.svg`, label: "Forest Camp" },
			{ path: `${ICON_BASE}/delapouite/goblin-camp.svg`, label: "Goblin Camp" },
			{ path: `${ICON_BASE}/delapouite/camping-tent.svg`, label: "Tent" },
			{ path: `${ICON_BASE}/delapouite/barracks-tent.svg`, label: "Barracks Tent" },
			{ path: `${ICON_BASE}/delapouite/hill-fort.svg`, label: "Hill Fort" },
			{ path: `${ICON_BASE}/delapouite/military-fort.svg`, label: "Military Fort" },
			{ path: `${ICON_BASE}/delapouite/dungeon-gate.svg`, label: "Dungeon Gate" },
			{ path: `${ICON_BASE}/delapouite/medieval-gate.svg`, label: "Medieval Gate" },
			{ path: `${ICON_BASE}/delapouite/arch-bridge.svg`, label: "Arch Bridge" },
			{ path: `${ICON_BASE}/delapouite/rope-bridge.svg`, label: "Rope Bridge" },
			{ path: `${ICON_BASE}/delapouite/drawbridge.svg`, label: "Drawbridge" },
			{ path: `${ICON_BASE}/delapouite/graveyard.svg`, label: "Graveyard" },
			{ path: `${ICON_BASE}/delapouite/obelisk.svg`, label: "Obelisk" },
			{ path: `${ICON_BASE}/delapouite/menhir.svg`, label: "Menhir" },
			{ path: `${ICON_BASE}/delapouite/lighthouse.svg`, label: "Lighthouse" },
			{ path: `${ICON_BASE}/delapouite/harbor-dock.svg`, label: "Harbor Dock" },
			{ path: `${ICON_BASE}/delapouite/ancient-ruins.svg`, label: "Ancient Ruins" },
			{ path: `${ICON_BASE}/delapouite/hut.svg`, label: "Hut" },
			{ path: `${ICON_BASE}/delapouite/hobbit-dwelling.svg`, label: "Hobbit Dwelling" },
			{ path: `${ICON_BASE}/delapouite/evil-tower.svg`, label: "Evil Tower" },
			{ path: `${ICON_BASE}/delapouite/control-tower.svg`, label: "Control Tower" },
			{ path: `${ICON_BASE}/lorc/castle.svg`, label: "Castle (Lorc)" },
			{ path: `${ICON_BASE}/lorc/stone-tower.svg`, label: "Stone Tower" },
			{ path: `${ICON_BASE}/lorc/white-tower.svg`, label: "White Tower" },
			{ path: `${ICON_BASE}/lorc/guarded-tower.svg`, label: "Guarded Tower" },
			{ path: `${ICON_BASE}/delapouite/chest.svg`, label: "Chest" },
			{ path: `${ICON_BASE}/lorc/skull-crack.svg`, label: "Skull" },
			{ path: `${ICON_BASE}/delapouite/goblin-head.svg`, label: "Goblin Head" },
			{ path: `${ICON_BASE}/delapouite/orc-head.svg`, label: "Orc Head" },
			{ path: `${ICON_BASE}/delapouite/dragon-orb.svg`, label: "Dragon Orb" },
		];
		return {
			style,
			fontFamilies,
			shapes,
			ringStyles,
			iconOptions,
			svgIconPresets,
			isMediaShape: isMediaPinShape(style.shape),
			borderStyles,
			journalPages,
			currentPageId,
			journalId,
			currentJournalId,
			allJournals,
			requiresVision,
			aboveFog,
			tooltipTitle,
			tooltipContent,
			hideTooltip,
			nameSource,
			isGM: game.user?.isGM,
			pinId: this.pinId,
			tmfxPresets: this._getTMFXPresets(),
			activeFilters: this._getActiveFilters(),
		};
	}

	_onRender(context, options) {
		const html = this.element;
		const form = html.querySelector("form");
		if (!form) return;

		// All inputs - update preview on change (exclude TMFX preset - it has its own live preview)
		form.querySelectorAll("input, select").forEach(input => {
			if (input.name === "tmfxPreset") return;
			input.addEventListener("change", async () => await this._updatePreview());
		});

		// Textareas are rendered controls too; update the preview while label text
		// is being typed rather than waiting for focus to leave the field.
		form.querySelectorAll("textarea").forEach(textarea => {
			textarea.addEventListener("input", async () => await this._updatePreview());
		});

		// Range sliders - show value and update preview on input
		form.querySelectorAll('input[type="range"]').forEach(input => {
			const valueDisplay = form.querySelector(`[data-for="${input.name}"]`);
			if (valueDisplay) {
				valueDisplay.textContent = input.value;
				input.addEventListener("input", () => {
					valueDisplay.textContent = input.value;
					this._updatePreview();
				});
			}
		});

		// Color pickers - update preview on input (for font color)
		form.querySelectorAll('input[type="color"]').forEach(input => {
			input.addEventListener("input", async () => await this._updatePreview());
		});

		// (Highlight hover controls removed — highlight preset drives tint/ring via style defaults)

		// Save button
		form.querySelector('[data-action="save"]')?.addEventListener("click", () => this._onSave());

		// Reset button
		form.querySelector('[data-action="reset"]')?.addEventListener(
			"click", () => this._onReset()
		);

		// TMFX Preset dropdown — Phase 1 live preview (transient, no flag write)
		const tmfxSelect = form.querySelector('[name="tmfxPreset"]');
		if (tmfxSelect) {
			const deleteBtn = form.querySelector('[data-action="delete-tmfx-preset"]');
			const toggleDelete = () => {
				const opt = tmfxSelect.options[tmfxSelect.selectedIndex];
				const isRemovable = opt?.dataset.removable === "true";
				if (deleteBtn) deleteBtn.style.display = isRemovable ? "block" : "none";
			};
			const previewFromSelect = () => {
				const opt = tmfxSelect.options[tmfxSelect.selectedIndex];
				const name = tmfxSelect.value || "";
				const library = opt?.dataset.library || "tmfx-main";
				// fire-and-forget; _previewTMFXPreset clears previous preview itself
				this._previewTMFXPreset(name, library);
			};
			tmfxSelect.addEventListener("change", () => {
				toggleDelete(); previewFromSelect();
			});
			// Native <select> doesn't fire change while the list is open in most browsers;
			// keyup (arrow keys) + input give us navigation preview without commit.
			tmfxSelect.addEventListener("input", previewFromSelect);
			tmfxSelect.addEventListener("keyup", previewFromSelect);
			toggleDelete();
		}

		// TMFX Application button (+ Apply) — clear preview then persist
		form.querySelector('[data-action="apply-tmfx"]')?.addEventListener(
			"click", async () => {
				// Drop the transient preview so addFilters doesn't double-stack
				try {
					this._clearTMFXPreview();
				}
				catch{}
				await this._onApplyTMFX();
			}
		);

		// TMFX Save Preset button
		form.querySelector('[data-action="save-tmfx-preset"]')?.addEventListener(
			"click", () => this._onSaveTMFXPreset()
		);

		// TMFX Delete Preset button
		form.querySelector('[data-action="delete-tmfx-preset"]')?.addEventListener(
			"click", () => this._onDeleteTMFXPreset()
		);

		// Show/hide content options based on contentType selection
		const contentTypeSelect = form.querySelector('[name="contentType"]');
		const textSection = form.querySelector(".text-options");
		const iconSection = form.querySelector(".icon-options");
		const fontSection = form.querySelector(".font-options");
		const symbolSection = form.querySelector(".symbol-options");
		const customIconSection = form.querySelector(".custom-icon-options");

		if (contentTypeSelect && textSection && fontSection) {
			const updateVisibility = () => {
				const type = contentTypeSelect.value;

				// Toggle sections based on type
				textSection.style.display = type === "text" ? "block" : "none";

				if (symbolSection) {
					symbolSection.style.display = (type === "symbol" || type === "icon") ? "block" : "none";
				}

				if (customIconSection) {
					customIconSection.style.display = type === "customIcon" ? "block" : "none";
				}

				if (iconSection) {
					iconSection.style.display = (type === "icon") ? "block" : "none"; // Legacy
				}

				// Font options only for text and number
				const isMedia = (type === "symbol" || type === "icon" || type === "customIcon");
				fontSection.style.display = isMedia ? "none" : "block";
			};
			updateVisibility();
			contentTypeSelect.addEventListener("change", updateVisibility);
		}

		// Custom content icon — curated preset dropdown + full icon browser
		const customIconPath = form.querySelector('[name="customIconPath"]');
		const customIconPreset = form.querySelector('[name="customIconPreset"]');
		const customIconPreview = form.querySelector(".selected-icon-preview");
		const customIconControl = bindIconPathControl({
			input: customIconPath,
			presetSelect: customIconPreset,
			preview: customIconPreview,
			emptyMarkup: '<i class="fa-solid fa-image"></i>',
			imageAlt: "Selected Icon",
			onUpdate: () => this._updatePreview(),
		});

		// Browse icons button - open icon picker modal
		const browseIconsBtn = form.querySelector('[data-action="browse-icons"]');
		if (browseIconsBtn && !isFeatureEnabled(FEATURE_IDS.ICON_PICKER)) {
			browseIconsBtn.remove();
		}
		else if (browseIconsBtn) {
			browseIconsBtn.addEventListener("click", async () => {
				const selectedPath = await IconPickerApp.pick();
				if (selectedPath) customIconControl?.setPath(selectedPath);
			});
		}

		// Generic File Picker buttons
		const filePickerBtns = form.querySelectorAll(".file-picker-btn");
		filePickerBtns.forEach(btn => {
			btn.addEventListener("click", ev => {
				const targetName = btn.dataset.target;
				const currentInput = form.querySelector(`[name="${targetName}"]`);

				let browsePath = currentInput ? currentInput.value : "";
				if (!browsePath && targetName === "labelBorderImagePath") {
					browsePath = "modules/shadowdark-extras/assets/labelframes/";
				}

				new FilePicker({
					type: "image",
					callback: path => {
						if (currentInput) {
							currentInput.value = path;
							// Trigger preview update
							this._updatePreview();
						}
					},
				}).browse(browsePath);
			});
		});

		// Show/hide label background options
		const labelBgSelect = form.querySelector('[name="labelBackground"]');
		const labelBgOptions = form.querySelector(".label-bg-options");
		const labelImageOptions = form.querySelector(".label-image-options");

		if (labelBgSelect) {
			const updateLabelBgVisibility = () => {
				const val = labelBgSelect.value;
				if (labelBgOptions) labelBgOptions.style.display = val === "solid" ? "block" : "none";
				if (labelImageOptions) labelImageOptions.style.display = val === "image" ? "block" : "none";
			};
			// Initial state set by handle bars, but helpful to ensure
			labelBgSelect.addEventListener("change", updateLabelBgVisibility);
			updateLabelBgVisibility();
		}

		// TokenMagic FX: clear all persisted effects (also drops any transient preview)
		form.querySelector('[data-action="clear-tmfx"]')?.addEventListener(
			"click", async () => {
				try {
					this._clearTMFXPreview?.();
				}
				catch{}
				await this._onClearTMFX();
			}
		);

		// Individual TMFX remove buttons
		form.querySelectorAll('[data-action="remove-tmfx"]').forEach(btn => {
			btn.addEventListener("click", ev => {
				ev.preventDefault();
				const filterId = btn.dataset.filterId;
				this._onRemoveTMFX(filterId);
			});
		});

		// Individual TMFX edit buttons
		form.querySelectorAll('[data-action="edit-tmfx"]').forEach(btn => {
			btn.addEventListener("click", ev => {
				ev.preventDefault();
				const { filterId, filterType, filterInternalId } = btn.dataset;
				this._onEditTMFXFilter({ filterId, filterType, filterInternalId });
			});
		});

		// Show/hide options based on shape selection
		const shapeSelect = form.querySelector('[name="shape"]');
		const borderRadiusSection = form.querySelector(".border-radius-options");
		const standardStyleSections = form.querySelectorAll(".standard-style-options");
		const mediaOpacitySection = form.querySelector(".image-opacity-option");
		const imageShapeOptions = form.querySelector(".image-shape-options");
		const iconShapeOptions = form.querySelector(".icon-shape-options");

		if (shapeSelect) {
			const updateShapeVisibility = () => {
				const shape = shapeSelect.value;
				if (borderRadiusSection) borderRadiusSection.style.display = shape === "square" ? "flex" : "none";
				const isImage = shape === "image";
				const isIcon = shape === "icon";
				const hideStd = isMediaPinShape(shape);
				standardStyleSections.forEach(el => el.style.display = hideStd ? "none" : "block");
				if (mediaOpacitySection) mediaOpacitySection.style.display = hideStd ? "block" : "none";
				if (imageShapeOptions) imageShapeOptions.style.display = isImage ? "block" : "none";
				if (iconShapeOptions) iconShapeOptions.style.display = isIcon ? "block" : "none";
			};
			updateShapeVisibility();
			shapeSelect.addEventListener("change", updateShapeVisibility);
		}

		// Icon shape picker — Browse / clear / preset dropdown (SVG as the pin body)
		const iconShapeInput = form.querySelector('[name="iconShapePath"]');
		const iconShapePreset = form.querySelector('[name="iconShapePreset"]');
		const browseIconShape = form.querySelector('[data-action="browse-icon-shape"]');
		const iconShapePreview = form.querySelector(".icon-shape-preview");
		const clearIconShape = form.querySelector('[data-action="clear-icon-shape"]');
		const iconShapeControl = bindIconPathControl({
			input: iconShapeInput,
			presetSelect: iconShapePreset,
			preview: iconShapePreview,
			clearButton: clearIconShape,
			emptyMarkup: '<i class="fa-solid fa-icons" style="opacity:.45"></i>',
			imageStyle: "width:28px;height:28px;object-fit:contain",
			onUpdate: () => this._updatePreview(),
		});
		if (browseIconShape && !isFeatureEnabled(FEATURE_IDS.ICON_PICKER)) {
			browseIconShape.remove();
		}
		else browseIconShape?.addEventListener("click", async () => {
			const picked = await IconPickerApp.pick();
			if (picked) iconShapeControl?.setPath(picked);
		});
		clearIconShape?.addEventListener("click", () => iconShapeControl?.setPath(""));

		// Highlight color is only relevant to the highlight hover animation.
		const hoverSelect = form.querySelector('[name="hoverAnimation"]');
		const highlightRows = form.querySelectorAll(".highlight-color-row");
		if (hoverSelect && highlightRows.length) {
			const syncHighlightRows = () => {
				const isHighlight = hoverSelect.value === "highlight";
				highlightRows.forEach(r => r.style.display = isHighlight ? "" : "none");
			};
			hoverSelect.addEventListener("change", syncHighlightRows);
			syncHighlightRows();
		}

		// Journal dropdown changes - update page options
		const journalSelect = form.querySelector('[name="journalId"]');
		const pageSelect = form.querySelector('[name="pageId"]');
		if (journalSelect && pageSelect) {
			journalSelect.addEventListener("change", () => {
				const selectedJournalId = journalSelect.value;
				const journal = game.journal.get(selectedJournalId);
				if (journal) {
					// Clear existing options
					pageSelect.innerHTML = "";
					// Add new page options
					const sortedPages = journal.pages.contents.sort((a, b) => a.sort - b.sort);
					sortedPages.forEach(page => {
						const option = document.createElement("option");
						option.value = page.id;
						option.textContent = page.name;
						pageSelect.appendChild(option);
					});
					// Select first page by default
					if (sortedPages.length > 0) {
						pageSelect.value = sortedPages[0].id;
					}
				}
			});
		}

		// Initial preview
		this._updatePreview();
	}

	async close(options = {}) {
		// Drop any transient TMFX preview (additive PIXI filters, never persisted) before reverting
		try {
			this._clearTMFXPreview?.();
		}
		catch{}
		// Revert individual pin changes if closed without saving
		if (this.pinId && !this._isSaved) {
			const originalPin = JournalPinManager.get(this.pinId);
			if (originalPin) {
				JournalPinRenderer.updatePin(originalPin);
			}
		}
		if (this.element) this.element.style.display = "none"; // Vanish immediately
		options.animate = false;
		return super.close(options);
	}

	async _onReset() {
		if (this.pinId) {
			// Reset individual pin style by clearing overrides
			await JournalPinManager.update(this.pinId, { style: {} });
			ui.notifications.info(game.i18n.localize("SDX.pinStyleEditor.resetIndividualMsg"));
		}
		else {
			// Reset global defaults
			await game.settings.set(MODULE_ID, "pinStyleDefaults", DEFAULT_PIN_STYLE);
			ui.notifications.info(game.i18n.localize("SDX.pinStyleEditor.resetMsg"));
		}
		this.render();
	}

}

/**
 * Open the pin style editor
 */
// Form reading and saving, preview rendering, and the TokenMagic panel were
// split out in Phase 5.3. Each is a prototype method, so `this` is the
// application exactly as it was inline.
Object.assign(PinStyleEditorApp.prototype, PinStyleForm);
Object.assign(PinStyleEditorApp.prototype, PinStylePreview);
Object.assign(PinStyleEditorApp.prototype, PinStyleTMFX);

export function openPinStyleEditor() {
	new PinStyleEditorApp().render(true);
}

/**
 * Register the pin style settings
 */
export function registerPinStyleSettings() {
	game.settings.register(MODULE_ID, "pinStyleDefaults", {
		name: "Pin Style Defaults",
		hint: "Default style settings for journal pins",
		scope: "world",
		config: false,
		type: Object,
		default: DEFAULT_PIN_STYLE,
	});

	game.settings.registerMenu(MODULE_ID, "pinStyleEditorMenu", {
		name: game.i18n.localize("SDX.pinStyleEditor.menuName"),
		label: game.i18n.localize("SDX.pinStyleEditor.menuLabel"),
		hint: game.i18n.localize("SDX.pinStyleEditor.menuHint"),
		icon: "fa-solid fa-palette",
		type: PinStyleEditorApp,
		restricted: true,
	});

}
