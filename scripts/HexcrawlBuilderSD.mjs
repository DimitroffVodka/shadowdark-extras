/**
 * Hexcrawl Builder (generic) — shadowdark-extras
 * ════════════════════════════════════════════════════════════════════════════
 * Build a finished hex-crawl Scene from a plain data object, wired into SDX's
 * existing hex system (HEXODDQ grid, painted biome tiles, per-hex records read
 * by HexTooltipSD's hover tooltip + Hex Editor).
 *
 * This engine is content-agnostic: feed it a `dataset` and it produces:
 *   1. a Scene formatted as a hex grid sized to the dataset,
 *   2. SDX biome tiles painted across the grid (default + region overrides),
 *   3. a feature-icon tile centred on each keyed hex,
 *   4. a per-hex record (name / terrain / notes) in `__sdx_hex_data__`.
 *
 * RollTables / encounter linking are handled separately (Pass B).
 *
 * ── DATASET SHAPE ───────────────────────────────────────────────────────────
 * {
 *   name: "The Gloaming",
 *   grid: {
 *     cols: 11, rows: 17,            // PUBLISHED columns (num%100) / rows (num/100)
 *     distance: 2, units: "mi",
 *     landscape: true,              // transpose so the long (row) axis is horizontal
 *     flipX: false, flipY: false    // mirror to match the printed map's handedness
 *   },
 *   terrainTile: { w: 572, h: 500 }, // render size for biome tiles (colored-set dims)
 *   featureIconSize: 150,
 *   terrain: {
 *     default: "forest",            // biome key (see BIOME_TILES)
 *     regions: [ { biome:"water", hexes:[504,505,…] }, … ]   // PUBLISHED hex numbers
 *   },
 *   hexes: [
 *     { num: 102, name:"Shattered Tower", terrain:"Forest",
 *       icon:"assets/symbols/Details/Structures - Ruins (stone).png",
 *       desc:"A crumbling keep …", zone:"The Gloaming" },
 *     …
 *   ]
 * }
 *
 * Hex number → published cell:  col = num % 100,  row = floor(num / 100).
 * The geometry layer maps (col,row) → Foundry HEXODDQ offset {i,j}; see makeGeom.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { saveHexRecord, setHexTerrainBatch } from "./HexTooltipSD.mjs";

const MODULE_ID = "shadowdark-extras";

// Hex grid cell geometry — grid.size = HEX_TILE_H so cells are 295.6 × 256.
const HEX_TILE_H = 256;
// Terrain biome tiles use SDX's DEFAULT hex tileset (assets/tiles/hex-tile-*.png),
// which is authored to tessellate edge-to-edge at the base 296×256 cell size —
// the exact set + size HexGeneratorSD paints with, so no gaps and a proven render
// path. (The themed "colored" set under assets/Hexes/ needs different handling and
// is not used here.)
const TERRAIN_TILE_W = 296;
const TERRAIN_TILE_H = 256;
// Column horizontal pitch for HEXODDQ is 0.75 × cell-width; cell-width ≈ H·2/√3.
const HEX_CELL_W = HEX_TILE_H * 2 / Math.sqrt(3); // ≈ 295.6

// Biome key → SDX default hex tiles (assets/tiles/). First entry is the default;
// the list gives deterministic per-cell variety.
const BIOME_TILES = {
	forest: {
		terrain: "Forest",
		paths: [
			"assets/tiles/hex-tile-evergreen1.png",
			"assets/tiles/hex-tile-evergreen2.png",
			"assets/tiles/hex-tile-evergreen3.png",
			"assets/tiles/hex-tile-forest1.png",
			"assets/tiles/hex-tile-forest3.png",
			"assets/tiles/hex-tile-forestmixed1.png",
		],
	},
	plains: {
		terrain: "Plains",
		paths: [
			"assets/tiles/hex-tile-grassland1.png",
			"assets/tiles/hex-tile-grassland2.png",
			"assets/tiles/hex-tile-grassland3.png",
		],
	},
	hills: {
		terrain: "Hills",
		paths: [
			"assets/tiles/hex-tile-hills1.png",
			"assets/tiles/hex-tile-hills2.png",
			"assets/tiles/hex-tile-hills3.png",
		],
	},
	water: {
		terrain: "Water",
		isWater: true,
		paths: [
			"assets/tiles/ocean.png",
			"assets/tiles/ocean2.png",
			"assets/tiles/waves.png",
		],
	},
	swamp: {
		terrain: "Swamp",
		paths: [
			"assets/tiles/hex-tile-swamp1.png",
			"assets/tiles/hex-tile-swamp2.png",
			"assets/tiles/hex-tile-swamp3.png",
		],
	},
	mountains: {
		terrain: "Mountains",
		paths: [
			"assets/tiles/hex-tile-mountains1.png",
			"assets/tiles/hex-tile-mountains2.png",
			"assets/tiles/hex-tile-mountains3.png",
		],
	},
};

const prefix = (p) => `modules/${MODULE_ID}/${p.replace(/^modules\/[^/]+\//, "")}`;

// ── number / geometry helpers ───────────────────────────────────────────────

/** Hex map number → { col, row }. e.g. 1403 → {col:3, row:14}; 102 → {col:2, row:1}. */
export function hexNumToColRow(num) {
	const n = Number(num);
	return { col: n % 100, row: Math.floor(n / 100) };
}

/**
 * Build the layout geometry from dataset.grid. Maps published (col,row) to a
 * Foundry HEXODDQ offset {i,j}, optionally transposed (landscape) and mirrored.
 */
function makeGeom(dataset) {
	const pubCols = dataset.grid?.cols ?? 11;   // 01..pubCols
	const pubRows = dataset.grid?.rows ?? 17;   // 00..pubRows-1
	const landscape = !!dataset.grid?.landscape;
	const flipX = !!dataset.grid?.flipX;
	const flipY = !!dataset.grid?.flipY;

	const gridCols = landscape ? pubRows : pubCols; // Foundry columns (x cells)
	const gridRows = landscape ? pubCols : pubRows; // Foundry rows    (y cells)

	function offsetOf(col, row) {
		const cx = col - 1;  // 0..pubCols-1
		const ry = row;      // 0..pubRows-1
		let j, i;
		if (landscape) {
			j = flipX ? (pubRows - 1 - ry) : ry;   // x runs along published rows
			i = flipY ? (pubCols - 1 - cx) : cx;   // y runs along published cols
		} else {
			j = flipX ? (pubCols - 1 - cx) : cx;
			i = flipY ? (pubRows - 1 - ry) : ry;
		}
		return { i, j };
	}

	return { pubCols, pubRows, gridCols, gridRows, offsetOf };
}

const offsetToHexKey = (off) => `${off.i}_${off.j}`;
const variety = (i, j, len) => (len ? (Math.abs(i * 31 + j * 17) % len) : 0);

// ── scene creation ──────────────────────────────────────────────────────────

async function createHexScene(dataset, geom, { sceneName, overwrite }) {
	const name = sceneName || dataset.name || "Hexcrawl";

	// Size to EXACTLY gridCols × gridRows cells with whole edge hexes (matches
	// HexPainterSD.formatActiveScene). width = floor((N + 1/3)·0.75·HEX_CELL_W)
	// lands on the last column's right vertices — the max width Foundry counts as
	// N columns — so the right edge shows whole hexes, not a ~75% flat-cut. Height
	// = N·H − H/2 is the max for N rows. Verified vs HexagonalGrid#calculateDimensions.
	const pxW = Math.floor((geom.gridCols + (1 / 3)) * 0.75 * HEX_CELL_W);
	const pxH = (geom.gridRows * HEX_TILE_H) - (HEX_TILE_H / 2);

	if (overwrite) {
		const existing = game.scenes.filter(s => s.name === name);
		if (existing.length) await Scene.deleteDocuments(existing.map(s => s.id));
	}

	const [scene] = await Scene.createDocuments([{
		name,
		width: pxW,
		height: pxH,
		padding: 0,
		backgroundColor: "#3C3836",
		grid: {
			type: CONST.GRID_TYPES.HEXODDQ,
			size: HEX_TILE_H,
			distance: dataset.grid?.distance ?? 6,
			units: dataset.grid?.units ?? "mi",
		},
		flags: {
			[MODULE_ID]: {
				hexScene: true,
				hexcrawl: { name: dataset.name ?? name, cols: geom.pubCols, rows: geom.pubRows },
			},
		},
	}]);
	return scene;
}

async function viewSceneReady(scene) {
	if (canvas.scene?.id !== scene.id) await scene.view();
	for (let tries = 0; tries < 60; tries++) {
		if (canvas.ready && canvas.scene?.id === scene.id && canvas.grid) break;
		await new Promise(r => setTimeout(r, 100));
	}
	if (!canvas.grid) throw new Error("SDX Hexcrawl | canvas grid not ready after scene view");
}

// ── terrain painting ────────────────────────────────────────────────────────

function buildRegionMap(dataset) {
	const map = new Map(); // published hex number → biome key
	for (const region of dataset.terrain?.regions ?? []) {
		for (const num of region.hexes ?? []) map.set(Number(num), region.biome);
	}
	return map;
}

async function paintTerrain(scene, dataset, geom) {
	const defaultBiome = dataset.terrain?.default ?? "forest";
	const regionMap = buildRegionMap(dataset);
	const tw = dataset.terrainTile?.w ?? TERRAIN_TILE_W;
	const th = dataset.terrainTile?.h ?? TERRAIN_TILE_H;

	const tileData = [];
	const terrainMap = {}; // hexKey -> terrain label

	for (let row = 0; row < geom.pubRows; row++) {
		for (let col = 1; col <= geom.pubCols; col++) {
			const num = row * 100 + col;
			const biomeKey = regionMap.get(num) ?? defaultBiome;
			const biome = BIOME_TILES[biomeKey] ?? BIOME_TILES.forest;
			const off = geom.offsetOf(col, row);
			const center = canvas.grid.getCenterPoint(off);
			const src = biome.paths[variety(off.i, off.j, biome.paths.length)];

			tileData.push({
				texture: { src: prefix(src), anchorX: 0, anchorY: 0 },
				x: center.x - tw / 2,
				y: center.y - th / 2,
				width: tw,
				height: th,
				sort: Math.floor(center.y),
				flags: { [MODULE_ID]: { painted: true, biome: biome.isWater ? "water" : undefined } },
			});
			terrainMap[offsetToHexKey(off)] = biome.terrain;
		}
	}

	const created = await scene.createEmbeddedDocuments("Tile", tileData);
	await setHexTerrainBatch(scene.id, terrainMap);
	return created.length;
}

// ── feature icons ───────────────────────────────────────────────────────────

async function placeFeatureIcons(scene, dataset, geom) {
	const iconSize = dataset.featureIconSize ?? 150;
	const tileData = [];
	for (const hex of dataset.hexes ?? []) {
		if (!hex.icon) continue;
		const { col, row } = hexNumToColRow(hex.num);
		const center = canvas.grid.getCenterPoint(geom.offsetOf(col, row));
		tileData.push({
			texture: { src: prefix(hex.icon), anchorX: 0, anchorY: 0 },
			x: center.x - iconSize / 2,
			y: center.y - iconSize / 2,
			width: iconSize,
			height: iconSize,
			sort: 20000 + Math.floor(center.y),
			flags: { [MODULE_ID]: { hexcrawlFeature: true, hexNum: hex.num } },
		});
	}
	if (!tileData.length) return 0;
	const created = await scene.createEmbeddedDocuments("Tile", tileData);
	return created.length;
}

// ── per-hex records ─────────────────────────────────────────────────────────

function buildRecord(hex, dataset) {
	const notes = [];
	if (hex.desc) notes.push({ id: foundry.utils.randomID(), text: hex.desc, visible: false });
	return {
		name: hex.name ? `${hex.num}. ${hex.name}` : String(hex.num),
		zone: hex.zone ?? dataset.name ?? "",
		terrain: hex.terrain ?? "",
		travel: "",
		exploration: "unexplored",
		cleared: false,
		claimed: false,
		revealRadius: -1,
		revealCells: "",
		rollTable: "",
		rollTableChance: 100,
		rollTableFirstOnly: false,
		showToPlayers: false,
		features: [],
		notes,
	};
}

async function writeHexRecords(scene, dataset, geom) {
	let count = 0;
	for (const hex of dataset.hexes ?? []) {
		const { col, row } = hexNumToColRow(hex.num);
		await saveHexRecord(scene.id, offsetToHexKey(geom.offsetOf(col, row)), buildRecord(hex, dataset));
		count++;
	}
	return count;
}

// ── public entry point ──────────────────────────────────────────────────────

/**
 * Build a complete hexcrawl scene from a dataset object.
 * @param {object} dataset  see DATASET SHAPE at top of file
 * @param {object} [opts]   { sceneName?, overwrite? }
 * @returns {Promise<object>} summary { sceneId, sceneName, terrainTiles, featureTiles, records }
 */
export async function buildHexcrawl(dataset, opts = {}) {
	if (!game.user?.isGM) {
		ui.notifications?.error("SDX | Only a GM can build a hexcrawl.");
		return null;
	}
	if (!dataset || !Array.isArray(dataset.hexes)) {
		ui.notifications?.error("SDX | Invalid hexcrawl dataset (missing hexes[]).");
		return null;
	}

	const geom = makeGeom(dataset);
	ui.notifications?.info(`SDX | Building hexcrawl "${dataset.name ?? "Hexcrawl"}"…`);
	const scene = await createHexScene(dataset, geom, opts);
	await viewSceneReady(scene);

	const terrainTiles = await paintTerrain(scene, dataset, geom);
	const featureTiles = await placeFeatureIcons(scene, dataset, geom);
	const records = await writeHexRecords(scene, dataset, geom);

	// Tiles created on a freshly-viewed scene can leave their meshes parked at the
	// origin until the Tiles layer is redrawn. Force a clean redraw so the map
	// renders in place immediately after building.
	try { await canvas.tiles?.draw?.(); } catch (err) {
		console.warn(`${MODULE_ID} | post-build tiles redraw failed`, err);
	}

	const summary = { sceneId: scene.id, sceneName: scene.name, terrainTiles, featureTiles, records };
	ui.notifications?.info(
		`SDX | Hexcrawl built: ${terrainTiles} terrain, ${featureTiles} features, ${records} keyed hexes.`
	);
	return summary;
}

/**
 * Convenience: fetch a dataset JSON shipped under the module dir and build it.
 * @param {string} relPath e.g. "dev/hexcrawls/gloaming.json"
 */
export async function buildHexcrawlFromFile(relPath, opts = {}) {
	const url = `modules/${MODULE_ID}/${relPath}`;
	let dataset;
	try {
		dataset = await foundry.utils.fetchJsonWithTimeout(url);
	} catch (err) {
		ui.notifications?.error(`SDX | Could not load hexcrawl dataset: ${relPath}`);
		console.error(`${MODULE_ID} | fetch hexcrawl dataset failed`, err);
		return null;
	}
	return buildHexcrawl(dataset, opts);
}
