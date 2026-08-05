// Characterization tests for hex coordinate labelling, scripts/hex/SDXCoordsSD.mjs.
// Sweep 6, written before anything moves.
//
// formatHexCoord turns a grid offset {i, j} into the label the coordinate
// overlay shows — "A1", "0101", "AA12". Between those two ends sit the hex-grid
// quirk adjustments: whether the grid is even or odd, row-major or column-major,
// and whether a given column starts with a half hex. Those branches are the
// reason this function is worth pinning. They are four lines of arithmetic that
// look arbitrary, they are exercised only against real Foundry grids, and
// nothing in the repository tested them until now.
//
// The plan (§8.3) asks for "hex axial/offset conversions and round trips". This
// is that surface as the codebase actually expresses it.

import assert from "node:assert/strict";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";

let settings = {};
globalThis.game = {
	settings: {
		get: (scope, key) => {
			if (scope === MODULE_ID && key === "sdxCoordsSettings") return settings;
			throw new Error(`unregistered setting ${scope}.${key}`);
		},
		register() {},
		registerMenu() {},
	},
	i18n: { localize: key => key },
	user: { isGM: true },
};
globalThis.foundry = {
	utils: {
		mergeObject: (a, b) => Object.assign({}, a, b),
	},
	applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: B => B } },
};
globalThis.Hooks = { on() {}, once() {}, off() {} };
globalThis.canvas = null;

const { formatHexCoord } = await import("../../scripts/hex/SDXCoordsSD.mjs");

/**
 * Install a grid whose top-left scene corner sits at offset {i:0, j:0}, so a
 * label reflects the offset passed in rather than an arbitrary scene origin.
 */
function useGrid({ hexagonal = true, columns = false, even = false,
	rows = 20, cols = 20, topLeft = { i: 0, j: 0 } } = {}) {
	globalThis.canvas = {
		grid: {
			isHexagonal: hexagonal,
			columns,
			even,
			getOffset: () => topLeft,
		},
		dimensions: {
			sceneRect: { left: 0, top: 0 },
			rows,
			columns: cols,
		},
	};
}

// --- no grid ----------------------------------------------------------------

test("with no canvas at all the raw offset is returned, dotted", () => {
	globalThis.canvas = null;
	settings = {};

	assert.equal(formatHexCoord({ i: 3, j: 7 }), "3.7");
});

// --- the default label shape ------------------------------------------------

test("the default is a letter column and a number row, one-based", () => {
	useGrid();
	settings = {};

	// xValue "let", yValue "num" are the shipped defaults.
	assert.equal(formatHexCoord({ i: 0, j: 0 }), "A1");
	assert.equal(formatHexCoord({ i: 1, j: 0 }), "A2");
	assert.equal(formatHexCoord({ i: 0, j: 1 }), "B1");
	assert.equal(formatHexCoord({ i: 4, j: 2 }), "C5");
});

test("both axes can be numbers, or both letters", () => {
	useGrid();

	settings = { xValue: "num", yValue: "num" };
	assert.equal(formatHexCoord({ i: 0, j: 0 }), "11");
	assert.equal(formatHexCoord({ i: 2, j: 3 }), "43");

	settings = { xValue: "let", yValue: "let" };
	assert.equal(formatHexCoord({ i: 0, j: 0 }), "AA");
	assert.equal(formatHexCoord({ i: 1, j: 2 }), "CB");
});

test("columns past Z carry into two letters", () => {
	useGrid({ cols: 60 });
	settings = { xValue: "let", yValue: "num" };

	assert.equal(formatHexCoord({ i: 0, j: 25 }), "Z1");
	assert.equal(formatHexCoord({ i: 0, j: 26 }), "AA1");
	assert.equal(formatHexCoord({ i: 0, j: 27 }), "AB1");
	assert.equal(formatHexCoord({ i: 0, j: 51 }), "AZ1");
	assert.equal(formatHexCoord({ i: 0, j: 52 }), "BA1");
});

// --- zero padding -----------------------------------------------------------

test("leading zeroes pad numeric labels to the width of the larger axis", () => {
	useGrid({ rows: 20, cols: 120 });
	settings = { xValue: "num", yValue: "num", leadingZeroes: true };

	// max(120, 20) is three digits wide.
	assert.equal(formatHexCoord({ i: 0, j: 0 }), "001001");
	assert.equal(formatHexCoord({ i: 9, j: 9 }), "010010");
});

test("padding is off by default, so short labels stay short", () => {
	useGrid({ rows: 20, cols: 120 });
	settings = { xValue: "num", yValue: "num" };

	assert.equal(formatHexCoord({ i: 0, j: 0 }), "11");
});

test("letters are never padded, only numbers", () => {
	useGrid({ rows: 20, cols: 120 });
	settings = { xValue: "let", yValue: "num", leadingZeroes: true };

	assert.equal(formatHexCoord({ i: 0, j: 0 }), "A001");
});

// --- the scene origin -------------------------------------------------------

// Labels are relative to the scene rectangle's top-left cell, not to the
// absolute grid, so a scene padded inside a larger canvas still starts at A1.
test("labels are relative to the scene's top-left cell", () => {
	useGrid({ topLeft: { i: 5, j: 3 } });
	settings = { xValue: "num", yValue: "num" };

	assert.equal(formatHexCoord({ i: 5, j: 3 }), "11", "the origin cell is 1,1");
	assert.equal(formatHexCoord({ i: 6, j: 4 }), "22");
});

// --- hex grid quirks --------------------------------------------------------
//
// These four adjustments exist because Foundry's offset for a hex grid does not
// line up with what a reader counts on the map. Each is pinned separately.

test("an even row-major hex grid shifts rows up by one", () => {
	settings = { xValue: "num", yValue: "num" };

	useGrid({ hexagonal: true, columns: false, even: false });
	const odd = formatHexCoord({ i: 3, j: 0 });

	useGrid({ hexagonal: true, columns: false, even: true });
	const even = formatHexCoord({ i: 3, j: 0 });

	assert.equal(odd, "14");
	assert.equal(even, "13", "the even grid reads one row lower");
});

// On a column-major grid every other column begins with a half hex, and which
// parity that is flips with even/odd.
test("a column-major grid shifts alternating columns, and the parity flips with even", () => {
	settings = { xValue: "num", yValue: "num" };

	useGrid({ hexagonal: true, columns: true, even: false });
	const oddGrid = [0, 1, 2, 3].map(j => formatHexCoord({ i: 4, j }));

	useGrid({ hexagonal: true, columns: true, even: true });
	const evenGrid = [0, 1, 2, 3].map(j => formatHexCoord({ i: 4, j }));

	// The half hex sits on even j for an odd grid and on odd j for an even one,
	// so the row label alternates down-one along the columns.
	assert.deepEqual(oddGrid, ["14", "25", "34", "45"]);
	assert.deepEqual(evenGrid, ["05", "14", "25", "34"]);
});

// Recorded, not judged. On an even column-major grid the extra `adjCol - 1`
// step makes the scene's first column read 0 rather than 1, so the top-left
// cell is "05" above rather than "15". That may be correct — on such a grid the
// first column is a half column that sits outside the scene rectangle — or it
// may be off by one. Deciding needs a real map and the owner's eye, so it is
// pinned as-is and left for the live matrix rather than changed inside a
// structural sweep.
test("an even column-major grid numbers its first column from zero", () => {
	settings = { xValue: "num", yValue: "num" };
	useGrid({ hexagonal: true, columns: true, even: true });

	assert.equal(formatHexCoord({ i: 0, j: 0 }).charAt(0), "0");
});

test("a square grid takes none of the hex adjustments", () => {
	settings = { xValue: "num", yValue: "num" };

	useGrid({ hexagonal: false, columns: true, even: true });

	assert.equal(formatHexCoord({ i: 3, j: 2 }), "34", "row and column pass through unshifted");
});

// A lettered column on a column-major hex grid takes one further step back, so
// the first column reads A rather than B.
test("a lettered column on a column-major hex grid starts at A", () => {
	settings = { xValue: "let", yValue: "num" };

	useGrid({ hexagonal: true, columns: true, even: false });
	assert.equal(formatHexCoord({ i: 0, j: 1 }), "A1");

	useGrid({ hexagonal: true, columns: false, even: false });
	assert.equal(formatHexCoord({ i: 0, j: 1 }), "B1", "row-major keeps B for the second column");
});

// --- stability --------------------------------------------------------------

test("the same offset and grid always give the same label", () => {
	useGrid({ hexagonal: true, columns: true, even: true });
	settings = { xValue: "let", yValue: "num", leadingZeroes: true };

	const once = formatHexCoord({ i: 7, j: 5 });
	const twice = formatHexCoord({ i: 7, j: 5 });

	assert.equal(once, twice);
});

test("distinct cells get distinct labels across a whole grid", () => {
	useGrid({ hexagonal: true, columns: false, even: false, rows: 12, cols: 12 });
	settings = { xValue: "let", yValue: "num" };

	const seen = new Map();
	for (let i = 0; i < 12; i++) {
		for (let j = 0; j < 12; j++) {
			const label = formatHexCoord({ i, j });
			assert.ok(!seen.has(label), `${label} is reused by ${seen.get(label)} and ${i},${j}`);
			seen.set(label, `${i},${j}`);
		}
	}
	assert.equal(seen.size, 144);
});

// A settings read that throws must not take the overlay down with it.
test("unreadable settings fall back to the defaults", () => {
	useGrid();
	const saved = globalThis.game.settings.get;
	globalThis.game.settings.get = () => {
		throw new Error("not registered yet");
	};
	try {
		assert.equal(formatHexCoord({ i: 0, j: 0 }), "A1", "the shipped default shape");
	}
	finally {
		globalThis.game.settings.get = saved;
	}
});
