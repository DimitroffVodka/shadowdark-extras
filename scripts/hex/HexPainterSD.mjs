import { cache } from "../shared/SDXCache.mjs";
import { BIOME_TILES, BIOME_TINTS } from "./HexGeneratorSD.mjs";
import { getDoorTiles } from "../dungeon/DungeonPainterSD.mjs";
import { setHexTerrain } from "./HexTooltipSD.mjs";
// _formatLabel has a neutral leaf of its own: every tile store calls it, so it
// is not owned by whichever one happened to be extracted first.
import { _formatLabel } from "./hex-tile-labels.mjs";

// Tile-selection state (active tab, chosen tiles, search filter) and the symbol
// tile store now live in hex-tile-selection.mjs. The painter reads the bindings
// and writes them only through the moved setters, so that module can stay an
// importless leaf. _chosenTiles is the exception the rule allows: it is never
// rebound, only mutated, so the painter keeps calling .add/.delete/.clear on
// the imported binding directly.
import {
	_symbolTiles,
	_chosenTiles,
	_searchFilter,
	_activeTileTab,
	loadSymbolTileAssets,
	getSymbolTiles,
	getFilteredSymbolTiles,
	getActiveTileTab,
	setActiveTileTab,
	getSymbolTileFolders,
	toggleSymbolFolderCollapsed,
	setSearchFilter,
	getSearchFilter,
} from "./hex-tile-selection.mjs";

// The tile-selection helpers that were public on this module stay public: the
// tray, the generator and solo mode import them from here.
export {
	getSymbolTiles, getFilteredSymbolTiles, getActiveTileTab, setActiveTileTab,
	getSymbolTileFolders, toggleSymbolFolderCollapsed, setSearchFilter, getSearchFilter,
};

// The POI undo/redo history now lives in hex-poi-history.mjs. The painter
// pushes onto _poiUndoStack (mutation is legal through a read-only import
// binding) and clears the redo stack only through clearPoiRedoStack, so the
// module can stay an importless leaf.
import {
	_poiUndoStack,
	_poiRedoStack,
	canUndoPoi,
	canRedoPoi,
	clearPoiHistory,
	clearPoiRedoStack,
	undoLastPoi,
	redoLastPoi,
} from "./hex-poi-history.mjs";

// The POI helpers that were public on this module stay public: the tray and its
// handle bindings import them from here.
export { canUndoPoi, canRedoPoi, clearPoiHistory, undoLastPoi, redoLastPoi };

// Decor assets and decor-tab state now live in hex-decor.mjs. The painter reads
// the bindings and writes them only through the moved setters, so that module
// can stay an importless leaf and the graph gains no cycle.
import {
	_importedDecorTiles,
	_ddPackDecorTiles,
	_decorSearchFilter,
	_decorFoldersCollapsed,
	_decorElevation,
	_decorSort,
	_decorMode,
	setDecorMode,
	isDecorMode,
	getRegisteredDecorTiles,
	loadImportedDecorAssets,
	getDDPackDecorAssets,
	decorFolderLabel,
	registerDecorAsset,
	reloadDecorAssets,
	setDecorSearchFilter,
	getDecorSearchFilter,
	toggleDecorFolderCollapsed,
	getDecorElevation,
	setDecorElevation,
	getDecorSort,
	setDecorSort,
} from "./hex-decor.mjs";

// The decor helpers that were public on this module stay public: the tray and
// the Dungeondraft pack apps import them from here.
export {
	registerDecorAsset, loadImportedDecorAssets, reloadDecorAssets,
	setDecorSearchFilter, getDecorSearchFilter, toggleDecorFolderCollapsed,
	getDecorElevation, setDecorElevation, getDecorSort, setDecorSort,
	setDecorMode, isDecorMode,
};

// Colored-hex tile assets and the colored-folder collapse state now live in
// hex-colored-tiles.mjs, on the same terms as the decor seam above: an
// importless-of-the-painter leaf, read here and written only through the moved
// functions.
import {
	_coloredTiles,
	_coloredFoldersCollapsed,
	loadColoredTileAssets,
	getColoredTiles,
	getColoredTilesByBiome,
	getColoredTileDimensions,
	toggleColoredFolderCollapsed,
} from "./hex-colored-tiles.mjs";

// The colored-tile helpers that were public on this module stay public: the
// generator, solo mode and the tray import them from here.
export {
	getColoredTiles, getColoredTilesByBiome, getColoredTileDimensions,
	toggleColoredFolderCollapsed,
};

// The custom-tile scan, its sizing settings and the folder-navigation state now
// live in hex-custom-tiles.mjs. Same rule as the decor seam: the painter only
// reads the bindings, so that module stays an importless leaf.
import {
	_customTiles,
	_customNavPath,
	_customTileWidth,
	_customTileHeight,
	_useCustomForGeneration,
	loadCustomTileAssets,
	loadCustomTileDimensions,
	getCustomTilePlacement,
	getCustomNavChips,
	_decodePathLabel,
	reloadCustomTiles,
	getCustomTilesByBiome,
	isUseCustomForGeneration,
	toggleUseCustomForGeneration,
	setUseCustomForGeneration,
	getCustomTileDimensions,
	setCustomTileDimension,
	getCustomTiles,
	getCustomNavPath,
	setCustomNavPath,
	appendCustomNavSegment,
} from "./hex-custom-tiles.mjs";

// The custom-tile helpers that were public on this module stay public: the
// generator and the tray bindings import them from here.
export {
	reloadCustomTiles, getCustomTilesByBiome, isUseCustomForGeneration,
	toggleUseCustomForGeneration, setUseCustomForGeneration,
	getCustomTileDimensions, setCustomTileDimension, loadCustomTileDimensions,
	getCustomTilePlacement, getCustomTiles, getCustomNavPath, setCustomNavPath,
	appendCustomNavSegment, getCustomNavChips,
};

// The five map-effect toggles now live in hex-map-effects.mjs, on the same
// terms as the seams above: an importless leaf, read here and written only
// through the moved togglers.
import {
	_waterEffect,
	_windEffect,
	_fogAnimation,
	_tintEnabled,
	_bwEffect,
	toggleWaterEffect,
	isWaterEffect,
	toggleWindEffect,
	isWindEffect,
	toggleFogAnimation,
	isFogAnimation,
	toggleTintEnabled,
	isTintEnabled,
	toggleBwEffect,
	isBwEffect,
} from "./hex-map-effects.mjs";

// Every effect helper was public on this module and stays public: the tray
// bindings toggle them and the generator reads them from here.
export {
	toggleWaterEffect, isWaterEffect, toggleWindEffect, isWindEffect,
	toggleFogAnimation, isFogAnimation, toggleTintEnabled, isTintEnabled,
	toggleBwEffect, isBwEffect,
};

// The requested map dimensions and the scene reformat that applies them now
// live in hex-scene-format.mjs — another importless leaf. MODULE_ID and
// HEX_TILE_H are duplicated there rather than imported, since both stay in use
// here.
import {
	_mapColumns,
	_mapRows,
	setMapDimension,
	getMapDimensions,
	formatActiveScene,
} from "./hex-scene-format.mjs";

// All three were public on this module and stay public: the tray bindings drive
// the dimension inputs and the Format Scene button through them.
export {
	setMapDimension, getMapDimensions, formatActiveScene,
};

// The POI preview sprite, the placement transform (scale, rotation, mirror) and
// the tile-cycling index now live in hex-poi-preview.mjs. The painter reads the
// bindings and writes _currentPreviewIndex only through resetPreviewIndex, so
// that module can stay a leaf of this one.
import {
	_poiScale,
	_poiRotation,
	_poiMirror,
	_previewSprite,
	_previewContainer,
	_previewEnabled,
	_currentPreviewIndex,
	getPoiScale,
	setPoiScale,
	loadPoiScale,
	adjustPoiScale,
	getPoiRotation,
	rotatePoiLeft,
	rotatePoiRight,
	getPoiMirror,
	togglePoiMirror,
	resetPoiTransform,
	createPreview,
	updatePreviewPosition,
	destroyPreview,
	enablePreview,
	disablePreview,
	isPreviewEnabled,
	advancePreviewIndex,
	resetPreviewIndex,
	getCurrentPreviewIndex,
	_getAvailablePoiTiles,
} from "./hex-poi-preview.mjs";

// The preview and transform helpers that were public on this module stay
// public: the tray handle bindings drive every one of them.
export {
	getPoiScale, setPoiScale, loadPoiScale, adjustPoiScale,
	getPoiRotation, rotatePoiLeft, rotatePoiRight,
	getPoiMirror, togglePoiMirror, resetPoiTransform,
	createPreview, updatePreviewPosition, destroyPreview,
	enablePreview, disablePreview, isPreviewEnabled,
	advancePreviewIndex, getCurrentPreviewIndex,
};

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

const MODULE_ID = "shadowdark-extras";
const TILE_FOLDER = `modules/${MODULE_ID}/assets/tiles`;
const HEX_TILE_W = 296;
const HEX_TILE_H = 256;
const COLORED_HEX_TILE_W = 572;
const COLORED_HEX_TILE_H = 500;

// Biome subdirectories for colored tiles (from assets/Hexes)
const COLORED_BIOME_SUBDIRS = ["Water", "Vegetation", "Mountains", "Desert", "swamp", "Badlands", "snow", "Specials"];




let _tiles = null;           // Default tiles from module
let _brushActive = false;
let _lastCell = null;
let _paintEnabled = false;
let _isPainting = false;
let _isGenerating = false;

// Decor tab state

export async function loadTileAssets() {
	if (_tiles) return;

	// Load saved custom tile dimensions
	loadCustomTileDimensions();

	// Load saved POI scale
	loadPoiScale();

	// Metadata cache
	const metadataKey = "hex_tiles_metadata_default";
	const cached = await cache.getMetadata(metadataKey);

	if (cached) {
		_tiles = cached;
		if (_tiles.length && _chosenTiles.size === 0) {
			_chosenTiles.add(_tiles[0].path);
		}
	}
	else {
		try {
			const listing = await foundry.applications.apps.FilePicker.implementation.browse("data", TILE_FOLDER);
			const pngFiles = (listing.files || []).filter(f => f.endsWith(".png") || f.endsWith(".webp"));

			_tiles = pngFiles
				.map(path => {
					const filename = path.split("/").pop().replace(/\.(png|webp)$/i, "");
					const raw = filename.replace(/^hex-tile-/, "");
					return {
						key: raw,
						label: _formatLabel(raw),
						path,
						isCustom: false,
					};
				})
				.sort((a, b) => a.key.localeCompare(b.key));

			if (_tiles.length && _chosenTiles.size === 0) {
				_chosenTiles.add(_tiles[0].path);
			}

			await cache.setMetadata(metadataKey, _tiles);
		}
		catch (err) {
			console.error(`${MODULE_ID} | Failed to discover hex tiles:`, err);
			_tiles = [];
		}
	}

	// Load other tiles
	await loadCustomTileAssets();
	await loadColoredTileAssets();
	await loadSymbolTileAssets();
	await loadImportedDecorAssets();

	// Start background preloading
	preloadHexImages();
}

/**
 * Get filtered colored tiles (by search filter)
 */
export function getFilteredColoredTiles() {
	if (!_coloredTiles) return [];
	if (!_searchFilter) return _coloredTiles;
	return _coloredTiles.filter(t => t.label.toLowerCase().includes(_searchFilter));
}

/**
 * Get colored tiles grouped by folder for the tray UI.
 * Returns an array of { folder, label, collapsed, tiles[] } objects.
 */
export async function getColoredTileFolders() {
	const filtered = getFilteredColoredTiles();
	if (!filtered.length) return [];

	// Group tiles by biome (folder)
	const folderMap = new Map();

	for (const tile of filtered) {
		const folderKey = tile.biome || "__root__";
		if (!folderMap.has(folderKey)) {
			folderMap.set(folderKey, []);
		}
		folderMap.get(folderKey).push({
			key: tile.key,
			label: tile.label,
			path: tile.path,
			active: _chosenTiles.has(tile.path),
			biome: tile.biome,
		});
	}

	// Build folder array, sorted alphabetically (root first if it exists)
	const folders = [];
	for (const [key, tiles] of folderMap) {
		const label = key === "__root__" ? "Root" : key.charAt(0).toUpperCase() + key.slice(1);

		const processedTiles = await Promise.all(tiles.map(async t => ({
			...t,
			src: await cache.getCachedSrc(t.path),
		})));

		folders.push({
			folder: key,
			label,
			collapsed: !!_coloredFoldersCollapsed[key],
			tiles: processedTiles,
		});
	}

	// Sort: root first, then alphabetically
	folders.sort((a, b) => {
		if (a.folder === "__root__") return -1;
		if (b.folder === "__root__") return 1;
		return a.label.localeCompare(b.label);
	});

	return folders;
}

/* ═══════════════════════════════════════════════════════════════
   DECOR TAB
   ═══════════════════════════════════════════════════════════════ */

/**
 * Get decor tiles grouped by folder for the tray UI.
 * Only includes Dysonstyle category tiles.
 */
export async function getDecorTileFolders() {
	let tiles = [
		...((_symbolTiles || []).filter(t => t.category === "dysonstyle")),
		...(_importedDecorTiles || []),
		...(await getDDPackDecorAssets()),
		...getRegisteredDecorTiles(),
	];
	const seenPaths = new Set();
	tiles = tiles.filter(tile => {
		if (seenPaths.has(tile.path)) return false;
		seenPaths.add(tile.path);
		return true;
	});
	if (_decorSearchFilter) {
		tiles = tiles.filter(t => t.label.toLowerCase().includes(_decorSearchFilter));
	}

	const folderMap = new Map();
	for (const tile of tiles) {
		const folderKey = tile.category || "__root__";
		if (!folderMap.has(folderKey)) folderMap.set(folderKey, []);
		folderMap.get(folderKey).push({
			key: tile.key, label: tile.label, path: tile.path,
			active: _chosenTiles.has(tile.path), category: tile.category,
			imported: !!tile.imported,
			registered: !!tile.registered,
			isDDPack: !!tile.isDDPack,
		});
	}

	// Add door tiles from dungeon painter as a "Doors" folder
	const doorTiles = getDoorTiles();
	if (doorTiles.length) {
		let filteredDoors = doorTiles;
		if (_decorSearchFilter) {
			filteredDoors = doorTiles.filter(t => t.label.toLowerCase().includes(_decorSearchFilter));
		}
		if (filteredDoors.length) {
			folderMap.set("doors", filteredDoors.map(t => ({
				key: t.key, label: t.label, path: t.path,
				active: _chosenTiles.has(t.path), category: "doors",
			})));
		}
	}

	if (!folderMap.size) return [];

	const folders = [];
	for (const [key, folderTiles] of folderMap) {
		const customLabel = folderTiles.find(t => t.categoryLabel)?.categoryLabel;
		const label = customLabel || decorFolderLabel(key);

		const processedTiles = await Promise.all(folderTiles.map(async t => ({
			...t,
			src: await cache.getCachedSrc(t.path),
		})));

		folders.push({ folder: key, label, collapsed: _decorFoldersCollapsed[key] ?? true, tiles: processedTiles });
	}
	return folders;
}

export async function getHexPainterData() {
	if (!_tiles) return {
		hexTiles: [],
		hexCustomTiles: [],
		hexColoredTiles: [],
		hexSymbolTiles: [],
		hexColumns: _mapColumns,
		hexRows: _mapRows,
		hexSearchFilter: "",
		activeTileTab: _activeTileTab,
		useCustomForGeneration: _useCustomForGeneration,
		customTileWidth: _customTileWidth,
		customTileHeight: _customTileHeight,
		coloredTileWidth: COLORED_HEX_TILE_W,
		coloredTileHeight: COLORED_HEX_TILE_H,
		hasCustomTiles: false,
		hasColoredTiles: false,
		hasSymbolTiles: false,
		hexColoredFolders: [],
		hexSymbolFolders: [],
		waterEffect: _waterEffect,
		windEffect: _windEffect,
		fogAnimation: _fogAnimation,
		tintEnabled: _tintEnabled,
		bwEffect: _bwEffect,
		poiScale: _poiScale,
		poiRotation: _poiRotation,
		poiMirror: _poiMirror,
		canUndoPoi: _poiUndoStack.length > 0,
		canRedoPoi: _poiRedoStack.length > 0,
		decorFolders: [],
		decorSearchFilter: _decorSearchFilter,
		decorElevation: _decorElevation,
		decorSort: _decorSort,
		customNavPath: [],
		customNavChips: [],
		customNavBreadcrumb: [{ label: "All", segments: [] }],
	};

	const processTiles = async (tiles) => {
		return Promise.all(tiles.map(async t => ({
			...t,
			src: await cache.getCachedSrc(t.path),
		})));
	};

	const filteredTiles = getFilteredTiles();
	const hexTiles = await processTiles(filteredTiles.map(t => ({
		key: t.key,
		label: t.label,
		path: t.path,
		active: _chosenTiles.has(t.path),
	})));

	// Filter custom tiles
	const filteredCustomTiles = getFilteredCustomTiles();
	const hexCustomTiles = await processTiles(filteredCustomTiles.map(t => ({
		key: t.key,
		label: t.label,
		path: t.path,
		active: _chosenTiles.has(t.path),
		biome: t.biome,
	})));

	// Filter colored tiles
	const filteredColoredTiles = getFilteredColoredTiles();
	const hexColoredTiles = await processTiles(filteredColoredTiles.map(t => ({
		key: t.key,
		label: t.label,
		path: t.path,
		active: _chosenTiles.has(t.path),
		biome: t.biome,
	})));

	// Filter symbol tiles (exclude dysonstyle - those are in the Decor tab)
	const filteredSymbolTiles = getFilteredSymbolTiles(["dysonstyle"]);
	const hexSymbolTiles = await processTiles(filteredSymbolTiles.map(t => ({
		key: t.key,
		label: t.label,
		path: t.path,
		active: _chosenTiles.has(t.path),
		category: t.category,
	})));

	// Build colored tile folders
	const hexColoredFolders = await getColoredTileFolders();

	// Build symbol tile folders
	const hexSymbolFolders = await getSymbolTileFolders();

	// Build decor tile folders
	const decorFolders = await getDecorTileFolders();

	return {
		hexTiles,
		hexCustomTiles,
		hexColoredTiles,
		hexSymbolTiles,
		hexColoredFolders,
		hexSymbolFolders,
		hexColumns: _mapColumns,
		hexRows: _mapRows,
		hexSearchFilter: _searchFilter,
		activeTileTab: _activeTileTab,
		useCustomForGeneration: _useCustomForGeneration,
		customTileWidth: _customTileWidth,
		customTileHeight: _customTileHeight,
		coloredTileWidth: COLORED_HEX_TILE_W,
		coloredTileHeight: COLORED_HEX_TILE_H,
		hasCustomTiles: (_customTiles && _customTiles.length > 0),
		hasColoredTiles: (_coloredTiles && _coloredTiles.length > 0),
		hasSymbolTiles: (_symbolTiles && _symbolTiles.length > 0),
		waterEffect: _waterEffect,
		windEffect: _windEffect,
		fogAnimation: _fogAnimation,
		tintEnabled: _tintEnabled,
		bwEffect: _bwEffect,
		poiScale: _poiScale,
		poiRotation: _poiRotation,
		poiMirror: _poiMirror,
		canUndoPoi: _poiUndoStack.length > 0,
		canRedoPoi: _poiRedoStack.length > 0,
		decorFolders,
		decorSearchFilter: _decorSearchFilter,
		decorElevation: _decorElevation,
		decorSort: _decorSort,
		customNavPath: _customNavPath.slice(),
		customNavChips: getCustomNavChips(),
		customNavBreadcrumb: [
			{ label: "All", segments: [] },
			..._customNavPath.map((seg, i) => ({
				label: _decodePathLabel(seg),
				segments: _customNavPath.slice(0, i + 1),
			})),
		],
	};
}

export function getFilteredCustomTiles() {
	if (!_customTiles) return [];
	const depth = _customNavPath.length;
	let tiles = _customTiles.filter(t => {
		const segments = Array.isArray(t.segments) ? t.segments : [];
		for (let i = 0; i < depth; i++) {
			if (segments[i] !== _customNavPath[i]) return false;
		}
		return _searchFilter || segments.length === depth;
	});
	if (_searchFilter) {
		tiles = tiles.filter(t => t.label.toLowerCase().includes(_searchFilter));
	}
	return tiles;
}

export function toggleTileSelection(tilePath) {
	if (_chosenTiles.has(tilePath)) {
		_chosenTiles.delete(tilePath);
	}
	else {
		_chosenTiles.add(tilePath);
	}

	// Update preview when selecting/deselecting POI tiles
	if (_activeTileTab === "symbols" || _decorMode) {
		const availableTiles = _getAvailablePoiTiles();
		if (availableTiles.length > 0) {
			// Reset index if out of bounds
			if (_currentPreviewIndex >= availableTiles.length) {
				resetPreviewIndex();
			}
			// Create or update preview (if painting is enabled)
			if (_paintEnabled) {
				if (!_previewEnabled) {
					createPreview();
				}
				else if (_previewSprite) {
					// Update texture to current tile
					const currentPath = availableTiles[_currentPreviewIndex % availableTiles.length];
					foundry.canvas.loadTexture(currentPath).then(texture => {
						if (texture && _previewSprite) {
							_previewSprite.texture = texture;
							_previewSprite._sdxTexturePath = currentPath;
						}
					});
				}
			}
		}
		else {
			// No tiles selected, destroy preview
			destroyPreview();
		}
	}
}

/**
 * Clear all selected tiles
 */
export function clearTileSelection() {
	_chosenTiles.clear();
	destroyPreview();
}

export function getFilteredTiles() {
	if (!_tiles) return [];
	if (!_searchFilter) return _tiles;
	return _tiles.filter(t => t.label.toLowerCase().includes(_searchFilter));
}

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

function _isToolActive() {
	return _paintEnabled;
}

function _onPointerDown(ev) {
	if (!_isToolActive()) return;
	// Only respond to left mouse button (button 0)
	const button = ev.data?.button ?? ev.data?.originalEvent?.button ?? 0;
	if (button !== 0) return;

	_brushActive = true;
	_isPainting = true;
	_lastCell = null;  // Reset to allow painting on any cell
	_stampAtPointer(ev, true);  // Force stamp on click
}

function _onPointerMove(ev) {
	if (_brushActive) _stampAtPointer(ev, false);

	// Update preview position if enabled
	if (_previewEnabled && _previewContainer) {
		const pos = ev.data?.getLocalPosition?.(canvas.stage);
		if (pos) {
			updatePreviewPosition(pos);
		}
	}
}

function _onPointerUp() {
	_brushActive = false;
	_isPainting = false;
	_lastCell = null;
}

function _onRightClick(ev) {
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

async function _stampAtPointer(ev, forceStamp = false) {
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

/* ═══════════════════════════════════════════════════════════════
   POI PREVIEW
   ═══════════════════════════════════════════════════════════════ */

/**
 * Background preloading of images into IndexedDB
 */
async function preloadHexImages() {
	const allTiles = [
		...(_tiles || []),
		...(_customTiles || []),
		...(_coloredTiles || []),
		...(_symbolTiles || []),
		...(_importedDecorTiles || []),
		...(_ddPackDecorTiles || []),
		...getRegisteredDecorTiles(),
	];

	// Preload process: fetch image and store as blob in cache if not already there
	// Limit concurrency or use a small delay to avoid freezing the UI
	for (const tile of allTiles) {
		try {
			const cached = await cache.getBinary(tile.path);
			if (!cached) {
				const response = await fetch(tile.path);
				if (response.ok) {
					const blob = await response.blob();
					await cache.setBinary(tile.path, blob);
				}
			}
		}
		catch (err) { }
	}
}
