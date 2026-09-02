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

// Shift+CLICK deletes the patch of floor under the cursor. Deliberately NOT
// wall-traced: an area filled WRONGLY is often not a room at all — it is rock,
// or a region the fill merged across a gap — so working out "the room here" and
// erasing that answers a different question than the one being asked. What is
// being pointed at is the paint.

const { eraseRoomAt } = await import("../../scripts/dungeon/dungeon-reskin.mjs");

function floorScene(drawings, tiles = []) {
	drawings.get = id => drawings.find(d => d.id === id);
	tiles.get = id => tiles.find(t => t.id === id);
	return {
		drawings, tiles,
		grid: { size: 100 },
		deleted: [],
		async deleteEmbeddedDocuments(type, ids) {
			this.deleted.push({ type, ids });
			return ids;
		},
	};
}

const poly = (id, x, y, w, h, flags) => doc({
	id, x, y,
	shape: { type: "p", points: [0, 0, w, 0, w, h, 0, h], width: w, height: h },
	flags: { [MODULE_ID]: flags },
});

test("clicking a wrongly-filled patch deletes that patch", async () => {
	const scene = floorScene([
		poly("bad", 100, 100, 400, 400, { dungeonFloorShape: true }),
		poly("good", 900, 100, 400, 400, { dungeonFloorShape: true }),
	]);

	const removed = await eraseRoomAt(scene, { x: 300, y: 300 });

	assert.equal(removed, 1);
	assert.deepEqual(scene.deleted, [{ type: "Drawing", ids: ["bad"] }],
		"the floor elsewhere is untouched");
});

test("no walls are needed — rock that got floored erases too", async () => {
	// The whole point: the filled area need not be a room. There are no walls in
	// this scene at all and the erase must still work.
	const scene = floorScene([poly("rock", 0, 0, 300, 300, { dungeonFloorShape: true })]);

	assert.equal(await eraseRoomAt(scene, { x: 150, y: 150 }), 1);
});

test("a patch painted on top wins over the floor beneath it", async () => {
	const scene = floorScene([
		poly("under", 0, 0, 1000, 1000, { dungeonFloorShape: true }),
		poly("patch", 400, 400, 200, 200, { dungeonFloorShape: true }),
	]);

	await eraseRoomAt(scene, { x: 500, y: 500 });

	assert.deepEqual(scene.deleted, [{ type: "Drawing", ids: ["patch"] }],
		"deleting the sheet underneath would take the whole map");
});

test("wall art on the erased patch goes with it", async () => {
	const scene = floorScene([
		poly("floor", 0, 0, 400, 400, { dungeonFloorShape: true }),
		doc({
			id: "wall-in", x: 100, y: 190, shape: { type: "r", width: 100, height: 20 },
			flags: { [MODULE_ID]: { dungeonWall: true } },
		}),
		doc({
			id: "wall-out", x: 900, y: 190, shape: { type: "r", width: 100, height: 20 },
			flags: { [MODULE_ID]: { dungeonWall: true } },
		}),
	]);

	await eraseRoomAt(scene, { x: 200, y: 200 });

	assert.deepEqual(scene.deleted[0].ids.sort(), ["floor", "wall-in"]);
});

test("clicking where there is no SDX floor does nothing", async () => {
	const scene = floorScene([poly("floor", 0, 0, 200, 200, { dungeonFloorShape: true })]);

	assert.equal(await eraseRoomAt(scene, { x: 900, y: 900 }), 0);
	assert.equal(scene.deleted.length, 0);
});
