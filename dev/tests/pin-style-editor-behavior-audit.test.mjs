import assert from "node:assert/strict";
import test from "node:test";

import {
	installCanvasGlobals,
	installDom,
	makePointerEvent,
	makeGsapRecorder,
	StubContainer,
} from "./helpers/pixi-harness.mjs";

const env = installCanvasGlobals();
installDom();

globalThis.document.createElement = tag => {
	const element = new (Object.getPrototypeOf(globalThis.document.body).constructor)(tag);
	if (tag === "canvas") {
		element.getContext = () => ({
			drawImage() {},
			getImageData: () => ({ data: [] }),
		});
	}
	return element;
};
globalThis.document.body.getBoundingClientRect = () => ({ width: 0, height: 0 });
Object.getPrototypeOf(globalThis.document.body).getBoundingClientRect = () => ({ width: 0, height: 0 });
Object.getPrototypeOf(globalThis.document.body).querySelector = selector =>
	selector === "i" ? { style: {} } : null;
Object.getPrototypeOf(globalThis.document.body).removeChild = child => {
	globalThis.document.body.children = globalThis.document.body.children.filter(entry => entry !== child);
};
globalThis.window.getComputedStyle = () => ({ content: '"X"', fontFamily: "Arial" });

const colors = {
	from(value) {
		const number = typeof value === "number" ? value : Number.parseInt(String(value).replace("#", ""), 16);
		return {
			valid: Number.isFinite(number),
			value: number,
			[Symbol.toPrimitive]: () => number,
		};
	},
};
globalThis.foundry.utils.Color = colors;
globalThis.foundry.canvas = { loadTexture: async () => ({ width: 32, height: 32 }) };
let loadedSvg = "";
globalThis.fetch = async () => ({ ok: true, text: async () => '<svg viewBox="0 0 10 10"><path fill="#000000" /></svg>' });
globalThis.loadTexture = async uri => {
	loadedSvg = uri;
	return { width: 32, height: 32 };
};

StubContainer.prototype.removeChildren = function() {
	this.children.forEach(child => { child.parent = null; });
	this.children = [];
	return [];
};
StubContainer.prototype.addChildAt = function(child, index) {
	child.parent = this;
	this.children.splice(index, 0, child);
	return child;
};

// The shared PIXI harness intentionally keeps rendering primitives small. Add
// only the public geometry/text surface needed to build a real standard pin;
// the pin itself and its event registration remain production code.
class TestText extends StubContainer {
	constructor(text) {
		super();
		this.text = text;
		this.width = String(text).length * 16;
		this.height = 20;
		this.anchor = { set() {} };
	}
}

globalThis.PIXI.Text = TestText;
globalThis.PIXI.Circle = class {
	constructor(x, y, radius) { this.x = x; this.y = y; this.radius = radius; }
	};
globalThis.PIXI.Rectangle = class {
	constructor(x, y, width, height) {
		this.x = x; this.y = y; this.width = width; this.height = height;
	}
};
const nineSliceCalls = [];
globalThis.PIXI.NineSlicePlane = class extends StubContainer {
	constructor(texture, left, top, right, bottom) {
		super();
		nineSliceCalls.push({ texture, left, top, right, bottom });
		this.width = 0;
		this.height = 0;
		this.pivot = { set() {} };
		this.position = { set() {} };
	}
};
for (const method of [
	"beginFill", "lineStyle", "drawCircle", "drawRoundedRect", "drawRect", "moveTo",
	"lineTo", "closePath", "endFill",
]) {
	globalThis.PIXI.Graphics.prototype[method] = function() { return this; };
}
globalThis.PIXI.Graphics.prototype.pivot = { set() {} };
globalThis.PIXI.Graphics.prototype.position = { set() {} };

const globalStyle = { labelShowOnHover: true };
globalThis.game.settings.get = (scope, key) =>
	(scope === "shadowdark-extras" && key === "pinStyleDefaults") ? globalStyle : undefined;

const { JournalPinGraphics, JournalPinTooltip } = await import("../../scripts/journal/pin-rendering.mjs");

async function buildPin(style, pinData = {}) {
	const pin = new JournalPinGraphics({
		id: "audit-pin",
		x: 100,
		y: 100,
		journalId: null,
		pageId: null,
		...pinData,
		style: { shape: "circle", contentType: "none", labelText: "Room 3", ...style },
	});
	await pin.init();
	assert.ok(pin._labelContainer, "production renderer should build the configured label");
	return pin;
}

test("an explicit per-pin tooltip choice overrides a legacy world-style value", async () => {
	globalStyle.hideTooltip = true;
	try {
		const pin = await buildPin({}, {
			hideTooltip: false,
			tooltipTitle: "Visible title",
			tooltipContent: "Visible body",
		});
		pin.emit("pointerenter", makePointerEvent());
		assert.match(JournalPinTooltip._element?.innerHTML || "", /Visible title/);
		assert.match(JournalPinTooltip._element?.innerHTML || "", /Visible body/);
		JournalPinTooltip.hide();
	}
	finally {
		delete globalStyle.hideTooltip;
	}
});

test("inherited hover labels hide again after leaving a production-rendered pin", async () => {
	const inherited = await buildPin({});
	assert.equal(inherited._labelContainer.visible, false, "global hover-only default starts hidden");

	inherited.emit("pointerenter", makePointerEvent());
	assert.equal(inherited._labelContainer.visible, true, "registered pointerenter reveals the label");

	inherited.emit("pointerleave", makePointerEvent());
	assert.equal(inherited._labelContainer.visible, false, "registered pointerleave hides inherited hover label");
});

test("an explicit per-pin always-visible label remains visible after leaving", async () => {
	const alwaysVisible = await buildPin({ labelShowOnHover: false });
	assert.equal(alwaysVisible._labelContainer.visible, true);

	alwaysVisible.emit("pointerenter", makePointerEvent());
	alwaysVisible.emit("pointerleave", makePointerEvent());

	assert.equal(alwaysVisible._labelContainer.visible, true);
});

test("an image-border label without a path falls back to text and keeps the pin interactive", async () => {
	const pin = await buildPin({
		labelBackground: "image",
		labelBorderImagePath: "",
	});

	assert.ok(pin._labelContainer, "the label should still be built without a frame image");
	assert.equal(pin._labelContainer.visible, false, "hover-only labels still start hidden");
	assert.ok(pin.hitArea, "the pin should finish hit-area setup");
	assert.deepEqual(pin.listenerEvents(), [
		"pointerenter", "pointerleave", "pointerdown", "pointerup", "pointerupoutside",
	]);
});

test("production media bodies honor tint and opacity, and custom icons honor icon color", async () => {
	const image = await buildPin({
		shape: "image",
		imagePath: "worlds/test/pin.webp",
		imageTint: "#123456",
		opacity: 0.5,
	});
	assert.equal(image._imageSprite.tint, 0x123456);
	assert.equal(image._imageSprite.alpha, 0.5);

	const icon = await buildPin({
		shape: "icon",
		iconShapePath: "modules/test/body.svg",
		iconShapeTint: "#654321",
	});
	assert.equal(icon._imageSprite.tint, 0x654321);

	loadedSvg = "";
	await buildPin({
		contentType: "customIcon",
		customIconPath: "modules/test/gate.svg",
		iconColor: "#abcdef",
	});
	assert.match(Buffer.from(loadedSvg.replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8"), /#abcdef/);
});

test("production image bodies keep common text, custom-icon, and none semantics", async () => {
	const none = await buildPin({
		shape: "image",
		imagePath: "worlds/test/pin.webp",
		contentType: "none",
	});
	assert.equal(none.children[0].children.some(child => child.text), false);

	const text = await buildPin({
		shape: "image",
		imagePath: "worlds/test/pin.webp",
		contentType: "text",
		customText: "Room 7",
	});
	assert.equal(text.children[0].children.find(child => child.text === "Room 7")?.text, "Room 7");

	const symbol = await buildPin({
		shape: "image",
		imagePath: "worlds/test/pin.webp",
		contentType: "symbol",
		symbolClass: "fa-solid fa-skull",
	});
	assert.ok(symbol._icon, "symbol icon is layered on the image body");

	const customIcon = await buildPin({
		shape: "image",
		imagePath: "worlds/test/pin.webp",
		contentType: "customIcon",
		customIconPath: "modules/test/gate.svg",
	});
	assert.ok(customIcon._icon, "custom icon is layered on the image body");
});

test("production image labels pass slices to NineSlicePlane in border order", async () => {
	nineSliceCalls.length = 0;
	await buildPin({
		labelBackground: "image",
		labelBorderImagePath: " modules/test/frame.png ",
		labelBorderSliceTop: 11,
		labelBorderSliceRight: 22,
		labelBorderSliceBottom: 33,
		labelBorderSliceLeft: 44,
	});
	assert.deepEqual(nineSliceCalls[0], {
		texture: { width: 32, height: 32 }, left: 44, top: 11, right: 22, bottom: 33,
	});
});

test("production fit-to-grid uses the active grid size", async () => {
	const previousGrid = globalThis.canvas.grid;
	globalThis.canvas.grid = { sizeX: 96, sizeY: 64 };
	try {
		const pin = await buildPin({ fitToHexGrid: true, size: 32 });
		assert.equal(pin.hitArea.radius, 48);
	}
	finally {
		globalThis.canvas.grid = previousGrid;
	}
});

test("production tooltip uses the per-pin title and body font sizes", () => {
	JournalPinTooltip.show({
		tooltipTitle: "Title",
		tooltipContent: "Body",
		style: { tooltipTitleFontSize: 23, tooltipContentFontSize: 11 },
	}, makePointerEvent());

	const tooltip = globalThis.document.getElementById("sdx-journal-pin-tooltip");
	assert.match(tooltip.innerHTML, /font-size:23px/);
	assert.match(tooltip.innerHTML, /font-size:11px/);
	JournalPinTooltip.hide();
});

test("saved ping and bring animations select their independent runtime branches", async () => {
	const oldGsap = globalThis.window.gsap;
	const oldGlobalGsap = globalThis.gsap;
	const recorder = makeGsapRecorder();
	globalThis.window.gsap = recorder;
	globalThis.gsap = recorder;
	try {
		const pin = await buildPin({ pingAnimation: "shake", bringAnimation: "flash" });
		pin.animatePing();
		assert.ok(recorder.of("to").some(call => call.target === pin && call.vars.x === "+=5"),
			"ping uses the saved shake branch");
		recorder.reset();
		pin.animatePing("bring");
		assert.ok(recorder.of("fromTo").some(call => call.target === pin && call.fromVars?.pixi?.brightness === 3),
			"bring uses the saved flash branch");
	}
	finally {
		globalThis.window.gsap = oldGsap;
		globalThis.gsap = oldGlobalGsap;
	}
});
