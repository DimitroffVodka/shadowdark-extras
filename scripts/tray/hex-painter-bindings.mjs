// Hex-painter event bindings — extracted from scripts/tray/TrayApp.mjs
// (Phase 5.1 split). Prototype mixin: the _bindHexPainterEvents method
// wiring the tray's hex-painter controls to HexPainterSD. Merged via
// Object.assign(TrayApp.prototype, HexPainterBindings).

import { setMapDimension, formatActiveScene, toggleTileSelection, clearTileSelection, setSearchFilter, toggleWaterEffect, toggleWindEffect, toggleFogAnimation, toggleTintEnabled, toggleBwEffect, setActiveTileTab, setCustomTileDimension, toggleColoredFolderCollapsed, toggleSymbolFolderCollapsed, enablePreview, disablePreview, getActiveTileTab, setDecorSearchFilter, toggleDecorFolderCollapsed, setDecorElevation, setDecorSort, appendCustomNavSegment, setCustomNavPath, reloadCustomTiles } from "../hex/HexPainterSD.mjs";
import { flattenTiles } from "../canvas/TileFlattenSD.mjs";
import { generateHexMap, clearGeneratedTiles } from "../hex/HexGeneratorSD.mjs";
import { renderTray } from "./TraySD.mjs";
import { DecorImportApp } from "./decor-import.mjs";

const MODULE_ID = "shadowdark-extras";

export const HexPainterBindings = {
	_bindHexPainterEvents(elem) {
		// Format Map toggle
		const formatBtn = elem.querySelector(".hex-format-btn");
		const formatControls = elem.querySelector(".hex-format-controls");
		if (formatBtn && formatControls) {
			formatBtn.addEventListener("click", (e) => {
				e.preventDefault();
				formatControls.classList.toggle("hidden");
			});
		}

		// Dimension sliders
		elem.querySelectorAll(".hex-slider-row input[type='range']").forEach(slider => {
			slider.addEventListener("input", (e) => {
				const val = parseInt(e.target.value);
				const display = e.target.parentElement.querySelector(".hex-slider-value");
				if (display) display.textContent = val;
				const axis = e.target.name === "hex-columns" ? "columns" : "rows";
				setMapDimension(axis, val);
			});
		});

		// Apply format button
		elem.querySelector(".hex-apply-btn")?.addEventListener("click", async (e) => {
			e.preventDefault();
			await formatActiveScene();
		});

		// Flatten all tiles button
		elem.querySelector(".hex-flatten-btn")?.addEventListener("click", async (e) => {
			e.preventDefault();
			e.stopPropagation();

			// Get all tiles on the scene
			const allTiles = canvas?.tiles?.placeables || [];
			if (allTiles.length < 2) {
				ui.notifications.warn("Need at least 2 tiles on the scene to flatten.");
				return;
			}

			// Get all tile documents
			const tileDocs = allTiles.map(p => p.document).filter(d => d);

			// Ask for confirmation
			const confirmed = await foundry.applications.api.DialogV2.confirm({
				window: { title: "Flatten All Tiles" },
				content: `<p>This will flatten all <strong>${tileDocs.length}</strong> tiles on the scene into a single image.</p><p>You can unflatten later from the Tile HUD.</p>`,
				modal: true,
			});

			if (!confirmed) return;

			// Call the flatten function
			await flattenTiles(tileDocs);
		});

		// Search filter (client-side filtering without re-render)
		elem.querySelector(".hex-search-input")?.addEventListener("input", (e) => {
			const searchTerm = e.target.value.toLowerCase();
			setSearchFilter(searchTerm);

			// Filter flat tile thumbs (default/custom/symbols)
			const tiles = elem.querySelectorAll(".hex-tile-grid .hex-tile-thumb");
			tiles.forEach(tile => {
				const label = tile.getAttribute("title").toLowerCase();
				tile.style.display = label.includes(searchTerm) ? "" : "none";
			});

			// Filter colored tile folders: hide folders that have no visible tiles
			elem.querySelectorAll(".hex-colored-folder").forEach(folder => {
				const thumbs = folder.querySelectorAll(".hex-tile-thumb");
				let visibleCount = 0;
				thumbs.forEach(tile => {
					const label = tile.getAttribute("title").toLowerCase();
					const show = label.includes(searchTerm);
					tile.style.display = show ? "" : "none";
					if (show) visibleCount++;
				});
				folder.style.display = visibleCount > 0 ? "" : "none";
				// Update count display
				const countEl = folder.querySelector(".hex-folder-count");
				if (countEl) countEl.textContent = `(${visibleCount})`;
			});

			// Filter symbol tile folders: hide folders that have no visible tiles
			elem.querySelectorAll(".hex-symbol-folder").forEach(folder => {
				const thumbs = folder.querySelectorAll(".hex-tile-thumb");
				let visibleCount = 0;
				thumbs.forEach(tile => {
					const label = tile.getAttribute("title").toLowerCase();
					const show = label.includes(searchTerm);
					tile.style.display = show ? "" : "none";
					if (show) visibleCount++;
				});
				folder.style.display = visibleCount > 0 ? "" : "none";
				// Update count display
				const countEl = folder.querySelector(".hex-folder-count");
				if (countEl) countEl.textContent = `(${visibleCount})`;
			});
		});

		// Water effect toggle
		elem.querySelector(".hex-water-checkbox")?.addEventListener("change", (e) => {
			toggleWaterEffect();
		});

		// Wind effect toggle
		elem.querySelector(".hex-wind-checkbox")?.addEventListener("change", (e) => {
			toggleWindEffect();
		});

		// Fog animation toggle
		elem.querySelector(".hex-fog-checkbox")?.addEventListener("change", (e) => {
			toggleFogAnimation();
		});

		// Manual tint toggle
		elem.querySelector(".hex-tint-checkbox")?.addEventListener("change", (e) => {
			toggleTintEnabled();
		});

		// Black & White effect toggle
		elem.querySelector(".hex-bw-checkbox")?.addEventListener("change", (e) => {
			toggleBwEffect();
		});

		// Tile selection (multi-select) - exclude decor tiles (handled separately)
		elem.querySelectorAll(".hex-tile-thumb:not(.decor-tile-thumb)").forEach(thumb => {
			thumb.addEventListener("click", (e) => {
				e.preventDefault();
				const tilePath = thumb.dataset.tile;
				if (!tilePath) return;

				// Block hex tile painting on unformatted scenes (except POI tab)
				const activeTab = getActiveTileTab();
				if (activeTab !== "symbols" && !canvas.scene?.getFlag(MODULE_ID, "hexScene")) {
					ui.notifications.warn("Format the map first before placing hex tiles.");
					return;
				}

				toggleTileSelection(tilePath);

				thumb.classList.toggle("active");
			});

			thumb.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				clearTileSelection();
				// Remove active class from all tile thumbs
				elem.querySelectorAll(".hex-tile-thumb").forEach(t => t.classList.remove("active"));
			});
		});

		// ── Procedural Generator ──

		// Toggle generator panel
		elem.querySelector(".hex-generator-toggle-btn")?.addEventListener("click", (e) => {
			e.preventDefault();
			const controls = elem.querySelector(".hex-generator-controls");
			if (controls) {
				controls.classList.toggle("hidden");
				// Store the expanded state so it persists across tab switches
				this._generatorExpanded = !controls.classList.contains("hidden");
			}
		});

		// Generator sliders - update display value
		elem.querySelectorAll(".hex-gen-slider-row input[type='range']").forEach(slider => {
			slider.addEventListener("input", (e) => {
				const display = e.target.parentElement.querySelector(".hex-gen-slider-value");
				if (display) display.textContent = e.target.value;
			});
		});

		// Generate button
		elem.querySelector(".hex-gen-generate-btn")?.addEventListener("click", async (e) => {
			e.preventDefault();
			const water = parseInt(elem.querySelector("input[name='hex-gen-water']")?.value || 0) / 100;
			const green = parseInt(elem.querySelector("input[name='hex-gen-green']")?.value || 0) / 100;
			const mountain = parseInt(elem.querySelector("input[name='hex-gen-mountain']")?.value || 0) / 100;
			const desert = parseInt(elem.querySelector("input[name='hex-gen-desert']")?.value || 0) / 100;
			const swamp = parseInt(elem.querySelector("input[name='hex-gen-swamp']")?.value || 0) / 100;
			const badlands = parseInt(elem.querySelector("input[name='hex-gen-badlands']")?.value || 0) / 100;
			const snow = parseInt(elem.querySelector("input[name='hex-gen-snow']")?.value || 0) / 100;
			const seed = elem.querySelector("input[name='hex-gen-seed']")?.value || "";

			await generateHexMap({ seed, water, green, mountain, desert, swamp, badlands, snow });
		});

		// Clear button
		elem.querySelector(".hex-gen-clear-btn")?.addEventListener("click", async (e) => {
			e.preventDefault();
			await clearGeneratedTiles();
		});

		// Tile tabs (Default / Colored / Custom)
		elem.querySelectorAll(".hex-tile-tab").forEach(tab => {
			tab.addEventListener("click", (e) => {
				e.preventDefault();
				const tabName = tab.dataset.tileTab;
				if (!tabName) return;

				setActiveTileTab(tabName);

				// Update tab active states
				elem.querySelectorAll(".hex-tile-tab").forEach(t => t.classList.remove("active"));
				tab.classList.add("active");

				// Show/hide tile panels
				elem.querySelectorAll("[data-tile-panel]").forEach(panel => {
					if (panel.dataset.tilePanel === tabName) {
						panel.classList.remove("hidden");
					}
					else {
						panel.classList.add("hidden");
					}
				});

				// Show/hide custom size section
				const customSizeSection = elem.querySelector(".hex-custom-size-section");
				if (customSizeSection) {
					customSizeSection.style.display = tabName === "custom" ? "" : "none";
				}

				// Enable/disable POI preview based on tab
				if (tabName === "symbols" && this._isExpanded) {
					enablePreview();
				}
				else {
					disablePreview();
				}

				// Re-render to update state properly
				renderTray();
				this._syncPoiSortPanel();
			});
		});

		elem.querySelectorAll(".hex-custom-chip").forEach(chip => {
			chip.addEventListener("click", (e) => {
				e.preventDefault();
				const name = chip.dataset.chipName;
				if (!name) return;
				appendCustomNavSegment(name);
				renderTray();
			});
		});

		elem.querySelectorAll(".hex-custom-breadcrumb-segment").forEach(seg => {
			seg.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const raw = seg.dataset.segments || "";
				setCustomNavPath(raw.split("/").filter(Boolean));
				renderTray();
			});
		});

		elem.querySelectorAll(".hex-custom-up-btn").forEach(btn => {
			btn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const crumbs = Array.from(elem.querySelectorAll(".hex-custom-breadcrumb-segment"));
				const currentRaw = crumbs.at(-1)?.dataset.segments || "";
				const parent = currentRaw.split("/").filter(Boolean).slice(0, -1);
				setCustomNavPath(parent);
				renderTray();
			});
		});

		elem.querySelectorAll(".hex-custom-reload-btn").forEach(btn => {
			btn.addEventListener("click", async (e) => {
				e.preventDefault();
				e.stopPropagation();
				btn.disabled = true;
				try {
					await reloadCustomTiles();
				}
				finally {
					btn.disabled = false;
					renderTray();
				}
			});
		});

		// Custom tile size inputs
		elem.querySelectorAll(".hex-custom-size-input").forEach(input => {
			input.addEventListener("change", (e) => {
				const val = parseInt(e.target.value);
				const axis = e.target.name === "custom-tile-width" ? "width" : "height";
				setCustomTileDimension(axis, val);
			});
		});

		// Colored tile folder toggle (expand/collapse)
		elem.querySelectorAll(".hex-colored-folder-header").forEach(header => {
			header.addEventListener("click", (e) => {
				e.preventDefault();
				const folderKey = header.dataset.folder;
				if (!folderKey) return;

				toggleColoredFolderCollapsed(folderKey);

				// Toggle content visibility
				const folderEl = header.closest(".hex-colored-folder");
				const content = folderEl?.querySelector(".hex-colored-folder-content");
				if (content) content.classList.toggle("hidden");

				// Toggle chevron icon
				const chevron = header.querySelector(".hex-folder-chevron");
				if (chevron) {
					chevron.classList.toggle("fa-caret-right");
					chevron.classList.toggle("fa-caret-down");
				}

				// Toggle folder icon
				const folderIcon = header.querySelector(".hex-folder-icon");
				if (folderIcon) {
					folderIcon.classList.toggle("fa-folder");
					folderIcon.classList.toggle("fa-folder-open");
				}

				// Toggle header collapsed class
				header.classList.toggle("collapsed");
			});
		});

		// Symbol tile folder toggle (expand/collapse)
		elem.querySelectorAll(".hex-symbol-folder-header:not(.decor-folder-header)").forEach(header => {
			header.addEventListener("click", (e) => {
				e.preventDefault();
				const folderKey = header.dataset.folder;
				if (!folderKey) return;

				toggleSymbolFolderCollapsed(folderKey);

				// Toggle content visibility
				const folderEl = header.closest(".hex-symbol-folder");
				const content = folderEl?.querySelector(".hex-symbol-folder-content");
				if (content) content.classList.toggle("hidden");

				// Toggle chevron icon
				const chevron = header.querySelector(".hex-folder-chevron");
				if (chevron) {
					chevron.classList.toggle("fa-caret-right");
					chevron.classList.toggle("fa-caret-down");
				}

				// Toggle folder icon
				const folderIcon = header.querySelector(".hex-folder-icon");
				if (folderIcon) {
					folderIcon.classList.toggle("fa-folder");
					folderIcon.classList.toggle("fa-folder-open");
				}

				// Toggle header collapsed class
				header.classList.toggle("collapsed");
			});
		});

		/* ─── DECOR TAB ─── */

		// Decor tile selection (multi-select, same as hex-tile-thumb but for decor)
		elem.querySelectorAll(".decor-tile-thumb").forEach(thumb => {
			thumb.addEventListener("click", (e) => {
				e.preventDefault();
				const tilePath = thumb.dataset.tile;
				if (!tilePath) return;
				toggleTileSelection(tilePath);
				thumb.classList.toggle("active");
			});

			thumb.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				clearTileSelection();
				// Remove active class from all tile thumbs
				elem.querySelectorAll(".hex-tile-thumb").forEach(t => t.classList.remove("active"));
			});
		});

		// Decor search filter (client-side filtering without re-render)
		elem.querySelector(".decor-search-input")?.addEventListener("input", (e) => {
			const searchTerm = e.target.value.toLowerCase();
			setDecorSearchFilter(searchTerm);

			// Filter tiles within decor view
			const decorView = elem.querySelector(".decor-view");
			if (!decorView) return;

			decorView.querySelectorAll(".hex-symbol-folder").forEach(folder => {
				const thumbs = folder.querySelectorAll(".hex-tile-thumb");
				let visibleCount = 0;
				thumbs.forEach(tile => {
					const label = tile.getAttribute("title").toLowerCase();
					const show = label.includes(searchTerm);
					tile.style.display = show ? "" : "none";
					if (show) visibleCount++;
				});
				folder.style.display = visibleCount > 0 ? "" : "none";
				const countEl = folder.querySelector(".hex-folder-count");
				if (countEl) countEl.textContent = `(${visibleCount})`;
			});
		});

		elem.querySelector(".decor-import-btn")?.addEventListener("click", (e) => {
			e.preventDefault();
			if (!game.user?.isGM) {
				ui.notifications.warn("Only GMs can import decor assets.");
				return;
			}
			new DecorImportApp().render(true);
		});

		elem.querySelector(".decor-ddpack-btn")?.addEventListener("click", async (e) => {
			e.preventDefault();
			if (!game.user?.isGM) {
				ui.notifications.warn("Only GMs can manage Dungeondraft packs.");
				return;
			}
			const { DDPackSettingsApp } = await import("../dungeon/DDPackSettingsAppSD.mjs");
			new DDPackSettingsApp().render(true);
		});

		// Decor folder toggle (expand/collapse)
		elem.querySelectorAll(".decor-folder-header").forEach(header => {
			header.addEventListener("click", (e) => {
				e.preventDefault();
				const folderKey = header.dataset.folder;
				if (!folderKey) return;

				toggleDecorFolderCollapsed(folderKey);

				// Toggle content visibility
				const folderEl = header.closest(".hex-symbol-folder");
				const content = folderEl?.querySelector(".hex-symbol-folder-content");
				if (content) content.classList.toggle("hidden");

				// Toggle chevron icon
				const chevron = header.querySelector(".hex-folder-chevron");
				if (chevron) {
					chevron.classList.toggle("fa-caret-right");
					chevron.classList.toggle("fa-caret-down");
				}

				// Toggle folder icon
				const folderIcon = header.querySelector(".hex-folder-icon");
				if (folderIcon) {
					folderIcon.classList.toggle("fa-folder");
					folderIcon.classList.toggle("fa-folder-open");
				}

				// Toggle header collapsed class
				header.classList.toggle("collapsed");
			});
		});

		// Decor elevation input
		elem.querySelector(".decor-elevation-input")?.addEventListener("change", (e) => {
			setDecorElevation(parseFloat(e.target.value) || 0);
		});

		// Decor sort input
		elem.querySelector(".decor-sort-input")?.addEventListener("change", (e) => {
			const intVal = parseInt(e.target.value, 10) || 0;
			e.target.value = intVal;
			setDecorSort(intVal);
		});
	}

};
