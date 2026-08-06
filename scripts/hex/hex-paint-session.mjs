// Paint-session state and the canvas pointer handlers for the hex painter —
// including _stampAtPointer, the placement routine they all drive.
// Extracted verbatim from scripts/hex/HexPainterSD.mjs (Phase 5.3 sweep 6
// split).
//
// Imports nothing from the painter by design: the painter and its callers
// import these names back under the same identifiers, and a leaf module is
// what keeps the extraction provable (read-only ESM bindings forbid
// cross-module assignment).
//
// _stampAtPointer is why this seam went last. It is 455 lines and reads 41
// top-level names, which is most of what HexPainterSD.mjs used to hold, so it
// could not move until nearly everything it touches had a leaf of its own. It
// now reads exactly three names that were still in the painter — _brushActive,
// _lastCell and _isToolActive — and those are what this module is: the pointer
// handlers write the first two, and every other name it needs is an import
// from a sibling leaf or a duplicated constant.

import { BIOME_TILES, BIOME_TINTS } from "./HexGeneratorSD.mjs";
import { getDoorTiles } from "../dungeon/DungeonPainterSD.mjs";
import { setHexTerrain } from "./HexTooltipSD.mjs";
import { _activeTileTab, _chosenTiles, _symbolTiles } from "./hex-tile-selection.mjs";
import {
	_decorMode,
	_decorElevation,
	_decorSort,
	_importedDecorTiles,
	_ddPackDecorTiles,
	getRegisteredDecorTiles,
	getDDPackDecorAssets,
	setDecorMode,
} from "./hex-decor.mjs";
import { _coloredTiles } from "./hex-colored-tiles.mjs";
import { _customTiles, getCustomTilePlacement } from "./hex-custom-tiles.mjs";
import {
	_waterEffect,
	_windEffect,
	_fogAnimation,
	_tintEnabled,
	_bwEffect,
} from "./hex-map-effects.mjs";
import { _poiUndoStack, clearPoiHistory, clearPoiRedoStack } from "./hex-poi-history.mjs";
import {
	_poiScale,
	_poiRotation,
	_poiMirror,
	_previewSprite,
	_previewContainer,
	_previewEnabled,
	_currentPreviewIndex,
	_getAvailablePoiTiles,
	advancePreviewIndex,
	updatePreviewPosition,
	destroyPreview,
} from "./hex-poi-preview.mjs";

const MODULE_ID = "shadowdark-extras";
const HEX_TILE_W = 296;
const HEX_TILE_H = 256;
const COLORED_HEX_TILE_W = 572;
const COLORED_HEX_TILE_H = 500;

// Maps default-tile biome keys to user-friendly terrain labels
const BIOME_TO_TERRAIN = {
	water: "Water",
	swamp: "Swamp",
	grassland: "Vegetation",
	forestLight: "Vegetation",
	forest: "Vegetation",
	hills: "Mountains",
	hillsForest: "Mountains",
	mountains: "Mountains",
	mountainsForest: "Mountains",
	desert: "Desert",
	badlands: "Badlands",
	snowyMountains: "Snow",
	special: null,
};

export let _brushActive = false;

export let _lastCell = null;

export let _paintEnabled = false;

export let _isPainting = false;

export let _isGenerating = false;

export function isPainting() {
	return _isPainting || _isGenerating;
}

export function setGenerating(v) {
	_isGenerating = !!v;
}

export function enablePainting() {
	_paintEnabled = true;
}

export function disablePainting() {
	_paintEnabled = false;
	_brushActive = false;
	_lastCell = null;
	_chosenTiles.clear();
	setDecorMode(false);
	// Clean up POI-related state
	destroyPreview();
	clearPoiHistory();
}

export function bindCanvasEvents() {
	if (!canvas.stage) return;

	canvas.stage.off("mousedown", _onPointerDown);
	canvas.stage.off("mousemove", _onPointerMove);
	canvas.stage.off("mouseup", _onPointerUp);
	canvas.stage.off("mouseupoutside", _onPointerUp);
	canvas.stage.off("rightclick", _onRightClick);

	canvas.stage.on("mousedown", _onPointerDown);
	canvas.stage.on("mousemove", _onPointerMove);
	canvas.stage.on("mouseup", _onPointerUp);
	canvas.stage.on("mouseupoutside", _onPointerUp);
	canvas.stage.on("rightclick", _onRightClick);
}

export function _isToolActive() {
	return _paintEnabled;
}

export function _onPointerDown(ev) {
	if (!_isToolActive()) return;
	// Only respond to left mouse button (button 0)
	const button = ev.data?.button ?? ev.data?.originalEvent?.button ?? 0;
	if (button !== 0) return;

	_brushActive = true;
	_isPainting = true;
	_lastCell = null;  // Reset to allow painting on any cell
	_stampAtPointer(ev, true);  // Force stamp on click
}

export function _onPointerMove(ev) {
	if (_brushActive) _stampAtPointer(ev, false);

	// Update preview position if enabled
	if (_previewEnabled && _previewContainer) {
		const pos = ev.data?.getLocalPosition?.(canvas.stage);
		if (pos) {
			updatePreviewPosition(pos);
		}
	}
}

export function _onPointerUp() {
	_brushActive = false;
	_isPainting = false;
	_lastCell = null;
}

export function _onRightClick(ev) {
	if (!_isToolActive()) return;
	if (_activeTileTab !== "symbols" && !_decorMode) return;

	const availableTiles = _getAvailablePoiTiles();
	if (availableTiles.length <= 1) return; // No point cycling with 0 or 1 tile

	// Prevent context menu
	ev.data?.originalEvent?.preventDefault?.();

	// Advance to next tile
	advancePreviewIndex();

	// Update preview texture
	if (_previewEnabled && _previewSprite) {
		const nextPath = availableTiles[_currentPreviewIndex % availableTiles.length];
		foundry.canvas.loadTexture(nextPath).then(texture => {
			if (texture && _previewSprite) {
				_previewSprite.texture = texture;
				_previewSprite._sdxTexturePath = nextPath;
			}
		});
	}
}

export async function _stampAtPointer(ev, forceStamp = false) {
	if (!_isToolActive()) return;

	// Block hex tile painting on unformatted scenes (except POI/decor)
	if (_activeTileTab !== "symbols" && !_decorMode && !canvas.scene?.getFlag(MODULE_ID, "hexScene")) {
		ui.notifications.warn("Format the map first before placing hex tiles.");
		_brushActive = false;
		return;
	}

	const pos = ev.data?.getLocalPosition?.(canvas.stage);
	if (!pos) return;  // Safety check

	const cell = canvas.grid.getOffset(pos);
	if (!cell) return;  // Safety check

	const cellKey = `${cell.i}:${cell.j}`;

	// Skip if same cell (unless forced on initial click)
	if (!forceStamp && cellKey === _lastCell) return;
	_lastCell = cellKey;

	const center = canvas.grid.getCenterPoint(cell);
	if (!center) return;  // Safety check

	const verticalNudge = 0;

	// Use a more generous tolerance for finding existing tiles at this position
	// This helps when tiles have slightly different sizes/positions
	const tolerance = Math.max(20, canvas.grid.size * 0.15);
	const occupants = canvas.tiles.placeables.filter(t => {
		const cx = t.document.x + t.document.width / 2;
		const cy = t.document.y + t.document.height / 2;
		return Math.abs(cx - center.x) < tolerance &&
            Math.abs(cy - (center.y - verticalNudge)) < tolerance;
	});

	const erasing = ev.data?.originalEvent?.shiftKey ?? false;
	if (erasing) {
		if (occupants.length) {
			await canvas.scene.deleteEmbeddedDocuments("Tile", occupants.map(t => t.id));
		}
		return;
	}

	if (_chosenTiles.size === 0) {
		ui.notifications.warn("SDX | Pick at least one tile first.");
		_brushActive = false;
		return;
	}

	// Filter chosen tiles based on active tab
	let availableTiles = Array.from(_chosenTiles);

	if (_activeTileTab === "symbols" || _decorMode) {
		const doorTiles = getDoorTiles();
		const ddPackDecorTiles = _decorMode ? await getDDPackDecorAssets() : [];
		availableTiles = availableTiles.filter(path =>
			(_symbolTiles && _symbolTiles.some(t => t.path === path)) ||
            (_decorMode && _importedDecorTiles && _importedDecorTiles.some(t => t.path === path)) ||
            (_decorMode && ddPackDecorTiles.some(t => t.path === path)) ||
            (_decorMode && getRegisteredDecorTiles().some(t => t.path === path)) ||
            (_decorMode && doorTiles.some(t => t.path === path))
		);
	}
	else if (_activeTileTab === "custom") {
		availableTiles = availableTiles.filter(path => _customTiles && _customTiles.some(t => t.path === path));
	}
	else if (_activeTileTab === "colored") {
		availableTiles = availableTiles.filter(path => _coloredTiles && _coloredTiles.some(t => t.path === path));
	}
	else {
		// Default tab - include basic tiles (not custom/colored/symbols)
		availableTiles = availableTiles.filter(path => {
			const isSymbol = _symbolTiles && _symbolTiles.some(t => t.path === path);
			const isCustom = _customTiles && _customTiles.some(t => t.path === path);
			const isColored = _coloredTiles && _coloredTiles.some(t => t.path === path);
			return !isSymbol && !isCustom && !isColored;
		});
	}

	if (availableTiles.length === 0) {
		ui.notifications.warn(`SDX | No tiles selected in the "${_activeTileTab}" tab.`);
		_brushActive = false;
		return;
	}

	// For symbols (POI), use deterministic cycling; for other tiles, use random selection
	let chosenTile;
	if (_activeTileTab === "symbols" || _decorMode) {
		chosenTile = availableTiles[_currentPreviewIndex % availableTiles.length];
	}
	else {
		chosenTile = availableTiles[Math.floor(Math.random() * availableTiles.length)];
	}

	// Check if the chosen tile is a symbol, custom, or colored tile
	const isDoorTile = _decorMode && getDoorTiles().some(t => t.path === chosenTile);
	const isImportedDecorTile = _decorMode && _importedDecorTiles && _importedDecorTiles.some(t => t.path === chosenTile);
	const isDDPackDecorTile = _decorMode && _ddPackDecorTiles && _ddPackDecorTiles.some(t => t.path === chosenTile);
	const isRegisteredDecorTile = _decorMode && getRegisteredDecorTiles().some(t => t.path === chosenTile);
	const isSymbolTile = isDoorTile || isImportedDecorTile || isDDPackDecorTile || isRegisteredDecorTile || (_symbolTiles && _symbolTiles.some(t => t.path === chosenTile));
	const isCustomTile = _customTiles && _customTiles.some(t => t.path === chosenTile);
	const isColoredTile = _coloredTiles && _coloredTiles.some(t => t.path === chosenTile);

	// Only delete existing tiles if NOT painting symbols (symbols stack on top)
	if (!isSymbolTile && occupants.length) {
		await canvas.scene.deleteEmbeddedDocuments("Tile", occupants.map(t => t.id));
	}

	// Determine tile dimensions based on type
	let tw; let th; let tx; let ty;
	if (isSymbolTile) {
		// For symbols, get original image size and scale by _poiScale
		try {
			const img = await foundry.canvas.loadTexture(chosenTile);
			tw = Math.floor(img.width * _poiScale);
			th = Math.floor(img.height * _poiScale);
		}
		catch (e) {
			// Fallback to default size if image can't be loaded
			tw = Math.floor(256 * _poiScale);
			th = Math.floor(256 * _poiScale);
		}
	}
	else if (isColoredTile) {
		tw = COLORED_HEX_TILE_W;
		th = COLORED_HEX_TILE_H;
	}
	else if (isCustomTile) {
		const placement = await getCustomTilePlacement(chosenTile, center, verticalNudge);
		tw = placement.width;
		th = placement.height;
		tx = placement.x;
		ty = placement.y;
	}
	else {
		tw = HEX_TILE_W;
		th = HEX_TILE_H;
	}

	let tintData = undefined;
	if (_tintEnabled) {
		let foundBiome = null;

		// Map biome folder names to BIOME_TINTS keys
		const biomeToTint = {
			water: "water",
			vegetation: "forest",
			mountains: "mountains",
			desert: "desert",
			swamp: "swamp",
			badlands: "badlands",
			snow: "snowyMountains",
		};

		// Check if this is a colored tile first
		if (isColoredTile) {
			const coloredTile = _coloredTiles.find(t => t.path === chosenTile);
			if (coloredTile && coloredTile.biome) {
				foundBiome = biomeToTint[coloredTile.biome] || null;
			}
		}
		else if (isCustomTile) {
			// Check if this is a custom tile
			const customTile = _customTiles.find(t => t.path === chosenTile);
			if (customTile && customTile.biome) {
				foundBiome = biomeToTint[customTile.biome] || null;
			}
		}
		else {
			// Default tile - extract filename and find biome
			const filename = chosenTile.split("/").pop();
			for (const [biome, files] of Object.entries(BIOME_TILES)) {
				if (files.includes(filename)) {
					foundBiome = biome;
					break;
				}
			}
		}

		if (foundBiome && BIOME_TINTS[foundBiome]) {
			tintData = Color.from(BIOME_TINTS[foundBiome]).css;
		}
	}

	const tileData = {
		texture: {
			src: chosenTile,
			tint: tintData,
			scaleX: isSymbolTile && _poiMirror ? -1 : 1,
			scaleY: 1,
			// v14: default texture anchor changed to (0.5, 0.5). Explicit (0, 0)
			// matches V1 behavior so tile (x, y) is the top-left, not the center.
			anchorX: 0,
			anchorY: 0,
		},
		x: tx ?? ((isSymbolTile ? pos.x : center.x) - tw / 2),
		y: ty ?? ((isSymbolTile ? pos.y : center.y) - th / 2 - verticalNudge),
		width: tw,
		height: th,
		elevation: isSymbolTile ? (_decorMode ? _decorElevation : 0.1) : 0,
		rotation: isSymbolTile ? _poiRotation : 0,
		// Symbols get a much higher sort value to appear on top of hex tiles
		sort: isSymbolTile ? (_decorMode ? _decorSort : Math.floor(center.y) + 100000) : Math.floor(center.y),
		flags: {
			[MODULE_ID]: {
				painted: true,
				isSymbol: isSymbolTile || undefined,
			},
		},
	};

	let createdTiles;
	try {
		createdTiles = await canvas.scene.createEmbeddedDocuments("Tile", [tileData]);
	}
	catch (err) {
		console.error(`${MODULE_ID} | Failed to create tile:`, err);
		return;
	}

	// ── Auto-set terrain in hex tooltip data (skip symbols / decor) ──
	if (!isSymbolTile && createdTiles?.length > 0) {
		let terrain = null;
		if (isColoredTile) {
			const ct = _coloredTiles.find(t => t.path === chosenTile);
			terrain = ct?.biome;
		}
		else if (isCustomTile) {
			const ct = _customTiles.find(t => t.path === chosenTile);
			terrain = ct?.biome;
		}
		else {
			// Default tile — match filename to BIOME_TILES
			const filename = chosenTile.split("/").pop();
			for (const [biome, files] of Object.entries(BIOME_TILES)) {
				if (files.includes(filename)) {
					terrain = BIOME_TO_TERRAIN[biome] ?? biome;
					break;
				}
			}
		}
		if (terrain) {
			// Capitalize folder names (e.g. "vegetation" → "Vegetation")
			const terrainLabel = typeof terrain === "string"
				? terrain.charAt(0).toUpperCase() + terrain.slice(1)
				: terrain;
			const hexKey = `${cell.i}_${cell.j}`;
			const sceneId = canvas.scene?.id;
			if (sceneId) {
				setHexTerrain(sceneId, hexKey, terrainLabel).catch(err =>
					console.warn(`${MODULE_ID} | Failed to set hex terrain:`, err)
				);
			}
		}
	}

	// In decor mode, re-apply elevation/sort after creation to override Levels module hooks
	if (_decorMode && isSymbolTile && createdTiles && createdTiles.length > 0) {
		const tile = createdTiles[0];
		const updates = {};
		if (tile.elevation !== _decorElevation) updates.elevation = _decorElevation;
		if (tile.sort !== _decorSort) updates.sort = _decorSort;
		if (Object.keys(updates).length) {
			await tile.update(updates);
		}
	}

	// Track POI tiles for undo/redo
	if (isSymbolTile && createdTiles && createdTiles.length > 0) {
		_poiUndoStack.push({ id: createdTiles[0].id });
		clearPoiRedoStack(); // Clear redo stack on new placement
		// Advance to next tile in cycle
		advancePreviewIndex();
		// Update preview texture
		if (_previewEnabled && _previewSprite) {
			const availablePoiTiles = _getAvailablePoiTiles();
			if (availablePoiTiles.length > 0) {
				const nextPath = availablePoiTiles[_currentPreviewIndex % availablePoiTiles.length];
				foundry.canvas.loadTexture(nextPath).then(texture => {
					if (texture && _previewSprite) {
						_previewSprite.texture = texture;
						_previewSprite._sdxTexturePath = nextPath;
					}
				});
			}
		}
		// Trigger tray re-render to update undo/redo button states
		Hooks.callAll("sdx.poiPlaced");
	}

	if (window.TokenMagic && createdTiles && createdTiles.length > 0) {
		const tileId = createdTiles[0].id;
		const tileObj = canvas.tiles.placeables.find(t => t.document.id === tileId);
		if (tileObj) {
			const allParams = [];

			if (_waterEffect) {
				// Always add distortion effect
				allParams.push(
					{
						"filterType": "distortion",
						"filterId": "Sea",
						"maskPath": "modules/tokenmagic/fx/assets/distortion-1.png",
						"maskSpriteScaleX": 5,
						"maskSpriteScaleY": 5,
						"padding": 20,
						"animated": {
							"maskSpriteX": {
								"active": true,
								"speed": 0.05,
								"animType": "move",
							},
							"maskSpriteY": {
								"active": true,
								"speed": 0.07,
								"animType": "move",
							},
						},
						"rank": 10003,
						"enabled": true,
					}
				);
				// Only add adjustment filter for non-colored tiles (colored tiles already have nice colors)
				if (!isColoredTile) {
					allParams.push(
						{
							"filterType": "adjustment",
							"filterId": "Sea",
							"saturation": 0.99,
							"brightness": 0.29,
							"contrast": 1.68,
							"gamma": 0.1,
							"red": 0.67,
							"green": 0.9,
							"blue": 1.24,
							"alpha": 0.74,
							"animated": {},
							"rank": 10005,
							"enabled": true,
						}
					);
				}
			}

			if (_windEffect) {
				allParams.push(
					{
						"filterType": "distortion",
						"filterId": "Wind",
						"maskPath": "modules/tokenmagic/fx/assets/distortion-1.png",
						"maskSpriteScaleX": 0.3,
						"maskSpriteScaleY": 0,
						"padding": 177,
						"animated": {
							"maskSpriteX": {
								"active": true,
								"speed": 0.05,
								"animType": "move",
							},
							"maskSpriteY": {
								"active": true,
								"speed": 0.07,
								"animType": "move",
							},
							"maskSpriteScaleX": {
								"active": true,
								"animType": "sinOscillation",
								"speed": 0.0000025,
								"val1": 2.6,
								"val2": 0.9,
								"loopDuration": 3000,
								"syncShift": 0,
								"loops": null,
								"chaosFactor": 0.23,
								"clockWise": true,
								"wantInteger": false,
							},
						},
						"rank": 10000,
						"enabled": true,
					}
				);
			}

			if (_fogAnimation) {
				allParams.push(
					{
						"filterType": "smoke",
						"filterId": "Fog",
						"color": 16777215,
						"time": 0,
						"blend": 2,
						"dimX": 0.01,
						"dimY": 1,
						"animated": {
							"time": {
								"active": true,
								"speed": 0.001,
								"animType": "move",
								"val1": 24136.1,
								"val2": 10186.3,
								"loopDuration": 32740,
								"syncShift": 0.76,
								"loops": null,
							},
							"dimX": {
								"active": true,
								"animType": "cosOscillation",
								"speed": 0.0000025,
								"val1": -0.03,
								"val2": 0.03,
								"loopDuration": 5000,
								"syncShift": 0,
								"loops": null,
							},
						},
						"rank": 10002,
						"enabled": true,
					}
				);
			}

			if (_bwEffect) {
				allParams.push(
					{
						"filterType": "adjustment",
						"filterId": "blackandwhite",
						"saturation": 0,
						"brightness": 1.1,
						"contrast": 2,
						"gamma": 2,
						"red": 1,
						"green": 1,
						"blue": 1,
						"alpha": 1,
						"animated": {},
						"rank": 10004,
						"enabled": true,
					}
				);
			}

			if (allParams.length > 0) {
				try {
					await TokenMagic.addUpdateFilters(tileObj.document, allParams);
				}
				catch (err) {
					console.warn(`${MODULE_ID} | Could not apply effects:`, err);
				}
			}
		}
	}
}
