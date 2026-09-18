import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { installPersistenceGlobals } from "./helpers/persistence-harness.mjs";
import { installMemoryIndexedDB } from "./helpers/indexeddb-harness.mjs";

const world = installPersistenceGlobals();
installMemoryIndexedDB();
const builder = await import("../../scripts/hex/HexcrawlBuilderSD.mjs");
const { getSpecialTiles } = await import("../../scripts/hex/hex-special-tiles.mjs");
const { getColoredTilesByBiome } = await import("../../scripts/hex/hex-colored-tiles.mjs");
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
	foundry.applications.apps.FilePicker.implementation = { async browse(_source, path) {
		if (path.endsWith("/Hexes")) return { files: [], dirs: [SPECIALS_FOLDER] };
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
					async createEmbeddedDocuments(type, data) { assert.equal(type, "Tile"); scene.tiles.push(...data); return data; },
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
	assert.match(tileAt(3, 13).texture.src, /hex-tile-desert/);
	assert.match(tileAt(2, 13).texture.src, /hex-tile-mountains/);
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
	const updated = world.lastFlagValue()[scene.id];
	assert.equal(updated["2_13"].terrain, "deep tunnels");
	assert.equal(updated["2_13"].travel, "slow");
	assert.equal(updated["2_13"].exploration, "mapped");
	assert.deepEqual(updated["2_13"].notes.map(n => n.text), ["Keep me", "Revised cellar."]);
	assert.equal(updated["0_0"].terrain, "unlisted terrain");
	assert.equal(scene.tiles.length, 58, "upserts never rebuild tiles");
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

test("all shipped specials are catalogued and assigned once to explicit locations, never random terrain", async () => {
	const catalog = await getSpecialTiles();
	const shipped = readdirSync(new URL("../../assets/Hexes/Specials/", import.meta.url)).filter(name => name.endsWith(".webp"));
	assert.equal(catalog.length, shipped.length);
	assert.equal(new Set(catalog.map(t => t.id)).size, shipped.length);
	assert.ok(catalog.every(t => t.tags.includes("specials") && t.path === t.id));
	assert.ok(catalog.find(t => t.id.endsWith("/keep.webp")).tags.includes("keep"));
	assert.equal(Object.values(getColoredTilesByBiome()).flat().length, 0, "specials are never random biome filler");
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
			assert.deepEqual(Object.keys(module.api.hex).sort(), ["buildHexcrawl", "getSpecialTiles", "upsertHexRecords"]);
			context.game.user.isGM = false;
			await assert.rejects(module.api.hex.buildHexcrawl(fixture), /requires GM permission/);
			await assert.rejects(module.api.hex.upsertHexRecords("scene", []), /requires GM permission/);
			await assert.rejects(module.api.hex.getSpecialTiles(), /requires GM permission/);
		}
	}
});
