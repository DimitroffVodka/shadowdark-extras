import { cache } from "../shared/SDXCache.mjs";
import { getDoorTiles } from "../dungeon/DungeonPainterSD.mjs";
// _formatLabel has a neutral leaf of its own: every tile store calls it, so it
// is not owned by whichever one happened to be extracted first.
import { _formatLabel } from "./hex-tile-labels.mjs";
import { browseAssetsAsGM } from "./hex-asset-browser.mjs";

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

// The paint-session state, the canvas pointer handlers and _stampAtPointer now
// live in hex-paint-session.mjs — the last seam, and the one the other eight
// existed to make possible. The painter only reads _paintEnabled from it.
import {
	_paintEnabled,
	enablePainting,
	disablePainting,
	bindCanvasEvents,
	isPainting,
	setGenerating,
} from "./hex-paint-session.mjs";

// All five were public on this module and stay public: the tray drives painting
// on and off through them and the generator flips setGenerating.
export {
	enablePainting, disablePainting, bindCanvasEvents, isPainting, setGenerating,
};

const MODULE_ID = "shadowdark-extras";
const TILE_FOLDER = `modules/${MODULE_ID}/assets/tiles`;
const COLORED_HEX_TILE_W = 572;
const COLORED_HEX_TILE_H = 500;

// Biome subdirectories for colored tiles (from assets/Hexes)
const COLORED_BIOME_SUBDIRS = ["Water", "Vegetation", "Mountains", "Desert", "swamp", "Badlands", "snow", "Specials"];


let _tiles = null;           // Default tiles from module
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
			const listing = await browseAssetsAsGM("data", TILE_FOLDER);
			if (!listing) return;
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
		catch(err) {
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

	const processTiles = async tiles => {
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
		catch(err) { }
	}
}
