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
		if (options !== undefined) assert.deepEqual(options, { keepId: true });
		const docs = data.map((entry, index) => ({ ...entry, id: entry._id ?? `baked-${created.length}-${index}` }));
		created.push(...structuredClone(docs));
		this.tiles.contents.push(...docs);
		return docs;
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

const { flattenTiles, formatBytes, hexBackgroundBakePlan, measureTileLoad } = await import("../../scripts/canvas/TileFlattenSD.mjs");

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

test("the bake captures the scene rectangle, not canvas 0,0, on a padded or shifted scene", async () => {
	// A scene whose map starts 391 px right and 186 px down of the canvas
	// origin: padding, or a grid shift like the Western Reaches print's.
	scene.dimensions = { sceneX: 391, sceneY: 186, sceneWidth: 14262, sceneHeight: 19072 };
	const positions = [];
	const render = renderer.render;
	renderer.render = function (stage, options) {
		positions.push([canvas.stage.position.x, canvas.stage.position.y]);
		return render.call(this, stage, options);
	};
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
		renderer.render = render;
		delete scene.dimensions;
	}
	const resolution = 8192 / 19072;
	assert.equal(positions.length, 1);
	assert.ok(Math.abs(positions[0][0] + (391 * resolution)) < 1e-6, "the capture window starts at sceneX");
	assert.ok(Math.abs(positions[0][1] + (186 * resolution)) < 1e-6, "and at sceneY");
	assert.deepEqual(renderedSizes.at(-1), [6126, 8192], "the same size as the scene rectangle");
	await flattenTiles([], { asBackground: true });
});

test("the bake quality setting picks the long side, capped by the renderer", async () => {
	const previousGet = game.settings.get;
	const bakeAt = async level => {
		game.settings.get = (_namespace, key) => key === "hexPainter.bakeQuality" ? level : undefined;
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
		await flattenTiles([], { asBackground: true });
	};

	try {
		renderedSizes.length = 0;
		await bakeAt("low");
		assert.deepEqual(renderedSizes.at(-1), [3063, 4096]);
		await bakeAt("high");
		assert.deepEqual(renderedSizes.at(-1), [9189, 12288]);
		await bakeAt("max");
		assert.deepEqual(renderedSizes.slice(-2), [[14262, 9536], [14262, 9536]], "max bakes full resolution in two pieces");
		await bakeAt("bogus");
		assert.deepEqual(renderedSizes.at(-1), [6126, 8192], "an unknown level falls back to the old cap");
	}
	finally {
		game.settings.get = previousGet;
	}
	assert.deepEqual(notifications.error, []);
});

test("the bake preloads distinct tile textures before rendering", async () => {
	const order = [];
	originalTiles[0].texture = { src: "tile-a.webp" };
	originalTiles[1].texture = { src: "tile-a.webp" }; // the same file twice — one preload
	globalThis.foundry.canvas = {
		loadTexture: async src => {
			order.push(`preload:${src}`);
			return {};
		},
	};
	const render = renderer.render;
	renderer.render = (stage, options) => {
		order.push("render");
		return render.call(renderer, stage, options);
	};
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
		renderer.render = render;
		delete globalThis.foundry.canvas;
		delete originalTiles[0].texture;
		delete originalTiles[1].texture;
		await flattenTiles([], { asBackground: true });
	}
	assert.equal(order[0], "preload:tile-a.webp", "the distinct source is loaded before the render");
	assert.ok(order.lastIndexOf("preload:tile-a.webp") < order.indexOf("render"), "and nothing renders before it resolves");
	assert.equal(order.filter(entry => entry === "preload:tile-a.webp").length, 1, "loaded once per file, not per tile");
});

test("the dialog's explicit quality beats the remembered last choice", async () => {
	const previousGet = game.settings.get;
	const previousSet = game.settings.set;
	const remembered = [];
	game.settings.get = (_namespace, key) => key === "hexPainter.bakeQuality" ? "low" : undefined;
	game.settings.set = async (_namespace, key, value) => {
		if (key === "hexPainter.bakeQuality") remembered.push(value);
	};
	const originalSetTimeout = globalThis.setTimeout;
	globalThis.setTimeout = callback => {
		callback();
		return 1;
	};
	try {
		renderedSizes.length = 0;
		await flattenTiles(originalTiles, { asBackground: true, quality: "high" });
		assert.deepEqual(renderedSizes.at(-1), [9189, 12288], "the picked level, not the remembered one");
		assert.deepEqual(remembered, ["high"], "and the pick is remembered for the next dialog");
	}
	finally {
		globalThis.setTimeout = originalSetTimeout;
		game.settings.get = previousGet;
		game.settings.set = previousSet;
		await flattenTiles([], { asBackground: true });
	}
});

test("a max bake splits an oversized map into image tiles and restores them", async () => {
	created.length = 0;
	deleted.length = 0;
	uploads.length = 0;
	renderedSizes.length = 0;
	const originalSetTimeout = globalThis.setTimeout;
	globalThis.setTimeout = callback => {
		callback();
		return 1;
	};
	try {
		await flattenTiles(originalTiles, { asBackground: true, quality: "max" });

		assert.deepEqual(renderedSizes, [[14262, 9536], [14262, 9536]], "one full-resolution render per piece");
		assert.equal(uploads.length, 2, "one upload per piece");
		assert.equal(created.length, 2, "one image tile per piece");
		assert.deepEqual(
			created.map(tile => [tile.x, tile.y, tile.width, tile.height]),
			[[0, 0, 14262, 9536], [0, 9536, 14262, 9536]],
		);
		assert.deepEqual(created[0].flags, { "shadowdark-extras": { bakedPiece: true } });
		assert.deepEqual(deleted.at(-1), ["left", "right"], "the original tiles are gone");
		assert.equal(flags.flattenedHexBackground.pieces.length, 2);
		assert.equal(flags.flattenedHexBackground.pieces[0]._id, created[0].id);

		await flattenTiles([], { asBackground: true });
		assert.deepEqual(deleted.at(-1), [created[0].id, created[1].id], "restore takes the pieces away");
		assert.equal(flags.flattenedHexBackground, undefined);
		assert.ok(scene.tiles.contents.some(tile => tile.id === "left"), "and the originals are back");
		assert.ok(scene.tiles.contents.some(tile => tile.id === "right"));
	}
	finally {
		globalThis.setTimeout = originalSetTimeout;
		if (flags.flattenedHexBackground) await flattenTiles([], { asBackground: true });
	}
});

test("the plan estimates the bake's webp size from the measured bakes", () => {
	const plan = hexBackgroundBakePlan({ width: 14262, height: 19072 }, renderer, "medium");
	assert.deepEqual([plan.pixelWidth, plan.pixelHeight], [6126, 8192]);
	assert.equal(plan.encodeLimited, false, "medium sits under the encoder ceiling");
	// The map's three real 6126x8192 flattens were 12.3, 12.7 and 13.0 MB;
	// the estimate must land within a "roughly" distance of the middle one.
	assert.ok(
		Math.abs(plan.estimatedBytes - 12_702_218) < 1_200_000,
		`estimate ${plan.estimatedBytes} is not near the real bakes`,
	);
	assert.equal(formatBytes(12_702_218), "12.1 MB");
	assert.equal(formatBytes(880 * 1024), "880 KB");

	// Max no longer clamps: it bakes the whole map at full resolution, split
	// into pieces that each stay under both walls (150 MP and 16384 px).
	const maxPlan = hexBackgroundBakePlan({ width: 14262, height: 19072 }, renderer, "max");
	assert.equal(maxPlan.encodeLimited, false);
	assert.equal(maxPlan.scalePercent, 100);
	assert.deepEqual([maxPlan.pixelWidth, maxPlan.pixelHeight], [14262, 19072]);
	assert.deepEqual(maxPlan.pieces, { cols: 1, rows: 2, count: 2 });
});

test("max sizes its piece grid to the encoder and texture walls", () => {
	const small = hexBackgroundBakePlan({ width: 10477, height: 14009 }, renderer, "max");
	assert.deepEqual(small.pieces, { cols: 1, rows: 1, count: 1 }, "a map under both walls stays one image");
	assert.equal(small.scalePercent, 100);

	const tall = hexBackgroundBakePlan({ width: 15000, height: 30000 }, renderer, "max");
	assert.deepEqual(tall.pieces, { cols: 2, rows: 2, count: 4 }, "splits until every piece is under 150 MP and 16384 px");
});

test("the tile load measurement sums distinct files once each", async () => {
	const requested = [];
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async (src, options) => {
		requested.push([src, options?.method]);
		return { ok: true, headers: { get: name => name === "content-length" ? "1024" : null } };
	};
	try {
		const load = await measureTileLoad([
			{ texture: { src: "a.webp" } },
			{ texture: { src: "a.webp" } },
			{ texture: { src: "b.webp" } },
			{},
		]);
		assert.deepEqual(load, { files: 2, bytes: 2048 });
		assert.equal(requested.length, 2, "each distinct file is asked once");
		assert.ok(requested.every(([, method]) => method === "HEAD"));
	}
	finally {
		globalThis.fetch = previousFetch;
	}
});

test("an unmeasurable tile file leaves the total unknown rather than guessed", async () => {
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error("blocked");
	};
	try {
		const load = await measureTileLoad([{ texture: { src: "x.webp" } }]);
		assert.deepEqual(load, { files: 1, bytes: null });
	}
	finally {
		globalThis.fetch = previousFetch;
	}
});
