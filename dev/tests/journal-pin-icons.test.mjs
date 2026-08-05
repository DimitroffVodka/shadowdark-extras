// Characterization tests for journal pin icon building, captured BEFORE the
// helpers move out of pin-rendering.mjs.
//
// Most of this code is canvas and texture work that only a real browser can
// exercise; that part stays a live Foundry check. But the custom-SVG path
// contains actual logic — recolouring a monochrome SVG before it becomes a
// texture — and that is reachable here by stubbing fetch and loadTexture and
// decoding the data URI the code hands onward.

import assert from "node:assert/strict";
import test from "node:test";

import { installCanvasGlobals, installDom, StubContainer } from "./helpers/pixi-harness.mjs";

installCanvasGlobals();
installDom();

const { JournalPinGraphics } = await import("../../scripts/journal/pin-rendering.mjs");
const { addSvgIcon } = await import("../../scripts/journal/pin-icons.mjs");

// --- capture the SVG on its way to a texture --------------------------------

let fetched = "";
let loadedUri = null;

globalThis.fetch = async () => ({ text: async () => fetched });
globalThis.loadTexture = async uri => {
	loadedUri = uri;
	return { width: 1, height: 1 };
};

/** Run the real _addSvgIcon and return the SVG text it encoded. */
async function colorize(svgText, color, { style = {} } = {}) {
	fetched = svgText;
	loadedUri = null;
	const pin = new JournalPinGraphics({ id: "p", journalId: "j", x: 0, y: 0, style });
	await addSvgIcon(pin, new StubContainer(), "icons/thing.svg", 20, color);
	assert.ok(loadedUri, "no texture was loaded");
	const base64 = loadedUri.replace("data:image/svg+xml;base64,", "");
	return { svg: Buffer.from(base64, "base64").toString("utf8"), pin };
}

// --- recolouring ------------------------------------------------------------

test("an existing fill is replaced with the requested colour", async () => {
	const { svg } = await colorize('<svg viewBox="0 0 10 10"><path fill="#123456" d="M0 0"/></svg>', 0xFF0000);

	assert.match(svg, /fill="#ff0000"/);
	assert.doesNotMatch(svg, /#123456/);
});

test("every fill in the document is replaced, not just the first", async () => {
	const { svg } = await colorize(
		'<svg ><path fill="#111111"/><path fill="#222222"/><path fill="#333333"/></svg>', 0x00FF00);

	assert.equal((svg.match(/fill="#00ff00"/g) || []).length, 3);
});

test("an SVG with no fill gets one injected on the root element", async () => {
	const { svg } = await colorize('<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>', 0x0000FF);

	assert.match(svg, /<svg fill="#0000ff" viewBox/);
});

test("strokes are recoloured only when the document already has them", async () => {
	const withStroke = await colorize('<svg ><path stroke="#abcdef" fill="#000000"/></svg>', 0xFF00FF);
	assert.match(withStroke.svg, /stroke="#ff00ff"/);

	const withoutStroke = await colorize('<svg ><path fill="#000000"/></svg>', 0xFF00FF);
	assert.doesNotMatch(withoutStroke.svg, /stroke=/);
});

test("the colour is written as a zero-padded six-digit hex", async () => {
	const { svg } = await colorize('<svg ><path fill="#ffffff"/></svg>', 0x0000FF);

	assert.match(svg, /fill="#0000ff"/, "0xff must pad to #0000ff, not #ff");
});

// Documents a real edge: injection matches the literal "<svg " WITH a trailing
// space, so a bare "<svg>" root is left uncoloured. Monochrome SVGs written
// without attributes therefore render in their own colour.
test("a bare <svg> root receives no injected fill", async () => {
	const { svg } = await colorize("<svg><path d=\"M0 0\"/></svg>", 0x00FF00);

    assert.doesNotMatch(svg, /fill=/);
});

// --- sprite placement -------------------------------------------------------

test("the icon is sized from the radius and centred", async () => {
	const { pin } = await colorize('<svg ><path fill="#000000"/></svg>', 0xFFFFFF);

	// Custom SVGs use a 1.3 factor so they fill the pin.
	assert.equal(pin._icon.width, 26);
	assert.equal(pin._icon.height, 26);
	assert.deepEqual([pin._icon.position.x, pin._icon.position.y], [0, 0]);
});

test("a diamond pin rotates its icon by a quarter turn", async () => {
	const diamond = await colorize('<svg ><path fill="#000"/></svg>', 0xFFFFFF, { style: { shape: "diamond" } });
	assert.equal(diamond.pin._icon.rotation, -Math.PI / 4);

	const circle = await colorize('<svg ><path fill="#000"/></svg>', 0xFFFFFF, { style: { shape: "circle" } });
	assert.equal(circle.pin._icon.rotation, 0);
});

test("a destroyed pin abandons the load instead of building a sprite", async () => {
	fetched = '<svg ><path fill="#000"/></svg>';
	const pin = new JournalPinGraphics({ id: "p", journalId: "j", x: 0, y: 0, style: {} });
	pin.destroyed = true;

	await addSvgIcon(pin, new StubContainer(), "icons/thing.svg", 20, 0xFFFFFF);

	assert.equal(pin._icon, null);
});

test("a failed fetch is reported and swallowed", async () => {
	const realFetch = globalThis.fetch;
	const realError = console.error;
	const logged = [];
	globalThis.fetch = async () => { throw new Error("network down"); };
	console.error = (...a) => logged.push(a);
	const pin = new JournalPinGraphics({ id: "p", journalId: "j", x: 0, y: 0, style: {} });

	try {
		// Must not reject — a missing icon should not break the whole build.
		await addSvgIcon(pin, new StubContainer(), "icons/missing.svg", 20, 0xFFFFFF);
	}
	finally {
		globalThis.fetch = realFetch;
		console.error = realError;
	}

	assert.equal(logged.length, 1);
	assert.equal(pin._icon, null);
});
