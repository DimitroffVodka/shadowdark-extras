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
 *     cols: 17, rows: 11,            // published columns / rows, both start at 1
 *     origin: 1,                     // 0 when the map's own first column/row is 0
 *     firstRow: 1,                   // optional; first row in the raised columns
 *     rowsLowered: 11,               // optional; row count of the half-hex-shifted columns
 *     distance: 2, units: "mi",
 *     landscape: false,             // true transposes the published axes
 *     flipX: false, flipY: false    // mirror to match the printed map's handedness
 *   },
 *   terrainTile: { w: 296, h: 256 }, // optional render size (default SDX tiles)
 *   featureIconSize: 150,
 *   terrain: {
 *     default: "forest",            // biome key (see BIOME_TILES)
 *     regions: [ { biome:"water", hexes:[504,505,…] }, … ]   // PUBLISHED hex numbers
 *   },
 *   hexes: [
 *     { num: 102, name:"Shattered Tower", terrain:"Forest",
 *       icon:"assets/symbols/Details/Structures - Ruins (stone).webp",
 *       desc:"A crumbling keep …", zone:"The Gloaming",
 *       special: "modules/shadowdark-extras/assets/Hexes/Specials/keep.webp",
 *       art: "modules/shadowdark-extras/assets/Hexes/Vegetation/Hex - Forest.webp" },
 *     …
 *   ],
 *   networks: { river: [1402,1403], road: [1403,1404],
 *     blockedEdges: { river: [[1402,1403]] } }, // optional explicit non-joins
 *   reference: { src: "worlds/my-world/reference.webp" } // optional tracing Tile
 * }
 *
 * Stable api.hex contract: col = floor(num / 100), row = num % 100.
 * With no transpose/flips, 1403 → offset {i:2,j:13}. Only num crosses the API.
 * The root buildHexcrawl / buildHexcrawlFromFile retain the OLD dataset layout:
 * their cols counts trailing digits (starting at 1), rows counts leading digits
 * (starting at 0), and landscape transposes those legacy axes. Do not use them
 * for new integrations. Persisted legacy scenes are never silently re-keyed.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { saveHexRecord, setHexTerrainBatch, mergeHexRecords, ZONE_COLORS } from "./HexTooltipSD.mjs";
import { buildMapPathNetwork, mapPathEdgeKey } from "../canvas/drawing-geometry.mjs";
import { ART_IMAGE, coastArtPlacements, coastCells } from "../canvas/map-network-art.mjs";
import { getSpecialTiles } from "./hex-special-tiles.mjs";
import { getColoredTileDimensions, getColoredTiles, getColoredTilesByBiome, loadColoredTileAssets } from "./hex-colored-tiles.mjs";
import { getHexRecordMap, getHexTerrainMap, getWaterHexKeys, isArcticTerrain, isWaterTerrain } from "./hex-water-terrain.mjs";
import { importHexerMap, openHexerImportDialog } from "./HexerImporterSD.mjs";

const MODULE_ID = "shadowdark-extras";

// Hex grid cell geometry — grid.size = HEX_TILE_H so cells are 295.6 × 256.
const HEX_TILE_H = 256;
// Default terrain tiles tessellate at the base 296×256 cell size. Published
// builds also follow the Hex Painter's Colored tab and reuse its larger footprint.
const TERRAIN_TILE_W = 296;
const TERRAIN_TILE_H = 256;
// Column horizontal pitch for HEXODDQ is 0.75 × cell-width; cell-width ≈ H·2/√3.
const HEX_CELL_W = HEX_TILE_H * 2 / Math.sqrt(3); // ≈ 295.6

// Biome key → SDX default hex tiles (assets/tiles/). First entry is the default;
// the list gives deterministic per-cell variety.
const BIOME_TILES = {
	desert: {
		terrain: "Desert",
		colored: "desert",
		paths: ["assets/tiles/hex-tile-desert1.webp", "assets/tiles/hex-tile-desert2.webp", "assets/tiles/hex-tile-desert3.webp"],
	},
	forest: {
		terrain: "Forest",
		colored: "vegetation",
		coloredIncludes: ["forest", "trees"],
		paths: [
			"assets/tiles/hex-tile-evergreen1.webp",
			"assets/tiles/hex-tile-evergreen2.webp",
			"assets/tiles/hex-tile-evergreen3.webp",
			"assets/tiles/hex-tile-forest1.webp",
			"assets/tiles/hex-tile-forest3.webp",
			"assets/tiles/hex-tile-forestmixed1.webp",
		],
	},
	plains: {
		terrain: "Plains",
		colored: "vegetation",
		coloredIncludes: ["plains"],
		paths: [
			"assets/tiles/hex-tile-grassland1.webp",
			"assets/tiles/hex-tile-grassland2.webp",
			"assets/tiles/hex-tile-grassland3.webp",
		],
	},
	hills: {
		terrain: "Hills",
		colored: "vegetation",
		coloredIncludes: ["hills"],
		paths: [
			"assets/tiles/hex-tile-hills1.webp",
			"assets/tiles/hex-tile-hills2.webp",
			"assets/tiles/hex-tile-hills3.webp",
		],
	},
	water: {
		terrain: "Water",
		isWater: true,
		colored: "water",
		paths: [
			"assets/tiles/ocean.webp",
			"assets/tiles/ocean2.webp",
			"assets/tiles/waves.webp",
		],
	},
	swamp: {
		terrain: "Swamp",
		colored: "swamp",
		paths: [
			"assets/tiles/hex-tile-swamp1.webp",
			"assets/tiles/hex-tile-swamp2.webp",
			"assets/tiles/hex-tile-swamp3.webp",
		],
	},
	mountains: {
		terrain: "Mountains",
		colored: "mountains",
		paths: [
			"assets/tiles/hex-tile-mountains1.webp",
			"assets/tiles/hex-tile-mountains2.webp",
			"assets/tiles/hex-tile-mountains3.webp",
		],
	},
};

const prefix = p => `modules/${MODULE_ID}/${p.replace(/^modules\/[^/]+\//, "")}`;

// Preserve the imported terrain label; these fallbacks affect painting only.
// "coast" is land on a shore, the same reading hex-water-terrain.mjs and the
// Enhancer's tagger use: painting it as sea put a beach in open water.
const TERRAIN_BIOMES = {
	"arctic sea": "water", "canyon": "hills", "coast": "plains", "deep tunnels": "mountains",
	"grassland": "plains", "jungle": "forest", "lake": "water", "lava": "mountains",
	"mountain": "mountains", "ocean": "water", "river": "water", "path": "plains", "salt flat": "desert",
};
const TERRAIN_COLORED_RULES = {
	"arctic sea": { pool: "water-arctic" },
	canyon: { pool: "desert", include: ["hills"] },
	"deep tunnels": { pool: "mountains", include: ["rocky"] },
	jungle: { pool: "vegetation", include: ["forest", "/trees2.webp"] },
	lake: { pool: "water-lake" },
	lava: { pool: "specials", include: ["/lava.webp"] },
	mountain: { pool: "mountains", exclude: ["bridge", "mountains spikes"] },
	river: { pool: "water-river" },
	"salt flat": { pool: "desert", include: ["plains"] },
	volcano: { pool: "specials", include: ["volcano"] },
};
const biomeFor = label => {
	const key = label.toLowerCase().trim();
	const biome = Object.hasOwn(TERRAIN_BIOMES, key) ? TERRAIN_BIOMES[key] : key;
	return Object.hasOwn(BIOME_TILES, biome) ? BIOME_TILES[biome] : undefined;
};

// Settlement kinds a keyed hex's `features` may carry, and the Specials tiles
// that paint them, as substrings of the lower-cased decoded path. Reused
// freely, unlike a one-use `special`: thirty villages are thirty farmsteads.
// Curated `art` and a `special` still outrank this; the terrain tile is what a
// keyed hex with no settlement gets.
const FEATURE_COLORED_RULES = {
	city: ["city (lush)"], city_state: ["city (lush)"],
	town: ["town (lush)", "modern town, inhabited"],
	village: ["farm (lush)"],
};
const settlementOf = features => (Array.isArray(features) ? features : [])
	.map(feature => String(feature?.type ?? "").toLowerCase())
	.find(type => Object.hasOwn(FEATURE_COLORED_RULES, type));
const specialsPool = () => getColoredTiles().filter(tile => tile.biome === "specials").map(tile => tile.path);

// ── number / geometry helpers ───────────────────────────────────────────────

/** Published hex number → { col, row }. 1403 → {col:14, row:3}. */
export function hexNumToColRow(num) {
	const n = Number(num);
	return { col: Math.floor(n / 100), row: n % 100 };
}

/**
 * Build the layout geometry from dataset.grid. Maps published (col,row) to a
 * Foundry HEXODDQ offset {i,j}, optionally transposed (landscape) and mirrored.
 */
function makeGeom(dataset, published = false) {
	const pubCols = dataset.grid?.cols ?? 11;
	const pubRows = dataset.grid?.rows ?? 17;
	const origin = published ? (dataset.grid?.origin ?? 1) : 1;
	const firstRow = published ? (dataset.grid?.firstRow ?? origin) : origin;
	const rowsLowered = published ? (dataset.grid?.rowsLowered ?? pubRows) : pubRows;
	const landscape = !!dataset.grid?.landscape;
	const flipX = !!dataset.grid?.flipX;
	const flipY = !!dataset.grid?.flipY;

	const gridCols = landscape ? pubRows : pubCols; // Foundry columns (x cells)
	const gridRows = landscape ? pubCols : pubRows; // Foundry rows    (y cells)

	function offsetOf(col, row) {
		const cx = published ? col - origin : row - 1;
		const ry = published ? row - origin : col;
		let j; let i;
		if (landscape) {
			j = flipX ? (pubRows - 1 - ry) : ry;   // x runs along published rows
			i = flipY ? (pubCols - 1 - cx) : cx;   // y runs along published cols
		}
		else {
			j = flipX ? (pubCols - 1 - cx) : cx;
			i = flipY ? (pubRows - 1 - ry) : ry;
		}
		return { i, j };
	}

	// HEXODDQ shifts odd columns half a hex down (Foundry common/grid/hexagonal.mjs,
	// getCenterPoint), so at the scene's maximum height those columns lose their
	// last row. Which published column that is depends on origin and flips, so ask
	// the mapping for the physical column instead of assuming a parity.
	const inGrid = (col, row) => col >= origin && col < pubCols + origin
		&& row >= (offsetOf(col, row).j % 2 === 1 ? origin : firstRow) && row < pubRows + origin
		&& !(row >= rowsLowered + origin && offsetOf(col, row).j % 2 === 1);

	return { pubCols, pubRows, gridCols, gridRows, origin, firstRow, rowsLowered,
		offsetOf, inGrid, published };
}

const offsetToHexKey = off => `${off.i}_${off.j}`;
const variety = (i, j, len) => (len ? (Math.abs(i * 31 + j * 17) % len) : 0);

const RECORD_STRINGS = ["name", "zone", "zoneColor", "terrain", "travel", "revealCells", "rollTable", "desc"];
const RECORD_BOOLEANS = ["cleared", "claimed", "rollTableFirstOnly", "showToPlayers"];
const RECORD_FIELDS = [...RECORD_STRINGS, ...RECORD_BOOLEANS, "exploration", "revealRadius", "rollTableChance", "features", "notes"];
/**
 * Fields a build accepts and a record never keeps: they say how a hex is
 * PAINTED, not what it is. `special` names one of the Specials tiles and may be
 * used once; `art` names any tile in the colored catalogue and may be reused
 * across as many hexes as the map's own curation says, which is the whole point
 * of it — a hand-curated map paints the same forest tile in fifty places.
 */
const BUILD_ONLY_FIELDS = ["icon", "special", "art"];

function requireInput(condition, message) {
	if (!condition) throw new Error(`SDX | Hexcrawl: ${message}`);
}

function validateHexNum(num, geom) {
	requireInput((typeof num === "number" && Number.isSafeInteger(num))
		|| (typeof num === "string" && /^\d{3,4}$/.test(num)), `invalid hex number ${num}`);
	const { col, row } = hexNumToColRow(num);
	requireInput(geom.inGrid(col, row), `hex ${num} is outside the published grid`);
	return Number(num);
}

function validateRecords(records, geom, building = false) {
	requireInput(Array.isArray(records), "hexes/records must be an array");
	const seen = new Set();
	for (const hex of records) {
		requireInput(hex && typeof hex === "object" && !Array.isArray(hex), "each hex must be an object");
		const num = validateHexNum(hex.num, geom);
		requireInput(!seen.has(num), `duplicate hex ${hex.num}`);
		seen.add(num);
		for (const key of Object.keys(hex)) {
			requireInput(key === "num" || RECORD_FIELDS.includes(key) || (building && BUILD_ONLY_FIELDS.includes(key)), `unsupported hex field ${key}; identify cells by num only`);
		}
		for (const key of [...RECORD_STRINGS, ...(building ? BUILD_ONLY_FIELDS : [])]) {
			if (Object.hasOwn(hex, key)) requireInput(typeof hex[key] === "string", `${key} must be text`);
		}
		for (const key of RECORD_BOOLEANS) {
			if (Object.hasOwn(hex, key)) requireInput(typeof hex[key] === "boolean", `${key} must be boolean`);
		}
		if (Object.hasOwn(hex, "exploration")) requireInput(["unexplored", "explored", "mapped"].includes(hex.exploration), "invalid exploration state");
		if (Object.hasOwn(hex, "revealRadius")) requireInput(Number.isInteger(hex.revealRadius) && hex.revealRadius >= -1, "invalid revealRadius");
		if (Object.hasOwn(hex, "rollTableChance")) requireInput(Number.isFinite(hex.rollTableChance) && hex.rollTableChance >= 0 && hex.rollTableChance <= 100, "invalid rollTableChance");
		// A type check is not enough: the swatch picker used to be the only writer,
		// so nothing downstream guards the value. HexTooltipSD's show-all-zones loop
		// calls Color.from(record.zoneColor) with no try/catch, and one unparseable
		// colour throws out of the loop and takes the whole scene's overlay with it.
		if (Object.hasOwn(hex, "zoneColor")) requireInput(/^(#[0-9a-f]{6})?$/i.test(hex.zoneColor), "zoneColor must be empty or #rrggbb");
		for (const key of ["features", "notes"]) {
			if (!Object.hasOwn(hex, key)) continue;
			requireInput(Array.isArray(hex[key]), `${key} must be an array`);
			for (const entry of hex[key]) {
				requireInput(entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.id === "string", `${key} entries need an id`);
				if (key === "notes") requireInput(typeof entry.text === "string" && typeof entry.visible === "boolean", "notes need text and visible");
				else requireInput(typeof entry.type === "string" && typeof entry.name === "string" && typeof entry.discovered === "boolean", "features need type, name and discovered");
			}
		}
	}
}

/** A published grid, as a build or an adoption takes it. */
function validateGrid(grid) {
	requireInput(grid && [grid.cols, grid.rows].every(n => Number.isInteger(n) && n >= 1 && n <= 99), "grid cols/rows must be integers from 1 to 99");
	requireInput(grid.origin === undefined || grid.origin === 0 || grid.origin === 1, "grid.origin must be 0 or 1");
	const origin = grid.origin ?? 1;
	requireInput(grid.firstRow === undefined || [origin, origin + 1].includes(grid.firstRow), "grid.firstRow must be origin or origin+1");
	const rowsLowered = grid.rowsLowered;
	requireInput(rowsLowered === undefined || (Number.isInteger(rowsLowered)
		&& [grid.rows, grid.rows - 1].includes(rowsLowered)), "grid.rowsLowered must be rows or rows-1");
	for (const key of ["landscape", "flipX", "flipY"]) {
		if (Object.hasOwn(grid, key)) requireInput(typeof grid[key] === "boolean", `grid.${key} must be boolean`);
	}
	if (Object.hasOwn(grid, "distance")) requireInput(Number.isFinite(grid.distance) && grid.distance > 0, "distance must be positive");
}

/**
 * The `grid` a version-1 layout flag stores: what makeGeom needs to map a
 * published number to a cell again, with the defaults left out. One writer for
 * builds and adoptions, so an adopted scene's flag compares equal to a built one.
 */
function layoutGrid(geom, grid) {
	return {
		cols: geom.pubCols, rows: geom.pubRows,
		landscape: !!grid.landscape,
		flipX: !!grid.flipX, flipY: !!grid.flipY,
		...(geom.origin === 1 ? {} : { origin: geom.origin }),
		...(geom.firstRow === geom.origin ? {} : { firstRow: geom.firstRow }),
		...(geom.rowsLowered === geom.pubRows ? {} : { rowsLowered: geom.rowsLowered }),
	};
}

function validateDataset(dataset, opts) {
	requireInput(dataset && typeof dataset === "object" && !Array.isArray(dataset), "dataset must be an object");
	requireInput(opts && typeof opts === "object" && !Array.isArray(opts), "options must be an object");
	const grid = dataset.grid;
	validateGrid(grid);
	for (const value of [dataset.name, grid.units, opts.sceneName]) requireInput(value === undefined || typeof value === "string", "name/units must be text");
	for (const key of ["view", "overwrite"]) {
		if (Object.hasOwn(opts, key)) requireInput(typeof opts[key] === "boolean", `${key} must be boolean`);
	}
	for (const value of [dataset.featureIconSize, dataset.terrainTile?.w, dataset.terrainTile?.h]) {
		requireInput(value === undefined || (Number.isFinite(value) && value > 0), "tile sizes must be positive");
	}
	const geom = makeGeom(dataset, true);
	validateRecords(dataset.hexes, geom, true);
	if (dataset.terrain !== undefined) {
		requireInput(dataset.terrain && typeof dataset.terrain === "object", "terrain must be an object");
		if (dataset.terrain.default !== undefined) requireInput(typeof dataset.terrain.default === "string", "default terrain must be text");
		requireInput(Array.isArray(dataset.terrain.regions ?? []), "terrain.regions must be an array");
		for (const region of dataset.terrain.regions ?? []) {
			requireInput(region && typeof region.biome === "string" && Array.isArray(region.hexes), "regions need biome and hexes");
			for (const num of region.hexes) validateHexNum(num, geom);
		}
	}
	if (dataset.networks !== undefined) {
		const networks = dataset.networks;
		requireInput(networks && typeof networks === "object" && !Array.isArray(networks), "networks must be an object");
		for (const key of Object.keys(networks)) requireInput(["road", "river", "blockedEdges", "spanning"].includes(key), `unsupported network ${key}`);
		requireInput(networks.spanning === undefined || typeof networks.spanning === "boolean", "networks.spanning must be boolean");
		if (networks.blockedEdges !== undefined) {
			requireInput(networks.blockedEdges && typeof networks.blockedEdges === "object" && !Array.isArray(networks.blockedEdges), "blockedEdges must be an object");
			for (const key of Object.keys(networks.blockedEdges)) requireInput(["road", "river"].includes(key), `unsupported blockedEdges kind ${key}`);
		}
		for (const kind of ["road", "river"]) {
			requireInput(Array.isArray(networks[kind] ?? []), `${kind} must be a hex-number array`);
			const cells = new Set((networks[kind] ?? []).map(num => validateHexNum(num, geom)));
			const edges = networks.blockedEdges?.[kind] ?? [];
			requireInput(Array.isArray(edges), "blockedEdges must contain pair arrays");
			for (const pair of edges) {
				requireInput(Array.isArray(pair) && pair.length === 2, "blocked edge must be [num,num]");
				const nums = pair.map(num => validateHexNum(num, geom));
				requireInput(nums[0] !== nums[1] && nums.every(num => cells.has(num)), "blocked edge endpoints must belong to that network");
			}
		}
	}
	if (dataset.reference !== undefined) {
		const ref = dataset.reference;
		requireInput(ref && typeof ref.src === "string" && ref.src.length > 0, "reference needs src");
		for (const key of ["x", "y", "width", "height"]) {
			if (Object.hasOwn(ref, key)) requireInput(Number.isFinite(ref[key]) && (["x", "y"].includes(key) || ref[key] > 0), `invalid reference ${key}`);
		}
	}
}

// ── scene creation ──────────────────────────────────────────────────────────

async function createHexScene(dataset, geom, { sceneName }) {
	const name = sceneName || dataset.name || "Hexcrawl";

	// Size to EXACTLY gridCols × gridRows cells with whole edge hexes (matches
	// HexPainterSD.formatActiveScene). width = floor((N + 1/3)·0.75·HEX_CELL_W)
	// lands on the last column's right vertices — the max width Foundry counts as
	// N columns — so the right edge shows whole hexes, not a ~75% flat-cut. Height
	// = N·H − H/2 is the max for N rows. Verified vs HexagonalGrid#calculateDimensions.
	const pxW = Math.floor((geom.gridCols + (1 / 3)) * 0.75 * HEX_CELL_W);
	const pxH = (geom.gridRows * HEX_TILE_H) - (HEX_TILE_H / 2);


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
				hexcrawl: {
					name: dataset.name ?? name, cols: geom.pubCols, rows: geom.pubRows,
					...(geom.published ? { version: 1, grid: layoutGrid(geom, dataset.grid) } : {}),
				},
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
	if (!canvas.ready || canvas.scene?.id !== scene.id || !canvas.grid) {
		throw new Error("SDX Hexcrawl | canvas grid not ready after scene view");
	}
}

// ── terrain painting ────────────────────────────────────────────────────────

function buildRegionMap(dataset) {
	const map = new Map(); // published hex number → biome key
	for (const region of dataset.terrain?.regions ?? []) {
		for (const num of region.hexes ?? []) map.set(Number(num), region.biome);
	}
	return map;
}

/**
 * The Tile document one hex gets.
 *
 * Extracted from paintTerrain's loop so repaintHexTiles selects tiles by
 * EXACTLY the same rules. Two copies of this would drift the first time either
 * side was touched, and the symptom would be a repainted hex that quietly does
 * not match the same hex on a freshly built map.
 *
 * Precedence is the builder's, unchanged: curated `art` outranks a `special`,
 * which outranks a colored-catalogue pick, which outranks the flat biome set.
 */
function hexTileData({ num, biome, biomeKey, center, off, coloredByBiome, tw, th, special, art, feature }) {
	const coloredRule = TERRAIN_COLORED_RULES[String(biomeKey).trim().toLowerCase()];
	let colored = [];
	if (coloredByBiome) {
		const candidates = coloredRule?.pool === "specials"
			? specialsPool()
			: (coloredByBiome[coloredRule?.pool ?? biome.colored] ?? []);
		const includes = coloredRule?.include ?? biome.coloredIncludes;
		colored = candidates.filter(path => {
			const text = decodeURIComponent(path).toLowerCase();
			return (!includes || includes.some(part => text.includes(part)))
				&& !coloredRule?.exclude?.some(part => text.includes(part));
		});
	}
	// A settlement paints as its Specials tile rather than its terrain.
	const settlement = coloredByBiome && FEATURE_COLORED_RULES[feature]
		? specialsPool().filter(path => {
			const text = decodeURIComponent(path).toLowerCase();
			return FEATURE_COLORED_RULES[feature].some(part => text.includes(part));
		})
		: [];
	const pool = settlement.length ? settlement : colored;
	const coloredSrc = pool[variety(off.i, off.j, pool.length)];
	const src = art ?? special?.path ?? coloredSrc
		?? prefix(biome.paths[variety(off.i, off.j, biome.paths.length)]);
	const { width, height } = art || special || coloredSrc
		? getColoredTileDimensions(HEX_TILE_H) : { width: tw, height: th };

	return {
		texture: { src, anchorX: 0, anchorY: 0 },
		x: center.x - (width / 2),
		y: center.y - (height / 2),
		width,
		height,
		sort: Math.floor(center.y),
		flags: { [MODULE_ID]: {
			painted: true, biome: biome.isWater ? "water" : undefined,
			...(art || special || settlement.length ? { hexNum: num } : {}),
		} },
	};
}

async function paintTerrain(scene, dataset, geom, specials) {
	const defaultBiome = dataset.terrain?.default ?? "forest";
	const regionMap = buildRegionMap(dataset);
	const keyedTerrain = new Map((dataset.hexes ?? [])
		.filter(hex => hex.terrain).map(hex => [Number(hex.num), hex.terrain]));
	const specialHexes = new Map((dataset.hexes ?? [])
		.filter(hex => hex.special).map(hex => [Number(hex.num), specials.get(hex.special)]));
	// Curated art: an exact tile the map's author chose for that hex. It is the
	// author's decision, so it outranks everything the builder would work out for
	// itself, and it is honoured whichever tile tab happens to be open.
	const artHexes = new Map((dataset.hexes ?? [])
		.filter(hex => hex.art).map(hex => [Number(hex.num), hex.art]));
	// Keyed settlements: the first city/town/village entry in a hex's features.
	const settlementHexes = new Map((dataset.hexes ?? [])
		.map(hex => [Number(hex.num), settlementOf(hex.features)]).filter(([, kind]) => kind));
	const tw = dataset.terrainTile?.w ?? TERRAIN_TILE_W;
	const th = dataset.terrainTile?.h ?? TERRAIN_TILE_H;
	let coloredByBiome = null;
	// A published build always paints from the colored catalogue. It used to
	// follow the Hex Painter's active tab, so the same hand-off came out in the
	// flat black-and-white set whenever the tray happened to be on Default. The
	// flat set is now the legacy (unpublished) builder's alone.
	if (geom.published) {
		if (!getColoredTiles().length) await loadColoredTileAssets();
		coloredByBiome = getColoredTilesByBiome();
	}

	const tileData = [];
	const terrainMap = {}; // hexKey -> terrain label

	for (let row = 0; row < geom.pubRows; row++) {
		for (let col = geom.published ? geom.origin : 1; col <= geom.pubCols + geom.origin - 1; col++) {
			const num = geom.published ? (col * 100) + row + geom.origin : (row * 100) + col;
			if (geom.published && !geom.inGrid(col, row + geom.origin)) continue;
			const biomeKey = (geom.published ? keyedTerrain.get(num) : undefined)
				?? regionMap.get(num) ?? defaultBiome;
			const biome = geom.published
				? (biomeFor(biomeKey) ?? biomeFor(defaultBiome) ?? BIOME_TILES.forest)
				: (BIOME_TILES[biomeKey] ?? BIOME_TILES.forest);
			const cell = hexNumToColRow(num);
			const off = geom.offsetOf(cell.col, cell.row);
			const center = scene.grid.getCenterPoint(off);
			tileData.push(hexTileData({
				num, biome, biomeKey, center, off, coloredByBiome, tw, th,
				special: specialHexes.get(num), art: artHexes.get(num), feature: settlementHexes.get(num),
			}));
			terrainMap[offsetToHexKey(off)] = geom.published ? biomeKey : biome.terrain;
		}
	}

	const created = await scene.createEmbeddedDocuments("Tile", tileData);
	await setHexTerrainBatch(scene.id, terrainMap);
	return created.length;
}

// ── feature icons ───────────────────────────────────────────────────────────

/**
 * An icon's frame on the map, matching the GM's own reviewed renders: it keeps
 * its aspect; one over 400 px on its long side is brought down to 380, one
 * under 150 px is brought up to 220, both measured in the 932x810 hex canvas
 * whose hex is 418 px tall, and the canvas then scales to the grid. A 26 px
 * pin and a 932 px keep both land at a size that reads on a hex. When the
 * texture cannot be measured (headless) the square box stands in.
 */
async function iconFrame(src, box) {
	let width = 0;
	let height = 0;
	try {
		const texture = await foundry.canvas.loadTexture(src);
		width = texture?.width ?? 0;
		height = texture?.height ?? 0;
	}
	catch(_err) { /* unmeasured: the box below */ }
	if (!width || !height) return { width: box, height: box };
	const longest = Math.max(width, height);
	const canvasLongest = longest > 400 ? 380 : (longest < 150 ? 220 : longest);
	const scale = (canvasLongest / longest) * (HEX_TILE_H / ART_IMAGE.hexHeight);
	return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function placeFeatureIcons(scene, dataset, geom) {
	const iconSize = dataset.featureIconSize ?? 150;
	const frames = new Map();
	const tileData = [];
	for (const hex of dataset.hexes ?? []) {
		if (!hex.icon) continue;
		const { col, row } = hexNumToColRow(hex.num);
		const center = scene.grid.getCenterPoint(geom.offsetOf(col, row));
		const src = geom.published && !hex.icon.startsWith("assets/") ? hex.icon : prefix(hex.icon);
		if (!frames.has(src)) frames.set(src, await iconFrame(src, iconSize));
		const { width, height } = frames.get(src);
		tileData.push({
			texture: { src, anchorX: 0, anchorY: 0 },
			x: center.x - (width / 2),
			y: center.y - (height / 2),
			width,
			height,
			sort: 20000 + Math.floor(center.y),
			flags: { [MODULE_ID]: { hexcrawlFeature: true, hexNum: hex.num } },
		});
	}
	if (!tileData.length) return 0;
	const created = await scene.createEmbeddedDocuments("Tile", tileData);
	return created.length;
}

// ── coasts ──────────────────────────────────────────────────────────────────

// Above every terrain tile, whose sort is its own y, so a neighbour's seam
// overlap never clips the beach; below the feature icons at 20000.
const COAST_SORT = 10000;

/**
 * Beach tiles for the WATER hexes that touch land, read from the scene's own
 * hex records, so they follow whatever terrain the build or a repaint wrote.
 * Derived, not authored: a coast is a water edge with land across it, and the
 * dataset carries no coast field (the Enhancer's tagger keeps its coast
 * overlay to itself for the same reason).
 *
 * The beach sits on the water hex, not the land hex: the piece's straight
 * side lies along the shared edge against the land tile and its wavy side is
 * the waterline, so consecutive pieces join into one continuous shore. Put on
 * the land hex the same art reads as sand wedges cut into the terrain, which
 * is how the first build of this looked. Arctic water gets the ice shelf
 * instead of sand.
 *
 * @param {Scene} scene
 * @param {Set<string>|null} only  hex keys to line, or null for the whole scene
 */
function coastTileData(scene, only = null) {
	const shore = { beach: [], ice: [] };
	const land = new Set();
	for (const [key, label] of getHexTerrainMap(scene.id)) {
		if (!isWaterTerrain(label)) land.add(key);
		else if (!only || only.has(key)) shore[isArcticTerrain(label) ? "ice" : "beach"].push(key);
	}
	const placements = Object.entries(shore).flatMap(([style, keys]) =>
		coastArtPlacements(coastCells(keys, land, scene.grid), scene.grid, style));
	return placements.map(piece => ({
		// Foundry turns and mirrors a tile about its texture anchor and places
		// that anchor at x,y. The terrain tiles anchor at 0,0 with x,y as their
		// top-left corner, which is fine unturned; a turned beach anchored there
		// swings a whole tile away from its hex. So anchor at the centre and put
		// x,y ON the hex centre.
		texture: { src: piece.src, anchorX: 0.5, anchorY: 0.5, scaleX: piece.mirror ? -1 : 1 },
		x: piece.x,
		y: piece.y,
		width: piece.width,
		height: piece.height,
		rotation: piece.rotation * 180 / Math.PI,
		sort: COAST_SORT + Math.floor(piece.y),
		// The value names the hex the beach belongs to, so a repaint can find it
		// without matching positions.
		flags: { [MODULE_ID]: { coast: `${piece.i}_${piece.j}` } },
	}));
}

async function placeCoasts(scene) {
	const tileData = coastTileData(scene);
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

async function writeHexRecords(scene, dataset, geom, specials) {
	if (geom.published) {
		const records = dataset.hexes.map(({ icon: _icon, art: _art, special, ...hex }) => ({
			name: specials.get(special)?.label ?? "", zone: dataset.name ?? "", ...hex,
		}));
		return (await upsertHexRecords(scene.id, records)).records;
	}
	let count = 0;
	for (const hex of dataset.hexes ?? []) {
		const { col, row } = hexNumToColRow(hex.num);
		await saveHexRecord(scene.id, offsetToHexKey(geom.offsetOf(col, row)), buildRecord(hex, dataset));
		count++;
	}
	return count;
}

/**
 * Curated art must name a tile SDX actually ships. Anything else — a path into
 * another module, a remote URL, a file that used to be there — would paint a
 * broken texture on someone else's install, and the dataset comes from outside.
 * Repeats are fine and expected; only membership is checked.
 */
export function coloredTileKey(path) {
	let text = String(path ?? "");
	try {
		text = decodeURIComponent(text);
	}
	catch(_err) {
		// Already decoded, or not valid percent-encoding; compare it as it is.
	}
	return text.replace(/^modules\/[^/]+\//, "").toLowerCase();
}

/**
 * Check every hex's `art` against the catalogue and hand back the hexes with
 * each art path swapped for the catalogue's own. Membership is matched loosely
 * (any module prefix, any case, encoded or not), so the path painted has to be
 * the catalogue's: the caller's spelling of another module, or its casing,
 * would otherwise reach texture.src and paint a broken texture, on a
 * case-sensitive host above all. New objects; the caller's hexes are untouched.
 * @param {object[]} hexes
 * @returns {Promise<object[]>}
 */
async function resolveArt(hexes = []) {
	if (!hexes.some(hex => Object.hasOwn(hex, "art"))) return hexes;
	if (!getColoredTiles().length) await loadColoredTileAssets();
	const catalogue = new Map(getColoredTiles().map(tile => [coloredTileKey(tile.path), tile.path]));
	requireInput(catalogue.size, "no tile catalogue loaded; cannot check hex art");
	return hexes.map(hex => {
		if (!Object.hasOwn(hex, "art")) return hex;
		const path = catalogue.get(coloredTileKey(hex.art));
		requireInput(path, `unknown art ${hex.art} on hex ${hex.num}; use a tile from getColoredTiles()`);
		return { ...hex, art: path };
	});
}

// ── public entry point ──────────────────────────────────────────────────────

/** Install after root API feature gates, sharing the same audited GM wrappers. */
export function installHexcrawlApi(api, namespace, wrap) {
	if (!api.buildHexcrawl) {
		delete namespace.hex;
		return;
	}
	api.hex = namespace.hex = Object.fromEntries(Object.entries({
		buildHexcrawl: buildPublishedHexcrawl, adoptHexcrawl, upsertHexRecords, getHexRecords, repaintHexTiles,
		getSpecialTiles, importHexerMap, openHexerImportDialog,
	}).map(([name, fn]) => [name, wrap(`hex.${name}`, fn)]));
	// Deliberately outside the wrap above: it reads a constant, so gmOnly would
	// hide the palette from a player-side overlay and audited would write a log
	// line every time someone asked what colours exist. Copied per call so a
	// consumer cannot reach in and restyle the editor's own swatches.
	api.hex.getZoneColors = () => ZONE_COLORS.map(colour => ({ ...colour }));
}

/** Stable api.hex entry point. Root buildHexcrawl remains the legacy adapter. */
export async function buildPublishedHexcrawl(dataset, opts = {}) {
	requireInput(game.user?.isGM, "requires GM permission");
	validateDataset(dataset, opts);
	const assigned = dataset.hexes.filter(hex => Object.hasOwn(hex, "special"));
	const specials = new Map((assigned.length ? await getSpecialTiles() : []).map(tile => [tile.id, tile]));
	const used = new Set();
	for (const hex of assigned) {
		requireInput(specials.has(hex.special), `unknown special ${hex.special}; use getSpecialTiles()`);
		requireInput(!used.has(hex.special), `special ${hex.special} is assigned more than once`);
		used.add(hex.special);
	}
	const hexes = await resolveArt(dataset.hexes);
	const resolved = hexes === dataset.hexes ? dataset : { ...dataset, hexes };
	return buildScene(resolved, opts, makeGeom(resolved, true), specials);
}

/** Update records on a scene built with the stable API; does not repaint tiles. */
export async function upsertHexRecords(sceneId, records) {
	requireInput(game.user?.isGM, "requires GM permission");
	const scene = game.scenes.get(sceneId);
	requireInput(scene, "scene not found");
	const layout = scene.getFlag(MODULE_ID, "hexcrawl");
	requireInput(layout?.version === 1 && layout.grid, "scene has no published layout; build it with api.hex.buildHexcrawl, or give an existing map one with api.hex.adoptHexcrawl");
	const geom = makeGeom(layout, true);
	validateRecords(records, geom);
	const patches = {};
	for (const hex of records) {
		const { num, ...patch } = hex;
		const { col, row } = hexNumToColRow(num);
		if (Object.hasOwn(patch, "name")) {
			// A name that already carries this hex's number, such as one read back
			// with getHexRecords ("2849. The Gate", or "2849" for an unnamed hex),
			// keeps one prefix rather than gaining a second.
			const bare = patch.name.replace(new RegExp(`^0*${Number(num)}(\\.\\s*|$)`), "");
			patch.name = bare ? `${num}. ${bare}` : String(num);
		}
		patches[offsetToHexKey(geom.offsetOf(col, row))] = patch;
	}
	if (records.length) await mergeHexRecords(sceneId, patches);
	return { sceneId, records: records.length };
}

/**
 * Read a scene's hex records by published number, the same `num`
 * upsertHexRecords takes, so a caller can merge into what is stored (a
 * settlement's `discovered`, a feature the GM added here) before it writes
 * whole `features` lists back. Copies: changing the result never changes the
 * store.
 *
 * @param {string} sceneId
 * @param {Array<number|string>} [nums]  only these hexes; omitted means all
 * @returns {Object<number, object>|null}  null when the scene has no published
 *   layout; {} when it has one and no records. Hexes with no record are absent.
 */
export function getHexRecords(sceneId, nums) {
	const scene = game.scenes.get(sceneId);
	requireInput(scene, "scene not found");
	const layout = scene.getFlag(MODULE_ID, "hexcrawl");
	if (!(layout?.version === 1 && layout.grid)) return null;
	const geom = makeGeom(layout, true);
	requireInput(nums === undefined || Array.isArray(nums), "nums must be an array");
	let wanted = nums?.map(num => validateHexNum(num, geom));
	if (!wanted) {
		wanted = [];
		for (let col = geom.origin; col < geom.pubCols + geom.origin; col++) {
			for (let row = geom.origin; row < geom.pubRows + geom.origin; row++) {
				if (geom.inGrid(col, row)) wanted.push((col * 100) + row);
			}
		}
	}
	const stored = getHexRecordMap(sceneId);
	const out = {};
	for (const num of wanted) {
		const { col, row } = hexNumToColRow(num);
		const record = stored.get(offsetToHexKey(geom.offsetOf(col, row)));
		if (record) out[num] = foundry.utils.deepClone(record);
	}
	return out;
}

/**
 * Give a scene the GM already has, such as a publisher's printed map, the
 * version-1 layout a build writes, so upsertHexRecords, the tooltip, the hex
 * explorer and the coordinate labels work on it.
 *
 * WHY. Only buildHexcrawl wrote the layout flag, and only on a scene it made,
 * so records could never reach a map that already existed, even one whose
 * grid matched a built scene cell for cell. The flag is this module's own;
 * another module writing it to get past the check above would be a contract
 * nobody could change.
 *
 * WHAT IT WRITES. The layout flag and nothing else: no tiles, records, notes
 * or background changes, and not `hexScene`, which opens the painter's
 * terrain tabs and would invite painting over the print. Published hex 0000
 * (or 0101, with origin 1) must sit on Foundry offset {i:0, j:0}, the scene's
 * top-left cell, and every published cell's centre must land on the scene.
 *
 * Adopting again with the same grid changes nothing; a scene that already has
 * a different layout, legacy or published, is refused.
 *
 * @param {string} sceneId
 * @param {{name?:string, grid:object}} opts  grid takes the same fields and
 *   checks as buildHexcrawl's
 * @returns {Promise<{sceneId:string, adopted:boolean}>}  adopted is false for a no-op
 */
export async function adoptHexcrawl(sceneId, opts = {}) {
	requireInput(game.user?.isGM, "requires GM permission");
	requireInput(opts && typeof opts === "object" && !Array.isArray(opts), "options must be an object");
	requireInput(opts.name === undefined || typeof opts.name === "string", "name must be text");
	validateGrid(opts.grid);
	const scene = game.scenes.get(sceneId);
	requireInput(scene, "scene not found");
	const geom = makeGeom({ grid: opts.grid }, true);
	const grid = layoutGrid(geom, opts.grid);

	// Settled before the geometry checks: a scene that already carries this
	// layout, built or adopted, has nothing left to prove.
	const existing = scene.getFlag(MODULE_ID, "hexcrawl");
	if (existing) {
		const stored = existing.version === 1 && existing.grid
			? JSON.stringify(layoutGrid(makeGeom(existing, true), existing.grid)) : null;
		const same = stored === JSON.stringify(grid);
		requireInput(same, "scene already has a different hexcrawl layout");
		return { sceneId, adopted: false };
	}

	requireInput(scene.grid?.type === CONST.GRID_TYPES.HEXODDQ, "scene grid must be hexagonal columns with odd columns shifted down (HEXODDQ)");
	const { sceneX, sceneY, sceneWidth, sceneHeight } = scene.dimensions;
	for (let col = geom.origin; col < geom.pubCols + geom.origin; col++) {
		for (let row = geom.origin; row < geom.pubRows + geom.origin; row++) {
			if (!geom.inGrid(col, row)) continue;
			const { x, y } = scene.grid.getCenterPoint(geom.offsetOf(col, row));
			const onScene = x >= sceneX && x <= sceneX + sceneWidth
				&& y >= sceneY && y <= sceneY + sceneHeight;
			requireInput(onScene,
				`hex ${String((col * 100) + row).padStart(4, "0")} falls outside the scene; the first published hex must be the scene's top-left cell`);
		}
	}

	await scene.setFlag(MODULE_ID, "hexcrawl", {
		name: opts.name ?? scene.name, cols: geom.pubCols, rows: geom.pubRows, version: 1, grid,
	});
	return { sceneId, adopted: true };
}

/**
 * Repaint the terrain tiles of named hexes on a scene the stable API built,
 * leaving the rest of the scene — tokens, notes, pins, fog progress, networks —
 * alone.
 *
 * WHY. buildHexcrawl is all-or-nothing: it makes a new scene and (with
 * overwrite) deletes the old one, taking the table's progress with it.
 * upsertHexRecords is the opposite and says so — it updates words and does not
 * repaint. Correcting a mis-tagged hex on a map already in play had no path
 * between those two, so the record said swamp while the art still showed
 * forest.
 *
 * WHAT IT REPLACES. Every tile flagged `painted` whose centre sits on the hex.
 * Terrain tiles carry no hex number (only curated art and specials do), so they
 * are found by position — which is also the only method that works on scenes
 * built before this function existed. Feature icons (`hexcrawlFeature`) and the
 * reference underlay (no flags) are not `painted` and so are never touched.
 *
 * A hex hand-painted with the hex painter after the build IS replaced: the
 * caller is asserting what that hex should look like.
 *
 * @param {string} sceneId
 * @param {Array<{num:number, terrain?:string, art?:string, special?:string}>} hexes
 * @returns {Promise<{sceneId:string, repainted:number, removed:number}>}
 */
export async function repaintHexTiles(sceneId, hexes) {
	requireInput(game.user?.isGM, "requires GM permission");
	const scene = game.scenes.get(sceneId);
	requireInput(scene, "scene not found");
	const layout = scene.getFlag(MODULE_ID, "hexcrawl");
	requireInput(layout?.version === 1 && layout.grid, "scene has no published layout; rebuild legacy scenes with api.hex.buildHexcrawl");
	requireInput(Array.isArray(hexes), "hexes must be an array");

	const geom = makeGeom(layout, true);
	const seen = new Set();
	for (const hex of hexes) {
		requireInput(hex && typeof hex === "object" && !Array.isArray(hex), "each hex must be an object");
		const num = validateHexNum(hex.num, geom);
		requireInput(!seen.has(num), `duplicate hex ${hex.num}`);
		seen.add(num);
		for (const key of Object.keys(hex)) {
			requireInput(["num", "terrain", "art", "special"].includes(key), `unsupported repaint field ${key}; repaint takes terrain, art and special only`);
		}
		for (const key of ["terrain", "art", "special"]) {
			if (Object.hasOwn(hex, key)) requireInput(typeof hex[key] === "string", `${key} must be text`);
		}
		// Required, not inferred. The stored record's terrain is only reachable
		// through the journal loader, and guessing it wrong picks the tile from
		// the wrong pool — a silently different-looking hex. The caller knows the
		// terrain it is asserting; make it say so.
		requireInput(hex.terrain, `hex ${hex.num} needs a terrain to repaint`);
	}
	if (!hexes.length) return { sceneId, repainted: 0, removed: 0 };

	// Specials are a catalogue: resolve and check them before touching the scene,
	// so an unknown id fails with nothing half-repainted.
	const wantSpecials = hexes.filter(hex => hex.special);
	const specials = new Map((wantSpecials.length ? await getSpecialTiles() : []).map(tile => [tile.id, tile]));
	for (const hex of wantSpecials) {
		requireInput(specials.has(hex.special), `unknown special ${hex.special}; use getSpecialTiles()`);
	}
	hexes = await resolveArt(hexes);

	// Same rule paintTerrain uses for a published build: always the colored
	// catalogue, so a repainted hex matches the same hex on a freshly built map.
	if (!getColoredTiles().length) await loadColoredTileAssets();
	const coloredByBiome = getColoredTilesByBiome();
	const tw = TERRAIN_TILE_W;
	const th = TERRAIN_TILE_H;
	// A repaint says terrain, art and special only; the settlement a keyed hex
	// carries lives in its record, so read it back rather than lose the tile.
	const stored = getHexRecordMap(sceneId);

	// A painted tile is anchored so its CENTRE is the hex centre, whatever its
	// size, so compare centres rather than the stored x/y corner.
	const painted = scene.tiles.filter(tile => tile.flags?.[MODULE_ID]?.painted);
	const tolerance = Math.max(4, (scene.grid?.size ?? HEX_TILE_H) * 0.25);

	const tileData = [];
	const doomed = [];
	const terrainMap = {};
	for (const hex of hexes) {
		const num = Number(hex.num);
		const cell = hexNumToColRow(num);
		const off = geom.offsetOf(cell.col, cell.row);
		const center = scene.grid.getCenterPoint(off);
		const biomeKey = hex.terrain;
		// A repaint has no dataset default; a label with no painted biome (volcano,
		// which paints from Specials) falls back like the build's would. The biome
		// only supplies the flat tiles; hexTileData picks the colored pool itself.
		const biome = biomeFor(biomeKey) ?? BIOME_TILES.forest;

		for (const tile of painted) {
			if (Math.abs(tile.x + (tile.width / 2) - center.x) > tolerance) continue;
			if (Math.abs(tile.y + (tile.height / 2) - center.y) > tolerance) continue;
			doomed.push(tile.id);
		}
		tileData.push(hexTileData({
			num, biome, biomeKey, center, off, coloredByBiome, tw, th,
			special: specials.get(hex.special), art: hex.art,
			feature: settlementOf(stored.get(offsetToHexKey(off))?.features),
		}));
		terrainMap[offsetToHexKey(off)] = biomeKey;
	}

	// Delete first: leaving the old tile under the new one is the visible bug,
	// and both orders lose the same work if the second call fails.
	if (doomed.length) await scene.deleteEmbeddedDocuments("Tile", doomed);
	const created = await scene.createEmbeddedDocuments("Tile", tileData);
	if (Object.keys(terrainMap).length) await setHexTerrainBatch(sceneId, terrainMap);

	// A hex painted to or from water changes the shoreline of every hex around
	// it, so the beaches on the repainted hexes and their neighbours are redone
	// from the records just written.
	const shore = new Set();
	for (const hexKey of Object.keys(terrainMap)) {
		shore.add(hexKey);
		const [i, j] = hexKey.split("_").map(Number);
		for (const neighbour of scene.grid.getAdjacentOffsets({ i, j })) shore.add(offsetToHexKey(neighbour));
	}
	const staleCoasts = scene.tiles.filter(tile => shore.has(tile.flags?.[MODULE_ID]?.coast)).map(tile => tile.id);
	if (staleCoasts.length) await scene.deleteEmbeddedDocuments("Tile", staleCoasts);
	const coasts = coastTileData(scene, shore);
	if (coasts.length) await scene.createEmbeddedDocuments("Tile", coasts);

	try {
		if (canvas.scene?.id === scene.id) await canvas.tiles?.draw?.();
	}
	catch(err) {
		console.warn(`${MODULE_ID} | post-repaint tiles redraw failed`, err);
	}
	return { sceneId, repainted: created.length, removed: doomed.length };
}

async function writeNetworks(scene, dataset, geom) {
	if (!dataset.networks) return;
	const offset = num => {
		const { col, row } = hexNumToColRow(num);
		return geom.offsetOf(col, row);
	};
	// The interactive authoring path passes an isWater predicate so a river's
	// dead end opens out into the adjacent sea rather than stopping at the last
	// land hex's centre; this call did not, so every imported map's rivers ended
	// a half-hex short of the shore. Records are written before this runs, so
	// the scene's own terrain is already readable. Rivers only: a road has no
	// business running into the sea.
	const water = getWaterHexKeys(scene.id);
	const isWater = water.size ? cell => water.has(`${cell.i}_${cell.j}`) : null;
	const networkPaths = {};
	for (const kind of ["road", "river"]) {
		const blocked = (dataset.networks.blockedEdges?.[kind] ?? [])
			.map(([a, b]) => mapPathEdgeKey(offset(a), offset(b)));
		networkPaths[kind] = buildMapPathNetwork(
			(dataset.networks[kind] ?? []).map(offset), scene.grid, blocked,
			kind === "river" ? isWater : null,
			// Opt-in: an AREA-derived network (every hex an overlay marked as river
			// handed over) forms a mesh, and three mutually adjacent marked hexes
			// close into a triangle; a watercourse is a tree, so that caller asks
			// for a spanning forest. A drawn line is not an area: a Hexer import
			// keeps a closed path closed on purpose, and pruning it would open the
			// loop, so without the flag adjacency is exact, as the API documents.
			{ spanning: dataset.networks.spanning === true },
		);
	}
	if (!networkPaths.road.length && !networkPaths.river.length) return;
	// Use the same permanent payload/renderer as Road & River authoring, without
	// borrowing the GM's interactive tool state or its fire-and-forget save path.
	await scene.setFlag(MODULE_ID, "permanentDrawings", [{
		drawingId: `map-network-${foundry.utils.randomID()}`, type: "mapNetwork", networkPaths,
		userId: game.user.id, userName: game.user.name, permanent: true,
		strokeWidth: HEX_TILE_H * 0.15, roadColor: "#D8C6A8", riverColor: "#2D9CDB",
		// "art": the hand-drawn hex pieces, chained cell to cell, rather than a stroke.
		texturePath: null, roadStyle: "art", opacity: 1, createdAt: Date.now(), expiresAt: null,
	}]);
}

async function placeReference(scene, reference) {
	if (!reference) return;
	await scene.createEmbeddedDocuments("Tile", [{
		texture: { src: reference.src, anchorX: 0, anchorY: 0 },
		x: reference.x ?? 0, y: reference.y ?? 0,
		width: reference.width ?? scene.width, height: reference.height ?? scene.height,
		hidden: true, locked: true, alpha: 0.5, sort: 1000000,
	}]);
}

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

	return buildScene(dataset, opts, makeGeom(dataset));
}

async function buildScene(dataset, opts, geom, specials = new Map()) {
	ui.notifications?.info(`SDX | Building hexcrawl "${dataset.name ?? "Hexcrawl"}"…`);
	const replaced = opts.overwrite
		? game.scenes.filter(s => s.name === (opts.sceneName || dataset.name || "Hexcrawl")).map(s => s.id)
		: [];
	const scene = await createHexScene(dataset, geom, opts);

	const terrainTiles = await paintTerrain(scene, dataset, geom, specials);
	const featureTiles = await placeFeatureIcons(scene, dataset, geom);
	const records = await writeHexRecords(scene, dataset, geom, specials);
	// After the records: the coasts are read off the terrain just written.
	await placeCoasts(scene);
	if (geom.published) {
		await writeNetworks(scene, dataset, geom);
		await placeReference(scene, dataset.reference);
	}
	if (opts.view !== false) await viewSceneReady(scene);
	// Do not destroy the previous map until its replacement has finished building.
	if (replaced.length) await Scene.deleteDocuments(replaced);

	// Tiles created on a freshly-viewed scene can leave their meshes parked at the
	// origin until the Tiles layer is redrawn. Force a clean redraw so the map
	// renders in place immediately after building.
	try {
		if (canvas.scene?.id === scene.id) await canvas.tiles?.draw?.();
	}
	catch(err) {
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
	}
	catch(err) {
		ui.notifications?.error(`SDX | Could not load hexcrawl dataset: ${relPath}`);
		console.error(`${MODULE_ID} | fetch hexcrawl dataset failed`, err);
		return null;
	}
	return buildHexcrawl(dataset, opts);
}
