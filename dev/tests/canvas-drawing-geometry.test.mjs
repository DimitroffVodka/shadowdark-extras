// Characterization tests for SDXDrawingTool's geometry, captured BEFORE it is
// extracted out of scripts/canvas/SDXDrawingTool.mjs.
//
// SDXDrawingTool is 2000+ lines and the only file in the repo still over the
// 2000-line split threshold. The geometry inside it — line/box/ellipse stroke
// styles, stamp shapes, the hex-cluster outline, colour parsing — is pure
// computation that draws through the PIXI.Graphics it is handed, so it can be
// asserted as a command sequence and moved with evidence.

import assert from "node:assert/strict";
import test from "node:test";

import { installCanvasGlobals, makeRecordingGraphics } from "./helpers/pixi-harness.mjs";

installCanvasGlobals();
// The hex outline reads grid metrics off the canvas; give it a known grid.
globalThis.canvas.grid = { size: 100, columns: false };
globalThis.canvas.dimensions = { size: 100 };

const { sdxDrawingTool: tool } = await import("../../scripts/canvas/SDXDrawingTool.mjs");

const g = () => makeRecordingGraphics();

// --- colour parsing ---------------------------------------------------------

test("a numeric colour passes straight through", () => {
	assert.equal(tool._cssToPixi(0xABCDEF), 0xABCDEF);
});

test("hex strings are parsed to their numeric value", () => {
	assert.equal(tool._cssToPixi("#ff0000"), 0xFF0000);
	assert.equal(tool._cssToPixi("#000000"), 0x000000);
	assert.equal(tool._cssToPixi("#0000ff"), 0x0000FF);
});

test("rgb() and rgba() are packed into a single integer", () => {
	assert.equal(tool._cssToPixi("rgb(255, 0, 0)"), 0xFF0000);
	assert.equal(tool._cssToPixi("rgba(0, 255, 0, 0.5)"), 0x00FF00);
	assert.equal(tool._cssToPixi("rgb(18,52,86)"), 0x123456);
});

test("anything unparseable falls back to black", () => {
	assert.equal(tool._cssToPixi("goldenrod"), 0x000000);
	assert.equal(tool._cssToPixi(""), 0x000000);
	assert.equal(tool._cssToPixi(null), 0x000000);
	assert.equal(tool._cssToPixi({}), 0x000000);
});

// --- stroke styles ----------------------------------------------------------

const LINE = [[0, 0], [100, 0]];

test("an empty point list draws nothing at all", () => {
	const rec = g();
	tool._drawLineWithStyle(rec, [], 0, 0, 4, 0xFF0000, 1, "solid");
	assert.deepEqual(rec.ops, []);

	tool._drawLineWithStyle(rec, null, 0, 0, 4, 0xFF0000, 1, "solid");
	assert.deepEqual(rec.ops, [], "a null list must not throw either");
});

test("a solid stroke is one moveTo followed by a lineTo per point", () => {
	const rec = g();
	tool._drawLineWithStyle(rec, [[0, 0], [10, 0], [20, 5]], 3, 7, 4, 0xFF0000, 1, "solid");

	assert.deepEqual(rec.ops, [
		["lineStyle", 4, 0xFF0000, 1],
		["moveTo", 3, 7],
		["lineTo", 13, 7],
		["lineTo", 23, 12],
	]);
});

test("points are offset by the start coordinates, not used raw", () => {
	const rec = g();
	tool._drawLineWithStyle(rec, [[0, 0], [10, 10]], 100, 200, 4, 0, 1, "solid");

	assert.deepEqual(rec.of("moveTo")[0], ["moveTo", 100, 200]);
	assert.deepEqual(rec.of("lineTo")[0], ["lineTo", 110, 210]);
});

test("a dotted stroke lays filled dots along the path", () => {
	const rec = g();
	tool._drawLineWithStyle(rec, LINE, 0, 0, 4, 0xFF0000, 1, "dotted");

	// Spacing is strokeWidth*4 = 16 over a 100px run => 7 dots (0,16,...,96).
	assert.equal(rec.count("drawCircle"), 7);
	assert.equal(rec.count("beginFill"), 7);
	assert.equal(rec.count("endFill"), 7);
	assert.equal(rec.count("lineTo"), 0);
	// Dot radius is strokeWidth*0.4, and the first sits on the start point.
	assert.deepEqual(rec.of("drawCircle")[0], ["drawCircle", 0, 0, 1.6]);
});

test("dot spacing and radius scale with the stroke width", () => {
	const thin = g();
	const thick = g();
	tool._drawLineWithStyle(thin, LINE, 0, 0, 2, 0, 1, "dotted");
	tool._drawLineWithStyle(thick, LINE, 0, 0, 8, 0, 1, "dotted");

	assert.ok(thick.count("drawCircle") < thin.count("drawCircle"), "wider strokes space dots further");
	assert.equal(thin.of("drawCircle")[0][3], 0.8);
	assert.equal(thick.of("drawCircle")[0][3], 3.2);
});

test("a dashed stroke emits stroked segments, not dots", () => {
	const rec = g();
	tool._drawLineWithStyle(rec, LINE, 0, 0, 4, 0xFF0000, 1, "dashed");

	assert.ok(rec.count("lineTo") > 0);
	assert.equal(rec.count("drawCircle"), 0);
	assert.equal(rec.count("moveTo"), rec.count("lineTo"), "each dash is a moveTo/lineTo pair");
});

test("zero-length segments are skipped rather than dividing by zero", () => {
	const rec = g();
	// A repeated point would produce dist 0.
	tool._drawLineWithStyle(rec, [[0, 0], [0, 0], [50, 0]], 0, 0, 4, 0, 1, "dotted");

	assert.ok(rec.count("drawCircle") > 0);
	assert.ok(rec.ops.every(op => op.every(v => typeof v !== "number" || Number.isFinite(v))),
		"no NaN reached the graphics");
});

// --- box and ellipse --------------------------------------------------------

test("a solid box is a single drawRect primitive", () => {
	const rec = g();
	tool._drawBoxWithStyle(rec, 10, 20, 100, 50, "solid");

	assert.deepEqual(rec.ops, [["drawRect", 10, 20, 100, 50]]);
});

test("a patterned box decomposes into four separately stroked edges", () => {
	const rec = g();
	tool.state.brushSettings = { size: 4, color: "#ff0000" };
	tool._drawBoxWithStyle(rec, 10, 20, 100, 50, "dashed");

	assert.equal(rec.count("drawRect"), 0);
	// Four edges, each opening with its own lineStyle.
	assert.equal(rec.count("lineStyle"), 4);
});

test("patterned box edges honour the active brush colour and width", () => {
	const rec = g();
	tool.state.brushSettings = { size: 9, color: "#00ff00" };
	tool._drawBoxWithStyle(rec, 0, 0, 10, 10, "dashed");

	assert.deepEqual(rec.of("lineStyle")[0], ["lineStyle", 9, 0x00FF00, 1]);
});

test("a solid ellipse is a single drawEllipse centred on the rect", () => {
	const rec = g();
	tool._drawEllipseWithStyle(rec, 0, 0, 100, 60, "solid");

	// Centre plus half-extents, taken from the bounding rectangle.
	assert.deepEqual(rec.ops, [["drawEllipse", 50, 30, 50, 30]]);
});

test("a patterned ellipse is approximated by 48 stroked segments", () => {
	const rec = g();
	tool.state.brushSettings = { size: 4, color: "#ff0000" };
	tool._drawEllipseWithStyle(rec, 0, 0, 100, 60, "dashed");

	assert.equal(rec.count("lineStyle"), 48);
});

// --- hex cluster outline ----------------------------------------------------

// The tier is a stamp size name, not a number. Anything unrecognised falls
// through to the single centre hex.
test("a small cluster outline is a closed ring of coordinates", () => {
	const path = tool._getHexClusterOutline("small", 0, 0);

	assert.ok(Array.isArray(path));
	assert.equal(path.length / 2, 7, "six hex corners plus the closing point");
	assert.equal(path.length % 2, 0, "coordinates come in pairs");
	assert.ok(path.every(Number.isFinite), "no NaN in the outline");
});

test("an unrecognised tier draws the single centre hex", () => {
	assert.deepEqual(
		tool._getHexClusterOutline("nonsense", 0, 0),
		tool._getHexClusterOutline("small", 0, 0),
	);
});

// medium adds a 6-hex ring and large a further 12. Cancelling the edges each
// pair of hexes shares reduces the flower's 42 hex edges to an 18-edge
// boundary, and the 19-hex cluster's 114 to 30. Each walks into a closed ring
// of that many corners, plus the start corner repeated to close the path.
test("medium and large clusters stitch into closed rings", () => {
	const rings = [
		["medium", tool._getHexClusterOutline("medium", 0, 0), 18],
		["large", tool._getHexClusterOutline("large", 0, 0), 30],
	];

	for (const [tier, path, corners] of rings) {
		assert.ok(Array.isArray(path), `${tier} produces an outline`);
		assert.equal(path.length % 2, 0, `${tier} coordinates come in pairs`);
		assert.equal(path.length / 2, corners + 1, `${tier} boundary plus its closing point`);
		assert.ok(path.every(Number.isFinite), `no NaN in the ${tier} outline`);
		assert.equal(path[0], path[path.length - 2], `${tier} ring closes in x`);
		assert.equal(path[1], path[path.length - 1], `${tier} ring closes in y`);
	}
});

test("each tier spans further than the one below it", () => {
	const extent = path => {
		const xs = path.filter((_, i) => i % 2 === 0);
		const ys = path.filter((_, i) => i % 2 === 1);
		return Math.max(
			Math.max(...xs) - Math.min(...xs),
			Math.max(...ys) - Math.min(...ys),
		);
	};

	const small = extent(tool._getHexClusterOutline("small", 0, 0));
	const medium = extent(tool._getHexClusterOutline("medium", 0, 0));
	const large = extent(tool._getHexClusterOutline("large", 0, 0));

	assert.ok(medium > small, `medium (${medium}) must span more than small (${small})`);
	assert.ok(large > medium, `large (${large}) must span more than medium (${medium})`);
});

// The regression this replaces: a corner shared by two hexes was quantised to
// a 0.5px lattice independently for each hex, and at centre (0, 0) the shared
// y lands on 57.75 — exactly a rounding tie. The two copies differed by a few
// ULPs, tipped either side of it, and read as two separate corners, so the
// interior edges between them stopped cancelling and leaked into the boundary
// set. The stitcher then walked one spurious edge, came straight back to where
// it started, and returned a 3-point path that the caller discarded. Which
// corners cancel must not depend on where the cluster is centred.
test("the cluster outline does not depend on where it is centred", () => {
	for (const tier of ["small", "medium", "large"]) {
		const atOrigin = tool._getHexClusterOutline(tier, 0, 0);

		for (const [cx, cy] of [[500, 500], [-320, 140], [37, -991]]) {
			const moved = tool._getHexClusterOutline(tier, cx, cy);
			assert.ok(moved, `${tier} produces an outline at (${cx}, ${cy})`);
			assert.equal(
				moved.length, atOrigin.length,
				`${tier} keeps its corner count at (${cx}, ${cy})`,
			);
		}
	}
});

// The code's own comments note the columns/type detection reads inverted from
// its naming. Frozen as-is: the two orientations must simply differ.
test("grid orientation changes the outline", () => {
	globalThis.canvas.grid = { size: 100, columns: false };
	const flat = tool._getHexClusterOutline("small", 0, 0);

	globalThis.canvas.grid = { size: 100, columns: true };
	const pointy = tool._getHexClusterOutline("small", 0, 0);

	assert.notDeepEqual(flat, pointy);
	globalThis.canvas.grid = { size: 100, columns: false };
});

test("a v11-style grid.type is understood when columns is absent", () => {
	globalThis.canvas.grid = { size: 100, type: 2 };
	const columnar = tool._getHexClusterOutline("small", 0, 0);

	globalThis.canvas.grid = { size: 100, type: 4 };
	const rows = tool._getHexClusterOutline("small", 0, 0);

	assert.notDeepEqual(columnar, rows);
	globalThis.canvas.grid = { size: 100, columns: false };
});

test("the outline is centred on the point it is given", () => {
	const atOrigin = tool._getHexClusterOutline("small", 0, 0);
	const offset = tool._getHexClusterOutline("small", 500, 300);

	const dx = offset[0] - atOrigin[0];
	const dy = offset[1] - atOrigin[1];
	assert.equal(dx, 500);
	assert.equal(dy, 300);
});

test("grid size scales the outline", () => {
	globalThis.canvas.grid = { size: 100, columns: false };
	const small = tool._getHexClusterOutline("small", 0, 0);

	globalThis.canvas.grid = { size: 200, columns: false };
	const large = tool._getHexClusterOutline("small", 0, 0);

	assert.ok(Math.abs(large[0]) > Math.abs(small[0]));
	globalThis.canvas.grid = { size: 100, columns: false };
});
