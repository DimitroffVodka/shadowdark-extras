// Reskin an existing map's geometry with SDX dungeon assets.
//
// The duplication half of "copy a map and rebuild it with SDX art" is already
// solved twice over — Foundry's own Duplicate Scene, and SDX's
// scripts/scene/SceneExporter.mjs — and both already carry walls, doors, lights
// and journal notes. So this module does only the part neither of them does:
// derive the painted-floor cell set from the walls that are already there, and
// hand it to the painter's existing rebuild.
//
// Lights, notes and their journals are deliberately untouched. They survived
// the duplicate the user made before running this, and they need no conversion.

import {
	applySceneLevelData,
	documentMatchesLevel,
	makeTopLeftTileTexture,
	resolveLevelContext,
} from "./dungeon-level-context.mjs";
import { newWallPairId } from "./dungeon-wall-pairs.mjs";
import { recordDungeonAction } from "./dungeon-undo.mjs";
import {
	clipPolygonToRect,
	findLooseWallEnds,
	findWallGapBridges,
	polygonArea,
	pointInPolygon,
	subtractRectFromPolygon,
	traceRoomFaces,
	traceWallFaces,
} from "./dungeon-wall-outline.mjs";

const MODULE_ID = "shadowdark-extras";
const GRID_SIZE = 100;
// Matches the painter and the interior-wall tool, so reskinned wall art is the
// same weight as hand-painted wall art on the same scene.
const WALL_THICKNESS = 20;

/**
 * The SDX wall Drawing that re-skins one existing wall, along its own line.
 *
 * This is the whole reason the reskin does not rebuild walls from the painted
 * cell perimeter: a perimeter rebuild can only emit axis-aligned segments, so
 * every diagonal in the source map comes back as a staircase. Drawing along the
 * source segment instead reproduces any angle exactly, and guarantees the art
 * sits on the collision line rather than near it.
 *
 * Same construction the interior-wall tool uses — a rectangle rotated about its
 * centre, whose x/y is the top-left *before* rotation.
 *
 * @param {number[]} c - the wall's [x1, y1, x2, y2]
 * @param {string} texture - wall tile path
 * @returns {object|null} partial Drawing data, or null if the wall is too short
 */
export function wallDrawingGeometry(c, texture) {
	const [x1, y1, x2, y2] = c;
	const dx = x2 - x1;
	const dy = y2 - y1;
	const length = Math.hypot(dx, dy);
	if (length < 5) return null;

	const cx = (x1 + x2) / 2;
	const cy = (y1 + y2) / 2;

	return {
		x: cx - (length / 2),
		y: cy - (WALL_THICKNESS / 2),
		rotation: Math.atan2(dy, dx) * (180 / Math.PI),
		shape: { type: "r", width: length, height: WALL_THICKNESS },
		texture,
	};
}

// A leak — walls that do not fully enclose the clicked region — is the expected
// failure on hand-drawn and commercial maps, so the fill is bounded twice: by a
// cell cap and by the canvas border. Either one aborts before anything is
// written, because painting the whole canvas is far worse than painting nothing.
const MAX_CELLS = 20000;

// Cell size of the wall index. Two grid squares: big enough that most lookups
// touch one bucket, small enough that a bucket holds a handful of walls.
const WALL_INDEX_CELL = 200;

/** Do segments a-b and c-d properly cross? */
function segmentsCross(a, b, c, d) {
	const side = (p, q, r) => Math.sign(((q.y - p.y) * (r.x - q.x)) - ((q.x - p.x) * (r.y - q.y)));
	return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

/**
 * Spatial index of the walls that block movement.
 *
 * The fill used to ask Foundry's movement polygon backend. That backend answers
 * from canvas.edges — canvas state, not scene state — and on a real scene it
 * disagreed with the scene's own walls badly: the same 843 walls that this code
 * resolves into 1 area of 1255 cells came back as 26 areas of 6474, most of the
 * canvas. The wall documents are the authority on where the walls are, so the
 * fill now reads them directly. It is also deterministic, testable without a
 * canvas, and immune to the backend moving between Foundry versions.
 */
function buildWallIndex(walls, bridgeDistance = 0) {
	const buckets = new Map();
	const add = c => {
		const gx0 = Math.floor(Math.min(c[0], c[2]) / WALL_INDEX_CELL);
		const gx1 = Math.floor(Math.max(c[0], c[2]) / WALL_INDEX_CELL);
		const gy0 = Math.floor(Math.min(c[1], c[3]) / WALL_INDEX_CELL);
		const gy1 = Math.floor(Math.max(c[1], c[3]) / WALL_INDEX_CELL);
		for (let gx = gx0; gx <= gx1; gx++) {
			for (let gy = gy0; gy <= gy1; gy++) {
				const key = `${gx},${gy}`;
				if (!buckets.has(key)) buckets.set(key, []);
				buckets.get(key).push(c);
			}
		}
	};
	for (const wall of walls) {
		if (wall.door > 0) continue;
		if (wall.move === 0) continue;
		add(wall.c);
	}

	// Close the small gaps a hand-drawn map leaves. Without this a few pixels of
	// daylight in a cave outline let the fill escape and the tool refused to
	// work at all. Nothing is written to the scene — these exist only for the
	// fill's own arithmetic.
	if (bridgeDistance > 0) {
		for (const c of findWallGapBridges([...walls], 4, bridgeDistance)) add(c);
	}
	return buckets;
}

/** Does a straight move from a to b cross a movement-blocking wall? */
function blocksMove(index, a, b) {
	const gx0 = Math.floor(Math.min(a.x, b.x) / WALL_INDEX_CELL);
	const gx1 = Math.floor(Math.max(a.x, b.x) / WALL_INDEX_CELL);
	const gy0 = Math.floor(Math.min(a.y, b.y) / WALL_INDEX_CELL);
	const gy1 = Math.floor(Math.max(a.y, b.y) / WALL_INDEX_CELL);
	for (let gx = gx0; gx <= gx1; gx++) {
		for (let gy = gy0; gy <= gy1; gy++) {
			for (const c of index.get(`${gx},${gy}`) ?? []) {
				if (segmentsCross(a, b, { x: c[0], y: c[1] }, { x: c[2], y: c[3] })) return true;
			}
		}
	}
	return false;
}

/**
 * Does a door sit on the a→b step?
 *
 * Doors block "move" while closed, which would stop the fill at every doorway
 * and reduce the tool to one room per click. Treating them as open lets a
 * single click flood a whole connected dungeon. Door walls are few, so a linear
 * scan costs nothing next to the collision test it overrides.
 */
function doorCrosses(doors, a, b) {
	for (const door of doors) {
		const [x1, y1, x2, y2] = door.c;
		if (segmentsCross(a, b, { x: x1, y: y1 }, { x: x2, y: y2 })) return true;
	}
	return false;
}

/**
 * Flood the grid outward from a seed point, bounded by the scene's walls.
 *
 * @param {Scene} scene
 * @param {{x: number, y: number}} seed - canvas coordinates, normally a click
 * @param {object} [options]
 * @param {number} [options.gridSize]
 * @param {number} [options.maxCells]
 * @returns {{cells: Set<string>, leaked: boolean, reason: string|null}}
 *          cells are "gx,gy" keys in the same absolute grid space the painter
 *          places floor tiles in. `leaked` true means the result is unusable.
 */
export function floodFillFromWalls(scene, seed, options = {}) {
	const size = options.gridSize || scene.grid?.size || GRID_SIZE;
	const maxCells = options.maxCells ?? MAX_CELLS;
	const cols = Math.ceil(scene.dimensions.width / size);
	const rows = Math.ceil(scene.dimensions.height / size);
	const doors = scene.walls.filter(w => w.door > 0);
	// Reused across the many fills findEnclosedAreas runs, so the index is built
	// once per scan rather than once per area.
	const index = options.wallIndex
		?? buildWallIndex([...scene.walls], options.bridgeGaps ? size / 2 : 0);

	const half = size / 2;
	const centre = (gx, gy) => ({ x: (gx * size) + half, y: (gy * size) + half });

	// ponytail: one testCollision per shared cell edge, memoised on a canonical
	// key so the reverse step reuses it. That is ~2 quadtree queries per cell.
	// Rasterising the walls into an edge bitmap is the upgrade path if a
	// 20k-cell fill ever feels slow.
	const edges = new Map();
	const passable = (gx, gy, ngx, ngy) => {
		const key = (gx < ngx || gy < ngy)
			? `${gx},${gy}:${ngx},${ngy}`
			: `${ngx},${ngy}:${gx},${gy}`;
		if (edges.has(key)) return edges.get(key);
		const a = centre(gx, gy);
		const b = centre(ngx, ngy);
		// Doors are excluded from the wall index so they never block by default.
		// A bucket needs them back: it is asked to clear "this bit", and a
		// doorway is where that stops.
		const wallBlocks = blocksMove(index, a, b);
		const doorHere = doorCrosses(doors, a, b);
		const ok = options.doorsBlock
			? (!wallBlocks && !doorHere)
			: (!wallBlocks || doorHere);
		edges.set(key, ok);
		return ok;
	};

	const startGx = Math.floor(seed.x / size);
	const startGy = Math.floor(seed.y / size);
	const start = `${startGx},${startGy}`;
	const cells = new Set([start]);
	const queue = [[startGx, startGy]];
	let leaked = false;

	while (queue.length > 0) {
		const [gx, gy] = queue.pop();
		for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const ngx = gx + dx;
			const ngy = gy + dy;
			const key = `${ngx},${ngy}`;
			if (cells.has(key)) continue;

			// Passability BEFORE bounds. A wall on the canvas edge stops the fill
			// and that is not a leak — checking bounds first reported a leak for
			// any room flush against the edge, aborting on a perfectly sealed map
			// that simply had no padding. Only an unobstructed step off the canvas
			// means the walls failed to hold.
			if (!passable(gx, gy, ngx, ngy)) continue;
			if (ngx < 0 || ngy < 0 || ngx >= cols || ngy >= rows) {
				leaked = true;
				continue;
			}
			cells.add(key);
			if (cells.size > maxCells) return { cells, leaked: true, reason: "cap" };
			queue.push([ngx, ngy]);
		}
	}

	return { cells, leaked, reason: leaked ? "border" : null };
}

/**
 * Every enclosed area on the scene, not just the one under a click.
 *
 * A map is rarely one connected space. Measured on a real 897-wall map: 16
 * separate enclosed areas, of which the largest held 1239 of the cells. Seeding
 * the reskin from a single click therefore did one area and silently left the
 * other fifteen — including two whole corridor systems — untouched, with nothing
 * in the result to say so.
 *
 * Each cell is filled at most once, so this costs about one fill over the wall
 * bounding box however many areas it finds. Areas whose fill escapes are dropped
 * here rather than reported: outside the walls is not an area.
 *
 * @param {Scene} scene
 * @param {number} size - grid size
 * @param {number} [minCells] - ignore slivers, which are usually wall thickness
 * @returns {Array<Set<string>>} cell sets, largest first
 */
export function findEnclosedAreas(scene, size, minCells = 3) {
	let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
	for (const wall of scene.walls) {
		const [x1, y1, x2, y2] = wall.c;
		minX = Math.min(minX, x1, x2);
		maxX = Math.max(maxX, x1, x2);
		minY = Math.min(minY, y1, y2);
		maxY = Math.max(maxY, y1, y2);
	}
	if (!Number.isFinite(minX)) return [];

	const wallIndex = buildWallIndex([...scene.walls]);
	const seen = new Set();
	const areas = [];
	for (let gx = Math.floor(minX / size); gx <= Math.floor(maxX / size); gx++) {
		for (let gy = Math.floor(minY / size); gy <= Math.floor(maxY / size); gy++) {
			if (seen.has(`${gx},${gy}`)) continue;
			const seed = { x: (gx * size) + (size / 2), y: (gy * size) + (size / 2) };
			const filled = floodFillFromWalls(scene, seed, { gridSize: size, wallIndex });
			const { cells, leaked } = filled;
			for (const cell of cells) seen.add(cell);
			if (leaked || cells.size < minCells) continue;
			areas.push(cells);
		}
	}

	return areas.sort((a, b) => b.size - a.size);
}

/**
 * Does a door open INTO this area?
 *
 * Deliberately not "is there a door nearby": a door sits on a wall and connects
 * exactly the two cells either side of it, so the test steps off the door along
 * its normal and asks whether either landing cell is in the area. A proximity
 * test instead of this one kept 13 of 16 areas on a real map where only 1 is
 * genuinely a room — rock pockets sit right next to doors without opening onto
 * them.
 */
function areaTouchesDoor(area, doors, size) {
	for (const door of doors) {
		const [x1, y1, x2, y2] = door.c;
		const length = Math.hypot(x2 - x1, y2 - y1);
		if (length < 1) continue;

		const midX = (x1 + x2) / 2;
		const midY = (y1 + y2) / 2;
		// Unit normal to the door, scaled just past the wall into each cell.
		const nx = (-(y2 - y1) / length) * (size * 0.6);
		const ny = ((x2 - x1) / length) * (size * 0.6);

		for (const [px, py] of [[midX + nx, midY + ny], [midX - nx, midY - ny]]) {
			if (area.has(`${Math.floor(px / size)},${Math.floor(py / size)}`)) return true;
		}
	}
	return false;
}

/**
 * The enclosed areas that are ROOMS, as opposed to the rock between them.
 *
 * Enclosure alone does not mean floor. On a map whose outer boundary is walled,
 * the solid rock between the rooms is enclosed too, and flooring it fills the
 * entire footprint into one slab — which is a far worse result than missing a
 * corner, because there is then no map left to read.
 *
 * Doors are the discriminator, and on a real map they are a clean one. Measured
 * on a 897-wall scene: one area of 1239 cells touching doors, and fifteen
 * totalling 484 cells touching none. The first is the dungeon; the rest are the
 * rock. Rooms are what people put doors on; rock is not.
 *
 * When a map has no doors at all the signal is absent, so this falls back to the
 * single largest area and nothing else. That errs toward doing too little, which
 * Paint Room Floor can correct a room at a time; erring the other way cannot be
 * corrected by anything except Clear.
 *
 * @param {Scene} scene
 * @param {number} size - grid size
 * @returns {Array<Set<string>>}
 */
export function findRoomAreas(scene, size) {
	const areas = findEnclosedAreas(scene, size);
	if (areas.length === 0) return [];

	const doors = scene.walls.filter(w => w.door > 0);
	if (doors.length === 0) return areas.slice(0, 1);

	const withDoors = areas.filter(area => areaTouchesDoor(area, doors, size));
	return withDoors.length > 0 ? withDoors : areas.slice(0, 1);
}

/**
 * Paint SDX floor tiles over a wall-derived region and re-skin the walls that
 * bound it, in place and at their own angles.
 *
 * Nothing is deleted. The source walls keep doing the collision work they
 * already did correctly, and the SDX art is drawn along them — which is both
 * safer than replacing them and the only way a diagonal survives.
 *
 * @param {Scene} scene
 * @param {{x: number, y: number}} seed - canvas coordinates inside the region
 * @param {object} deps - the painter's own helpers, injected to keep this
 *        module off the painter's import cycle
 * @param {Function} deps.ensureBackgroundDrawing
 * @param {string} deps.floorTilePath
 * @param {string} deps.wallTilePath
 * @param {string} deps.doorTilePath
 * @param {string} deps.backgroundSetting
 * @param {boolean} deps.wallShadows
 * @returns {Promise<{cells: number, wallsSkinned: number, doorsSkinned: number}|null>}
 *          null if the caller cancelled or the fill leaked
 */
export async function reskinScene(scene, deps) {
	if (!game.user.isGM) {
		ui.notifications.warn("SDX | Reskinning is GM-only.");
		return null;
	}
	if (!scene) return null;
	if (!deps.floorTilePath) {
		ui.notifications.warn("SDX | Select a floor tile first.");
		return null;
	}

	const size = scene.grid?.size || GRID_SIZE;

	// Every area that reads as rooms — see findRoomAreas for why enclosure alone
	// is not enough, and what happens to a map when the rock is floored too.
	const areas = findRoomAreas(scene, size);
	if (areas.length === 0) {
		ui.notifications.error(
			"SDX | Found no enclosed rooms on this scene. The walls need to close into rooms "
            + "before there is anything to reskin. Nothing was changed."
		);
		return null;
	}

	const cells = new Set();
	for (const area of areas) for (const cell of area) cells.add(cell);

	const levelContext = resolveLevelContext(scene);

	// Every wall on the level: the whole map is in scope, so there is no region
	// to bound this to any more.
	const wallsToSkin = [];
	const doorsToSkin = [];
	let diagonals = 0;
	for (const wall of scene.walls) {
		if (!documentMatchesLevel(wall, levelContext)) continue;
		const [x1, y1, x2, y2] = wall.c;
		if (wall.door > 0) {
			doorsToSkin.push(wall);
			continue;
		}
		if (Math.abs(x1 - x2) > 1 && Math.abs(y1 - y2) > 1) diagonals += 1;
		wallsToSkin.push(wall);
	}

	const diagonalLine = diagonals > 0
		? `<li><strong>${diagonals}</strong> of those walls run at an angle, and are drawn at that angle
			rather than stepped onto the grid.</li>`
		: "";
	const areaLine = areas.length > 1
		? `<li>The map has <strong>${areas.length}</strong> separate walled-off areas. All of them are done.</li>`
		: "";

	const confirmed = await foundry.applications.api.DialogV2.confirm({
		window: { title: "Reskin With SDX Assets" },
		content: `<div style="padding:8px 0">
			<p>Repaint <strong>${cells.size}</strong> grid squares of floor with the selected SDX tile.</p>
			<ul style="margin:8px 0 8px 18px">
				${areaLine}
				<li>Draws SDX wall art along <strong>${wallsToSkin.length}</strong> existing walls, in place.</li>
				${diagonalLine}
				<li>Re-skins <strong>${doorsToSkin.length}</strong> doors with the selected door tile.</li>
				<li>Clears the scene's background image. Lights, notes and journals are left alone.</li>
			</ul>
			<p><em>No walls are deleted — the map keeps the collision it already has.
			This still edits the current scene; run it on a duplicate if you want the original art back.</em></p>
		</div>`,
		yes: { label: "Reskin" },
		no: { label: "Cancel" },
		modal: true,
	});
	if (!confirmed) return null;

	// Stash the background image before clearing it, so the original art is one
	// flag read away rather than gone.
	if (scene.background?.src) {
		await scene.setFlag(MODULE_ID, "reskinPreviousBackground", scene.background.src);
		await scene.update({ "background.src": null });
	}

	const chunkSize = 100;

	// Floor follows the walls, not the grid. Square tiles were the original
	// approach and are still the fallback, but a cell is painted when its CENTRE
	// is inside the room, so along any angled wall the floor overhangs by up to
	// half a cell in places and falls short in others — the wall art ran true
	// while the floor stepped, and the two visibly disagreed.
	const centres = [...cells].map(key => {
		const [gx, gy] = key.split(",").map(Number);
		return { x: (gx * size) + (size / 2), y: (gy * size) + (size / 2) };
	});
	const attempt = traceRoomFaces([...scene.walls], centres, {
		expectedArea: cells.size * size * size,
		// Half a cell. Big enough for the gaps hand-drawn maps actually leave,
		// small enough that it cannot bridge a doorway shut.
		bridgeDistance: size / 2,
	});
	const traced = attempt && !attempt.rejected ? attempt : null;

	// Cells the trace covered with a polygon. Anything left over still needs a
	// floor: a region whose walls will not close (a cave outline missing by a
	// few pixels, say) otherwise came out bare, with the rest of the map
	// reskinned around it and no indication why.
	const tileCells = new Set(cells);
	if (traced) {
		const covered = key => {
			const [gx, gy] = key.split(",").map(Number);
			const point = { x: (gx * size) + (size / 2), y: (gy * size) + (size / 2) };
			return !traced.unmatched.some(p => p.x === point.x && p.y === point.y);
		};
		for (const key of [...tileCells]) if (covered(key)) tileCells.delete(key);
	}

	if (traced) {
		const shapes = traced.rooms.map(room => {
			let minX = Infinity; let minY = Infinity;
			for (const p of room.points) {
				if (p.x < minX) minX = p.x;
				if (p.y < minY) minY = p.y;
			}
			return applySceneLevelData({
				author: game.user.id,
				x: minX,
				y: minY,
				shape: {
					type: "p",
					points: room.points.flatMap(p => [p.x - minX, p.y - minY]),
				},
				strokeWidth: 0,
				strokeAlpha: 0,
				fillType: 2,
				fillColor: "#ffffff",
				fillAlpha: 1.0,
				texture: deps.floorTilePath,
				elevation: levelContext.elevation,
				sort: -10,
				flags: {
					// Not dungeonWall — the wall rebuild deletes those. Its own key
					// so Clear can find it and nothing else touches it.
					[MODULE_ID]: { dungeonFloorShape: true, placeableNotesExcluded: true },
				},
			}, "Drawing", levelContext);
		});
		for (let i = 0; i < shapes.length; i += chunkSize) {
			await scene.createEmbeddedDocuments("Drawing", shapes.slice(i, i + chunkSize));
		}
	}
	// Grid tiles ONLY patch gaps in a result that otherwise traced. They are NOT
	// a fallback for a failed trace: when tracing fails it is because the walls
	// do not enclose the rooms, so the fill has already merged rooms with the
	// rock between them — and blanketing that in square tiles floors the whole
	// map, which is a worse outcome than doing nothing and saying why.
	if (traced && tileCells.size > 0) {
		// Same tile shape the rectangle-fill paint path creates, so the rebuild
		// and the erase tools recognise these as ordinary painted floor.
		const tilesToCreate = [];
		for (const key of tileCells) {
			const [gx, gy] = key.split(",").map(Number);
			const existing = scene.tiles.find(t =>
				Math.floor(t.x / size) === gx
                && Math.floor(t.y / size) === gy
                && t.texture?.src?.includes("Dungeon/floor_tiles")
                && documentMatchesLevel(t, levelContext)
			);
			if (existing) continue;
			tilesToCreate.push(applySceneLevelData({
				texture: makeTopLeftTileTexture(deps.floorTilePath),
				x: gx * size,
				y: gy * size,
				width: size,
				height: size,
				sort: 0,
				flags: {
					// dungeonFloor so the erase tool and Clear treat it as ordinary
					// painted floor; dungeonReskinFloor so the wall rebuild does NOT —
					// this floor came from a map that already has walls, and deriving a
					// perimeter from it would double them with a grid-stepped copy.
					[MODULE_ID]: { dungeonFloor: true, dungeonReskinFloor: true },
				},
			}, "Tile", levelContext));
		}
		for (let i = 0; i < tilesToCreate.length; i += chunkSize) {
			await scene.createEmbeddedDocuments("Tile", tilesToCreate.slice(i, i + chunkSize));
		}
	}

	await deps.ensureBackgroundDrawing(scene, 0, deps.backgroundSetting, levelContext.levelId);

	// Wall art, drawn along each source wall at its own angle. Flagged as an
	// interior wall as well as a wall: rebuildWallsForLevel deletes dungeonWall
	// drawings but deliberately spares dungeonIntWall ones, and these must
	// survive a later paint on the same scene the same way hand-drawn interior
	// walls do.
	// The pair id links the new art to the wall it was drawn from — which here is
	// a wall the map already had, not one SDX created. That is what makes a
	// reskinned wall behave as one object afterwards: deleting the art on the
	// Drawings layer removes the source wall with it, and vice versa.
	const wallDrawings = [];
	const wallPairUpdates = [];
	for (const wall of wallsToSkin) {
		const geometry = wallDrawingGeometry(wall.c, deps.wallTilePath);
		if (!geometry) continue;
		const pairId = newWallPairId();
		// Nested rather than a dotted "flags.<id>.wallPairId" path: an update
		// deep-merges either way, but the dotted form is a computed string the
		// flag-snapshot analyser cannot read, so it would widen that gate's blind
		// spot for no gain.
		wallPairUpdates.push({ _id: wall.id, flags: { [MODULE_ID]: { wallPairId: pairId } } });
		wallDrawings.push(applySceneLevelData({
			author: game.user.id,
			...geometry,
			strokeWidth: 0,
			strokeAlpha: 0,
			fillType: 2,
			fillColor: "#ffffff",
			fillAlpha: 1.0,
			elevation: levelContext.elevation,
			flags: {
				[MODULE_ID]: {
					dungeonWall: true,
					dungeonIntWall: true,
					placeableNotesExcluded: true,
					wallPairId: pairId,
				},
				levels: { rangeTop: levelContext.rangeTop },
			},
		}, "Drawing", levelContext));
	}

	// ponytail: shadows are applied per document because that is TokenMagic's
	// only interface. On a map with hundreds of walls this is the slow step —
	// leave Wall Shadows off for a first pass on a big map.
	const shadowParams = [{
		filterType: "shadow", filterId: "dropshadow2",
		rotation: 0, distance: 0, color: 0x000000, alpha: 1,
		shadowOnly: false, blur: 5, quality: 5, padding: 20,
	}];
	for (let i = 0; i < wallDrawings.length; i += chunkSize) {
		const created = await scene.createEmbeddedDocuments("Drawing", wallDrawings.slice(i, i + chunkSize));
		if (deps.wallShadows && window.TokenMagic) {
			for (const doc of created) {
				try {
					await TokenMagic.addUpdateFilters(doc, shadowParams);
				}
				catch(err) {
					console.warn(`${MODULE_ID} | Reskin wall shadow failed:`, err);
				}
			}
		}
	}

	for (let i = 0; i < wallPairUpdates.length; i += chunkSize) {
		await scene.updateEmbeddedDocuments("Wall", wallPairUpdates.slice(i, i + chunkSize));
	}

	// Door art is a property of the Wall document, not a separate Drawing, so a
	// door re-skins at any angle for free — Foundry rotates the swing texture to
	// the wall it sits on.
	if (deps.doorTilePath) {
		const doorUpdates = doorsToSkin.map(door => ({
			_id: door.id,
			animation: { ...(door.animation ?? {}), type: door.animation?.type || "swing", texture: deps.doorTilePath },
		}));
		for (let i = 0; i < doorUpdates.length; i += chunkSize) {
			await scene.updateEmbeddedDocuments("Wall", doorUpdates.slice(i, i + chunkSize));
		}
	}

	const diagonalNote = diagonals > 0 ? `, ${diagonals} at an angle` : "";
	const gapNote = tileCells.size > 0 && traced
		? `, plus ${tileCells.size} squares where walls had gaps`
		: "";
	const floorNote = traced
		? `floor fitted to ${traced.rooms.length} room${traced.rooms.length === 1 ? "" : "s"}${gapNote}`
		: attempt
			? `NO FLOOR — fitted ${attempt.rooms.length} rooms covering `
                + `${Math.round(attempt.area / (size * size))} squares but the fill found `
                + `${cells.size} (${(attempt.drift * 100).toFixed(0)}% apart, over the 25% limit)`
			: `NO FLOOR — could not fit any room outline to ${cells.size} squares of fill`;
	const report = `SDX | Reskinned — ${floorNote}, ${wallDrawings.length} walls skinned${diagonalNote}, `
        + `${deps.doorTilePath ? doorsToSkin.length : 0} doors. No walls were deleted.`;
	if (traced) {
		ui.notifications.info(report);
	}
	else {
		// Loud, because the wall art landed and the floor did not — which looks
		// like a half-finished run unless it says why.
		ui.notifications.warn(
			`${report} Close the wall gaps (Monk's Wall Enhancement has a "join wall points" `
            + "tool for this), then Clear and reskin again."
		);
	}

	return {
		cells: cells.size,
		rooms: traced ? traced.rooms.length : 0,
		wallsSkinned: wallDrawings.length,
		doorsSkinned: doorsToSkin.length,
		diagonals,
	};
}

/**
 * A floor shape's polygon in scene coordinates.
 *
 * Drawing polygon points are stored relative to the document's x/y, so they are
 * translated back before use. Floor shapes carry no rotation, which is why none
 * is applied here.
 */
function floorPolygonOf(drawing) {
	const flat = drawing.shape?.points;
	if (!flat || flat.length < 6) return null;
	const polygon = [];
	for (let i = 0; i < flat.length; i += 2) {
		polygon.push({ x: flat[i] + drawing.x, y: flat[i + 1] + drawing.y });
	}
	return polygon;
}

/**
 * Fill the floor of the room under a point.
 *
 * The room is worked out from the WALLS, never from whatever floor is already
 * lying there — which is what a paint bucket does, and what stops a leftover
 * shape covering half the map from being treated as "the room".
 *
 * @param {Scene} scene
 * @param {{x: number, y: number}} point - canvas coordinates, normally a click
 * @param {string} floorTilePath
 * @returns {Promise<boolean>} whether a room was repainted
 */
export async function paintRoomFloor(scene, point, floorTilePath) {
	if (!game.user.isGM) {
		ui.notifications.warn("SDX | Painting room floors is GM-only.");
		return false;
	}
	if (!scene) return false;
	if (!floorTilePath) {
		ui.notifications.warn("SDX | Select a floor tile first.");
		return false;
	}

	// The room comes from the WALLS every time, never from whatever floor happens
	// to be lying there. Reading the existing floor first is what made the bucket
	// misbehave: one bad earlier fill had left a single polygon covering the
	// whole map, so every click found that as "the room" and repainted all of it.
	// A paint bucket fills the area its boundaries enclose, not the area the last
	// person's paint happens to cover.
	const room = await traceRoomAt(scene, point);
	if (!room) return false;

	// If a floor already IS this room, recolour it rather than stacking another
	// copy on top — otherwise repeated clicks pile up duplicate documents.
	const existing = scene.drawings.find(drawing => {
		if (!drawing.flags?.[MODULE_ID]?.dungeonFloorShape) return false;
		const polygon = floorPolygonOf(drawing);
		if (!polygon || !pointInPolygon(point, polygon)) return false;
		const area = polygonArea(polygon);
		return Math.abs(area - room.area) / room.area < 0.05;
	});

	if (existing) {
		if (existing.texture === floorTilePath) return false;
		// A retexture is reversed by putting the old one back, not by deleting.
		recordDungeonAction("Paint room floor", {
			deleted: [{ type: "Drawing", data: [existing.toObject()] }],
			created: [{ type: "Drawing", ids: [existing.id] }],
		});
		await scene.updateEmbeddedDocuments("Drawing", [{ _id: existing.id, texture: floorTilePath }]);
		return true;
	}

	// Otherwise lay this room's floor OVER whatever is underneath, the way paint
	// covers paint. Cutting the old shape would need a general polygon boolean;
	// sorting above it gets the same picture for none of the risk.
	let sort = -10;
	for (const drawing of scene.drawings) {
		if (!drawing.flags?.[MODULE_ID]?.dungeonFloorShape) continue;
		const polygon = floorPolygonOf(drawing);
		if (!polygon || !pointInPolygon(point, polygon)) continue;
		sort = Math.max(sort, (drawing.sort ?? -10) + 1);
	}

	return createFloorShape(scene, room.points, floorTilePath, sort);
}

/**
 * The room a point sits in, worked out from the walls.
 *
 * Fill first to establish the region and catch a leak, then fit the outline to
 * the walls, then keep only the face containing the point — the bucket paints
 * one room, not every room the fill could reach through doors.
 *
 * @returns {{points: Array<{x: number, y: number}>, area: number}|null}
 */
async function traceRoomAt(scene, point) {
	const size = scene.grid?.size || GRID_SIZE;
	const { cells, leaked, reason } = floodFillFromWalls(scene, point, { gridSize: size });

	if (leaked) {
		ui.notifications.warn(
			`SDX | That spot isn't closed in by walls${reason === "cap" ? "" : " — the fill escaped the map"}. `
            + "Click inside a room that's fully walled, or check the Walls layer for a gap. Nothing was painted."
		);
		return null;
	}

	const centres = [...cells].map(key => {
		const [gx, gy] = key.split(",").map(Number);
		return { x: (gx * size) + (size / 2), y: (gy * size) + (size / 2) };
	});
	const traced = traceRoomFaces([...scene.walls], centres, {
		expectedArea: cells.size * size * size,
		bridgeDistance: size / 2,
	});

	const room = traced?.rooms
		.filter(candidate => pointInPolygon(point, candidate.points))
		.sort((a, b) => a.area - b.area)[0];

	if (!room) {
		ui.notifications.warn(
			"SDX | Couldn't work out the shape of that room. Its walls have a gap bigger than "
            + "half a square. Find it on the Walls layer, then click again."
		);
		return null;
	}
	return room;
}

/**
 * Lay a floor shape over a polygon, and clear any grid tiles it now covers.
 */
async function createFloorShape(scene, points, floorTilePath, sort = -10) {
	const size = scene.grid?.size || GRID_SIZE;
	const levelContext = resolveLevelContext(scene);

	let minX = Infinity;
	let minY = Infinity;
	for (const p of points) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
	}

	const madeFloor = await scene.createEmbeddedDocuments("Drawing", [applySceneLevelData({
		author: game.user.id,
		x: minX,
		y: minY,
		shape: { type: "p", points: points.flatMap(p => [p.x - minX, p.y - minY]) },
		strokeWidth: 0,
		strokeAlpha: 0,
		fillType: 2,
		fillColor: "#ffffff",
		fillAlpha: 1.0,
		texture: floorTilePath,
		elevation: levelContext.elevation,
		sort,
		flags: {
			[MODULE_ID]: { dungeonFloorShape: true, placeableNotesExcluded: true },
		},
	}, "Drawing", levelContext)]);

	// Drop any grid-tile floor the new shape now covers, so a room that had
	// fallen back to tiles does not end up with two floors stacked.
	const covered = scene.tiles.filter(tile => {
		if (!tile.flags?.[MODULE_ID]?.dungeonReskinFloor) return false;
		if (!documentMatchesLevel(tile, levelContext)) return false;
		const centre = { x: tile.x + (size / 2), y: tile.y + (size / 2) };
		return pointInPolygon(centre, points);
	});

	// Recorded as one action: the new floor goes away and the tiles it replaced
	// come back, so a wrong room is a single undo rather than two repairs.
	recordDungeonAction("Floor room", {
		created: [{ type: "Drawing", ids: madeFloor.map(d => d.id) }],
		deleted: [{ type: "Tile", data: covered.map(t => t.toObject()) }],
	});

	if (covered.length > 0) {
		await scene.deleteEmbeddedDocuments("Tile", covered.map(t => t.id));
	}

	return true;
}

/**
 * Delete SDX floor inside a box, so a bad result can be cleaned up by hand.
 *
 * Deliberately blunt: it removes whole pieces of floor that the box touches,
 * rather than cutting them. Automatic room detection will always be wrong on
 * some map, and an eraser the user aims themselves is worth more than another
 * heuristic that is right most of the time.
 *
 * Only SDX floor goes. Walls, doors, lights, notes and the map's own art are
 * never touched.
 *
 * @param {Scene} scene
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} rect
 * @returns {Promise<number>} how many pieces of floor were removed
 */
export async function eraseFloorRegion(scene, rect) {
	if (!game.user.isGM) {
		ui.notifications.warn("SDX | Erasing floor is GM-only.");
		return 0;
	}
	if (!scene) return 0;

	const size = scene.grid?.size || GRID_SIZE;

	// Floor is CUT, not deleted whole. A corridor network with no internal doors
	// is a single polygon, so deleting any shape the box touches wiped the floor
	// off an entire map when the user erased one 3x3 room.
	const shapeIds = [];
	const remainders = [];
	for (const drawing of scene.drawings) {
		if (!drawing.flags?.[MODULE_ID]?.dungeonFloorShape) continue;
		const polygon = floorPolygonOf(drawing);
		if (!polygon) continue;
		if (clipPolygonToRect(polygon, rect).length < 3) continue;

		shapeIds.push(drawing.id);
		const source = drawing.toObject();
		for (const piece of subtractRectFromPolygon(polygon, rect)) {
			let pieceX = Infinity;
			let pieceY = Infinity;
			for (const point of piece) {
				if (point.x < pieceX) pieceX = point.x;
				if (point.y < pieceY) pieceY = point.y;
			}
			remainders.push({
				...source,
				_id: undefined,
				x: pieceX,
				y: pieceY,
				shape: {
					...source.shape,
					type: "p",
					points: piece.flatMap(point => [point.x - pieceX, point.y - pieceY]),
				},
			});
		}
	}

	// Wall art too. "Make this area blank" is the actual request an eraser gets,
	// and leaving the walls behind means the area is not blank — it is a floor
	// deletion the user then has to finish by hand on another layer. Both halves
	// are SDX's own output and both are undoable.
	for (const drawing of scene.drawings) {
		const flags = drawing.flags?.[MODULE_ID];
		if (!flags?.dungeonWall && !flags?.dungeonBackground) continue;
		// x/y is the top-left BEFORE rotation and wall art rotates about its
		// centre, so the centre is rotation-invariant and the right thing to test.
		const centre = {
			x: drawing.x + ((drawing.shape?.width ?? 0) / 2),
			y: drawing.y + ((drawing.shape?.height ?? 0) / 2),
		};
		if (centre.x < rect.minX || centre.x > rect.maxX) continue;
		if (centre.y < rect.minY || centre.y > rect.maxY) continue;
		shapeIds.push(drawing.id);
	}

	const tileIds = scene.tiles.filter(tile => {
		const flags = tile.flags?.[MODULE_ID];
		if (!flags?.dungeonFloor && !flags?.dungeonStairs
            && !flags?.dungeonStairsDown && !flags?.dungeonClutter) return false;
		return tile.x + size > rect.minX && tile.x < rect.maxX
            && tile.y + size > rect.minY && tile.y < rect.maxY;
	}).map(tile => tile.id);

	if (shapeIds.length === 0 && tileIds.length === 0) {
		ui.notifications.info("SDX | Nothing of SDX's in that area.");
		return 0;
	}

	// Snapshot before deleting: the whole point of the eraser is that it is blunt,
	// which only works if overshooting can be taken back.
	recordDungeonAction("Erase area", {
		deleted: [
			{ type: "Drawing", data: shapeIds.map(id => scene.drawings.get(id).toObject()) },
			{ type: "Tile", data: tileIds.map(id => scene.tiles.get(id).toObject()) },
		],
	});

	if (shapeIds.length > 0) await scene.deleteEmbeddedDocuments("Drawing", shapeIds);
	if (tileIds.length > 0) await scene.deleteEmbeddedDocuments("Tile", tileIds);

	// The parts of each cut shape that fall outside the box go back, so erasing
	// a room out of a corridor leaves the rest of the corridor floored.
	if (remainders.length > 0) {
		const restored = await scene.createEmbeddedDocuments("Drawing", remainders);
		recordDungeonAction("Erase area", {
			created: [{ type: "Drawing", ids: restored.map(d => d.id) }],
		});
	}

	const total = shapeIds.length + tileIds.length;
	ui.notifications.info(`SDX | Erased ${total} SDX piece${total === 1 ? "" : "s"} — floor and wall art.`);
	return total;
}

/**
 * Put a visible marker on every wall end that connects to nothing.
 *
 * "Close the wall gaps" is unactionable advice on a map with 800 walls — you
 * cannot fix what you cannot find. These are the exact points a fill escapes
 * through, so marking them turns the reskin's refusal into a to-do list.
 *
 * Toggles: calling it again clears the markers.
 *
 * @param {Scene} scene
 * @returns {Promise<number>} markers placed, or 0 when clearing
 */
export async function toggleWallGapMarkers(scene) {
	if (!game.user.isGM) {
		ui.notifications.warn("SDX | Marking wall gaps is GM-only.");
		return 0;
	}
	if (!scene) return 0;

	const existing = scene.drawings
		.filter(d => d.flags?.[MODULE_ID]?.dungeonGapMarker)
		.map(d => d.id);
	if (existing.length > 0) {
		await scene.deleteEmbeddedDocuments("Drawing", existing);
		ui.notifications.info("SDX | Wall gap markers cleared.");
		return 0;
	}

	const loose = findLooseWallEnds([...scene.walls]);
	if (loose.length === 0) {
		ui.notifications.info("SDX | No loose wall ends — every wall meets another.");
		return 0;
	}

	const size = scene.grid?.size || GRID_SIZE;
	const radius = size / 3;
	const levelContext = resolveLevelContext(scene);

	const markers = loose.map(point => applySceneLevelData({
		author: game.user.id,
		x: point.x - radius,
		y: point.y - radius,
		shape: { type: "e", width: radius * 2, height: radius * 2 },
		strokeWidth: 4,
		strokeColor: "#ff3b30",
		strokeAlpha: 1,
		fillType: 1,
		fillColor: "#ff3b30",
		fillAlpha: 0.25,
		// Above everything, because the point is to be seen.
		elevation: levelContext.elevation,
		sort: 100,
		flags: {
			[MODULE_ID]: { dungeonGapMarker: true, placeableNotesExcluded: true },
		},
	}, "Drawing", levelContext));

	const chunk = 100;
	for (let i = 0; i < markers.length; i += chunk) {
		await scene.createEmbeddedDocuments("Drawing", markers.slice(i, i + chunk));
	}

	ui.notifications.info(
		`SDX | Marked ${loose.length} loose wall end${loose.length === 1 ? "" : "s"} in red. `
        + "Join or extend the walls there, then press the button again to clear the markers."
	);
	return loose.length;
}


/**
 * Erase the floor under a freehand brush stroke.
 *
 * A dragged box assumes rooms are rectangles and they are not — sweeping one
 * over a corridor bend either misses the turn or eats the wall beside it. This
 * takes the SET OF SQUARES the cursor actually passed over, so the erased shape
 * is whatever was drawn.
 *
 * Squares are merged into horizontal runs before cutting. A 40-square stroke is
 * a handful of rectangles that way instead of 40, and each cut multiplies the
 * pieces the shape is left in.
 *
 * @param {Scene} scene
 * @param {Set<string>} cells - "gx,gy" keys the brush covered
 * @returns {Promise<number>} pieces removed
 */
export async function eraseFloorCells(scene, cells, options = {}) {
	if (!game.user.isGM) {
		ui.notifications.warn("SDX | Erasing is GM-only.");
		return 0;
	}
	if (!scene || cells.size === 0) return 0;

	const size = scene.grid?.size || GRID_SIZE;

	// Merge each row of squares into runs, so the cut is a few wide rectangles
	// rather than one per square.
	const byRow = new Map();
	for (const key of cells) {
		const [gx, gy] = key.split(",").map(Number);
		if (!byRow.has(gy)) byRow.set(gy, []);
		byRow.get(gy).push(gx);
	}
	const rects = [];
	for (const [gy, xs] of byRow) {
		xs.sort((a, b) => a - b);
		let runStart = xs[0];
		let previous = xs[0];
		for (let i = 1; i <= xs.length; i++) {
			if (i < xs.length && xs[i] === previous + 1) {
				previous = xs[i];
				continue;
			}
			rects.push({
				minX: runStart * size,
				maxX: (previous + 1) * size,
				minY: gy * size,
				maxY: (gy + 1) * size,
			});
			runStart = xs[i];
			previous = xs[i];
		}
	}

	const covers = point => cells.has(`${Math.floor(point.x / size)},${Math.floor(point.y / size)}`);

	const shapeIds = [];
	const remainders = [];
	for (const drawing of scene.drawings) {
		if (!drawing.flags?.[MODULE_ID]?.dungeonFloorShape) continue;
		const polygon = floorPolygonOf(drawing);
		if (!polygon) continue;
		if (!rects.some(rect => clipPolygonToRect(polygon, rect).length >= 3)) continue;

		// Cut every run out in turn; each cut splits the pieces further.
		let pieces = [polygon];
		for (const rect of rects) {
			pieces = pieces.flatMap(piece => subtractRectFromPolygon(piece, rect));
			if (pieces.length === 0) break;
		}

		shapeIds.push(drawing.id);
		const source = drawing.toObject();
		for (const piece of pieces) {
			let px = Infinity;
			let py = Infinity;
			for (const q of piece) {
				if (q.x < px) px = q.x;
				if (q.y < py) py = q.y;
			}
			remainders.push({
				...source,
				_id: undefined,
				x: px,
				y: py,
				shape: {
					...source.shape,
					type: "p",
					points: piece.flatMap(q => [q.x - px, q.y - py]),
				},
			});
		}
	}

	// Wall art only goes when the caller asks for it. A bucket clears the floor
	// INSIDE a room and the room still exists, so its walls must survive — and
	// they would not by accident: wall art sits ON the boundary of the flooded
	// area, so its centre lands in a flooded square every time.
	if (options.includeWallArt) {
		for (const drawing of scene.drawings) {
			const flags = drawing.flags?.[MODULE_ID];
			if (!flags?.dungeonWall && !flags?.dungeonBackground) continue;
			const centre = {
				x: drawing.x + ((drawing.shape?.width ?? 0) / 2),
				y: drawing.y + ((drawing.shape?.height ?? 0) / 2),
			};
			if (covers(centre)) shapeIds.push(drawing.id);
		}
	}

	const tileIds = scene.tiles.filter(tile => {
		const flags = tile.flags?.[MODULE_ID];
		if (!flags?.dungeonFloor && !flags?.dungeonStairs
            && !flags?.dungeonStairsDown && !flags?.dungeonClutter) return false;
		return covers({ x: tile.x + (size / 2), y: tile.y + (size / 2) });
	}).map(tile => tile.id);

	if (shapeIds.length === 0 && tileIds.length === 0) {
		ui.notifications.info("SDX | No SDX floor under that stroke.");
		return 0;
	}

	recordDungeonAction("Erase floor", {
		deleted: [
			{ type: "Drawing", data: shapeIds.map(id => scene.drawings.get(id).toObject()) },
			{ type: "Tile", data: tileIds.map(id => scene.tiles.get(id).toObject()) },
		],
	});

	if (shapeIds.length > 0) await scene.deleteEmbeddedDocuments("Drawing", shapeIds);
	if (tileIds.length > 0) await scene.deleteEmbeddedDocuments("Tile", tileIds);

	if (remainders.length > 0) {
		const restored = await scene.createEmbeddedDocuments("Drawing", remainders);
		recordDungeonAction("Erase floor", {
			created: [{ type: "Drawing", ids: restored.map(d => d.id) }],
		});
	}

	ui.notifications.info(`SDX | Erased ${cells.size} square${cells.size === 1 ? "" : "s"}.`);
	return shapeIds.length + tileIds.length;
}

/**
 * Paint-bucket erase: clear the floor inside one walled area, and stop AT the
 * walls.
 *
 * Not cells. Erasing grid squares is what broke this: squares are axis-aligned
 * and a cave wall is not, so a square-based cut eats floor past the wall line
 * and leaves a stepped edge crossing it. Staying inside the walls is the whole
 * requirement.
 *
 * So nothing is cut. The room is one face of the wall graph, and the floor that
 * covers it also covers other faces; the shape is deleted and re-emitted as the
 * faces it covered MINUS this one. Every piece written back is a traced face,
 * so every edge is a wall by construction.
 *
 * @param {Scene} scene
 * @param {{x: number, y: number}} point - canvas coordinates
 * @returns {Promise<number>} pieces removed
 */
/**
 * Faces to erase against, derived the SAME way the floors were.
 *
 * `traceRoomFaces` tries the walls exactly as drawn and only bridges loose ends
 * when that leaves cells bare. The eraser used to bridge unconditionally, which
 * builds a DIFFERENT face graph than the one the floor shapes came from — on a
 * map that traced cleanly, the click then landed in no face at all.
 */
function facesForErase(walls, size) {
	const build = bridge => traceWallFaces(walls, 4, bridge)
		.map(points => ({ points, area: polygonArea(points) }))
		.filter(face => face.area > 0);
	const plain = build(0);
	return plain.length > 0 ? plain : build(size / 2);
}

export async function bucketEraseAt(scene, point) {
	if (!game.user.isGM) {
		ui.notifications.warn("SDX | Erasing is GM-only.");
		return 0;
	}
	if (!scene) return 0;

	// The shape under the cursor IS the answer. A reskin emits one drawing per
	// traced room, so "erase here" is "drop what I clicked" — no geometry needed
	// for the common case. Looking at the floors FIRST is the point: the trace
	// used to run first and veto the whole operation.
	const hits = [];
	for (const drawing of scene.drawings) {
		if (!drawing.flags?.[MODULE_ID]?.dungeonFloorShape) continue;
		const polygon = floorPolygonOf(drawing);
		if (!polygon || !pointInPolygon(point, polygon)) continue;
		hits.push({ drawing, polygon, area: polygonArea(polygon) });
	}
	if (hits.length === 0) {
		ui.notifications.info("SDX | No SDX floor there.");
		return 0;
	}

	const size = scene.grid?.size || GRID_SIZE;
	const faces = facesForErase([...scene.walls], size);
	const room = faces
		.filter(face => pointInPolygon(point, face.points))
		.sort((a, b) => a.area - b.area)[0];

	// Tracing REFINES the erase, it never gates it. With no face we still clear
	// something — one grid square, cut out — because "nothing happened" is the
	// failure a GM cannot work around, while a single square is one more click.
	if (!room) {
		return eraseFloorRegion(scene, {
			minX: point.x - size / 2,
			maxX: point.x + size / 2,
			minY: point.y - size / 2,
			maxY: point.y + size / 2,
		});
	}

	const removedIds = [];
	const keptPieces = [];
	for (const hit of hits) {
		removedIds.push(hit.drawing.id);

		// The shape is the room already: delete it whole rather than rebuilding
		// an identical polygon. Only a shape spanning SEVERAL rooms — a painted
		// corridor network with no internal doors — needs cutting apart.
		if (hit.area <= room.area * 1.1) continue;

		const source = hit.drawing.toObject();
		for (const face of faces) {
			if (face === room) continue;
			if (face.area > hit.area) continue;
			let cx = 0;
			let cy = 0;
			for (const q of face.points) {
				cx += q.x / face.points.length;
				cy += q.y / face.points.length;
			}
			const centre = { x: cx, y: cy };
			if (!pointInPolygon(centre, hit.polygon)) continue;
			if (pointInPolygon(centre, room.points)) continue;

			let fx = Infinity;
			let fy = Infinity;
			for (const q of face.points) {
				if (q.x < fx) fx = q.x;
				if (q.y < fy) fy = q.y;
			}
			keptPieces.push({
				...source,
				_id: undefined,
				x: fx,
				y: fy,
				shape: {
					...source.shape,
					type: "p",
					points: face.points.flatMap(q => [q.x - fx, q.y - fy]),
				},
			});
		}
	}

	recordDungeonAction("Erase area", {
		deleted: [{ type: "Drawing", data: removedIds.map(id => scene.drawings.get(id).toObject()) }],
	});

	await scene.deleteEmbeddedDocuments("Drawing", removedIds);
	if (keptPieces.length > 0) {
		const restored = await scene.createEmbeddedDocuments("Drawing", keptPieces);
		recordDungeonAction("Erase area", {
			created: [{ type: "Drawing", ids: restored.map(d => d.id) }],
		});
	}

	ui.notifications.info("SDX | Cleared that walled area.");
	return removedIds.length;
}
