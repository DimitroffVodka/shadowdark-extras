import assert from "node:assert/strict";
import test from "node:test";

import { installPersistenceGlobals } from "./helpers/persistence-harness.mjs";

const MODULE_ID = "shadowdark-extras";
const HEX_JOURNAL_NAME = "__sdx_hex_data__";
const world = installPersistenceGlobals();
const scene = world.scene;

// Keep the hook path real: initHexFog registers this handler and the tests call
// the function Foundry would call, rather than extracting private source.
const hookHandlers = new Map();
const Hooks = {
	on(name, handler) {
		if (!hookHandlers.has(name)) hookHandlers.set(name, new Set());
		hookHandlers.get(name).add(handler);
		return handler;
	},
	once(name, handler) {
		return this.on(name, handler);
	},
	off(name, handler) {
		hookHandlers.get(name)?.delete(handler);
	},
	handlers(name) {
		return [...(hookHandlers.get(name) ?? [])];
	},
};
globalThis.Hooks = Hooks;

const sceneUpdateCalls = [];
const sceneUpdatePromises = [];
let nextUpdateGate = null;
scene.update = data => {
	const run = (async () => {
		sceneUpdateCalls.push(structuredClone(data));
		const gate = nextUpdateGate;
		if (gate) {
			nextUpdateGate = null;
			await gate.released;
		}

		for (const [scope, changes] of Object.entries(data.flags ?? {})) {
			for (const [key, value] of Object.entries(changes ?? {})) {
				const current = scene.getFlag(scope, key);
				const merged = current && value && typeof current === "object"
					&& typeof value === "object" && !Array.isArray(current) && !Array.isArray(value)
					? { ...current, ...value }
					: value;
				await scene.setFlag(scope, key, structuredClone(merged));
			}
		}
		return scene;
	})();
	sceneUpdatePromises.push(run);
	return run;
};

let polygonDraws = 0;
let geometryClears = 0;
class RecordingGraphics {
	constructor() {
		this.filters = [];
		this.destroyed = false;
		this.fills = [];
		this.children = [];
		this.visible = true;
		this.tint = 0xffffff;
	}

	clear() { geometryClears++; this.fills = []; return this; }
	addChild(child) { this.children.push(child); return child; }
	get renderedFills() {
		return [...this.fills.map(c => c & this.tint), ...this.children.flatMap(c => c.renderedFills)];
	}
	lineStyle() { return this; }
	beginFill(color) { this.fills.push(color); return this; }
	beginTextureFill(options) { this.textureFill = options; return this; }
	drawPolygon() { polygonDraws++; return this; }
	endFill() { return this; }
	destroy() { this.destroyed = true; this.children.forEach(c => c.destroy()); }
}
globalThis.PIXI.Graphics = RecordingGraphics;
globalThis.PIXI.LegacyGraphics = RecordingGraphics;

globalThis.game.user = { id: "gm", isGM: true };
globalThis.game.users = { activeGM: globalThis.game.user };
globalThis.game.modules = {
	get: id => id === "shadowdark-enhancer" ? { active: true } : undefined,
};
globalThis.game.time = { worldTime: 9 };
globalThis.game.shadowdarkEnhancer = {
	rules: {
		visibility: () => ({
			darkness: 0,
			stormy: 0,
			excellent: 0,
			slight: 0,
			high: 0,
			elevation: { mountain: "high" },
		}),
	},
	time: { isNight: () => false },
	overland: { state: () => ({ weather: { kind: "fair", until: 100 } }) },
};

const { initHexFog } = await import("../../scripts/hex/SDXHexFogSD.mjs");
initHexFog();
const onCanvasReady = Hooks.handlers("canvasReady").at(-1);
const onUpdateToken = Hooks.handlers("updateToken").at(-1);
const onUpdateScene = Hooks.handlers("updateScene").at(-1);

function tick() {
	return new Promise(resolve => setImmediate(resolve));
}

async function waitForSceneUpdates(count) {
	await waitForSceneUpdateCount(count);
	await Promise.all(sceneUpdatePromises.slice(0, count));
}

async function waitForSceneUpdateCount(count) {
	for (let attempt = 0; attempt < 20 && sceneUpdatePromises.length < count; attempt++) await tick();
	assert.equal(sceneUpdatePromises.length, count, `expected ${count} scene.update call(s)`);
}

function blockNextSceneUpdate() {
	let release;
	const released = new Promise(resolve => { release = resolve; });
	nextUpdateGate = { released };
	return { release };
}

function makeRecords(max = 7) {
	return Object.fromEntries(Array.from({ length: max + 1 }, (_, j) => [
		`0_${j}`,
		{ terrain: "Forest", revealRadius: -1, revealCells: "", rollTable: "" },
	]));
}

function makeCanvas(pathCells) {
	const directPathCalls = [];
	const line = (start, end) => {
		const step = Math.sign(end.j - start.j);
		return Array.from({ length: Math.abs(end.j - start.j) + 1 }, (_, n) => ({
			i: start.i,
			j: start.j + n * step,
		}));
	};
	const grid = {
		isHexagonal: true,
		sizeX: 100,
		sizeY: 100,
		getShape: () => [],
		getAdjacentOffsets: ({ i, j }) => [{ i, j: j - 1 }, { i, j: j + 1 }],
		getCenterPoint: ({ i, j }) => ({ x: j * 100, y: i * 100 }),
		getOffset: ({ x, y }) => ({ i: Math.floor(y / 100), j: Math.floor(x / 100) }),
		getDirectPath(points) {
			directPathCalls.push(points.map(point => ({ ...point })));
			const start = points[0];
			const end = points.at(-1);
			if (Number.isInteger(start.i) && Number.isInteger(end.i)) return line(start, end);
			const startJ = Math.round((start.x - 50) / 100);
			const endJ = Math.round((end.x - 50) / 100);
			return startJ === endJ
				? [pathCells.at(-1)]
				: line({ i: 0, j: startJ }, { i: 0, j: endJ });
		},
	};
	return {
		directPathCalls,
		canvas: {
			scene,
			grid,
			interface: { addChildAt() {} },
			masks: { vision: { addChild() {} } },
			stage: { on() {}, off() {} },
			perception: { update() {} },
		},
	};
}

async function prepare(records) {
	world.reset();
	world.showScenes();
	world.setGM(true);
	globalThis.game.user = { id: "gm", isGM: true };
	globalThis.game.users = { activeGM: globalThis.game.user };
	globalThis.game.time.worldTime = 9;
	globalThis.game.shadowdarkEnhancer.time.isNight = () => false;
	globalThis.game.shadowdarkEnhancer.overland.state = () => ({
		weather: { kind: "fair", until: 100 },
	});
	sceneUpdateCalls.length = 0;
	sceneUpdatePromises.length = 0;
	nextUpdateGate = null;
	scene.tokenVision = false;
	scene.dimensions = { rows: 1, columns: 12, width: 1200, height: 100 };
	scene.fog = { colors: { unexplored: { css: "#000000" } } };

	const journal = await JournalEntry.create({ name: HEX_JOURNAL_NAME });
	await journal.setFlag(MODULE_ID, "hexData", { [scene.id]: records });
	await scene.setFlag(MODULE_ID, "hexFogEnabled", true);
	await scene.setFlag(MODULE_ID, "hexFogRevealed", {});
	await scene.setFlag(MODULE_ID, "hexFogDiscovery", {});
	world.clearRecords();

	const pathCells = Object.keys(records).map(key => {
		const [i, j] = key.split("_").map(Number);
		return { i, j };
	});
	const installed = makeCanvas(pathCells);
	scene.grid = installed.canvas.grid;
	globalThis.canvas = installed.canvas;
	onCanvasReady();
	await tick();
	return installed.directPathCalls;
}

function partyToken(from, to, { id = "party", actor, parent = scene } = {}) {
	const token = {
		id,
		parent,
		x: to * 100,
		y: 0,
		width: 1,
		height: 1,
		// Foundry v14's _source is already the destination in updateToken.
		_source: { x: to * 100, y: 0 },
		actor: actor ?? {
			type: "NPC",
			getFlag: (scope, key) => scope === MODULE_ID && key === "isParty",
		},
	};
	const waypoints = from < to
		? Array.from({ length: Math.max(0, to - from - 1) }, (_, n) => ({ x: (from + n + 1) * 100, y: 0 }))
		: [];
	return {
		token,
		options: { _movement: { [token.id]: { origin: { x: from * 100, y: 0 }, passed: { waypoints } } } },
	};
}

test("initHexFog wires a real updateToken hook", () => {
	assert.equal(typeof onCanvasReady, "function", "canvasReady hook is registered");
	assert.equal(typeof onUpdateToken, "function", "updateToken hook is registered");
});

for (const isGM of [false, true]) {
	test(`late movement reveal refreshes the completed vision mask for ${isGM ? "GM" : "player"}`, async () => {
		await prepare(makeRecords(3));
		scene.tokenVision = true;
		let mask;
		const refreshes = [];
		canvas.masks.vision.addChild = graphics => { mask = graphics; };
		canvas.perception.update = options => refreshes.push({ options, fills: mask.renderedFills });
		onCanvasReady();
		refreshes.length = 0;

		// Hold the GM's reveal write until movement has finished, then deliver
		// updateScene as Foundry does on each receiving client. No animation or
		// token-selection refresh is available to hide the missing invalidation.
		const gate = blockNextSceneUpdate();
		try {
			const { token, options } = partyToken(0, 1);
			onUpdateToken(token, { x: token.x }, options);
			await waitForSceneUpdateCount(1);
			assert.equal(refreshes.length, 0);
			gate.release();
			await waitForSceneUpdates(1);
			game.user.isGM = isGM;
			onUpdateScene(scene, sceneUpdateCalls[0]);
			assert.equal(scene.getFlag(MODULE_ID, "hexFogRevealed")["0-1"], true);
			assert.deepEqual(refreshes, [{
				options: { refreshVision: true },
				fills: [0xffffff, 0xffffff, 0xffffff, ...Array(9).fill(0x000000)],
			}], "invalidate once, after drawing the newly revealed hexes");
		}
		finally { gate.release(); }
	});
}

test("fog initialization refreshes vision, but token-vision-off scenes do not", async () => {
	for (const tokenVision of [true, false]) {
		await prepare(makeRecords(1));
		scene.tokenVision = tokenVision;
		const refreshes = [];
		canvas.perception.update = options => refreshes.push(options);
		onCanvasReady();
		assert.deepEqual(refreshes, tokenVision ? [{ refreshVision: true }] : []);
		refreshes.length = 0;
		await scene.setFlag(MODULE_ID, "hexFogRevealed", { "0-1": true });
		onUpdateScene(scene, { flags: { [MODULE_ID]: { hexFogRevealed: { "0-1": true } } } });
		assert.deepEqual(refreshes, tokenVision ? [{ refreshVision: true }] : []);
	}
});

test("a reveal changes fog and mask without rebuilding polygon geometry", async () => {
	await prepare(makeRecords(3));
	scene.tokenVision = true;
	let overlay;
	let mask;
	const refreshes = [];
	canvas.interface.addChildAt = graphics => { overlay = graphics; };
	canvas.masks.vision.addChild = graphics => { mask = graphics; };
	canvas.perception.update = options => refreshes.push(options);
	onCanvasReady();
	polygonDraws = geometryClears = 0;
	refreshes.length = 0;
	await scene.setFlag(MODULE_ID, "hexFogRevealed", { "0-1": true });
	onUpdateScene(scene, { flags: { [MODULE_ID]: { hexFogRevealed: { "0-1": true } } } });
	assert.equal(polygonDraws, 0, "reuse existing fog and mask polygons");
	assert.equal(geometryClears, 0, "do not clear unchanged geometry");
	assert.equal(overlay.children[1].visible, false);
	assert.equal(mask.renderedFills[1], 0xffffff);
	assert.equal(mask.renderedFills[2], 0x000000);
	assert.deepEqual(refreshes, [{ refreshVision: true }]);
	refreshes.length = 0;
	onUpdateScene(scene, { flags: { [MODULE_ID]: { hexRolledCells: {} } } });
	assert.equal(polygonDraws, 0);
	assert.equal(geometryClears, 0);
	assert.deepEqual(refreshes, [], "unrelated flags do not invalidate the cached mask");
	await scene.setFlag(MODULE_ID, "hexFogRevealed", { "0-1": false });
	onUpdateScene(scene, { "flags.shadowdark-extras.hexFogRevealed.0-1": false });
	assert.equal(overlay.children[1].visible, true);
	assert.equal(mask.renderedFills[1], 0x000000);
	assert.equal(polygonDraws, 0);
	assert.deepEqual(refreshes, [{ refreshVision: true }]);
	Hooks.handlers("canvasTearDown").at(-1)();
	assert.ok(overlay.children.every(c => c.destroyed));
	assert.ok(mask.children.every(c => c.destroyed));
});

test("journal exploration and real paint handlers update retained cells and refresh the mask once", async () => {
	await prepare(makeRecords(5));
	scene.tokenVision = true;
	let overlay;
	let mask;
	const handlers = new Map();
	const refreshes = [];
	canvas.stage.on = (name, fn) => handlers.set(name, fn);
	canvas.interface.addChildAt = graphics => { overlay = graphics; };
	canvas.masks.vision.addChild = graphics => { mask = graphics; };
	canvas.perception.update = options => refreshes.push(options);
	onCanvasReady();
	polygonDraws = geometryClears = 0;
	refreshes.length = 0;
	const journal = game.journal.find(j => j.name === HEX_JOURNAL_NAME);
	const records = makeRecords(5);
	records["0_2"].exploration = "mapped";
	await journal.setFlag(MODULE_ID, "hexData", { [scene.id]: records });
	Hooks.handlers("updateJournalEntry").at(-1)(journal);
	assert.equal(mask.renderedFills[2], 0xffffff);
	assert.equal(overlay.children[2].visible, false);
	assert.deepEqual(refreshes, [{ refreshVision: true }]);
	refreshes.length = 0;
	Hooks.handlers("updateJournalEntry").at(-1)(journal);
	assert.deepEqual(refreshes, [], "unchanged journal data does not invalidate vision");

	const oldDocument = globalThis.document;
	globalThis.document = { elementFromPoint: () => ({ tagName: "CANVAS" }) };
	try {
		const event = { ctrlKey: true, getLocalPosition: () => ({ x: 400, y: 0 }) };
		handlers.get("mousedown")(event);
		assert.equal(overlay.children[4].visible, false);
		assert.equal(mask.renderedFills[4], 0xffffff);
		assert.deepEqual(refreshes, [{ refreshVision: true }]);
		handlers.get("mouseup")();
		await tick();
		refreshes.length = 0;
		handlers.get("mousedown")({ ...event, ctrlKey: false, shiftKey: true });
		assert.equal(overlay.children[4].visible, true);
		assert.equal(mask.renderedFills[4], 0x000000);
		assert.deepEqual(refreshes, [{ refreshVision: true }]);
		handlers.get("mouseup")();
		await tick();
		assert.equal(scene.getFlag(MODULE_ID, "hexFogRevealed")["0-4"], false);
		assert.equal(polygonDraws, 0);
		assert.equal(geometryClears, 0);
	}
	finally {
		if (oldDocument === undefined) delete globalThis.document;
		else globalThis.document = oldDocument;
	}
});

test("loading an overlay image preserves world alignment and retained reveal geometry", async () => {
	await prepare(makeRecords(2));
	const oldLoader = globalThis.loadTexture;
	const oldMatrix = PIXI.Matrix;
	let overlay;
	const texture = { valid: true, width: 600, height: 50 };
	globalThis.loadTexture = async () => texture;
	PIXI.Matrix = class {
		translate(x, y) { this.translation = [x, y]; return this; }
		scale(x, y) { this.scaling = [x, y]; return this; }
	};
	try {
		canvas.dimensions = { sceneX: 10, sceneY: 20, sceneWidth: 1200, sceneHeight: 100 };
		canvas.interface.addChildAt = graphics => { overlay = graphics; };
		scene.fog.overlay = "owned-test-overlay.webp";
		onCanvasReady();
		await tick();
		const fill = overlay.children[0].textureFill;
		assert.equal(fill.texture, texture);
		assert.equal(fill.alpha, 0.5);
		assert.deepEqual(fill.matrix.translation, [-10, -20]);
		assert.deepEqual(fill.matrix.scaling, [0.5, 0.5]);
		polygonDraws = geometryClears = 0;
		await scene.setFlag(MODULE_ID, "hexFogRevealed", { "0-1": true });
		onUpdateScene(scene, { flags: { [MODULE_ID]: { hexFogRevealed: { "0-1": true } } } });
		assert.equal(overlay.children[1].visible, false);
		assert.equal(overlay.children[2].textureFill.texture, texture);
		assert.equal(polygonDraws, 0);
		assert.equal(geometryClears, 0);
	}
	finally {
		globalThis.loadTexture = oldLoader;
		PIXI.Matrix = oldMatrix;
	}
});

test("the real updateToken hook follows _movement when _source is already the destination", async () => {
	const directPathCalls = await prepare(makeRecords(7));
	const { token, options } = partyToken(0, 5);
	onUpdateToken(token, { x: token.x, y: token.y }, options);
	await tick();

	const revealed = scene.getFlag(MODULE_ID, "hexFogRevealed");
	assert.equal(revealed["0-1"], true,
		"a traversed intermediate hex must reveal; destination-only _source logic misses it");
	assert.equal(revealed["0-2"], true);
	assert.deepEqual(directPathCalls[0], [
		{ x: 50, y: 50 },
		{ x: 150, y: 50 },
		{ x: 250, y: 50 },
		{ x: 350, y: 50 },
		{ x: 450, y: 50 },
		{ x: 550, y: 50 },
	]);
});

test("waypoint-only movement still enters the travel path", async () => {
	await prepare(makeRecords(3));
	const { token, options } = partyToken(0, 2);
	onUpdateToken(token, {}, options);
	await tick();

	assert.equal(scene.getFlag(MODULE_ID, "hexFogRevealed")["0-1"], true,
		"passed waypoints count as movement even when x/y are omitted");
});

test("a party NPC gets Enhancer mountain line of sight and terrain-only distant discovery", async () => {
	const records = {
		"0_0": { terrain: "Forest" },
		"0_1": { terrain: "Forest" },
		"0_2": { terrain: "Forest" },
		"0_3": { terrain: "Mountain" },
		"0_4": { terrain: "Forest" },
		"0_5": { terrain: "Mountain" },
	};
	await prepare(records);
	const { token, options } = partyToken(0, 1);
	onUpdateToken(token, { x: token.x, y: token.y }, options);
	await tick();

	const discovery = scene.getFlag(MODULE_ID, "hexFogDiscovery");
	const revealed = scene.getFlag(MODULE_ID, "hexFogRevealed");
	assert.equal(discovery["0-3"], "terrain",
		"daylight should reveal a mountain with line of sight as terrain-only");
	assert.equal(discovery["0-5"], undefined,
		"a mountain behind an intermediate mountain must stay undiscovered");
	assert.equal(revealed["0-3"], true);
});

test("updateToken ignores a disabled scene and a non-active GM", async () => {
	await prepare(makeRecords(3));
	const movement = partyToken(0, 2);

	globalThis.game.users.activeGM = { id: "other-gm" };
	onUpdateToken(movement.token, { x: movement.token.x, y: movement.token.y }, movement.options);
	await tick();
	assert.deepEqual(scene.getFlag(MODULE_ID, "hexFogRevealed"), {});

	globalThis.game.users.activeGM = globalThis.game.user;
	const offScene = partyToken(0, 2, { parent: { id: "other-scene", getFlag: () => false } });
	onUpdateToken(offScene.token, { x: offScene.token.x, y: offScene.token.y }, offScene.options);
	await tick();
	assert.deepEqual(scene.getFlag(MODULE_ID, "hexFogRevealed"), {});
});

test("missing terrain and invalid weather time stay on legacy fog without discovery", async () => {
	const cases = [
		{
			label: "missing terrain",
			records: { "0_0": {}, "0_1": {} },
		},
		{
			label: "expired weather",
			records: makeRecords(1),
			weather: { kind: "fair", until: 9 },
		},
	];

	for (const entry of cases) {
		await prepare(entry.records);
		if (entry.weather) {
			globalThis.game.shadowdarkEnhancer.overland.state = () => ({ weather: entry.weather });
		}
		const movement = partyToken(0, 1);
		onUpdateToken(movement.token, { x: movement.token.x, y: movement.token.y }, movement.options);
		await tick();
		assert.deepEqual(scene.getFlag(MODULE_ID, "hexFogDiscovery"), {}, entry.label);
	}
});

test("movement uses its own scene while the GM views an unrelated canvas", async () => {
	await prepare(makeRecords(3));
	const { token, options } = partyToken(0, 2);
	Hooks.handlers("canvasTearDown").at(-1)();
	globalThis.canvas = { scene: { id: "unrelated-scene" }, grid: { isHexagonal: false } };
	onUpdateToken(token, { x: token.x }, options);
	await tick();
	assert.equal(scene.getFlag(MODULE_ID, "hexFogRevealed")["0-1"], true);
	assert.equal(scene.getFlag(MODULE_ID, "hexFogDiscovery")["0-2"], "near");
});

test("mixed terrain fallback reveals fog without promoting its unobserved ring", async () => {
	for (const [prior, explicit] of [[undefined, false], ["terrain", false], ["terrain", true]]) {
		const records = makeRecords(7);
		records["0_1"] = { revealRadius: 5 };
		records["0_3"] = { terrain: "Mountain" };
		records["0_5"] = { terrain: "Mountain", name: "Hidden peak", showToPlayers: false };
		if (explicit) records["0_2"].revealCells = "0.5";
		await prepare(records);
		if (prior) await scene.setFlag(MODULE_ID, "hexFogDiscovery", { "0-5": prior });
		const { token, options } = partyToken(0, 2);
		onUpdateToken(token, { x: token.x }, options);
		await tick();
		assert.equal(scene.getFlag(MODULE_ID, "hexFogRevealed")["0-5"], true,
			"legacy radius remains a fog exception on the terrain-less origin");
		assert.equal(scene.getFlag(MODULE_ID, "hexFogDiscovery")["0-5"], explicit ? "near" : prior,
			"only an explicit exception can unlock keyed information behind a mountain");
		assert.equal(scene.getFlag(MODULE_ID, "hexFogDiscovery")["0-1"], "near",
			"physically traversed cells are still discovered");
	}
});

test("rapid movement writes serialize and preserve additive discovery", async () => {
	await prepare(makeRecords(7));
	const gate = blockNextSceneUpdate();
	try {
		const first = partyToken(0, 5);
		onUpdateToken(first.token, { x: first.token.x, y: first.token.y }, first.options);
		await waitForSceneUpdateCount(1);

		const second = partyToken(5, 6);
		onUpdateToken(second.token, { x: second.token.x, y: second.token.y }, second.options);
		await tick();
		assert.equal(sceneUpdateCalls.length, 1,
			"a second move must wait for the first read-modify-write to finish");

		gate.release();
		await waitForSceneUpdates(2);
		const revealed = scene.getFlag(MODULE_ID, "hexFogRevealed");
		assert.equal(revealed["0-1"], true);
		assert.equal(revealed["0-6"], true);
	}
	finally {
		gate.release();
		nextUpdateGate = null;
		await tick();
	}
});
