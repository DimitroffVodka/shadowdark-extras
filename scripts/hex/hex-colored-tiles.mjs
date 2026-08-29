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

const MODULE_ID = "shadowdark-extras";
const COLORED_TILE_FOLDER = `modules/${MODULE_ID}/assets/Hexes`;
const COLORED_HEX_TILE_W = 572;
const COLORED_HEX_TILE_H = 500;

// State
export let _coloredTiles = null;    // Colored tiles from assets/Hexes
export let _coloredFoldersCollapsed = {}; // Track collapsed state of colored tile folders

/**
 * Load colored tiles from assets/Hexes folder (inside the module)
 */
export async function loadColoredTileAssets() {
	_coloredTiles = [];

	const metadataKey = "hex_tiles_metadata_colored";
	const cached = await readShippedManifest(metadataKey);
	if (cached) {
		_coloredTiles = cached;
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
			const biome = dirPath.split("/").pop();
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
		vegetation: [],  // Maps to forest/grassland
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

/**
 * Get colored tile dimensions (fixed size)
 */
export function getColoredTileDimensions() {
	return { width: COLORED_HEX_TILE_W, height: COLORED_HEX_TILE_H };
}

/**
 * Get colored tiles array
 */
export function getColoredTiles() {
	return _coloredTiles || [];
}

/**
 * Toggle collapsed state of a colored tile folder
 */
export function toggleColoredFolderCollapsed(folderKey) {
	_coloredFoldersCollapsed[folderKey] = !_coloredFoldersCollapsed[folderKey];
}
