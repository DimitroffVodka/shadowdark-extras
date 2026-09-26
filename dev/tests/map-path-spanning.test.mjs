// buildMapPathNetwork's `spanning` option.
//
// Its own file rather than an addition to canvas-drawing-geometry.test.mjs,
// which is mid-edit on this branch for unrelated road/river authoring work.
//
// WHY THE OPTION EXISTS. A DRAWN network is a line the GM picked cell by cell,
// and a ring there is deliberate. An IMPORTED one is an area tag — every hex an
// overlay marked as river arrives at once — so neighbouring marked hexes wire
// up into a mesh, and any three mutually adjacent hexes close into a triangle.
// Measured on the Western Reaches import: 139 river cells produced 45 paths,
// 112 segments and 1 closed ring. A watercourse is a tree, so the imported side
// asks for a spanning forest and gets 32 paths, 105 segments and no ring.

import assert from "node:assert/strict";
import test from "node:test";

import { buildMapPathNetwork, mapPathEdgeKey } from "../../scripts/canvas/drawing-geometry.mjs";

/**
 * Square-grid stand-in: four-way adjacency is enough to build a triangle-free
 * cycle and a branch, and keeps the expected geometry readable.
 */
const grid = {
	getAdjacentOffsets: ({ i, j }) => [
		{ i: i - 1, j }, { i: i + 1, j }, { i, j: j - 1 }, { i, j: j + 1 },
	],
	getCenterPoint: ({ i, j }) => ({ x: j * 100, y: i * 100 }),
};

const segments = paths => paths.reduce((n, p) => n + Math.max(0, p.length - 1), 0);
const closedRings = paths => paths.filter(
	p => p.length > 2 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1],
).length;

// A 2x2 block: every cell has two neighbours, so the adjacency is a 4-cycle.
const ring = [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 1, j: 0 }, { i: 1, j: 1 }];

test("without the option a closed loop survives, because a drawn ring is the GM's", () => {
	const paths = buildMapPathNetwork(ring, grid);
	assert.equal(segments(paths), 4, "all four adjacencies are drawn");
	assert.equal(closedRings(paths), 1, "the loop closes");
});

test("spanning drops the one edge that closes the loop, and keeps every cell", () => {
	const paths = buildMapPathNetwork(ring, grid, [], null, { spanning: true });
	assert.equal(closedRings(paths), 0, "no cycle survives");
	assert.equal(segments(paths), 3, "a 4-cell tree has exactly 3 edges");
	const visited = new Set(paths.flat().map(([x, y]) => `${x},${y}`));
	assert.equal(visited.size, 4, "spanning thins edges, never cells");
});

test("spanning keeps separate systems separate instead of joining them", () => {
	// Two 2x2 blocks far apart: a forest of two trees, not one tree.
	const far = ring.map(({ i, j }) => ({ i: i + 20, j: j + 20 }));
	const paths = buildMapPathNetwork([...ring, ...far], grid, [], null, { spanning: true });
	assert.equal(closedRings(paths), 0);
	assert.equal(segments(paths), 6, "3 edges per component, never a bridge between them");
});

test("a line is untouched: spanning only ever removes a cycle-closing edge", () => {
	const line = [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 2 }, { i: 0, j: 3 }];
	const plain = buildMapPathNetwork(line, grid);
	const spanned = buildMapPathNetwork(line, grid, [], null, { spanning: true });
	assert.deepEqual(spanned, plain, "an acyclic network is already its own spanning forest");
});

test("blocked edges still win, and spanning does not route around them", () => {
	// Block one edge of the ring: the adjacency is already a path, so spanning
	// must change nothing — it must not restore the blocked edge to reconnect.
	const cut = [mapPathEdgeKey({ i: 0, j: 0 }, { i: 0, j: 1 })];
	const blocked = buildMapPathNetwork(ring, grid, cut);
	const spanned = buildMapPathNetwork(ring, grid, cut, null, { spanning: true });
	assert.equal(segments(blocked), 3, "the cut really removed an edge");
	assert.equal(segments(spanned), segments(blocked));
	assert.equal(closedRings(spanned), 0);
});
