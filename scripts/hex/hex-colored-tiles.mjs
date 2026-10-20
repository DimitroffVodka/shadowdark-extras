// Colored-hex tile assets and the colored-tab collapse state for the hex
// painter — a leaf the rest of the HexPainterSD.mjs split can import without a
// cycle. Extracted verbatim from scripts/hex/HexPainterSD.mjs (Phase 5.3 sweep 6
// split).
//
// Imports nothing from the painter by design: the painter imports these names
// back under the same identifiers, and a leaf module is what keeps the
// extraction provable (read-only ESM bindings forbid cross-module assignment).

import { readShippedManifest, writeShippedManifest } from "../shared/shipped-asset-cache.mjs";
import { _formatLabel } from "./hex-tile-labels.mjs";
import { browseAssetsAsGM } from "./hex-asset-browser.mjs";
import { scaleHexTileDimensions } from "./hex-scene-format.mjs";

const MODULE_ID = "shadowdark-extras";
const COLORED_TILE_FOLDER = `modules/${MODULE_ID}/assets/Hexes`;
// Retired art parked beside the live folders; it is gitignored and never shipped.
const ARCHIVE_BIOME = "archive";
const COLORED_HEX_TILE_W = 572;
const COLORED_HEX_TILE_H = 500;
const COLORED_TAG_ALIASES = [
	["arctic", "arctic"], ["autumn", "autumn"], ["badland", "badlands"], ["bog", "bog"],
	["coast", "coast"], ["conifer", "conifer"], ["damp", "damp"],
	["deciduous", "deciduous"], ["desert", "desert"], ["forest", "forest"],
	["hill", "hills"], ["ice", "ice"], ["lush", "lush"], ["mixed", "mixed"],
	["lake", "lake"], ["mountain", "mountains"], ["ocean", "ocean"], ["plain", "plains"],
	["rocky", "rocky"], ["snow", "snow"], ["swamp", "swamp"],
	["river", "river"], ["tree", "trees"], ["urban", "urban"], ["vegetation", "vegetation"],
	["volcano", "volcano"], ["water", "water"], ["wave", "waves"],
	["wetland", "wetlands"],
];

// State
export let _coloredTiles = null;    // Colored tiles from assets/Hexes
export let _coloredFoldersCollapsed = {}; // Track collapsed state of colored tile folders
export const _coloredTagFilters = new Set();

/**
 * Load colored tiles from assets/Hexes folder (inside the module)
 * @param {{rescan?: boolean}} [options] rescan: walk the folders even when this
 *   version's catalogue is cached, for art added since it was written.
 */
export async function loadColoredTileAssets({ rescan = false } = {}) {
	_coloredTiles = [];

	const metadataKey = "hex_tiles_metadata_colored";
	const cached = rescan ? null : await readShippedManifest(metadataKey);
	if (cached) {
		// A catalogue written before the scan decoded the biome below holds
		// "salt%20flats" and "lava%20fields". The cache is stamped with the
		// running module version, so it goes on being served: decoding on the
		// way out repairs a world that already scanned those two folders,
		// instead of waiting for the next release to invalidate the catalogue.
		_coloredTiles = cached.filter(tile => tile.biome !== ARCHIVE_BIOME)
			.map(tile => (tile.biome ? { ...tile, biome: decodeURIComponent(tile.biome) } : tile));
		return;
	}

	try {
		// Load tiles from main Hexes folder
		const mainListing = await browseAssetsAsGM("data", COLORED_TILE_FOLDER);
		if (!mainListing) return;
		const mainPngFiles = (mainListing.files || []).filter(f => f.endsWith(".png") || f.endsWith(".webp"));

		for (const path of mainPngFiles) {
			const filename = path.split("/").pop().replace(/\.(png|webp)$/, "");
			_coloredTiles.push({
				key: filename,
				label: _formatLabel(filename),
				path,
				isColored: true,
				biome: null,  // No biome for root folder tiles
			});
		}

		// Dynamically discover and load tiles from all subdirectories
		const subdirs = mainListing.dirs || [];
		for (const dirPath of subdirs) {
			// FilePicker lists percent-encoded paths, so the Salt Flats folder
			// arrives as "Salt%20Flats". getColoredTilesByBiome() keys its pools
			// by the plain words, so an encoded biome matches no pool at all: the
			// folder spills into `other` — the pool every biome without a folder
			// of its own draws from at random — and the folder's own rule finds an
			// empty pool and always falls through to its fallback.
			const biome = decodeURIComponent(dirPath.split("/").pop());
			if (biome.toLowerCase() === ARCHIVE_BIOME) continue;
			try {
				const biomeListing = await browseAssetsAsGM("data", dirPath);
				if (!biomeListing) continue;
				const biomePngFiles = (biomeListing.files || []).filter(f => f.endsWith(".png") || f.endsWith(".webp"));

				for (const path of biomePngFiles) {
					const filename = path.split("/").pop().replace(/\.(png|webp)$/, "");
					_coloredTiles.push({
						key: filename,
						label: _formatLabel(filename),
						path,
						isColored: true,
						biome: biome.toLowerCase(),  // Normalize to lowercase
					});
				}
			}
			catch(err) {
				// Subdirectory might not be accessible, that's okay
			}
		}

		_coloredTiles.sort((a, b) => a.key.localeCompare(b.key));
		await writeShippedManifest(metadataKey, _coloredTiles, {
			isEmpty: entries => entries.length === 0,
		});
		console.log(`${MODULE_ID} | Loaded ${_coloredTiles.length} colored tiles from ${subdirs.length} folders`);
	}
	catch(err) {
		console.warn(`${MODULE_ID} | Could not load colored tiles:`, err);
		_coloredTiles = [];
	}
}

/**
 * Get colored tiles organized by biome for the generator
 */
export function getColoredTilesByBiome() {
	if (!_coloredTiles) return {};

	const byBiome = {
		water: [],
		"water-arctic": [],
		"water-lake": [],
		"water-river": [],
		vegetation: [],  // Maps to forest/grassland
		jungle: [],      // Palm-only tiles; kept out of vegetation so forest/plains never draw them
		// Hand-picked hex art with its own folder; kept out of `other`, which every
		// biome without a folder of its own draws from at random.
		"lava fields": [],
		"salt flats": [],
		canyons: [],
		mountains: [],
		desert: [],
		swamp: [],
		badlands: [],
		snow: [],
		other: [],  // Tiles in root folder
	};

	for (const tile of _coloredTiles) {
		if (tile.biome && tile.biome === "specials") {
			// Exclude specials from generator
			continue;
		}
		if (tile.biome && byBiome[tile.biome]) {
			byBiome[tile.biome].push(tile.path);
		}
		else {
			byBiome.other.push(tile.path);
		}
	}

	return byBiome;
}

// Parts of a path a random draw leaves out of a folder, keyed by the folder's
// bucket in getColoredTilesByBiome(). "(dark)" is the weak jungle recolour: it
// ships for hand-picked art, not for the pool. Not bare "dark": every path
// contains "shadowdark-extras". "salt flat" keeps salt-flat art, which has its
// own Salt Flats folder, out of the desert pool.
export const DRAW_EXCLUDES = {
	jungle: ["(dark)"],
	desert: ["salt flat"],
	mountains: ["bridge", "mountains spikes"],
};

/**
 * The tiles a random draw may take from `folder` of getColoredTilesByBiome().
 * Hand-picked art still reaches the excluded tiles; this only keeps them out
 * of Solo Hex Mode and the builder's terrain pools.
 */
export function drawPool(byBiome, folder) {
	const excluded = DRAW_EXCLUDES[folder];
	const pool = byBiome[folder] ?? [];
	if (!excluded) return pool;
	return pool.filter(path => {
		const text = decodeURIComponent(path).toLowerCase();
		return !excluded.some(part => text.includes(part));
	});
}

/**
 * Get colored tile dimensions scaled to the active scene grid.
 */
export function getColoredTileDimensions(gridSize) {
	return scaleHexTileDimensions(COLORED_HEX_TILE_W, COLORED_HEX_TILE_H, gridSize);
}

/**
 * Get colored tiles array
 */
export function getColoredTiles() {
	return _coloredTiles || [];
}

export function getColoredTileTags(tile) {
	const biome = String(tile?.biome || "").toLowerCase();
	const text = `${biome} ${tile?.label || ""}`.toLowerCase();
	const tags = new Set(biome ? [biome] : []);
	for (const [needle, tag] of COLORED_TAG_ALIASES) {
		if (text.includes(needle)) tags.add(tag);
	}
	return Array.from(tags).sort();
}

export function getColoredTagOptions() {
	const counts = new Map();
	for (const tile of getColoredTiles()) {
		for (const tag of getColoredTileTags(tile)) counts.set(tag, (counts.get(tag) || 0) + 1);
	}
	return Array.from(counts, ([tag, count]) => ({
		tag,
		label: tag.charAt(0).toUpperCase() + tag.slice(1),
		count,
		active: _coloredTagFilters.has(tag),
	})).sort((a, b) => a.label.localeCompare(b.label));
}

export function getColoredTagFilters() {
	return Array.from(_coloredTagFilters);
}

export function toggleColoredTagFilter(tag) {
	if (_coloredTagFilters.has(tag)) _coloredTagFilters.delete(tag);
	else _coloredTagFilters.add(tag);
}

export function clearColoredTagFilters() {
	_coloredTagFilters.clear();
}

/**
 * Toggle collapsed state of a colored tile folder
 */
export function toggleColoredFolderCollapsed(folderKey) {
	_coloredFoldersCollapsed[folderKey] = !_coloredFoldersCollapsed[folderKey];
}
