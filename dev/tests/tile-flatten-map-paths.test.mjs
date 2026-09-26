import assert from "node:assert/strict";
import test from "node:test";

import { installCanvasGlobals, StubContainer } from "./helpers/pixi-harness.mjs";

const MODULE_ID = "shadowdark-extras";
const { notifications } = installCanvasGlobals();

globalThis.requestAnimationFrame = callback => {
	callback();
	return 1;
};
globalThis.File = class extends Blob {
	constructor(parts, name, options) {
		super(parts, options);
		this.name = name;
	}
};

globalThis.foundry.applications = {
	apps: {
		FilePicker: {
			implementation: {
				async browse() {},
				async createDirectory() {},
				async upload() { return { path: "flattened-tiles/map.webp" }; },
			},
		},
	},
};

globalThis.PIXI.SCALE_MODES = { LINEAR: 1 };
globalThis.PIXI.RenderTexture = {
	create({ width, height }) {
		return { width, height, baseTexture: {}, destroy() {} };
	},
};

const point = (x, y) => ({
	x,
	y,
	set(nextX, nextY = nextX) {
		this.x = nextX;
		this.y = nextY;
	},
});
const opaqueCanvas = (width, height) => ({
	width,
	height,
	getContext() {
		return {
			getImageData() {
				const data = new Uint8ClampedArray(width * height * 4);
				for (let i = 3; i < data.length; i += 4) data[i] = 255;
				return { data };
			},
		};
	},
	toBlob(callback) { callback(new Blob(["webp"], { type: "image/webp" })); },
});

const pathGraphics = new StubContainer();
const otherGraphics = new StubContainer();
const pathLayer = new StubContainer();
pathLayer.addChild(pathGraphics, otherGraphics);
const drawingsLayer = new StubContainer();
drawingsLayer.placeables = [];
const unrelatedInterface = new StubContainer();
const renderStates = [];
const renderer = {
	gl: { MAX_TEXTURE_SIZE: 0x0D33, getParameter: () => 4096 },
	screen: { width: 1920, height: 1080 },
	background: { alpha: 1, color: 0 },
	backgroundAlpha: 1,
	render() {
		renderStates.push({
			path: pathGraphics.visible,
			other: otherGraphics.visible,
			interface: unrelatedInterface.visible,
		});
	},
	extract: { canvas: texture => opaqueCanvas(texture.width, texture.height) },
};

const mapPath = {
	drawingId: "map-network-road",
	type: "mapNetwork",
	permanent: true,
	networkPaths: { road: [[[0, 50], [200, 50]]], river: [] },
};
let permanentDrawings = [mapPath];
const deletedPaths = [];
const renderedPaths = [];
const drawingTool = {
	canvasLayer: pathLayer,
	_permanentDrawings: [
		{ id: mapPath.drawingId, graphics: pathGraphics },
		{ id: "ordinary-note", graphics: otherGraphics },
	],
	async deleteAnyDrawing(id) {
		deletedPaths.push(id);
		permanentDrawings = permanentDrawings.filter(path => path.drawingId !== id);
	},
	_renderPermanentEntry(path) { renderedPaths.push(path.drawingId); },
	_broadcast() {},
};
globalThis.game.shadowdarkExtras = { drawingTool };

const created = [];
const deleted = [];
const scene = {
	id: "map-path-flatten",
	async createEmbeddedDocuments(type, data) {
		assert.equal(type, "Tile");
		const docs = data.map((entry, index) => ({
			...entry,
			id: `created-${created.length + index}`,
		}));
		created.push(...docs);
		return docs;
	},
	async deleteEmbeddedDocuments(type, ids) { deleted.push({ type, ids }); },
	getFlag(_scope, key) {
		return key === "permanentDrawings" ? permanentDrawings : undefined;
	},
	async setFlag(_scope, key, value) {
		if (key === "permanentDrawings") permanentDrawings = value;
	},
};

function makeTile(id, x) {
	const document = {
		id,
		x,
		y: 0,
		width: 100,
		height: 100,
		rotation: 0,
		elevation: 0,
		toObject() { return { _id: id, x, y: 0, width: 100, height: 100 }; },
	};
	document.object = {
		document,
		visible: true,
		renderable: true,
		sprite: { visible: true, renderable: true },
	};
	return document;
}
const tiles = [makeTile("left", 0), makeTile("right", 100)];

globalThis.canvas = {
	ready: true,
	scene,
	stage: {
		scale: point(1, 1),
		position: point(0, 0),
		pivot: point(0, 0),
		updateTransform() {},
	},
	app: { renderer },
	primary: {
		children: [],
		displayed: true,
		sprite: { visible: true, renderable: true },
		clearColor: [0, 0, 0, 1],
		updateTransform() {},
	},
	tiles: { placeables: tiles.map(document => document.object) },
	background: { placeables: [] },
	drawings: drawingsLayer,
	interface: { children: [drawingsLayer, pathLayer, unrelatedInterface], grid: { visible: true } },
	grid: { visible: true },
	effects: { visible: true },
};

const { flattenTiles, unflattenTile } = await import("../../scripts/canvas/TileFlattenSD.mjs");

test("Flatten Map bakes only selected Roads/Rivers and restores them on unflatten", async () => {
	const originalSetTimeout = globalThis.setTimeout;
	globalThis.setTimeout = callback => {
		callback();
		return 1;
	};
	try {
		await flattenTiles(tiles, { mapPaths: [mapPath] });
		assert.deepEqual(notifications.error, []);
		assert.deepEqual(renderStates, [{ path: true, other: false, interface: false }]);
		assert.equal(otherGraphics.visible, true, "temporary visibility is restored");
		assert.equal(unrelatedInterface.visible, true, "other interface layers are restored");
		assert.deepEqual(created[0].flags[MODULE_ID].mapPaths, [mapPath]);
		assert.deepEqual(deletedPaths, [mapPath.drawingId]);
		assert.deepEqual(deleted[0], { type: "Tile", ids: ["left", "right"] });

		await unflattenTile(created[0]);
		assert.deepEqual(permanentDrawings, [mapPath]);
		assert.deepEqual(renderedPaths, [mapPath.drawingId]);
		assert.deepEqual(deleted.at(-1), { type: "Tile", ids: [created[0].id] });
	}
	finally {
		globalThis.setTimeout = originalSetTimeout;
	}
});
