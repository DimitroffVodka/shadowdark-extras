// The reskin's floor used to be square tiles chosen by cell centre, so along any
// angled wall it overhung by up to half a cell in places and fell short in
// others — the wall art ran true while the floor stepped. Sampling harder does
// not fix it: measured on a real 829-wall map, a 50px sub-cell fill LEAKED out of
// a room the 100px fill held, because finer sampling squeezes through gaps that
// coarser sampling steps over.
//
// So the floor is traced from the walls instead. These tests pin the properties
// that makes safe:
//
//   1. a traced room is the wall polygon exactly, at any angle
//   2. doors bound a FACE even though they are passable to the fill, so a region
//      resolves into rooms rather than one blob
//   3. a trace that disagrees with the flood fill is refused, not painted

import assert from "node:assert/strict";
import test from "node:test";

import {
	clipPolygonToRect,
	polygonArea,
	pointInPolygon,
	subtractRectFromPolygon,
	traceRoomFaces,
	traceWallFaces,
} from "../../scripts/dungeon/dungeon-wall-outline.mjs";

const wall = (x1, y1, x2, y2, door = 0) => ({ c: [x1, y1, x2, y2], door });

/** A 400x400 square room from (100,100) to (500,500). */
const squareRoom = () => [
	wall(100, 100, 500, 100), wall(500, 100, 500, 500),
	wall(500, 500, 100, 500), wall(100, 500, 100, 100),
];

/** The same room with its top-right corner cut off at 45 degrees. */
const angledRoom = () => [
	wall(100, 100, 300, 100), wall(300, 100, 500, 300),
	wall(500, 300, 500, 500), wall(500, 500, 100, 500),
	wall(100, 500, 100, 100),
];

const centres = (x0, y0, x1, y1, step = 100) => {
	const out = [];
	for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y += step) out.push({ x, y });
	return out;
};

test("a square room traces to its exact area", () => {
	const got = traceRoomFaces(squareRoom(), centres(150, 150, 450, 450));

	assert.equal(got.rooms.length, 1);
	assert.equal(Math.round(got.rooms[0].area), 160000, "400x400");
});

test("an angled wall is traced at its true angle, not stepped", () => {
	// Square minus the triangle cut from the corner: 160000 - (200*200/2).
	const got = traceRoomFaces(angledRoom(), centres(150, 150, 450, 450));

	assert.equal(got.rooms.length, 1);
	assert.equal(Math.round(got.rooms[0].area), 140000, "the diagonal removes exactly half the corner");

	// A grid-stepped floor would include this point; the true polygon does not.
	// It sits above the 45-degree line, inside the cell but outside the room.
	assert.equal(pointInPolygon({ x: 460, y: 140 }, got.rooms[0].points), false);
	assert.equal(pointInPolygon({ x: 200, y: 300 }, got.rooms[0].points), true);
});

test("a door bounds a face, so two rooms trace separately", () => {
	// Two 400x400 rooms sharing the x=500 wall, with a door in the middle of it.
	const walls = [
		wall(100, 100, 500, 100), wall(500, 100, 900, 100),
		wall(900, 100, 900, 500), wall(900, 500, 100, 500),
		wall(100, 500, 100, 100),
		wall(500, 100, 500, 250), wall(500, 250, 500, 350, 1), wall(500, 350, 500, 500),
	];
	const got = traceRoomFaces(walls, [...centres(150, 150, 450, 450), ...centres(550, 150, 850, 450)]);

	assert.equal(got.rooms.length, 2, "the door divides the faces even though the fill crosses it");
	for (const room of got.rooms) assert.equal(Math.round(room.area), 160000);
});

test("the outer face is never chosen", () => {
	// The outer face contains every cell centre too, and is the largest face.
	// Choosing the SMALLEST containing face is what excludes it.
	const faces = traceWallFaces(squareRoom(), 1);
	assert.ok(faces.length >= 2, "a closed room yields an inner and an outer face");

	const got = traceRoomFaces(squareRoom(), centres(150, 150, 450, 450));
	assert.equal(got.rooms.length, 1);
	assert.equal(Math.round(got.rooms[0].area), 160000, "not the outer face");
});

test("a trace that disagrees with the fill is refused", () => {
	// The fill claims ten times the area the walls enclose. Something is wrong,
	// and painting an unverified polygon is worse than falling back to tiles.
	const got = traceRoomFaces(squareRoom(), centres(150, 150, 450, 450), {
		expectedArea: 1600000,
	});

	assert.equal(got, null);
});

test("the fill legitimately over-counts, and that is allowed", () => {
	// Whole cells whose centres are inside make the fill's area LARGER than the
	// room. Removing that overhang is the point, so a modest negative drift must
	// pass. On a real map it was 8%.
	const got = traceRoomFaces(angledRoom(), centres(150, 150, 450, 450), {
		expectedArea: 160000,
	});

	assert.ok(got, "a 12.5% overhang must not be rejected");
	assert.ok(got.drift < 0, `expected the trace to be smaller than the fill, got ${got.drift}`);
});

// A real map's cave outline missed closing by 2.8px. With endpoints merged by
// ROUNDING INTO BINS those two points straddled a bin boundary and stayed
// separate at every bin size, so the cave traced no face and 141 filled cells
// got no floor at all — the rest of the map reskinned around a bare hole.
// Merging by DISTANCE is what fixes it, and the two are not interchangeable.
test("a room whose outline misses closing by a few pixels still traces", () => {
	const nearlyClosed = [
		wall(100, 100, 500, 100),
		wall(500, 100, 500, 500),
		wall(500, 500, 100, 500),
		// Ends 2.8px short of (100,100), exactly the real map's failure.
		wall(100, 500, 102, 102),
	];

	const got = traceRoomFaces(nearlyClosed, centres(150, 150, 450, 450));

	assert.ok(got, "a 2.8px miss must not cost the room its floor");
	assert.equal(got.rooms.length, 1);
	assert.equal(got.unmatched.length, 0, "every cell must land in a face");
});

test("a genuine opening is not silently sealed", () => {
	// 100px is a doorway, not a rounding error. Merging it shut would invent a
	// room the map does not have, so the tolerance must stay well below a cell.
	const openRoom = [
		wall(100, 100, 500, 100),
		wall(500, 100, 500, 500),
		wall(500, 500, 100, 500),
		wall(100, 500, 100, 200),
	];

	const got = traceRoomFaces(openRoom, centres(150, 150, 450, 450));

	if (got) {
		assert.ok(
			got.unmatched.length > 0 || got.rooms.every(r => Math.round(r.area) !== 160000),
			"a 100px gap must not be treated as a closed room"
		);
	}
});

// Real maps are not drawn to a tolerance. Walls that look joined often are not,
// which is why "join wall points" tools exist — and needing one before SDX would
// work is a burden the tool should carry itself. A gap wider than the merge
// tolerance is bridged for tracing only: no Wall document is created and the
// map's collision is untouched.
test("a gap too wide to merge is bridged so the room still traces", () => {
	const broken = [
		wall(100, 100, 500, 100),
		wall(500, 100, 500, 500),
		wall(500, 500, 100, 500),
		// Stops 30px short: far past the 4px merge tolerance.
		wall(100, 500, 100, 130),
	];
	const cells = centres(150, 150, 450, 450);

	assert.equal(
		traceRoomFaces(broken, cells)?.unmatched.length ?? cells.length, cells.length,
		"without bridging the walk escapes through the gap and the room gets nothing"
	);

	const got = traceRoomFaces(broken, cells, { bridgeDistance: 50 });
	assert.ok(got, "bridging must recover the room");
	assert.equal(got.bridged, true, "and must report that it repaired something");
	assert.equal(got.unmatched.length, 0);
});

test("bridging is not used when the walls are already sound", () => {
	// A well-drawn map must never be second-guessed: the honest trace is tried
	// first and bridging only runs if that leaves cells with no room.
	const got = traceRoomFaces(squareRoom(), centres(150, 150, 450, 450), { bridgeDistance: 50 });

	assert.equal(got.bridged, false);
	assert.equal(Math.round(got.rooms[0].area), 160000);
});

test("cells no face covers are reported, not dropped", () => {
	// The caller needs these to floor the region some other way. Returning only
	// the rooms is what let a whole cave come out bare.
	const got = traceRoomFaces(squareRoom(), [
		...centres(150, 150, 450, 450),
		{ x: 5000, y: 5000 },
	]);

	assert.ok(got);
	assert.deepEqual(got.unmatched, [{ x: 5000, y: 5000 }]);
});

test("walls that enclose nothing yield no rooms", () => {
	const got = traceRoomFaces([wall(0, 0, 100, 0), wall(100, 0, 200, 0)], [{ x: 50, y: 50 }]);
	assert.equal(got, null);
});

// Clicking floors a whole room, which is right for a room and wrong for a
// corridor network: with no internal doors the whole network is ONE face, so a
// click there floors every corridor at once. A real map produced a single
// 60-vertex polygon spanning 2400x2500px from one click. Dragging cuts the room
// down to what the brush covered.
test("clipping keeps the wall edge and cuts straight where the drag ended", () => {
	const room = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }];
	const clipped = clipPolygonToRect(room, { minX: 100, minY: 0, maxX: 300, maxY: 400 });

	assert.equal(polygonArea(clipped), 200 * 400, "a 200-wide slice of a 400x400 room");
	// The room's own top and bottom edges survive; the sides are the drag.
	assert.ok(clipped.every(p => p.x >= 100 && p.x <= 300));
	assert.ok(clipped.some(p => p.y === 0) && clipped.some(p => p.y === 400));
});

test("a drag covering the whole room changes nothing", () => {
	const room = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }];
	const clipped = clipPolygonToRect(room, { minX: -50, minY: -50, maxX: 450, maxY: 450 });

	assert.equal(polygonArea(clipped), 400 * 400);
});

test("a drag that misses the room yields nothing to paint", () => {
	const room = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
	const clipped = clipPolygonToRect(room, { minX: 500, minY: 500, maxX: 600, maxY: 600 });

	assert.ok(clipped.length < 3, "fewer than three points is not a shape");
});

test("clipping an L-shaped room keeps its inner corner", () => {
	// The corner is the room's own geometry and must not be squared off by the
	// clip — that corner is a wall.
	const lShape = [
		{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 },
		{ x: 100, y: 100 }, { x: 100, y: 300 }, { x: 0, y: 300 },
	];
	const clipped = clipPolygonToRect(lShape, { minX: 0, minY: 0, maxX: 300, maxY: 300 });

	assert.equal(Math.round(polygonArea(clipped)), Math.round(polygonArea(lShape)));
	assert.ok(
		clipped.some(p => p.x === 100 && p.y === 100),
		"the L's inner corner survives the clip"
	);
});

test("polygon helpers agree with hand-computed values", () => {
	const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
	assert.equal(polygonArea(square), 100);
	assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true);
	assert.equal(pointInPolygon({ x: 15, y: 5 }, square), false);
});

// Erasing used to delete whole floor shapes the box touched. Fine when a shape
// is one room; catastrophic when it is not. A corridor network with no internal
// doors traces as ONE polygon, so a 3x3 box anywhere in it deleted the floor of
// an entire map — which is exactly what happened on a real scene.
//
// So the box is CUT out. These pin that what is left is everything except the
// box, with nothing lost and nothing invented.

/** Total area of a set of pieces. */
const totalArea = pieces => pieces.reduce((sum, piece) => sum + polygonArea(piece), 0);

const square = (x0, y0, x1, y1) => [
	{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

test("a box cut from the middle leaves the surrounding floor", () => {
	const room = square(0, 0, 300, 300);
	const pieces = subtractRectFromPolygon(room, { minX: 100, minY: 100, maxX: 200, maxY: 200 });

	assert.equal(totalArea(pieces), (300 * 300) - (100 * 100), "exactly the box is gone");
	assert.ok(pieces.every(p => !pointInPolygon({ x: 150, y: 150 }, p)), "and nothing covers the hole");
	assert.ok(pieces.some(p => pointInPolygon({ x: 50, y: 150 }, p)), "the floor beside it stays");
});

test("erasing one room does not take the corridor with it", () => {
	// The failure this replaces: a long snaking corridor, one small box, and
	// every bit of floor on the map deleted.
	const corridor = [
		{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 100 },
		{ x: 100, y: 100 }, { x: 100, y: 600 }, { x: 0, y: 600 },
	];
	const pieces = subtractRectFromPolygon(corridor, { minX: 400, minY: 0, maxX: 500, maxY: 100 });

	assert.ok(totalArea(pieces) > 0, "floor must survive");
	assert.ok(pieces.some(p => pointInPolygon({ x: 800, y: 50 }, p)), "the far arm stays");
	assert.ok(pieces.some(p => pointInPolygon({ x: 50, y: 400 }, p)), "the other arm stays");
	assert.ok(pieces.every(p => !pointInPolygon({ x: 450, y: 50 }, p)), "only the box is gone");
});

test("a box covering the whole shape leaves nothing", () => {
	const room = square(0, 0, 100, 100);
	assert.deepEqual(subtractRectFromPolygon(room, { minX: -50, minY: -50, maxX: 150, maxY: 150 }), []);
});

test("a box in a corner leaves an L", () => {
	const room = square(0, 0, 200, 200);
	const pieces = subtractRectFromPolygon(room, { minX: 0, minY: 0, maxX: 100, maxY: 100 });

	assert.equal(totalArea(pieces), (200 * 200) - (100 * 100));
	assert.ok(pieces.every(p => !pointInPolygon({ x: 50, y: 50 }, p)));
});

test("a box that misses leaves the shape whole", () => {
	const room = square(0, 0, 100, 100);
	const pieces = subtractRectFromPolygon(room, { minX: 500, minY: 500, maxX: 600, maxY: 600 });

	assert.equal(totalArea(pieces), 100 * 100, "nothing was cut");
});
