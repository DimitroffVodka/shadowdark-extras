// The hand-drawn hex river/path pieces: which piece serves which edge set,
// how a stored network's centre-point polylines turn back into per-cell edge
// sets, and where the sprites land.
//
// The piece table is measured off the art's alpha channel (see the module
// header); these tests pin the orientation maths on top of it, which is what
// would silently put a river's channel on the wrong edge.

import assert from "node:assert/strict";
import test from "node:test";

import {
	ART_IMAGE, ART_PIECES, COAST_PIECES, ICE_PIECES, coastArtPlacements, coastCells, coverCoastEdges, coverEdges,
	coverIceEdges, mapNetworkArtPlacements, mapNetworkCellEdges,
} from "../../scripts/canvas/map-network-art.mjs";

const N = 0; const NE = 1; const SE = 2; const S = 3; const SW = 4; const NW = 5;

/** Edge set a picked piece actually serves once mirrored and rotated. */
const served = ({ name, rotation, mirror }) => ART_PIECES[name]
	.map(k => ((mirror ? (6 - k) % 6 : k) + rotation) % 6).sort();

const subsets = size => {
	const out = [];
	for (let mask = 1; mask < 64; mask++) {
		const edges = [0, 1, 2, 3, 4, 5].filter(k => mask & (1 << k));
		if (edges.length === size) out.push(edges);
	}
	return out;
};

test("every edge set of one to six edges is covered exactly by pieces inside it", () => {
	for (let size = 1; size <= 6; size++) {
		for (const edges of subsets(size)) {
			const pieces = coverEdges(edges);
			assert.ok(pieces.length, `no cover for ${edges}`);
			const union = new Set();
			for (const piece of pieces) {
				const has = served(piece);
				assert.ok(has.every(k => edges.includes(k)), `${piece.name} leaves the cell for ${edges}`);
				for (const k of has) union.add(k);
			}
			assert.deepEqual([...union].sort(), edges, `cover of ${edges} misses an edge`);
		}
	}
});

test("straights, bends and tributaries come from one piece; the trident needs two", () => {
	assert.equal(coverEdges([N, S]).length, 1);
	assert.equal(coverEdges([NE, S]).length, 1, "a 120° bend exists in every rotation");
	assert.equal(coverEdges([SW, NW]).length, 1, "a 60° bend exists in every rotation");
	assert.equal(coverEdges([N, NE, S]).length, 1);
	assert.equal(coverEdges([N, SE, SW]).length, 2, "the symmetric Y is not in the art");
	assert.equal(coverEdges([N, NE, SE, S, SW, NW]).length, 2, "a crossing plus a straight");
});

test("a lone edge is a headwater, never the lake piece", () => {
	for (let seed = 0; seed < 12; seed++) {
		for (let k = 0; k < 6; k++) {
			const [piece] = coverEdges([k], seed);
			assert.ok(!piece.name.startsWith("10 "), `lake placed for edge ${k}`);
			assert.deepEqual(served(piece), [k]);
		}
	}
});

test("mirroring is applied before rotation, matching PIXI's scale-then-rotate", () => {
	// "5 NE" reaches N and NE. Mirrored it reaches N and NW; turned one step
	// clockwise from there it reaches NE and N again — a different piece
	// orientation serving the same set, which the exact index must accept.
	const piece = coverEdges([SE, S], 3).find(() => true);
	assert.deepEqual(served(piece), [SE, S]);
});

// ── a flat-top (HEXODDQ) grid the size of the builder's ─────────────────────
const SIZE = 256;
const CELL_W = SIZE * 2 / Math.sqrt(3);
const flatGrid = {
	size: SIZE, columns: true, isHexagonal: true,
	getCenterPoint: ({ i, j }) => ({
		x: (j * CELL_W * 0.75) + (CELL_W / 2),
		y: (i * SIZE) + (SIZE / 2) + (j % 2 ? SIZE / 2 : 0),
	}),
	getOffset(point) {
		if (point.i !== undefined) return { i: point.i, j: point.j };
		let best = null;
		for (let i = -1; i < 6; i++) {
			for (let j = -1; j < 6; j++) {
				const c = this.getCenterPoint({ i, j });
				const d = Math.hypot(c.x - point.x, c.y - point.y);
				if (!best || d < best.d) best = { d, i, j };
			}
		}
		return { i: best.i, j: best.j };
	},
};
const centre = (i, j) => { const c = flatGrid.getCenterPoint({ i, j }); return [c.x, c.y]; };

test("a stored polyline gives each cell the edges it is entered and left by", () => {
	// Column 0 straight down (N-S), then across to the SE neighbour (1,1) of (1,0).
	const cells = mapNetworkCellEdges([[centre(0, 0), centre(1, 0), centre(1, 1)]], flatGrid);
	const byKey = Object.fromEntries(cells.map(c => [`${c.i}:${c.j}`, c.edges]));
	assert.deepEqual(byKey["0:0"], [S]);
	assert.deepEqual(byKey["1:0"], [N, SE]);
	assert.deepEqual(byKey["1:1"], [NW]);
});

test("a river mouth carried into a water hex draws in the land cell only", () => {
	const [x0, y0] = centre(2, 2);
	const [x1, y1] = centre(2, 3); // the SE neighbour of (2,2) in an odd column shift
	const outlet = [x0 + ((x1 - x0) * 0.7), y0 + ((y1 - y0) * 0.7)];
	const cells = mapNetworkCellEdges([[centre(1, 2), centre(2, 2), outlet]], flatGrid);
	assert.deepEqual(cells.map(c => `${c.i}:${c.j}`).sort(), ["1:2", "2:2"], "the water hex gets no piece");
	assert.deepEqual(cells.find(c => c.i === 2 && c.j === 2).edges, [N, SE]);
});

test("placements scale the 418 px art hex to the grid and name the right file", () => {
	const placements = mapNetworkArtPlacements([[centre(0, 0), centre(1, 0)]], flatGrid, "river");
	assert.equal(placements.length, 2);
	const scale = SIZE / ART_IMAGE.hexHeight;
	for (const p of placements) {
		assert.ok(p.src.startsWith("modules/shadowdark-extras/assets/symbols/Paths/Hex - River "));
		assert.ok(p.src.endsWith(".webp"));
		assert.ok(Math.abs(p.width - (ART_IMAGE.width * scale)) < 1e-9);
		assert.ok(Math.abs(p.height - (ART_IMAGE.height * scale)) < 1e-9);
		const steps = p.rotation / (Math.PI / 3);
		assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, "flat-top art turns in whole 60° steps");
	}
	const road = mapNetworkArtPlacements([[centre(0, 0), centre(1, 0)]], flatGrid, "road");
	assert.ok(road[0].src.includes("Hex - Dirt Path "));
});

test("pointy-top grids turn the flat-top art a further 30°", () => {
	const pointy = {
		size: 100, columns: false, isHexagonal: true,
		getCenterPoint: ({ i, j }) => ({ x: (j * 100) + 50 + (i % 2 ? 50 : 0), y: i * 86.6 + 50 }),
		getOffset(point) {
			if (point.i !== undefined) return point;
			let best = null;
			for (let i = 0; i < 4; i++) {
				for (let j = 0; j < 4; j++) {
					const c = this.getCenterPoint({ i, j });
					const d = Math.hypot(c.x - point.x, c.y - point.y);
					if (!best || d < best.d) best = { d, i, j };
				}
			}
			return { i: best.i, j: best.j };
		},
	};
	const a = pointy.getCenterPoint({ i: 0, j: 0 });
	const b = pointy.getCenterPoint({ i: 0, j: 1 }); // due east: a pointy hex's E edge
	const [cellA] = mapNetworkCellEdges([[[a.x, a.y], [b.x, b.y]]], pointy);
	assert.deepEqual(cellA.edges, [1], "east is the second edge clockwise from NE");
	const [p] = mapNetworkArtPlacements([[[a.x, a.y], [b.x, b.y]]], pointy, "river");
	const degrees = (p.rotation * 180 / Math.PI) % 60;
	assert.ok(Math.abs(degrees - 30) < 1e-9, `expected a 30° offset, got ${degrees}`);
});

test("nothing is placed without a grid that can map points to cells", () => {
	assert.deepEqual(mapNetworkCellEdges([[[0, 0], [1, 1]]], null), []);
	assert.deepEqual(mapNetworkArtPlacements([], flatGrid, "river"), []);
});

// ── coasts ──────────────────────────────────────────────────────────────────
// A beach lines the edges of a WATER hex that face land. The eleven pieces are
// one edge, two adjacent edges and three consecutive edges; everything else is
// a union, which for a coast can legitimately be two single-edge pieces.

const coastServed = ({ name, rotation, mirror }) => COAST_PIECES[name]
	.map(k => ((mirror ? (6 - k) % 6 : k) + rotation) % 6).sort();

test("every water-facing edge set is lined by beach pieces inside the cell", () => {
	for (let size = 1; size <= 6; size++) {
		for (const edges of subsets(size)) {
			const pieces = coverCoastEdges(edges);
			assert.ok(pieces.length, `no beach for ${edges}`);
			const union = new Set();
			for (const piece of pieces) {
				const has = coastServed(piece);
				assert.ok(has.every(k => edges.includes(k)), `${piece.name} lines a dry edge for ${edges}`);
				for (const k of has) union.add(k);
			}
			assert.deepEqual([...union].sort(), edges, `beach for ${edges} misses an edge`);
		}
	}
});

test("one edge, an adjacent pair and a consecutive triple are each one beach piece", () => {
	for (let k = 0; k < 6; k++) {
		assert.match(coverCoastEdges([k])[0].name, /^\(small\)/);
		assert.match(coverCoastEdges([k, (k + 1) % 6])[0].name, /^\(medium\)/);
		assert.equal(coverCoastEdges([k, (k + 1) % 6]).length, 1);
		assert.match(coverCoastEdges([k, (k + 1) % 6, (k + 2) % 6])[0].name, /^\(big\)/);
		assert.equal(coverCoastEdges([k, (k + 1) % 6, (k + 2) % 6]).length, 1);
	}
	const strait = coverCoastEdges([N, S]);
	assert.equal(strait.length, 2, "water on opposite sides is two separate beaches");
	assert.ok(strait.every(p => p.name.startsWith("(small)")));
	const island = coverCoastEdges([N, NE, SE, S, SW, NW]);
	assert.equal(island.length, 2, "a one-hex island is two big beaches");
	assert.ok(island.every(p => p.name.startsWith("(big)")));
});

// Six-way adjacency for the flat-top grid above: every neighbour's centre is
// exactly one cell height away.
const sixWay = {
	...flatGrid,
	getAdjacentOffsets({ i, j }) {
		const here = this.getCenterPoint({ i, j });
		const out = [];
		for (let di = -1; di <= 1; di++) {
			for (let dj = -1; dj <= 1; dj++) {
				if (!di && !dj) continue;
				const there = this.getCenterPoint({ i: i + di, j: j + dj });
				if (Math.hypot(there.x - here.x, there.y - here.y) < SIZE * 1.1) out.push({ i: i + di, j: j + dj });
			}
		}
		return out;
	},
};

test("a water hex is lined on exactly the edges with land across them", () => {
	const land = new Set();
	for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (`${i}_${j}` !== "2_2") land.add(`${i}_${j}`);
	const [island] = coastCells(["2_2"], land, sixWay);
	assert.deepEqual(island.edges, [N, NE, SE, S, SW, NW], "a pond ringed by land is lined all round");
	const [shore] = coastCells(["2_2"], new Set(["1_2"]), sixWay);
	assert.deepEqual(shore.edges, [N], "land above only lines the north edge");
	assert.deepEqual(coastCells(["2_2"], new Set(["0_0"]), sixWay), [], "land that does not touch it lines nothing");
});

test("coast placements name the beach files and carry the cell they belong to", () => {
	const cells = coastCells(["2_2"], new Set(["1_2"]), sixWay);
	const [p] = coastArtPlacements(cells, sixWay);
	assert.match(p.src, /^modules\/shadowdark-extras\/assets\/symbols\/Coast\/Hex - Coast - Beach \(small\) (N|NW|S|SW)\.webp$/);
	assert.deepEqual([p.i, p.j], [2, 2]);
	assert.deepEqual([p.x, p.y], centre(2, 2));
	const steps = p.rotation / (Math.PI / 3);
	assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9);
});

// The ice shelf: three pieces, one per shape, so every orientation comes from
// turning, and the file lives with the Specials rather than the Coast set.
const iceServed = ({ name, rotation, mirror }) => ICE_PIECES[name]
	.map(k => ((mirror ? (6 - k) % 6 : k) + rotation) % 6).sort();

test("every land-facing edge set of an arctic hex is lined by ice pieces inside the cell", () => {
	for (let size = 1; size <= 6; size++) {
		for (const edges of subsets(size)) {
			const pieces = coverIceEdges(edges);
			assert.ok(pieces.length, `no ice for ${edges}`);
			const union = new Set();
			for (const piece of pieces) {
				const has = iceServed(piece);
				assert.ok(has.every(k => edges.includes(k)), `${piece.name} lines a dry edge for ${edges}`);
				for (const k of has) union.add(k);
			}
			assert.deepEqual([...union].sort(), edges, `ice for ${edges} misses an edge`);
		}
	}
	for (let k = 0; k < 6; k++) {
		assert.equal(coverIceEdges([k, (k + 1) % 6, (k + 2) % 6]).length, 1, "three consecutive edges are one big shelf");
	}
});

test("the ice style names the Specials file and keeps the beach frame", () => {
	const cells = coastCells(["2_2"], new Set(["1_2"]), sixWay);
	const [ice] = coastArtPlacements(cells, sixWay, "ice");
	const [sand] = coastArtPlacements(cells, sixWay, "beach");
	assert.match(ice.src, /^modules\/shadowdark-extras\/assets\/Hexes\/Specials\/Hex - Coast - Ice Floats \(small\) N\.webp$/);
	assert.match(sand.src, /symbols\/Coast\/Hex - Coast - Beach \(small\)/);
	assert.deepEqual([ice.width, ice.height, ice.rotation], [sand.width, sand.height, sand.rotation], "a quarter-size image fills the same frame");
	assert.deepEqual(coastArtPlacements(cells, sixWay, "nonsense")[0].src, sand.src, "an unknown style falls back to sand");
});
