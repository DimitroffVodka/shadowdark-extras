// The GM-only overlays a canvas pin used to carry, and the fact that it no
// longer carries either:
//
//   - the vision badge: a FontAwesome eye rasterised into a sprite and parked
//     just outside the pin body, top-right (requiresVision);
//   - the privacy stroke: the ring forced to red and dashed (gmOnly).
//
// Both were drawn at or just outside the pin's edge, where any sizeable image
// or icon — as the pin's shape or as its content — covers them, leaving the
// "half of eye and slash sign" fragments in the reported screenshot. Neither is
// built any more, for any shape. What replaces them is nothing: a pin renders
// the ring its style configures, and both flags keep working as visibility
// rules, surfaced in the tray and pin list (covered in journal-pin-list and
// journal-pin-convert-notes) rather than painted on the canvas.
//
// Observed through the pin's own display tree and its drawing commands, driven
// by the public init(). No renderer is installed, so _build keeps the live
// container instead of flattening it into a cached texture, and the children
// stay inspectable. Only browser-side boundaries are stubbed (the 2D canvas the
// badge rasterised through, Color, the texture loader).

import assert from "node:assert/strict";
import test from "node:test";

import {
	installCanvasGlobals, installDom, StubContainer, StubElement,
} from "./helpers/pixi-harness.mjs";

const env = installCanvasGlobals();
installDom();

// --- harness extensions -----------------------------------------------------

StubContainer.prototype.removeChildren = function removeChildren() {
	const removed = this.children;
	this.children = [];
	return removed;
};
// The image path inserts its hover border underneath the sprite.
StubContainer.prototype.addChildAt = function addChildAt(child, index) {
	child.parent = this;
	this.children.splice(index, 0, child);
	return child;
};

globalThis.PIXI.Rectangle = class Rectangle {
	constructor(x = 0, y = 0, width = 0, height = 0) {
		Object.assign(this, { x, y, width, height });
	}
};
globalThis.PIXI.Circle = class Circle {
	constructor(x = 0, y = 0, radius = 0) {
		Object.assign(this, { x, y, radius });
	}
};

/** Graphics that records its drawing commands instead of rasterising them. */
const drawings = [];
globalThis.PIXI.Graphics = class RecordingGraphics extends StubContainer {
	constructor() {
		super();
		this.ops = [];
		drawings.push(this);
	}
};
for (const name of ["lineStyle", "beginFill", "endFill", "moveTo", "lineTo", "drawCircle",
	"drawEllipse", "drawRect", "drawRoundedRect", "drawPolygon", "arc", "closePath", "clear"]) {
	globalThis.PIXI.Graphics.prototype[name] = function record(...args) {
		this.ops.push([name, ...args]);
		return this;
	};
}

// The pin's image/icon body loads through Foundry's texture loader.
const loadedTextureUris = [];
globalThis.loadTexture = async uri => {
	loadedTextureUris.push(uri);
	return { width: 32, height: 32 };
};
globalThis.fetch = async () => ({
	ok: true,
	text: async () => '<svg viewBox="0 0 32 32"><path d="M0 0h32v32H0z"/></svg>',
});

// Tint normalisation runs on the image path and asks Foundry for a Color.
class StubColor extends Number {
	constructor(value, valid = true) {
		super(value);
		this.valid = valid;
	}

	get css() {
		return `#${Number(this).toString(16).padStart(6, "0")}`;
	}

	static from(value) {
		if (typeof value === "number") return new StubColor(value);
		const match = /^#?([0-9a-f]{6})$/i.exec(String(value).trim());
		return match ? new StubColor(parseInt(match[1], 16)) : new StubColor(Number.NaN, false);
	}
}
globalThis.foundry.utils.Color = StubColor;

// The badge rasterised its glyph through a 2D canvas. Nothing else in a pin
// does, so a texture built from one identifies a badge — which is how its
// absence is asserted below.
StubElement.prototype.querySelector = () => null;
StubElement.prototype.removeChild = function removeChild(child) {
	this.children = this.children.filter(c => c !== child);
	return child;
};
const createElement = globalThis.document.createElement;
globalThis.document.createElement = tag => {
	if (tag === "canvas") {
		return {
			width: 0,
			height: 0,
			style: {},
			getContext: () => ({
				fillStyle: "", font: "", textAlign: "", textBaseline: "",
				shadowBlur: 0, shadowColor: "", fillText() {},
			}),
		};
	}
	return createElement(tag);
};

const { JournalPinGraphics } = await import("../../scripts/journal/pin-rendering.mjs");

// --- fixtures ---------------------------------------------------------------

const PRIVACY_RED = 0xFF4444;
const CONFIGURED_GREEN = 0x00FF00;

/** Every shape family a pin can take: geometric, then media. */
const ALL_SHAPES = ["circle", "square", "diamond", "hexagon", "image", "icon"];

function makePinData({ shape, gmOnly = false, requiresVision = false, style = {} }) {
	return {
		id: "p1",
		x: 100,
		y: 100,
		journalId: null,
		pageId: null,
		label: "Pin",
		gmOnly,
		requiresVision,
		aboveFog: false,
		style: {
			shape, size: 32, contentType: "none", hoverAnimation: "none",
			imagePath: "icons/svg/door-closed.svg", iconShapePath: "icons/svg/door-closed.svg",
			...style,
		},
	};
}

/** Build a pin as the GM — the only user the overlays were ever drawn for. */
async function buildAsGm(pinData) {
	drawings.length = 0;
	env.setGM(true);
	const pin = new JournalPinGraphics(pinData);
	await pin.init();
	// The badge used to suspend on a 50ms timer inside the build; leave time for
	// one to land, so its absence is a real absence and not a race.
	await new Promise(r => { setTimeout(r, 80); });
	return pin;
}

/** Sprites in the tree whose texture came from a 2D canvas — i.e. a badge. */
function visionBadges(node, found = []) {
	for (const child of node.children ?? []) {
		if (typeof child.texture?.source?.getContext === "function") found.push(child);
		visionBadges(child, found);
	}
	return found;
}

/** Every stroke colour any Graphics in this build was asked to use. */
function strokeColors() {
	return drawings.flatMap(g => g.ops.filter(op => op[0] === "lineStyle").map(op => op[2]));
}

/** How many arc segments were drawn — a dashed ring is drawn as arcs. */
function arcCount() {
	return drawings.reduce((n, g) => n + g.ops.filter(op => op[0] === "arc").length, 0);
}

// --- the vision badge is gone ------------------------------------------------

test("no pin builds a vision badge, whatever its shape", async () => {
	for (const shape of ALL_SHAPES) {
		const pin = await buildAsGm(makePinData({ shape, requiresVision: true }));

		assert.equal(visionBadges(pin).length, 0, `shape=${shape}`);
	}
});

test("image and intrinsic-SVG icon shapes both traverse their real texture paths", async () => {
	loadedTextureUris.length = 0;
	await buildAsGm(makePinData({ shape: "image" }));
	await buildAsGm(makePinData({
		shape: "icon", style: { iconShapePath: "icons/svg/texture-path-check.svg" },
	}));

	assert.ok(loadedTextureUris.includes("icons/svg/door-closed.svg"));
	assert.ok(loadedTextureUris.some(uri => uri.startsWith("data:image/svg+xml")));
});

// --- the privacy stroke is gone ----------------------------------------------

test("a GM-only pin is never overpainted with the privacy red", async () => {
	for (const shape of ALL_SHAPES) {
		await buildAsGm(makePinData({ shape, gmOnly: true }));

		assert.ok(!strokeColors().includes(PRIVACY_RED), `shape=${shape}: ${strokeColors()}`);
	}
});

test("a GM-only pin draws the ring colour its style configures", async () => {
	await buildAsGm(makePinData({
		shape: "circle", gmOnly: true, style: { ringColor: "#00ff00", ringStyle: "solid" },
	}));

	assert.ok(strokeColors().includes(CONFIGURED_GREEN), `strokes drawn: ${strokeColors()}`);
});

test("a GM-only pin keeps a solid ring solid instead of being dashed", async () => {
	await buildAsGm(makePinData({
		shape: "circle", gmOnly: true, style: { ringColor: "#00ff00", ringStyle: "solid" },
	}));

	assert.equal(arcCount(), 0, "a solid ring is one stroke, not a run of dash arcs");
});

test("a pin whose style asks for a dashed ring still gets one", async () => {
	await buildAsGm(makePinData({
		shape: "circle", style: { ringColor: "#00ff00", ringStyle: "dashed" },
	}));

	assert.ok(arcCount() > 0, "no dash arcs were drawn");
	assert.ok(strokeColors().includes(CONFIGURED_GREEN), `strokes drawn: ${strokeColors()}`);
});
