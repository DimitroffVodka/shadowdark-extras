import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { convertHexerMap } from "../../scripts/hex/hexer-data.mjs";
import { importHexerMap, openHexerImportDialog } from "../../scripts/hex/HexerImporterSD.mjs";

// Invented content in the real v6 schema. The user's Cornath file is not shipped.
function fixture(orientation = "pointy") {
	const data = {
		schemaVersion: 6, name: "Import test", settings: { width: 3, height: 3, hexSize: 30, orientation, fogEnabled: true },
		hexes: {}, customHexTypes: [{ id: "test", name: "Crystal Fields", color: "#ffffff" }],
		pois: [], notes: [], regions: [], paths: [], tokens: [], pointCrawl: { nodes: [], edges: [] },
	};
	for (const layer of ["surface", "level_1"]) {
		for (let q = 0; q < 3; q++) for (let r = 0; r < 3; r++) {
			data.hexes[`${q},${r},${layer}`] = { q, r, layer, hexType: "dense-forest", fogState: "visible", edgeData: {}, connections: [] };
		}
	}
	return data;
}

let writes;
test.beforeEach(() => {
	writes = [];
	const scenes = new Map();
	globalThis.game = {
		user: { isGM: true }, scenes,
		modules: { get: () => ({ api: { hex: { buildHexcrawl: async (dataset, options) => {
			const sceneId = `test-${scenes.size}`;
			writes.push({ sceneId, dataset, options });
			scenes.set(sceneId, {
				update: async update => writes.push({ sceneId, update }),
				view: async () => writes.push({ view: sceneId }),
			});
			return { sceneId, terrainTiles: dataset.grid.cols * dataset.grid.rows, featureTiles: 0, records: dataset.hexes.length };
		} } } }) },
	};
});

test("v6 terrain, POIs, notes, regions, layers, edge notes and fog share one coordinate mapping", async () => {
	const data = fixture();
	data.hexes["1,2,surface"].hexType = "test";
	data.hexes["1,2,surface"].edgeData = { 0: "blocked", 5: "passable" };
	data.hexes["1,2,surface"].fogState = "partial";
	data.hexes["0,1,surface"].fogState = "explored";
	data.hexes["2,1,surface"].fogState = "hidden";
	data.regions = [{ name: "Test zone", layer: "surface", hexes: [{ q: 1, r: 2 }] }];
	data.pois = ["ruins", "dungeon-entrance"].map(type => ({ type, label: type, hex: { q: 1, r: 2 }, layer: "surface", display: {} }));
	data.notes = [{ title: "Clue", content: "**Markdown** <script>not executed</script>", hex: { q: 1, r: 2 }, layer: "surface", dmOnly: true }];
	data.tokens = [{}]; data.pointCrawl.nodes = [{}];
	const before = structuredClone(data);
	const { maps, warnings } = convertHexerMap(data);
	assert.deepEqual(data, before);
	assert.deepEqual(maps.map(m => m.layer), ["surface", "level_1"]);
	assert.equal(maps[0].dataset.grid.landscape, true);
	assert.equal(maps[0].dataset.grid.cols, 3);
	const record = maps[0].dataset.hexes.find(h => h.num === 203);
	assert.equal(record.zone, "Test zone");
	assert.equal(record.terrain, "Crystal Fields");
	assert.equal(record.name, "ruins / dungeon-entrance");
	assert.equal(record.features.length, 2);
	assert.equal(record.features[0].discovered, false);
	assert.equal(record.showToPlayers, false);
	assert.equal(record.notes.find(n => n.id === "hexer-note-0").text,
		"Clue\n**Markdown** &lt;script&gt;not executed&lt;/script&gt;");
	assert.ok(record.notes.every(n => !n.visible));
	assert.match(record.notes.find(n => n.id === "hexer-edges").text, /&quot;0&quot;:&quot;blocked&quot;/);
	assert.ok(existsSync(new URL(`../../${record.icon}`, import.meta.url)));
	assert.equal(maps[0].flags.hexFogRevealed["1-2"], undefined);
	assert.equal(maps[0].flags.hexFogRevealed["0-1"], true);
	assert.equal(maps[0].flags.hexFogRevealed["2-1"], undefined);
	assert.equal(maps[1].flags.hexFogRevealed["1-2"], true, "fog never bleeds between layers");
	assert.ok(warnings.some(w => /Tokens/.test(w)));
	assert.ok(warnings.some(w => /Point-crawl/.test(w)));
	assert.ok(warnings.some(w => /edge restrictions/.test(w)));
	assert.equal(maps[1].dataset.hexes.length, 0, "surface POIs/notes never bleed between layers");
	await importHexerMap(data, { view: false, sceneName: "Disposable" });
	assert.equal(writes.length, 4);
	assert.deepEqual(writes[0].options, { view: false, overwrite: false });
	assert.equal(writes[0].dataset.name, "Disposable");
	assert.equal(writes[2].dataset.name, "Disposable — Level 1");
	assert.deepEqual(writes[1].update.flags["shadowdark-extras"], maps[0].flags);
});

test("normalized path segments traverse intervening cells, preserve deliberate non-joins and close loops", () => {
	const data = fixture();
	const path = points => ({ name: "Test", layer: "surface", type: "secondary", points, closed: false });
	data.paths = [path([{ x: 0, y: 0 }, { x: 2 * Math.sqrt(3), y: 0 }]), path([{ x: Math.sqrt(3) / 2, y: 1.5 }])];
	let plan = convertHexerMap(data);
	let network = plan.maps[0].dataset.networks;
	assert.deepEqual(network.road, [101, 102, 201, 301]);
	assert.deepEqual(network.blockedEdges.road, [[101, 102], [102, 201]]);
	assert.ok(plan.warnings.some(w => /one point/.test(w)));
	data.settings.hexSize = 99;
	assert.deepEqual(convertHexerMap(data).maps[0].dataset.networks, network, "path units are already normalized, not pixels divided by hexSize");
	data.paths = [path([{ x: 0, y: 0 }, { x: Math.sqrt(3), y: 0 }, { x: Math.sqrt(3) / 2, y: 1.5 }])];
	network = convertHexerMap(data).maps[0].dataset.networks;
	assert.deepEqual(network.road, [101, 102, 201]);
	assert.deepEqual(network.blockedEdges.road, [[101, 102]]);
	data.paths[0].closed = true;
	assert.deepEqual(convertHexerMap(data).maps[0].dataset.networks.blockedEdges.road, []);
	data.paths = [{ ...path([{ x: 0, y: -10 }, { x: 0, y: -0.0374 }]), type: "water" }];
	plan = convertHexerMap(data);
	assert.deepEqual(plan.maps[0].dataset.networks.river, [101]);
	assert.ok(plan.warnings.some(w => /clipped/.test(w)));
});

test("boundary control points and closed seams preserve path continuity", () => {
	const data = fixture();
	const edge = { x: Math.sqrt(3) / 2, y: 0 };
	data.paths = [{ type: "primary", layer: "surface", points: [
		{ x: 0, y: 0 }, edge, { x: Math.sqrt(3), y: 0 },
	] }];
	let network = convertHexerMap(data).maps[0].dataset.networks;
	assert.deepEqual(network.road, [101, 201]);
	assert.deepEqual(network.blockedEdges.road, [], "a redundant boundary vertex must not erase a road");
	data.paths[0].points.splice(1, 0, edge);
	assert.deepEqual(convertHexerMap(data).maps[0].dataset.networks, network, "duplicate vertices do not change the route");
	data.paths[0].points = [edge, { x: Math.sqrt(3), y: 0 },
		{ x: Math.sqrt(3) / 2, y: 1.5 }, { x: 0, y: 0 }];
	data.paths[0].closed = true;
	network = convertHexerMap(data).maps[0].dataset.networks;
	assert.deepEqual(network.road, [101, 102, 201]);
	assert.deepEqual(network.blockedEdges.road, [], "closing seam joins the first and last occupied cells");
	data.paths[0].points = [edge];
	network = convertHexerMap(data).maps[0].dataset.networks;
	assert.deepEqual(network.blockedEdges.road, [[101, 201]], "a singleton on an edge must not invent a segment");
});

test("public notes do not expose a fog-hidden POI header", () => {
	const data = fixture();
	data.hexes["0,0,surface"].fogState = "hidden";
	data.pois = [{ layer: "surface", hex: { q: 0, r: 0 }, type: "ruins", label: "Secret lair" }];
	data.notes = [{ layer: "surface", hex: { q: 0, r: 0 }, title: "Public", content: "Clue", dmOnly: false, discoveryType: "visible" }];
	let record = convertHexerMap(data).maps[0].dataset.hexes.find(h => h.num === 101);
	assert.equal(record.features[0].discovered, false);
	assert.equal(record.showToPlayers, false);
	assert.equal(record.notes[0].visible, false);
	data.settings.fogEnabled = false;
	record = convertHexerMap(data).maps[0].dataset.hexes.find(h => h.num === 101);
	assert.equal(record.showToPlayers, true);
	assert.equal(record.notes[0].visible, true);
});

test("flat orientation keeps offsets; transposed pointy polylines preserve the same cells and edges", () => {
	const pointy = fixture();
	pointy.paths = [{ type: "water", layer: "surface", points: [{ x: 0, y: 0 }, { x: Math.sqrt(3) * 1.5, y: 3 }], closed: false }];
	pointy.hexes["0,2,surface"].fogState = "hidden";
	const flat = fixture("flat");
	flat.paths = pointy.paths.map(p => ({ ...p, points: p.points.map(({ x, y }) => ({ x: y, y: x })) }));
	flat.hexes["2,0,surface"].fogState = "hidden";
	const p = convertHexerMap(pointy).maps[0]; const f = convertHexerMap(flat).maps[0];
	assert.equal(f.dataset.grid.landscape, false);
	assert.equal(p.flags.hexFogRevealed["0-2"], undefined);
	assert.equal(f.flags.hexFogRevealed["0-2"], undefined);
	const transposeNum = num => (num % 100) * 100 + Math.floor(num / 100);
	assert.deepEqual(f.dataset.networks.river, p.dataset.networks.river.map(transposeNum).sort((a, b) => a - b));
});

test("all malformed supported data rejects before any scene writes; unknown/detail content warns", async () => {
	for (const alter of [
		d => { d.schemaVersion = 7; }, d => { d.settings.width = 100; }, d => { d.settings.height = 0; },
		d => { d.settings.hexSize = 0; }, d => { d.settings.orientation = "diagonal"; },
		d => { d.hexes["0,0,surface"].q = 1; }, d => { d.hexes["0,0,surface"].fogState = "typo"; },
		d => { d.hexes["0,0,surface"].edgeData = { 6: "blocked" }; },
		d => { d.paths = [{ layer: "surface", type: "primary", points: [{ x: NaN, y: 0 }] }]; },
		d => { d.notes = [{ layer: "level_2", hex: { q: 0, r: 0 } }]; },
		d => { d.regions = [{ layer: "surface", name: "outside", hexes: [{ q: -1, r: 0 }] }]; },
	]) {
		const data = fixture(); alter(data);
		await assert.rejects(importHexerMap(data), /Hexer/);
		assert.equal(writes.length, 0);
	}
	const data = fixture();
	data.hexes["0,0,surface,1"] = { ...data.hexes["0,0,surface"] };
	data.paths = [{ layer: "surface", type: "barrier", points: [] }];
	const plan = convertHexerMap(data);
	assert.ok(plan.warnings.some(w => /Detail-scale/.test(w)));
	assert.ok(plan.warnings.some(w => /barrier/.test(w)));
	await assert.rejects(importHexerMap(data, { overwrite: true }), /Unknown Hexer option/);
	game.user.isGM = false;
	await assert.rejects(importHexerMap(data), /GM/);
	assert.equal(writes.length, 0);
});

test("native file dialog previews before writes and cancellation is side-effect free", async () => {
	const dialogs = [];
	globalThis.ui = { notifications: { error: error => assert.fail(error) } };
	globalThis.foundry = { utils: { escapeHTML: value => String(value).replaceAll("<", "&lt;") }, applications: { api: { DialogV2: {
		prompt: async config => {
			dialogs.push(config);
			return config.ok.callback(null, { form: { elements: { hexerFile: { files: [{ size: 100, text: async () => JSON.stringify(fixture()) }] } } } });
		},
		confirm: async config => { dialogs.push(config); return false; },
	} } } };
	assert.equal(await openHexerImportDialog(), null);
	assert.equal(dialogs.length, 2);
	assert.match(dialogs[1].content, /Create 2 new scene/);
	assert.equal(writes.length, 0);
});
