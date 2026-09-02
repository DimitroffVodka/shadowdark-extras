// The paint bucket varies one room's floor without touching its neighbours. It
// needs no geometry of its own: the reskin already emits a separate Drawing per
// traced room, so painting is a texture swap on whichever of those the click
// landed in — and it cannot paint past a wall because the shape it fills was
// traced from the walls to begin with.
//
// What these pin is the SELECTION, which is the only part that can be wrong:
// hit the room under the cursor, only that room, and nothing when the click is
// outside every traced floor.
//
// NOT TESTED HERE — the sticky arm state and the tray button, which are a
// boolean and a class toggle with no logic between them.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals, installDom } from "./helpers/pixi-harness.mjs";

installCanvasGlobals();
installDom();

const MODULE_ID = "shadowdark-extras";

globalThis.game.scenes = { get: () => null };
globalThis.game.users = [{ isGM: true, active: true }];
globalThis.game.user = { isGM: true, id: "gm" };
globalThis.game.settings = { get: () => undefined, set: async () => {}, register() {}, registerMenu() {} };
globalThis.game.i18n = { localize: key => key };
globalThis.game.modules = { get: () => null };
globalThis.canvas.grid = { size: 100, isHexagonal: false };
globalThis.canvas.scene = null;
globalThis.CONST = { GRID_TYPES: { SQUARE: 1 }, DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
globalThis.foundry.applications = {
	api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base, DialogV2: class {} },
	apps: { FilePicker: class {} },
	ux: { TextEditor: {} },
};
globalThis.foundry.canvas = { layers: { CanvasLayer: class {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const { paintRoomFloor } = await import("../../scripts/dungeon/dungeon-reskin.mjs");

/** toObject() because undo snapshots a document before changing it. */
const doc = o => ({ ...o, toObject: () => ({ ...o }) });

/** A floor-shape Drawing: polygon points are relative to the document's x/y. */
function floorShape(id, x, y, corners, texture = "old.webp") {
	return doc({
		id,
		x,
		y,
		texture,
		shape: { type: "p", points: corners.flatMap(p => [p.x - x, p.y - y]) },
		flags: { [MODULE_ID]: { dungeonFloorShape: true } },
	});
}

const box = (x0, y0, x1, y1) => [
	{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

/** Real segment intersection, so the stubbed movement backend behaves. */
function segmentsIntersect(a, b, c, d) {
	const orient = (p, q, r) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
	return orient(a, b, c) !== orient(a, b, d) && orient(c, d, a) !== orient(c, d, b);
}

/**
 * Install a movement backend blocking on the given walls. With none, nothing
 * blocks, the flood fill runs to the canvas edge and reports a leak — which is
 * what makes "clicking open ground paints nothing" true rather than incidental.
 */
function installWalls(walls) {
	globalThis.CONFIG = {
		Canvas: {
			polygonBackends: {
				move: {
					testCollision: (a, b) => walls.some(w =>
						segmentsIntersect(a, b, { x: w.c[0], y: w.c[1] }, { x: w.c[2], y: w.c[3] })
					),
				},
			},
		},
	};
	globalThis.foundry.utils = {
		...globalThis.foundry.utils,
		lineSegmentIntersects: segmentsIntersect,
	};
}

function sceneWith(drawings, walls = []) {
	installWalls(walls);
	drawings.get = id => drawings.find(d => d.id === id);
	return {
		drawings,
		walls,
		tiles: [],
		grid: { size: 100 },
		dimensions: { width: 2000, height: 2000 },
		updates: [],
		created: [],
		deleted: [],
		async updateEmbeddedDocuments(type, data) {
			this.updates.push({ type, data });
			return data;
		},
		async createEmbeddedDocuments(type, data) {
			this.created.push({ type, data });
			return data.map((d, i) => ({ ...d, id: `new-${i}` }));
		},
		async deleteEmbeddedDocuments(type, ids) {
			this.deleted.push({ type, ids });
			return ids;
		},
	};
}

/** Walls enclosing (100,100)-(500,500), as a scene's walls collection would hold. */
const roomWalls = () => [
	{ c: [100, 100, 500, 100], door: 0 },
	{ c: [500, 100, 500, 500], door: 0 },
	{ c: [500, 500, 100, 500], door: 0 },
	{ c: [100, 500, 100, 100], door: 0 },
];

/** A 100-wide hall at x 0-100 beside a 400-wide room at x 100-500, both y 0-400. */
const hallAndRoom = () => [
	{ c: [0, 0, 100, 0], door: 0 }, { c: [100, 0, 500, 0], door: 0 },
	{ c: [500, 0, 500, 400], door: 0 }, { c: [500, 400, 100, 400], door: 0 },
	{ c: [100, 400, 0, 400], door: 0 }, { c: [0, 400, 0, 0], door: 0 },
	{ c: [100, 0, 100, 400], door: 0 },
];

test("clicking a room repaints that room only", () => {
	const scene = sceneWith([
		floorShape("hall", 0, 0, box(0, 0, 100, 400)),
		floorShape("room", 100, 0, box(100, 0, 500, 400)),
	], hallAndRoom());

	return paintRoomFloor(scene, { x: 300, y: 200 }, "new.webp").then(painted => {
		assert.equal(painted, true);
		assert.equal(scene.updates.length, 1);
		assert.deepEqual(scene.updates[0].data, [{ _id: "room", texture: "new.webp" }]);
	});
});

test("the hallway can differ from the room it joins", () => {
	const scene = sceneWith([
		floorShape("hall", 0, 0, box(0, 0, 100, 400)),
		floorShape("room", 100, 0, box(100, 0, 500, 400)),
	], hallAndRoom());

	return paintRoomFloor(scene, { x: 50, y: 200 }, "corridor.webp").then(() => {
		assert.deepEqual(scene.updates[0].data, [{ _id: "hall", texture: "corridor.webp" }]);
	});
});

test("a click on open ground with no walls paints nothing", () => {
	// No walls, so the fill escapes and there is no room to speak of. Painting
	// past a wall must be impossible, not merely discouraged.
	const scene = sceneWith([floorShape("room", 100, 0, box(100, 0, 500, 400))]);

	return paintRoomFloor(scene, { x: 900, y: 900 }, "new.webp").then(painted => {
		assert.equal(painted, false);
		assert.equal(scene.updates.length, 0);
		assert.equal(scene.created.length, 0, "an unbounded area must not be floored");
	});
});

test("clicking a walled room with no floor yet creates one", () => {
	// The bucket has to work on a map that was never reskinned — that is the
	// whole point of clicking a room and getting a floor.
	const scene = sceneWith([], roomWalls());

	return paintRoomFloor(scene, { x: 300, y: 300 }, "new.webp").then(painted => {
		assert.equal(painted, true);
		assert.equal(scene.created.length, 1);
		const [shape] = scene.created[0].data;
		assert.equal(shape.texture, "new.webp");
		assert.equal(shape.shape.type, "p", "the new floor is a room-shaped polygon, not a grid of tiles");
		assert.equal(shape.flags[MODULE_ID].dungeonFloorShape, true);
	});
});

test("creating a floor clears the grid tiles it covers", () => {
	// A room that had fallen back to square tiles must not end up with two
	// floors stacked once the shape goes in over it.
	const scene = sceneWith([], roomWalls());
	scene.tiles = [
		doc({ id: "inside", x: 200, y: 200, elevation: 0, flags: { [MODULE_ID]: { dungeonReskinFloor: true } } }),
		doc({ id: "outside", x: 1500, y: 1500, elevation: 0, flags: { [MODULE_ID]: { dungeonReskinFloor: true } } }),
	];

	return paintRoomFloor(scene, { x: 300, y: 300 }, "new.webp").then(() => {
		assert.deepEqual(scene.deleted, [{ type: "Tile", ids: ["inside"] }]);
	});
});

test("a room already wearing that tile is not rewritten", () => {
	const scene = sceneWith([floorShape("room", 0, 0, box(0, 0, 400, 400), "same.webp")]);

	return paintRoomFloor(scene, { x: 200, y: 200 }, "same.webp").then(painted => {
		assert.equal(painted, false);
		assert.equal(scene.updates.length, 0, "no document write for a no-op");
	});
});

test("a stale floor covering the map does not become the room", () => {
	// The bug this replaces: one bad earlier fill left a single polygon over the
	// whole map, so every click found THAT as "the room" and repainted all of it.
	// The room comes from the walls, so the giant shape is irrelevant.
	const scene = sceneWith([
		floorShape("everything", 0, 0, box(0, 0, 1000, 1000)),
		floorShape("room", 100, 100, box(100, 100, 500, 500)),
	], roomWalls());

	return paintRoomFloor(scene, { x: 300, y: 300 }, "new.webp").then(() => {
		assert.deepEqual(scene.updates[0].data, [{ _id: "room", texture: "new.webp" }],
			"the walled room is repainted, not the sheet covering the map");
	});
});

test("wall art is never mistaken for floor", () => {
	// Wall art is a Drawing too and sits over the floor it belongs to, so a
	// bucket that matched on shape rather than flag would repaint the wall.
	const wallArt = doc({
		id: "art", x: 0, y: 0, texture: "wall.webp",
		shape: { type: "p", points: [0, 0, 400, 0, 400, 400, 0, 400] },
		flags: { [MODULE_ID]: { dungeonWall: true, dungeonIntWall: true } },
	});
	const scene = sceneWith([wallArt], roomWalls());

	return paintRoomFloor(scene, { x: 300, y: 300 }, "new.webp").then(() => {
		assert.equal(scene.updates.length, 0, "the wall drawing must not be retextured");
		assert.equal(scene.created.length, 1, "a new floor goes in underneath instead");
	});
});

test("a non-GM cannot paint", () => {
	globalThis.game.user = { isGM: false, id: "player" };
	const scene = sceneWith([floorShape("room", 0, 0, box(0, 0, 400, 400))]);

	return paintRoomFloor(scene, { x: 200, y: 200 }, "new.webp").then(painted => {
		globalThis.game.user = { isGM: true, id: "gm" };
		assert.equal(painted, false);
		assert.equal(scene.updates.length, 0);
	});
});
