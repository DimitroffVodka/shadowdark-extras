// Trace the exact outline of a walled room from the wall segments themselves.
//
// The reskin's floor was quantised to grid cells: a cell was painted when its
// CENTRE was inside the room, so along any wall that is not axis-aligned the
// floor spilled up to half a cell past the wall in places and left the cell
// short in others. The wall art followed the true geometry; the floor did not,
// and the two disagreed visibly.
//
// Sampling harder does not fix it. Measured against a real 829-wall map, a 50px
// sub-cell fill LEAKED out of a room the 100px fill held — finer sampling
// squeezes through gaps that coarser sampling steps over. So the resolution is
// not the thing to increase; the raster is the thing to stop using.
//
// The room outline is already present exactly, as the walls. This walks the
// planar subdivision those segments form and returns the face containing a given
// point. That is the room, to the pixel, at any angle.

/**
 * Build the planar graph of wall endpoints.
 *
 * Endpoints are snapped, but only just: on a real map 1009 of 1658 endpoints
 * coincide EXACTLY, so the tolerance exists for the handful that miss by a
 * rounding error, not to paper over real gaps. A gap wide enough to matter
 * should fail the trace, not be silently stitched shut.
 */
/**
 * Split walls at points where another wall's endpoint touches their interior.
 *
 * A divider drawn onto an existing long wall meets it mid-span: the two touch
 * geometrically but share no endpoint, so the graph sees a dangling stub instead
 * of a junction and the two rooms either side trace as one merged face. Adding
 * the node is what makes a T-junction behave like one.
 */
function splitAtTouchingEndpoints(walls, tolerance) {
	const points = [];
	for (const wall of walls) {
		points.push({ x: wall.c[0], y: wall.c[1] }, { x: wall.c[2], y: wall.c[3] });
	}

	const out = [];
	for (const wall of walls) {
		const [x1, y1, x2, y2] = wall.c;
		const dx = x2 - x1;
		const dy = y2 - y1;
		const lengthSq = (dx * dx) + (dy * dy);
		if (lengthSq === 0) continue;

		// Parameters along the segment where some other endpoint lands on it.
		const cuts = [];
		for (const point of points) {
			const t = (((point.x - x1) * dx) + ((point.y - y1) * dy)) / lengthSq;
			if (t <= 0 || t >= 1) continue;
			const px = x1 + (t * dx);
			const py = y1 + (t * dy);
			if (Math.hypot(point.x - px, point.y - py) > tolerance) continue;
			cuts.push(t);
		}

		if (cuts.length === 0) {
			out.push(wall);
			continue;
		}

		cuts.sort((a, b) => a - b);
		let prev = 0;
		for (const t of [...cuts, 1]) {
			if (t - prev < 1e-6) continue;
			out.push({
				...wall,
				c: [
					x1 + (prev * dx), y1 + (prev * dy),
					x1 + (t * dx), y1 + (t * dy),
				],
			});
			prev = t;
		}
	}
	return out;
}

function buildGraph(inputWalls, tolerance) {
	const walls = splitAtTouchingEndpoints(inputWalls, tolerance);

	// Endpoints merge by PROXIMITY, not by rounding into shared bins. Binning
	// looks equivalent and is not: two endpoints 2.8px apart can straddle a bin
	// boundary at any bin size, so they stay separate however far the tolerance
	// is raised. A real map had exactly that — a cave whose outline missed
	// closing by 2.8px, leaving it with no traced face and therefore no floor.
	const buckets = new Map();
	const nodes = new Map();
	const bucketKey = (x, y) => `${Math.floor(x / tolerance)},${Math.floor(y / tolerance)}`;

	const nodeAt = (x, y) => {
		// Scan the neighbouring buckets too, which is what makes straddling safe.
		const bx = Math.floor(x / tolerance);
		const by = Math.floor(y / tolerance);
		let best = null;
		let bestDistance = tolerance;
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				for (const node of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
					const distance = Math.hypot(node.x - x, node.y - y);
					if (distance <= bestDistance) {
						best = node;
						bestDistance = distance;
					}
				}
			}
		}
		if (best) return best;

		const node = { x, y, edges: [] };
		nodes.set(`${x},${y}`, node);
		const key = bucketKey(x, y);
		if (!buckets.has(key)) buckets.set(key, []);
		buckets.get(key).push(node);
		return node;
	};

	for (const wall of walls) {
		const [x1, y1, x2, y2] = wall.c;
		if (Math.hypot(x2 - x1, y2 - y1) < 1) continue;
		const a = nodeAt(x1, y1);
		const b = nodeAt(x2, y2);
		if (a === b) continue;
		a.edges.push({ to: b, angle: Math.atan2(b.y - a.y, b.x - a.x) });
		b.edges.push({ to: a, angle: Math.atan2(a.y - b.y, a.x - b.x) });
	}

	for (const node of nodes.values()) node.edges.sort((p, q) => p.angle - q.angle);
	return nodes;
}

/**
 * Close gaps between loose wall ends, for tracing purposes only.
 *
 * Real maps are not drawn to a tolerance. A wall chain that stops a little short
 * of the next one leaves two loose ends, and a face walk escapes through that
 * gap into the region outside — so the room does not merely trace imprecisely,
 * it traces as part of the outdoors and gets no floor at all.
 *
 * A loose end is exactly the signature of that. Pairing nearby ones closes the
 * outline. This adds NO Wall document and changes nothing about the map or its
 * collision: it decides where floor is painted, and the caller's area check
 * still has to accept the result.
 *
 * @returns {number} how many gaps were bridged
 */
function bridgeLooseEnds(nodes, maxDistance) {
	const loose = [...nodes.values()].filter(node => node.edges.length === 1);
	const used = new Set();
	let bridged = 0;

	for (const a of loose) {
		if (used.has(a)) continue;
		let best = null;
		let bestDistance = maxDistance;
		for (const b of loose) {
			if (b === a || used.has(b)) continue;
			const distance = Math.hypot(a.x - b.x, a.y - b.y);
			if (distance <= bestDistance) {
				best = b;
				bestDistance = distance;
			}
		}
		if (!best) continue;

		used.add(a);
		used.add(best);
		a.edges.push({ to: best, angle: Math.atan2(best.y - a.y, best.x - a.x) });
		best.edges.push({ to: a, angle: Math.atan2(a.y - best.y, a.x - best.x) });
		bridged += 1;
	}

	if (bridged > 0) {
		for (const node of nodes.values()) node.edges.sort((p, q) => p.angle - q.angle);
	}
	return bridged;
}

/**
 * The next edge clockwise from a given direction, which is what walks a face.
 */
function nextClockwise(node, fromAngle) {
	const { edges } = node;
	let best = null;
	for (const edge of edges) {
		if (edge.angle < fromAngle && (best === null || edge.angle > best.angle)) best = edge;
	}
	// Nothing smaller — wrap to the largest, which is the same step modulo 2π.
	if (best === null) {
		for (const edge of edges) if (best === null || edge.angle > best.angle) best = edge;
	}
	return best;
}

/** Shoelace area, unsigned. */
export function polygonArea(points) {
	let sum = 0;
	for (let i = 0; i < points.length; i++) {
		const a = points[i];
		const b = points[(i + 1) % points.length];
		sum += (a.x * b.y) - (b.x * a.y);
	}
	return Math.abs(sum) / 2;
}

/** Ray-cast point-in-polygon. */
export function pointInPolygon(point, points) {
	let inside = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const a = points[i];
		const b = points[j];
		const straddles = (a.y > point.y) !== (b.y > point.y);
		if (!straddles) continue;
		const x = ((b.x - a.x) * (point.y - a.y) / (b.y - a.y)) + a.x;
		if (point.x < x) inside = !inside;
	}
	return inside;
}

/**
 * Every face of the subdivision the walls form.
 *
 * Each DIRECTED edge belongs to exactly one face, so walking every unvisited
 * directed edge enumerates them all. Dangling walls — 9 of 649 nodes on the map
 * this was built against — are traversed out and back, which contributes a
 * zero-area sliver to the face rather than breaking the walk.
 *
 * @param {Array<{c: number[]}>} walls
 * @param {number} [tolerance]
 * @returns {Array<Array<{x: number, y: number}>>}
 */
export function traceWallFaces(walls, tolerance = 4, bridgeDistance = 0) {
	const nodes = buildGraph(walls, tolerance);
	if (bridgeDistance > 0) bridgeLooseEnds(nodes, bridgeDistance);
	const visited = new Set();
	const faces = [];
	const idOf = node => `${node.x},${node.y}`;

	for (const start of nodes.values()) {
		for (const firstEdge of start.edges) {
			const firstKey = `${idOf(start)}->${idOf(firstEdge.to)}`;
			if (visited.has(firstKey)) continue;

			const points = [];
			let from = start;
			let edge = firstEdge;

			// Bounded by the directed-edge count: every step consumes one.
			for (let guard = 0; guard <= nodes.size * 8; guard++) {
				const key = `${idOf(from)}->${idOf(edge.to)}`;
				if (visited.has(key)) break;
				visited.add(key);
				points.push({ x: from.x, y: from.y });

				const to = edge.to;
				const back = Math.atan2(from.y - to.y, from.x - to.x);
				const next = nextClockwise(to, back);
				if (!next) break;
				from = to;
				edge = next;
				if (from === start && edge === firstEdge) break;
			}

			if (points.length >= 3) faces.push(points);
		}
	}

	return faces;
}

/**
 * Clip a polygon to an axis-aligned rectangle (Sutherland–Hodgman).
 *
 * This is what turns "the room you clicked" into "the part of it under your
 * brush". A corridor network with no internal doors is a SINGLE face, so
 * filling the face fills every corridor at once; clipping to a dragged
 * rectangle keeps the wall-exact edges where the walls are and cuts straight
 * where the drag ended.
 *
 * Sutherland–Hodgman is exact for a convex clip window, which a rectangle is.
 * Its known weakness is a concave subject whose intersection comes out in
 * disconnected pieces — those get joined by a seam along the clip edge. The
 * caller is expected to area-check the result rather than trust it blindly.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} rect
 * @returns {Array<{x: number, y: number}>} possibly empty
 */
export function clipPolygonToRect(points, rect) {
	const lerp = (a, b, t) => ({ x: a.x + ((b.x - a.x) * t), y: a.y + ((b.y - a.y) * t) });

	const clip = (polygon, inside, cross) => {
		const out = [];
		for (let i = 0; i < polygon.length; i++) {
			const current = polygon[i];
			const previous = polygon[(i + polygon.length - 1) % polygon.length];
			const currentIn = inside(current);
			const previousIn = inside(previous);
			if (currentIn) {
				if (!previousIn) out.push(cross(previous, current));
				out.push(current);
			}
			else if (previousIn) {
				out.push(cross(previous, current));
			}
		}
		return out;
	};

	const atX = edge => (a, b) => lerp(a, b, (edge - a.x) / (b.x - a.x));
	const atY = edge => (a, b) => lerp(a, b, (edge - a.y) / (b.y - a.y));

	let polygon = points;
	polygon = clip(polygon, p => p.x >= rect.minX, atX(rect.minX));
	polygon = clip(polygon, p => p.x <= rect.maxX, atX(rect.maxX));
	polygon = clip(polygon, p => p.y >= rect.minY, atY(rect.minY));
	polygon = clip(polygon, p => p.y <= rect.maxY, atY(rect.maxY));
	return polygon;
}

/**
 * Cut a rectangle out of a polygon, returning what is left.
 *
 * Erasing used to delete whole floor shapes that the box touched. That is fine
 * when a shape is one room and catastrophic when it is not: a corridor network
 * with no internal doors traces as ONE polygon, so a 3x3 box anywhere in it
 * deleted the floor of the entire map.
 *
 * The subtraction is four clips rather than a general polygon boolean. A
 * rectangle's complement is four half-open bands — left of it, right of it, and
 * above and below within its columns — and those exactly tile the plane minus
 * the rectangle without overlapping. Each band is convex, which is the one case
 * Sutherland–Hodgman is exact for, so this needs no clipping library and cannot
 * produce the self-intersections a general boolean would.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} rect
 * @returns {Array<Array<{x: number, y: number}>>} 0-4 pieces
 */
export function subtractRectFromPolygon(points, rect) {
	// Far outside any scene, so the open sides of each band are effectively
	// unbounded without introducing Infinity into the arithmetic.
	const FAR = 1e7;
	const bands = [
		{ minX: -FAR, maxX: rect.minX, minY: -FAR, maxY: FAR },
		{ minX: rect.maxX, maxX: FAR, minY: -FAR, maxY: FAR },
		{ minX: rect.minX, maxX: rect.maxX, minY: -FAR, maxY: rect.minY },
		{ minX: rect.minX, maxX: rect.maxX, minY: rect.maxY, maxY: FAR },
	];

	return bands
		.map(band => clipPolygonToRect(points, band))
		// A band the polygon merely grazes yields a degenerate sliver, which is
		// not floor and would render as nothing.
		.filter(piece => piece.length >= 3 && polygonArea(piece) > 1);
}

/** How many of these points no face covers. */
function countUncovered(faces, points) {
	let count = 0;
	for (const point of points) {
		if (!faces.some(face => pointInPolygon(point, face.points))) count += 1;
	}
	return count;
}

/**
 * The exact room outlines covering a flood-filled region.
 *
 * One polygon per ROOM, not one for the region. A door is passable to the flood
 * fill but is part of the boundary to a face trace, so a fill that spans a whole
 * connected dungeon resolves into the several rooms that make it up. That is the
 * right shape for a floor anyway.
 *
 * Faces are selected by the fill rather than by winding order: for each filled
 * cell, the SMALLEST face containing its centre is the room that cell is in.
 * That picks rooms out of nested faces and excludes the outer face for free,
 * where a signed-area rule does not — measured on a real map, winding split
 * 60/39 across interior faces and put the outer face on the same side as 38
 * genuine rooms.
 *
 * @param {Array<{c: number[]}>} walls - the scene's walls, doors included
 * @param {Array<{x: number, y: number}>} cellCentres - flood-filled cell centres
 * @param {object} [options]
 * @param {number} [options.tolerance] - endpoint merge distance, in pixels.
 *        4px by default: a real map's cave outline missed closing by 2.8px, and
 *        at 1px it traced no face at all, so 141 cells got no floor. Well under
 *        a grid cell, so it cannot close a real doorway.
 * @param {number} [options.expectedArea] - the fill's own area; the result is
 *        rejected if the traced rooms disagree with it
 * @param {number} [options.areaTolerance] - allowed fractional disagreement in
 *        EITHER direction. The two measures disagree for opposite reasons that
 *        partly cancel: the fill counts whole cells whose centres are inside,
 *        overstating rooms, and misses cells whose centres fall outside though
 *        part of the cell is in, understating them. On a real map the net was
 *        +5.6%.
 * @returns {{rooms: Array<...>, area: number, drift: number,
 *           unmatched: Array<{x,y}>, rejected: boolean}|null}
 *          null only when NOTHING traced. A result that disagrees with the fill
 *          comes back with rejected:true and its figures, so the caller can say
 *          which stage disagreed instead of reporting a bare failure.
 *          `unmatched` lists centres no face covered — the caller must floor
 *          those some other way rather than leave them bare.
 */
export function traceRoomFaces(walls, cellCentres, options = {}) {
	const {
		tolerance = 4,
		bridgeDistance = 0,
		expectedArea = null,
		areaTolerance = 0.25,
	} = options;

	// Try the walls exactly as drawn first. Bridging is a repair, so it only runs
	// when the honest attempt leaves cells with no room — that way a well-drawn
	// map is never second-guessed, and a broken one still gets a floor.
	let faces = traceWallFaces(walls, tolerance)
		.map(points => ({ points, area: polygonArea(points) }))
		.filter(face => face.area > 0);
	if (faces.length === 0 && bridgeDistance <= 0) return null;

	let bridged = false;
	if (bridgeDistance > 0 && countUncovered(faces, cellCentres) > 0) {
		const repaired = traceWallFaces(walls, tolerance, bridgeDistance)
			.map(points => ({ points, area: polygonArea(points) }))
			.filter(face => face.area > 0);
		if (countUncovered(repaired, cellCentres) < countUncovered(faces, cellCentres)) {
			faces = repaired;
			bridged = true;
		}
	}
	if (faces.length === 0) return null;

	const chosen = new Set();
	const unmatched = [];
	for (const point of cellCentres) {
		let best = -1;
		for (let i = 0; i < faces.length; i++) {
			if (!pointInPolygon(point, faces[i].points)) continue;
			if (best === -1 || faces[i].area < faces[best].area) best = i;
		}
		if (best === -1) unmatched.push(point);
		else chosen.add(best);
	}

	const rooms = [...chosen].map(i => faces[i]);
	if (rooms.length === 0) return null;

	const area = rooms.reduce((total, room) => total + room.area, 0);

	// A face trace over a malformed wall graph fails silently and plausibly — it
	// returns SOME polygon. The fill established the region's size by a wholly
	// independent route, so disagreement means the trace is not describing the
	// region the user clicked in.
	// A failed area check returns the numbers rather than null. "No floor" with
	// no figures is undiagnosable — it cannot be told apart from "traced
	// nothing", and the two have completely different causes.
	let drift = 0;
	let rejected = false;
	if (expectedArea !== null && expectedArea > 0) {
		drift = (area - expectedArea) / expectedArea;
		rejected = Math.abs(drift) > areaTolerance;
	}

	return { rooms, area, drift, unmatched, bridged, rejected, expectedArea };
}

/**
 * Wall ends that connect to nothing.
 *
 * These are where a wall chain stops without meeting another — the places a
 * fill escapes through. Telling someone "close the wall gaps" without saying
 * where is useless advice, so the caller can put a marker on each of these.
 *
 * Uses the same proximity merging as the tracer, so ends that already meet
 * within the tolerance are not reported.
 *
 * @param {Array<{c: number[]}>} walls
 * @param {number} [tolerance]
 * @returns {Array<{x: number, y: number}>}
 */
export function findLooseWallEnds(walls, tolerance = 4) {
	const nodes = buildGraph(walls, tolerance);
	const loose = [];
	for (const node of nodes.values()) {
		if (node.edges.length === 1) loose.push({ x: node.x, y: node.y });
	}
	return loose;
}
