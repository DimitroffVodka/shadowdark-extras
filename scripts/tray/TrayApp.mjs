import {
	getViewMode,
	selectPartyTokens,
	clearTokenSelection,
	getHealthOverlayHeight,
	renderTray,
	toggleHideNpcsFromPlayers,
} from "./TraySD.mjs";
import { saveTrayScrollPositions, restoreTrayScrollPositions } from "./tray-scroll-state.mjs";
import { TomPanels } from "./tom-panels.mjs";
import { HexPainterBindings } from "./hex-painter-bindings.mjs";
import { TrayHandleBindings } from "./tray-handle-bindings.mjs";
import { DungeonBindings } from "./dungeon-bindings.mjs";
import { TomSceneBindings } from "./tom-scene-bindings.mjs";
import { PinListBindings } from "./pin-list-bindings.mjs";
import { PartyBindings } from "./party-bindings.mjs";

import { TOM_OVERLAYS, TOM_OVERLAY_BASE } from "../tom/TomOverlays.mjs";
import { enablePainting, disablePainting, isTintEnabled, getPoiScale, enablePreview, disablePreview, getActiveTileTab, setDecorMode } from "../hex/HexPainterSD.mjs";
import { enableDungeonPainting, disableDungeonPainting } from "../dungeon/DungeonPainterSD.mjs";
import { isGeneratorExpanded, getGeneratorSeed, getGeneratorSettings } from "../dungeon/DungeonGeneratorSD.mjs";
// Side-effect import: loads the multi-level engine at startup so it can register the standalone
// mlSliders client setting + the renderTrayApp persistence hook (Levels/Links/Variation/Variety).
import "../dungeon/DungeonMultiLevelSD.mjs";
import { isHexFogEnabled } from "../hex/SDXHexFogSD.mjs";
import { isSoloMode } from "../hex/SoloHexMode.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

Hooks.on("sdx.decorAssetsImported", () => renderTray());

export class TrayApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "sdx-tray",
		tag: "div",
		position: {
			width: "auto",
			height: "auto",
		},
		window: {
			frame: false,
			positioned: false,
		},
	};

	static PARTS = {
		main: {
			template: "modules/shadowdark-extras/templates/sdx-tray/tray.hbs",
		},
	};

	// Static instance reference for easy access
	static _instance = null;

	constructor(data = {}, options = {}) {
		super(options);
		this.trayData = data;
		this._isExpanded = false;
		this._pinSearchTerm = "";
		this._scrollPositions = {}; // Store scroll positions for tile grids
		this._generatorExpanded = false; // Store procedural generator panel state
		try {
			const saved = globalThis.localStorage?.getItem("sdx.tomOverlaysCollapsed");
			this._tomOverlaysCollapsed = saved === "true";
		}
		catch{
			this._tomOverlaysCollapsed = false;
		}

		// Store static reference
		TrayApp._instance = this;
	}

	/**
     * Update the tray data and re-render
     * @param {Object} data - Tray data
     */
	updateData(data) {
		this._saveScrollPositions();
		this.trayData = data;
		this.render();
	}

	/**
     * Save scroll positions of tile grids and other UI state
     */
	_saveScrollPositions() {
		return saveTrayScrollPositions(this);
	}

	/**
     * Restore scroll positions of tile grids and other UI state
     */
	_restoreScrollPositions() {
		return restoreTrayScrollPositions(this);
	}

	/**
     * Toggle expanded state
     */
	toggleExpanded() {
		this._isExpanded = !this._isExpanded;
		this._applyExpandedState();
		// Close Tom panels if open (they're positioned off the handle/content)
		document.querySelector(".tom-scene-switcher-panel")?.remove();
		document.querySelector(".tom-cast-manager-panel")?.remove();
		document.querySelector(".tom-overlay-manager-panel")?.remove();
	}

	/**
     * Set expanded state
     */
	setExpanded(expanded) {
		this._isExpanded = expanded;
		this._applyExpandedState();
		// Close Tom panels if open
		document.querySelector(".tom-scene-switcher-panel")?.remove();
		document.querySelector(".tom-cast-manager-panel")?.remove();
		document.querySelector(".tom-overlay-manager-panel")?.remove();
	}

	/**
     * Apply the expanded state to the DOM
     */
	_applyExpandedState() {
		const elem = document.querySelector(".sdx-tray");
		if (elem) {
			elem.classList.toggle("expanded", this._isExpanded);
			// Flip the chevron so the user has a visual cue: right when
			// collapsed (click to open), left when expanded (click to close).
			const icon = elem.querySelector(".tray-handle-button-toggle i");
			if (icon) {
				icon.classList.toggle("fa-chevron-right", !this._isExpanded);
				icon.classList.toggle("fa-chevron-left", this._isExpanded);
			}
		}
		const viewMode = getViewMode();

		if (this._isExpanded && viewMode === "hexes") {
			enablePainting();
			disableDungeonPainting();
			// Enable POI preview if on symbols tab
			if (getActiveTileTab() === "symbols") {
				enablePreview();
			}
		}
		else if (this._isExpanded && viewMode === "decor") {
			setDecorMode(true);
			enablePainting();
			disableDungeonPainting();
			enablePreview();
		}
		else if (this._isExpanded && viewMode === "dungeons") {
			disablePainting();
			disablePreview();
			enableDungeonPainting();
		}
		else {
			disablePainting();
			disablePreview();
			disableDungeonPainting();
		}

		this._syncPoiSortPanel();
	}

	/**
     * Sync the POI Tile Sort panel visibility based on current mode
     */
	async _syncPoiSortPanel() {
		const viewMode = getViewMode();
		const isPoiMode = this._isExpanded && (
			(viewMode === "hexes" && getActiveTileTab() === "symbols")
            || viewMode === "decor"
		);
		const { PoiTileSortApp } = await import("../canvas/PoiTileSortSD.mjs");
		if (isPoiMode) PoiTileSortApp.show();
		else PoiTileSortApp.hide();
	}

	/**
     * Check if tray is expanded
     * @returns {boolean}
     */
	isExpanded() {
		return this._isExpanded;
	}

	/**
     * Prepare context data for the template
     */
	async _prepareContext(options) {
		// Tom Broadcast State
		let activeSceneId = null;
		let currentOverlays = [];
		try {
			const { TomStore } = await import("../tom/TomStore.mjs");
			activeSceneId = TomStore.activeSceneId || null;
			// Prefer new array, fall back to legacy single string via getter
			currentOverlays = TomStore.currentOverlays?.length ? [...TomStore.currentOverlays] : (TomStore.currentOverlay ? [TomStore.currentOverlay] : []);
		}
		catch(err) {
			// Ignore — TomStore not ready yet (tests/harness)
		}
		this._tomActiveSceneId = activeSceneId;

		// Derive overlay options inline for the Scenes tab (no handle button).
		// Same source as the old floating manager — now rendered as part of
		// the scenes-view so it lives where scenes live.
		const tomActiveSet = new Set(currentOverlays);
		const tomOverlayOptions = TOM_OVERLAYS.map(o => {
			const path = `${TOM_OVERLAY_BASE}${o.file}`;
			return { name: o.name, path, active: tomActiveSet.has(path) };
		});
		const tomCurrentOverlay = currentOverlays[0] ?? null;
		const tomCurrentOverlays = currentOverlays;
		const tomOverlayCount = currentOverlays.length;

		// Calculate POI scale percentage for display
		const poiScale = getPoiScale();
		const poiScalePercent = Math.round(poiScale * 100);

		return {
			...this.trayData,
			isExpanded: this._isExpanded,
			viewMode: getViewMode(),
			pinSearchTerm: this._pinSearchTerm,
			tomActiveSceneId: activeSceneId,
			tomCurrentOverlay,
			tomCurrentOverlays,
			tomOverlayCount,
			tomOverlayOptions,
			tomOverlaysCollapsed: this._tomOverlaysCollapsed,
			tomScenes: await this._getTomScenes(),
			tomFolders: await this._getTomFolders(),
			tintEnabled: isTintEnabled(),

			poiScale: poiScale,
			poiScalePercent: poiScalePercent,
			generatorExpanded: isGeneratorExpanded(),
			generatorSeed: getGeneratorSeed(),
			generatorSettings: getGeneratorSettings(),
			hexFogActive: isHexFogEnabled(canvas.scene?.id),
			isHexagonal: !!canvas?.grid?.isHexagonal,
			soloModeActive: isSoloMode(),
		};
	}

	/**
     * Get list of sections from TomStore
     */
	async _getTomScenes() {
		try {
			const { TomStore } = await import("../tom/TomStore.mjs");
			const scenes = Array.from(TomStore.scenes.values());
			// Add isVideo property to each scene for thumbnail rendering
			return scenes.map(scene => {
				const sceneData = scene.toJSON ? scene.toJSON() : scene;
				const bg = sceneData.background || "";
				const isVideo = /\.(webm|mp4)$/i.test(bg);
				return { ...sceneData, isVideo };
			});
		}
		catch(err) {
			console.error("Failed to load TomScenes:", err);
			return [];
		}
	}

	/**
     * Get folder data from TomStore, with scenes grouped inside each folder
     * @returns {Array} Array of { id, name, collapsed, scenes: [] }
     */
	async _getTomFolders() {
		try {
			const { TomStore } = await import("../tom/TomStore.mjs");
			const folders = TomStore.folders || [];
			return folders.map(folder => {
				const folderScenes = TomStore.getScenesInFolder(folder.id);
				const scenes = folderScenes.map(scene => {
					const sceneData = scene.toJSON ? scene.toJSON() : scene;
					const bg = sceneData.background || "";
					const isVideo = /\.(webm|mp4)$/i.test(bg);
					return { ...sceneData, isVideo };
				});
				return { ...folder, scenes };
			});
		}
		catch(err) {
			console.error("Failed to load TomFolders:", err);
			return [];
		}
	}

	/**
     * Attach event listeners after render
     */
	_onRender(context, options) {
		super._onRender(context, options);
		// Use requestAnimationFrame to ensure DOM is fully rendered before restoring scroll
		requestAnimationFrame(() => this._restoreScrollPositions());

		const elem = document.querySelector(".sdx-tray");
		if (!elem) return;

		this._bindHandleButtons(elem);
		this._bindDungeonEvents(elem);
		this._bindTomSceneEvents(elem);
		// Select party button
		elem.querySelector('[data-action="select-party"]')?.addEventListener("click", e => {
			e.preventDefault();
			selectPartyTokens();
		});

		// Toggle NPC visibility for players (GM only)
		elem.querySelector('[data-action="toggle-npc-visibility"]')?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			toggleHideNpcsFromPlayers();
		});

		this._bindPartyEvents(elem);

		// Clear selection button
		elem.querySelector(".button-clear")?.addEventListener("click", e => {
			e.preventDefault();
			clearTokenSelection();
		});

		this._bindPinListEvents(elem);
		// Hex Painter tab bindings
		this._bindHexPainterEvents(elem);
	}
}

// Register Handlebars helpers for the tray
Hooks.once("init", () => {
	// Helper to check equality
	Handlebars.registerHelper("eq", function(a, b) {
		return a === b;
	});

	// Helper for health overlay height
	Handlebars.registerHelper("healthOverlayHeight", function(hp) {
		return getHealthOverlayHeight(hp);
	});

	// Helper for multiplication
	Handlebars.registerHelper("multiply", function(a, b) {
		return (a || 0) * (b || 0);
	});

	// Helper for division
	Handlebars.registerHelper("divide", function(a, b) {
		if (!b || b === 0) return 0;
		return (a || 0) / b;
	});

	// Helper to check if value is in array
	Handlebars.registerHelper("includes", function(arr, value) {
		if (!Array.isArray(arr)) return false;
		return arr.includes(value);
	});

	// Helper for default values
	Handlebars.registerHelper("default", function(value, defaultValue) {
		return value ?? defaultValue;
	});

	// Helper for logical NOT
	Handlebars.registerHelper("not", function(value) {
		return !value;
	});

	// Helper for logical OR
	Handlebars.registerHelper("or", function(...args) {
		// Remove the Handlebars options object from the end
		args.pop();
		return args.some(Boolean);
	});

	// Helper for logical AND
	Handlebars.registerHelper("and", function(...args) {
		// Remove the Handlebars options object from the end
		args.pop();
		return args.every(Boolean);
	});
});

// TOM panel methods (overlay/cast/scene panels) extracted to tom-panels.mjs
Object.assign(TrayApp.prototype, TomPanels);
// Hex-painter control bindings extracted to hex-painter-bindings.mjs
Object.assign(TrayApp.prototype, HexPainterBindings);
// _onRender's bindings, one mixin per tray section. Each is a prototype
// method, so `this` is the application exactly as it was inline.
Object.assign(TrayApp.prototype, TrayHandleBindings);
Object.assign(TrayApp.prototype, DungeonBindings);
Object.assign(TrayApp.prototype, TomSceneBindings);
Object.assign(TrayApp.prototype, PinListBindings);
// Party tab card interactions (select / center / open sheet)
Object.assign(TrayApp.prototype, PartyBindings);
