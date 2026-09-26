import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { installPersistenceGlobals } from "./helpers/persistence-harness.mjs";
import { installMemoryIndexedDB } from "./helpers/indexeddb-harness.mjs";
import { escapeHTML } from "./helpers/escape-html.mjs";

const world = installPersistenceGlobals();
installMemoryIndexedDB();
const builder = await import("../../scripts/hex/HexcrawlBuilderSD.mjs");
const { getSpecialTiles } = await import("../../scripts/hex/hex-special-tiles.mjs");
const { getColoredTilesByBiome } = await import("../../scripts/hex/hex-colored-tiles.mjs");
const { setActiveTileTab } = await import("../../scripts/hex/hex-tile-selection.mjs");
const COLORED_FOLDER = "modules/shadowdark-extras/assets/Hexes";
const VEGETATION_FOLDER = `${COLORED_FOLDER}/Vegetation`;
const VEGETATION_TILE = `${VEGETATION_FOLDER}/forest.webp`;
const VEGETATION_DENSE_TILE = `${VEGETATION_FOLDER}/trees2.webp`;
const VEGETATION_SPARSE_TILE = `${VEGETATION_FOLDER}/Hex - Sparse Trees (lush) 1.webp`;
const VEGETATION_HILL_TILE = `${VEGETATION_FOLDER}/Hex - Hills (lush) 1.webp`;
const DESERT_FOLDER = `${COLORED_FOLDER}/Desert`;
const DESERT_HILL_TILE = `${DESERT_FOLDER}/Hex - Hills (desert) 1.webp`;
const DESERT_PLAIN_TILE = `${DESERT_FOLDER}/Hex - Plains (desert) 4.webp`;
const MOUNTAINS_FOLDER = `${COLORED_FOLDER}/Mountains`;
const MOUNTAIN_ROCKY_TILE = `${MOUNTAINS_FOLDER}/Hex - Mountains, low (rocky).webp`;
const MOUNTAIN_LUSH_TILE = `${MOUNTAINS_FOLDER}/Hex - Mountains, low (lush).webp`;
const MOUNTAIN_BRIDGE_TILE = `${MOUNTAINS_FOLDER}/Hex - Mountains, peak (bridge).webp`;
const MOUNTAIN_SPIKES_TILE = `${MOUNTAINS_FOLDER}/mountains spikes.webp`;
const WATER_FOLDER = `${COLORED_FOLDER}/Water`;
const WATER_TILE = `${WATER_FOLDER}/ocean.webp`;
const ARCTIC_FOLDER = `${COLORED_FOLDER}/Water-Arctic`;
const ARCTIC_TILE = `${ARCTIC_FOLDER}/arctic.webp`;
const LAKE_FOLDER = `${COLORED_FOLDER}/Water-Lake`;
const LAKE_TILE = `${LAKE_FOLDER}/lake.webp`;
const RIVER_FOLDER = `${COLORED_FOLDER}/Water-River`;
const RIVER_TILE = `${RIVER_FOLDER}/river.webp`;
const SPECIALS_FOLDER = "modules/shadowdark-extras/assets/Hexes/Specials";
const MODULE_ID = "shadowdark-extras";
// Invented fixture, no publisher content. The Enhancer's hexIdKey("1403")
// is "14,3": one-based column 14 / row 3 => Foundry offset {i:2,j:13}.
const fixture = {
	name: "Three landmarks",
	grid: { cols: 14, rows: 4, landscape: false, flipX: false, flipY: false },
	terrain: { default: "grassland", regions: [{ biome: "arctic sea", hexes: [1402] }] },
	hexes: [
		{ num: 1402, name: "Landing" },
		{ num: "1403", name: "Test tower", terrain: "deep tunnels", icon: "icons/svg/castle.svg", desc: "Invented cellar." },
		{ num: 1404, name: "Dunes", terrain: "desert" },
	],
	networks: { river: [1402, 1403, 1404], road: [1402, 1403], blockedEdges: { river: [[1403, 1404]] } },
	reference: { src: "icons/svg/castle.svg" },
};
// Invented fixture for the 0-based map numbering: hex 0000 is the map's own
// first number, so it must land on Foundry offset {i:0,j:0}, and 0202 on {i:2,j:2}.
const originFixture = {
	name: "Origin zero",
	grid: { cols: 3, rows: 3, origin: 0 },
	terrain: { default: "grassland", regions: [{ biome: "forest", hexes: [0, 1, "0202"] }] },
	hexes: [{ num: "0000", name: "First" }, { num: 202, name: "Last" }],
	networks: { river: [0, 101, 202] },
};
let scenes;
let writes;
const grid = {
	getCenterPoint: ({ i, j }) => ({ x: j * 222 + 148, y: i * 256 + (j % 2 ? 128 : 0) + 128 }),
	getAdjacentOffsets: ({ i, j }) => [{ i: i - 1, j }, { i: i + 1, j }],
};

test.beforeEach(() => {
	world.reset();
	world.setGM(true);
	scenes = [];
	writes = [];
	game.user.id = "test-gm";
	game.user.name = "Test GM";
	game.modules = { get: () => ({ version: "hexcrawl-test" }) };
	setActiveTileTab("default");
	foundry.applications.apps.FilePicker.implementation = { async browse(_source, path) {
		if (path === COLORED_FOLDER) return { files: [], dirs: [
			VEGETATION_FOLDER, DESERT_FOLDER, MOUNTAINS_FOLDER, WATER_FOLDER,
			ARCTIC_FOLDER, LAKE_FOLDER, RIVER_FOLDER, SPECIALS_FOLDER,
		] };
		if (path === VEGETATION_FOLDER) return { files: [
			VEGETATION_HILL_TILE, VEGETATION_SPARSE_TILE, VEGETATION_TILE, VEGETATION_DENSE_TILE,
		], dirs: [] };
		if (path === DESERT_FOLDER) return { files: [DESERT_HILL_TILE, DESERT_PLAIN_TILE], dirs: [] };
		if (path === MOUNTAINS_FOLDER) return { files: [
			MOUNTAIN_ROCKY_TILE, MOUNTAIN_LUSH_TILE, MOUNTAIN_BRIDGE_TILE, MOUNTAIN_SPIKES_TILE,
		], dirs: [] };
		if (path === WATER_FOLDER) return { files: [WATER_TILE], dirs: [] };
		if (path === ARCTIC_FOLDER) return { files: [ARCTIC_TILE], dirs: [] };
		if (path === LAKE_FOLDER) return { files: [LAKE_TILE], dirs: [] };
		if (path === RIVER_FOLDER) return { files: [RIVER_TILE], dirs: [] };
		assert.equal(path, SPECIALS_FOLDER);
		return { files: readdirSync(new URL("../../assets/Hexes/Specials/", import.meta.url))
			.filter(name => name.endsWith(".webp")).map(name => `${path}/${name}`), dirs: [] };
	} };
	game.scenes = { get: id => scenes.find(s => s.id === id), filter: predicate => scenes.filter(predicate) };
	CONST.GRID_TYPES = { HEXODDQ: 4 };
	canvas.ready = true;
	canvas.grid = grid;
	canvas.scene = { id: "original" };
	globalThis.Scene = {
		async createDocuments(data) {
			return data.map(source => {
				const scene = {
					...structuredClone(source), id: `scene-${scenes.length + 1}`, grid, tiles: [],
					getFlag: (scope, key) => scene.flags[scope]?.[key],
					async setFlag(scope, key, value) { scene.flags[scope][key] = structuredClone(value); writes.push(key); },
					// Real Tile documents carry an id, and repaintHexTiles deletes by
					// id; a stub that pushes the raw create data cannot model that.
					// Ids count up and are never reused: one based on the current
					// tile count collides after a delete, and a later delete-by-id
					// then takes the wrong tile with it.
					tileSeq: 0,
					async createEmbeddedDocuments(type, data) {
						assert.equal(type, "Tile");
						const docs = data.map(source => ({ ...source, id: `tile-${++scene.tileSeq}` }));
						scene.tiles.push(...docs);
						return docs;
					},
					async deleteEmbeddedDocuments(type, ids) {
						assert.equal(type, "Tile");
						const removed = scene.tiles.filter(tile => ids.includes(tile.id));
						scene.tiles = scene.tiles.filter(tile => !ids.includes(tile.id));
						return removed;
					},
					async view() { canvas.scene = scene; },
				};
				scenes.push(scene);
				return scene;
			});
		},
		async deleteDocuments(ids) { scenes = scenes.filter(s => !ids.includes(s.id)); },
	};
});

test("published three-hex fixture builds tiles, records, reference and existing network format", async () => {
	const original = structuredClone(fixture);
	const result = await builder.buildPublishedHexcrawl(fixture, { view: false });
	assert.deepEqual(fixture, original);
	assert.deepEqual(result, { sceneId: "scene-1", sceneName: fixture.name, terrainTiles: 56, featureTiles: 1, records: 3 });
	assert.equal(canvas.scene.id, "original", "headless build does not switch the GM's scene");
	const scene = scenes[0];
	assert.equal(scene.background?.src, undefined);
	const feature = scene.tiles.find(t => t.flags?.[MODULE_ID]?.hexcrawlFeature);
	assert.equal(feature.texture.src, "icons/svg/castle.svg");
	assert.deepEqual({ x: feature.x + feature.width / 2, y: feature.y + feature.height / 2 }, grid.getCenterPoint({ i: 2, j: 13 }));
	const records = world.lastFlagValue()[scene.id];
	assert.equal(records["2_13"].name, "1403. Test tower");
	assert.equal(records["2_13"].terrain, "deep tunnels");
	assert.equal(records["2_13"].notes[0].text, "Invented cellar.");
	assert.equal(records["2_13"].showToPlayers, false);
	assert.equal(records["1_13"].terrain, "arctic sea", "omitted keyed terrain keeps the region label");
	assert.equal(records["0_0"].terrain, "grassland");
	const tileAt = (i, j) => scene.tiles.find(t => t.flags?.[MODULE_ID]?.painted && t.x + t.width / 2 === grid.getCenterPoint({ i, j }).x && t.y + t.height / 2 === grid.getCenterPoint({ i, j }).y);
	// Published builds paint from the colored catalogue whatever tab the tray is on.
	assert.match(tileAt(3, 13).texture.src, /\/Desert\//);
	assert.equal(tileAt(2, 13).texture.src, MOUNTAIN_ROCKY_TILE, "deep tunnels take the rocky mountain");
	assert.equal(tileAt(1, 13).flags[MODULE_ID].biome, "water");
	const reference = scene.tiles.find(t => t.hidden);
	assert.equal(reference.locked, true);
	assert.equal(reference.alpha, 0.5);
	assert.deepEqual([reference.x, reference.y, reference.width, reference.height], [0, 0, scene.width, scene.height]);
	const network = scene.getFlag(MODULE_ID, "permanentDrawings")[0];
	assert.equal(network.type, "mapNetwork");
	assert.equal(network.permanent, true);
	assert.equal(network.expiresAt, null);
	assert.equal(network.networkPaths.river.length, 1);
	assert.deepEqual(network.networkPaths.river, network.networkPaths.road);
	assert.equal(network.networkPaths.river[0].length, 2, "blocked link is not rendered");

	await builder.upsertHexRecords(scene.id, [{ num: 1403, travel: "slow", exploration: "mapped", notes: [{ id: "gm", text: "Keep me", visible: false }] }]);
	await builder.upsertHexRecords(scene.id, [{ num: 1403, desc: "Revised cellar." }, { num: 101, terrain: "unlisted terrain" }]);
	await builder.upsertHexRecords(scene.id, [{ num: 1403, desc: "Revised cellar." }]);
	await builder.upsertHexRecords(scene.id, [{ num: 1403, zoneColor: "#1e7e34" }, { num: 101, zoneColor: "" }]);
	// Not paranoia: HexTooltipSD draws the show-all-zones overlay by calling
	// Color.from on every record in a loop with no try/catch, so an unparseable
	// colour from an API caller takes out the whole scene's overlay.
	for (const bad of ["green", "#1e7e3", "#1e7e34ff", "1e7e34"]) {
		await assert.rejects(builder.upsertHexRecords(scene.id, [{ num: 1403, zoneColor: bad }]),
			/zoneColor must be empty or #rrggbb/, `rejects ${bad}`);
	}
	const updated = world.lastFlagValue()[scene.id];
	assert.equal(updated["2_13"].zoneColor, "#1e7e34", "a rejected upsert leaves the good colour standing");
	assert.equal(updated["0_0"].zoneColor, "");
	assert.equal(updated["2_13"].terrain, "deep tunnels");
	assert.equal(updated["2_13"].travel, "slow");
	assert.equal(updated["2_13"].exploration, "mapped");
	assert.deepEqual(updated["2_13"].notes.map(n => n.text), ["Keep me", "Revised cellar."]);
	assert.equal(updated["0_0"].terrain, "unlisted terrain");
	assert.equal(scene.tiles.length, 60, "upserts never rebuild tiles (56 terrain, a feature, the reference, two beaches beside the arctic sea)");
});

test("published builder follows the selected colored tile source and centers its footprint", async () => {
	setActiveTileTab("colored");
	await builder.buildPublishedHexcrawl({
		grid: { cols: 1, rows: 2 }, terrain: { default: "forest" }, hexes: [],
	}, { view: false });
	const tiles = scenes[0].tiles.filter(t => t.flags?.[MODULE_ID]?.painted);
	assert.ok(tiles.every(tile => [VEGETATION_TILE, VEGETATION_DENSE_TILE,
		VEGETATION_SPARSE_TILE].includes(tile.texture.src)),
	"forest terrain does not randomly select a hills tile from the same folder");
	const [tile] = tiles;
	assert.deepEqual([tile.width, tile.height], [572, 500]);
	assert.deepEqual(
		{ x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 },
		grid.getCenterPoint({ i: 0, j: 0 })
	);
});

test("published colored water uses distinct ocean, arctic sea, lake and river palettes", async () => {
	setActiveTileTab("colored");
	await builder.buildPublishedHexcrawl({
		grid: { cols: 4, rows: 1 },
		terrain: { default: "ocean", regions: [
			{ biome: "arctic sea", hexes: [101] },
			{ biome: "lake", hexes: [201] },
			{ biome: "river", hexes: [301] },
		] },
		hexes: [],
	}, { view: false });
	const tiles = scenes[0].tiles.filter(t => t.flags?.[MODULE_ID]?.painted);
	assert.deepEqual(tiles.map(t => t.texture.src), [ARCTIC_TILE, LAKE_TILE, RIVER_TILE, WATER_TILE]);
});

test("published colored terrain uses exact legend pools", async () => {
	setActiveTileTab("colored");
	await builder.buildPublishedHexcrawl({
		grid: { cols: 8, rows: 1 },
		terrain: { default: "desert", regions: [
			{ biome: "jungle", hexes: [101] },
			{ biome: "canyon", hexes: [201] },
			{ biome: "salt flat", hexes: [301] },
			{ biome: "mountain", hexes: [401] },
			{ biome: "deep tunnels", hexes: [501] },
			{ biome: "volcano", hexes: [601] },
			{ biome: "lava", hexes: [701] },
		] },
		hexes: [],
	}, { view: false });
	const paths = scenes[0].tiles.filter(t => t.flags?.[MODULE_ID]?.painted)
		.map(t => t.texture.src);
	assert.ok([VEGETATION_TILE, VEGETATION_DENSE_TILE].includes(paths[0]));
	assert.equal(paths[1], DESERT_HILL_TILE);
	assert.equal(paths[2], DESERT_PLAIN_TILE);
	assert.ok([MOUNTAIN_ROCKY_TILE, MOUNTAIN_LUSH_TILE].includes(paths[3]));
	assert.equal(paths[4], MOUNTAIN_ROCKY_TILE);
	assert.match(paths[5], /\/Hex - Mountain[s]?, Volcano \(.+\) [12]\.webp$/);
	assert.equal(paths[6], `${SPECIALS_FOLDER}/lava.webp`);
	assert.ok([DESERT_HILL_TILE, DESERT_PLAIN_TILE].includes(paths[7]));
});

test("published transpose/flips persist for later num-only upserts; legacy root keeps its old layout", async () => {
	for (const landscape of [false, true]) {
		for (const flipX of [false, true]) {
			for (const flipY of [false, true]) {
				const dataset = { grid: { cols: 14, rows: 4, landscape, flipX, flipY }, hexes: [{ num: 1403 }] };
				const { sceneId } = await builder.buildPublishedHexcrawl(dataset, { view: false });
				const i = flipY ? (landscape ? 0 : 1) : (landscape ? 13 : 2);
				const j = flipX ? (landscape ? 1 : 0) : (landscape ? 2 : 13);
				await builder.upsertHexRecords(sceneId, [{ num: 1403, name: "Updated" }]);
				assert.equal(world.lastFlagValue()[sceneId][`${i}_${j}`].name, "1403. Updated");
			}
		}
	}
	const { sceneId } = await builder.buildHexcrawl({ grid: { cols: 4, rows: 15, landscape: true }, hexes: [{ num: 1403 }] });
	assert.equal(world.lastFlagValue()[sceneId]["2_14"].name, "1403");
	await assert.rejects(builder.upsertHexRecords(sceneId, [{ num: 1403 }]), /layout|legacy/i);
});

test("rejects malformed input before creating/deleting scenes or partially upserting", async () => {
	for (const alter of [
		d => { d.grid.cols = -1; }, d => { d.grid.rows = Infinity; }, d => { d.grid.flipX = "false"; },
		d => { d.grid.origin = 2; }, d => { d.grid.firstRow = 3; }, d => { d.grid.rowsLowered = 1; },
		d => { d.hexes[0].num = "1e3"; }, d => { d.hexes[0].num = " 1402"; }, d => { d.hexes[0].num = 1501; },
		d => { d.hexes[0].row = 2; }, d => { d.hexes[0].num = 1403; },
		d => { d.networks.river.push(9901); }, d => { d.networks.blockedEdges.river = [[1403, 101]]; },
		d => { d.terrain.regions[0].hexes = [9901]; }, d => { d.reference.width = 0; },
		d => { d.hexes[0].notes = [{ text: 7 }]; }, d => { d.hexes[0].rollTableChance = 101; },
	]) {
		const data = structuredClone(fixture);
		alter(data);
		await assert.rejects(builder.buildPublishedHexcrawl(data, { overwrite: true, view: false }), /SDX/);
		assert.equal(scenes.length, 0);
	}
	const { sceneId } = await builder.buildPublishedHexcrawl(fixture, { view: false });
	world.clearRecords();
	await assert.rejects(builder.upsertHexRecords(sceneId, [{ num: 1403, name: "No partial write" }, { num: 9999 }]), /SDX/);
	assert.equal(world.flagWrites().length, 0);
	world.setGM(false);
	await assert.rejects(builder.buildPublishedHexcrawl(fixture), /GM/);
	await assert.rejects(builder.upsertHexRecords(sceneId, [{ num: 1403 }]), /GM/);
});

test("special catalogue stays exact, outside generic biome pools, and explicit locations win", async () => {
	const catalog = await getSpecialTiles();
	const shipped = readdirSync(new URL("../../assets/Hexes/Specials/", import.meta.url)).filter(name => name.endsWith(".webp"));
	assert.equal(catalog.length, shipped.length);
	assert.equal(new Set(catalog.map(t => t.id)).size, shipped.length);
	assert.ok(catalog.every(t => t.tags.includes("specials") && t.path === t.id));
	assert.ok(catalog.find(t => t.id.endsWith("/keep.webp")).tags.includes("keep"));
	assert.equal(Object.values(getColoredTilesByBiome()).flat().some(path => path.startsWith(SPECIALS_FOLDER)), false, "specials are never random biome filler");
	const id = `${SPECIALS_FOLDER}/keep.webp`;
	const data = { grid: { cols: 14, rows: 4 }, hexes: [{ num: 1403, special: id }] };
	const result = await builder.buildPublishedHexcrawl(data, { view: false });
	const special = scenes[0].tiles.find(t => t.texture.src === id);
	assert.ok(special);
	assert.deepEqual([special.width, special.height], [572, 500]);
	assert.deepEqual({ x: special.x + special.width / 2, y: special.y + special.height / 2 }, grid.getCenterPoint({ i: 2, j: 13 }));
	assert.equal(special.flags[MODULE_ID].hexNum, 1403);
	assert.equal(world.lastFlagValue()[result.sceneId]["2_13"].name, "1403. Keep");
	await assert.rejects(builder.buildPublishedHexcrawl({ ...data, hexes: [...data.hexes, { num: 1404, special: id }] }), /assigned more than once/);
	await assert.rejects(builder.buildPublishedHexcrawl({ ...data, hexes: [{ num: 1403, special: "missing" }] }), /unknown special/);
	assert.equal(scenes.length, 1, "bad assignments are rejected before any world writes");
	world.setGM(false);
	await assert.rejects(getSpecialTiles(), /GM/);
});

test("origin 0 keeps the map's own 0-based numbers on the same cells", async () => {
	const result = await builder.buildPublishedHexcrawl(originFixture, { view: false });
	assert.deepEqual(result, { sceneId: "scene-1", sceneName: "Origin zero", terrainTiles: 9, featureTiles: 0, records: 2 });
	const records = world.lastFlagValue()["scene-1"];
	assert.equal(records["0_0"].name, "0000. First", "0000 sits at {i:0,j:0}");
	assert.equal(records["2_2"].name, "202. Last", "0202 sits at {i:2,j:2}");
	assert.equal(records["0_0"].terrain, "forest", "region hex 0");
	assert.equal(records["1_0"].terrain, "forest", "region hex 1");
	assert.equal(records["2_2"].terrain, "forest", "region hex \"0202\" is the same cell as num 202");
	assert.equal(records["1_1"].terrain, "grassland");
	assert.equal(scenes[0].getFlag(MODULE_ID, "hexcrawl").grid.origin, 0, "scene remembers its origin");
	await builder.upsertHexRecords(result.sceneId, [{ num: 202, desc: "Revised." }]);
	assert.equal(world.lastFlagValue()["scene-1"]["2_2"].notes[0].text, "Revised.");
	await assert.rejects(
		builder.buildPublishedHexcrawl({ ...originFixture, grid: { cols: 3, rows: 3 } }),
		/outside the published grid/
	);
});

test("rowsLowered stops the half-hex-shifted columns one row early", async () => {
	const { sceneId, terrainTiles } = await builder.buildPublishedHexcrawl(
		{ grid: { cols: 4, rows: 3, origin: 0, rowsLowered: 2 }, hexes: [] }, { view: false });
	assert.equal(terrainTiles, 10, "odd columns 1 and 3 lose row 2");
	const records = world.lastFlagValue()[sceneId];
	assert.equal(records["2_1"], undefined);
	assert.equal(records["2_3"], undefined);
	assert.equal(records["2_0"].terrain, "forest");
	assert.equal(records["2_2"].terrain, "forest");
	assert.equal(records["1_2"].terrain, "forest", "even columns keep the last row");
	await assert.rejects(
		builder.buildPublishedHexcrawl({ grid: { cols: 4, rows: 3, origin: 0, rowsLowered: 2 }, hexes: [{ num: 102 }] }),
		/outside the published grid/
	);
	const oneBased = await builder.buildPublishedHexcrawl({ grid: { cols: 4, rows: 3, rowsLowered: 2 }, hexes: [] }, { view: false });
	assert.equal(oneBased.terrainTiles, 10, "origin 1 lowers the even published columns instead");
});

test("firstRow skips clipped cells at the top of raised columns without shifting valid numbers", async () => {
	const data = {
		grid: { cols: 3, rows: 3, origin: 0, firstRow: 1, rowsLowered: 2 },
		hexes: [{ num: 1 }, { num: 100 }],
	};
	const { sceneId, terrainTiles } = await builder.buildPublishedHexcrawl(
		data, { view: false });
	assert.equal(terrainTiles, 6);
	const records = world.lastFlagValue()[sceneId];
	assert.equal(records["0_0"], undefined, "0000 is the clipped half-cell above the source map");
	assert.equal(records["0_2"], undefined, "0200 is the other clipped raised-column cell");
	assert.equal(records["1_0"].name, "1", "0001 stays at Foundry offset {i:1,j:0}");
	assert.equal(records["0_1"].name, "100", "0100 stays at Foundry offset {i:0,j:1}");
	assert.equal(scenes[0].getFlag(MODULE_ID, "hexcrawl").grid.firstRow, 1);
	await assert.rejects(
		builder.buildPublishedHexcrawl({ ...data, hexes: [{ num: 0 }] }),
		/outside the published grid/
	);
});

// A scene the GM already has, e.g. a publisher's printed map: a HEXODDQ grid
// (the shared stub's geometry), no tiles, no hexcrawl flag.
function printScene({ type = CONST.GRID_TYPES.HEXODDQ, width = 600, height = 770, x = 0, y = 0, flags = {} } = {}) {
	const scene = {
		id: `print-${scenes.length + 1}`, name: "Printed map", flags: structuredClone(flags), tiles: [],
		grid: { ...grid, type }, dimensions: { sceneX: x, sceneY: y, sceneWidth: width, sceneHeight: height },
		getFlag: (scope, key) => scene.flags[scope]?.[key],
		async setFlag(scope, key, value) { (scene.flags[scope] ??= {})[key] = structuredClone(value); writes.push(key); },
	};
	scenes.push(scene);
	return scene;
}
const PRINT_GRID = { cols: 3, rows: 3, origin: 0, firstRow: 1, rowsLowered: 2 };

test("adopting a scene writes the layout a build writes, paints nothing, and records land on the printed numbers", async () => {
	await builder.buildPublishedHexcrawl({ grid: PRINT_GRID, hexes: [] }, { view: false });
	const built = scenes[0].getFlag(MODULE_ID, "hexcrawl");
	const print = printScene();
	writes.length = 0;
	assert.deepEqual(await builder.adoptHexcrawl(print.id, { name: "Western Reaches", grid: PRINT_GRID }), { sceneId: print.id, adopted: true });
	const layout = print.getFlag(MODULE_ID, "hexcrawl");
	assert.deepEqual(layout.grid, built.grid, "same flag shape as a built scene");
	assert.equal(layout.version, 1);
	assert.equal(layout.name, "Western Reaches");
	assert.deepEqual(writes, ["hexcrawl"], "the layout flag is the only write");
	assert.equal(print.getFlag(MODULE_ID, "hexScene"), undefined, "the painter's terrain tabs stay closed on a print");
	assert.equal(print.tiles.length, 0);

	await builder.upsertHexRecords(print.id, [{ num: 1, name: "First" }, { num: 202, name: "Last" }]);
	const records = world.lastFlagValue()[print.id];
	assert.equal(records["1_0"].name, "1. First", "0001 is Foundry offset {i:1,j:0}, as on a built scene");
	assert.equal(records["2_2"].name, "202. Last");
	assert.equal(Object.keys(records).length, 2, "only the upserted hexes get records");

	const unnamed = printScene();
	await builder.adoptHexcrawl(unnamed.id, { grid: PRINT_GRID });
	assert.equal(unnamed.getFlag(MODULE_ID, "hexcrawl").name, "Printed map", "name defaults to the scene's");
});

test("adopting again with the same grid is a no-op; a different or legacy layout is refused", async () => {
	const print = printScene();
	await builder.adoptHexcrawl(print.id, { grid: PRINT_GRID });
	writes.length = 0;
	const spelledOut = { ...PRINT_GRID, landscape: false, flipX: false, flipY: false };
	assert.deepEqual(await builder.adoptHexcrawl(print.id, { grid: spelledOut }), { sceneId: print.id, adopted: false });
	await assert.rejects(builder.adoptHexcrawl(print.id, { grid: { cols: 3, rows: 3, origin: 0 } }), /different hexcrawl layout/);
	assert.deepEqual(writes, []);
	assert.deepEqual(print.getFlag(MODULE_ID, "hexcrawl").grid, { cols: 3, rows: 3, landscape: false, flipX: false, flipY: false, origin: 0, firstRow: 1, rowsLowered: 2 });

	const legacy = printScene({ flags: { [MODULE_ID]: { hexcrawl: { name: "Old", cols: 3, rows: 3 } } } });
	await assert.rejects(builder.adoptHexcrawl(legacy.id, { grid: { cols: 3, rows: 3 } }), /different hexcrawl layout/);
	const { sceneId } = await builder.buildPublishedHexcrawl({ grid: PRINT_GRID, hexes: [] }, { view: false });
	assert.equal((await builder.adoptHexcrawl(sceneId, { grid: PRINT_GRID })).adopted, false, "a built scene already has this layout");
});

test("adoption refuses a scene it cannot number, before writing anything", async () => {
	const plain = { cols: 3, rows: 3, origin: 0 };
	const square = printScene({ type: 1 });
	const short = printScene({ height: 700 });
	const padded = printScene({ x: 300 });
	const fits = printScene();
	writes.length = 0;
	await assert.rejects(builder.adoptHexcrawl("missing", { grid: plain }), /scene not found/);
	await assert.rejects(builder.adoptHexcrawl(square.id, { grid: plain }), /HEXODDQ/);
	await assert.rejects(builder.adoptHexcrawl(short.id, { grid: plain }), /hex 0102 falls outside the scene/, "the lowered column's last row is off the bottom");
	await assert.rejects(builder.adoptHexcrawl(padded.id, { grid: plain }), /hex 0000 falls outside the scene/, "0000 must be the top-left cell");
	await assert.rejects(builder.adoptHexcrawl(fits.id, { grid: { cols: 0, rows: 3 } }), /cols\/rows/);
	await assert.rejects(builder.adoptHexcrawl(fits.id, { grid: { ...plain, rowsLowered: 1 } }), /rowsLowered/);
	await assert.rejects(builder.adoptHexcrawl(fits.id, { name: 7, grid: plain }), /name must be text/);
	await assert.rejects(builder.adoptHexcrawl(fits.id), /cols\/rows/, "a grid is required");
	world.setGM(false);
	await assert.rejects(builder.adoptHexcrawl(fits.id, { grid: plain }), /GM/);
	assert.deepEqual(writes, []);
	for (const scene of [square, short, padded, fits]) assert.equal(scene.getFlag(MODULE_ID, "hexcrawl"), undefined);
});

test("getHexRecords reads records back by published number, as copies, and tells no layout from no records", async () => {
	const print = printScene();
	assert.equal(builder.getHexRecords(print.id), null, "no layout");
	await builder.adoptHexcrawl(print.id, { grid: PRINT_GRID });
	assert.deepEqual(builder.getHexRecords(print.id), {}, "a layout, no records");

	const river = { id: "river-202", type: "river", name: "River", discovered: true };
	const town = { id: "town-1", type: "town", name: "Ashford", discovered: false };
	await builder.upsertHexRecords(print.id, [
		{ num: 1, name: "First", terrain: "forest" },
		{ num: 202, terrain: "forest", features: [river, town] },
	]);
	const all = builder.getHexRecords(print.id);
	assert.deepEqual(Object.keys(all).sort(), ["1", "202"], "keyed by published number, not by Foundry offset");
	assert.equal(all[1].name, "1. First");

	const one = builder.getHexRecords(print.id, ["0202", 101]);
	assert.deepEqual(Object.keys(one), ["202"], "only the asked hexes, and a hex with no record is absent");
	assert.deepEqual(one[202].features, [river, town], "the same features the store holds");
	one[202].features[0].type = "dungeon";
	one[202].features.pop();
	assert.deepEqual(builder.getHexRecords(print.id, [202])[202].features, [river, town], "changing the result leaves the store alone");

	assert.throws(() => builder.getHexRecords(print.id, [909]), /outside the published grid/);
	assert.throws(() => builder.getHexRecords(print.id, 202), /nums must be an array/);
	assert.throws(() => builder.getHexRecords("missing"), /scene not found/);
	const legacy = printScene({ flags: { [MODULE_ID]: { hexcrawl: { name: "Old", cols: 3, rows: 3 } } } });
	assert.equal(builder.getHexRecords(legacy.id), null, "a legacy layout has no published numbers");
});

test("the Hex Editor keeps a feature type it does not list, so a save round-trips it", async () => {
	const { featureTypeOptions } = await import("../../scripts/hex/HexTooltipSD.mjs");
	foundry.utils.escapeHTML ??= escapeHTML;
	const selected = html => [...html.matchAll(/<option value="([^"]*)" selected>/g)].map(m => m[1]);
	const count = html => html.match(/<option /g).length;

	const known = featureTypeOptions("cave");
	assert.deepEqual(selected(known), ["cave"]);
	for (const type of ["river", "path", "coast", "town"]) {
		const html = featureTypeOptions(type);
		assert.deepEqual(selected(html), [type], `${type} stays selected rather than falling back to dungeon`);
		assert.equal(count(html), count(known) + 1, "one extra option for the unknown type");
	}
	assert.match(featureTypeOptions("river"), /<option value="river" selected>River<\/option>/);
	assert.doesNotMatch(featureTypeOptions("\"><b>x"), /<b>/, "an outside type is escaped");
});

test("setup exposes the same guarded hex namespace on both surfaces and removes it when disabled", async () => {
	const source = readFileSync(new URL("../../scripts/shadowdark-extras.mjs", import.meta.url), "utf8");
	const setup = source.slice(source.indexOf('Hooks.on("setup", () => {'), source.indexOf('// PARTY TOKEN LIGHT SYNCHRONIZATION HOOKS'));
	for (const enabled of [true, false]) {
		const module = {};
		const context = { module, game: { modules: { get: () => module }, user: { isGM: true } }, Hooks: { on: (_event, fn) => fn() }, FEATURE_IDS: {}, featureEnabled: () => enabled, SDX: {}, console, Array, Error, installHexcrawlApi: builder.installHexcrawlApi };
		const missing = new Proxy(context, { has: () => true, get: (target, key) => key in target ? target[key] : (() => {}) });
		vm.runInNewContext(`with (scope) { ${setup} }`, { scope: missing });
		assert.equal(typeof module.api.hex, enabled ? "object" : "undefined");
		assert.equal(context.game.shadowdarkExtras?.hex, module.api.hex);
		if (enabled) {
			assert.deepEqual(Object.keys(module.api.hex).sort(), ["adoptHexcrawl", "buildHexcrawl", "getHexRecords", "getSpecialTiles", "getZoneColors", "importHexerMap", "openHexerImportDialog", "repaintHexTiles", "upsertHexRecords"]);
			context.game.user.isGM = false;
			await assert.rejects(module.api.hex.buildHexcrawl(fixture), /requires GM permission/);
			await assert.rejects(module.api.hex.getHexRecords("scene"), /requires GM permission/);
			await assert.rejects(module.api.hex.adoptHexcrawl("scene", { grid: { cols: 1, rows: 1 } }), /requires GM permission/);
			await assert.rejects(module.api.hex.upsertHexRecords("scene", []), /requires GM permission/);
			await assert.rejects(module.api.hex.getSpecialTiles(), /requires GM permission/);
			await assert.rejects(module.api.hex.importHexerMap({}), /requires GM permission/);
			await assert.rejects(module.api.hex.openHexerImportDialog(), /requires GM permission/);
			// The palette is the one entry deliberately outside the GM wrap: a
			// player-side overlay has to be able to ask what the colours are.
			const palette = module.api.hex.getZoneColors();
			assert.ok(palette.some(colour => colour.value === "#1e7e34" && colour.label === "Forest"));
			palette[0].label = "mutated";
			assert.notEqual(module.api.hex.getZoneColors()[0].label, "mutated", "callers get a copy, not the editor's own swatches");
		}
	}
});

test("curated art paints an exact tile, may repeat, and never reaches the hex record", async () => {
	setActiveTileTab("colored");
	const result = await builder.buildPublishedHexcrawl({
		name: "Curated",
		grid: { cols: 4, rows: 1 },
		terrain: { default: "desert" },
		hexes: [
			{ num: 101, name: "One", terrain: "desert", art: VEGETATION_TILE, icon: "icons/svg/castle.svg" },
			{ num: 201, name: "Two", terrain: "desert", art: VEGETATION_TILE },
			{ num: 301, name: "Three", terrain: "desert" },
		],
	}, { view: false });

	const painted = scenes[0].tiles.filter(t => t.flags?.[MODULE_ID]?.painted);
	const srcOf = num => painted.find(t => t.flags[MODULE_ID].hexNum === num)?.texture.src;
	// Exact art wins over the terrain the hex also carries, and the SAME path
	// is honoured on both hexes — a curated map reuses its art by design.
	assert.equal(srcOf(101), VEGETATION_TILE);
	assert.equal(srcOf(201), VEGETATION_TILE);
	assert.notEqual(painted.find(t => !t.flags[MODULE_ID].hexNum).texture.src, VEGETATION_TILE, "a hex with no art is still painted from its terrain");
	const [art] = painted.filter(t => t.texture.src === VEGETATION_TILE);
	assert.deepEqual([art.width, art.height], [572, 500], "exact art uses the colored tile footprint");

	// The icon overlay is unchanged and separate from the art underneath.
	const icon = scenes[0].tiles.find(t => t.flags?.[MODULE_ID]?.hexcrawlFeature);
	assert.equal(icon.texture.src, "icons/svg/castle.svg");
	assert.equal(icon.flags[MODULE_ID].hexNum, 101);
	assert.equal(result.featureTiles, 1);

	// Nothing about painting survives into the persisted record.
	const records = world.lastFlagValue()[result.sceneId];
	for (const record of Object.values(records)) {
		for (const key of ["art", "icon", "special"]) assert.ok(!(key in record), `${key} must not reach the hex record`);
	}
	assert.equal(records["0_1"].terrain, "desert");
	assert.ok(scenes[0].tiles.every(t => !t.texture.src.includes("assets/tiles/")), "no legacy tiles folder is involved");
});

test("curated art does not depend on which tile source is selected", async () => {
	// Art is the map author's decision; the tab only governs generic filler.
	setActiveTileTab("default");
	await builder.buildPublishedHexcrawl({
		grid: { cols: 2, rows: 1 }, terrain: { default: "desert" },
		hexes: [{ num: 101, art: VEGETATION_TILE }],
	}, { view: false });
	const painted = scenes[0].tiles.filter(t => t.flags?.[MODULE_ID]?.painted);
	assert.equal(painted.find(t => t.flags[MODULE_ID].hexNum === 101).texture.src, VEGETATION_TILE);
	// …and the filler around it follows the art rather than the tab: a curated
	// map should not come out as hand-picked tiles marooned in the legacy set.
	assert.ok(painted.every(t => !t.texture.src.includes("assets/tiles/")), "curated art pulls colored filler in with it");

	// With no art in the dataset a published build still paints from the
	// colored catalogue: the tab used to decide, and the same hand-off came out
	// black and white whenever the tray was on Default.
	scenes.length = 0;
	await builder.buildPublishedHexcrawl({
		grid: { cols: 2, rows: 1 }, terrain: { default: "desert" }, hexes: [],
	}, { view: false });
	assert.ok(scenes[0].tiles.filter(t => t.flags?.[MODULE_ID]?.painted).every(t => t.texture.src.includes("/Desert/")), "the tab no longer decides the tile set");
});

test("art outside the shipped catalogue is refused before anything is written", async () => {
	const data = { grid: { cols: 2, rows: 1 }, terrain: { default: "desert" }, hexes: [{ num: 101, art: VEGETATION_TILE }] };
	await assert.rejects(builder.buildPublishedHexcrawl({ ...data, hexes: [{ num: 101, art: "https://example.invalid/tile.webp" }] }, { view: false }), /unknown art/);
	await assert.rejects(builder.buildPublishedHexcrawl({ ...data, hexes: [{ num: 101, art: `${COLORED_FOLDER}/Vegetation/not-shipped.webp` }] }, { view: false }), /unknown art/);
	assert.equal(scenes.length, 0, "bad art is rejected before any world writes");
	// A URI-encoded path naming the same shipped tile is the same tile.
	await builder.buildPublishedHexcrawl({ ...data, hexes: [{ num: 101, art: VEGETATION_SPARSE_TILE.replace(/ /g, "%20") }] }, { view: false });
	assert.equal(scenes.length, 1);
	// And art is not a record field: an upsert still refuses it.
	await assert.rejects(builder.upsertHexRecords(scenes[0].id, [{ num: 101, art: VEGETATION_TILE }]), /unsupported hex field art/);
});

test("accepted art paints from the catalogue's own path, not the caller's spelling of it", async () => {
	// Membership is matched without the module or case, so a path naming another
	// module or shouting the file name passes; painting it as given was a broken
	// texture, and on a case-sensitive host a missing file.
	const loose = "modules/not-extras/assets/hexes/vegetation/FOREST.webp";
	const input = { grid: { cols: 2, rows: 1 }, terrain: { default: "desert" }, hexes: [{ num: 101, terrain: "desert", art: loose }] };
	const original = structuredClone(input);
	const { sceneId } = await builder.buildPublishedHexcrawl(input, { view: false });
	assert.deepEqual(input, original, "the caller's dataset is not rewritten");
	const scene = scenes.find(s => s.id === sceneId);
	const art = () => scene.tiles.find(t => t.flags?.[MODULE_ID]?.hexNum === 101)?.texture.src;
	assert.equal(art(), VEGETATION_TILE);
	await builder.repaintHexTiles(sceneId, [{ num: 101, terrain: "desert", art: loose }]);
	assert.equal(art(), VEGETATION_TILE, "a repaint resolves it the same way");
});

test("repaint swaps a hex's tile art and leaves the rest of the scene standing", async () => {
	const result = await builder.buildPublishedHexcrawl(structuredClone(fixture), { view: false });
	const scene = scenes.find(s => s.id === result.sceneId);
	const center = grid.getCenterPoint({ i: 2, j: 13 });
	const paintedAt = () => scene.tiles.filter(t => t.flags?.[MODULE_ID]?.painted
		&& Math.abs(t.x + (t.width / 2) - center.x) < 4
		&& Math.abs(t.y + (t.height / 2) - center.y) < 4);

	const before = paintedAt();
	assert.equal(before.length, 1, "the build leaves one painted tile on the hex");
	assert.match(before[0].texture.src, /\/Mountains\//, "1403 builds as mountains");
	const features = () => scene.tiles.filter(t => t.flags?.[MODULE_ID]?.hexcrawlFeature).length;
	const featuresBefore = features();
	const totalBefore = scene.tiles.length;
	const neighbour = scene.tiles.find(t => t.flags?.[MODULE_ID]?.painted
		&& t.x + (t.width / 2) === grid.getCenterPoint({ i: 3, j: 13 }).x);

	const out = await builder.repaintHexTiles(scene.id, [{ num: 1403, terrain: "desert" }]);
	assert.deepEqual(out, { sceneId: scene.id, repainted: 1, removed: 1 });

	const after = paintedAt();
	assert.equal(after.length, 1, "no stacked leftover under the new tile");
	assert.match(after[0].texture.src, /\/Desert\//, "the art follows the new terrain");
	assert.equal(scene.tiles.length, totalBefore, "repaint is a swap, not a net add");
	assert.equal(features(), featuresBefore, "the feature icon on the same hex survives");
	assert.ok(scene.tiles.some(t => t.hidden && t.locked), "the reference underlay survives");
	assert.ok(scene.tiles.some(t => t.id === neighbour.id), "a neighbouring hex is untouched");
	assert.equal(world.lastFlagValue()[scene.id]["2_13"].terrain, "desert", "the record follows the art");
});

test("repaint paints a terrain with no painted biome from its own rule instead of throwing", async () => {
	// "volcano" is in no BIOME_TILES entry: the repaint used to fall back through
	// a variable that only exists inside the build, and threw a ReferenceError.
	const result = await builder.buildPublishedHexcrawl(structuredClone(fixture), { view: false });
	const scene = scenes.find(s => s.id === result.sceneId);
	const center = grid.getCenterPoint({ i: 2, j: 13 });
	const out = await builder.repaintHexTiles(scene.id, [{ num: 1403, terrain: "volcano" }]);
	assert.deepEqual(out, { sceneId: scene.id, repainted: 1, removed: 1 });
	const tile = scene.tiles.find(t => t.flags?.[MODULE_ID]?.painted
		&& Math.abs(t.x + (t.width / 2) - center.x) < 4 && Math.abs(t.y + (t.height / 2) - center.y) < 4);
	assert.match(decodeURIComponent(tile.texture.src), /\/Specials\/.*volcano/i, "the volcano rule's Specials tile");
	assert.equal(world.lastFlagValue()[scene.id]["2_13"].terrain, "volcano");
});

test("a listed loop stays closed unless the dataset asks for a spanning forest", async () => {
	// The shared stub only links a column's cells; three mutually adjacent cells
	// need the real odd-q neighbours. 0000, 0001 and 0100 are one triangle.
	const adjacency = grid.getAdjacentOffsets;
	grid.getAdjacentOffsets = ({ i, j }) => (j % 2
		? [[i - 1, j], [i + 1, j], [i, j - 1], [i + 1, j - 1], [i, j + 1], [i + 1, j + 1]]
		: [[i - 1, j], [i + 1, j], [i - 1, j - 1], [i, j - 1], [i - 1, j + 1], [i, j + 1]]).map(([a, b]) => ({ i: a, j: b }));
	try {
		const edges = async networks => {
			const { sceneId } = await builder.buildPublishedHexcrawl({ grid: { cols: 2, rows: 2, origin: 0 }, hexes: [], networks }, { view: false });
			const road = scenes.find(s => s.id === sceneId).getFlag(MODULE_ID, "permanentDrawings")[0].networkPaths.road;
			return road.reduce((n, path) => n + path.length - 1, 0);
		};
		assert.equal(await edges({ road: [0, 1, 100] }), 3, "a closed road (a Hexer closed path) keeps all three links");
		assert.equal(await edges({ road: [0, 1, 100], spanning: true }), 2, "an area-derived network drops the one link that closes the loop");
		await assert.rejects(builder.buildPublishedHexcrawl({ grid: { cols: 2, rows: 2, origin: 0 }, hexes: [], networks: { road: [0], spanning: "yes" } }),
			/networks.spanning must be boolean/);
	} finally {
		grid.getAdjacentOffsets = adjacency;
	}
});

test("repaint refuses what it cannot paint, before touching the scene", async () => {
	const result = await builder.buildPublishedHexcrawl(structuredClone(fixture), { view: false });
	const scene = scenes.find(s => s.id === result.sceneId);
	const tilesBefore = scene.tiles.length;

	await assert.rejects(builder.repaintHexTiles(scene.id, [{ num: 1403 }]),
		/needs a terrain to repaint/, "terrain is required, never guessed");
	await assert.rejects(builder.repaintHexTiles(scene.id, [{ num: 1403, terrain: "desert", name: "nope" }]),
		/unsupported repaint field name/, "record fields belong to upsertHexRecords");
	await assert.rejects(builder.repaintHexTiles(scene.id, [{ num: 9999, terrain: "desert" }]),
		/outside the published grid/);
	await assert.rejects(builder.repaintHexTiles(scene.id, [
		{ num: 1403, terrain: "desert" }, { num: 1403, terrain: "forest" },
	]), /duplicate hex 1403/);
	await assert.rejects(builder.repaintHexTiles(scene.id, [{ num: 1403, terrain: "desert", special: "not-a-real-special" }]),
		/unknown special/, "an unknown special fails before any tile is deleted");

	assert.equal(scene.tiles.length, tilesBefore, "every rejection leaves the scene exactly as it was");
	assert.deepEqual(await builder.repaintHexTiles(scene.id, []), { sceneId: scene.id, repainted: 0, removed: 0 });
});

// Coasts are derived from the records, not carried by the dataset: a WATER hex
// with land across an edge gets a beach tile along that edge (straight side to
// the land, wavy waterline inside), and a repaint that moves the shoreline
// redoes the beaches of the hex and its neighbours. The test grid's adjacency
// is north/south only, so the shore is a column.
test("a build lines the water hexes beside land with beaches, and a repaint moves them", async () => {
	const data = {
		grid: { cols: 1, rows: 3 },
		terrain: { default: "forest", regions: [{ biome: "ocean", hexes: [102] }, { biome: "coast", hexes: [103] }] },
		hexes: [],
	};
	const result = await builder.buildPublishedHexcrawl(data, { view: false });
	const scene = scenes.find(s => s.id === result.sceneId);
	const coasts = () => scene.tiles.filter(t => t.flags?.[MODULE_ID]?.coast);

	assert.deepEqual(coasts().map(t => t.flags[MODULE_ID].coast), ["1_0", "1_0"], "the sea hex gets a beach on each of its two land-facing edges");
	// A "coast" hex is land on a shore: it paints as land and the sea beside it
	// gets the beach, rather than painting as sea with a beach in open water.
	const coastHex = scene.tiles.find(t => t.flags?.[MODULE_ID]?.painted && t.y + (t.height / 2) === grid.getCenterPoint({ i: 2, j: 0 }).y);
	assert.doesNotMatch(coastHex.texture.src, /ocean|water|waves/, "the coast hex itself is not painted as sea");
	for (const tile of coasts()) {
		assert.match(tile.texture.src, /symbols\/Coast\/Hex - Coast - Beach \(small\) (N|NW|S|SW)\.webp$/, "land across opposite edges is two small beaches");
		assert.equal(tile.rotation % 60, 0, "flat-top art turns in 60° steps");
		assert.ok([1, -1].includes(tile.texture.scaleX));
		assert.ok(!tile.flags[MODULE_ID].painted, "a beach is not terrain, so the painter's swap rule leaves it alone");
		const [i, j] = tile.flags[MODULE_ID].coast.split("_").map(Number);
		const centre = grid.getCenterPoint({ i, j });
		// Foundry places the texture anchor at x,y and turns the tile about it, so
		// a turned beach has to anchor at its centre and sit ON the hex centre.
		assert.deepEqual([tile.texture.anchorX, tile.texture.anchorY], [0.5, 0.5], "anchored at its centre");
		assert.deepEqual({ x: tile.x, y: tile.y }, centre, "the anchor sits on the hex centre");
		assert.ok(tile.sort > 10000, "sorted above every terrain tile");
	}

	// Drain the sea: the beaches go with it.
	await builder.repaintHexTiles(scene.id, [{ num: 102, terrain: "forest" }]);
	assert.deepEqual(coasts(), [], "no water left, no beaches left");

	// Flood the top hex instead: it now faces land across its south edge only.
	await builder.repaintHexTiles(scene.id, [{ num: 101, terrain: "ocean" }]);
	assert.deepEqual(coasts().map(t => t.flags[MODULE_ID].coast), ["0_0"]);
	assert.equal(coasts()[0].rotation % 360, 180, "a beach facing south is the north piece turned round");
	assert.equal(scene.tiles.filter(t => t.flags?.[MODULE_ID]?.painted).length, 3, "the terrain tiles themselves are one per hex still");
});

// A keyed settlement paints as its Specials tile. The kind arrives as an
// Extras `features` entry, which is a record field, so it survives a repaint
// that only names the terrain: the builder reads the kind back off the record.
test("a keyed town paints as a town tile and keeps it through a terrain repaint", async () => {
	const data = {
		grid: { cols: 2, rows: 1 }, terrain: { default: "forest" },
		hexes: [
			{ num: 101, name: "Low Town", features: [{ id: "settlement-101", type: "town", name: "Low Town", discovered: false }] },
			{ num: 201, name: "A Cellar", features: [{ id: "keyed-201", type: "keyed_location", name: "A Cellar", discovered: false }] },
		],
	};
	const result = await builder.buildPublishedHexcrawl(data, { view: false });
	const scene = scenes.find(s => s.id === result.sceneId);
	const paintedAt = (i, j) => scene.tiles.find(t => t.flags?.[MODULE_ID]?.painted
		&& t.x + (t.width / 2) === grid.getCenterPoint({ i, j }).x && t.y + (t.height / 2) === grid.getCenterPoint({ i, j }).y);

	const town = paintedAt(0, 0);
	assert.match(decodeURIComponent(town.texture.src), /Specials\/Hex - Urban - (Town|Modern Town, inhabited)/, "a town is a Specials town tile");
	assert.equal(town.flags[MODULE_ID].hexNum, 101, "a settlement tile carries its hex number like curated art");
	assert.match(paintedAt(0, 1).texture.src, /\/Vegetation\//, "a plain keyed location keeps its terrain tile");
	assert.deepEqual(world.lastFlagValue()[scene.id]["0_0"].features, data.hexes[0].features, "the settlement is on the record");

	await builder.repaintHexTiles(scene.id, [{ num: 101, terrain: "desert" }]);
	assert.match(decodeURIComponent(paintedAt(0, 0).texture.src), /Specials\/Hex - Urban - (Town|Modern Town, inhabited)/, "a terrain repaint does not lose the town");
	assert.equal(world.lastFlagValue()[scene.id]["0_0"].terrain, "desert", "but the terrain word follows the repaint");
});

// Arctic water gets the ice shelf instead of sand, and a repaint that thaws it
// swaps the shore along with the terrain.
test("an arctic sea hex is lined with ice floats, and thawing it to ocean makes the shore sand", async () => {
	const data = {
		grid: { cols: 1, rows: 3 },
		terrain: { default: "forest", regions: [{ biome: "arctic sea", hexes: [102] }] },
		hexes: [],
	};
	const result = await builder.buildPublishedHexcrawl(data, { view: false });
	const scene = scenes.find(s => s.id === result.sceneId);
	const coasts = () => scene.tiles.filter(t => t.flags?.[MODULE_ID]?.coast);
	assert.equal(coasts().length, 2);
	for (const tile of coasts()) {
		assert.match(decodeURIComponent(tile.texture.src), /Hexes\/Specials\/Hex - Coast - Ice Floats \(small\) N\.webp$/, "one land edge is one small shelf");
		assert.equal(tile.flags[MODULE_ID].coast, "1_0", "on the arctic hex, facing the land");
	}
	await builder.repaintHexTiles(scene.id, [{ num: 102, terrain: "ocean" }]);
	assert.equal(coasts().length, 2);
	for (const tile of coasts()) assert.match(tile.texture.src, /symbols\/Coast\/Hex - Coast - Beach \(small\)/, "thawed water gets sand");
});

// Feature icons keep their own aspect and follow the GM's reviewed render
// rule: a long side over 400 px comes down to 380, under 150 goes up to 220,
// in the 932x810 hex canvas (hex 418 px tall), then scaled to the grid.
test("feature icons are sized from their texture by the render rule, or the square box when unmeasured", async () => {
	const sizes = { "icons/big.webp": [932, 810], "icons/pin.webp": [26, 24], "icons/mid.webp": [257, 188] };
	const original = globalThis.foundry.canvas;
	globalThis.foundry.canvas = { ...(original ?? {}), loadTexture: async src => {
		const [width, height] = sizes[src] ?? [];
		if (!width) throw new Error("no such texture");
		return { width, height };
	} };
	try {
		const data = {
			grid: { cols: 4, rows: 1 }, terrain: { default: "forest" },
			hexes: [
				{ num: 101, icon: "icons/big.webp" }, { num: 201, icon: "icons/pin.webp" },
				{ num: 301, icon: "icons/mid.webp" }, { num: 401, icon: "icons/unmeasured.webp" },
			],
		};
		const result = await builder.buildPublishedHexcrawl(data, { view: false });
		const scene = scenes.find(s => s.id === result.sceneId);
		const icon = src => scene.tiles.find(t => t.flags?.[MODULE_ID]?.hexcrawlFeature && t.texture.src === src);
		const toGrid = 256 / 418;
		const big = icon("icons/big.webp");
		assert.deepEqual([big.width, big.height], [Math.round(380 * toGrid), Math.round(810 * (380 / 932) * toGrid)], "a 932 px keep comes down to 380 in the canvas");
		const pin = icon("icons/pin.webp");
		assert.deepEqual([pin.width, pin.height], [Math.round(220 * toGrid), Math.round(24 * (220 / 26) * toGrid)], "a 26 px pin goes up to 220");
		const mid = icon("icons/mid.webp");
		assert.deepEqual([mid.width, mid.height], [Math.round(257 * toGrid), Math.round(188 * toGrid)], "a mid-size icon keeps its own size");
		const unmeasured = icon("icons/unmeasured.webp");
		assert.deepEqual([unmeasured.width, unmeasured.height], [150, 150], "an unmeasured icon gets the square box");
		const centre = grid.getCenterPoint({ i: 0, j: 0 });
		assert.deepEqual({ x: big.x + (big.width / 2), y: big.y + (big.height / 2) }, centre, "centred on its hex whatever its size");
	}
	finally {
		globalThis.foundry.canvas = original;
	}
});
