import assert from "node:assert/strict";
import test from "node:test";

import {
	loadIntrinsicSvgTexture,
	normalizeSvgIntrinsicSize,
} from "../../scripts/journal/pin-svg-texture.mjs";

test("normalizes a viewBox-only SVG to explicit intrinsic dimensions", () => {
	const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h1v1z"/></svg>';
	const normalized = normalizeSvgIntrinsicSize(source);

	assert.match(normalized, /<svg\b[^>]*\bwidth="512"/);
	assert.match(normalized, /<svg\b[^>]*\bheight="512"/);
	assert.match(normalized, /viewBox="0 0 512 512"/);
});

test("preserves explicit SVG dimensions", () => {
	const source = '<svg width="64" height="32" viewBox="0 0 512 256"></svg>';
	assert.equal(normalizeSvgIntrinsicSize(source), source);
});

test("loads normalized markup instead of the viewBox-only source", async () => {
	const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"></svg>';
	const oldFetch = globalThis.fetch;
	globalThis.fetch = async () => ({
		ok: true,
		text: async () => source,
	});

	let loadedUrl = "";
	const texture = { width: 512, height: 512 };
	const loader = async url => {
		loadedUrl = url;
		return texture;
	};

	try {
		assert.equal(await loadIntrinsicSvgTexture("icon.svg", loader), texture);
		assert.match(decodeURIComponent(loadedUrl), /width="512"/);
		assert.match(decodeURIComponent(loadedUrl), /height="512"/);
	}
	finally {
		globalThis.fetch = oldFetch;
	}
});
