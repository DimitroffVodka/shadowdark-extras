// Characterization tests for SDXDrawingTool, captured BEFORE it is split.
//
// The tool is 1,672 lines across ninety mostly-small methods, so unlike the
// sheets there is no one giant method to slice. What has to be pinned instead
// is the behaviour of the clusters that are about to move: the shape drawing
// lifecycle, the remote-drawing dispatch, and the drawing-entry bookkeeping
// that the toolbar's list is built from.
//
// Its geometry already moved to drawing-geometry.mjs and is covered by
// canvas-drawing-geometry.test.mjs; nothing here repeats that.

import assert from "node:assert/strict";
import test from "node:test";

import { installCanvasGlobals, makeRecordingGraphics, StubContainer } from "./helpers/pixi-harness.mjs";

const MODULE_ID = "shadowdark-extras";

const harness = installCanvasGlobals();
globalThis.canvas.grid = { size: 100, columns: false };
globalThis.canvas.dimensions = { size: 100 };

let settings = new Map();
globalThis.game.settings = {
	get: (scope, key) => {
		if (!settings.has(key)) throw new Error(`unregistered setting ${scope}.${key}`);
		return settings.get(key);
	},
};

const { sdxDrawingTool: tool } = await import("../../scripts/canvas/SDXDrawingTool.mjs");

/** Put the tool back to a known state between tests. */
function reset() {
	tool._pixiDrawings = [];
	tool._permanentDrawings = [];
	tool._previewGraphics = null;
	tool._previewSymbol = null;
	tool._resetDrawingState();
	tool.state.timedEraseEnabled = false;
	settings = new Map();
	globalThis.game.user = { id: "user-1", isGM: true, color: null, name: "GM" };
}

// --- who may draw -----------------------------------------------------------

test("a GM may always draw, even with the player setting off", () => {
	reset();
	settings = new Map([["drawing.enablePlayerDrawing", false]]);

	assert.equal(tool._canDraw(), true);
});

test("a player draws only when the setting allows it", () => {
	reset();
	globalThis.game.user = { id: "user-2", isGM: false };

	settings = new Map([["drawing.enablePlayerDrawing", true]]);
	assert.equal(tool._canDraw(), true);

	settings = new Map([["drawing.enablePlayerDrawing", false]]);
	assert.equal(tool._canDraw(), false);
});

// The setting is read through a try/catch because the tool can be reached
// before its settings are registered.
test("an unregistered setting is treated as permission granted", () => {
	reset();
	globalThis.game.user = { id: "user-2", isGM: false };
	settings = new Map();

	assert.equal(tool._canDraw(), true);
});

// --- the player's colour ----------------------------------------------------

test("a user colour is read as rgba whichever shape Foundry hands it in", () => {
	reset();

	globalThis.game.user.color = "#ff8000";
	assert.equal(tool._getPlayerColor(), "rgba(255, 128, 0, 1.0)", "a hex string");

	globalThis.game.user.color = 0x0080ff;
	assert.equal(tool._getPlayerColor(), "rgba(0, 128, 255, 1.0)", "a packed number");

	class Color {
		valueOf() {
			return 0x00ff00;
		}
	}
	globalThis.game.user.color = new Color();
	assert.equal(tool._getPlayerColor(), "rgba(0, 255, 0, 1.0)", "a v12 Color instance");
});

test("no colour, or one in an unrecognised shape, falls back to black", () => {
	reset();

	globalThis.game.user.color = null;
	assert.equal(tool._getPlayerColor(), "rgba(0, 0, 0, 1.0)");

	globalThis.game.user.color = "not-a-colour";
	assert.equal(tool._getPlayerColor(), "rgba(0, 0, 0, 1.0)", "a string with no leading #");
});

// --- expiry -----------------------------------------------------------------

test("nothing expires while timed erase is off", () => {
	reset();
	settings = new Map([["drawing.timedEraseTimeout", 30]]);

	assert.equal(tool._getExpiration(), null);
});

test("timed erase stamps an expiry the configured number of seconds out", () => {
	reset();
	tool.state.timedEraseEnabled = true;
	settings = new Map([["drawing.timedEraseTimeout", 45]]);
	const before = Date.now();

	const expiry = tool._getExpiration();

	assert.ok(expiry >= before + 45000, `expiry ${expiry} is at least 45s out`);
	assert.ok(expiry <= Date.now() + 45000);
});

test("a zero timeout means no expiry rather than an immediate one", () => {
	reset();
	tool.state.timedEraseEnabled = true;
	settings = new Map([["drawing.timedEraseTimeout", 0]]);

	assert.equal(tool._getExpiration(), null);
});

test("an unregistered timeout falls back to thirty seconds", () => {
	reset();
	tool.state.timedEraseEnabled = true;
	settings = new Map();
	const before = Date.now();

	assert.ok(tool._getExpiration() >= before + 30000);
});

// --- drawing state ----------------------------------------------------------

test("resetting clears every in-progress anchor, not just the flag", () => {
	reset();
	Object.assign(tool.state, {
		isDrawing: true,
		drawingPoints: [[1, 2]],
		drawingStartPoint: { x: 1, y: 2 },
		boxStartPoint: { x: 3, y: 4 },
		ellipseStartPoint: { x: 5, y: 6 },
		lineStartPoint: { x: 7, y: 8 },
		lastMousePosition: { x: 9, y: 10 },
	});

	tool._resetDrawingState();

	assert.deepEqual(tool.state, {
		...tool.state,
		isDrawing: false,
		drawingPoints: [],
		drawingStartPoint: null,
		boxStartPoint: null,
		ellipseStartPoint: null,
		lineStartPoint: null,
		lastMousePosition: null,
	});
});

test("the settings setters write through to the drawing state", () => {
	reset();

	tool.setDrawingMode("box");
	tool.setStampStyle("arrow");
	tool.setSymbolSize("large");
	tool.setLineStyle("dashed");
	tool.setBrushSize(9);
	tool.setBrushColor("#123456");
	tool.setPermanentMode(true);
	tool.setOpacity(0.4);

	assert.equal(tool.state.drawingMode, "box");
	assert.equal(tool.state.stampStyle, "arrow");
	assert.equal(tool.state.symbolSize, "large");
	assert.equal(tool.state.lineStyle, "dashed");
	assert.equal(tool.state.brushSettings.size, 9);
	assert.equal(tool.state.brushSettings.color, "#123456");
	assert.equal(tool.state.permanentMode, true);
	assert.equal(tool.state.opacity, 0.4);
});

// --- entry type inference ---------------------------------------------------

// The drawing list has to label entries that came from four different eras of
// this code, so the type is recovered from whatever the entry does carry.
test("an explicit type wins over everything else", () => {
	assert.equal(tool._inferType({ type: "ellipse", id: "box-1" }), "ellipse");
});

test("the placeholder type 'drawing' is not trusted and falls through", () => {
	assert.equal(tool._inferType({ type: "drawing", id: "box-1" }), "box");
});

test("a symbol is recognised by its symbolType before its id", () => {
	assert.equal(tool._inferType({ symbolType: "plus", id: "line-1" }), "stamp");
});

test("otherwise the id prefix names the type", () => {
	assert.equal(tool._inferType({ id: "symbol-1" }), "stamp");
	assert.equal(tool._inferType({ id: "box-1" }), "box");
	assert.equal(tool._inferType({ id: "ellipse-1" }), "ellipse");
	assert.equal(tool._inferType({ id: "sketch-1" }), "sketch");
	assert.equal(tool._inferType({ id: "line-1" }), "line");
});

test("an entry with nothing to go on is simply a drawing", () => {
	assert.equal(tool._inferType({}), "drawing");
	assert.equal(tool._inferType({ id: "unknown-1" }), "drawing");
});

// --- the drawing list -------------------------------------------------------

const entry = (id, extra = {}) => ({
	id,
	userId: "user-1",
	userName: "GM",
	createdAt: 1000,
	graphics: { alpha: 1 },
	...extra,
});

test("the list carries both temporary and permanent drawings, newest first", () => {
	reset();
	tool._pixiDrawings = [entry("line-1", { createdAt: 100 })];
	tool._permanentDrawings = [entry("box-1", { createdAt: 300 })];

	const entries = tool.getAllDrawingEntries();

	assert.deepEqual(entries.map(e => e.id), ["box-1", "line-1"]);
	assert.equal(entries[0].permanent, true);
	assert.equal(entries[1].permanent, false);
});

test("a temporary entry reports its expiry and a permanent one never does", () => {
	reset();
	tool._pixiDrawings = [entry("line-1", { expiresAt: 5000 })];
	tool._permanentDrawings = [entry("box-1", { expiresAt: 5000 })];

	const [permanent, temporary] = tool.getAllDrawingEntries()
		.sort((a, b) => Number(b.permanent) - Number(a.permanent));

	assert.equal(temporary.expiresAt, 5000);
	assert.equal(permanent.expiresAt, null, "a permanent drawing cannot expire");
});

test("only permanent entries carry a hidden flag", () => {
	reset();
	tool._pixiDrawings = [entry("line-1")];
	tool._permanentDrawings = [entry("box-1", { hidden: true })];

	const entries = tool.getAllDrawingEntries();

	assert.equal(entries.find(e => e.id === "box-1").hidden, true);
	assert.equal("hidden" in entries.find(e => e.id === "line-1"), false);
});

test("an unnamed drawing reports a null name and an unknown author", () => {
	reset();
	tool._pixiDrawings = [{ id: "line-1", userId: "u", createdAt: 1, graphics: {} }];

	const [only] = tool.getAllDrawingEntries();

	assert.equal(only.name, null);
	assert.equal(only.userName, "Unknown");
	assert.equal(only.opacity, 1, "a graphics object with no alpha reads as opaque");
});

// --- remote drawings --------------------------------------------------------

/** Record which creator a remote payload is routed to. */
function withRoutingSpy(run) {
	const calls = [];
	const originals = {};
	for (const name of ["_createRemoteSymbol", "_createRemoteBox", "_createRemoteEllipse",
		"_createRemoteLine", "_renderPermanentEntry"]) {
		originals[name] = tool[name];
		tool[name] = data => calls.push({ name, id: data.drawingId });
	}
	tool._pixiContainer = new StubContainer();
	try {
		run();
	}
	finally {
		Object.assign(tool, originals);
	}
	return calls;
}

test("a payload from this very client is ignored, so it is not drawn twice", () => {
	reset();
	const calls = withRoutingSpy(() => {
		tool._handleRemoteDrawing({ userId: "user-1", drawingId: "line-9", startX: 0, points: [] });
	});

	assert.deepEqual(calls, []);
});

test("each payload shape is routed to its own creator", () => {
	reset();
	const remote = extra => ({ userId: "other", drawingId: `d-${Math.round(1)}`, ...extra });
	const calls = withRoutingSpy(() => {
		tool._handleRemoteDrawing({ ...remote({ symbolType: "plus" }), drawingId: "s1" });
		tool._handleRemoteDrawing({ ...remote({ type: "box" }), drawingId: "b1" });
		tool._handleRemoteDrawing({ ...remote({ type: "ellipse" }), drawingId: "e1" });
		tool._handleRemoteDrawing({ ...remote({ startX: 0, points: [] }), drawingId: "l1" });
		tool._handleRemoteDrawing({ ...remote({ permanent: true }), drawingId: "p1" });
	});

	assert.deepEqual(calls, [
		{ name: "_createRemoteSymbol", id: "s1" },
		{ name: "_createRemoteBox", id: "b1" },
		{ name: "_createRemoteEllipse", id: "e1" },
		{ name: "_createRemoteLine", id: "l1" },
		{ name: "_renderPermanentEntry", id: "p1" },
	]);
});

// A symbol payload also carries a type, so the order of these checks is what
// keeps a stamp from being drawn as a box.
test("a symbol payload is a stamp even when it also names a type", () => {
	reset();
	const calls = withRoutingSpy(() => {
		tool._handleRemoteDrawing({
			userId: "other", drawingId: "s2", symbolType: "plus", type: "box",
		});
	});

	assert.deepEqual(calls.map(c => c.name), ["_createRemoteSymbol"]);
});

test("a drawing already on this client is not created a second time", () => {
	reset();
	tool._pixiDrawings = [entry("line-5")];
	tool._permanentDrawings = [entry("perm-5")];

	const calls = withRoutingSpy(() => {
		tool._handleRemoteDrawing({ userId: "other", drawingId: "line-5", startX: 0, points: [] });
		tool._handleRemoteDrawing({ userId: "other", drawingId: "perm-5", permanent: true });
	});

	assert.deepEqual(calls, []);
});

test("a payload with no drawing id is dropped rather than half-drawn", () => {
	reset();
	const calls = withRoutingSpy(() => {
		tool._handleRemoteDrawing({ userId: "other", type: "box" });
	});

	assert.deepEqual(calls, []);
});

// --- world coordinates ------------------------------------------------------

test("a pointer event is converted through the canvas stage, not the window", () => {
	reset();
	globalThis.canvas.app = {
		view: { getBoundingClientRect: () => ({ left: 20, top: 10 }) },
		stage: { toLocal: point => ({ x: point.x * 2, y: point.y * 2 }) },
	};
	globalThis.PIXI.Point = class {
		constructor(x, y) {
			this.x = x;
			this.y = y;
		}
	};

	assert.deepEqual(tool._getWorldCoords({ clientX: 120, clientY: 110 }), { x: 200, y: 200 });
});

test("a non-finite conversion yields no coordinates rather than NaN ones", () => {
	reset();
	globalThis.canvas.app = {
		view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
		stage: { toLocal: () => ({ x: NaN, y: 0 }) },
	};

	assert.equal(tool._getWorldCoords({ clientX: 1, clientY: 1 }), null);
});

test("with no canvas application there are no coordinates at all", () => {
	reset();
	const saved = globalThis.canvas.app;
	globalThis.canvas.app = null;
	try {
		assert.equal(tool._getWorldCoords({ clientX: 1, clientY: 1 }), null);
	}
	finally {
		globalThis.canvas.app = saved;
	}
});

// --- preview graphics -------------------------------------------------------

test("removing a preview detaches it from the container and forgets it", () => {
	reset();
	const container = new StubContainer();
	tool._pixiContainer = container;
	const preview = makeRecordingGraphics();
	preview.parent = container;
	container.children.push(preview);
	tool._previewGraphics = preview;

	tool._removePreview();

	assert.equal(tool._previewGraphics, null);
	assert.deepEqual(container.children, []);
	assert.equal(preview.count("destroy"), 1, "the graphics are freed, not just detached");
});

test("removing a preview that was never created is a no-op", () => {
	reset();
	tool._pixiContainer = new StubContainer();

	assert.doesNotThrow(() => tool._removePreview());
	assert.equal(tool._previewGraphics, null);
});

// Cancelling has to clear both the preview and the anchors, or the next
// gesture continues the abandoned one.
test("cancelling a drawing clears the preview and the state together", () => {
	reset();
	tool._pixiContainer = new StubContainer();
	tool.state.isDrawing = true;
	tool.state.boxStartPoint = { x: 1, y: 2 };

	tool._cancelDrawing();

	assert.equal(tool.state.isDrawing, false);
	assert.equal(tool.state.boxStartPoint, null);
	assert.equal(tool._previewGraphics, null);
});
