// Decor assets and decor-tab state for the hex painter — the leaf that the
// rest of the HexPainterSD.mjs split can import without a cycle.
// Extracted verbatim from scripts/hex/HexPainterSD.mjs (Phase 5.3 sweep 6
// split).
//
// Imports nothing from the painter by design: the painter and its callers
// import these names back under the same identifiers, and a leaf module is
// what keeps the extraction provable (read-only ESM bindings forbid
// cross-module assignment).

import { loadDDPackDecorTiles } from "../dungeon/DDPackManagerSD.mjs";

const MODULE_ID = "shadowdark-extras";
const DECOR_IMPORT_FOLDER = "decor";
const DECOR_DDPACK_FOLDER = "decor/ddpacks";
const DECOR_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

// State
export let _importedDecorTiles = null; // Decor images imported into data/decor
export let _ddPackDecorTiles = null; // Dungeondraft decor images extracted into data/decor/ddpacks
export let _decorSearchFilter = "";
export let _decorFoldersCollapsed = {};
export let _decorElevation = 0;
export let _decorSort = 0;

export function isDecorImagePath(path) {
	const lower = String(path || "").toLowerCase();
	return DECOR_IMAGE_EXTENSIONS.some(ext => lower.split("?")[0].endsWith(ext));
}

export function decorLabelFromPath(path) {
	const file = String(path || "").split("/").pop() || "decor";
	return _formatLabel(file.replace(/\.(png|jpe?g|webp|gif|svg)$/i, ""));
}

export function decorCategoryFromPath(path) {
	const relative = String(path || "").replace(/^decor\/?/, "");
	const parts = relative.split("/").filter(Boolean);
	if (parts.length <= 1) return "__root__";
	return parts.slice(0, -1).join("/");
}

export function getRegisteredDecorTiles() {
	let assets = [];
	try {
		assets = game.settings.get(MODULE_ID, "customDecorAssets") || [];
	}
	catch {
		assets = [];
	}
	return assets
		.filter(asset => asset?.path && isDecorImagePath(asset.path))
		.map(asset => ({
			key: asset.path,
			label: asset.label || decorLabelFromPath(asset.path),
			path: asset.path,
			category: asset.category || (asset.source === "web" ? "Web URL" : "Foundry Library"),
			registered: true,
			source: asset.source || "foundry",
		}));
}

export async function registerDecorAsset(path, { label = null, source = "foundry", category = null } = {}) {
	if (!isDecorImagePath(path)) {
		throw new Error(`Unsupported decor image path: ${path}`);
	}
	const assets = game.settings.get(MODULE_ID, "customDecorAssets") || [];
	const next = assets.filter(asset => asset?.path !== path);
	next.push({
		path,
		label: label || decorLabelFromPath(path),
		source,
		category: category || (source === "web" ? "Web URL" : "Foundry Library"),
	});
	await game.settings.set(MODULE_ID, "customDecorAssets", next);
}

export function decorFolderLabel(folderKey) {
	if (folderKey === "__root__") return "Imported Decor";
	let parts = folderKey
		.split("/")
		.filter(Boolean);
	if (parts.length > 1 && parts[0].toLowerCase() === "imported") {
		parts = parts.slice(1);
	}
	return parts
		.map(part => {
			const decoded = decodeURIComponent(part).replace(/[_-]+/g, " ");
			return _formatLabel(decoded);
		})
		.join(" / ");
}

export async function browseDecorFolderRecursive(folderPath, out = []) {
	const normalizedFolder = String(folderPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
	if (normalizedFolder === DECOR_DDPACK_FOLDER || normalizedFolder.startsWith(`${DECOR_DDPACK_FOLDER}/`)) {
		return out;
	}
	const FP = foundry.applications.apps.FilePicker.implementation;
	const listing = await FP.browse("data", folderPath);
	for (const file of listing.files || []) {
		if (!isDecorImagePath(file)) continue;
		out.push({
			key: file,
			label: decorLabelFromPath(file),
			path: file,
			category: decorCategoryFromPath(file),
			imported: true,
		});
	}
	for (const dir of listing.dirs || []) {
		const normalizedDir = String(dir || "").replace(/\\/g, "/").replace(/\/+$/, "");
		if (normalizedDir === DECOR_DDPACK_FOLDER || normalizedDir.startsWith(`${DECOR_DDPACK_FOLDER}/`)) continue;
		await browseDecorFolderRecursive(dir, out);
	}
	return out;
}

export async function loadImportedDecorAssets({ force = false } = {}) {
	if (_importedDecorTiles && !force) return _importedDecorTiles;
	_importedDecorTiles = [];
	if (!game.user?.isGM) return _importedDecorTiles;

	try {
		_importedDecorTiles = await browseDecorFolderRecursive(DECOR_IMPORT_FOLDER, []);
		_importedDecorTiles.sort((a, b) => a.path.localeCompare(b.path));
	}
	catch (err) {
		console.log(`${MODULE_ID} | Imported decor folder not available yet:`, err?.message || err);
		_importedDecorTiles = [];
	}
	return _importedDecorTiles;
}

export async function reloadDecorAssets() {
	_importedDecorTiles = null;
	_ddPackDecorTiles = null;
	await loadImportedDecorAssets({ force: true });
	await getDDPackDecorAssets({ force: true });
}

export async function getDDPackDecorAssets({ force = false } = {}) {
	if (_ddPackDecorTiles && !force) return _ddPackDecorTiles;
	try {
		_ddPackDecorTiles = await loadDDPackDecorTiles();
	}
	catch (err) {
		console.warn(`${MODULE_ID} | Dungeondraft decor packs not available yet:`, err?.message || err);
		_ddPackDecorTiles = [];
	}
	return _ddPackDecorTiles;
}

/**
 * Set decor search filter
 */
export function setDecorSearchFilter(term) {
	_decorSearchFilter = term.toLowerCase();
}

/**
 * Get decor search filter
 */
export function getDecorSearchFilter() {
	return _decorSearchFilter;
}

/**
 * Toggle collapsed state of a decor tile folder
 */
export function toggleDecorFolderCollapsed(folderKey) {
	const currentlyCollapsed = _decorFoldersCollapsed[folderKey] ?? true;
	_decorFoldersCollapsed[folderKey] = !currentlyCollapsed;
}

export function getDecorElevation() {
	return _decorElevation;
}
export function setDecorElevation(v) {
	_decorElevation = parseFloat(v) || 0;
}
export function getDecorSort() {
	return _decorSort;
}
export function setDecorSort(v) {
	_decorSort = parseInt(v, 10) || 0;
}

export function _formatLabel(key) {
	return key
		.split("-")
		.map(w => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}
