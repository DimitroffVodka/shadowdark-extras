// v13+ FilePicker namespaced under foundry.applications.apps.
const FilePicker = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;

import { TOM_CONFIG as CONFIG } from "./TomConfig.mjs";
import { TomStore as Store } from "../tom/TomStore.mjs";
import { arenaSvgForType } from "./TomArenaSvg.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function clampArenaScale(v) {
	const n = Number(v);
	if (!Number.isFinite(n)) return 1;
	return Math.min(5, Math.max(0.25, Math.round(n * 20) / 20));
}

export class TomSceneEditor extends HandlebarsApplicationMixin(ApplicationV2) {
	constructor(sceneId = null, options = {}) {
		super(options);
		this.sceneId = sceneId;
		this.scene = sceneId ? Store.scenes.get(sceneId) : null;
		this.isCreateMode = !sceneId;
		this.uiState = {
			data: this.scene ? this.scene.toJSON() : {
				name: "New Scene",
				background: CONFIG.DEFAULTS.SCENE_BG,
				bgType: "image",
				cast: [],
				layoutSettings: { ...CONFIG.DEFAULT_LAYOUT },
				isArena: false,
				arenaType: "isometric",
				arenaScale: 1,
				inAnimation: "fade",
				outAnimation: "fade",
			},
			activeTab: "general",
		};

		// Backfill defaults for scenes saved before these features
		if (!this.uiState.data.inAnimation) {
			this.uiState.data.inAnimation = "fade";
		}
		if (!this.uiState.data.outAnimation) {
			this.uiState.data.outAnimation = "fade";
		}
		if (!Number.isFinite(this.uiState.data.arenaScale)) {
			this.uiState.data.arenaScale = 1;
		}
		this.uiState.data.arenaScale = clampArenaScale(this.uiState.data.arenaScale);

		// Debug: log what animations are loaded
		console.log(`SDX Scene Editor | Loading scene animations: in=${this.uiState.data.inAnimation}, out=${this.uiState.data.outAnimation}`);

		if (!this.uiState.data.layoutSettings) {
			this.uiState.data.layoutSettings = { ...CONFIG.DEFAULT_LAYOUT };
		}
	}

	static DEFAULT_OPTIONS = {
		tag: "form",
		id: "tom-scene-editor",
		classes: ["tom-app", "es-scene-editor"],
		window: {
			title: "Scene Editor",
			icon: "fas fa-edit",
			resizable: true,
			controls: [],
		},
		position: {
			width: 560,
			height: "auto",
		},
		actions: {
			"save": TomSceneEditor._onSave,
			"close": TomSceneEditor._onClose,
			"tab-switch": TomSceneEditor._onTabSwitch,
			"file-picked": TomSceneEditor._onFilePicked,
		},
	};

	static PARTS = {
		main: {
			template: "modules/shadowdark-extras/templates/tom-scene-editor.hbs",
			scrollable: [".tom-editor-content"],
		},
	};

	get title() {
		return this.isCreateMode ? "Create New Scene" : "Edit Scene";
	}

	async _prepareContext(options) {
		const arenaTypeOptions = [
			{ value: "isometric", label: "Isometric (Ellipse)" },
			{ value: "topdown", label: "Top Down (Circle)" },
			{ value: "expanded", label: "Expanded (Radial Grid)" },
			{ value: "ladder", label: "Ladder (Linear Track)" },
			{ value: "none", label: "No Grid (None)" },
		];

		const animationOptions = [
			{ value: "fade", label: "Fade" },
			{ value: "slide-left", label: "Slide Left" },
			{ value: "slide-right", label: "Slide Right" },
			{ value: "slide-top", label: "Slide Top" },
			{ value: "slide-bottom", label: "Slide Bottom" },
			{ value: "zoom-in", label: "Zoom In" },
			{ value: "zoom-out", label: "Zoom Out" },
			{ value: "rotate", label: "Rotate" },
			{ value: "blur", label: "Blur" },
			{ value: "none", label: "None (Instant)" },
		];

		const arenaScale = clampArenaScale(this.uiState.data.arenaScale);
		const showArenaPreview = !!(this.uiState.data.isArena && this.uiState.data.arenaType !== "none");
		const arenaPreviewSvg = showArenaPreview ? arenaSvgForType(this.uiState.data.arenaType) : "";

		return {
			scene: { ...this.uiState.data, arenaScale },
			activeTab: this.uiState.activeTab,
			isImage: this.uiState.data.bgType === "image",
			isVideo: this.uiState.data.bgType === "video",
			isCreateMode: this.isCreateMode,
			arenaTypeOptions,
			selectedArenaType: this.uiState.data.arenaType,
			arenaScale,
			arenaScaleDisplay: arenaScale.toFixed(2).replace(/\.?0+$/, ""),
			arenaScalePct: Math.round(arenaScale * 100),
			showArenaPreview,
			showArenaScale: this.uiState.data.isArena && this.uiState.data.arenaType !== "none",
			arenaPreviewSvg,
			animationOptions,
			selectedInAnimation: this.uiState.data.inAnimation || "fade",
			selectedOutAnimation: this.uiState.data.outAnimation || "fade",
		};
	}

	_getLiveAspect() {
		const active = document.querySelector(".tom-player-view.active");
		if (active) {
			const r = active.getBoundingClientRect();
			if (r.width > 1 && r.height > 1) return r.width / r.height;
		}
		// Fallback: window minus Foundry sidebars if measurable, otherwise window itself
		const w = window.innerWidth;
		const h = window.innerHeight;
		if (w > 1 && h > 1) return w / h;
		return 16 / 9;
	}

	_syncPreviewAspect() {
		const preview = this.element.querySelector(".tom-scene-preview-centered");
		if (!preview) return;
		const ratio = this._getLiveAspect();
		// CSS aspect-ratio accepts a bare number (meaning ratio/1) or "w / h"
		preview.style.setProperty("--tom-live-aspect", String(ratio));
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this._syncPreviewAspect();

		this.element.querySelector('input[name="name"]')?.addEventListener("input", e => {
			this.uiState.data.name = e.target.value;
		});

		this.element.querySelector('input[name="background"]')?.addEventListener("change", e => {
			this._updateBackground(e.target.value);
		});

		this.element.querySelector(".file-picker")?.addEventListener("click", async e => {
			e.preventDefault();
			const bgInput = this.element.querySelector('input[name="background"]');
			return new FilePicker({
				type: "imagevideo",
				current: this.uiState.data.background,
				callback: path => {
					this._updateBackground(path);
					if (bgInput) bgInput.value = path;
					this.render();
				},
			}).render(true);
		});

		// Arena grid style — live preview without full re-render (keeps focus)
		this.element.querySelector('select[name="arenaType"]')?.addEventListener("change", e => {
			this.uiState.data.arenaType = e.target.value;
			this._refreshArenaPreviewLive();
		});

		this.element.querySelector('input[name="isArena"]')?.addEventListener("change", e => {
			this.uiState.data.isArena = e.target.checked;
			this.render();
		});

		// Arena scale — slider + number stay in sync, live overlay scale
		const scaleRange = this.element.querySelector('input[name="arenaScale"]');
		const scaleNum = this.element.querySelector('input[name="arenaScaleNum"]');
		const onScaleInput = raw => {
			const v = clampArenaScale(raw);
			this.uiState.data.arenaScale = v;
			if (scaleRange && scaleRange.value !== String(v)) scaleRange.value = String(v);
			if (scaleNum && scaleNum.value !== String(v)) scaleNum.value = String(v);
			const preview = this.element.querySelector(".tom-scene-preview-centered");
			if (preview) preview.style.setProperty("--arena-scale", String(v));
			const valEl = this.element.querySelector(".tom-arena-scale-value");
			if (valEl) valEl.textContent = `${v.toFixed(2).replace(/\.?0+$/, "")}×`;
			const pctEl = this.element.querySelector(".tom-arena-scale-pct");
			if (pctEl) pctEl.textContent = `(${Math.round(v * 100)}%)`;
		};
		scaleRange?.addEventListener("input", e => onScaleInput(e.target.value));
		scaleNum?.addEventListener("input", e => onScaleInput(e.target.value));
		scaleNum?.addEventListener("change", e => onScaleInput(e.target.value));

		this.element.querySelector('select[name="inAnimation"]')?.addEventListener("change", e => {
			this.uiState.data.inAnimation = e.target.value;
		});

		this.element.querySelector('select[name="outAnimation"]')?.addEventListener("change", e => {
			this.uiState.data.outAnimation = e.target.value;
		});
	}

	_refreshArenaPreviewLive() {
		const preview = this.element.querySelector(".tom-scene-preview-centered");
		if (!preview) return;
		const isArena = !!this.uiState.data.isArena;
		const arenaType = this.uiState.data.arenaType;
		const showScale = isArena && arenaType !== "none";
		const showPreview = isArena && arenaType !== "none";

		// Toggle scale control visibility without full render
		const scaleGroup = this.element.querySelector(".tom-arena-scale-group");
		if (scaleGroup) scaleGroup.style.display = showScale ? "" : "none";

		// Swap preview SVG
		let arenaEl = preview.querySelector(".tom-scene-preview-arena");
		if (showPreview) {
			const svg = arenaSvgForType(arenaType);
			if (arenaEl) arenaEl.innerHTML = svg;
			else {
				arenaEl = document.createElement("div");
				arenaEl.className = "tom-scene-preview-arena";
				arenaEl.setAttribute("aria-hidden", "true");
				arenaEl.innerHTML = svg;
				preview.appendChild(arenaEl);
			}
			preview.style.setProperty("--arena-scale", String(clampArenaScale(this.uiState.data.arenaScale)));
		}
		else if (arenaEl) arenaEl.remove();
	}

	_updateBackground(path) {
		this.uiState.data.background = path;
		this.uiState.data.bgType = path.match(/\.(webm|mp4|m4v)$/i) ? "video" : "image";
	}

	static _onTabSwitch(event, target) {
		this.uiState.activeTab = target.dataset.tab;
		this.render();
	}

	static async _onSave(event, target) {
		const originalHtml = target.innerHTML;
		Object.assign(target, {
			innerHTML: '<i class="fas fa-spinner fa-spin"></i> Saving...',
			disabled: true,
		});
		target.classList.add("es-btn-loading");

		try {
			// Debug: log what we're about to save
			console.log(`SDX Scene Editor | Saving scene with animations: in=${this.uiState.data.inAnimation}, out=${this.uiState.data.outAnimation}`);

			if (this.isCreateMode) {
				const { name, background, bgType, layoutSettings, isArena, arenaType, arenaScale, inAnimation, outAnimation } = this.uiState.data;
				const newScene = Store.createScene({ name, background, bgType, layoutSettings, isArena, arenaType, arenaScale: clampArenaScale(arenaScale), inAnimation, outAnimation });
				document.querySelector(".tom-scene-switcher-panel")?.remove();
				this.close();
				ui.notifications.info(`Created Scene: ${newScene.name}`);
			}
			else {
				this.uiState.data.arenaScale = clampArenaScale(this.uiState.data.arenaScale);
				Object.assign(this.scene, this.uiState.data);
				console.log(`SDX Scene Editor | After assign, scene has: in=${this.scene.inAnimation}, out=${this.scene.outAnimation}`);
				Store.saveData();
				document.querySelector(".tom-scene-switcher-panel")?.remove();
				this.close();
				ui.notifications.info(`Saved Scene: ${this.scene.name}`);
			}
		}
		catch(error) {
			console.error("Tom | Error saving scene:", error);
			ui.notifications.error("Failed to save scene. Check console for details.");
			target.classList.remove("es-btn-loading");
			Object.assign(target, { innerHTML: originalHtml, disabled: false });
		}
	}

	static _onClose(event, target) {
		this.close();
	}
}
