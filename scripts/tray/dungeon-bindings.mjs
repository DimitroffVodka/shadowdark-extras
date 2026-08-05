// Dungeon painter tab bindings — extracted from scripts/tray/TrayApp.mjs
// (Phase 5.3 split). Prototype mixin: mode tabs, the five tile pickers, the
// wall options, level flatten/unflatten, and the procedural generator panel.
// Merged via Object.assign(TrayApp.prototype, DungeonBindings).

import { flattenDungeonLevel, getDungeonFloorLevels, getFlattendDungeonLevels, unflattenTile } from "../canvas/TileFlattenSD.mjs";
import { generateDungeon, generateRandomSeed, getGeneratorSeed, getGeneratorSettings, setGeneratorSeed, setGeneratorSettings, toggleGeneratorPanel } from "../dungeon/DungeonGeneratorSD.mjs";
import { selectDoorTile, selectFloorTile, selectIntDoorTile, selectIntWallTile, selectWallTile, setCurvedWalls, setDungeonBackground, setDungeonMode, setNoFoundryWalls, setWallShadows } from "../dungeon/DungeonPainterSD.mjs";
import { renderTray } from "./TraySD.mjs";

export const DungeonBindings = {
	/**
     * Dungeon painter tab: mode tabs, tile pickers, wall options, level
     * flattening, and the procedural generator panel.
     * @param {HTMLElement} elem - The rendered tray root
     */
	_bindDungeonEvents(elem) {
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
				symmetry: sym, stairs: stairsVal, stairsDown: stairsDownVal,
				clutter: clutterVal, decorLights: decorLightsVal,
				textured: isTextured, wallShadows: isWallShadows, wallColor: wColor,
				thickness: thick, style, biomes: useBiomes,
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
					...config, levelCount: levels, connectionsPerPair: links,
					variation, connectorVariety,
				});
			}
			else {
				await generateDungeon(config);
			}
		});
	},
};
