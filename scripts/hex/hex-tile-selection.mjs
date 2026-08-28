// Tile-selection state and the symbol tile store for the hex painter — the
// leaf that the rest of the HexPainterSD.mjs split can import without a cycle.
// Extracted verbatim from scripts/hex/HexPainterSD.mjs (Phase 5.3 sweep 6
// split).
//
// Imports nothing from the painter by design: the painter and its callers
// import these names back under the same identifiers, and a leaf module is
// what keeps the extraction provable (read-only ESM bindings forbid
// cross-module assignment).
//
// _chosenTiles moves even though most of its users stay behind. It is never
// rebound anywhere in the tree — only .add/.delete/.clear/Array.from — and
// mutating an imported binding is legal where assigning to one is not. That is
// what lets toggleTileSelection, clearTileSelection and disablePainting keep
// working from the painter.

import { cache } from "../shared/SDXCache.mjs";
import { readShippedManifest, writeShippedManifest } from "../shared/shipped-asset-cache.mjs";
import { _formatLabel } from "./hex-tile-labels.mjs";
import { browseAssetsAsGM } from "./hex-asset-browser.mjs";

const MODULE_ID = "shadowdark-extras";
const SYMBOLS_TILE_FOLDER = `modules/${MODULE_ID}/assets/symbols`;

// State
export let _symbolTiles = null;     // Symbol tiles from assets/symbols
export let _chosenTiles = new Set();
export let _searchFilter = "";
export let _symbolFoldersCollapsed = {};  // Track collapsed state of symbol tile folders
export let _activeTileTab = "default";

/**
 * Load symbol tiles from assets/symbols folder (inside the module)
 */
export async function loadSymbolTileAssets() {
	_symbolTiles = [];

	const metadataKey = "hex_tiles_metadata_symbol";
	const cached = await readShippedManifest(metadataKey);
	if (cached) {
		_symbolTiles = cached;
		return;
	}

	try {
		// Load tiles from main symbols folder
		const mainListing = await browseAssetsAsGM("data", SYMBOLS_TILE_FOLDER);
		if (!mainListing) return;
		const mainPngFiles = (mainListing.files || []).filter(f => f.endsWith(".png") || f.endsWith(".webp"));

		for (const path of mainPngFiles) {
			const filename = path.split("/").pop().replace(/\.(png|webp)$/, "");
			_symbolTiles.push({
				key: filename,
				label: _formatLabel(filename),
				path,
				isSymbol: true,
				category: null,
			});
		}

		// Dynamically discover and load tiles from all subdirectories
		const subdirs = mainListing.dirs || [];
		for (const dirPath of subdirs) {
			const category = dirPath.split("/").pop();
			try {
				const categoryListing = await browseAssetsAsGM("data", dirPath);
				if (!categoryListing) continue;
				const categoryPngFiles = (categoryListing.files || []).filter(f => f.endsWith(".png") || f.endsWith(".webp"));

				for (const path of categoryPngFiles) {
					const filename = path.split("/").pop().replace(/\.(png|webp)$/, "");
					_symbolTiles.push({
						key: filename,
						label: _formatLabel(filename),
						path,
						isSymbol: true,
						category: category.toLowerCase(),
					});
				}
			}
			catch(err) {
				// Subdirectory might not be accessible, that's okay
			}
		}

		_symbolTiles.sort((a, b) => a.key.localeCompare(b.key));
		await writeShippedManifest(metadataKey, _symbolTiles);
		console.log(`${MODULE_ID} | Loaded ${_symbolTiles.length} symbol tiles from ${subdirs.length} folders`);
	}
	catch(err) {
		console.warn(`${MODULE_ID} | Could not load symbol tiles:`, err);
		_symbolTiles = [];
	}
}

/**
 * Get symbol tiles array
 */
export function getSymbolTiles() {
	return _symbolTiles || [];
}

/**
 * Get filtered symbol tiles (by search filter)
 * @param {string[]} excludeCategories - Categories to exclude
 */
export function getFilteredSymbolTiles(excludeCategories = []) {
	if (!_symbolTiles) return [];
	let tiles = _symbolTiles;
	if (excludeCategories.length) {
		tiles = tiles.filter(t => !excludeCategories.includes(t.category));
	}
	if (!_searchFilter) return tiles;
	return tiles.filter(t => t.label.toLowerCase().includes(_searchFilter));
}

/**
 * Get active tile tab
 */
export function getActiveTileTab() {
	return _activeTileTab;
}

/**
 * Set active tile tab
 */
export function setActiveTileTab(tab) {
	if (tab === "custom" || tab === "colored" || tab === "symbols") {
		_activeTileTab = tab;
	}
	else {
		_activeTileTab = "default";
	}
}

/**
 * Get symbol tiles grouped by folder for the tray UI.
 * Returns an array of { folder, label, collapsed, tiles[] } objects.
 */
export async function getSymbolTileFolders() {
	const filtered = getFilteredSymbolTiles(["dysonstyle"]);
	if (!filtered.length) return [];

	// Group tiles by category (folder)
	const folderMap = new Map();

	for (const tile of filtered) {
		const folderKey = tile.category || "__root__";
		if (!folderMap.has(folderKey)) {
			folderMap.set(folderKey, []);
		}
		folderMap.get(folderKey).push({
			key: tile.key,
			label: tile.label,
			path: tile.path,
			active: _chosenTiles.has(tile.path),
			category: tile.category,
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
			collapsed: !!_symbolFoldersCollapsed[key],
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

/**
 * Toggle collapsed state of a symbol tile folder
 */
export function toggleSymbolFolderCollapsed(folderKey) {
	_symbolFoldersCollapsed[folderKey] = !_symbolFoldersCollapsed[folderKey];
}

export function setSearchFilter(term) {
	_searchFilter = term.toLowerCase();
}

export function getSearchFilter() {
	return _searchFilter;
}
