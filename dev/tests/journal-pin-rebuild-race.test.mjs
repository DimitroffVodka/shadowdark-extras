// Regression test for the pin rebuild race that broke TMFX preset apply.
//
// Applying a TokenMagic preset writes scene flags, which triggers TWO
// overlapping rebuilds of the same pin: the module's updateScene hook runs
// loadScenePins → updatePin while JournalPinManager.update also calls
// updatePin directly, and neither awaits the other. A build can suspend at a
// texture load, and the older build used to resume from that unguarded await
// and run the sprite-cache block, whose
// unguarded `_cachedTexture.destroy(true)` killed the texture the winning
// build had just attached to the live sprite. With filters applied (the
// preset), the next render tick calls FilterSystem.push → getBounds →
// Sprite.calculateVertices, which reads texture._uvs — null after destroy —
// and throws "can't access property uvsFloat32, this._texture._uvs is null".
//
// These tests freeze the invariant: an overlapping rebuild must never leave
// a destroyed texture attached to the pin, and the sprite cache must belong
// to exactly one build.
//
// The test gates the real media texture-loader boundary: the old build pauses,
// distinct new pin data wins, and only then is the old load released.

import assert from "node:assert/strict";
import test from "node:test";

import { installCanvasGlobals, installDom, StubContainer, StubElement } from "./helpers/pixi-harness.mjs";

installCanvasGlobals();
installDom();
globalThis.foundry.utils.Color = class StubColor extends Number {
	constructor(value) {
		super(value);
		this.valid = true;
	}

	static from(value) {
		return new StubColor(parseInt(String(value).replace("#", ""), 16) || 0);
	}
};

const { JournalPinGraphics } = await import("../../scripts/journal/pin-rendering.mjs");

// --- harness extensions to reach the sprite-cache path ----------------------

// The cache block asks the container for its local bounds and the fake
// renderer for a texture, then swaps the raw container for a sprite of it.
StubContainer.prototype.getLocalBounds = () => ({ x: -16, y: -16, width: 32, height: 32 });
StubContainer.prototype.removeChildren = function removeChildren() {
	const removed = this.children;
	this.children = [];
	return removed;
};
StubContainer.prototype.addChildAt = function addChildAt(child, index) {
	child.parent = this;
	this.children.splice(index, 0, child);
	return child;
};

// The hit area is a PIXI.Rectangle for non-circle shapes.
globalThis.PIXI.Rectangle = class Rectangle {
	constructor(x = 0, y = 0, width = 0, height = 0) {
		this.x = x;
		this.y = y;
		this.width = width;
		this.height = height;
	}
};

const textures = [];
globalThis.canvas.app.renderer = {
	generateTexture(container) {
		const findSource = node => {
			if (node?.texture?.sourceId) return node.texture.sourceId;
			for (const child of node?.children ?? []) {
				const sourceId = findSource(child);
				if (sourceId) return sourceId;
			}
			return null;
		};
		const texture = {
			valid: true,
			width: 32,
			height: 32,
			sourceId: findSource(container),
			destroyed: false,
			destroy() {
				this.destroyed = true;
			},
		};
		textures.push(texture);
		return texture;
	},
};

// The vision badge renders a glyph into a 2D canvas before creating its
// sprite. Stub the DOM pieces it touches (temp div query, body removal,
// canvas 2d context) so the 50ms suspension point is reachable.
StubElement.prototype.querySelector = () => null;
StubElement.prototype.removeChild = function removeChild(child) {
	this.children = this.children.filter(c => c !== child);
	return child;
};

const originalCreateElement = globalThis.document.createElement;
globalThis.document.createElement = tag => {
	if (tag === "canvas") {
		return {
			width: 0,
			height: 0,
			style: {},
			getContext: () => ({
				fillStyle: "",
				font: "",
				textAlign: "",
				textBaseline: "",
				shadowBlur: 0,
				shadowColor: "",
				fillText() {},
			}),
		};
	}
	return originalCreateElement(tag);
};

// The image-shape placeholder is a Graphics with draw methods the harness
// StubContainer does not implement; stub them so the container keeps a child
// and the sprite cache actually runs.
for (const method of ["lineStyle", "moveTo", "lineTo", "drawRect", "drawRoundedRect", "endFill", "beginFill", "drawCircle", "endHole", "lineTo"]) {
	globalThis.PIXI.Graphics.prototype[method] = () => undefined;
}

const pinData = {
	id: "p1",
	x: 100,
	y: 100,
	journalId: null,
	pageId: null,
	label: "Pin",
	requiresVision: true, // as in the original report; no longer suspends the build
	gmOnly: false,
	aboveFog: false,
	style: { shape: "image", size: 32, contentType: "none", hoverAnimation: "none" },
	flags: { tokenmagic: { filters: [] } }, // like a TMFX preset write
};

/** Every sprite still in the pin's tree must hold a live texture. */
function assertNoDestroyedTextureInTree(pin) {
	for (const child of pin.children) {
		if (child.texture) {
			assert.ok(!child.texture.destroyed, "tree sprite holds a destroyed texture");
		}
	}
}

test("overlapping rebuilds (hook + updatePin) leave a live texture in the tree", async () => {
	textures.length = 0;
	const pin = new JournalPinGraphics(pinData);
	let releaseOld;
	let markOldStarted;
	const oldStarted = new Promise(resolve => { markOldStarted = resolve; });
	globalThis.foundry.canvas = {
		loadTexture: path => {
			if (path === "old.png") {
				markOldStarted();
				return new Promise(resolve => {
					releaseOld = () => resolve({ width: 32, height: 32, sourceId: path });
				});
			}
			return Promise.resolve({ width: 32, height: 32, sourceId: path });
		},
	};

	const oldData = {
		...pinData,
		label: "Old pin",
		style: { ...pinData.style, imagePath: "old.png" },
	};
	const newData = {
		...pinData,
		label: "New pin",
		style: { ...pinData.style, imagePath: "new.png" },
	};

	const oldBuild = pin.update(oldData);
	await oldStarted;
	const newBuild = pin.update(newData);
	await newBuild;

	const winner = pin._cachedTexture;
	assert.equal(winner?.sourceId, "new.png", "the new build must win before the old load resumes");
	releaseOld();
	await oldBuild;

	assert.equal(pin.pinData.label, "New pin");
	assert.equal(textures.length, 1, "the stale completion must never rasterize a replacement");
	assert.equal(pin._cachedTexture, winner, "the stale completion replaced the winning cache");
	assert.ok(!winner.destroyed, "the stale completion destroyed the winning cache");
	assert.equal(pin.children[0]?.texture, winner, "the live rendered tree no longer holds the winner");
	assertNoDestroyedTextureInTree(pin);
});

test("serial rebuilds still replace the cached sprite cleanly", async () => {
	textures.length = 0;
	const pin = new JournalPinGraphics(pinData);

	await pin.update(pinData);
	await new Promise(r => setTimeout(r, 80));
	await pin.update(pinData);
	await new Promise(r => setTimeout(r, 80));

	// Each build rasterizes once; the second one replaced the first.
	assert.equal(textures.length, 2);
	assertNoDestroyedTextureInTree(pin);
	assert.equal(pin._cachedTexture, textures[1], "the live cache entry must be the latest texture");
});
