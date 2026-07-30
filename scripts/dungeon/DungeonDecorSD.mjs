const MODULE_ID = "shadowdark-extras";
const DEFAULT_GRID_SIZE = 100;
const SCONCE_TILE = `modules/${MODULE_ID}/assets/Dungeon/decor/wall-sconce.svg`;

const DOOR_AVOID_CELLS = 1.5;
const LIGHT_SPACING_CELLS = 3.5;
const OCCUPY_RADIUS_CELLS = 2.5;
const CORNER_PADDING_CELLS = 1;

const DIR = {
    0: "N",
    1: "S",
    2: "E",
    3: "W",
    NORTH: "N",
    SOUTH: "S",
    EAST: "E",
    WEST: "W",
    N: "N",
    S: "S",
    E: "E",
    W: "W",
};

function clampInt(value, min, max) {
    const n = Math.round(Number(value) || 0);
    return Math.max(min, Math.min(max, n));
}

function distanceCells(a, b) {
    return Math.hypot(a.gx - b.gx, a.gy - b.gy);
}

function roomMetrics(room) {
    const w = Number(room?.w ?? room?.width ?? ((room?.right ?? 0) - (room?.left ?? 0)));
    const h = Number(room?.h ?? room?.height ?? ((room?.bottom ?? 0) - (room?.top ?? 0)));
    const left = Number(room?.left ?? room?.x ?? 0);
    const top = Number(room?.top ?? room?.y ?? 0);
    return {
        left,
        top,
        right: Number(room?.right ?? (left + w)),
        bottom: Number(room?.bottom ?? (top + h)),
        w,
        h,
    };
}

function isDecorRoom(room) {
    const r = roomMetrics(room);
    if (r.w < 4 || r.h < 4) return false;
    if (r.w * r.h < 16) return false;
    return Math.min(r.w, r.h) >= 3;
}

function doorCenter(door) {
    const dir = DIR[door?.dir] ?? DIR[String(door?.dir ?? "").toUpperCase()] ?? null;
    const x = Number(door?.x ?? 0);
    const y = Number(door?.y ?? 0);
    if (dir === "N" || dir === "S") return { gx: x + 0.5, gy: y + 0.5 };
    if (dir === "E" || dir === "W") return { gx: x + 0.5, gy: y + 0.5 };
    return { gx: x + 0.5, gy: y + 0.5 };
}

function shuffle(values, rng) {
    const out = [...values];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function buildWallLightCandidates(room, doors) {
    const r = roomMetrics(room);
    const candidates = [];
    const minX = Math.ceil(r.left + CORNER_PADDING_CELLS);
    const maxX = Math.floor(r.right - CORNER_PADDING_CELLS - 1);
    const minY = Math.ceil(r.top + CORNER_PADDING_CELLS);
    const maxY = Math.floor(r.bottom - CORNER_PADDING_CELLS - 1);

    for (let gx = minX; gx <= maxX; gx++) {
        candidates.push({ gx: gx + 0.5, gy: r.top + 0.25, wall: "N" });
        candidates.push({ gx: gx + 0.5, gy: r.bottom - 0.25, wall: "S" });
    }
    for (let gy = minY; gy <= maxY; gy++) {
        candidates.push({ gx: r.left + 0.25, gy: gy + 0.5, wall: "W" });
        candidates.push({ gx: r.right - 0.25, gy: gy + 0.5, wall: "E" });
    }

    return candidates.filter(point => !isNearDoor(point, doors));
}

function isNearDoor(point, doors, padding = 0) {
    return doors.some(door => distanceCells(point, door) < DOOR_AVOID_CELLS + padding);
}

function pointToRectDistance(point, rect) {
    const minX = rect.gx;
    const maxX = rect.gx + rect.cellsW;
    const minY = rect.gy;
    const maxY = rect.gy + rect.cellsH;
    const dx = point.gx < minX ? minX - point.gx : point.gx > maxX ? point.gx - maxX : 0;
    const dy = point.gy < minY ? minY - point.gy : point.gy > maxY ? point.gy - maxY : 0;
    return Math.hypot(dx, dy);
}

function rectsOverlap(a, b, padding = 0) {
    return !(
        a.gx + a.cellsW + padding <= b.gx ||
        b.gx + b.cellsW + padding <= a.gx ||
        a.gy + a.cellsH + padding <= b.gy ||
        b.gy + b.cellsH + padding <= a.gy
    );
}

function normalizeRect(rect) {
    return {
        gx: Number(rect?.gx ?? 0),
        gy: Number(rect?.gy ?? 0),
        cellsW: Math.max(1, Number(rect?.cellsW ?? rect?.w ?? 1)),
        cellsH: Math.max(1, Number(rect?.cellsH ?? rect?.h ?? 1)),
    };
}

export function createDungeonOccupancy(layout, { doorAvoidanceCells = DOOR_AVOID_CELLS } = {}) {
    const doors = (layout?.doorPositions ?? []).map(doorCenter);
    const occupied = [];

    const isDoorClearPoint = (point, padding = 0) =>
        !doors.some(door => distanceCells(point, door) < doorAvoidanceCells + padding);

    const isDoorClearRect = (rect, padding = 0) =>
        !doors.some(door => pointToRectDistance(door, rect) < doorAvoidanceCells + padding);

    const canPlacePoint = (point, { radius = 0.5, doorPadding = 0 } = {}) => {
        if (!isDoorClearPoint(point, doorPadding)) return false;
        return !occupied.some(entry => {
            if (entry.type === "rect") return pointToRectDistance(point, entry) < radius + (entry.radius ?? 0);
            return distanceCells(point, entry) < radius + (entry.radius ?? 0);
        });
    };

    const occupyPoint = (point, { radius = 0.5, kind = "point" } = {}) => {
        occupied.push({ type: "point", kind, gx: Number(point.gx), gy: Number(point.gy), radius });
    };

    const canPlaceRect = (rectInput, { padding = 0, doorPadding = 0 } = {}) => {
        const rect = normalizeRect(rectInput);
        if (!isDoorClearRect(rect, doorPadding)) return false;
        return !occupied.some(entry => {
            if (entry.type === "rect") return rectsOverlap(rect, entry, padding + (entry.padding ?? 0));
            return pointToRectDistance(entry, rect) < (entry.radius ?? 0) + padding;
        });
    };

    const occupyRect = (rectInput, { padding = 0, kind = "rect" } = {}) => {
        occupied.push({ type: "rect", kind, padding, radius: padding, ...normalizeRect(rectInput) });
    };

    return {
        doors,
        occupied,
        canPlacePoint,
        occupyPoint,
        canPlaceRect,
        occupyRect,
    };
}

function lightDoc(point, offset, gridSize) {
    return {
        x: (point.gx + offset.x) * gridSize,
        y: (point.gy + offset.y) * gridSize,
        rotation: 0,
        walls: true,
        vision: false,
        hidden: false,
        config: {
            alpha: 0.45,
            angle: 360,
            bright: 8,
            color: "#f0b35a",
            coloration: 1,
            dim: 18,
            luminosity: 0.5,
            saturation: 0,
            contrast: 0,
            shadows: 0,
            animation: {
                type: "torch",
                speed: 2,
                intensity: 3,
                reverse: false,
            },
        },
        flags: {
            [MODULE_ID]: {
                dungeonDecor: true,
                dungeonDecorLight: true,
                decorKind: "wall-sconce",
            },
        },
    };
}

function sconceTileDoc(point, offset, gridSize) {
    const size = Math.round(gridSize * 0.42);
    return {
        texture: { src: SCONCE_TILE, anchorX: 0.5, anchorY: 0.5 },
        x: (point.gx + offset.x) * gridSize - size / 2,
        y: (point.gy + offset.y) * gridSize - size / 2,
        width: size,
        height: size,
        sort: 3,
        rotation: point.wall === "S" ? 180 : point.wall === "E" ? 90 : point.wall === "W" ? 270 : 0,
        flags: {
            [MODULE_ID]: {
                dungeonClutter: true,
                dungeonDecor: true,
                dungeonDecorTile: true,
                decorKind: "wall-sconce",
            },
        },
    };
}

/**
 * Clean-room wall-light placement for generated dungeons.
 * The algorithm uses only SDX layout data: room bounds, door positions, RNG,
 * and the render offset. It intentionally does not depend on external module code.
 */
export async function generateDungeonDecor({
    layout,
    rng = Math.random,
    offset = { x: 0, y: 0 },
    gridSize = DEFAULT_GRID_SIZE,
    createDocuments,
    lightsPerRoom = 0,
    occupancy = null,
    includeTiles = false,
} = {}) {
    const perRoom = clampInt(lightsPerRoom, 0, 4);
    if (!perRoom || !layout?.roomData?.length || typeof createDocuments !== "function") {
        return { lights: [] };
    }

    const placement = occupancy ?? createDungeonOccupancy(layout);
    const doors = placement.doors ?? (layout.doorPositions ?? []).map(doorCenter);
    const docs = [];
    const tileDocs = [];
    const placed = [];
    // Only mount sconces on cells that are actually floor — keeps lights off
    // eroded cave/mixed edges where a room rect no longer matches real floor.
    const floors = layout?.floors instanceof Set ? layout.floors : null;

    for (const rd of layout.roomData) {
        if (rd?.isStart || !isDecorRoom(rd?.room)) continue;
        const candidates = shuffle(buildWallLightCandidates(rd.room, doors), rng);
        const targetCount = Math.min(perRoom, Math.max(1, Math.floor(candidates.length / LIGHT_SPACING_CELLS)));
        let accepted = 0;

        for (const point of candidates) {
            if (floors && !floors.has(`${Math.floor(point.gx)},${Math.floor(point.gy)}`)) continue;
            if (!placement.canPlacePoint(point, { radius: OCCUPY_RADIUS_CELLS })) continue;
            if (isNearDoor(point, doors)) continue;
            placement.occupyPoint(point, { radius: OCCUPY_RADIUS_CELLS, kind: "wall-sconce" });
            placed.push(point);
            docs.push(lightDoc(point, offset, gridSize));
            if (includeTiles) tileDocs.push(sconceTileDoc(point, offset, gridSize));
            accepted++;
            if (accepted >= targetCount) break;
        }
    }

    if (docs.length) await createDocuments("AmbientLight", docs);
    if (tileDocs.length) await createDocuments("Tile", tileDocs);
    return { lights: placed, tiles: tileDocs.length };
}
