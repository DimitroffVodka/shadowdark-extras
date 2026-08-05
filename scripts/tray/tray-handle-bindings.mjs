// Tray handle bindings — extracted from scripts/tray/TrayApp.mjs (Phase 5.3
// split). Prototype mixin: the handle strip that stays visible when the tray
// is collapsed — expand/collapse, view cycling, every GM tool button, and the
// POI transform controls. Merged via Object.assign(TrayApp.prototype, ...).

import { FormationSpawnerSD } from "../combat/FormationSpawnerSD.mjs";
import { showLeaderDialog, showMovementModeDialog } from "../combat/MarchingModeSD.mjs";
import { disableDungeonPainting, enableDungeonPainting } from "../dungeon/DungeonPainterSD.mjs";
import { adjustPoiScale, canRedoPoi, canUndoPoi, disablePainting, disablePreview, enablePainting, enablePreview, getActiveTileTab, getPoiMirror, getPoiScale, redoLastPoi, rotatePoiLeft, rotatePoiRight, setDecorMode, togglePoiMirror, undoLastPoi } from "../hex/HexPainterSD.mjs";
import { getActiveHexFogEffect, getAvailableHexFogEffects, isFogEffectsEnabled, isHexFogEnabled, setHexFogEffect, setHexFogEnabled } from "../hex/SDXHexFogSD.mjs";
import { toggleSoloMode } from "../hex/SoloHexMode.mjs";
import { PinPlacer } from "../journal/JournalPinsSD.mjs";
import { cycleViewMode, setViewMode } from "./TraySD.mjs";

export const TrayHandleBindings = {
	/**
     * Tray handle: expand/collapse, view cycle, every GM tool button, and
     * the POI transform controls.
     * @param {HTMLElement} elem - The rendered tray root
     */
	_bindHandleButtons(elem) {

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
	},

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
	},
};
