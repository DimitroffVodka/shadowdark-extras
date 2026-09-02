// The Clear button shows the user a count and then deletes. Those two numbers
// come from collectDungeonDocuments, which exists so they cannot drift apart —
// a confirmation dialog for a destructive bulk action is only worth having if
// its figures are the deletion's own figures.
//
// The other property pinned here is SCOPE. Clear must remove what SDX put down
// and nothing else, which matters most on a reskinned map: the floor tiles and
// wall art SDX drew are SDX's, but the walls, doors, lights and notes underneath
// them belong to the map and were never SDX's to delete.
//
// NOT TESTED HERE — the dialog itself and the background restore, which are
// DialogV2 and Scene#update calls with nothing to assert against in Node.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals, installDom } from "./helpers/pixi-harness.mjs";

installCanvasGlobals();
installDom();

const MODULE_ID = "shadowdark-extras";

globalThis.game.scenes = { get: () => null };
globalThis.game.users = [{ isGM: true, active: true }];
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

const { collectDungeonDocuments } = await import("../../scripts/dungeon/DungeonGeneratorSD.mjs");
const { collectPaintedFloors } = await import("../../scripts/dungeon/DungeonPainterSD.mjs");

const sdx = (id, flags) => ({ id, flags: { [MODULE_ID]: flags }, elevation: 0 });
const foreign = id => ({ id, flags: {}, elevation: 0 });

// Mirrors what clearDungeonOnScene passes. Kept in one place so these tests
// describe the Clear button rather than an option set nothing actually uses.
const CLEAR_OPTIONS = { includeBackground: true, includeAuthoredWalls: true };

/** A reskinned map: SDX floor and wall art over the map's own walls and lights. */
function reskinnedScene() {
	return {
		tiles: [sdx("t1", { dungeonFloor: true }), sdx("t2", { dungeonFloor: true }), foreign("map-tile")],
		walls: [
			// The map's own walls: reskinned in place, so they carry a pair id but
			// were never SDX-created and must survive a clear.
			{ id: "map-wall", flags: { [MODULE_ID]: { wallPairId: "p1" } }, elevation: 0 },
			foreign("plain-wall"),
		],
		drawings: [
			sdx("art1", { dungeonWall: true, dungeonIntWall: true, wallPairId: "p1" }),
			sdx("backdrop", { dungeonBackground: true }),
			foreign("gm-note-drawing"),
		],
		lights: [sdx("l1", { dungeonDecorLight: true }), foreign("map-torch")],
	};
}

test("clear collects only what SDX created", () => {
	const scene = reskinnedScene();
	const got = collectDungeonDocuments(scene, { elevation: 0 }, false, CLEAR_OPTIONS);

	assert.deepEqual(got.tiles, ["t1", "t2"], "the map's own tile must survive");
	assert.deepEqual(got.walls, [], "a reskinned map's walls are the MAP's, not SDX's");
	assert.deepEqual(got.drawings, ["art1", "backdrop"], "SDX art and backdrop go, the GM's drawing stays");
	assert.deepEqual(got.lights, ["l1"], "the map's own light must survive");
});

test("the backdrop is excluded unless asked for", () => {
	// Generation clears and then re-uses the backdrop, so its default must not
	// sweep it up. Only the Clear button opts in. Authored walls are held
	// constant here so the backdrop is the only thing varying.
	const got = collectDungeonDocuments(reskinnedScene(), { elevation: 0 }, false, {
		includeAuthoredWalls: true,
	});

	assert.deepEqual(got.drawings, ["art1"], "the backdrop survives a generation-style clear");
});

test("generating over a reskinned map keeps the reskin's wall art", () => {
	// Reskin art is authored — it was drawn along walls the map already had — so
	// generation must not sweep it up along with its own output.
	const got = collectDungeonDocuments(reskinnedScene(), { elevation: 0 }, false);

	assert.deepEqual(got.drawings, [], "neither the reskin art nor the backdrop goes");
	assert.deepEqual(got.tiles, ["t1", "t2"], "generated floor is still cleared");
});

test("generated walls and doors are collected", () => {
	const scene = {
		tiles: [sdx("t", { dungeonStairs: true }), sdx("c", { dungeonClutter: true })],
		walls: [sdx("w", { dungeonGenWall: true }), foreign("hand-drawn")],
		drawings: [],
		lights: [],
	};
	const got = collectDungeonDocuments(scene, { elevation: 0 }, false);

	assert.deepEqual(got.tiles, ["t", "c"], "stairs and clutter count as dungeon tiles");
	assert.deepEqual(got.walls, ["w"], "a hand-drawn wall is never SDX's to delete");
});

// The policy that used to be inconsistent: the painter's rebuild spared
// hand-drawn interior walls (that is what lets them survive a repaint) while
// generation's clear deleted them. Same flag, opposite meaning, decided by which
// button you happened to press. Both now preserve; only the explicit Clear
// removes, because there the user asked by name and the dialog itemises it.

/** A hand-drawn interior wall: art and collision, both flagged authored. */
function authoredWallScene() {
	return {
		tiles: [sdx("floor", { dungeonFloor: true })],
		walls: [
			sdx("gen-wall", { dungeonGenWall: true }),
			sdx("hand-wall", { dungeonGenWall: true, dungeonIntWall: true }),
		],
		drawings: [
			sdx("gen-art", { dungeonWall: true }),
			sdx("hand-art", { dungeonWall: true, dungeonIntWall: true }),
		],
		lights: [],
	};
}

test("generation preserves hand-drawn walls", () => {
	const got = collectDungeonDocuments(authoredWallScene(), { elevation: 0 }, false);

	assert.deepEqual(got.walls, ["gen-wall"], "an authored wall survives a generation clear");
	assert.deepEqual(got.drawings, ["gen-art"], "and so does its art");
	assert.deepEqual(got.tiles, ["floor"], "generated floor still goes");
});

test("the Clear button removes hand-drawn walls", () => {
	const got = collectDungeonDocuments(authoredWallScene(), { elevation: 0 }, false, {
		includeAuthoredWalls: true,
	});

	assert.deepEqual(got.walls, ["gen-wall", "hand-wall"]);
	assert.deepEqual(got.drawings, ["gen-art", "hand-art"]);
});

test("both halves of an authored wall are decided the same way", () => {
	// The failure this guards is a split verdict — art deleted, collision kept,
	// or the reverse — which leaves a wall that blocks nothing or blocks
	// invisibly. The two predicates must agree for both option values.
	for (const includeAuthoredWalls of [false, true]) {
		const got = collectDungeonDocuments(authoredWallScene(), { elevation: 0 }, false, {
			includeAuthoredWalls,
		});
		assert.equal(
			got.walls.includes("hand-wall"), got.drawings.includes("hand-art"),
			`art and collision disagreed with includeAuthoredWalls=${includeAuthoredWalls}`
		);
	}
});

// The other half of the same policy question, on the painter's side. The wall
// rebuild derives its perimeter from painted floor — and a reskin lays down
// hundreds of floor tiles over a map that already has walls. If those counted,
// painting one tile afterwards would wrap the whole reskinned region in a
// grid-stepped second wall: the staircase, back through a side door.

const floorTile = (id, gx, gy, flags) => ({
	id,
	x: gx * 100,
	y: gy * 100,
	elevation: 0,
	texture: { src: "modules/shadowdark-extras/assets/Dungeon/floor_tiles/stone.webp" },
	flags: { [MODULE_ID]: flags },
});

test("reskinned floor does not feed the wall rebuild", () => {
	const scene = {
		tiles: [
			floorTile("painted", 1, 1, { dungeonFloor: true }),
			floorTile("reskinned", 5, 5, { dungeonFloor: true, dungeonReskinFloor: true }),
		],
	};

	const floors = collectPaintedFloors(scene, { elevation: 0 }, 100);

	assert.deepEqual([...floors], ["1,1"], "only hand-painted floor makes walls");
});

test("painted floor still feeds the wall rebuild", () => {
	// Guards the fix from over-reaching into "no floor ever makes walls".
	const scene = {
		tiles: [
			floorTile("a", 0, 0, { dungeonFloor: true }),
			floorTile("b", 1, 0, { dungeonFloor: true }),
		],
	};

	const floors = collectPaintedFloors(scene, { elevation: 0 }, 100);

	assert.deepEqual([...floors].sort(), ["0,0", "1,0"]);
});

test("non-floor tiles are ignored regardless of flags", () => {
	const scene = {
		tiles: [{
			id: "decor", x: 0, y: 0, elevation: 0,
			texture: { src: "modules/shadowdark-extras/assets/Dungeon/decor/barrel.webp" },
			flags: { [MODULE_ID]: { dungeonFloor: true } },
		}],
	};

	assert.equal(collectPaintedFloors(scene, { elevation: 0 }, 100).size, 0);
});

test("the count the dialog shows is the count that gets deleted", () => {
	// The dialog sums these four arrays and clearSceneAtLevel deletes these four
	// arrays, from one call. This asserts the shape that guarantee rests on.
	const got = collectDungeonDocuments(reskinnedScene(), { elevation: 0 }, false, CLEAR_OPTIONS);

	assert.deepEqual(Object.keys(got).sort(), ["drawings", "lights", "tiles", "walls"]);
	for (const ids of Object.values(got)) {
		assert.ok(Array.isArray(ids) && ids.every(id => typeof id === "string"), "each entry is an id list");
	}
	assert.equal(got.tiles.length + got.walls.length + got.drawings.length + got.lights.length, 5);
});
