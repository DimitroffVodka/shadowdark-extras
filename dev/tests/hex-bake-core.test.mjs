import assert from "node:assert/strict";
import test from "node:test";

import {
	fitScale,
	isKeyedTile,
	keyedEntries,
	keyedSpriteView,
	mipChain,
	padPiece,
	pieceFrame,
	pieceSize,
	piecesInView,
	pyramidLevel,
	pyramidLevels,
	transcodeTarget,
} from "../../scripts/hex/hex-bake-core.mjs";

// The Western Reaches map: 14262 × 19072 at level 0, 1024 px pieces, six levels.
const meta = {
	tile: 1024,
	sceneRect: { x: 0, y: 0, width: 14262, height: 19072 },
	levels: [
		{ width: 14262, height: 19072, cols: 14, rows: 19 },
		{ width: 7131, height: 9536, cols: 7, rows: 10 },
		{ width: 3566, height: 4768, cols: 4, rows: 5 },
		{ width: 1783, height: 2384, cols: 2, rows: 3 },
		{ width: 892, height: 1192, cols: 1, rows: 2 },
		{ width: 446, height: 596, cols: 1, rows: 1 },
	],
};

test("pyramidLevels: halves, rounding up, until one piece holds a level", () => {
	assert.deepEqual(pyramidLevels(14262, 19072, 1024), meta.levels);
	assert.deepEqual(pyramidLevels(1000, 500, 1024), [{ width: 1000, height: 500, cols: 1, rows: 1 }]);
});

test("pyramidLevel: full size at 1:1 or closer, a level coarser per halving, clamped", () => {
	assert.equal(pyramidLevel(2, 6), 0);
	assert.equal(pyramidLevel(1, 6), 0);
	assert.equal(pyramidLevel(0.6, 6), 0);
	assert.equal(pyramidLevel(0.5, 6), 1);
	assert.equal(pyramidLevel(0.125, 6), 3);
	assert.equal(pyramidLevel(0.001, 6), 5);
});

test("pieceSize and pieceFrame: whole pieces are tile × scale, edge pieces are cut short", () => {
	assert.deepEqual(pieceSize(meta, 0, 0, 0), { width: 1024, height: 1024 });
	assert.deepEqual(pieceSize(meta, 0, 13, 18), { width: 14262 - (13 * 1024), height: 19072 - (18 * 1024) });
	assert.deepEqual(pieceSize(meta, 5, 0, 0), { width: 446, height: 596 });
	assert.deepEqual(pieceFrame(meta, 0, 0, 0), { x: 0, y: 0, width: 1024, height: 1024 });
	const edge = pieceFrame(meta, 0, 13, 18);
	assert.deepEqual([edge.x, edge.width, edge.height], [13 * 1024, 14262 - (13 * 1024), 19072 - (18 * 1024)]);
	// The top level is one piece covering the whole scene.
	const top = pieceFrame(meta, 5, 0, 0);
	assert.deepEqual([top.x, top.y, Math.round(top.width), Math.round(top.height)], [0, 0, 14262, 19072]);
});

test("piecesInView: the pieces under the view plus a margin, nearest the centre first, clamped", () => {
	const view = { x: 2100, y: 3100, width: 1500, height: 1100 };
	const keys = piecesInView(meta, 0, view, 0).map(p => p.key);
	assert.deepEqual(new Set(keys), new Set(["0/2_3", "0/3_3", "0/2_4", "0/3_4"]));
	assert.equal(piecesInView(meta, 0, view, 1).length, 4 * 4);
	const corner = piecesInView(meta, 0, { x: -500, y: -500, width: 600, height: 600 }, 1);
	assert.deepEqual(corner.map(p => p.key).sort(), ["0/0_0", "0/0_1", "0/1_0", "0/1_1"]);
	assert.equal(piecesInView(meta, 5, view, 1)[0].key, "5/0_0");
});

test("transcodeTarget: BC formats before ASTC, which Mesa only emulates; nothing known leaves it to Foundry", () => {
	// What Firefox reports on the Steam Deck.
	assert.equal(transcodeTarget({ s3tc: {}, bptc: {}, astc: {}, etc: {} }), "BC7_RGBA");
	assert.equal(transcodeTarget({ s3tc: {}, astc: {} }), "BC1_OR_3");
	// A phone: no BC formats.
	assert.equal(transcodeTarget({ astc: {}, etc: {} }), "ASTC_4x4_RGBA");
	assert.equal(transcodeTarget({ etc: {} }), "ETC2_RGBA");
	assert.equal(transcodeTarget({ bptc: undefined }), undefined);
});

test("fitScale: Foundry's fit modes, then the Tile's own scale and mirror", () => {
	assert.deepEqual(fitScale("fill", 300, 200, 600, 800), { x: 0.5, y: 0.25 });
	assert.deepEqual(fitScale("cover", 300, 200, 600, 800), { x: 0.5, y: 0.5 });
	assert.deepEqual(fitScale("contain", 300, 200, 600, 800), { x: 0.25, y: 0.25 });
	assert.deepEqual(fitScale("width", 300, 200, 600, 800), { x: 0.5, y: 0.5 });
	assert.deepEqual(fitScale("height", 300, 200, 600, 800), { x: 0.25, y: 0.25 });
	assert.deepEqual(fitScale("fill", 300, 200, 600, 800, -1, 2), { x: -0.5, y: 0.5 });
});

test("padPiece: the padding repeats the picture's last column, then its last row", () => {
	// A 4 x 4 piece whose picture is the top-left 2 x 3; each pixel's red is its index.
	const px = new Uint8Array(4 * 4 * 4);
	for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) px[((y * 4) + x) * 4] = (y * 2) + x + 1;
	padPiece(px, 4, 2, 3);
	const red = [...Array(16)].map((_, i) => px[i * 4]);
	assert.deepEqual(red, [1, 2, 2, 2, 3, 4, 4, 4, 5, 6, 6, 6, 5, 6, 6, 6]);
});

test("mipChain: each level averages 2 x 2 pixels of the last, rounding, down to 1 px", () => {
	const px = new Uint8Array(4 * 4 * 4);
	for (let i = 0; i < 16; i++) px.set([i * 16, 255, 0, i < 8 ? 255 : 0], i * 4);
	const levels = mipChain(px, 4);
	assert.deepEqual(levels.map(l => l.length), [64, 16, 4]);
	assert.equal(levels[0], px);
	// Top-left 2 x 2 of level 0: pixels 0, 1, 4, 5, red 0, 16, 64, 80, averaging 40.
	assert.deepEqual([...levels[1].slice(0, 4)], [40, 255, 0, 255]);
	// Bottom-right: pixels 10, 11, 14, 15, red 160, 176, 224, 240, averaging 200; alpha 0.
	assert.deepEqual([...levels[1].slice(12, 16)], [200, 255, 0, 0]);
	// Level 2: the four averages 40, 72, 168, 200 give 120; alpha 255, 255, 0, 0 rounds to 128.
	assert.deepEqual([...levels[2]], [120, 255, 0, 128]);
});

// A 100 px square grid stands in for the scene's hex grid: getOffset of a centre point.
const offsetOf = ({ x, y }) => ({ i: Math.floor(y / 100), j: Math.floor(x / 100) });
const tile = (x, y, flags, src = "art.webp") => ({
	x, y, width: 100, height: 80, sort: y + 40, texture: { src }, flags: { "shadowdark-extras": flags },
});

test("isKeyedTile and keyedEntries: keyed art is what carries hexNum, grouped by the hex under its centre", () => {
	const tiles = [
		tile(200, 110, { painted: true, hexNum: 1203 }, "keep.webp"),
		tile(225, 130, { hexcrawlFeature: true, hexNum: 1203 }, "icon.webp"),
		tile(400, 110, { painted: true }),
		tile(420, 130, { coast: true }),
	];
	assert.deepEqual(tiles.map(isKeyedTile), [true, true, false, false]);
	const entries = keyedEntries(tiles.filter(isKeyedTile), offsetOf);
	assert.deepEqual(Object.keys(entries), ["1-2"]);
	assert.deepEqual(entries["1-2"].map(e => e.src), ["keep.webp", "icon.webp"]);
	assert.deepEqual(entries["1-2"][0], {
		src: "keep.webp", x: 200, y: 110, width: 100, height: 80, sort: 150, elevation: 0, num: 1203,
	});
});

test("keyedSpriteView: players see a hex's keyed art once the fog shows it, and not from afar", () => {
	const player = state => keyedSpriteView({ isGM: false, fogOn: true, shown: false, ...state });
	assert.deepEqual(player({}), { visible: false, alpha: 1 });
	assert.deepEqual(player({ shown: true }), { visible: true, alpha: 1 });
	assert.deepEqual(player({ shown: true, discovery: "near" }), { visible: true, alpha: 1 });
	assert.deepEqual(player({ shown: true, discovery: "terrain" }), { visible: false, alpha: 1 });
	assert.deepEqual(player({ fogOn: false }), { visible: true, alpha: 1 });
});

test("keyedSpriteView: the GM sees every sprite, faded where the players can't", () => {
	assert.deepEqual(keyedSpriteView({ isGM: true, fogOn: true, shown: false }), { visible: true, alpha: 0.5 });
	const terrainOnly = keyedSpriteView({ isGM: true, fogOn: true, shown: true, discovery: "terrain" });
	assert.deepEqual(terrainOnly, { visible: true, alpha: 0.5 });
	assert.deepEqual(keyedSpriteView({ isGM: true, fogOn: true, shown: true }), { visible: true, alpha: 1 });
});
