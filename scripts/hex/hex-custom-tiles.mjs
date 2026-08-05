// Custom hex tiles — the data/hexes scan, the custom-tile sizing settings, the
// folder-navigation state and the alpha-bounds placement fit. Another leaf of
// the HexPainterSD.mjs split.
// Extracted verbatim from scripts/hex/HexPainterSD.mjs (Phase 5.3 sweep 6
// split).
//
// Imports nothing from the painter by design: the painter imports these names
// back under the same identifiers, and a leaf module is what keeps the
// extraction provable (read-only ESM bindings forbid cross-module assignment).

import { cache } from "../shared/SDXCache.mjs";
import { _formatLabel } from "./hex-decor.mjs";

const MODULE_ID = "shadowdark-extras";
const CUSTOM_TILE_FOLDER = "hexes";

// Biome subdirectories for custom tiles (matching the 6 sliders)
const BIOME_SUBDIRS = ["water", "vegetation", "mountains", "desert", "swamp", "badlands"];

// State
export let _customTiles = null;     // Custom tiles from data/hexes
export let _customTileBoundsCache = new Map();

// Custom tile sizing
export let _customTileWidth = 296;
export let _customTileHeight = 256;

export let _customNavPath = [];

// Use custom tiles for generation
export let _useCustomForGeneration = false;

/**
 * Ensure the custom hexes folder structure exists.
 * Only GMs can create directories or browse the data folder, so skip
 * non-GM users entirely. Even for GMs, Foundry v14 sometimes rejects
 * the FilePicker calls during early boot phases — downgrade the
 * fallback message to console.log so it doesn't surface as a warning
 * in the noise.
 */
export async function ensureCustomFolderStructure() {
	if (!game.user?.isGM) return;
	try {
		// Check if data/hexes folder exists
		let hexesExists = false;
		try {
			await foundry.applications.apps.FilePicker.implementation.browse("data", CUSTOM_TILE_FOLDER);
			hexesExists = true;
		}
		catch (e) {
			hexesExists = false;
		}

		// Create main hexes folder if it doesn't exist
		if (!hexesExists) {
			await foundry.applications.apps.FilePicker.implementation.createDirectory("data", CUSTOM_TILE_FOLDER);
			console.log(`${MODULE_ID} | Created ${CUSTOM_TILE_FOLDER} folder`);
		}

		// Create biome subdirectories
		for (const biome of BIOME_SUBDIRS) {
			const biomePath = `${CUSTOM_TILE_FOLDER}/${biome}`;
			try {
				await foundry.applications.apps.FilePicker.implementation.browse("data", biomePath);
			}
			catch (e) {
				// Folder doesn't exist, create it
				await foundry.applications.apps.FilePicker.implementation.createDirectory("data", biomePath);
				console.log(`${MODULE_ID} | Created ${biomePath} folder`);
			}
		}
	}
	catch (err) {
		console.log(`${MODULE_ID} | Skipped custom tile folder setup (filesystem permission deferred):`, err?.message || err);
	}
}

export async function _scanCustomDir(dir, segments) {
	const FP = foundry.applications.apps.FilePicker.implementation;
	let listing;
	try {
		listing = await FP.browse("data", dir);
	}
	catch (err) {
		console.log(`${MODULE_ID} | Skipped ${dir} (${err?.message || err})`);
		return [];
	}

	const results = [];
	for (const path of (listing.files || [])) {
		const filename = path.split("/").pop();
		if (!filename || filename.startsWith(".") || filename === "Thumbs.db") continue;
		if (!/\.(png|webp)$/i.test(filename)) continue;

		const stem = filename.replace(/\.(png|webp)$/i, "");
		const biome = (segments[0] && BIOME_SUBDIRS.includes(segments[0])) ? segments[0] : null;
		results.push({
			key: stem,
			label: _formatLabel(_decodePathLabel(stem)),
			path,
			isCustom: true,
			segments: segments.slice(),
			biome,
		});
	}

	const subdirs = (listing.dirs || []).filter(d => {
		const name = d.split("/").pop();
		return name && !name.startsWith(".");
	});
	const childResults = await Promise.all(subdirs.map(d => {
		const name = d.split("/").pop();
		return _scanCustomDir(d, segments.concat([name]));
	}));
	for (const arr of childResults) results.push(...arr);

	return results;
}

/**
 * Load custom tiles from data/hexes folder, recursively.
 */
export async function loadCustomTileAssets() {
	_customTiles = [];

	const metadataKey = "hex_tiles_metadata_custom_v2";
	const cached = await cache.getMetadata(metadataKey);
	if (cached) {
		_customTiles = cached;
		return;
	}

	// FilePicker.browse requires GM permission. Skip for non-GMs; they'll
	// get whatever the GM has cached, but never produce permission warnings.
	if (!game.user?.isGM) return;

	await ensureCustomFolderStructure();

	try {
		_customTiles = await _scanCustomDir(CUSTOM_TILE_FOLDER, []);
		_customTiles.sort((a, b) => a.key.localeCompare(b.key));
		await cache.setMetadata(metadataKey, _customTiles);
		console.log(`${MODULE_ID} | Loaded ${_customTiles.length} custom tiles (recursive scan)`);
	}
	catch (err) {
		// Filesystem browse can fail during early boot phases even for GMs
		// in Foundry v14. Recoverable: log only, do not surface warnings.
		console.log(`${MODULE_ID} | Skipped custom tile load (filesystem permission deferred):`, err?.message || err);
		_customTiles = [];
	}
}

export async function reloadCustomTiles() {
	try {
		await cache.setMetadata("hex_tiles_metadata_custom_v2", null);
	}
	catch (_) {
		// Ignore cache clear failures; the in-memory scan still refreshes.
	}
	_customTiles = null;
	_customNavPath = [];
	_customTileBoundsCache.clear();
	await loadCustomTileAssets();
}

/**
 * Get custom tiles organized by biome for the generator
 */
export function getCustomTilesByBiome() {
	if (!_customTiles) return {};

	const byBiome = {
		water: [],
		vegetation: [],  // Maps to forest/grassland
		mountains: [],
		desert: [],
		swamp: [],
		badlands: [],
		other: [],  // Tiles in root folder
	};

	for (const tile of _customTiles) {
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
 * Check if custom tiles should be used for generation
 */
export function isUseCustomForGeneration() {
	return _useCustomForGeneration;
}

/**
 * Toggle use of custom tiles for generation
 */
export function toggleUseCustomForGeneration() {
	_useCustomForGeneration = !_useCustomForGeneration;
}

/**
 * Set use of custom tiles for generation
 */
export function setUseCustomForGeneration(value) {
	_useCustomForGeneration = !!value;
}

/**
 * Get current custom tile dimensions
 */
export function getCustomTileDimensions() {
	return { width: _customTileWidth, height: _customTileHeight };
}

/**
 * Set custom tile dimensions and persist to settings
 */
export function setCustomTileDimension(axis, value) {
	const clamped = Math.max(50, Math.min(1000, parseInt(value) || 296));
	if (axis === "width") {
		_customTileWidth = clamped;
		game.settings.set(MODULE_ID, "hexPainter.customTileWidth", clamped);
	}
	if (axis === "height") {
		_customTileHeight = clamped;
		game.settings.set(MODULE_ID, "hexPainter.customTileHeight", clamped);
	}
}

/**
 * Load custom tile dimensions from settings
 */
export function loadCustomTileDimensions() {
	try {
		_customTileWidth = game.settings.get(MODULE_ID, "hexPainter.customTileWidth") || 296;
		_customTileHeight = game.settings.get(MODULE_ID, "hexPainter.customTileHeight") || 256;
	}
	catch (e) {
		// Settings not registered yet, use defaults
		_customTileWidth = 296;
		_customTileHeight = 256;
	}
}

export async function getImageAlphaBounds(src) {
	if (_customTileBoundsCache.has(src)) return _customTileBoundsCache.get(src);

	const image = new Image();
	const loaded = new Promise((resolve, reject) => {
		image.onload = () => resolve();
		image.onerror = reject;
	});
	image.src = src;
	await loaded;

	const width = image.naturalWidth || image.width;
	const height = image.naturalHeight || image.height;
	if (!width || !height) {
		const empty = { imageWidth: 0, imageHeight: 0, minX: 0, minY: 0, width: 0, height: 0 };
		_customTileBoundsCache.set(src, empty);
		return empty;
	}

	const canvasEl = document.createElement("canvas");
	canvasEl.width = width;
	canvasEl.height = height;
	const ctx = canvasEl.getContext("2d");
	ctx.drawImage(image, 0, 0);

	const pixels = ctx.getImageData(0, 0, width, height).data;
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (pixels[(y * width + x) * 4 + 3] <= 8) continue;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}

	const bounds = maxX >= 0
		? { imageWidth: width, imageHeight: height, minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 }
		: { imageWidth: width, imageHeight: height, minX: 0, minY: 0, width, height };
	_customTileBoundsCache.set(src, bounds);
	return bounds;
}

export async function getCustomTilePlacement(src, center, verticalNudge = 0) {
	try {
		const bounds = await getImageAlphaBounds(src);
		if (!bounds.imageWidth || !bounds.imageHeight || !bounds.width || !bounds.height) {
			throw new Error("No image bounds");
		}

		const scaleX = _customTileWidth / bounds.width;
		const scaleY = _customTileHeight / bounds.height;
		const width = Math.round(bounds.imageWidth * scaleX);
		const height = Math.round(bounds.imageHeight * scaleY);
		const visibleOffsetX = bounds.minX * scaleX;
		const visibleOffsetY = bounds.minY * scaleY;

		return {
			width,
			height,
			x: center.x - (_customTileWidth / 2) - visibleOffsetX,
			y: center.y - (_customTileHeight / 2) - visibleOffsetY - verticalNudge,
		};
	}
	catch (err) {
		console.log(`${MODULE_ID} | Could not auto-fit custom tile ${src}:`, err?.message || err);
		return {
			width: _customTileWidth,
			height: _customTileHeight,
			x: center.x - _customTileWidth / 2,
			y: center.y - _customTileHeight / 2 - verticalNudge,
		};
	}
}

/**
 * Get custom tiles array
 */
export function getCustomTiles() {
	return _customTiles || [];
}

export function getCustomNavPath() {
	return _customNavPath.slice();
}

export function setCustomNavPath(segments) {
	_customNavPath = Array.isArray(segments) ? segments.slice() : [];
}

export function appendCustomNavSegment(segment) {
	if (typeof segment === "string" && segment.length) {
		_customNavPath.push(segment);
	}
}

export function getCustomNavChips() {
	if (!_customTiles || !_customTiles.length) return [];
	const depth = _customNavPath.length;
	const counts = new Map();
	for (const tile of _customTiles) {
		const segments = Array.isArray(tile.segments) ? tile.segments : [];
		if (segments.length <= depth) continue;

		let inScope = true;
		for (let i = 0; i < depth; i++) {
			if (segments[i] !== _customNavPath[i]) {
				inScope = false;
				break;
			}
		}
		if (!inScope) continue;

		const name = segments[depth];
		counts.set(name, (counts.get(name) || 0) + 1);
	}

	return Array.from(counts.entries())
		.map(([name, count]) => ({ name, label: _decodePathLabel(name), count }))
		.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

export function _decodePathLabel(value) {
	try {
		return decodeURIComponent(String(value || ""));
	}
	catch (_) {
		return String(value || "");
	}
}
