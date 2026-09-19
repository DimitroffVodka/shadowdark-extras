import assert from "node:assert/strict";
import test from "node:test";

import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";

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

const uploads = [];
globalThis.foundry.applications = {
	apps: {
		FilePicker: {
			implementation: {
				async browse() {},
				async createDirectory() {},
				async upload(_source, _directory, file) {
					uploads.push(file.name);
					return { path: `flattened-tiles/${file.name}` };
				},
			},
		},
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
const renderedSizes = [];
globalThis.PIXI.SCALE_MODES = { LINEAR: 1 };
globalThis.PIXI.RenderTexture = {
	create({ width, height }) {
		return {
			width,
			height,
			baseTexture: {},
			destroy() {},
		};
	},
};

const renderer = {
	gl: {
		MAX_TEXTURE_SIZE: 0x0D33,
		getParameter(parameter) {
			return parameter === this.MAX_TEXTURE_SIZE ? 16384 : null;
		},
	},
	screen: { width: 1920, height: 1080 },
	background: { alpha: 1, color: 0 },
	backgroundAlpha: 1,
	render(_stage, { renderTexture }) {
		renderedSizes.push([renderTexture.width, renderTexture.height]);
	},
	extract: {
		canvas(renderTexture) {
			return {
				width: renderTexture.width,
				height: renderTexture.height,
				toBlob(callback) {
					callback(new Blob(["webp"], { type: "image/webp" }));
				},
			};
		},
	},
};

function makeTile(id, x, width) {
	const doc = {
		id,
		x,
		y: 0,
		width,
		height: 19072,
		rotation: 0,
		elevation: 0,
		flags: {},
		toObject() {
			return { _id: id, x, y: 0, width, height: 19072, flags: {} };
		},
	};
	doc.object = {
		document: doc,
		visible: true,
		renderable: true,
		sprite: { visible: true, renderable: true },
	};
	return doc;
}

const originalTiles = [makeTile("left", 0, 7131), makeTile("right", 7131, 7131)];
const levelData = {
	_id: "level-1",
	background: { src: null },
	textures: {
		anchorX: 0.5,
		anchorY: 0.5,
		offsetX: 0,
		offsetY: 0,
		fit: "fill",
		scaleX: 1,
		scaleY: 1,
		rotation: 0,
	},
};
const level = {
	id: levelData._id,
	toObject() {
		return structuredClone(levelData);
	},
};
const flags = {};
const created = [];
const deleted = [];
const levelUpdates = [];
const scene = {
	id: "large-map",
	width: 14262,
	height: 19072,
	tiles: { contents: [...originalTiles] },
	levels: {
		contents: [level],
		get(id) { return id === level.id ? level : undefined; },
	},
	getFlag(_namespace, key) { return flags[key]; },
	async setFlag(_namespace, key, value) { flags[key] = structuredClone(value); },
	async unsetFlag(_namespace, key) { delete flags[key]; },
	async updateEmbeddedDocuments(type, updates) {
		assert.equal(type, "Level");
		levelUpdates.push(...structuredClone(updates));
	},
	async createEmbeddedDocuments(type, data, options) {
		assert.equal(type, "Tile");
		assert.deepEqual(options, { keepId: true });
		created.push(...structuredClone(data));
		this.tiles.contents.push(...data.map(entry => ({ ...entry, id: entry._id })));
		return data;
	},
	async deleteEmbeddedDocuments(type, ids) {
		assert.equal(type, "Tile");
		deleted.push(ids);
		this.tiles.contents = this.tiles.contents.filter(tile => !ids.includes(tile.id));
	},
};

globalThis.canvas = {
	ready: true,
	scene,
	level,
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
	tiles: { placeables: originalTiles.map(document => document.object) },
	background: { placeables: [] },
	drawings: { placeables: [], visible: true },
	interface: { children: [], grid: { visible: true } },
	grid: { visible: true },
	effects: { visible: true },
};

const { flattenTiles } = await import("../../scripts/canvas/TileFlattenSD.mjs");

test("oversized hex maps bake into one downscaled reversible scene background", async () => {
	const originalSetTimeout = globalThis.setTimeout;
	globalThis.setTimeout = callback => {
		callback();
		return 1;
	};
	try {
		await flattenTiles(originalTiles, { asBackground: true });
	}
	finally {
		globalThis.setTimeout = originalSetTimeout;
	}

	assert.deepEqual(notifications.error, []);
	assert.deepEqual(renderedSizes, [[6126, 8192]]);
	assert.equal(uploads.length, 1);
	assert.deepEqual(deleted, [["left", "right"]]);
	assert.equal(scene.tiles.contents.length, 0);
	assert.equal(flags.flattenedHexBackground.tiles.length, 2);
	assert.match(levelUpdates[0]["background.src"], /^flattened-tiles\/flatten-large-map-/);

	await flattenTiles([], { asBackground: true });
	assert.equal(created.length, 2);
	assert.deepEqual(created.map(tile => tile._id), ["left", "right"]);
	assert.deepEqual(levelUpdates[1].background, { src: null });
	assert.equal(flags.flattenedHexBackground, undefined);
});
