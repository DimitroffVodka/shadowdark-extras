// Zine coordinates from Shadowdark Enhancer's hex numbering, scripts/hex/SDXCoordsSD.mjs.
//
// Issue #195: on a scene the Enhancer's "Hex map from image" made (first hex 0001), the Zine
// labels guessed and wrote 001 on the castle hex that the book, the Hex Tagger and the keyed-hex
// journal pages call 102. Enhancer 1.26.0 answers game.shadowdarkEnhancer.hexMaps.hasNumbering
// and .numberAt; Extras writes what it says, in the Zine state only.
//
// These pin the acceptance check, and that everything else is untouched: no Enhancer, an older
// one, a scene it has not numbered, a published layout, the lettered styles. The untouched
// heuristic's values were read off the code before this change (9700bd51), not off the new code.
//
// The overlay is driven the way the module drives it (see hex-coordinates-lazy-build.test.mjs):
// initSDXCoords registers the hooks, canvasReady builds window.SDXCoordinates.

import assert from "node:assert/strict";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";
const DISPLAY_STATES = { HIDDEN: 1, MARGIN: 2, CELL: 3, ZINE: 4 };

// --- PIXI / Foundry stubs ---------------------------------------------------

let textsBuilt = [];

class StubText {
	constructor(label) {
		this.label = label;
		this.width = 10;
		this.height = 10;
		this.destroyed = false;
		this._pos = { x: 0, y: 0 };
		this.position = { set: (x, y) => { this._pos = { x, y }; } };
		this.anchor = { set() {} };
		textsBuilt.push(this);
	}

	destroy() { this.destroyed = true; }
}

class StubBitmapText extends StubText {}

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

	removeChildren() {
		const gone = this.children;
		this.children = [];
		return gone;
	}

	// PIXI's contract: destroy({ children: true }) takes the children with it.
	destroy(options) {
		if (options?.children) for (const child of this.children) child.destroy(options);
	}
}

function makeStyle() {
	return {
		fill: "#fff", fontFamily: "Signika-Bold", fontSize: 50,
		stroke: "#000", strokeThickness: 3, padding: 1,
		clone() { return makeStyle(); },
	};
}

const hooks = {};
let clickHandler = null;

globalThis.PIXI = {
	Container: StubContainer,
	BitmapText: StubBitmapText,
	BitmapFont: { available: {}, from(name) { this.available[name] = {}; }, uninstall() {} },
	TextMetrics: {
		measureText: () => ({ width: 10, height: 10, lineHeight: 13, fontProperties: { fontSize: 10 } }),
	},
	Rectangle: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } },
};
globalThis.game = {
	version: "13",
	settings: {
		get: (scope, key) => {
			if (scope === MODULE_ID && key === "sdxCoordsSettings") return { clickTimeout: 1 };
			throw new Error(`unregistered setting ${scope}.${key}`);
		},
		register() {}, registerMenu() {},
	},
	i18n: { localize: key => key },
	user: { isGM: true },
	keyboard: { isModifierActive: () => true },
};
globalThis.foundry = {
	utils: {
		mergeObject: (a, b) => Object.assign({}, a, b),
		// Foundry's own: a dotted key on the object, else the path walked.
		hasProperty(object, key) {
			if (!key || !object) return false;
			if (key in object) return true;
			let target = object;
			for (const part of key.split(".")) {
				if (!target || typeof target !== "object" || !(part in target)) return false;
				target = target[part];
			}
			return true;
		},
	},
	canvas: { containers: { PreciseText: StubText } },
	applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: B => B } },
};
globalThis.CONFIG = { canvasTextStyle: makeStyle() };
globalThis.Hooks = { on(event, fn) { hooks[event] = fn; }, once() {}, off() {} };
globalThis.document = { fonts: { load: () => Promise.resolve() } };
globalThis.window = globalThis;

const { initSDXCoords } = await import("../../scripts/hex/SDXCoordsSD.mjs");
initSDXCoords();

// --- a scene like The Gloaming ----------------------------------------------

const COLS = 18;
const ROWS = 13;

/**
 * game.shadowdarkEnhancer.hexMaps as 1.26.0 answers for the Gloaming: HEXEVENQ, 17 columns, the
 * first hex 0001 at Foundry (1, 0), raised columns 11 rows and lowered ones 10, one row of frame
 * above the print. `numbering.first` is the row number of Foundry row 1: 1 for 0001, 0 for 0000.
 */
function hexMapsStub(numbering = { first: 1 }) {
	const calls = [];
	return {
		calls,
		numbering,
		hasNumbering: scene => scene === canvas.scene,
		numberAt: ({ i, j }, scene) => {
			calls.push({ i, j });
			if (scene !== canvas.scene || i < 1 || i > (j % 2 ? 11 : 10) || j < 0 || j > 16) return null;
			return (j * 100) + (i - 1) + numbering.first;
		},
	};
}

/** A hex-column scene, 18 x 13 cells of 100 px, whose overlay is built by the canvasReady hook. */
async function useScene({ state = DISPLAY_STATES.ZINE, enhancer, layout, id = "scene-a" } = {}) {
	let sceneState = state;
	globalThis.game.shadowdarkEnhancer = enhancer;
	globalThis.window.SDXCoordinates = null;
	const rect = {
		x: 0, y: 0, left: 0, top: 0, right: COLS * 100, bottom: ROWS * 100,
		contains: (x, y) => x >= 0 && x < COLS * 100 && y >= 0 && y < ROWS * 100,
	};
	globalThis.canvas = {
		scene: {
			id,
			getFlag: (scope, key) => {
				if (scope !== MODULE_ID) return undefined;
				if (key === "sdxcoords-state") return sceneState;
				return key === "hexcrawl" && layout ? { grid: layout } : undefined;
			},
			setFlag: (scope, key, value) => { sceneState = value; return Promise.resolve(); },
		},
		controls: new StubContainer(),
		stage: {
			scale: { x: 1 },
			addListener: (event, fn) => { clickHandler = fn; },
		},
		grid: {
			isSquare: false, isHexagonal: true, columns: true, even: true,
			sizeX: 100, sizeY: 100,
			getOffset: ({ x, y }) => ({ i: Math.floor(y / 100), j: Math.floor(x / 100) }),
			getTopLeftPoint: ({ i, j }) => ({ x: j * 100, y: i * 100 }),
		},
		dimensions: { sceneRect: rect, size: 100, rows: ROWS, columns: COLS },
		mousePosition: { x: 0, y: 0 },
	};
	textsBuilt = [];
	await hooks.canvasReady();
	return globalThis.window.SDXCoordinates;
}

/** What the Zine set shows now: the axes with their positions, and the cell grid as text rows. */
function readZine() {
	const zine = canvas.controls.children[2];
	const texts = zine.children.filter(child => child instanceof StubText);
	const to2 = n => Math.round(n * 100) / 100;
	const at = t => `${t.label}@${to2(t._pos.x)},${to2(t._pos.y)}`;
	const cells = new Map();
	for (const column of zine.children.find(child => child instanceof StubContainer).children) {
		for (const t of column.children) {
			cells.set(`${Math.floor(t._pos.y / 100)},${Math.floor(t._pos.x / 100)}`, t.label);
		}
	}
	const rows = [];
	for (let i = 0; i < ROWS; i += 1) {
		const row = [];
		for (let j = 0; j < COLS; j += 1) row.push((cells.get(`${i},${j}`) ?? "--").padEnd(4));
		rows.push(row.join(" ").trimEnd());
	}
	return {
		top: texts.filter(t => t._pos.x >= 0).map(at),
		left: texts.filter(t => t._pos.x < 0).map(at),
		cells: rows,
		labelled: cells,
	};
}

/** The axis labels by column j or row i, keyed off where the label sits. */
const topAxis = zine => new Map(zine.top.map(s => [Math.floor(s.split("@")[1].split(",")[0] / 100), s.split("@")[0]]));
const leftAxis = zine => new Map(zine.left.map(s => [Math.floor(s.split("@")[1].split(",")[1] / 100), s.split("@")[0]]));

// --- what the untouched heuristic writes on this scene (read off 9700bd51) ---

const HEURISTIC = {
	top: [
		"000@225,3",
		"100@325,-25",
		"200@425,3",
		"300@525,-25",
		"400@625,3",
		"500@725,-25",
		"600@825,3",
		"700@925,-25",
		"800@1025,3",
		"900@1125,-25",
		"1000@1225,3",
		"1100@1325,-25",
		"1200@1425,3",
		"1300@1525,-25",
		"1400@1625,3",
		"1500@1725,-25",
	],
	left: [
		"01@-25,50",
		"02@-25,150",
		"03@-25,250",
		"04@-25,350",
		"05@-25,450",
		"06@-25,550",
		"07@-25,650",
		"08@-25,750",
		"09@-25,850",
		"10@-25,950",
		"11@-25,1050",
		"12@-25,1150",
		"13@-25,1250",
	],
	cells: [
		"--   --   000  --   200  --   400  --   600  --   800  --   1000 --   1200 --   1400 --",
		"--   --   001  101  201  301  401  501  601  701  801  901  1001 1101 1201 1301 1401 1501",
		"--   --   002  102  202  302  402  502  602  702  802  902  1002 1102 1202 1302 1402 1502",
		"--   --   003  103  203  303  403  503  603  703  803  903  1003 1103 1203 1303 1403 1503",
		"--   --   004  104  204  304  404  504  604  704  804  904  1004 1104 1204 1304 1404 1504",
		"--   --   005  105  205  305  405  505  605  705  805  905  1005 1105 1205 1305 1405 1505",
		"--   --   006  106  206  306  406  506  606  706  806  906  1006 1106 1206 1306 1406 1506",
		"--   --   007  107  207  307  407  507  607  707  807  907  1007 1107 1207 1307 1407 1507",
		"--   --   008  108  208  308  408  508  608  708  808  908  1008 1108 1208 1308 1408 1508",
		"--   --   009  109  209  309  409  509  609  709  809  909  1009 1109 1209 1309 1409 1509",
		"--   --   010  110  210  310  410  510  610  710  810  910  1010 1110 1210 1310 1410 1510",
		"--   --   011  111  211  311  411  511  611  711  811  911  1011 1111 1211 1311 1411 1511",
		"--   --   012  112  212  312  412  512  612  712  812  912  1012 1112 1212 1312 1412 1512",
	],
};

const assertHeuristic = zine => {
	assert.deepEqual({ top: zine.top, left: zine.left, cells: zine.cells }, HEURISTIC);
};

// --- the acceptance check ----------------------------------------------------

test("Zine cell labels are the Enhancer's numbers, by Foundry offset", async () => {
	await useScene({ enhancer: { hexMaps: hexMapsStub() } });
	const { labelled } = readZine();

	for (const [key, label] of Object.entries({
		"1,0": "001", "2,0": "002", "2,1": "102", "3,1": "103", "10,12": "1210", "11,1": "111",
	})) assert.equal(labelled.get(key), label, `(${key})`);
	for (const key of ["0,0", "0,1", "1,17", "11,12"]) {
		assert.equal(labelled.has(key), false, `no label on the frame cell (${key})`);
	}
	// 9 lowered columns of 10 rows and 8 raised ones of 11: the frame gets nothing anywhere.
	assert.equal(labelled.size, (9 * 10) + (8 * 11));
});

test("the whole Zine grid matches the Tagger's, frame cells empty", async () => {
	await useScene({ enhancer: { hexMaps: hexMapsStub() } });

	assert.deepEqual(readZine().cells, [
		"--   --   --   --   --   --   --   --   --   --   --   --   --   --   --   --   --   --",
		"001  101  201  301  401  501  601  701  801  901  1001 1101 1201 1301 1401 1501 1601 --",
		"002  102  202  302  402  502  602  702  802  902  1002 1102 1202 1302 1402 1502 1602 --",
		"003  103  203  303  403  503  603  703  803  903  1003 1103 1203 1303 1403 1503 1603 --",
		"004  104  204  304  404  504  604  704  804  904  1004 1104 1204 1304 1404 1504 1604 --",
		"005  105  205  305  405  505  605  705  805  905  1005 1105 1205 1305 1405 1505 1605 --",
		"006  106  206  306  406  506  606  706  806  906  1006 1106 1206 1306 1406 1506 1606 --",
		"007  107  207  307  407  507  607  707  807  907  1007 1107 1207 1307 1407 1507 1607 --",
		"008  108  208  308  408  508  608  708  808  908  1008 1108 1208 1308 1408 1508 1608 --",
		"009  109  209  309  409  509  609  709  809  909  1009 1109 1209 1309 1409 1509 1609 --",
		"010  110  210  310  410  510  610  710  810  910  1010 1110 1210 1310 1410 1510 1610 --",
		"--   111  --   311  --   511  --   711  --   911  --   1111 --   1311 --   1511 --   --",
		"--   --   --   --   --   --   --   --   --   --   --   --   --   --   --   --   --   --",
	]);
});

test("the left and top axes come from the same numbers", async () => {
	await useScene({ enhancer: { hexMaps: hexMapsStub() } });
	const zine = readZine();

	assert.deepEqual([...topAxis(zine)], Array.from({ length: 17 }, (_, j) => [j, String(j * 100).padStart(3, "0")]),
		"000 to 1600 over Foundry columns 0 to 16, none over the frame column 17");
	assert.deepEqual([...leftAxis(zine)], Array.from({ length: 11 }, (_, k) => [k + 1, String(k + 1).padStart(2, "0")]),
		"01 to 11 beside Foundry rows 1 to 11, none beside the frame rows 0 and 12");
	assert.ok(zine.top.every(s => s.endsWith(",-25")), "over their own columns, not staggered like the guessed axes");
});

test("the modifier-click label is the Enhancer's number, and nothing over the frame", async () => {
	const enhancer = { hexMaps: hexMapsStub() };
	await useScene({ enhancer });
	const click = (x, y) => {
		canvas.mousePosition = { x, y };
		textsBuilt = [];
		clickHandler({});
		return textsBuilt.map(t => t.label);
	};

	assert.deepEqual(click(150, 250), ["102"], "the castle hex, (i: 2, j: 1)");
	assert.deepEqual(click(1250, 1050), ["1210"]);
	assert.deepEqual(click(50, 50), [], "(0, 0) is frame");
	assert.deepEqual(click(1250, 1150), [], "(11, 12) is off the lowered column");
});

// --- the anchor moves ----------------------------------------------------------

const anchorMoved = { flags: { "shadowdark-enhancer": { hexTags: { origin: { num: "0000" } } } } };

test("moving the anchor rebuilds the Zine labels: the castle reads 101 with no reload", async () => {
	const hexMaps = hexMapsStub();
	await useScene({ enhancer: { hexMaps } });
	assert.equal(readZine().labelled.get("2,1"), "102");
	const before = textsBuilt.filter(t => !t.destroyed);

	hexMaps.numbering.first = 0; // the Tagger's Anchor hex box, then Apply
	hooks.updateScene(canvas.scene, anchorMoved);

	const zine = readZine();
	assert.equal(zine.labelled.get("2,1"), "101");
	assert.equal(zine.labelled.get("1,0"), "000");
	assert.equal(zine.labelled.size, (9 * 10) + (8 * 11), "no cell drawn twice or left behind");
	assert.ok(before.every(t => t.destroyed), "the old labels are destroyed, not stacked under the new");
	assert.equal(canvas.controls.children[2].visible, true, "and the Zine set stays on show");
});

test("only a change to the viewed scene's anchor rebuilds", async () => {
	const hexMaps = hexMapsStub();
	await useScene({ enhancer: { hexMaps } });
	hexMaps.numbering.first = 0;
	const built = textsBuilt.length;

	hooks.updateScene({ id: "scene-b" }, anchorMoved);
	hooks.updateScene(canvas.scene, { flags: { "shadowdark-enhancer": { hexTags: { cells: { 1403: {} } } } } });
	hooks.updateScene(canvas.scene, { flags: { [MODULE_ID]: { "sdxcoords-state": 4 } }, name: "The Gloaming" });
	hooks.updateScene(canvas.scene, {});

	assert.equal(textsBuilt.length, built, "nothing rebuilt");
	assert.equal(readZine().labelled.get("2,1"), "102", "still what was built");

	hooks.updateScene(canvas.scene, { "flags.shadowdark-enhancer.hexTags.origin": { num: "0000" } });
	assert.equal(readZine().labelled.get("2,1"), "101", "a dotted key is a change to the anchor too");
});

test("a Zine set not built yet reads the numbering when it is; one not showing waits to be shown", async () => {
	const hexMaps = hexMapsStub();
	const coords = await useScene({ state: DISPLAY_STATES.HIDDEN, enhancer: { hexMaps } });
	hexMaps.numbering.first = 0;
	hooks.updateScene(canvas.scene, anchorMoved);
	assert.equal(textsBuilt.length, 0, "nothing was built, so nothing is rebuilt");

	coords._applyState(DISPLAY_STATES.ZINE);
	assert.equal(readZine().labelled.get("2,1"), "101");

	coords._applyState(DISPLAY_STATES.HIDDEN);
	hexMaps.numbering.first = 1;
	hooks.updateScene(canvas.scene, anchorMoved);
	const zineContainer = canvas.controls.children[2];
	assert.deepEqual([zineContainer.children.length, zineContainer.visible], [0, false],
		"a Zine set that is hidden is cleared, not drawn");
	coords._applyState(DISPLAY_STATES.ZINE);
	assert.equal(readZine().labelled.get("2,1"), "102");
});

// --- everything that must stay as it is ------------------------------------------

test("with no Enhancer the Zine labels are exactly what they were", async () => {
	await useScene({ enhancer: undefined });
	assertHeuristic(readZine());
});

test("with an Enhancer older than 1.26.0 the Zine labels are exactly what they were", async () => {
	await useScene({ enhancer: { hexMaps: { openTagger() {} } } });
	assertHeuristic(readZine());
	await useScene({ enhancer: {} });
	assertHeuristic(readZine());
});

test("a scene the Enhancer has not numbered keeps the guessed Zine labels", async () => {
	const hexMaps = { ...hexMapsStub(), hasNumbering: () => false };
	await useScene({ enhancer: { hexMaps } });

	assertHeuristic(readZine());
	assert.equal(hexMaps.calls.length, 0, "numberAt is never asked");
});

test("a scene with a published layout is labelled from it, and the Enhancer is not asked", async () => {
	const hexMaps = hexMapsStub();
	const layout = { cols: 17, rows: 11, landscape: false, flipX: false, flipY: false, origin: 1 };
	await useScene({ enhancer: { hexMaps }, layout });
	const zine = readZine();

	assert.equal(zine.labelled.get("2,1"), "203", "column j + 1, row i + 1");
	assert.equal(topAxis(zine).get(0), "100");
	assert.equal(leftAxis(zine).get(0), "01");
	assert.equal(hexMaps.calls.length, 0);

	hooks.updateScene(canvas.scene, anchorMoved);
	assert.equal(readZine().labelled.get("2,1"), "203", "a rebuild keeps the published layout");
	assert.equal(hexMaps.calls.length, 0);
});

test("the lettered styles ignore the Enhancer", async () => {
	for (const state of [DISPLAY_STATES.MARGIN, DISPLAY_STATES.CELL]) {
		await useScene({ state, enhancer: undefined });
		const without = canvas.controls.children.map(c => c.children.map(t => t.label ?? t.children?.map(x => x.label)));
		const hexMaps = hexMapsStub();
		await useScene({ state, enhancer: { hexMaps } });
		const withIt = canvas.controls.children.map(c => c.children.map(t => t.label ?? t.children?.map(x => x.label)));

		assert.deepEqual(withIt, without);
		assert.equal(hexMaps.calls.length, 0);
	}
});
