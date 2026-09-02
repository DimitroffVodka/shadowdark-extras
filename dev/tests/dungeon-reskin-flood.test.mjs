// The reskin tool derives its floor cells by flooding outward from a clicked
// point until the scene's existing walls stop it. Everything downstream — which
// tiles get painted, which walls get replaced — is a consequence of that fill,
// so this is the piece worth pinning.
//
// Three behaviours are load-bearing and each is asserted below:
//   1. a sealed room floods to exactly its interior, and no further
//   2. a room with a gap LEAKS, and reports it rather than returning a plausible
//      cell set — silently painting a whole battlemap is the failure this tool
//      most has to avoid
//   3. a closed door does not stop the fill, so one click covers a connected
//      dungeon instead of one room at a time
//
// NOT TESTED HERE — the document writes in reskinRegion (tile creation, wall
// deletion, the confirm dialog). Those are Foundry document calls with no
// return value to assert on; they belong to live verification.

import assert from "node:assert/strict";
import test from "node:test";

const GRID = 100;

/** Real segment intersection, so the stubbed backend behaves like Foundry's. */
function segmentsIntersect(a, b, c, d) {
	const orient = (p, q, r) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
	const o1 = orient(a, b, c);
	const o2 = orient(a, b, d);
	const o3 = orient(c, d, a);
	const o4 = orient(c, d, b);
	return o1 !== o2 && o3 !== o4;
}

globalThis.foundry = { utils: { lineSegmentIntersects: segmentsIntersect } };
globalThis.canvas = {};

/**
 * Install a movement backend that blocks on the given wall segments, which is
 * the contract floodFillFromWalls consumes from Foundry.
 * @param {Array<{c: number[]}>} walls
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
}

/** A scene stub carrying only what the fill reads. */
function sceneWith(walls, { cols = 12, rows = 12 } = {}) {
	return {
		grid: { size: GRID },
		dimensions: { width: cols * GRID, height: rows * GRID },
		// A real array: findEnclosedAreas iterates it, floodFillFromWalls filters it.
		walls,
	};
}

/** Axis-aligned wall along a run of cell edges. */
const hWall = (gx1, gx2, gy) => ({ c: [gx1 * GRID, gy * GRID, gx2 * GRID, gy * GRID], door: 0 });
const vWall = (gx, gy1, gy2) => ({ c: [gx * GRID, gy1 * GRID, gx * GRID, gy2 * GRID], door: 0 });

/** A closed 3x3 room spanning cells (2,2)..(4,4). */
function sealedRoom() {
	return [hWall(2, 5, 2), hWall(2, 5, 5), vWall(2, 2, 5), vWall(5, 2, 5)];
}

const {
	findEnclosedAreas,
	findRoomAreas,
	floodFillFromWalls,
	wallDrawingGeometry,
} = await import("../../scripts/dungeon/dungeon-reskin.mjs");

// The fill reads the SCENE'S WALL DOCUMENTS, not Foundry's movement polygon
// backend. That backend answers from canvas.edges — canvas state rather than
// scene state — and on a real 843-wall scene it disagreed badly: the same walls
// this code resolves into 1 area of 1255 cells came back as 26 areas of 6474,
// nearly the whole canvas. Reading the documents is also what makes these tests
// possible without a canvas at all.
test("the fill ignores the collision backend and reads the walls", () => {
	const walls = sealedRoom();
	// A backend that claims nothing ever blocks. If the fill consulted it, the
	// room would leak; it must not even be asked.
	globalThis.CONFIG = {
		Canvas: { polygonBackends: { move: { testCollision: () => false } } },
	};

	const result = floodFillFromWalls(sceneWith(walls), { x: 250, y: 250 });

	assert.equal(result.leaked, false, "the scene's own walls must hold");
	assert.equal(result.cells.size, 9);
});

test("a wall that does not block movement does not stop the fill", () => {
	// move: 0 is a sight-only wall — a window or a visual divider. It is not a
	// boundary for anything walking, so it must not bound a room either.
	const walls = sealedRoom().map((w, i) => (i === 0 ? { ...w, move: 0 } : w));
	installWalls(walls);

	const result = floodFillFromWalls(sceneWith(walls), { x: 250, y: 250 });

	assert.equal(result.leaked, true, "the fill escapes through the sight-only wall");
});

test("a sealed room floods to exactly its interior", () => {
	installWalls(sealedRoom());
	const result = floodFillFromWalls(sceneWith(sealedRoom()), { x: 250, y: 250 });

	assert.equal(result.leaked, false, "a closed room must not report a leak");
	assert.deepEqual(
		[...result.cells].sort(),
		["2,2", "2,3", "2,4", "3,2", "3,3", "3,4", "4,2", "4,3", "4,4"].sort(),
		"the fill must cover the room's nine cells and nothing outside them"
	);
});

test("a gap in the wall reports a leak instead of a cell set", () => {
	// Same room with the south wall cut short, leaving cell (4,5) open.
	const leaky = [hWall(2, 5, 2), hWall(2, 4, 5), vWall(2, 2, 5), vWall(5, 2, 5)];
	installWalls(leaky);
	const result = floodFillFromWalls(sceneWith(leaky), { x: 250, y: 250 });

	assert.equal(result.leaked, true, "an unsealed room must be reported, not painted");
	assert.equal(result.reason, "border", "reaching the canvas edge is the leak signal");
});

test("the cell cap stops a runaway fill", () => {
	installWalls([]);
	const result = floodFillFromWalls(sceneWith([], { cols: 200, rows: 200 }), { x: 250, y: 250 }, { maxCells: 50 });

	assert.equal(result.leaked, true, "hitting the cap is a leak");
	assert.equal(result.reason, "cap");
	assert.ok(result.cells.size <= 51, "the fill must stop at the cap, not run to completion");
});

test("a closed door does not stop the fill", () => {
	// Two 3x3 rooms side by side sharing the wall at gx=5, with a door in it.
	const shared = [
		hWall(2, 8, 2), hWall(2, 8, 5), vWall(2, 2, 5), vWall(8, 2, 5),
		vWall(5, 2, 3), vWall(5, 4, 5),
	];
	const door = { c: [5 * GRID, 3 * GRID, 5 * GRID, 4 * GRID], door: 1 };
	// The door blocks movement while closed — the fill has to see through it.
	installWalls([...shared, door]);

	const result = floodFillFromWalls(sceneWith([...shared, door]), { x: 250, y: 250 });

	assert.equal(result.leaked, false);
	assert.equal(result.cells.size, 18, "both rooms flood as one region through the door");
	assert.ok(result.cells.has("7,4"), "the far room must be reached");
});

// Wall art is drawn along each source wall rather than rebuilt from the painted
// cell perimeter, because a perimeter rebuild can only emit axis-aligned
// segments and turns every diagonal into a staircase. The diagonal case below is
// the one that forced this design, so it is the one that must not regress.

/** The rotated rectangle's two end points, recovered from its drawing data. */
function endpointsOf(drawing) {
	const theta = drawing.rotation * Math.PI / 180;
	const half = drawing.shape.width / 2;
	const cx = drawing.x + half;
	const cy = drawing.y + (drawing.shape.height / 2);
	return [
		{ x: cx - (half * Math.cos(theta)), y: cy - (half * Math.sin(theta)) },
		{ x: cx + (half * Math.cos(theta)), y: cy + (half * Math.sin(theta)) },
	];
}

test("wall art is drawn along a diagonal, not stepped onto the grid", () => {
	// A 3-4-5 diagonal: length 500, angle atan2(400,300) = 53.13 degrees.
	const drawing = wallDrawingGeometry([1000, 1000, 1300, 1400], "wall.webp");

	assert.equal(Math.round(drawing.shape.width), 500, "width is the true segment length");
	assert.ok(Math.abs(drawing.rotation - 53.130102) < 0.001, "rotation matches the segment angle");

	// The recovered endpoints must be the ORIGINAL wall's endpoints — that is
	// what "the art sits on the collision line" means, and it is exactly what a
	// grid-stepped rebuild cannot do.
	const [a, b] = endpointsOf(drawing);
	assert.ok(Math.abs(a.x - 1000) < 0.001 && Math.abs(a.y - 1000) < 0.001, `start ${JSON.stringify(a)}`);
	assert.ok(Math.abs(b.x - 1300) < 0.001 && Math.abs(b.y - 1400) < 0.001, `end ${JSON.stringify(b)}`);
});

test("wall art round-trips for axis-aligned and reversed segments too", () => {
	for (const c of [[500, 500, 900, 500], [500, 500, 500, 900], [900, 500, 500, 500], [1300, 1400, 1000, 1000]]) {
		const [a, b] = endpointsOf(wallDrawingGeometry(c, "wall.webp"));
		const got = [a.x, a.y, b.x, b.y].map(v => Math.round(v));
		const forward = got.every((v, i) => Math.abs(v - c[i]) < 1);
		const reversed = got.every((v, i) => Math.abs(v - c[[2, 3, 0, 1][i]]) < 1);
		assert.ok(forward || reversed, `${JSON.stringify(c)} came back as ${JSON.stringify(got)}`);
	}
});

test("a degenerate wall produces no drawing", () => {
	assert.equal(wallDrawingGeometry([100, 100, 102, 100], "wall.webp"), null);
});


// A map is rarely one connected space. The reskin used to fill outward from a
// single click, so on a real 16-area map it did the one area under the cursor
// and silently left the other fifteen bare — including two whole corridor
// systems in a corner of the map. Finding the areas is what fixes that, and the
// count is the part that has to be right.
test("every walled-off area is found, not just the one under a point", () => {
	// Two sealed rooms with no route between them.
	const far = [
		...sealedRoom(),
		hWall(8, 11, 2), hWall(8, 11, 5), vWall(8, 2, 5), vWall(11, 2, 5),
	];
	installWalls(far);

	const areas = findEnclosedAreas(sceneWith(far, { cols: 14, rows: 14 }), GRID);

	assert.equal(areas.length, 2, "a second sealed room must not be skipped");
	for (const area of areas) assert.equal(area.size, 9, "each is its own 3x3");
});

test("areas come back largest first", () => {
	const mixed = [
		...sealedRoom(),
		hWall(8, 12, 2), hWall(8, 12, 7), vWall(8, 2, 7), vWall(12, 2, 7),
	];
	installWalls(mixed);

	const areas = findEnclosedAreas(sceneWith(mixed, { cols: 14, rows: 14 }), GRID);

	assert.equal(areas.length, 2);
	assert.ok(areas[0].size > areas[1].size, "largest first");
	assert.equal(areas[0].size, 20, "the 4x5 room");
});

test("open ground outside the walls is not an area", () => {
	// The fill started anywhere outside escapes to the canvas edge. That is not
	// an area and must never be floored.
	installWalls(sealedRoom());

	const areas = findEnclosedAreas(sceneWith(sealedRoom(), { cols: 14, rows: 14 }), GRID);

	assert.equal(areas.length, 1, "only the sealed room counts");
	assert.equal(areas[0].size, 9);
});

test("a scene with no walls has no areas", () => {
	installWalls([]);
	assert.deepEqual(findEnclosedAreas(sceneWith([]), GRID), []);
});

// Enclosure alone does not mean floor. On a map whose outer boundary is walled,
// the solid rock BETWEEN the rooms is enclosed too — and flooring it fills the
// whole footprint into one slab with no readable map left. That is a worse
// failure than missing a corner, and it happened on a real map: 16 enclosed
// areas, of which 15 totalling 484 cells were rock.
//
// Doors separate them. Rooms are what people put doors on.

/** Two rooms joined by a door, inside an outer boundary — so the gap between
 *  the rooms and that boundary is enclosed rock with no door opening into it. */
function roomsAndRock() {
	return [
		hWall(1, 12, 1), hWall(1, 12, 7), vWall(1, 1, 7), vWall(12, 1, 7),
		hWall(2, 8, 2), hWall(2, 8, 5), vWall(2, 2, 5), vWall(8, 2, 5),
		vWall(5, 2, 3), { c: [500, 300, 500, 400], door: 1 }, vWall(5, 4, 5),
	];
}

test("rock between the rooms is enclosed but is not a room", () => {
	const walls = roomsAndRock();
	installWalls(walls);
	const scene = sceneWith(walls, { cols: 14, rows: 9 });

	assert.equal(findEnclosedAreas(scene, GRID).length, 2, "the rock IS enclosed");

	const rooms = findRoomAreas(scene, GRID);
	assert.equal(rooms.length, 1, "but only the room has a door opening into it");
	assert.equal(rooms[0].size, 18, "the two 3x3 rooms joined through the door");
});

test("a door beside a pocket does not make the pocket a room", () => {
	// The discriminator is that a door OPENS INTO the area, not that one is
	// nearby. A proximity test kept 13 of 16 areas on the real map.
	const walls = roomsAndRock();
	installWalls(walls);
	const rock = findEnclosedAreas(sceneWith(walls, { cols: 14, rows: 9 }), GRID)
		.find(area => !area.has("3,3"));

	assert.ok(rock, "the rock area exists");
	assert.ok(rock.size > 0);
	assert.equal(
		findRoomAreas(sceneWith(walls, { cols: 14, rows: 9 }), GRID).some(a => a === rock), false,
		"and is not returned as a room"
	);
});

test("with no doors anywhere, only the largest area is taken", () => {
	// No signal to work with. Erring toward doing too little is recoverable with
	// Paint Room Floor; erring the other way is only undone by Clear.
	const walls = [
		...sealedRoom(),
		hWall(8, 12, 2), hWall(8, 12, 7), vWall(8, 2, 7), vWall(12, 2, 7),
	];
	installWalls(walls);

	const rooms = findRoomAreas(sceneWith(walls, { cols: 14, rows: 14 }), GRID);

	assert.equal(rooms.length, 1);
	assert.equal(rooms[0].size, 20, "the larger of the two");
});

test("a door-less wall between the rooms keeps them separate", () => {
	// Same geometry, but the middle wall is solid — proves the door test above
	// passes because of the door, not because the wall was missing.
	const shared = [
		hWall(2, 8, 2), hWall(2, 8, 5), vWall(2, 2, 5), vWall(8, 2, 5),
		vWall(5, 2, 5),
	];
	installWalls(shared);

	const result = floodFillFromWalls(sceneWith(shared), { x: 250, y: 250 });

	assert.equal(result.leaked, false);
	assert.equal(result.cells.size, 9, "a solid divider must stop the fill at one room");
});
