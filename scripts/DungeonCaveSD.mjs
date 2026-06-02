// DungeonCaveSD.mjs
//
// Organic "cave" generation style for the dungeon generator, plus the curved-
// wall geometry pipeline. Produces the SAME layout shape as
// DungeonGeneratorSD.generateLayout() so the existing pipeline (floor tiles,
// stairs, clutter, the hex room-for-room narrative bridge) keeps working.
//
// Curves: Foundry walls are straight segments, so "curved" = trace the floor
// region's cell boundary into closed loops, smooth them with Chaikin corner-
// cutting, simplify, then tessellate into many short wall segments + matching
// rotated textured wall art (the df-curvy-walls approach).
//
// NOTE: the cave shape uses a self-contained cellular-automata generator rather
// than vendoring rot.js — same algorithm, no extra dependency.

const MODULE_ID = "shadowdark-extras";
const GRID_SIZE = 100;

// ═══════════════════════════════════════════════════════
//  CELLULAR-AUTOMATA CAVE
// ═══════════════════════════════════════════════════════

/**
 * Generate a connected organic cave as a Set of "gx,gy" floor-cell keys.
 * @param {object} params
 * @param {number} params.roomCount  - target number of chambers (drives size)
 * @param {number} params.density    - 0..1, higher = more open floor
 * @param {function} rng             - seeded RNG returning [0,1)
 */
export function generateCaveLayout(params, rng) {
    const roomCount = Math.min(Math.max(params.roomCount ?? 8, 3), 30);
    const density = Math.min(Math.max(params.density ?? 0.8, 0.3), 1);

    // Grid size scales with requested chamber count.
    const side = Math.round(Math.min(64, Math.max(22, 16 + roomCount * 2.2)));

    // Cellular-automata floor blob, largest connected region.
    const floors = caCells(side, side, density, rng);

    // Synthesize chambers (pseudo-rooms) for stairs/clutter/narrative.
    const chambers = pickChambers(floors, roomCount, side, side, rng);
    const placedRooms = chambers.map(c => makePseudoRoom(c.x, c.y));
    const roomData = placedRooms.map((room, i) => ({ room, isStart: i === 0 }));
    const adjacency = chainAdjacency(chambers.length);

    return {
        floors,
        corridors: new Set(),
        placedRooms,
        doorPositions: [],
        entranceEdges: [],
        roomData,
        adjacency,
        _isCave: true,
    };
}

/**
 * Cellular-automata cave fill in a W×H grid; returns the largest connected
 * floor region as a Set of local "x,y" keys (x in [0,W), y in [0,H)).
 */
export function caCells(W, H, density, rng) {
    const d = Math.min(Math.max(density ?? 0.8, 0.3), 1);
    const wallProb = 0.52 - d * 0.12; // higher density -> fewer walls -> more open
    let grid = [];
    for (let y = 0; y < H; y++) {
        const row = [];
        for (let x = 0; x < W; x++) {
            if (x === 0 || y === 0 || x === W - 1 || y === H - 1) row.push(0); // border wall
            else row.push(rng() < wallProb ? 0 : 1);
        }
        grid.push(row);
    }
    const countFloor = (g, x, y) => {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                if (g[ny][nx] === 1) n++;
            }
        }
        return n;
    };
    for (let pass = 0; pass < 4; pass++) {
        const next = grid.map(r => r.slice());
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                next[y][x] = countFloor(grid, x, y) >= 5 ? 1 : 0;
            }
        }
        grid = next;
    }
    return largestRegion(grid, W, H);
}

/** Flood-fill; return the largest 4-connected floor region as a Set("gx,gy"). */
function largestRegion(grid, W, H) {
    const seen = new Set();
    let best = new Set();
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (grid[y][x] !== 1) continue;
            const key0 = `${x},${y}`;
            if (seen.has(key0)) continue;
            // BFS this region
            const region = new Set();
            const queue = [[x, y]];
            seen.add(key0);
            while (queue.length) {
                const [cx, cy] = queue.pop();
                region.add(`${cx},${cy}`);
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = cx + dx, ny = cy + dy;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    if (grid[ny][nx] !== 1) continue;
                    const k = `${nx},${ny}`;
                    if (seen.has(k)) continue;
                    seen.add(k);
                    queue.push([nx, ny]);
                }
            }
            if (region.size > best.size) best = region;
        }
    }
    return best;
}

/**
 * Pick up to `count` well-separated chamber anchors: cells far from any wall
 * (local maxima of the distance-to-wall transform), greedily spaced apart.
 */
function pickChambers(floors, count, W, H, rng) {
    if (floors.size === 0) return [];
    // Distance-to-nearest-non-floor via multi-source BFS from boundary cells.
    const dist = new Map();
    const queue = [];
    for (const key of floors) {
        const [x, y] = key.split(",").map(Number);
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !floors.has(`${x + dx},${y + dy}`));
        if (edge) { dist.set(key, 1); queue.push(key); }
    }
    let head = 0;
    while (head < queue.length) {
        const key = queue[head++];
        const [x, y] = key.split(",").map(Number);
        const d = dist.get(key);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nk = `${x + dx},${y + dy}`;
            if (floors.has(nk) && !dist.has(nk)) { dist.set(nk, d + 1); queue.push(nk); }
        }
    }
    // Candidates sorted by openness (distance), with slight jitter for variety.
    const cand = [...floors].map(key => {
        const [x, y] = key.split(",").map(Number);
        return { x, y, d: dist.get(key) ?? 1 };
    }).sort((a, b) => (b.d - a.d) || (rng() - 0.5));

    const chosen = [];
    const minSep = Math.max(3, Math.round(W / Math.max(2, Math.sqrt(count))) * 0.6);
    for (const c of cand) {
        if (chosen.length >= count) break;
        if (chosen.every(o => Math.hypot(o.x - c.x, o.y - c.y) >= minSep)) chosen.push(c);
    }
    // Fallback: if separation was too strict, top up from densest candidates.
    if (chosen.length === 0 && cand.length) chosen.push(cand[0]);
    return chosen;
}

/** A minimal ProcgenRoom-like anchor (cx/cy are what downstream reads). */
function makePseudoRoom(cx, cy) {
    return { x: cx, y: cy, w: 1, h: 1, cx, cy, left: cx, right: cx + 1, top: cy, bottom: cy + 1 };
}

/** Linear adjacency 0-1-2-...-N (Map<idx, Set<idx>>). */
function chainAdjacency(n) {
    const adj = new Map();
    for (let i = 0; i < n; i++) adj.set(i, new Set());
    for (let i = 0; i < n - 1; i++) { adj.get(i).add(i + 1); adj.get(i + 1).add(i); }
    return adj;
}

// ═══════════════════════════════════════════════════════
//  BOUNDARY TRACING → SMOOTHING → SIMPLIFY
// ═══════════════════════════════════════════════════════

/**
 * Trace the floor region boundary into closed loops of grid-corner points.
 * Each boundary edge is directed so the floor is on its right; shared corners
 * are stitched into closed loops (outer boundary + any interior holes).
 * @returns {Array<Array<{x:number,y:number}>>} loops in CORNER (grid) coords
 */
export function traceBoundaryLoops(cells, isFloor = (k) => cells.has(k), isCave = () => true) {
    // A boundary edge exists where the neighbour is NOT floor (void). `isFloor`
    // lets callers test against a larger merged set (e.g. mixed room+cave maps)
    // so the seam between a cave and an adjacent room is left open, not walled.
    // `isCave(sourceCell)` tags each edge so callers can smooth cave-bordering
    // segments while leaving room-bordering segments sharp.
    const edges = []; // { a:{x,y}, b:{x,y}, cave:bool }
    for (const key of cells) {
        const [gx, gy] = key.split(",").map(Number);
        const c = isCave(key);
        if (!isFloor(`${gx},${gy - 1}`)) edges.push({ a: { x: gx, y: gy }, b: { x: gx + 1, y: gy }, cave: c });       // N: +x
        if (!isFloor(`${gx + 1},${gy}`)) edges.push({ a: { x: gx + 1, y: gy }, b: { x: gx + 1, y: gy + 1 }, cave: c }); // E: +y
        if (!isFloor(`${gx},${gy + 1}`)) edges.push({ a: { x: gx + 1, y: gy + 1 }, b: { x: gx, y: gy + 1 }, cave: c }); // S: -x
        if (!isFloor(`${gx - 1},${gy}`)) edges.push({ a: { x: gx, y: gy + 1 }, b: { x: gx, y: gy }, cave: c });         // W: -y
    }

    // Multimap start-corner -> edge indices, plus per-corner in-degree.
    const byStart = new Map();
    const inDeg = new Map();
    edges.forEach((e, i) => {
        const ka = `${e.a.x},${e.a.y}`, kb = `${e.b.x},${e.b.y}`;
        if (!byStart.has(ka)) byStart.set(ka, []);
        byStart.get(ka).push(i);
        inDeg.set(kb, (inDeg.get(kb) || 0) + 1);
    });

    const used = new Array(edges.length).fill(false);
    const result = []; // { points, closed }

    const dirOf = (e) => ({ x: e.b.x - e.a.x, y: e.b.y - e.a.y });

    // At a junction, follow the boundary by turning as far clockwise (right) as
    // possible — keeps the floor (which is on each edge's right) consistently on
    // the right, so the walk never crosses a pinch or doubles back onto the
    // opposite wall. Reverse edges (going straight back) are excluded.
    const pickNext = (cand, vi) => {
        let best = -1, bestAng = -Infinity;
        for (const idx of cand) {
            if (used[idx]) continue;
            const vo = dirOf(edges[idx]);
            const cross = vi.x * vo.y - vi.y * vo.x;
            const dot = vi.x * vo.x + vi.y * vo.y;
            const ang = Math.atan2(cross, dot); // (-pi, pi]; +pi == reverse
            if (Math.abs(Math.abs(ang) - Math.PI) < 1e-6) continue; // skip backtrack
            if (ang > bestAng) { bestAng = ang; best = idx; }
        }
        return best === -1 ? undefined : best;
    };

    // Walk a boundary chain from startIdx; returns { pts, closed }.
    const walk = (startIdx) => {
        const startCorner = `${edges[startIdx].a.x},${edges[startIdx].a.y}`;
        const pts = [];
        let curr = startIdx, guard = 0, closed = false;
        while (curr !== undefined && !used[curr] && guard++ < edges.length + 5) {
            used[curr] = true;
            const e = edges[curr];
            pts.push({ x: e.a.x, y: e.a.y, cave: e.cave }); // cave = region of this vertex's outgoing edge
            const bKey = `${e.b.x},${e.b.y}`;
            if (bKey === startCorner) { closed = true; break; } // returned to start
            const next = pickNext(byStart.get(bKey) || [], dirOf(e));
            if (next === undefined) { pts.push({ x: e.b.x, y: e.b.y, cave: e.cave }); break; } // open arc end
            curr = next;
        }
        return { pts, closed };
    };

    // 1. Open arcs first: start where the boundary resumes after an opening
    //    (a chain-start corner has more outgoing than incoming boundary edges).
    for (const [corner, outEdges] of byStart) {
        if (outEdges.length > (inDeg.get(corner) || 0)) {
            for (const idx of outEdges) {
                if (used[idx]) continue;
                const { pts } = walk(idx);
                if (pts.length >= 2) result.push({ points: pts, closed: false });
            }
        }
    }

    // 2. Remaining edges form fully-closed loops (outer boundary, interior pillars).
    for (let i = 0; i < edges.length; i++) {
        if (used[i]) continue;
        const { pts, closed } = walk(i);
        if (pts.length >= (closed ? 3 : 2)) result.push({ points: pts, closed });
    }

    return result;
}

/** Chaikin corner-cutting on a CLOSED loop. iters passes. */
export function chaikinClosed(points, iters = 2) {
    let pts = points;
    for (let it = 0; it < iters; it++) {
        const out = [];
        const n = pts.length;
        for (let i = 0; i < n; i++) {
            const p = pts[i];
            const q = pts[(i + 1) % n];
            out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
            out.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
        }
        pts = out;
    }
    return pts;
}

/** Chaikin corner-cutting on an OPEN polyline (endpoints preserved). */
export function chaikinOpen(points, iters = 2) {
    let pts = points;
    for (let it = 0; it < iters; it++) {
        if (pts.length < 3) break;
        const out = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
            const p = pts[i], q = pts[i + 1];
            out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
            out.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
        }
        out.push(pts[pts.length - 1]);
        pts = out;
    }
    return pts;
}

/** Douglas-Peucker on an OPEN polyline (non-degenerate endpoints). */
function dpOpen(pts, tol) {
    const n = pts.length;
    if (n < 3) return pts.slice();
    const keep = new Array(n).fill(false);
    keep[0] = keep[n - 1] = true;
    const stack = [[0, n - 1]];
    while (stack.length) {
        const [s, e] = stack.pop();
        let maxD = 0, idx = -1;
        const ax = pts[s].x, ay = pts[s].y, bx = pts[e].x, by = pts[e].y;
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        for (let i = s + 1; i < e; i++) {
            const d = Math.abs((pts[i].x - ax) * dy - (pts[i].y - ay) * dx) / len;
            if (d > maxD) { maxD = d; idx = i; }
        }
        if (maxD > tol && idx !== -1) { keep[idx] = true; stack.push([s, idx], [idx, e]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
    return out;
}

/**
 * Douglas-Peucker simplify on a CLOSED loop. Splits the loop at the point
 * farthest from the first vertex so each arc has a real (non-degenerate)
 * baseline, simplifies both arcs, then recombines.
 */
export function simplifyClosed(points, tol) {
    const n = points.length;
    if (n < 8) return points; // small loops (pillars): leave as-is

    let far = 1, fd = -1;
    for (let i = 1; i < n; i++) {
        const d = Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y);
        if (d > fd) { fd = d; far = i; }
    }
    const arc1 = points.slice(0, far + 1);                 // [0 .. far]
    const arc2 = points.slice(far).concat([points[0]]);    // [far .. n-1, 0]
    const s1 = dpOpen(arc1, tol);
    const s2 = dpOpen(arc2, tol);
    // s1 ends at `far` (== s2[0]); s2 ends at points[0] (== s1[0]). Drop both dups.
    return s1.concat(s2.slice(1, -1));
}

/**
 * One selective Chaikin pass on a CLOSED loop of {x,y,cave} vertices: a corner
 * is rounded only when BOTH its incident edges border cave cells. Room corners
 * and cave↔room transitions stay sharp (crisp rooms, curved caves). Each
 * vertex's `cave` flag is the region of its OUTGOING edge.
 */
function selectiveCavePass(pts) {
    const n = pts.length;
    const out = [];
    for (let i = 0; i < n; i++) {
        const v = pts[i];
        const prev = pts[(i - 1 + n) % n];
        const inCave = prev.cave;  // region of the edge entering v (starts at prev)
        const outCave = v.cave;    // region of the edge leaving v
        if (inCave && outCave) {
            const next = pts[(i + 1) % n];
            out.push({ x: 0.75 * v.x + 0.25 * prev.x, y: 0.75 * v.y + 0.25 * prev.y, cave: true });
            out.push({ x: 0.75 * v.x + 0.25 * next.x, y: 0.75 * v.y + 0.25 * next.y, cave: outCave });
        } else {
            out.push({ x: v.x, y: v.y, cave: outCave }); // keep sharp
        }
    }
    return out;
}

/**
 * Unified wall boundary for MIXED room+cave maps: trace the whole merged floor
 * region as one set of closed loops, smooth only the cave-bordering segments,
 * and simplify. One boundary => no two-system seam, no parallel double walls.
 * @returns {Array<{points:Array<{x,y}>, closed:boolean}>} pixel-space loops
 */
export function buildMixedLoops(merged, caveCells, offset, gridSize = GRID_SIZE, { chaikin = 3, simplify = 0.1 } = {}) {
    const traced = traceBoundaryLoops(merged, (k) => merged.has(k), (k) => caveCells.has(k));
    const tol = gridSize * simplify;
    const result = [];
    for (const { points } of traced) { // merged boundary loops are all closed
        let px = points.map(p => ({ x: (p.x + offset.x) * gridSize, y: (p.y + offset.y) * gridSize, cave: p.cave }));
        for (let it = 0; it < chaikin; it++) px = selectiveCavePass(px);
        let plain = simplifyClosed(px.map(p => ({ x: p.x, y: p.y })), tol);
        if (plain.length >= 3) result.push({ points: plain, closed: true });
    }
    return result;
}

/**
 * Full curve pipeline: floor cells -> smoothed simplified pixel-space loops.
 * @returns {Array<Array<{x,y}>>} closed loops in PIXEL coords
 */
export function buildCaveLoops(floors, offset, gridSize = GRID_SIZE, { chaikin = 3, simplify = 0.1, isFloor } = {}) {
    const traced = traceBoundaryLoops(floors, isFloor); // [{ points, closed }]
    const toPx = (p) => ({ x: (p.x + offset.x) * gridSize, y: (p.y + offset.y) * gridSize });
    const tol = gridSize * simplify;
    const result = [];
    for (const { points, closed } of traced) {
        let px = points.map(toPx);
        if (closed) {
            px = chaikinClosed(px, chaikin);
            px = simplifyClosed(px, tol);
            if (px.length >= 3) result.push({ points: px, closed: true });
        } else {
            px = chaikinOpen(px, chaikin);
            px = dpOpen(px, tol);
            if (px.length >= 2) result.push({ points: px, closed: false });
        }
    }
    return result;
}

// ═══════════════════════════════════════════════════════
//  CURVED WALL + VISUAL BUILDERS
// ═══════════════════════════════════════════════════════

/** Collision walls: one Wall segment per smoothed boundary edge. */
export function generateCurvedWalls(loops, wallThickness) {
    const wallsData = [];
    for (const { points, closed } of loops) {
        const n = points.length;
        const segs = closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
            const p = points[i];
            const q = points[(i + 1) % n];
            wallsData.push({
                c: [p.x, p.y, q.x, q.y],
                light: 20, move: 20, sight: 20, sound: 20,
                flags: { [MODULE_ID]: { dungeonGenWall: true } }
            });
        }
    }
    return wallsData;
}

/**
 * Textured wall art that follows the curve: a short rotated textured rectangle
 * per smoothed boundary edge, centred on the boundary line and overlapped so
 * the bends read as a continuous wall.
 */
export function generateCurvedWallVisuals(loops, options) {
    const { useTexture, wallColor, wallThickness, wallTilePath } = options;
    const texture = wallTilePath || `modules/${MODULE_ID}/assets/Dungeon/wall_tiles/stone_brick_horizontal.png`;
    const t = wallThickness;
    const drawings = [];

    for (const { points, closed } of loops) {
        const n = points.length;
        const segs = closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
            const p = points[i];
            const q = points[(i + 1) % n];
            const dx = q.x - p.x, dy = q.y - p.y;
            const segLen = Math.hypot(dx, dy);
            if (segLen < 0.5) continue;
            const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
            const L = segLen + t; // overlap neighbours to hide join seams
            const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;

            const drawing = {
                author: game.user?.id,
                // Foundry rotates a Drawing around its bounding-box centre; place
                // the box so its centre sits on the segment midpoint.
                x: mx - L / 2,
                y: my - t / 2,
                rotation: angleDeg,
                shape: { type: "p", width: L, height: t, points: [0, 0, L, 0, L, t, 0, t, 0, 0] },
                strokeWidth: 0,
                strokeAlpha: 0,
                fillAlpha: 1.0,
                flags: { [MODULE_ID]: { dungeonWall: true, dungeonGenCurvedWall: true } }
            };
            if (useTexture) {
                drawing.fillType = 2; // pattern
                drawing.fillColor = "#ffffff";
                drawing.texture = texture;
            } else {
                drawing.fillType = 1; // solid
                drawing.fillColor = wallColor || "#5C3D3D";
            }
            drawings.push(drawing);
        }
    }
    return drawings;
}

// ═══════════════════════════════════════════════════════
//  FRINGE CAVES (mixed room + cave mode)
// ═══════════════════════════════════════════════════════

/**
 * Woven caves: sprout many small connected cave pockets off room perimeters all
 * across the map (interior gaps AND edges), so caverns interleave with the
 * structured rooms rather than fringing one edge. Each pocket grows by random
 * walk from a perimeter-void seed (adjacent to room floor) into the void, so it
 * abuts a room and stays connected.
 * @returns {{ caveCells:Set<string>, tunnelCells:Set<string>, caveChambers:Array<{x,y}> }}
 */
export function generateFringeCaves(roomFloors, params, rng) {
    // 1. Perimeter void cells (void adjacent to room floor) — sprout candidates.
    const perim = new Set();
    for (const k of roomFloors) {
        const [x, y] = k.split(",").map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nk = `${x + dx},${y + dy}`;
            if (!roomFloors.has(nk)) perim.add(nk);
        }
    }
    const perimList = [...perim].map(k => k.split(",").map(Number));
    if (perimList.length === 0) return { caveCells: new Set(), tunnelCells: new Set(), caveChambers: [] };

    // 2. Pick well-separated seeds spread across the whole dungeon.
    const targetSeeds = Math.min(16, Math.max(4, Math.round(roomFloors.size / 45)));
    const shuffled = perimList.map(p => ({ p, r: rng() })).sort((a, b) => a.r - b.r).map(o => o.p);
    const seeds = [];
    const minSep = 6;
    for (const p of shuffled) {
        if (seeds.length >= targetSeeds) break;
        if (seeds.every(s => Math.hypot(s[0] - p[0], s[1] - p[1]) >= minSep)) seeds.push(p);
    }

    // 3. Grow a connected organic blob from each seed (mostly small pockets, the
    //    occasional larger cavern) into the void, never over room floor.
    const caveCells = new Set();
    for (const seed of seeds) {
        const big = rng() < 0.22;
        const target = big ? 22 + Math.floor(rng() * 24) : 6 + Math.floor(rng() * 12);
        growBlob(seed, roomFloors, caveCells, target, rng);
    }

    // 4. Chamber anchors for stairs/clutter/narrative, spread through the cave.
    const caveChambers = caveAnchors(caveCells, Math.max(1, Math.round(seeds.length / 2)), rng);
    return { caveCells, tunnelCells: new Set(), caveChambers };
}

/** Random-walk an organic connected blob from `seed` into void, into caveCells. */
function growBlob(seed, roomFloors, caveCells, target, rng) {
    const startK = `${seed[0]},${seed[1]}`;
    if (roomFloors.has(startK)) return;
    if (!caveCells.has(startK)) caveCells.add(startK);
    const frontier = [seed];
    let added = 1, guard = 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (added < target && frontier.length && guard++ < target * 30) {
        const [cx, cy] = frontier[Math.floor(rng() * frontier.length)];
        const [dx, dy] = dirs[Math.floor(rng() * 4)];
        const nx = cx + dx, ny = cy + dy, k = `${nx},${ny}`;
        if (roomFloors.has(k) || caveCells.has(k)) continue;
        caveCells.add(k); frontier.push([nx, ny]); added++;
    }
}

/** Pick up to `count` well-separated cave cells as chamber anchors. */
function caveAnchors(caveCells, count, rng) {
    const arr = [...caveCells].map(k => k.split(",").map(Number));
    if (!arr.length) return [];
    const shuffled = arr.map(p => ({ p, r: rng() })).sort((a, b) => a.r - b.r).map(o => o.p);
    const chosen = [];
    const minSep = 5;
    for (const p of shuffled) {
        if (chosen.length >= count) break;
        if (chosen.every(c => Math.hypot(c[0] - p[0], c[1] - p[1]) >= minSep)) chosen.push(p);
    }
    if (!chosen.length) chosen.push(arr[0]);
    return chosen.map(([x, y]) => ({ x, y }));
}

/** Cave cell closest to the room centroid, and the room cell closest to it. */
function nearestPair(caveCells, roomFloors) {
    let rcx = 0, rcy = 0, n = 0;
    for (const k of roomFloors) { const [x, y] = k.split(",").map(Number); rcx += x; rcy += y; n++; }
    rcx /= (n || 1); rcy /= (n || 1);
    let from = null, fd = Infinity;
    for (const [x, y] of caveCells) { const d = (x - rcx) ** 2 + (y - rcy) ** 2; if (d < fd) { fd = d; from = [x, y]; } }
    let to = null, td = Infinity;
    if (from) for (const k of roomFloors) {
        const [x, y] = k.split(",").map(Number);
        const d = (x - from[0]) ** 2 + (y - from[1]) ** 2;
        if (d < td) { td = d; to = [x, y]; }
    }
    return { from, to };
}

/**
 * Carve CAVE floor from `from` toward room cell `to` (horizontal then vertical),
 * stopping as soon as a carved cell abuts room floor — so the cavern bleeds
 * directly into the rooms through one open seam (no separate corridor).
 */
function carveConnector(from, to, caveCells, roomFloors) {
    const adjRoom = (cx, cy) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => roomFloors.has(`${cx + dx},${cy + dy}`));
    let [x, y] = from;
    const [tx, ty] = to;
    const sx = tx > x ? 1 : -1, sy = ty > y ? 1 : -1;
    let guard = 0;
    while (guard++ < 200) {
        const k = `${x},${y}`;
        if (roomFloors.has(k)) break;       // reached room
        caveCells.add(k);
        if (adjRoom(x, y)) return;           // touching room floor — open seam made
        if (x !== tx) x += sx;
        else if (y !== ty) y += sy;
        else break;
    }
}

/** Representative interior cell of a cave blob (nearest cell to its centroid). */
function chamberAnchor(placed) {
    let cx = 0, cy = 0;
    for (const [x, y] of placed) { cx += x; cy += y; }
    cx /= placed.length; cy /= placed.length;
    let best = placed[0], bd = Infinity;
    for (const [x, y] of placed) { const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = [x, y]; } }
    return { x: best[0], y: best[1] };
}

// ═══════════════════════════════════════════════════════
//  rot.js GENERATORS (additional dungeon styles)
// ═══════════════════════════════════════════════════════
// Vendored rot.js (libs/rot.min.js, UMD) is loaded on demand and exposes its
// generators as additional Style options. Each returns the same layout shape
// as generateLayout so the existing floor/wall/stairs pipeline is reused. The
// inline cave generator above is untouched.

let _rotPromise = null;
async function ensureRot() {
    if (globalThis.ROT) return globalThis.ROT;
    if (!_rotPromise) _rotPromise = import(`/modules/${MODULE_ID}/libs/rot.min.js`);
    await _rotPromise;
    return globalThis.ROT;
}

/** Deterministic 32-bit hash of a (string) seed for ROT.RNG.setSeed. */
function hashSeed(s) {
    let h = 2166136261;
    const str = String(s);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) || 1;
}

/** Largest 4-connected component of a floor-cell Set. */
function largestFloorRegion(set) {
    const seen = new Set();
    let best = new Set();
    for (const k0 of set) {
        if (seen.has(k0)) continue;
        const region = new Set();
        const q = [k0]; seen.add(k0);
        while (q.length) {
            const k = q.pop(); region.add(k);
            const [x, y] = k.split(",").map(Number);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nk = `${x + dx},${y + dy}`;
                if (set.has(nk) && !seen.has(nk)) { seen.add(nk); q.push(nk); }
            }
        }
        if (region.size > best.size) best = region;
    }
    return best;
}

/**
 * Generate a layout with a rot.js generator. `kind` is "maze" | "rogue" |
 * "digger" | "uniform". Returns the standard layout shape (straight-walled).
 */
export async function rotjsLayout(kind, params, seed) {
    const ROT = await ensureRot();
    ROT.RNG.setSeed(hashSeed(seed ?? "default"));

    const roomCount = Math.min(Math.max(params.roomCount ?? 10, 3), 40);
    let side = Math.round(Math.min(64, Math.max(24, roomCount * 3)));

    let gen;
    switch (kind) {
        case "maze": { const s = side | 1; gen = new ROT.Map.EllerMaze(s, s); side = s; break; }
        case "rogue": gen = new ROT.Map.Rogue(side, side); break;
        case "digger": gen = new ROT.Map.Digger(side, side); break;
        case "uniform":
        default: gen = new ROT.Map.Uniform(side, side, {}); break;
    }

    const floors = new Set();
    gen.create((x, y, val) => { if (val === 0) floors.add(`${x},${y}`); }); // 0 = floor for these generators
    const connected = largestFloorRegion(floors);

    const rng = () => ROT.RNG.getUniform();
    const chambers = pickChambers(connected, Math.min(roomCount, 12), side, side, rng);
    const placedRooms = chambers.map(c => makePseudoRoom(c.x, c.y));
    const roomData = placedRooms.map((room, i) => ({ room, isStart: i === 0 }));
    const adjacency = chainAdjacency(chambers.length);

    return {
        floors: connected,
        corridors: new Set(),
        placedRooms,
        doorPositions: [],
        entranceEdges: [],
        roomData,
        adjacency,
        _rotjs: kind,
    };
}
