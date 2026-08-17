import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals, installDom } from "./helpers/pixi-harness.mjs";

installCanvasGlobals();
installDom();

globalThis.game.scenes = { get: () => null };
globalThis.game.settings = {
	get: () => undefined,
	set: async () => {},
	register() {},
	registerMenu() {},
};
globalThis.game.i18n = { localize: key => key };
globalThis.canvas.grid = { size: 100, isHexagonal: false };
globalThis.CONST = {
	GRID_TYPES: { SQUARE: 1 },
	DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 },
};
globalThis.foundry.applications = {
	api: {
		ApplicationV2: class {},
		HandlebarsApplicationMixin: Base => Base,
		DialogV2: class {},
	},
	apps: { FilePicker: class {} },
	ux: { TextEditor: {} },
};
globalThis.foundry.canvas = { layers: { CanvasLayer: class {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };

const painter = await import("../../scripts/dungeon/DungeonPainterSD.mjs");
const generator = await import("../../scripts/dungeon/DungeonGeneratorSD.mjs");
const cave = await import("../../scripts/dungeon/DungeonCaveSD.mjs");
const interiorWalls = await import("../../scripts/dungeon/dungeon-interior-walls.mjs");
const auraRegions = await import("../../scripts/effects/aura-regions.mjs");
const dungeonRegions = await import("../../scripts/dungeon/DungeonRegionsSD.mjs");
const multiLevel = await import("../../scripts/dungeon/DungeonMultiLevelSD.mjs");
const { MaphubViewerApp } = await import("../../scripts/MaphubViewerApp.mjs");
const tileFlatten = await import("../../scripts/canvas/TileFlattenSD.mjs");

const FLOOR = new Set(["0,0"]);
const NO_ENTRANCES = new Set();

test("Painter wall drawings carry lifetime ownership evidence at creation", () => {
	const [drawing] = painter.generateWallVisualsWithElevation(
		FLOOR, NO_ENTRANCES, 100, 20, 0, 10, "wall.webp",
	);

	assert.equal(drawing.flags["shadowdark-extras"].placeableNotesExcluded, true);
	assert.equal(drawing.flags["shadowdark-extras"].dungeonWall, true);
});

test("Generator wall drawings carry lifetime ownership evidence at creation", () => {
	const [drawing] = generator.generateWallVisuals(
		FLOOR,
		{ x: 0, y: 0 },
		{ useTexture: true, wallThickness: 20, wallTilePath: "wall.webp" },
		[],
	);

	assert.equal(drawing.flags["shadowdark-extras"].placeableNotesExcluded, true);
	assert.equal(drawing.flags["shadowdark-extras"].dungeonWall, true);
});

test("Curved-wall drawings carry lifetime ownership evidence at creation", () => {
	const [drawing] = cave.generateCurvedWallVisuals(
		[{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false }],
		{ useTexture: true, wallThickness: 20, wallTilePath: "wall.webp" },
	);

	assert.equal(drawing.flags["shadowdark-extras"].placeableNotesExcluded, true);
	assert.equal(drawing.flags["shadowdark-extras"].dungeonWall, true);
});

test("Painter background persistence carries lifetime ownership evidence", async () => {
	const previousScene = globalThis.canvas.scene;
	const created = [];
	const scene = {
		id: "scene-1",
		width: 1000,
		height: 800,
		padding: 0,
		grid: { size: 100 },
		drawings: { find: () => null },
		createEmbeddedDocuments: async (type, data) => {
			created.push({ type, data });
			return [{ id: "drawing-1", elevation: 0 }];
		},
		updateEmbeddedDocuments: async () => {},
	};

	globalThis.canvas.scene = scene;
	try {
		await painter.ensureBackgroundDrawing(scene, 0, "color-black");
	}
	finally {
		globalThis.canvas.scene = previousScene;
	}

	assert.equal(created.length, 1);
	assert.equal(created[0].type, "Drawing");
	assert.equal(created[0].data[0].flags["shadowdark-extras"].placeableNotesExcluded, true);
	assert.equal(created[0].data[0].flags["shadowdark-extras"].dungeonBackground, true);
});

test("Interior-wall Drawing persistence carries lifetime ownership evidence", async () => {
	const previousScene = globalThis.canvas.scene;
	const previousNoFoundryWalls = painter.getNoFoundryWalls();
	const created = [];
	const scene = {
		drawings: [],
		createEmbeddedDocuments: async (type, data) => {
			created.push({ type, data });
			return [{ id: "drawing-1", elevation: 0 }];
		},
		updateEmbeddedDocuments: async () => {},
	};

	globalThis.canvas.scene = scene;
	painter.selectIntWallTile("interior-wall.webp");
	painter.setNoFoundryWalls(true);
	try {
		await interiorWalls.handleIntWallDrag({ x: 0, y: 0 }, { x: 100, y: 0 });
	}
	finally {
		painter.setNoFoundryWalls(previousNoFoundryWalls);
		globalThis.canvas.scene = previousScene;
	}

	const drawingCreate = created.find(entry => entry.type === "Drawing");
	assert.ok(drawingCreate, "the interior wall drag must persist a Drawing");
	assert.equal(drawingCreate.data[0].flags["shadowdark-extras"].placeableNotesExcluded, true);
	assert.equal(drawingCreate.data[0].flags["shadowdark-extras"].dungeonWall, true);
	assert.equal(drawingCreate.data[0].flags["shadowdark-extras"].dungeonIntWall, true);
});

test("post-review proof gap: interior-wall click Drawing persistence carries lifetime ownership evidence", async () => {
	const previousScene = globalThis.canvas.scene;
	const previousDoorTile = painter.getSelectedIntDoorTile();
	const previousNoFoundryWalls = painter.getNoFoundryWalls();
	const created = [];
	const scene = {
		grid: { size: 100 },
		drawings: [{
			id: "drawing-1",
			x: 0,
			y: 0,
			rotation: 0,
			shape: { type: "r", width: 200, height: 20 },
			texture: "interior-wall.webp",
			flags: { "shadowdark-extras": { dungeonIntWall: true } },
		}],
		walls: [],
		deleteEmbeddedDocuments: async () => {},
		createEmbeddedDocuments: async (type, data) => {
			created.push({ type, data });
			return data.map((entry, index) => ({ id: `${type.toLowerCase()}-${index}` }));
		},
		updateEmbeddedDocuments: async () => {},
	};

	globalThis.canvas.scene = scene;
	painter.selectIntDoorTile("door-horizontal.webp");
	painter.setNoFoundryWalls(true);
	try {
		await interiorWalls.handleIntWallClick({ x: 100, y: 10 });
	}
	finally {
		painter.selectIntDoorTile(previousDoorTile);
		painter.setNoFoundryWalls(previousNoFoundryWalls);
		globalThis.canvas.scene = previousScene;
	}

	const drawingCreate = created.find(entry => entry.type === "Drawing");
	assert.ok(drawingCreate, "the interior wall click must persist replacement Drawings");
	assert.ok(drawingCreate.data.length > 0);
	for (const drawing of drawingCreate.data) {
		assert.equal(drawing.flags["shadowdark-extras"].placeableNotesExcluded, true);
		assert.equal(drawing.flags["shadowdark-extras"].dungeonWall, true);
		assert.equal(drawing.flags["shadowdark-extras"].dungeonIntWall, true);
	}
});

test("post-review proof gap: interior-door removal Drawing persistence carries lifetime ownership evidence", async () => {
	const previousScene = globalThis.canvas.scene;
	const previousWallTile = painter.getSelectedIntWallTile();
	const previousNoFoundryWalls = painter.getNoFoundryWalls();
	const created = [];
	const scene = {
		drawings: [
			{
				id: "drawing-left",
				x: 0,
				y: -10,
				rotation: 0,
				shape: { type: "r", width: 100, height: 20 },
				texture: "interior-wall.webp",
				flags: { "shadowdark-extras": { dungeonIntWall: true } },
			},
			{
				id: "drawing-right",
				x: 200,
				y: -10,
				rotation: 0,
				shape: { type: "r", width: 100, height: 20 },
				texture: "interior-wall.webp",
				flags: { "shadowdark-extras": { dungeonIntWall: true } },
			},
		],
		walls: [
			{ id: "door-1", c: [100, 0, 200, 0], door: 1, flags: { "shadowdark-extras": { dungeonIntDoor: true } } },
			{ id: "wall-left", c: [0, 0, 100, 0], flags: { "shadowdark-extras": { dungeonIntWall: true } } },
			{ id: "wall-right", c: [200, 0, 300, 0], flags: { "shadowdark-extras": { dungeonIntWall: true } } },
		],
		deleteEmbeddedDocuments: async () => {},
		createEmbeddedDocuments: async (type, data) => {
			created.push({ type, data });
			return data.map((entry, index) => ({ id: `${type.toLowerCase()}-${index}` }));
		},
		updateEmbeddedDocuments: async () => {},
	};

	globalThis.canvas.scene = scene;
	painter.selectIntWallTile("interior-wall.webp");
	painter.setNoFoundryWalls(true);
	try {
		await interiorWalls.handleIntWallDoorRemove({ x: 150, y: 0 });
	}
	finally {
		painter.selectIntWallTile(previousWallTile);
		painter.setNoFoundryWalls(previousNoFoundryWalls);
		globalThis.canvas.scene = previousScene;
	}

	const drawingCreate = created.find(entry => entry.type === "Drawing");
	assert.ok(drawingCreate, "interior-door removal must persist a merged Drawing");
	assert.equal(drawingCreate.data.length, 1);
	assert.equal(drawingCreate.data[0].flags["shadowdark-extras"].placeableNotesExcluded, true);
	assert.equal(drawingCreate.data[0].flags["shadowdark-extras"].dungeonWall, true);
	assert.equal(drawingCreate.data[0].flags["shadowdark-extras"].dungeonIntWall, true);
});

test("Aura Region persistence carries lifetime ownership evidence", async () => {
	const previousGame = globalThis.game;
	const previousCanvas = globalThis.canvas;
	const previousFoundry = globalThis.foundry;
	const previousConst = globalThis.CONST;
	const regionCreates = [];
	const actor = {
		id: "actor-1",
		effects: [],
		createEmbeddedDocuments: async (_type, [data]) => {
			const effect = {
				id: "effect-1",
				parent: actor,
				flags: data.flags,
				update: async changes => Object.assign(effect, changes),
			};
			actor.effects.push(effect);
			return [effect];
		},
		deleteEmbeddedDocuments: async () => {},
	};
	const token = {
		id: "token-1",
		actor,
		document: { persisted: true },
		center: { x: 0, y: 0 },
	};
	const scene = { id: "scene-1", regions: [] };
	const regionDocument = {
		createTokenEmanation: async (_tokenDoc, _radius, data) => {
			regionCreates.push(data);
			return { id: "region-1", update: async () => {} };
		},
	};

	globalThis.game = {
		user: { isGM: true },
		combat: null,
		time: { worldTime: 1 },
		modules: { get: () => ({ active: false }) },
	};
	globalThis.canvas = {
		scene,
		grid: { size: 100 },
		tokens: { placeables: [token], get: id => id === token.id ? token : null },
	};
	globalThis.foundry = {
		...previousFoundry,
		documents: { RegionDocument: { implementation: regionDocument } },
	};
	globalThis.CONST = { REGION_VISIBILITY: { LAYER_UNLOCKED: 4 } };

	try {
		await auraRegions.createAuraOnActor(
			actor,
			{ radius: 30, nativeRegion: { enabled: true } },
			{ id: "spell-1", name: "Light", img: "light.webp", uuid: "Item.spell-1" },
		);
	}
	finally {
		globalThis.game = previousGame;
		globalThis.canvas = previousCanvas;
		globalThis.foundry = previousFoundry;
		globalThis.CONST = previousConst;
	}

	assert.equal(regionCreates.length, 1);
	assert.equal(regionCreates[0].flags["shadowdark-extras"].placeableNotesExcluded, true);
	assert.equal(regionCreates[0].flags["shadowdark-extras"].auraRegion, true);
});

test("post-review proof gap: multi-level generator persists connector ownership on its first Region payload", async () => {
	const previousGame = globalThis.game;
	const previousCanvas = globalThis.canvas;
	const previousUi = globalThis.ui;
	const created = [];
	const makeCollection = () => {
		const collection = [];
		collection.get = id => collection.find(doc => doc.id === id);
		return collection;
	};
	const scene = {
		id: "scene-1",
		width: 1000,
		height: 1000,
		padding: 0,
		grid: { size: 100, type: 1 },
		levels: makeCollection(),
		tiles: makeCollection(),
		walls: makeCollection(),
		drawings: makeCollection(),
		lights: makeCollection(),
		regions: makeCollection(),
		update: async changes => {
			for (const [key, value] of Object.entries(changes)) {
				if (key.includes(".")) {
					const [root, child] = key.split(".");
					scene[root] ??= {};
					scene[root][child] = value;
				}
				else scene[key] = value;
			}
		},
		createEmbeddedDocuments: async (type, data) => {
			created.push({ type, data });
			const collection = scene[type === "AmbientLight" ? "lights" : `${type.toLowerCase()}s`];
			const baseIndex = collection.length;
			return data.map((entry, index) => {
				const doc = structuredClone(entry);
				doc.id = `${type.toLowerCase()}-${baseIndex + index}`;
				collection.push(doc);
				return doc;
			});
		},
		updateEmbeddedDocuments: async (type, updates) => {
			const collection = scene[type === "AmbientLight" ? "lights" : `${type.toLowerCase()}s`];
			for (const update of updates) {
				const doc = collection.find(entry => entry.id === update._id);
				if (!doc) continue;
				for (const [key, value] of Object.entries(update)) {
					if (key === "_id") continue;
					const parts = key.split(".");
					let target = doc;
					while (parts.length > 1) {
						const part = parts.shift();
						target[part] ??= {};
						target = target[part];
					}
					target[parts[0]] = value;
				}
			}
		},
		deleteEmbeddedDocuments: async (type, ids) => {
			const collection = scene[type === "AmbientLight" ? "lights" : `${type.toLowerCase()}s`];
			for (let i = collection.length - 1; i >= 0; i--) {
				if (ids.includes(collection[i].id)) collection.splice(i, 1);
			}
		},
	};
	globalThis.game = {
		user: { isGM: true },
		scenes: { get: id => id === scene.id ? scene : null },
		modules: { get: () => ({ active: false }) },
		settings: { get: () => undefined, set: async () => {} },
	};
	globalThis.canvas = { ...previousCanvas, scene, grid: { size: 100, isHexagonal: false } };
	globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

	try {
		await multiLevel.generateMultiLevelDungeon({
			scene,
			seed: "review-proof",
			levelCount: 2,
			levelHeight: 10,
			connectionsPerPair: 1,
			anchorCount: 2,
			sharedFootprint: true,
			roomCount: 10,
			density: 0.6,
			branching: 0.5,
			roomSizeBias: 0.5,
			variation: 0,
			connectorVariety: 0,
			clutter: 0,
			decorLights: 0,
			decorTiles: false,
			style: "rooms",
			useTexture: false,
			floorTexture: "floor.webp",
			wallThickness: 20,
		});
	}
	finally {
		globalThis.game = previousGame;
		globalThis.canvas = previousCanvas;
		globalThis.ui = previousUi;
	}

	const regionCreate = created.find(entry => entry.type === "Region");
	assert.ok(regionCreate, "multi-level generation must persist a connector Region");
	assert.equal(regionCreate.data.length, 1);
	const region = regionCreate.data[0];
	assert.equal(region.flags["shadowdark-extras"].placeableNotesExcluded, true);
	assert.equal(region.name, "Stairs L1↔L2");
	assert.deepEqual(region.levels, ["level-0", "level-1"]);
	assert.equal(region.shapes.length, 1);
	assert.equal(region.shapes[0].type, "rectangle");
	assert.equal(region.shapes[0].width, 100);
	assert.equal(region.shapes[0].height, 100);
	assert.equal(region.shapes[0].hole, false);
	assert.deepEqual(region.behaviors, [{
		name: "Change Level",
		type: "changeLevel",
		system: { movementActions: [] },
	}]);
});

test("post-review public API boundary: direct placeChangeLevelRegion remains an eligible one-time Region", async () => {
	const previousGame = globalThis.game;
	const created = [];
	const scene = {
		levels: new Map([
			["level-a", { elevation: { bottom: 0, top: 10 } }],
			["level-b", { elevation: { bottom: -10, top: 0 } }],
		]),
		createEmbeddedDocuments: async (type, data) => {
			created.push({ type, data });
			return [{ id: "region-1", name: data[0].name }];
		},
	};
	globalThis.game = { scenes: { get: () => scene } };

	try {
		await dungeonRegions.placeChangeLevelRegion({
			sceneId: "scene-1",
			x: 50,
			y: 50,
			levels: ["level-a", "level-b"],
			placeableNotesExcluded: true,
		});
	}
	finally {
		globalThis.game = previousGame;
	}

	assert.equal(created[0].data[0].flags?.["shadowdark-extras"]?.placeableNotesExcluded, undefined);
});

test("characterization: placeDungeonSurface remains an eligible durable Region", async () => {
	const previousGame = globalThis.game;
	const created = [];
	const level = { id: "level-a", elevation: { bottom: 0, top: 10 } };
	const scene = {
		levels: new Map([[level.id, level]]),
		tiles: [{
			id: "tile-1",
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			levels: [level.id],
			flags: { "shadowdark-extras": { dungeonFloor: true } },
		}],
		createEmbeddedDocuments: async (type, data) => {
			created.push({ type, data });
			return [{ id: "region-1", name: data[0].name }];
		},
	};
	globalThis.game = { scenes: { get: () => scene } };

	try {
		await dungeonRegions.placeDungeonSurface({ sceneId: "scene-1", levelId: level.id });
	}
	finally {
		globalThis.game = previousGame;
	}

	assert.equal(created.length, 1);
	assert.equal(created[0].type, "Region");
	assert.equal(created[0].data[0].flags?.["shadowdark-extras"]?.placeableNotesExcluded, undefined);
});

test("characterization: MapHub dwelling stair and spiral Regions remain eligible", async () => {
	const previousGame = globalThis.game;
	const previousScene = globalThis.Scene;
	const previousTimeout = globalThis.setTimeout;
	const created = [];
	const levels = [
		{ id: "level-1", elevation: { bottom: 0, top: 10 } },
		{ id: "level-2", elevation: { bottom: 10, top: 20 } },
	];
	const scene = {
		name: "Imported",
		width: 200,
		height: 200,
		levels: {
			contents: levels,
			find: predicate => levels.find(predicate),
		},
		activate: async () => {},
		createEmbeddedDocuments: async (type, data) => {
			created.push({ type, data });
			return data.map((entry, index) => ({ id: `${type}-${index}`, name: entry.name }));
		},
	};
	const floor1 = {
		contour: [{ a: { i: 0, j: 0 }, b: { i: 2, j: 2 } }],
		rooms: [],
		stairs: [],
		spiral: {
			landing: { i: 0, j: 0 },
			entrance: { a: { i: 4, j: 4 }, b: { i: 5, j: 5 } },
			exit: { a: { i: 6, j: 6 }, b: { i: 7, j: 7 } },
		},
	};
	const floor2 = {
		contour: [{ a: { i: 0, j: 0 }, b: { i: 2, j: 2 } }],
		rooms: [],
		stairs: [],
	};
	floor1.stairs.push({ cell: { i: 1, j: 1 }, to: { plan: floor2 } });
	const view = {
		house: { floors: [floor1, floor2] },
		setFloor() {},
		map: { __getRenderTransform: () => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }) },
	};
	const app = new MaphubViewerApp({ type: "dwellings" });
	app._getDwellView = () => view;
	app._setDwellUiVisible = () => {};
	app._grabCanvas = () => ({ width: 100, height: 100 });
	app._detectBuildingBBox = () => ({ w: 100, h: 100 });
	app._warpFloorImage = async () => "floor.webp";
	app._getMapLabel = () => "Imported";
	app._cleanupCaveView = () => {};
	app.close = async () => {};
	globalThis.game = { user: { isGM: true } };
	globalThis.Scene = { create: async () => scene };
	globalThis.setTimeout = callback => {
		callback();
		return 0;
	};

	try {
		assert.equal(await app._importDwellingScene(), true);
	}
	finally {
		globalThis.game = previousGame;
		globalThis.Scene = previousScene;
		globalThis.setTimeout = previousTimeout;
	}

	const regionCreate = created.find(entry => entry.type === "Region");
	assert.ok(regionCreate, "MapHub dwelling import must persist its Regions");
	assert.ok(regionCreate.data.some(region => region.flags?.["shadowdark-extras"]?.spiral));
	assert.ok(regionCreate.data.some(region => region.name.startsWith("Stairs:")));
	for (const region of regionCreate.data) {
		assert.equal(region.flags?.["shadowdark-extras"]?.placeableNotesExcluded, undefined);
	}
});

function makeTileFlattenFixture() {
	const created = [];
	const deleted = [];
	// Start from the real generator payload, then model notes added before flattening.
	const [dungeonDrawing] = painter.generateWallVisualsWithElevation(
		FLOOR, NO_ENTRANCES, 100, 20, 0, 10, "wall.webp",
	);
	dungeonDrawing._id = "dungeon-drawing-1";
	dungeonDrawing.x = 100;
	dungeonDrawing.y = 200;
	Object.assign(dungeonDrawing.flags["shadowdark-extras"], {
		notes: "<p>dungeon note</p>",
		noteVisible: true,
		customName: "Dungeon wall",
	});
	const scene = {
		createEmbeddedDocuments: async (type, data) => {
			created.push({ type, data });
			return data.map((entry, index) => ({ id: `${type}-${index}` }));
		},
		deleteEmbeddedDocuments: async (type, ids) => {
			deleted.push({ type, ids });
		},
	};
	const tileDoc = {
		id: "flattened-1",
		x: 110,
		y: 220,
		flags: {
			"shadowdark-extras": {
				flattenedTile: true,
				originalPosition: { x: 100, y: 200 },
				drawings: [
					{
						data: dungeonDrawing,
					},
					{
						data: {
							_id: "user-drawing-1",
							x: 300,
							y: 400,
							flags: {
								"shadowdark-extras": {
									notes: "<p>user note</p>",
									noteVisible: false,
									customName: "User drawing",
								},
							},
						},
					},
				],
			},
		},
	};
	return { scene, tileDoc, created, deleted };
}

async function runTileFlattenFixture() {
	const previousScene = globalThis.canvas.scene;
	const fixture = makeTileFlattenFixture();
	globalThis.canvas.scene = fixture.scene;
	try {
		await tileFlatten.unflattenTile(fixture.tileDoc);
	}
	finally {
		globalThis.canvas.scene = previousScene;
	}
	const drawingCreate = fixture.created.find(entry => entry.type === "Drawing");
	assert.ok(drawingCreate, "TileFlatten must recreate stored Drawings");
	assert.equal(drawingCreate.data.length, 2);
	return { ...fixture, dungeonDrawing: drawingCreate.data[0], userDrawing: drawingCreate.data[1] };
}

test("characterization: TileFlatten preserves excluded dungeon legacy ownership flag", async () => {
	const { dungeonDrawing } = await runTileFlattenFixture();
	assert.equal(dungeonDrawing._id, undefined, "restoration creates a fresh Drawing id");
	assert.equal(dungeonDrawing.x, 110);
	assert.equal(dungeonDrawing.flags["shadowdark-extras"].dungeonWall, true);
});

test("characterization: TileFlatten preserves excluded dungeon opt-out flag", async () => {
	const { dungeonDrawing } = await runTileFlattenFixture();
	assert.equal(dungeonDrawing.flags["shadowdark-extras"].placeableNotesExcluded, true);
});

test("characterization: source-shaped TileFlatten preserves dungeon and user notes", async () => {
	const { dungeonDrawing, userDrawing } = await runTileFlattenFixture();
	assert.deepEqual(dungeonDrawing.flags["shadowdark-extras"].notes, "<p>dungeon note</p>");
	assert.deepEqual(userDrawing.flags["shadowdark-extras"].notes, "<p>user note</p>");
});

test("characterization: source-shaped TileFlatten preserves dungeon and user note visibility", async () => {
	const { dungeonDrawing, userDrawing } = await runTileFlattenFixture();
	assert.equal(dungeonDrawing.flags["shadowdark-extras"].noteVisible, true);
	assert.equal(userDrawing.flags["shadowdark-extras"].noteVisible, false);
});

test("characterization: source-shaped TileFlatten preserves dungeon and user custom names", async () => {
	const { dungeonDrawing, userDrawing } = await runTileFlattenFixture();
	assert.equal(dungeonDrawing.flags["shadowdark-extras"].customName, "Dungeon wall");
	assert.equal(userDrawing.flags["shadowdark-extras"].customName, "User drawing");
});

test("characterization: TileFlatten preserves eligible user Drawing ownership flags", async () => {
	const { userDrawing, deleted } = await runTileFlattenFixture();
	assert.equal(userDrawing.flags["shadowdark-extras"].dungeonWall, undefined);
	assert.equal(userDrawing.flags["shadowdark-extras"].placeableNotesExcluded, undefined);
	assert.deepEqual(deleted, [{ type: "Tile", ids: ["flattened-1"] }]);
});
