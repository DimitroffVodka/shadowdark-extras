// The eraser is what makes a wrong result recoverable without starting over —
// automatic room detection has been wrong three separate ways in one session.
//
// It CUTS rather than deleting whole shapes. That distinction is the feature:
// a corridor network with no internal doors traces as one polygon, so deleting
// whole shapes removed the floor from an entire map when one 3x3 room was
// erased. Wall art goes with the floor, because "make this area blank" is what
// an eraser is asked for.
//
// The other property that matters is SCOPE: SDX's own output and nothing else —
// not the map's art, not the GM's drawings.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals, installDom } from "./helpers/pixi-harness.mjs";

installCanvasGlobals();
installDom();

const MODULE_ID = "shadowdark-extras";

globalThis.game.user = { isGM: true, id: "gm" };
globalThis.game.scenes = { get: () => null };
globalThis.game.settings = { get: () => undefined, set: async () => {}, register() {}, registerMenu() {} };
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

const { eraseFloorRegion } = await import("../../scripts/dungeon/dungeon-reskin.mjs");

// toObject() because undo snapshots documents before deleting them.
const doc = o => ({ ...o, toObject: () => ({ ...o }) });

const floorShape = (id, x, y, w, h) => doc({
	id, x, y,
	shape: { type: "p", points: [0, 0, w, 0, w, h, 0, h] },
	flags: { [MODULE_ID]: { dungeonFloorShape: true } },
});

function sceneWith({ drawings = [], tiles = [] } = {}) {
	drawings.get = id => drawings.find(d => d.id === id);
	tiles.get = id => tiles.find(t => t.id === id);
	return {
		drawings,
		tiles,
		grid: { size: 100 },
		deleted: [],
		created: [],
		async deleteEmbeddedDocuments(type, ids) {
			this.deleted.push({ type, ids });
			return ids;
		},
		async createEmbeddedDocuments(type, data) {
			this.created.push({ type, data });
			return data.map((d, i) => ({ ...d, id: `piece-${i}` }));
		},
	};
}

test("a box cuts a hole and leaves the rest of the floor", async () => {
	// The failure this replaces: the box deleted whole shapes, so erasing one
	// 3x3 room removed the floor from an entire map.
	const scene = sceneWith({
		drawings: [floorShape("a", 0, 0, 200, 200), floorShape("b", 1000, 1000, 200, 200)],
	});

	const removed = await eraseFloorRegion(scene, { minX: 50, minY: 50, maxX: 150, maxY: 150 });

	assert.equal(removed, 1);
	assert.deepEqual(scene.deleted, [{ type: "Drawing", ids: ["a"] }], "the far shape is untouched");
	assert.equal(scene.created.length, 1, "and the parts outside the box come back");
	assert.ok(scene.created[0].data.length >= 3, "a hole in the middle leaves several pieces");
});

test("clipping past a shape entirely leaves it alone", async () => {
	const scene = sceneWith({ drawings: [floorShape("a", 0, 0, 200, 200)] });

	const removed = await eraseFloorRegion(scene, { minX: 900, minY: 900, maxX: 1000, maxY: 1000 });

	assert.equal(removed, 0);
	assert.equal(scene.deleted.length, 0);
});

test("grid-tile floor is erased too", async () => {
	// Rooms that fell back to square tiles need cleaning up just as much.
	const scene = sceneWith({
		tiles: [
			doc({ id: "in", x: 100, y: 100, flags: { [MODULE_ID]: { dungeonFloor: true } } }),
			doc({ id: "out", x: 900, y: 900, flags: { [MODULE_ID]: { dungeonFloor: true } } }),
		],
	});

	await eraseFloorRegion(scene, { minX: 50, minY: 50, maxX: 250, maxY: 250 });

	assert.deepEqual(scene.deleted, [{ type: "Tile", ids: ["in"] }]);
});

test("wall art goes too, so the area actually comes out blank", async () => {
	// "Make this area blank" is what an eraser is asked for. Leaving the walls
	// behind means the user has to finish the job by hand on another layer.
	const scene = sceneWith({
		drawings: [
			doc({
				id: "wall", x: 0, y: 0,
				shape: { type: "r", width: 200, height: 20 },
				flags: { [MODULE_ID]: { dungeonWall: true, dungeonIntWall: true } },
			}),
		],
	});

	const removed = await eraseFloorRegion(scene, { minX: 0, minY: 0, maxX: 300, maxY: 300 });

	assert.equal(removed, 1);
	assert.deepEqual(scene.deleted, [{ type: "Drawing", ids: ["wall"] }]);
});

test("nothing that is not SDX's is ever deleted", async () => {
	// The GM's own drawings and the map's own tiles are none of SDX's business.
	// An eraser that took either would be worse than no eraser at all.
	const scene = sceneWith({
		drawings: [
			doc({
				id: "gm", x: 0, y: 0,
				shape: { type: "p", points: [0, 0, 200, 0, 200, 200, 0, 200] },
				flags: {},
			}),
		],
		tiles: [doc({ id: "maptile", x: 100, y: 100, flags: {} })],
	});

	const removed = await eraseFloorRegion(scene, { minX: 0, minY: 0, maxX: 300, maxY: 300 });

	assert.equal(removed, 0);
	assert.equal(scene.deleted.length, 0);
});

test("wall art outside the box is left alone", async () => {
	// Scoped by the art's centre, so dragging over one room does not strip the
	// walls of the room next door.
	const scene = sceneWith({
		drawings: [
			doc({
				id: "near", x: 0, y: 0,
				shape: { type: "r", width: 100, height: 20 },
				flags: { [MODULE_ID]: { dungeonWall: true } },
			}),
			doc({
				id: "far", x: 2000, y: 2000,
				shape: { type: "r", width: 100, height: 20 },
				flags: { [MODULE_ID]: { dungeonWall: true } },
			}),
		],
	});

	await eraseFloorRegion(scene, { minX: 0, minY: 0, maxX: 300, maxY: 300 });

	assert.deepEqual(scene.deleted, [{ type: "Drawing", ids: ["near"] }]);
});

test("a non-GM erases nothing", async () => {
	globalThis.game.user = { isGM: false, id: "player" };
	const scene = sceneWith({ drawings: [floorShape("a", 0, 0, 200, 200)] });

	const removed = await eraseFloorRegion(scene, { minX: 0, minY: 0, maxX: 300, maxY: 300 });

	globalThis.game.user = { isGM: true, id: "gm" };
	assert.equal(removed, 0);
	assert.equal(scene.deleted.length, 0);
});

// Shift+CLICK erases ONE SQUARE, by cutting it out. Deleting whole floor
// shapes is the wrong model and was measured wrong on a real map: a corridor
// network with no internal doors traces as a SINGLE shape, so a click meant to
// clear one square took the entire network with it.
//
// Both gestures now cut. The only difference is the size of the box.

test("a one-square cut leaves the rest of a big shape", async () => {
	// The corridor case: one shape covering a large snaking area, one square
	// erased out of the middle of it.
	const scene = sceneWith({
		drawings: [floorShape("corridor", 0, 0, 1000, 1000)],
	});

	const removed = await eraseFloorRegion(scene, {
		minX: 450, maxX: 550, minY: 450, maxY: 550,
	});

	assert.equal(removed, 1, "the shape is replaced, not merely deleted");
	assert.equal(scene.created.length, 1, "and its remainder comes back");
	const pieces = scene.created[0].data;
	assert.ok(pieces.length >= 3, `a hole in the middle leaves several pieces, got ${pieces.length}`);
});

test("erasing one square does not take the neighbouring floor", async () => {
	const scene = sceneWith({
		drawings: [floorShape("a", 0, 0, 200, 200), floorShape("b", 900, 900, 200, 200)],
	});

	await eraseFloorRegion(scene, { minX: 50, maxX: 150, minY: 50, maxY: 150 });

	assert.deepEqual(scene.deleted, [{ type: "Drawing", ids: ["a"] }]);
});

// A bucket clears the floor INSIDE a room, and the room still exists — so its
// walls must survive. They would not by accident: wall art sits ON the boundary
// of the flooded area, so its centre lands in a flooded square every time. That
// is why the bucket has to opt OUT rather than the box opting in.

const { eraseFloorCells } = await import("../../scripts/dungeon/dungeon-reskin.mjs");

function cellScene(drawings, tiles = []) {
	drawings.get = id => drawings.find(d => d.id === id);
	tiles.get = id => tiles.find(t => t.id === id);
	return {
		drawings, tiles,
		grid: { size: 100 },
		deleted: [],
		created: [],
		async deleteEmbeddedDocuments(type, ids) {
			this.deleted.push({ type, ids });
			return ids;
		},
		async createEmbeddedDocuments(type, data) {
			this.created.push({ type, data });
			return data.map((d, i) => ({ ...d, id: `piece-${i}` }));
		},
	};
}

/** Wall art on the boundary of squares (0,0)-(1,1): centre lands inside them. */
const boundaryWall = () => doc({
	id: "wall", x: 0, y: 90,
	shape: { type: "r", width: 200, height: 20 },
	flags: { [MODULE_ID]: { dungeonWall: true } },
});

test("the bucket clears floor and leaves the walls standing", async () => {
	const scene = cellScene([floorShape("floor", 0, 0, 200, 200), boundaryWall()]);

	await eraseFloorCells(scene, new Set(["0,0", "1,0", "0,1", "1,1"]), { includeWallArt: false });

	assert.deepEqual(scene.deleted[0].ids, ["floor"], "the wall art must survive");
});

test("the box eraser still blanks wall art when asked", async () => {
	const scene = cellScene([floorShape("floor", 0, 0, 200, 200), boundaryWall()]);

	await eraseFloorCells(scene, new Set(["0,0", "1,0", "0,1", "1,1"]), { includeWallArt: true });

	assert.deepEqual(scene.deleted[0].ids.sort(), ["floor", "wall"]);
});

// THE BUCKET IS A FLOOD FILL, not a polygon trace, and these tests exist to keep
// it one. Every previous version traced the walls into room outlines first and
// refused to act when they did not close into a loop — so on a map whose walls
// very nearly close, the click did nothing at all and said nothing useful. A
// fill spreads from where you clicked until a wall stops it. That is the tool
// that was asked for.

const { bucketFillAt, bucketEraseAt } = await import("../../scripts/dungeon/dungeon-reskin.mjs");

const wall = (x0, y0, x1, y1, door = 0) => ({ c: [x0, y0, x1, y1], door, id: `w${x0}${y0}${x1}${y1}` });

/** A 3x3-square room, walls flush to the outside of the squares. */
function boxRoom() {
	return [
		wall(0, 0, 300, 0), wall(300, 0, 300, 300),
		wall(300, 300, 0, 300), wall(0, 300, 0, 0),
	];
}

function fillScene(walls, { drawings = [], tiles = [] } = {}) {
	drawings.get = id => drawings.find(d => d.id === id);
	tiles.get = id => tiles.find(t => t.id === id);
	walls.filter = Array.prototype.filter.bind(walls);
	return {
		walls, drawings, tiles,
		grid: { size: 100 },
		dimensions: { width: 1000, height: 1000 },
		created: [],
		deleted: [],
		async createEmbeddedDocuments(type, data) {
			this.created.push({ type, data });
			return data.map((d, i) => ({ ...d, id: `${type}-${this.created.length}-${i}` }));
		},
		async deleteEmbeddedDocuments(type, ids) {
			this.deleted.push({ type, ids });
			// A real collection no longer holds a deleted document.
			const collection = type === "Tile" ? tiles : drawings;
			for (const id of ids) {
				const at = collection.findIndex(d => d.id === id);
				if (at >= 0) collection.splice(at, 1);
			}
			return ids;
		},
	};
}

/** A created floor polygon's vertices in scene coordinates. */
function verticesOf(drawing) {
	const out = [];
	for (let i = 0; i < drawing.shape.points.length; i += 2) {
		out.push({ x: drawing.x + drawing.shape.points[i], y: drawing.y + drawing.shape.points[i + 1] });
	}
	return out;
}

test("the bucket fills the walled area it was clicked in", async () => {
	const scene = fillScene(boxRoom());

	const filled = await bucketFillAt(scene, { x: 150, y: 150 }, "floor.webp");

	assert.equal(filled, 9, "a 3x3 room is nine squares");
	// ONE polygon, not nine tiles: the floor is an outline that hugs the walls,
	// so a room with a curved wall gets a curved floor rather than square
	// corners poking out past it.
	assert.equal(scene.created.length, 1);
	assert.equal(scene.created[0].type, "Drawing");
	assert.equal(scene.created[0].data.length, 1);
	const floor = scene.created[0].data[0];
	assert.equal(floor.flags["shadowdark-extras"].dungeonFloorShape, true);
	assert.equal(floor.texture, "floor.webp");
	// A square room outlines as exactly its four corners, whatever resolution
	// the fill ran at.
	const corners = verticesOf(floor).map(p => `${p.x},${p.y}`).sort();
	assert.deepEqual(corners, ["0,0", "0,300", "300,0", "300,300"]);
});

test("the fill stops at the walls instead of covering the map", async () => {
	// The scene is 10x10 squares. A fill that ignored the walls would make 100.
	const scene = fillScene(boxRoom());

	await bucketFillAt(scene, { x: 50, y: 50 }, "floor.webp");

	const made = scene.created[0].data;
	assert.ok(made.every(d => verticesOf(d).every(p => p.x <= 300 && p.y <= 300)), "nothing outside the room");
});

test("clicking the same room again replaces its floor instead of stacking one", async () => {
	const scene = fillScene(boxRoom());
	await bucketFillAt(scene, { x: 150, y: 150 }, "floor.webp");
	const first = scene.created[0].data[0];
	scene.drawings.push({
		...first,
		id: "first",
		flags: first.flags,
		toObject() { return { ...first }; },
	});

	await bucketFillAt(scene, { x: 150, y: 150 }, "other.webp");

	assert.deepEqual(scene.deleted, [{ type: "Drawing", ids: ["first"] }], "the old floor goes");
	assert.equal(scene.created.length, 2);
	assert.equal(scene.created[1].data[0].texture, "other.webp");
});

test("a corridor fill does not floor the room it surrounds", async () => {
	// A 5x5 square with a walled 1x1 room in the middle: the fill from a corner
	// is the ring around it, and a Drawing polygon has no holes — so the ring
	// must come back as ONE polygon that still leaves the middle uncovered.
	const walls = [
		wall(0, 0, 500, 0), wall(500, 0, 500, 500), wall(500, 500, 0, 500), wall(0, 500, 0, 0),
		wall(200, 200, 300, 200), wall(300, 200, 300, 300), wall(300, 300, 200, 300), wall(200, 300, 200, 200),
	];
	const scene = fillScene(walls);

	const filled = await bucketFillAt(scene, { x: 50, y: 50 }, "floor.webp");

	assert.equal(filled, 24, "25 squares minus the room in the middle");
	assert.equal(scene.created[0].data.length, 1, "one polygon");
	const floor = scene.created[0].data[0];
	const { pointInPolygon } = await import("../../scripts/dungeon/dungeon-wall-outline.mjs");
	const polygon = verticesOf(floor);
	assert.equal(pointInPolygon({ x: 250, y: 250 }, polygon), false, "the middle room is not floored");
	assert.equal(pointInPolygon({ x: 50, y: 250 }, polygon), true, "the corridor beside it is");
	assert.equal(pointInPolygon({ x: 250, y: 450 }, polygon), true, "and so is the corridor below");
});

test("the floor reaches the wall through cells whose centres are outside", async () => {
	// A room 250 wide: the third column of cells is cut by the east wall, and
	// its centres (x=250.1) are just outside. The floor still runs to the wall.
	const walls = [wall(0, 0, 250, 0), wall(250, 0, 250, 300), wall(250, 300, 0, 300), wall(0, 300, 0, 0)];
	const scene = fillScene(walls);

	await bucketFillAt(scene, { x: 100, y: 150 }, "floor.webp");

	const corners = verticesOf(scene.created[0].data[0]).map(p => `${p.x},${p.y}`).sort();
	assert.deepEqual(corners, ["0,0", "0,300", "250,0", "250,300"]);
});

test("a click in a cell the wall cuts through fills the room, not the rock", async () => {
	// Same room; the click lands at x=240, inside the room but in a cell whose
	// centre is outside it. A fill seeded from that centre would run off across
	// the map and report a gap.
	const walls = [wall(0, 0, 250, 0), wall(250, 0, 250, 300), wall(250, 300, 0, 300), wall(0, 300, 0, 0)];
	const scene = fillScene(walls);

	const filled = await bucketFillAt(scene, { x: 240, y: 150 }, "floor.webp");

	assert.equal(filled, 6, "two columns of centres are inside");
	const corners = verticesOf(scene.created[0].data[0]).map(p => `${p.x},${p.y}`).sort();
	assert.deepEqual(corners, ["0,0", "0,300", "250,0", "250,300"]);
});

test("the erase bucket takes a bucket-laid floor out whole", async () => {
	// The floor runs past the coarse cells into the ring around them, so cutting
	// by cells would leave slivers along the walls. Its own outline is
	// recognised instead and the whole document goes.
	const walls = [wall(0, 0, 250, 0), wall(250, 0, 250, 300), wall(250, 300, 0, 300), wall(0, 300, 0, 0)];
	const scene = fillScene(walls);
	await bucketFillAt(scene, { x: 100, y: 150 }, "floor.webp");
	const laid = scene.created[0].data[0];
	scene.drawings.push({ ...laid, id: "laid", toObject() { return { ...laid }; } });

	const removed = await bucketEraseAt(scene, { x: 100, y: 150 });

	assert.equal(removed, 1);
	assert.deepEqual(scene.deleted, [{ type: "Drawing", ids: ["laid"] }]);
	assert.equal(scene.created.length, 1, "nothing is written back — no remainder pieces");
});

test("erasing inside a small pillar cuts the pillar out, not the square around it", async () => {
	// A 5x5 room with a big floor over it, and a walled pillar 40px across in
	// the middle of one square. Erasing inside the pillar must leave the floor
	// in the rest of that square — cutting the whole square took floor from
	// outside the pillar's walls, which is what the user saw.
	const walls = [
		wall(0, 0, 500, 0), wall(500, 0, 500, 500), wall(500, 500, 0, 500), wall(0, 500, 0, 0),
		wall(230, 230, 270, 230), wall(270, 230, 270, 270), wall(270, 270, 230, 270), wall(230, 270, 230, 230),
	];
	const big = doc({
		id: "big", x: 0, y: 0, texture: "grey.webp", sort: -10,
		shape: { type: "p", points: [0, 0, 500, 0, 500, 500, 0, 500] },
		flags: { [MODULE_ID]: { dungeonFloorShape: true } },
	});
	const scene = fillScene(walls, { drawings: [big] });
	const { pointInPolygon } = await import("../../scripts/dungeon/dungeon-wall-outline.mjs");

	const removed = await bucketEraseAt(scene, { x: 250, y: 250 });

	assert.equal(removed, 1, "the big floor is replaced");
	assert.deepEqual(scene.deleted, [{ type: "Drawing", ids: ["big"] }]);
	const pieces = scene.created.flatMap(c => c.data).map(verticesOf);
	const covered = p => pieces.some(piece => pointInPolygon(p, piece));
	assert.equal(covered({ x: 250, y: 250 }), false, "inside the pillar is bare");
	assert.equal(covered({ x: 215, y: 250 }), true, "the same square outside the pillar keeps its floor");
	assert.equal(covered({ x: 250, y: 290 }), true);
	assert.equal(covered({ x: 50, y: 50 }), true, "and so does the rest of the room");
	assert.ok(pieces.every(piece => piece.every(v => v.x >= 0 && v.x <= 500 && v.y >= 0 && v.y <= 500)), "nothing is written outside the room");
});

test("a gap in the walls refuses rather than flooding the whole map", async () => {
	// Walls that do not close: the fill escapes. Filling 100 squares and making
	// the GM undo it is worse than saying which tool finds the gap.
	const scene = fillScene([wall(0, 0, 300, 0), wall(300, 0, 300, 300)]);

	const filled = await bucketFillAt(scene, { x: 150, y: 150 }, "floor.webp");

	assert.equal(filled, 0);
	assert.equal(scene.created.length, 0);
});

test("a door bounds the fill — a doorway is where the room ends", async () => {
	const walls = boxRoom();
	walls[1] = wall(300, 0, 300, 300, 1);          // east side is a door
	walls.push(wall(300, 0, 600, 0), wall(600, 0, 600, 300), wall(600, 300, 300, 300));
	const scene = fillScene(walls);

	await bucketFillAt(scene, { x: 150, y: 150 }, "floor.webp");

	const made = scene.created[0].data;
	assert.ok(made.every(d => verticesOf(d).every(p => p.x <= 300)), "the fill must not cross into the next room");
});

test("the erase bucket clears the same area the fill would cover", async () => {
	const tiles = [
		doc({ id: "in", x: 100, y: 100, flags: { [MODULE_ID]: { dungeonFloor: true } } }),
		doc({ id: "out", x: 700, y: 700, flags: { [MODULE_ID]: { dungeonFloor: true } } }),
	];
	const scene = fillScene(boxRoom(), { tiles });

	const removed = await bucketEraseAt(scene, { x: 150, y: 150 });

	assert.ok(removed > 0, "the click must clear something");
	assert.deepEqual(scene.deleted, [{ type: "Tile", ids: ["in"] }], "and only inside the walls");
});

test("erasing leaves the walls standing — only the floor goes", async () => {
	const drawings = [doc({
		id: "wallart", x: 0, y: 90,
		shape: { type: "r", width: 300, height: 20 },
		flags: { [MODULE_ID]: { dungeonWall: true } },
	})];
	const tiles = [doc({ id: "floor", x: 100, y: 100, flags: { [MODULE_ID]: { dungeonFloor: true } } })];
	const scene = fillScene(boxRoom(), { drawings, tiles });

	await bucketEraseAt(scene, { x: 150, y: 150 });

	const gone = scene.deleted.flatMap(d => d.ids);
	assert.ok(!gone.includes("wallart"), "wall art sits inside the filled squares but must survive");
});
