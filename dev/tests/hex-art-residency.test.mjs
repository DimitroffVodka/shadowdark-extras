// Hex map art residency, scripts/hex/hex-art-residency.mjs (#178).
//
// PIXI's texture GC unloads textures unused for 3,600 frames, and culled hex
// art counts as unused, so a zoom-out re-uploaded the whole map in one frame.
// The ticker pass keeps every primary-group texture touched and queues any
// that are not on the GPU yet for PIXI's prepare, which uploads a few a frame.

import assert from "node:assert/strict";
import test from "node:test";

let canvasReady = null;
globalThis.Hooks = { on: (name, fn) => { if (name === "canvasReady") canvasReady = fn; } };

const { initHexArtResidency } = await import("../../scripts/hex/hex-art-residency.mjs");
initHexArtResidency();

function texture(resident) {
	return { baseTexture: { valid: true, touched: 0, _glTextures: resident ? { 1: {} } : {} } };
}

function install({ hex = true } = {}) {
	const tickers = new Set();
	const queued = [];
	const art = [texture(true), texture(false)];
	globalThis.canvas = {
		ready: true,
		grid: { isHexagonal: hex },
		primary: { children: [{ texture: art[0] }, { texture: art[1] }, { texture: art[1] }, {}] },
		app: {
			ticker: { add: fn => tickers.add(fn), remove: fn => tickers.delete(fn) },
			renderer: {
				CONTEXT_UID: 1,
				textureGC: { count: 5000 },
				prepare: { add: t => queued.push(t), upload: () => queued.push("upload") },
			},
		},
	};
	canvasReady();
	return { tickers, queued, art };
}

test("a hex canvas keeps its art touched and queues only what is not uploaded", () => {
	const { tickers, queued, art } = install();
	assert.equal(tickers.size, 1);
	const [pass] = tickers;
	pass();
	assert.deepEqual(art.map(t => t.baseTexture.touched), [5000, 5000], "never idle to PIXI's GC");
	assert.deepEqual(queued, [art[1], art[1], "upload"], "the resident texture is not re-queued");

	queued.length = 0;
	canvas.app.renderer.textureGC.count = 5059;
	for (let i = 0; i < 59; i++) pass();
	assert.equal(art[0].baseTexture.touched, 5000, "passes run every 60 frames, not every frame");
	pass();
	assert.equal(art[0].baseTexture.touched, 5059);
});

test("a non-hex canvas removes the pass instead of adding one", () => {
	const { tickers } = install();
	assert.equal(tickers.size, 1);
	canvas.grid.isHexagonal = false;
	canvasReady();
	assert.equal(tickers.size, 0);
	assert.equal(install({ hex: false }).tickers.size, 0);
});
