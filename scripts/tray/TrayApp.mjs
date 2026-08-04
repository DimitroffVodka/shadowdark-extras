

import {
	setViewMode,
	getViewMode,
	cycleViewMode,
	selectPartyTokens,
	clearTokenSelection,
	getHealthOverlayHeight,
	renderTray,
	toggleHideNpcsFromPlayers,
} from "./TraySD.mjs";
import { saveTrayScrollPositions, restoreTrayScrollPositions } from "./tray-scroll-state.mjs";
import { TomPanels } from "./tom-panels.mjs";
import { HexPainterBindings } from "./hex-painter-bindings.mjs";
// Note: renderTray imported above is used by POI undo/redo handlers
import { showLeaderDialog, showMovementModeDialog } from "../combat/MarchingModeSD.mjs";
import { FormationSpawnerSD } from "../combat/FormationSpawnerSD.mjs";
import { PinPlacer, JournalPinManager, JournalPinRenderer } from "../journal/JournalPinsSD.mjs";
import { PinStyleEditorApp } from "../journal/PinStyleEditorSD.mjs";

import { PlaceableNotesSD } from "../journal/PlaceableNotesSD.mjs";

import { enablePainting, disablePainting, isTintEnabled, undoLastPoi, redoLastPoi, canUndoPoi, canRedoPoi, getPoiScale, enablePreview, disablePreview, getActiveTileTab, adjustPoiScale, rotatePoiLeft, rotatePoiRight, togglePoiMirror, getPoiMirror, setDecorMode } from "../hex/HexPainterSD.mjs";
import { unflattenTile, getDungeonFloorLevels, getFlattendDungeonLevels, flattenDungeonLevel } from "../canvas/TileFlattenSD.mjs";
import { setDungeonMode, selectFloorTile, selectWallTile, selectDoorTile, selectIntWallTile, selectIntDoorTile, enableDungeonPainting, disableDungeonPainting, setNoFoundryWalls, setWallShadows, setCurvedWalls, setDungeonBackground } from "../dungeon/DungeonPainterSD.mjs";
import { toggleGeneratorPanel, isGeneratorExpanded, generateDungeon, generateRandomSeed, getGeneratorSeed, setGeneratorSeed, getGeneratorSettings, setGeneratorSettings } from "../dungeon/DungeonGeneratorSD.mjs";
// Side-effect import: loads the multi-level engine at startup so it can register the standalone
// mlSliders client setting + the renderTrayApp persistence hook (Levels/Links/Variation/Variety).
import "../dungeon/DungeonMultiLevelSD.mjs";
import { isHexFogEnabled, setHexFogEnabled, getActiveHexFogEffect, setHexFogEffect, getAvailableHexFogEffects, isFogEffectsEnabled } from "../hex/SDXHexFogSD.mjs";
import { isSoloMode, toggleSoloMode } from "../hex/SoloHexMode.mjs";

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

		// Close Tom panels if open (they're positioned relative to handle)
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
		try {
			const { TomStore } = await import("../tom/TomStore.mjs");
			activeSceneId = TomStore.activeSceneId || null;
		}
		catch(err) {
			// Ignore
		}
		this._tomActiveSceneId = activeSceneId;

		// Calculate POI scale percentage for display
		const poiScale = getPoiScale();
		const poiScalePercent = Math.round(poiScale * 100);

		return {
			...this.trayData,
			isExpanded: this._isExpanded,
			viewMode: getViewMode(),
			pinSearchTerm: this._pinSearchTerm,
			tomActiveSceneId: activeSceneId,
			showTomOverlays: !!activeSceneId,
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


		// Toggle button - click to expand/collapse
		elem.querySelector(".tray-handle-button-toggle")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			this.toggleExpanded();
		});

		// View cycle button
		elem.querySelector(".tray-handle-button-viewcycle")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			cycleViewMode();
		});

		// GM Tools Buttons
		elem.querySelector(".tray-handle-button-tool[data-action='tom-scene-switcher']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			this._toggleTomScenePanel();
		});

		elem.querySelector(".tray-handle-button-tool[data-action='tom-overlay-manager']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			this._toggleTomOverlayPanel();
		});

		// GM Tools Buttons
		elem.querySelector(".tray-handle-button-tool[data-action='leader']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			showLeaderDialog();
		});

		elem.querySelector(".tray-handle-button-tool[data-action='marching']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			showMovementModeDialog();
		});

		elem.querySelector(".tray-handle-button-tool[data-action='formation']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			FormationSpawnerSD.show();
		});

		elem.querySelector(".tray-handle-button-tool[data-action='add-pin']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			PinPlacer.activate();
		});


		elem.querySelector(".tray-handle-button-tool[data-action='pin-list']")?.addEventListener("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			await setViewMode("pins");
			this.setExpanded(true);
		});


		// Light Tracker Button
		elem.querySelector(".tray-handle-button-tool[data-action='light-tracker']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			// Use SDX AppV2 Light Tracker if available, fallback to system tracker
			if (game.shadowdarkExtras?.lightTracker?.toggle) {
				game.shadowdarkExtras.lightTracker.toggle();
			}
			else if (game.shadowdark?.lightSourceTracker?.toggleInterface) {
				game.shadowdark.lightSourceTracker.toggleInterface();
			}
			else {
				ui.notifications.warn("Light Source Tracker not found.");
			}
		});

		// Carousing Button
		elem.querySelector(".tray-handle-button-tool[data-action='carousing']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			if (window.sdxOpenCarousingOverlay) {
				window.sdxOpenCarousingOverlay();
			}
			else {
				ui.notifications.warn("Carousing system not ready.");
			}
		});

		// Drawing Tools Button
		elem.querySelector(".tray-handle-button-tool[data-action='sdx-drawing']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			if (game.shadowdarkExtras?.drawingToolbar?.toggle) {
				game.shadowdarkExtras.drawingToolbar.toggle();
			}
			else {
				ui.notifications.warn("Drawing tools not ready.");
			}
		});

		// Maphub Launcher Button
		elem.querySelector(".tray-handle-button-tool[data-action='sdx-maphub-launcher']")?.addEventListener("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			if (!game.user.isGM) return;
			const { MaphubLauncherApp } = await import("../MaphubLauncherApp.mjs");
			new MaphubLauncherApp().render(true);
		});

		// SDX Coords Toggle Button
		elem.querySelector(".tray-handle-button-tool[data-action='sdx-coords']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			if (window.SDXCoordinates) {
				window.SDXCoordinates.toggle();
			}
			else {
				ui.notifications.warn("Coordinate display not supported on this map.");
			}
		});

		// Hex Tooltip Toggle Button
		elem.querySelector(".tray-handle-button-tool[data-action='sdx-hex-tooltip']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			if (!canvas?.grid?.isHexagonal) {
				ui.notifications.warn("Hex tooltips only work on hex-grid scenes.");
				return;
			}
			const active = window.SDXHexTooltip?.toggle();
			e.currentTarget.classList.toggle("active", !!active);
		});

		// Hex Fog Toggle Button (GM only)
		elem.querySelector(".tray-handle-button-tool[data-action='sdx-hex-fog']")?.addEventListener("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			if (!canvas?.grid?.isHexagonal) {
				ui.notifications.warn("Hex fog only works on hex-grid scenes.");
				return;
			}
			const btn = e.currentTarget;
			const sceneId = canvas.scene?.id;
			const currentlyEnabled = isHexFogEnabled(sceneId);
			await setHexFogEnabled(sceneId, !currentlyEnabled);
			btn.classList.toggle("active", !currentlyEnabled);
		});

		// Hex Fog Effects Context Menu (right-click on hex fog button)
		elem.querySelector(".tray-handle-button-tool[data-action='sdx-hex-fog']")?.addEventListener("contextmenu", e => {
			e.preventDefault();
			e.stopPropagation();
			if (!game.user.isGM) return;
			if (!isFogEffectsEnabled()) return;
			if (!canvas?.grid?.isHexagonal || !isHexFogEnabled(canvas.scene?.id)) {
				ui.notifications.warn("Enable hex fog first.");
				return;
			}

			// Remove any existing menu
			document.querySelector(".sdx-fog-effect-menu")?.remove();

			const sceneId = canvas.scene.id;
			const current = getActiveHexFogEffect(sceneId);
			const effects = getAvailableHexFogEffects();

			const menu = document.createElement("div");
			menu.className = "sdx-fog-effect-menu";

			// Header
			const header = document.createElement("div");
			header.className = "sdx-fog-effect-menu-header";
			header.textContent = "Fog Effects";
			menu.appendChild(header);

			// "None" option
			const noneItem = document.createElement("div");
			noneItem.className = `sdx-fog-effect-menu-item${!current ? " active" : ""}`;
			noneItem.innerHTML = "<i class=\"fa-solid fa-ban\"></i><span>None</span>";
			noneItem.addEventListener("click", () => {
				setHexFogEffect(sceneId, null);
				menu.remove();
			});
			menu.appendChild(noneItem);

			// Effect options
			for (const fx of effects) {
				const item = document.createElement("div");
				item.className = `sdx-fog-effect-menu-item${current === fx.name ? " active" : ""}`;
				item.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i><span>${fx.label}</span>`;
				item.addEventListener("click", () => {
					setHexFogEffect(sceneId, fx.name);
					menu.remove();
				});
				menu.appendChild(item);
			}

			// Position near the button
			const rect = e.currentTarget.getBoundingClientRect();
			menu.style.position = "fixed";
			menu.style.left = `${rect.left}px`;
			menu.style.top = `${rect.bottom + 4}px`;
			menu.style.zIndex = "10001";
			document.body.appendChild(menu);

			// Close on outside click
			const closeMenu = ev => {
				if (!menu.contains(ev.target)) {
					menu.remove();
					document.removeEventListener("mousedown", closeMenu, true);
				}
			};
			setTimeout(() => document.addEventListener("mousedown", closeMenu, true), 0);
		});

		// Solo Hex Mode Toggle Button (GM only)
		elem.querySelector(".tray-handle-button-tool[data-action='sdx-solo-mode']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			const active = toggleSoloMode();
			e.currentTarget.classList.toggle("active", active);
		});

		// SDX Roller Button
		elem.querySelector(".tray-handle-button-tool[data-action='sdx-roller']")?.addEventListener("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			const { SDXRollerApp } = await import("./SDXRollerApp.mjs");
			new SDXRollerApp().render(true);
		});

		// POI Undo Button
		elem.querySelector(".tray-handle-button-tool[data-action='poi-undo']")?.addEventListener("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			await undoLastPoi();
			elem.querySelector(".poi-undo-btn")?.classList.toggle("disabled", !canUndoPoi());
			elem.querySelector(".poi-redo-btn")?.classList.toggle("disabled", !canRedoPoi());
		});

		// POI Redo Button
		elem.querySelector(".tray-handle-button-tool[data-action='poi-redo']")?.addEventListener("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			await redoLastPoi();
			elem.querySelector(".poi-undo-btn")?.classList.toggle("disabled", !canUndoPoi());
			elem.querySelector(".poi-redo-btn")?.classList.toggle("disabled", !canRedoPoi());
		});

		// POI Scale Down Button
		elem.querySelector(".tray-handle-button-tool[data-action='poi-scale-down']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			adjustPoiScale(-0.1);
			this._updatePoiScaleDisplay();
		});

		// POI Scale Up Button
		elem.querySelector(".tray-handle-button-tool[data-action='poi-scale-up']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			adjustPoiScale(0.1);
			this._updatePoiScaleDisplay();
		});

		// POI Rotate Left Button
		elem.querySelector(".tray-handle-button-tool[data-action='poi-rotate-left']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			rotatePoiLeft();
		});

		// POI Rotate Right Button
		elem.querySelector(".tray-handle-button-tool[data-action='poi-rotate-right']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			rotatePoiRight();
		});

		// POI Mirror Button
		elem.querySelector(".tray-handle-button-tool[data-action='poi-mirror']")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			togglePoiMirror();
			e.currentTarget.classList.toggle("active", getPoiMirror());
		});

		// Tab buttons
		elem.querySelectorAll(".tray-tab-button").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const view = btn.dataset.view;
				if (view) {
					await setViewMode(view);
					// Enable/disable painting based on view
					if (view === "hexes" && this._isExpanded) {
						enablePainting();
						disableDungeonPainting();
						if (getActiveTileTab() === "symbols") {
							enablePreview();
						}
					}
					else if (view === "decor" && this._isExpanded) {
						setDecorMode(true);
						enablePainting();
						disableDungeonPainting();
						enablePreview();
					}
					else if (view === "dungeons" && this._isExpanded) {
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
			});
		});

		/* ------------------------------------------- */
		/*  DUNGEON PAINTER TAB ACTIONS               */
		/* ------------------------------------------- */

		// Dungeon mode tabs (Tiles / Doors)
		elem.querySelectorAll(".dungeon-mode-tab").forEach(tab => {
			tab.addEventListener("click", e => {
				e.preventDefault();
				e.stopPropagation();
				const mode = tab.dataset.dungeonMode;
				if (mode) {
					setDungeonMode(mode);
					renderTray();
				}
			});
		});

		// Dungeon floor tile selection
		elem.querySelectorAll(".dungeon-tile-thumb[data-dungeon-tile]").forEach(tile => {
			tile.addEventListener("click", e => {
				e.preventDefault();
				e.stopPropagation();
				const tilePath = tile.dataset.dungeonTile;
				if (tilePath) {
					selectFloorTile(tilePath);
					elem.querySelectorAll(".dungeon-tile-thumb[data-dungeon-tile]").forEach(
						t => t.classList.remove("active")
					);
					tile.classList.add("active");
				}
			});
		});

		// Dungeon door tile selection
		elem.querySelectorAll(".dungeon-tile-thumb[data-dungeon-door]").forEach(tile => {
			tile.addEventListener("click", e => {
				e.preventDefault();
				e.stopPropagation();
				const tilePath = tile.dataset.dungeonDoor;
				if (tilePath) {
					selectDoorTile(tilePath);
					elem.querySelectorAll(".dungeon-tile-thumb[data-dungeon-door]").forEach(
						t => t.classList.remove("active")
					);
					tile.classList.add("active");
				}
			});
		});

		// Dungeon wall tile selection
		elem.querySelectorAll(".dungeon-tile-thumb[data-dungeon-wall]").forEach(tile => {
			tile.addEventListener("click", e => {
				e.preventDefault();
				e.stopPropagation();
				const tilePath = tile.dataset.dungeonWall;
				if (tilePath) {
					selectWallTile(tilePath);
					elem.querySelectorAll(".dungeon-tile-thumb[data-dungeon-wall]").forEach(
						t => t.classList.remove("active")
					);
					tile.classList.add("active");
				}
			});
		});

		// Interior door tile selection
		elem.querySelectorAll(".dungeon-intdoor-thumb[data-dungeon-intdoor]").forEach(tile => {
			tile.addEventListener("click", e => {
				e.preventDefault();
				e.stopPropagation();
				const tilePath = tile.dataset.dungeonIntdoor;
				if (tilePath) {
					selectIntDoorTile(tilePath);
					elem.querySelectorAll(".dungeon-intdoor-thumb[data-dungeon-intdoor]").forEach(
						t => t.classList.remove("active")
					);
					tile.classList.add("active");
				}
			});
		});

		// Interior wall tile selection
		elem.querySelectorAll(".dungeon-intwall-thumb[data-dungeon-intwall]").forEach(tile => {
			tile.addEventListener("click", e => {
				e.preventDefault();
				e.stopPropagation();
				const tilePath = tile.dataset.dungeonIntwall;
				if (tilePath) {
					selectIntWallTile(tilePath);
					elem.querySelectorAll(".dungeon-intwall-thumb[data-dungeon-intwall]").forEach(
						t => t.classList.remove("active")
					);
					tile.classList.add("active");
				}
			});
		});

		// Dungeon "No Foundry Walls" toggle
		const noWallsCheckbox = elem.querySelector(".dungeon-no-walls-checkbox");
		if (noWallsCheckbox) {
			noWallsCheckbox.addEventListener("change", e => {
				setNoFoundryWalls(e.target.checked);
				renderTray();
			});
		}

		// Dungeon "Wall Shadows" toggle
		const wallShadowsCheckbox = elem.querySelector(".dungeon-wall-shadows-checkbox");
		if (wallShadowsCheckbox) {
			wallShadowsCheckbox.addEventListener("change", e => {
				setWallShadows(e.target.checked);
			});
		}

		// Dungeon "Curved Walls" toggle (re-walls painted floors with smoothed walls)
		const curvedWallsCheckbox = elem.querySelector(".dungeon-curved-walls-checkbox");
		if (curvedWallsCheckbox) {
			curvedWallsCheckbox.addEventListener("change", e => {
				setCurvedWalls(e.target.checked);
			});
		}

		// Dungeon "Flatten Level" button
		elem.querySelector(".dungeon-flatten-level-btn")?.addEventListener("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			const byElevation = getDungeonFloorLevels();
			const elevations = Object.keys(byElevation).map(Number).sort((a, b) => a - b);
			if (!elevations.length) {
				ui.notifications.warn("No dungeon floor tiles found on this scene.");
				return;
			}
			let elevation;
			if (elevations.length === 1) {
				elevation = elevations[0];
			}
			else {
				const options = elevations.map(el =>
					`<option value="${el}">Elevation ${el} — ${byElevation[el].length} tiles</option>`
				).join("");
				elevation = await new Promise(resolve => {
					new foundry.applications.api.DialogV2({
						window: { title: "Flatten Dungeon Level" },
						content: `<div style="padding:8px 0"><label style="display:block;margin-bottom:6px">Select level to flatten:</label><select id="sdx-fl-sel" style="width:100%">${options}</select></div>`,
						buttons: [
							{
								action: "ok",
								icon: "fas fa-layer-group",
								label: "Flatten",
								default: true,
								callback: (event, button, dlg) => {
									const el = dlg.element.querySelector("#sdx-fl-sel");
									resolve(el ? Number(el.value) : null);
								},
							},
							{ action: "cancel", label: "Cancel", callback: () => resolve(null) },
						],
						close: () => resolve(null),
					}).render({ force: true });
				});
			}
			if (elevation !== null && elevation !== undefined) {
				await flattenDungeonLevel(elevation);
			}
		});

		// Dungeon "Unflatten Level" button
		elem.querySelector(".dungeon-unflatten-level-btn")?.addEventListener("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			const flattenedTiles = getFlattendDungeonLevels();
			if (!flattenedTiles.length) {
				ui.notifications.warn("No flattened dungeon levels found on this scene.");
				return;
			}
			let tileDoc;
			if (flattenedTiles.length === 1) {
				tileDoc = flattenedTiles[0];
			}
			else {
				const options = flattenedTiles.map(t => {
					const el = t.flags?.["shadowdark-extras"]?.dungeonFlattenedLevel ?? "?";
					const cnt = t.flags?.["shadowdark-extras"]?.originalTileCount ?? "?";
					return `<option value="${t.id}">Elevation ${el} (${cnt} tiles)</option>`;
				}).join("");
				tileDoc = await new Promise(resolve => {
					new foundry.applications.api.DialogV2({
						window: { title: "Unflatten Dungeon Level" },
						content: `<div style="padding:8px 0"><label style="display:block;margin-bottom:6px">Select level to unflatten:</label><select id="sdx-ufl-sel" style="width:100%">${options}</select></div>`,
						buttons: [
							{
								action: "ok",
								icon: "fas fa-layer-group",
								label: "Unflatten",
								default: true,
								callback: (event, button, dlg) => {
									const el = dlg.element.querySelector("#sdx-ufl-sel");
									const id = el?.value;
									resolve(flattenedTiles.find(t => t.id === id) ?? null);
								},
							},
							{ action: "cancel", label: "Cancel", callback: () => resolve(null) },
						],
						close: () => resolve(null),
					}).render({ force: true });
				});
			}
			if (tileDoc) {
				await unflattenTile(tileDoc);
			}
		});

		// Dungeon background select
		const bgSelect = elem.querySelector(".dungeon-background-select");
		if (bgSelect) {
			bgSelect.addEventListener("change", e => {
				setDungeonBackground(e.target.value);
			});
		}

		// Dungeon Generator toggle
		elem.querySelector(".dungeon-generator-toggle")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			toggleGeneratorPanel();
			renderTray();
		});

		// Dungeon Generator close button
		elem.querySelector(".dungeon-generator-close")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			toggleGeneratorPanel();
			renderTray();
		});

		// Generator slider value displays
		elem.querySelectorAll(".dgen-row input[type='range']").forEach(slider => {
			slider.addEventListener("input", e => {
				const valueSpan = e.target.closest(".dgen-row").querySelector(".dgen-value");
				if (valueSpan) valueSpan.textContent = e.target.value;
			});
		});

		// Generator textured toggle - hide/show color row and thickness
		const texturedCheckbox = elem.querySelector(".dgen-textured");
		const colorRow = elem.querySelector(".dgen-color-row");
		const thicknessRow = elem.querySelector(".dgen-thickness")?.closest(".dgen-row");
		if (texturedCheckbox) {
			const updateTexturedVisibility = checked => {
				if (colorRow) colorRow.style.display = checked ? "none" : "";
				if (thicknessRow) thicknessRow.style.display = checked ? "none" : "";
			};
			updateTexturedVisibility(texturedCheckbox.checked);
			texturedCheckbox.addEventListener("change", e => {
				updateTexturedVisibility(e.target.checked);
			});
		}

		// Multi-level (Levels >= 2) uses inter-floor connection stairs instead of the
		// decorative Stairs Up/Down, so hide those rows. Clutter still applies (it's decor).
		const levelsSlider = elem.querySelector(".dgen-levels");
		if (levelsSlider) {
			const decorRows = [".dgen-stairs", ".dgen-stairsdown"]
				.map(s => elem.querySelector(s)?.closest(".dgen-row")).filter(Boolean);
			const updateMultiLevelUI = n => {
				const multi = parseInt(n) >= 2;
				for (const row of decorRows) row.style.display = multi ? "none" : "";
			};
			updateMultiLevelUI(levelsSlider.value);
			levelsSlider.addEventListener("input", e => updateMultiLevelUI(e.target.value));
		}

		// Generator seed refresh
		elem.querySelector(".dgen-seed-refresh")?.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			const newSeed = generateRandomSeed();
			setGeneratorSeed(newSeed);
			const seedInput = elem.querySelector(".dgen-seed");
			if (seedInput) seedInput.value = newSeed;
		});

		// Restore persisted generation style into the Style selector.
		const styleSel = elem.querySelector(".dgen-style");
		if (styleSel) styleSel.value = getGeneratorSettings().style || "rooms";

		// Generator apply button
		elem.querySelector(".dgen-apply")?.addEventListener("click", async e => {
			e.preventDefault();
			e.stopPropagation();

			const seedInput = elem.querySelector(".dgen-seed");
			const seed = seedInput?.value || getGeneratorSeed();
			setGeneratorSeed(seed);

			const isTextured = elem.querySelector(".dgen-textured")?.checked ?? false;
			const isWallShadows = elem.querySelector(".dgen-wall-shadows")?.checked ?? false;
			const rooms = parseInt(elem.querySelector(".dgen-rooms")?.value || "10");
			const dens = parseFloat(elem.querySelector(".dgen-density")?.value || "0.8");
			const branch = parseFloat(elem.querySelector(".dgen-branching")?.value || "0.5");
			const roomSz = parseFloat(elem.querySelector(".dgen-roomsize")?.value || "0.5");
			const sym = elem.querySelector(".dgen-symmetry")?.checked ?? true;
			const stairsVal = parseInt(elem.querySelector(".dgen-stairs")?.value || "0");
			const stairsDownVal = parseInt(elem.querySelector(".dgen-stairsdown")?.value || "0");
			const clutterVal = parseInt(elem.querySelector(".dgen-clutter")?.value || "0");
			const decorLightsVal = parseInt(elem.querySelector(".dgen-decor-lights")?.value || "0");
			const wColor = elem.querySelector(".dgen-wall-color")?.value || "#5C3D3D";
			const thick = isTextured ? 20 : parseInt(
				elem.querySelector(".dgen-thickness")?.value || "20"
			);

			const styleVal = elem.querySelector(".dgen-style")?.value;
			const style = ["cave", "mixed", "maze", "rogue", "digger", "uniform"].includes(styleVal) ? styleVal : "rooms";
			const useBiomes = elem.querySelector(".dgen-biomes")?.checked ?? false;

			// Persist settings
			setGeneratorSettings({
				rooms, density: dens, branching: branch, roomSize: roomSz,
				symmetry: sym, stairs: stairsVal, stairsDown: stairsDownVal, clutter: clutterVal, decorLights: decorLightsVal,
				textured: isTextured, wallShadows: isWallShadows, wallColor: wColor, thickness: thick, style, biomes: useBiomes,
			});

			const config = {
				seed,
				roomCount: rooms,
				density: dens,
				branching: branch,
				roomSizeBias: roomSz,
				symmetry: sym,
				stairs: stairsVal,
				stairsDown: stairsDownVal,
				clutter: clutterVal,
				decorLights: decorLightsVal,
				useTexture: isTextured,
				wallShadows: isWallShadows,
				wallColor: wColor,
				wallThickness: thick,
				style,
				biomes: useBiomes,
			};

			const levels = parseInt(elem.querySelector(".dgen-levels")?.value || "1");
			const links = parseInt(elem.querySelector(".dgen-links")?.value || "1");
			if (levels >= 2) {
				// Multi-level dungeon — standalone engine, loaded on demand.
				const variation = parseFloat(elem.querySelector(".dgen-variation")?.value ?? "1");
				const connectorVariety = parseFloat(
					elem.querySelector(".dgen-variety")?.value ?? "0.4"
				);
				const { generateMultiLevelDungeon } = await import("../dungeon/DungeonMultiLevelSD.mjs");
				await generateMultiLevelDungeon({
					...config, levelCount: levels, connectionsPerPair: links, variation, connectorVariety,
				});
			}
			else {
				await generateDungeon(config);
			}
		});


		/* ------------------------------------------- */
		/*  SCENES TAB ACTIONS                        */
		/* ------------------------------------------- */

		// Create Scene
		elem.querySelector("[data-action='create-scene']")?.addEventListener("click", async e => {
			e.preventDefault();
			const { TomSceneEditor } = await import("../tom/TomEditors.mjs");
			new TomSceneEditor().render(true);
		});

		// Create Folder
		elem.querySelector("[data-action='create-folder']")?.addEventListener("click", async e => {
			e.preventDefault();
			const name = await this._promptFolderName("Create Folder", "New Folder");
			if (!name) return;
			const { TomStore } = await import("../tom/TomStore.mjs");
			TomStore.createFolder(name);
			this.render();
		});

		// Stop Broadcast (Header Button)
		elem.querySelector("[data-action='stop-broadcast']")?.addEventListener("click", async e => {
			e.preventDefault();
			const { TomSocketHandler } = await import("../tom/TomSocketHandler.mjs");
			const { TomStore } = await import("../tom/TomStore.mjs");
			const activeSceneId = TomStore.activeSceneId;
			const activeScene = activeSceneId ? TomStore.scenes.get(activeSceneId) : null;
			const outAnimation = activeScene?.outAnimation || "fade";
			TomSocketHandler.emitStopBroadcast(outAnimation);
		});

		// Folder Actions
		elem.querySelectorAll("[data-action='toggle-folder']").forEach(header => {
			header.addEventListener("click", async e => {
				// Don't toggle if clicking an action button inside the header
				if (e.target.closest("[data-action='rename-folder']") || e.target.closest("[data-action='delete-folder']")) return;
				e.preventDefault();
				const folderId = header.dataset.folderId;
				const { TomStore } = await import("../tom/TomStore.mjs");
				TomStore.toggleFolderCollapsed(folderId);
				this.render();
			});
		});

		elem.querySelectorAll("[data-action='rename-folder']").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const folderId = btn.dataset.folderId;
				const currentName = btn.dataset.folderName;
				const newName = await this._promptFolderName("Rename Folder", currentName);
				if (!newName) return;
				const { TomStore } = await import("../tom/TomStore.mjs");
				TomStore.renameFolder(folderId, newName);
				this.render();
			});
		});

		elem.querySelectorAll("[data-action='delete-folder']").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const folderId = btn.dataset.folderId;
				const folderName = btn.dataset.folderName;
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					window: { title: "Delete Folder" },
					content: `<p>Delete folder <strong>${folderName}</strong>?</p><p>Scenes inside will become uncategorized.</p>`,
					modal: true,
				});
				if (!confirmed) return;
				const { TomStore } = await import("../tom/TomStore.mjs");
				TomStore.deleteFolder(folderId);
			});
		});

		// Drag-drop onto folders and uncategorized container
		elem.querySelectorAll(".scene-folder, .scene-uncat-container").forEach(dropZone => {
			const folderId = dropZone.dataset.folderId || null;

			dropZone.addEventListener("dragover", e => {
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				dropZone.classList.add("drag-over");
			});
			dropZone.addEventListener("dragleave", e => {
				if (!dropZone.contains(e.relatedTarget)) {
					dropZone.classList.remove("drag-over");
				}
			});
			dropZone.addEventListener("drop", async e => {
				e.preventDefault();
				e.stopPropagation();
				dropZone.classList.remove("drag-over");

				const draggedSceneId = e.dataTransfer.getData("text/plain");
				if (!draggedSceneId) return;

				// Check if this is a reorder within the same container or a folder move
				const targetCard = e.target.closest(".scene-card");
				const targetFolderId = folderId || null;

				const { TomStore } = await import("../tom/TomStore.mjs");
				const draggedScene = TomStore.scenes.get(draggedSceneId);
				if (!draggedScene) return;

				const currentFolderId = draggedScene.folderId || null;

				if (currentFolderId !== targetFolderId) {
					// Moving to a different folder
					TomStore.moveSceneToFolder(draggedSceneId, targetFolderId);
				}
				else if (targetCard) {
					// Same folder — reorder
					const targetId = targetCard.dataset.sceneId;
					if (draggedSceneId === targetId) return;

					const currentScenes = Array.from(TomStore.scenes.values());
					const sceneIds = currentScenes.map(s => s.id);
					const draggedIndex = sceneIds.indexOf(draggedSceneId);
					const targetIndex = sceneIds.indexOf(targetId);
					if (draggedIndex === -1 || targetIndex === -1) return;

					sceneIds.splice(draggedIndex, 1);
					sceneIds.splice(targetIndex, 0, draggedSceneId);
					TomStore.reorderScenes(sceneIds);
				}
			});
		});

		// Scene Card Actions
		elem.querySelectorAll(".scene-card").forEach(card => {
			const sceneId = card.dataset.sceneId;

			// Activate Scene (Broadcast) - Clicking the thumbnail/name
			card.querySelector(".scene-card-activate")?.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const { TomSocketHandler } = await import("../tom/TomSocketHandler.mjs");
				const { TomStore } = await import("../tom/TomStore.mjs");
				const scene = TomStore.scenes.get(sceneId);
				const inAnimation = scene?.inAnimation || "fade";
				TomSocketHandler.emitBroadcastScene(sceneId, inAnimation);
			});

			// Edit Scene
			card.querySelector("[data-action='edit-scene']")?.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const { TomSceneEditor } = await import("../tom/TomEditors.mjs");
				new TomSceneEditor(sceneId).render(true);
			});

			// Delete Scene
			card.querySelector("[data-action='delete-scene']")?.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const sceneName = card.querySelector(".scene-name").textContent;

				const confirmed = await foundry.applications.api.DialogV2.confirm({
					window: { title: "Delete Scene" },
					content: `<p>Are you sure you want to delete <strong>${sceneName}</strong>?</p><p>This action cannot be undone.</p>`,
					modal: true,
				});

				if (confirmed) {
					const { TomStore } = await import("../tom/TomStore.mjs");
					TomStore.deleteItem(sceneId, "scene");
					ui.notifications.info(`Scene "${sceneName}" deleted.`);
				}
			});

			// Drag and Drop — set data for folder-level drop handler
			card.addEventListener("dragstart", e => {
				e.stopPropagation();
				card.classList.add("dragging");
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setData("text/plain", sceneId);
			});

			card.addEventListener("dragend", e => {
				e.stopPropagation();
				card.classList.remove("dragging");
				elem.querySelectorAll(".scene-card").forEach(c => c.classList.remove("drag-over"));
				elem.querySelectorAll(".scene-folder, .scene-uncat-container").forEach(
					z => z.classList.remove("drag-over")
				);
			});

			card.addEventListener("dragover", e => {
				e.preventDefault();
				e.stopPropagation();
				e.dataTransfer.dropEffect = "move";
				const draggingCard = elem.querySelector(".scene-card.dragging");
				if (draggingCard && draggingCard !== card) {
					card.classList.add("drag-over");
				}
			});

			card.addEventListener("dragleave", e => {
				e.stopPropagation();
				if (!card.contains(e.relatedTarget)) {
					card.classList.remove("drag-over");
				}
			});
		});

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

		// Clear selection button
		elem.querySelector(".button-clear")?.addEventListener("click", e => {
			e.preventDefault();
			clearTokenSelection();
		});


		// Pin/Note List Pan Action
		elem.querySelectorAll(".pin-control").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();

				const action = btn.dataset.action;
				const entry = btn.closest(".pin-entry");
				const id = entry.dataset.id;

				if (!id) return;

				if (action === "pan") {
					const x = parseFloat(entry.dataset.x);
					const y = parseFloat(entry.dataset.y);
					if (!isNaN(x) && !isNaN(y)) {
						canvas.animatePan({ x, y, scale: 1.5, duration: 500 });
					}
				}
				else if (action === "ping-pin") {
					if (!JournalPinRenderer.getContainer()) return;
					const pin = JournalPinRenderer.getContainer().children.find(
						c => c.pinData?.id === id
					);

					if (game.user.isGM) {
						if (pin && pin.animatePing) pin.animatePing("ping");
						game.socket.emit("module.shadowdark-extras", {
							type: "pingPin",
							sceneId: canvas.scene?.id,
							pinId: id,
						});
					}
					else {
						ui.notifications.warn("Only GM can ping pins.");
					}
				}
				else if (action === "bring-players") {
					const x = parseFloat(entry.dataset.x);
					const y = parseFloat(entry.dataset.y);

					if (game.user.isGM) {
						if (!isNaN(x) && !isNaN(y)) {
							canvas.animatePan({ x, y, scale: 1.5, duration: 500 });
							if (JournalPinRenderer.getContainer()) {
								const pin = JournalPinRenderer.getContainer().children.find(
									c => c.pinData?.id === id
								);
								if (pin && pin.animatePing) pin.animatePing("bring");
							}
							game.socket.emit("module.shadowdark-extras", {
								type: "panToPin",
								x: x,
								y: y,
								sceneId: canvas.scene?.id,
								pinId: id,
							});
						}
					}
					else {
						ui.notifications.warn("Only GM can bring players.");
					}
				}
				else if (action === "edit-pin") {
					const pinData = JournalPinManager.get(id);
					if (pinData) {
						new PinStyleEditorApp({ pinId: id }).render(true);
					}
				}
				else if (action === "toggle-gm-only") {
					const pinData = JournalPinManager.get(id);
					if (pinData) {
						if (game.user.isGM) {
							const current = pinData.gmOnly || false;
							await JournalPinManager.update(id, { gmOnly: !current });
						}
						else {
							ui.notifications.warn("Only GM can toggle visibility.");
						}
					}
				}
				else if (action === "toggle-vision") {
					const pinData = JournalPinManager.get(id);
					if (pinData) {
						if (game.user.isGM) {
							const current = pinData.requiresVision || false;
							await JournalPinManager.update(id, { requiresVision: !current });
						}
						else {
							ui.notifications.warn("Only GM can toggle vision requirement.");
						}
					}
				}
				else if (action === "delete-pin") {
					const confirmed = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Delete Pin" },
						content: "<p>Are you sure you want to delete this pin?</p>",
						modal: true,
					});
					if (confirmed) await JournalPinManager.delete(id);
				}
				else if (action === "copy-style") {
					const pinData = JournalPinManager.get(id);
					if (pinData) {
						JournalPinManager.copyStyle(pinData);
					}
				}
				else if (action === "paste-style") {
					await JournalPinManager.pasteStyle(id);
				}
				else if (action === "duplicate-pin") {
					await JournalPinManager.duplicate(id);
				}
				else if (action === "ungroup-pin") {
					if (game.user.isGM) await JournalPinManager.movePin(id, null);
				}
			});
		});

		// ───────────────────────── PIN FOLDERS (GM) ─────────────────────────
		const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;")
			.replace(/</g, "&lt;").replace(/>/g, "&gt;");

		const promptFolderName = async (title, initial = "") => {
			return foundry.applications.api.DialogV2.prompt({
				window: { title },
				content: `<div class="form-group"><label>Folder Name</label>
                    <input type="text" name="name" value="${esc(initial)}" autofocus></div>`,
				ok: {
					label: "OK",
					callback: (event, button) => button.form.elements.name.value.trim(),
				},
			}).catch(() => null);
		};

		const ICON_DIR = "modules/shadowdark-extras/assets/icons/";
		const FilePickerImpl = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;

		const editFolderDialog = async folderId => {
			const f = JournalPinManager.listFolders().find(x => x.id === folderId);
			if (!f) return;
			const content = `
                <div class="form-group"><label>Name</label>
                    <input type="text" name="name" value="${esc(f.name)}"></div>
                <div class="form-group"><label>Color</label>
                    <input type="color" name="color" value="${esc(f.color || "#85733f")}"></div>
                <div class="form-group"><label>Scope</label>
                    <select name="scope">
                        <option value="scene" ${f.scope !== "world" ? "selected" : ""}>This scene only</option>
                        <option value="world" ${f.scope === "world" ? "selected" : ""}>All scenes (world)</option>
                    </select>
                    <p class="notes">World folders appear on every scene; pins still belong to their own scene.</p></div>
                <div class="form-group"><label>Icon</label>
                    <div class="form-fields">
                        <input type="text" name="icon" value="${esc(f.icon || "")}"
                            placeholder="image path or fa-solid fa-skull">
                        <button type="button" class="sdx-folder-icon-browse" title="Browse Files">
                            <i class="fas fa-file-import fa-fw"></i></button>
                    </div>
                    <p class="notes">Pick an image, or type a FontAwesome class.</p></div>`;

			// Wire the Browse button once the dialog renders (FilePicker starts in assets/icons/)
			Hooks.once("renderDialogV2", (app, html) => {
				const root = html instanceof HTMLElement ? html : (html?.[0] ?? app.element);
				const input = root?.querySelector('[name="icon"]');
				root?.querySelector(".sdx-folder-icon-browse")?.addEventListener("click", () => {
					const cur = (input?.value && input.value.includes("/")) ? input.value : ICON_DIR;
					new FilePickerImpl({
						type: "image",
						current: cur,
						callback: path => {
							if (input) input.value = path;
						},
					}).browse();
				});
			});

			const data = await foundry.applications.api.DialogV2.prompt({
				window: { title: "Edit Folder" },
				content,
				ok: {
					label: "Save", callback: (event, button) => {
						const fm = button.form.elements;
						return {
							name: fm.name.value.trim() || f.name,
							color: fm.color.value || null,
							icon: (fm.icon.value || "").trim() || null,
							scope: fm.scope?.value === "world" ? "world" : "scene",
						};
					},
				},
			}).catch(() => null);
			if (data) await JournalPinManager.updateFolder(folderId, data);
		};

		// New top-level folder
		elem.querySelector(".pin-folder-newbtn[data-action='folder-new']")?.addEventListener("click", async e => {
			e.preventDefault();
			const name = await promptFolderName("New Folder", "New Folder");
			if (name) await JournalPinManager.createFolder({ name });
		});

		// Convert Map Notes -> pins (shared by the toolbar = all, and per-note buttons)
		const runConvertDialog = async (noteIds = null) => {
			const noteCount = noteIds ? noteIds.length : (canvas.scene?.notes?.size ?? 0);
			if (!noteCount) {
				ui.notifications.info("No map notes on this scene to convert."); return;
			}
			const folderOpts = JournalPinManager.listFolders()
				.map(f => `<option value="${esc(f.id)}">${esc(f.name)}${f.scope === "world" ? " (world)" : ""}</option>`)
				.join("");
			const content = `
                <p>Convert <strong>${noteCount}</strong> map note${noteCount === 1 ? "" : "s"} into journal pins.</p>
                <div class="form-group"><label>Target folder</label>
                    <select name="folderId"><option value="">Ungrouped</option>${folderOpts}</select></div>
                <div class="form-group"><label><input type="checkbox" name="deleteOriginals"> Delete the original map note${noteCount === 1 ? "" : "s"} after converting</label></div>`;
			const data = await foundry.applications.api.DialogV2.prompt({
				window: { title: "Convert Map Notes → Pins" },
				content,
				ok: {
					label: "Convert", callback: (event, button) => {
						const fm = button.form.elements;
						return {
							folderId: fm.folderId.value || null,
							deleteOriginals: fm.deleteOriginals.checked,
						};
					},
				},
			}).catch(() => null);
			if (!data) return;
			const res = await JournalPinManager.convertNotesToPins({
				noteIds: noteIds || undefined, folderId: data.folderId, deleteOriginals: data.deleteOriginals,
			});
			ui.notifications.info(`Created ${res.created} pin${res.created === 1 ? "" : "s"}${
				res.deleted ? `, removed ${res.deleted} note${res.deleted === 1 ? "" : "s"}.` : "."}`);
		};
		this._runConvertDialog = runConvertDialog;

		elem.querySelector(".pin-folder-newbtn[data-action='convert-notes']")?.addEventListener("click", e => {
			e.preventDefault();
			runConvertDialog(null);
		});

		// Folder header controls + collapse toggle
		elem.querySelectorAll(".pin-folder-header").forEach(header => {
			const folderId = header.dataset.folderId;
			const toggle = async e => {
				e.preventDefault(); e.stopPropagation();
				const f = JournalPinManager.listFolders().find(x => x.id === folderId);
				await JournalPinManager.setFolderCollapsed(folderId, !(f?.collapsed));
			};
			header.querySelector(".pin-folder-caret")?.addEventListener("click", toggle);
			header.querySelector(".pin-folder-name")?.addEventListener("click", toggle);

			header.querySelectorAll(".pin-folder-control").forEach(btn => {
				btn.addEventListener("click", async e => {
					e.preventDefault(); e.stopPropagation();
					const action = btn.dataset.action;
					if (action === "folder-add-child") {
						const name = await promptFolderName("New Subfolder", "New Folder");
						if (name) await JournalPinManager.createFolder({ name, parentId: folderId });
					}
					else if (action === "folder-edit") {
						await editFolderDialog(folderId);
					}
					else if (action === "folder-delete") {
						const ok = await foundry.applications.api.DialogV2.confirm({
							window: { title: "Delete Folder" },
							content: "<p>Delete this folder? Its pins move to <strong>Ungrouped</strong> (pins are not deleted).</p>",
							modal: true,
						});
						if (ok) await JournalPinManager.deleteFolder(folderId);
					}
				});
			});
		});

		// Drag & drop (GM only): assign/reorder pins, re-nest folders
		const pinsList = elem.querySelector(".pins-view .sdx-pin-list:not(.map-notes-list)");
		if (game.user.isGM && pinsList) {
			let drag = null;
			const clearOver = () => pinsList.querySelectorAll(".drag-over").forEach(
				n => n.classList.remove("drag-over")
			);

			pinsList.querySelectorAll(".pin-entry[draggable='true'], .pin-folder-header[draggable='true']").forEach(row => {
				row.addEventListener("dragstart", e => {
					drag = row.classList.contains("pin-folder-header")
						? { type: "folder", id: row.dataset.folderId }
						: { type: "pin", id: row.dataset.id };
					e.dataTransfer.effectAllowed = "move";
					try {
						e.dataTransfer.setData("text/plain", drag.id);
					}
					catch(_) { }
					row.classList.add("sdx-dragging");
				});
				row.addEventListener("dragend", () => {
					row.classList.remove("sdx-dragging"); clearOver(); drag = null;
				});
			});

			pinsList.addEventListener("dragover", e => {
				if (!drag) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				clearOver();
				const target = e.target.closest(".pin-folder-header, .pin-entry");
				if (target) target.classList.add("drag-over");
			});
			pinsList.addEventListener("dragleave", e => {
				if (e.target === pinsList) clearOver();
			});

			pinsList.addEventListener("drop", async e => {
				if (!drag) return;
				e.preventDefault();
				clearOver();
				const folderHeader = e.target.closest(".pin-folder-header");
				const pinRow = e.target.closest(".pin-entry");
				const dragged = drag; drag = null;
				try {
					if (dragged.type === "pin") {
						if (folderHeader) {
							await JournalPinManager.movePin(
								dragged.id, folderHeader.dataset.folderId
							);
						}
						else if (pinRow && pinRow.dataset.id !== dragged.id) {
							await JournalPinManager.movePin(
								dragged.id, pinRow.dataset.folderId || null, pinRow.dataset.id
							);
						}
						else if (!folderHeader && !pinRow) {
							await JournalPinManager.movePin(dragged.id, null);
						}
					}
					else if (dragged.type === "folder") {
						if (folderHeader && folderHeader.dataset.folderId !== dragged.id) {
							await JournalPinManager.updateFolder(
								dragged.id, { parentId: folderHeader.dataset.folderId }
							);
						}
						else if (!folderHeader && !pinRow) {
							await JournalPinManager.updateFolder(dragged.id, { parentId: null });
						}
					}
				}
				catch(err) {
					console.error("SDX | pin folder DnD error", err);
				}
			});
		}

		// Note Actions
		elem.querySelectorAll(".note-control").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const action = btn.dataset.action;
				const entry = btn.closest(".note-entry");
				const id = entry.dataset.id;
				const type = entry.querySelector(".note-icon i").className.includes("fa-user") ? "Token"
					: entry.querySelector(".note-icon i").className.includes("fa-lightbulb") ? "AmbientLight"
						: entry.querySelector(".note-icon i").className.includes("fa-volume-high") ? "AmbientSound"
							: entry.querySelector(".note-icon i").className.includes("fa-image") ? "Tile"
								: entry.querySelector(".note-icon i").className.includes("fa-block-brick") ? "Wall" : null;

				if (!type) return;

				// Find the document
				let doc;
				if (type === "Token") {
					const token = canvas.tokens.get(id);
					if (token) {
						const tokenDoc = token.document;
						// Check if token has its own note
						const tokenNote = tokenDoc.getFlag("shadowdark-extras", "notes");
						// If token has no note, but actor does, edit the actor's note (matching
						// display logic)
						if (!tokenNote && token.actor && token.actor.getFlag("shadowdark-extras", "notes")) {
							doc = token.actor;
						}
						else {
							doc = tokenDoc;
						}
					}
				}
				else if (type === "AmbientLight") doc = canvas.lighting.get(id)?.document;
				else if (type === "AmbientSound") doc = canvas.sounds.get(id)?.document;
				else if (type === "Tile") doc = canvas.tiles.get(id)?.document;
				else if (type === "Wall") doc = canvas.walls.get(id)?.document;

				if (!doc) return;

				if (action === "pan") {
					const x = parseFloat(entry.dataset.x);
					const y = parseFloat(entry.dataset.y);
					canvas.animatePan({ x, y, scale: 1.5, duration: 500 });
				}
				else if (action === "rename") {
					const currentName = doc.getFlag("shadowdark-extras", "customName") || doc.name || "";
					new foundry.applications.api.DialogV2({
						window: { title: "Rename Placeable Note" },
						content: `
                            <form>
                                <div class="form-group">
                                    <label>Name:</label>
                                    <input type="text" name="name" value="${currentName}" autofocus>
                                </div>
                            </form>
                        `,
						buttons: [
							{
								action: "save",
								label: "Save",
								icon: "fas fa-check",
								default: true,
								callback: async (event, button) => {
									const newName = button.form.elements.name.value;
									await doc.setFlag("shadowdark-extras", "customName", newName);
								},
							},
							{
								action: "reset",
								label: "Reset",
								icon: "fas fa-undo",
								callback: async () => {
									await doc.unsetFlag("shadowdark-extras", "customName");
								},
							},
						],
					}).render({ force: true });
				}
				else if (action === "toggle-visibility") {
					const isVisible = !!doc.getFlag("shadowdark-extras", "noteVisible");
					await doc.setFlag("shadowdark-extras", "noteVisible", !isVisible);
				}
				else if (action === "delete") {
					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Delete Note" },
						content: `<p>Are you sure you want to delete the note for <strong>${doc.name}</strong>?</p>`,
						modal: true,
					});
					if (ok) {
						await doc.unsetFlag("shadowdark-extras", "notes");
						await doc.unsetFlag("shadowdark-extras", "noteVisible");
					}
				}
			});
		});

		// Note Toggle Action
		elem.querySelectorAll(".note-header").forEach(header => {
			header.addEventListener("click", e => {
				// Don't toggle if clicking a control button
				if (e.target.closest(".note-controls")) return;

				e.preventDefault();
				e.stopPropagation();
				const entry = header.closest(".note-entry");
				const content = entry.querySelector(".note-content");
				if (content) {
					content.classList.toggle("hidden");
					const icon = header.querySelector(".toggle-icon i");
					if (icon) {
						icon.classList.toggle("fa-chevron-right");
						icon.classList.toggle("fa-chevron-down");
					}
				}
			});
		});

		// Note Entry Context Menu (Edit)
		elem.querySelectorAll(".note-entry").forEach(entry => {
			entry.addEventListener("contextmenu", e => {
				if (!game.user.isGM) return;
				e.preventDefault();
				e.stopPropagation();

				const id = entry.dataset.id;
				const type = entry.querySelector(".note-icon i").className.includes("fa-user") ? "Token"
					: entry.querySelector(".note-icon i").className.includes("fa-lightbulb") ? "AmbientLight"
						: entry.querySelector(".note-icon i").className.includes("fa-volume-high") ? "AmbientSound"
							: entry.querySelector(".note-icon i").className.includes("fa-image") ? "Tile"
								: entry.querySelector(".note-icon i").className.includes("fa-block-brick") ? "Wall" : null;

				if (!type) return;

				// Find the document
				let doc;
				if (type === "Token") {
					const token = canvas.tokens.get(id);
					if (token) {
						const tokenDoc = token.document;
						// Check if token has its own note
						const tokenNote = tokenDoc.getFlag("shadowdark-extras", "notes");
						// If token has no note, but actor does, edit the actor's note (matching
						// display logic)
						if (!tokenNote && token.actor && token.actor.getFlag("shadowdark-extras", "notes")) {
							doc = token.actor;
						}
						else {
							doc = tokenDoc;
						}
					}
				}
				else if (type === "AmbientLight") doc = canvas.lighting.get(id)?.document;
				else if (type === "AmbientSound") doc = canvas.sounds.get(id)?.document;
				else if (type === "Tile") doc = canvas.tiles.get(id)?.document;
				else if (type === "Wall") doc = canvas.walls.get(id)?.document;

				if (!doc) return;

				new PlaceableNotesSD(doc).render(true);
			});
		});

		// Map Note Actions
		elem.querySelectorAll(".map-note-control").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();

				const action = btn.dataset.action;
				const entry = btn.closest(".map-note-entry");
				const id = entry.dataset.id;
				const uuid = entry.dataset.uuid;

				if (!id) return;

				if (action === "pan") {
					const x = parseFloat(entry.dataset.x);
					const y = parseFloat(entry.dataset.y);
					if (!isNaN(x) && !isNaN(y)) {
						canvas.animatePan({ x, y, scale: 1.5, duration: 500 });
					}
				}
				else if (action === "delete") {
					const note = fromUuidSync(uuid);
					if (!note) return;

					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Delete Map Note" },
						content: `<p>Are you sure you want to delete the map note <strong>${note.text || note.name}</strong>?</p>`,
						modal: true,
					});
					if (ok) await note.delete();
				}
				else if (action === "open") {
					const note = fromUuidSync(uuid);
					if (note) note.sheet.render(true);
				}
				else if (action === "convert") {
					await runConvertDialog([id]);
				}
			});
		});

		// Pin Search Input
		const searchInput = elem.querySelector(".pin-search-input");
		if (searchInput) {
			// Restore focus if we re-rendered and input was focused (simple heuristic)
			// But actually ApplicationV2 re-renders the whole thing, so focus is lost.
			// We can rely on value={pinSearchTerm} to restore value,
			// but for smooth typing we might want to avoid full re-render on every keystroke if
			// possible,
			// or just use client-side filtering without re-render.

			// We will use client-side filtering for better performance (no re-render)
			searchInput.addEventListener("input", e => {
				e.preventDefault();
				const term = e.target.value;
				this._pinSearchTerm = term;
				this._filterPins(term);
			});

			// Initial filter application (in case of re-render with existing term)
			if (this._pinSearchTerm) {
				this._filterPins(this._pinSearchTerm);
			}
		}

		// Hex Painter tab bindings
		this._bindHexPainterEvents(elem);
	}

	/**
     * Filter the pin list based on search term
     * @param {string} term
     */
	_filterPins(term) {
		const elem = document.querySelector(".sdx-tray");
		if (!elem) return;
		const lowerTerm = (term || "").toLowerCase().trim();

		// Map-note entries: simple name filter (unchanged behavior)
		elem.querySelectorAll(".map-notes-list .pin-entry").forEach(entry => {
			const name = entry.querySelector(".pin-name")?.textContent.toLowerCase() || "";
			entry.style.display = (!lowerTerm || name.includes(lowerTerm)) ? "" : "none";
		});

		const pinsList = elem.querySelector(".pins-view .sdx-pin-list:not(.map-notes-list)");
		if (!pinsList) return;
		const pinRows = pinsList.querySelectorAll(".pin-entry");
		const folderRows = pinsList.querySelectorAll(".pin-folder-header");

		if (!lowerTerm) {
			// Restore collapse-based visibility (clear inline display; CSS .sdx-row-hidden handles
			// collapse)
			pinRows.forEach(r => {
				r.style.display = "";
			});
			folderRows.forEach(r => {
				r.style.display = "";
			});
			return;
		}

		// Match pins; reveal matches even inside collapsed folders (inline display wins over CSS).
		const matchedAncestors = new Set();
		pinRows.forEach(entry => {
			const name = entry.querySelector(".pin-name")?.textContent.toLowerCase() || "";
			const page = entry.querySelector(".pin-page-name")?.textContent.toLowerCase() || "";
			const match = name.includes(lowerTerm) || page.includes(lowerTerm);
			entry.style.display = match ? "flex" : "none";
			if (match) (entry.dataset.ancestors || "").split(" ").filter(Boolean).forEach(a => matchedAncestors.add(a));
		});
		// A folder is shown only if it is an ancestor of a matched pin.
		folderRows.forEach(f => {
			f.style.display = matchedAncestors.has(f.dataset.folderId) ? "flex" : "none";
		});
	}

	/**
     * Update POI scale percentage display in the DOM without re-rendering
     */
	_updatePoiScaleDisplay() {
		const elem = document.querySelector(".sdx-tray");
		if (!elem) return;
		const pct = Math.round(getPoiScale() * 100);
		elem.querySelectorAll(".poi-info-section .hex-custom-folder-hint").forEach(hint => {
			const icon = hint.querySelector("i");
			if (icon) {
				hint.textContent = "";
				hint.appendChild(icon);
				hint.append(` ${hint.closest(".decor-view") ? "Decor" : "POI"} paint on top · Scale: ${pct}%`);
			}
		});
	}

	/* ═══════════════════════════════════════════════════════════════
       HEX PAINTER TAB
       ═══════════════════════════════════════════════════════════════ */

	async _promptFolderName(title, defaultName = "") {
		return new Promise(resolve => {
			const dialog = new foundry.applications.api.DialogV2({
				window: { title },
				content: `<div class="form-group"><label>Folder Name</label><input type="text" name="folderName" value="${defaultName}" autofocus></div>`,
				buttons: [
					{
						action: "ok",
						icon: "fas fa-check",
						label: "OK",
						default: true,
						callback: (event, button) => {
							const name = button.form.elements.folderName.value?.trim();
							resolve(name || null);
						},
					},
					{
						action: "cancel",
						icon: "fas fa-times",
						label: "Cancel",
						callback: () => resolve(null),
					},
				],
				close: () => resolve(null),
			});
			dialog.render({ force: true }).then(() => {
				dialog.element.querySelector('[name="folderName"]')?.select();
			});
		});
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
