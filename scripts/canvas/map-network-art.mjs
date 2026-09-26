// Hand-drawn hex overlay pieces — scripts/canvas/map-network-art.mjs
//
// assets/symbols/Paths/ ships 44 river pieces and 44 matching dirt-path pieces,
// and assets/symbols/Coast/ eleven beach pieces, all drawn for a FLAT-TOP hex.
// Each is a 932x810 transparent image whose hex is centred and 418 px
// flat-to-flat (measured off the straight river pieces). A river or path
// channel meets a hex EDGE at its midpoint at the same ~50 px width, so the
// piece in one hex chains seamlessly with the neighbour's piece across their
// shared edge. A beach is a strip drawn just inside the hex along one to three
// of its edges: straight along the edge, wavy on the inside. It belongs on the
// WATER hex, straight side against the land, wavy side as the waterline, so
// the pieces of neighbouring water hexes join into one shore. The file
// suffixes (N, NE, big, small, ...) are the artist's labels, not usable keys:
// every piece's edge set below was measured from its alpha channel.
//
// A cell's requirement is a subset of the six edges. Rotating a piece in 60°
// steps and mirroring it across the vertical axis reaches every orientation,
// so the river set covers every 1-, 2- and 3-edge set except the symmetric
// trident and most 4-edge sets, and the beach set covers every single edge,
// adjacent pair and consecutive triple. Anything else is drawn as the union
// of two or three pieces in the same cell.
//
// Importless leaf, like drawing-geometry.mjs: pure geometry, no PIXI, so the
// placement it produces is testable under node:test.

const ART_DIR = "modules/shadowdark-extras/assets/symbols/Paths";
const ART_FILE = { river: "Hex - River", road: "Hex - Dirt Path" };
// Two shore styles on the same layout: sand for open water, and the ice shelf
// for arctic water. The three ice pieces ship at 224x194, a quarter of the
// beach resolution, but the hex inside them is placed identically, so they
// scale to the same frame.
const COAST_STYLES = {
	beach: { dir: "modules/shadowdark-extras/assets/symbols/Coast", file: "Hex - Coast - Beach" },
	ice: { dir: "modules/shadowdark-extras/assets/Hexes/Specials", file: "Hex - Coast - Ice Floats" },
};
/** Native image size and the hex's flat-to-flat height inside it, in px. */
export const ART_IMAGE = { width: 932, height: 810, hexHeight: 418 };

// Edge indices run clockwise on screen from the top: N=0 NE=1 SE=2 S=3 SW=4 NW=5.
const N = 0; const NE = 1; const SE = 2; const S = 3; const SW = 4; const NW = 5;

/** Piece name (the part after "Hex - River ") → the edges its channel reaches. */
export const ART_PIECES = {
	// one edge: a thin headwater trickle (1), a winding creek (6), a lake fed by
	// one channel (10)
	"1 N": [N], "1 NE": [NE], "1 SE": [SE], "1 S": [S],
	"6 N": [N], "6 NE": [NE], "6 SE": [SE], "6 S": [S],
	"10 N": [N], "10 NW": [NW], "10 S": [S], "10 SW": [SW],
	// straight through
	"2 N": [N, S], "2 NE": [NE, SW], "9 N": [N, S], "9 SE": [SE, NW],
	// wide bend, edges 120° apart
	"4 N": [N, SW], "4 NE": [NE, NW], "4 S": [S, NW], "4 SE": [SE, SW],
	// sharp bend, adjacent edges
	"5 NE": [N, NE], "5 E": [NE, SE], "5 SE": [SE, S],
	"8 NW": [N, NW], "8 SW": [S, SW], "8 W": [SW, NW],
	// three edges: a straight with a tributary (3, 7) and a fan of three
	// consecutive edges (11)
	"3 N": [N, S, SW], "3 NE": [NE, SW, NW], "3 SE": [N, SE, NW],
	"7 N": [N, SE, S], "7 NW": [NE, SE, NW], "7 S": [N, NE, S],
	"7 SE": [N, SE, NW], "7 SW": [NE, SE, SW],
	"11 N": [N, NE, NW], "11 NE": [N, NE, SE], "11 S": [SE, S, SW], "11 SE": [NE, SE, S],
	// four edges: a crossing (12) and a straight with two tributaries (13)
	"12 E": [NE, SE, SW, NW], "12 N": [N, SE, S, NW],
	"13 N": [N, SE, S, SW], "13 NE": [NE, S, SW, NW],
	"13 S": [N, NE, S, NW], "13 SE": [N, SE, SW, NW],
};

/** Piece name (after "Hex - Coast - Beach ") → the edges its sand lies along. */
export const COAST_PIECES = {
	"(small) N": [N], "(small) NW": [NW], "(small) S": [S], "(small) SW": [SW],
	"(medium) NW": [N, NW], "(medium) SW": [S, SW], "(medium) W": [SW, NW],
	"(big) N": [NW, N, NE], "(big) NW": [SW, NW, N], "(big) S": [SE, S, SW], "(big) SW": [S, SW, NW],
};

/** Piece name (after "Hex - Coast - Ice Floats ") → the edges the shelf lies along. */
export const ICE_PIECES = {
	"(small) N": [N], "(medium) NW": [N, NW], "(big) N": [NW, N, NE],
};

const edgeKey = edges => [...edges].sort().join("");
// Mirror across the vertical axis first (N and S stay put), then rotate
// clockwise; PIXI applies a sprite's scale before its rotation, and a Tile's
// texture scaleX before the tile's rotation, so this is the order the
// transform actually happens in.
const orient = (edges, rotation, mirror) =>
	edges.map(k => ((mirror ? (6 - k) % 6 : k) + rotation) % 6).sort();

/**
 * Build a cover function over one piece table: every orientation of every
 * piece, indexed by the edge set it then serves.
 *
 * `lone` says which pieces may stand alone on a single edge; the river lake
 * piece overflows into the neighbouring hexes, so it is never placed unasked.
 */
function makeCover(pieces, { lone = () => true } = {}) {
	const variants = [];
	const exact = new Map();
	for (const [name, edges] of Object.entries(pieces)) {
		for (const mirror of [false, true]) {
			for (let rotation = 0; rotation < 6; rotation++) {
				const variant = { name, rotation, mirror, edges: orient(edges, rotation, mirror) };
				variants.push(variant);
				const key = edgeKey(variant.edges);
				if (!exact.has(key)) exact.set(key, []);
				exact.get(key).push(variant);
			}
		}
	}
	// Bigger pieces first, then unmirrored, then the artist's own orientation,
	// so the greedy cover reaches for the piece that looks most like one stroke.
	variants.sort((a, b) => (b.edges.length - a.edges.length)
		|| (a.mirror - b.mirror) || (a.rotation - b.rotation));

	/**
	 * @param {number[]} edges  edge indices 0-5
	 * @param {number} [seed]   picks among equally good orientations, for variety
	 * @returns {Array<{name:string, rotation:number, mirror:boolean}>}
	 */
	return function cover(edges, seed = 0) {
		const wanted = [...new Set(edges)].filter(k => k >= 0 && k < 6).sort();
		if (!wanted.length) return [];
		let candidates = exact.get(edgeKey(wanted)) ?? [];
		if (wanted.length === 1) candidates = candidates.filter(lone);
		if (candidates.length) {
			const unmirrored = candidates.filter(v => !v.mirror);
			const pool = unmirrored.length ? unmirrored : candidates;
			return [pool[Math.abs(seed) % pool.length]];
		}
		// No single piece: the fewest pieces whose edges lie inside the set and
		// together cover it. A single-edge piece only wins a round when no bigger
		// piece adds as much, which for rivers never happens (every pair of
		// edges has a piece) and for beaches means two edges that do not touch.
		const inside = variants.filter(v => v.edges.every(k => wanted.includes(k))
			&& (v.edges.length > 1 || lone(v)));
		const picked = [];
		const uncovered = new Set(wanted);
		while (uncovered.size) {
			let best = null;
			let bestGain = 0;
			for (const variant of inside) {
				const gain = variant.edges.filter(k => uncovered.has(k)).length;
				if (gain > bestGain) {
					best = variant;
					bestGain = gain;
				}
			}
			if (!best) break;
			picked.push(best);
			for (const k of best.edges) uncovered.delete(k);
		}
		return picked;
	};
}

/** The river/path pieces that draw a cell whose channel reaches `edges`. */
export const coverEdges = makeCover(ART_PIECES, { lone: v => !v.name.startsWith("10 ") });
/** The beach pieces that line a water cell whose `edges` face land. */
export const coverCoastEdges = makeCover(COAST_PIECES);
/** The same for the ice shelf: one piece per shape, every orientation by turning. */
export const coverIceEdges = makeCover(ICE_PIECES);
const COAST_COVERS = { beach: coverCoastEdges, ice: coverIceEdges };

/**
 * Which of a cell's six edges the neighbour at `to` lies across.
 * Flat-top edges sit at -90°, -30°, 30°, ...; pointy-top edges at -60°, 0°, ...
 * @param {{x:number,y:number}} from  the cell centre
 * @param {{x:number,y:number}} to    the neighbour's centre (or any point across that edge)
 * @param {object} grid               canvas.grid, for `columns`
 * @returns {number} 0-5, clockwise from the top
 */
export function hexEdgeIndex(from, to, grid) {
	const base = grid?.columns === false ? 60 : 90;
	const angle = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
	return ((Math.round((angle + base) / 60) % 6) + 6) % 6;
}

/**
 * Per-cell edge sets of a stored network, derived from its centre-to-centre
 * polylines (the `networkPaths` payload buildMapPathNetwork writes).
 *
 * A point that is not a cell centre — a river mouth carried 0.7 of the way
 * into a water hex — contributes its edge to the land cell only, so the
 * channel runs to the shoreline and the water hex gets nothing.
 *
 * @param {number[][][]} paths  arrays of [x, y] points
 * @param {object} grid         canvas.grid: getOffset, getCenterPoint, size, columns
 * @returns {Array<{i:number, j:number, x:number, y:number, edges:number[]}>}
 */
export function mapNetworkCellEdges(paths, grid) {
	if (!grid?.getOffset || !grid.getCenterPoint) return [];
	const tolerance = (grid.size ?? 100) * 0.1;
	const cells = new Map();
	const cellAt = point => {
		const offset = grid.getOffset({ x: point[0], y: point[1] });
		const centre = grid.getCenterPoint(offset);
		if (Math.hypot(centre.x - point[0], centre.y - point[1]) > tolerance) return null;
		return { offset, centre };
	};
	const add = (cell, k) => {
		if (!cell) return;
		const id = `${cell.offset.i}:${cell.offset.j}`;
		if (!cells.has(id)) {
			cells.set(id, {
				i: cell.offset.i, j: cell.offset.j, x: cell.centre.x, y: cell.centre.y, edges: new Set(),
			});
		}
		cells.get(id).edges.add(k);
	};
	for (const points of paths ?? []) {
		for (let n = 1; n < (points?.length ?? 0); n++) {
			const [from, to] = [points[n - 1], points[n]];
			const k = hexEdgeIndex({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, grid);
			add(cellAt(from), k);
			add(cellAt(to), (k + 3) % 6);
		}
	}
	return [...cells.values()].map(cell => ({ ...cell, edges: [...cell.edges].sort() }));
}

/**
 * Of the `shoreKeys` cells, those with an `acrossKeys` cell over at least one
 * edge, each with those edges. The builder lines water hexes (shore) along the
 * edges that face land (across).
 * @param {Iterable<string>} shoreKeys  hex keys "i_j" of the cells to line
 * @param {Set<string>} acrossKeys      hex keys of the cells on the other side
 * @param {object} grid                 scene.grid: getAdjacentOffsets, getCenterPoint, columns
 * @returns {Array<{i:number, j:number, x:number, y:number, edges:number[]}>}
 */
export function coastCells(shoreKeys, acrossKeys, grid) {
	if (!grid?.getAdjacentOffsets || !grid.getCenterPoint) return [];
	const cells = [];
	for (const key of shoreKeys) {
		const [i, j] = key.split("_").map(Number);
		if (!Number.isInteger(i) || !Number.isInteger(j)) continue;
		const centre = grid.getCenterPoint({ i, j });
		const edges = new Set();
		for (const neighbour of grid.getAdjacentOffsets({ i, j })) {
			if (!acrossKeys.has(`${neighbour.i}_${neighbour.j}`)) continue;
			edges.add(hexEdgeIndex(centre, grid.getCenterPoint(neighbour), grid));
		}
		if (edges.size) cells.push({ i, j, x: centre.x, y: centre.y, edges: [...edges].sort() });
	}
	return cells;
}

/**
 * Where to put which piece, at what size and turn, to draw the cells.
 * PIXI-free: the caller makes the sprites or tiles.
 * @returns {Array<{x:number, y:number, src:string, rotation:number, mirror:boolean, width:number, height:number}>}
 *   rotation in radians; mirror flips the image horizontally before turning it
 */
function artPlacements(cells, grid, { dir, file, cover }) {
	const scale = (grid?.size ?? 100) / ART_IMAGE.hexHeight;
	// Pointy-top hexes are the flat-top art turned 30°.
	const baseTurn = grid?.columns === false ? 30 : 0;
	const placements = [];
	for (const cell of cells) {
		const seed = Math.abs((cell.i * 31) + (cell.j * 17));
		for (const piece of cover(cell.edges, seed)) {
			placements.push({
				i: cell.i, j: cell.j, x: cell.x, y: cell.y,
				src: `${dir}/${file} ${piece.name}.webp`,
				rotation: (baseTurn + (piece.rotation * 60)) * Math.PI / 180,
				mirror: piece.mirror,
				width: ART_IMAGE.width * scale,
				height: ART_IMAGE.height * scale,
			});
		}
	}
	return placements;
}

/**
 * Placements that draw a stored road or river network in the hand-drawn pieces.
 * @param {number[][][]} paths
 * @param {object} grid
 * @param {"river"|"road"} kind
 */
export function mapNetworkArtPlacements(paths, grid, kind) {
	return artPlacements(mapNetworkCellEdges(paths, grid), grid, {
		dir: ART_DIR, file: ART_FILE[kind] ?? ART_FILE.road, cover: coverEdges,
	});
}

/**
 * Placements that line the given shore cells (from coastCells) with beaches,
 * or with the ice shelf for arctic water.
 * @param {Array<{i:number, j:number, x:number, y:number, edges:number[]}>} cells
 * @param {object} grid
 * @param {"beach"|"ice"} [style]
 */
export function coastArtPlacements(cells, grid, style = "beach") {
	const { dir, file } = COAST_STYLES[style] ?? COAST_STYLES.beach;
	return artPlacements(cells, grid, { dir, file, cover: COAST_COVERS[style] ?? coverCoastEdges });
}
