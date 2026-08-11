// Lazy label construction for the coordinate overlay, scripts/hex/SDXCoordsSD.mjs.
//
// Issue #120: the constructor built all three label sets up front and only
// afterwards read the scene state that decides which — at most one — is shown.
// A 2,948-cell scene with coordinates switched off measured 6,118 PIXI text
// objects built and immediately hidden, on every canvasReady.
//
// The states are mutually exclusive (HIDDEN -> MARGIN -> CELL -> ZINE), so
// these tests pin two things: a scene that never turns coordinates on builds
// nothing, and a scene that does builds exactly the set it displays — then
// caches it, so cycling back to a state already reached does not rebuild.
//
// SDXCoord is not exported, so the overlay is driven the way the module drives
// it: initSDXCoords registers a canvasReady hook, and that hook assigns the
// instance to window.SDXCoordinates.

import assert from "node:assert/strict";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";

const DISPLAY_STATES = { HIDDEN: 1, MARGIN: 2, CELL: 3, ZINE: 4 };

// --- PIXI / Foundry stubs ---------------------------------------------------

/** Every PreciseText constructed since the last useScene(), across all containers. */
let textsBuilt = [];

class StubText {
	constructor(label) {
		this.label = label;
		this.resolution = 1;
		this.alpha = 1;
		this.width = 10;
		this.height = 10;
		this._pos = { x: 0, y: 0 };
		this.position = { set: (x, y) => { this._pos = { x, y }; } };
		this.anchor = { set() {} };
		textsBuilt.push(this);
	}

	destroy() {}
}

class StubContainer {
	constructor() {
		this.children = [];
		this.visible = true;
	}

	addChild(child) {
		this.children.push(child);
		return child;
	}

	removeChild(child) {
		this.children = this.children.filter(c => c !== child);
		return child;
	}
}

/** A text style that survives the two .clone() calls the renderers make. */
function makeStyle() {
	return {
		fill: "#fff", fontFamily: "Signika-Bold", fontSize: 50,
		stroke: "#000", strokeThickness: 3,
		clone() { return makeStyle(); },
	};
}

let canvasReadyHook = null;
let sceneFlag = DISPLAY_STATES.HIDDEN;
let clickListeners = 0;

globalThis.PIXI = { Container: StubContainer };
globalThis.game = {
	version: "13",
	settings: {
		get: (scope, key) => {
			if (scope === MODULE_ID && key === "sdxCoordsSettings") return {};
			throw new Error(`unregistered setting ${scope}.${key}`);
		},
		register() {}, registerMenu() {},
	},
	i18n: { localize: key => key },
	user: { isGM: true },
	keyboard: { isModifierActive: () => false },
};
globalThis.foundry = {
	utils: { mergeObject: (a, b) => Object.assign({}, a, b) },
	canvas: { containers: { PreciseText: StubText } },
	applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: B => B } },
};
globalThis.CONFIG = { canvasTextStyle: makeStyle() };
globalThis.Hooks = {
	on(event, fn) { if (event === "canvasReady") canvasReadyHook = fn; },
	once() {}, off() {},
};
globalThis.document = { fonts: { load: () => Promise.resolve() } };
globalThis.window = globalThis;

const { initSDXCoords } = await import("../../scripts/hex/SDXCoordsSD.mjs");

initSDXCoords();
assert.ok(canvasReadyHook, "initSDXCoords must register a canvasReady hook");

/**
 * Install a square 10x10 grid scene whose stored coordinate state is `state`,
 * then run the canvasReady hook so window.SDXCoordinates is a fresh overlay.
 *
 * Square grids keep the label maths trivial — this file is about how many
 * objects get built, not what they say (hex-coordinates.test.mjs covers that).
 */
async function useScene(state) {
	sceneFlag = state;
	clickListeners = 0;
	globalThis.window.SDXCoordinates = null;

	const rect = {
		x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000,
		contains: (x, y) => x >= 0 && x <= 1000 && y >= 0 && y <= 1000,
	};

	globalThis.canvas = {
		scene: {
			getFlag: (scope, key) =>
				(scope === MODULE_ID && key === "sdxcoords-state" ? sceneFlag : undefined),
			setFlag: (scope, key, value) => { sceneFlag = value; return Promise.resolve(); },
		},
		controls: new StubContainer(),
		stage: { addListener: () => { clickListeners += 1; } },
		grid: {
			isSquare: true, isHexagonal: false, columns: false, even: false,
			sizeX: 100, sizeY: 100,
			getOffset: ({ x, y }) => ({ i: Math.floor(y / 100), j: Math.floor(x / 100) }),
			getTopLeftPoint: ({ i, j }) => ({ x: j * 100, y: i * 100 }),
		},
		dimensions: { sceneRect: rect, size: 100, rows: 10, columns: 10 },
		mousePosition: { x: 250, y: 350 },
	};

	textsBuilt = [];
	await canvasReadyHook();
	return globalThis.window.SDXCoordinates;
}

/** The three label containers, in HIDDEN/MARGIN/CELL/ZINE order of interest. */
function containers() {
	// canvas.controls receives margin, cell, zine in construction order.
	const [margin, cell, zine] = globalThis.canvas.controls.children;
	return { margin, cell, zine };
}

// --- the acceptance number --------------------------------------------------

test("a scene with coordinates off builds zero text objects", async () => {
	const coords = await useScene(DISPLAY_STATES.HIDDEN);

	assert.ok(coords, "the overlay is still constructed");
	assert.equal(textsBuilt.length, 0, "no PreciseText is constructed while hidden");

	const { margin, cell, zine } = containers();
	assert.deepEqual(
		[margin.children.length, cell.children.length, zine.children.length],
		[0, 0, 0],
		"all three containers are empty"
	);
	assert.deepEqual(
		[margin.visible, cell.visible, zine.visible],
		[false, false, false],
		"and all three stay hidden"
	);
});

test("the click listener is attached even when labels are hidden", async () => {
	await useScene(DISPLAY_STATES.HIDDEN);

	// Modifier-click coordinate readout is independent of the label sets and
	// must survive the lazy path — it is the only thing the hidden path sets up.
	assert.equal(clickListeners, 1);
});

// --- a scene that does use coordinates --------------------------------------

test("a scene stored as MARGIN builds only the margin labels, on load", async () => {
	await useScene(DISPLAY_STATES.MARGIN);

	const { margin, cell, zine } = containers();
	assert.ok(margin.children.length > 0, "margin labels appear without needing a toggle");
	assert.equal(cell.children.length, 0, "the cell set is not built");
	assert.equal(zine.children.length, 0, "the zine set is not built");
	assert.deepEqual([margin.visible, cell.visible, zine.visible], [true, false, false]);
});

test("a scene stored as CELL builds only the cell labels, on load", async () => {
	await useScene(DISPLAY_STATES.CELL);

	const { margin, cell, zine } = containers();
	assert.equal(margin.children.length, 0);
	assert.ok(cell.children.length > 0);
	assert.equal(zine.children.length, 0);
	assert.deepEqual([margin.visible, cell.visible, zine.visible], [false, true, false]);
});

test("a scene stored as ZINE builds only the zine labels, on load", async () => {
	await useScene(DISPLAY_STATES.ZINE);

	const { margin, cell, zine } = containers();
	assert.equal(margin.children.length, 0);
	assert.equal(cell.children.length, 0);
	assert.ok(zine.children.length > 0, "zine gets both margin- and cell-style labels");
	assert.deepEqual([margin.visible, cell.visible, zine.visible], [false, false, true]);
});

// --- toggling ---------------------------------------------------------------

test("toggling HIDDEN -> MARGIN -> CELL -> ZINE -> HIDDEN builds each set once", async () => {
	const coords = await useScene(DISPLAY_STATES.HIDDEN);
	const { margin, cell, zine } = containers();

	assert.equal(textsBuilt.length, 0);

	coords.toggle(); // -> MARGIN
	assert.ok(margin.children.length > 0, "margin builds the first time it is reached");
	assert.deepEqual([margin.visible, cell.visible, zine.visible], [true, false, false]);
	const afterMargin = textsBuilt.length;

	coords.toggle(); // -> CELL
	assert.ok(cell.children.length > 0, "cell builds the first time it is reached");
	assert.deepEqual([margin.visible, cell.visible, zine.visible], [false, true, false]);
	const afterCell = textsBuilt.length;
	assert.ok(afterCell > afterMargin);

	coords.toggle(); // -> ZINE
	assert.ok(zine.children.length > 0, "zine builds the first time it is reached");
	assert.deepEqual([margin.visible, cell.visible, zine.visible], [false, false, true]);
	const afterZine = textsBuilt.length;
	assert.ok(afterZine > afterCell);

	coords.toggle(); // -> HIDDEN
	assert.deepEqual([margin.visible, cell.visible, zine.visible], [false, false, false]);
	assert.equal(textsBuilt.length, afterZine, "returning to HIDDEN builds nothing");

	// Second lap: every set has been reached, so nothing may be rebuilt.
	const marginCount = margin.children.length;
	const cellCount = cell.children.length;
	const zineCount = zine.children.length;

	coords.toggle(); // -> MARGIN
	coords.toggle(); // -> CELL
	coords.toggle(); // -> ZINE
	coords.toggle(); // -> HIDDEN

	assert.equal(textsBuilt.length, afterZine, "a second lap constructs no new text objects");
	assert.deepEqual(
		[margin.children.length, cell.children.length, zine.children.length],
		[marginCount, cellCount, zineCount],
		"and no container accumulates duplicates"
	);
});

test("the persisted flag still advances through every state", async () => {
	const coords = await useScene(DISPLAY_STATES.HIDDEN);

	coords.toggle();
	assert.equal(sceneFlag, DISPLAY_STATES.MARGIN);
	coords.toggle();
	assert.equal(sceneFlag, DISPLAY_STATES.CELL);
	coords.toggle();
	assert.equal(sceneFlag, DISPLAY_STATES.ZINE);
	coords.toggle();
	assert.equal(sceneFlag, DISPLAY_STATES.HIDDEN);
});
