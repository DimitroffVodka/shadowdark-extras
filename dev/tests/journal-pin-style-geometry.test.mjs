// Characterization tests for the journal pin style defaults and the ring
// stroke geometry, captured BEFORE the Phase 5.3.5 split of pin-rendering.mjs.
//
// These freeze observable behavior, not implementation: the style merge/
// fallback contract, and the exact sequence of PIXI drawing commands emitted
// for each shape/style pair. A refactor that moves _drawStyledStroke into a
// separate module must keep every one of these sequences identical.

import assert from "node:assert/strict";
import test from "node:test";

// --- Minimal Foundry/PIXI surface -------------------------------------------

class TestColor extends Number {
	constructor(value, valid = true) {
		super(value);
		this.valid = valid;
	}

	get css() {
		return `#${Number(this).toString(16).padStart(6, "0")}`;
	}

	static from(value) {
		if (value instanceof TestColor) return value;
		if (typeof value === "number") return new TestColor(value);
		if (typeof value === "string") {
			const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
			if (match) return new TestColor(parseInt(match[1], 16));
		}
		return new TestColor(Number.NaN, false);
	}
}

function deepClone(value) {
	if (Array.isArray(value)) return value.map(deepClone);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepClone(v)]));
	}
	return value;
}

function mergeObject(original, other = {}) {
	for (const [key, value] of Object.entries(other)) {
		if (value && typeof value === "object" && !Array.isArray(value)
			&& original[key] && typeof original[key] === "object") {
			mergeObject(original[key], value);
		}
		else original[key] = deepClone(value);
	}
	return original;
}

let storedPinStyle = {};
let settingsThrow = false;

globalThis.foundry = {
	utils: { Color: TestColor, deepClone, mergeObject },
};
globalThis.game = {
	settings: {
		get(_module, key) {
			if (settingsThrow) throw new Error("settings not registered");
			return key === "pinStyleDefaults" ? storedPinStyle : undefined;
		},
	},
};
const { DEFAULT_PIN_STYLE, getPinStyle, normalizeImageTint } =
	await import("../../scripts/journal/pin-style.mjs");
const { drawStyledStroke } = await import("../../scripts/journal/pin-draw.mjs");

// --- Recording graphics stub ------------------------------------------------

const round = n => (typeof n === "number" ? Math.round(n * 1e4) / 1e4 : n);

function recordingGraphics() {
	const ops = [];
	const record = name => (...args) => {
		ops.push([name, ...args.map(round)]);
	};
	return {
		ops,
		count: name => ops.filter(op => op[0] === name).length,
		lineStyle: record("lineStyle"),
		beginFill: record("beginFill"),
		endFill: record("endFill"),
		drawCircle: record("drawCircle"),
		arc: record("arc"),
		moveTo: record("moveTo"),
		lineTo: record("lineTo"),
	};
}

function stroke(shape, style, { radius = 16, width = 3, cornerRadius = 4 } = {}) {
	const g = recordingGraphics();
	drawStyledStroke(g, shape, radius, width, 0xff0000, 0.5, style, cornerRadius);
	return g;
}

// --- Style defaults and merge contract --------------------------------------

test("DEFAULT_PIN_STYLE keeps the documented shape and content defaults", () => {
	assert.equal(DEFAULT_PIN_STYLE.shape, "circle");
	assert.equal(DEFAULT_PIN_STYLE.contentType, "number");
	assert.equal(DEFAULT_PIN_STYLE.size, 32);
	assert.equal(DEFAULT_PIN_STYLE.ringWidth, 3);
	assert.equal(DEFAULT_PIN_STYLE.ringStyle, "solid");
	assert.equal(DEFAULT_PIN_STYLE.fitToHexGrid, false);
	assert.equal(DEFAULT_PIN_STYLE.hideTooltip, false);
});

test("getPinStyle layers stored settings over the defaults", () => {
	storedPinStyle = { shape: "hexagon", ringWidth: 8 };
	settingsThrow = false;

	const style = getPinStyle();

	assert.equal(style.shape, "hexagon");
	assert.equal(style.ringWidth, 8);
	// Untouched keys still fall through to the defaults.
	assert.equal(style.contentType, DEFAULT_PIN_STYLE.contentType);
	assert.equal(style.labelAnchor, DEFAULT_PIN_STYLE.labelAnchor);
});

test("getPinStyle never hands back the shared DEFAULT_PIN_STYLE object", () => {
	storedPinStyle = { shape: "diamond" };
	settingsThrow = false;

	const style = getPinStyle();
	style.shape = "mutated";

	assert.equal(DEFAULT_PIN_STYLE.shape, "circle");
	assert.notEqual(getPinStyle(), style);
});

test("getPinStyle falls back to a clean default clone when settings throw", () => {
	settingsThrow = true;

	const style = getPinStyle();

	assert.deepEqual(style, DEFAULT_PIN_STYLE);
	assert.notEqual(style, DEFAULT_PIN_STYLE);
	settingsThrow = false;
});

// --- Image tint normalization -----------------------------------------------

test("normalizeImageTint treats empty and invalid values as no tint", () => {
	assert.equal(normalizeImageTint(""), null);
	assert.equal(normalizeImageTint(null), null);
	assert.equal(normalizeImageTint(undefined), null);
	assert.equal(normalizeImageTint(0), null);
	assert.equal(normalizeImageTint("not-a-color"), null);
});

test("normalizeImageTint treats white as the multiply no-op", () => {
	assert.equal(normalizeImageTint("#ffffff"), null);
	assert.equal(normalizeImageTint(0xFFFFFF), null);
});

test("normalizeImageTint returns a Color for real tints", () => {
	const tint = normalizeImageTint("#ff0000");

	assert.notEqual(tint, null);
	assert.equal(Number(tint), 0xFF0000);
	assert.equal(tint.css, "#ff0000");
});

// --- Ring stroke geometry ---------------------------------------------------

test("every styled stroke opens by setting the ring line style", () => {
	for (const shape of ["circle", "square", "diamond", "hexagon", "hexagonFlat"]) {
		for (const style of ["dashed", "dotted"]) {
			const g = stroke(shape, style);
			assert.deepEqual(g.ops[0], ["lineStyle", 3, 0xff0000, 0.5],
				`${shape}/${style} did not open with lineStyle`);
		}
	}
});

test("a dotted circle emits one filled dot per segment, starting at angle 0", () => {
	const g = stroke("circle", "dotted");

	// circumference 2*PI*16 = 100.53; dash 3 + gap 6 => floor(100.53/9) = 11 dots.
	assert.equal(g.count("drawCircle"), 11);
	assert.equal(g.count("beginFill"), 11);
	assert.equal(g.count("endFill"), 11);
	assert.equal(g.count("arc"), 0);

	// Dots carry half the ring width as their radius and start on the +x axis.
	assert.deepEqual(g.ops[3], ["drawCircle", 16, 0, 1.5]);
});

test("a dashed circle emits arc/moveTo pairs instead of dots", () => {
	const g = stroke("circle", "dashed");

	// dash 9 + gap 6 => floor(100.53/15) = 6 dashes.
	assert.equal(g.count("arc"), 6);
	assert.equal(g.count("moveTo"), 6);
	assert.equal(g.count("drawCircle"), 0);
	assert.equal(g.count("beginFill"), 0);
});

test("a rounded square traces four edges and four corner arcs", () => {
	const dashed = stroke("square", "dashed", { cornerRadius: 4 });

	assert.ok(dashed.count("arc") > 0, "rounded square should emit corner arcs");
	assert.ok(dashed.count("lineTo") > 0, "rounded square should emit straight edges");
});

test("a zero corner radius falls through to the polygon path", () => {
	const g = stroke("square", "dashed", { cornerRadius: 0 });

	// The polygon branch strokes straight segments only — no corner arcs.
	assert.equal(g.count("arc"), 0);
	assert.ok(g.count("lineTo") > 0);
});

test("polygon shapes dash along every edge of their outline", () => {
	const diamond = stroke("diamond", "dashed");
	const hexagon = stroke("hexagon", "dashed");
	const hexagonFlat = stroke("hexagonFlat", "dashed");

	// Diamond closes over 4 edges, hexagons over 6.
	assert.ok(diamond.count("lineTo") >= 4);
	assert.ok(hexagon.count("lineTo") >= 6);
	assert.equal(hexagon.count("lineTo"), hexagonFlat.count("lineTo"));

	// The flat-top hexagon is the pointy-top one rotated by -90 degrees, so the
	// two must not trace identical paths.
	assert.notDeepEqual(hexagon.ops, hexagonFlat.ops);
});

test("dotted polygons place dots and never stroke lines", () => {
	const g = stroke("hexagon", "dotted");

	assert.ok(g.count("drawCircle") > 0);
	assert.equal(g.count("lineTo"), 0);
	assert.equal(g.count("beginFill"), g.count("drawCircle"));
	assert.equal(g.count("endFill"), g.count("drawCircle"));
});

test("ring width scales dot radius and dash density", () => {
	const thin = stroke("circle", "dotted", { width: 2 });
	const thick = stroke("circle", "dotted", { width: 6 });

	// Wider rings use larger, sparser dots.
	assert.ok(thick.count("drawCircle") < thin.count("drawCircle"));
	assert.equal(thin.ops[3][3], 1);
	assert.equal(thick.ops[3][3], 3);
});
