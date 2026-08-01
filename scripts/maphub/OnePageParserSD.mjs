const WALL_OFFSET = 0.25;

class MatrixMap {
    // for fast checking
    matrix;
    // for fast iterating
    list;

    constructor() {
        this.matrix = {};
        this.list = [];
    }

    get(x, y) {
        return this.matrix[x] && this.matrix[x][y];
    }

    put(x, y) {
        if (!this.matrix[x]) {
            this.matrix[x] = {};
        }
        this.matrix[x][y] = true;
        this.list.push([x, y]);
    }

    addRect(rect) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
            for (let y = rect.y; y < rect.y + rect.h; y++) {
                this.put(x, y);
            }
        }
    }

    getWalls() {
        let walls = [];
        this.list.forEach(p => {
            let x = p[0];
            let y = p[1];

            if (!this.get(x, y-1)) {
                walls.push([x, y, x+1, y]);
            }

            if (!this.get(x, y+1)) {
                walls.push([x, y+1, x+1, y+1]);
            }

            if (!this.get(x-1, y)) {
                walls.push([x, y, x, y+1]);
            }

            if (!this.get(x+1, y)) {
                walls.push([x+1, y, x+1, y+1]);
            }
        });
        return walls;
    }

    getProcessedWalls() {
        let walls = this.getWalls();
        let keys = [[], []];
        let sorting = [{}, {}];
        walls.forEach(w => {
            if (w[1] == w[3]) {
                if (!sorting[0][w[1]]) {
                    sorting[0][w[1]] = [];
                    keys[0].push(w[1]);
                }
                sorting[0][w[1]].push(w);
            } else {
                if (!sorting[1][w[0]]) {
                    sorting[1][w[0]] = [];
                    keys[1].push(w[0]);
                }
                sorting[1][w[0]].push(w);
            }
        });

        let result = [];

        // Do for both x and y. For y, shift indexing points by 1
        for (let i = 0; i < 2; i++) {
            keys[i].forEach(k => {
                // Sort heap by starting time
                let heap = sorting[i][k];
                heap.sort((a, b) => a[i] > b[i] ? 1 : -1);
                // Add first element to the stack
                let stack = [];
                stack.push(heap[0]);
                heap.forEach(wall => {
                    if (wall[i] > stack[stack.length - 1][i+2]) {
                        // new wall starts after current segment ends, so push to stack
                        stack.push(wall);
                    } else if (stack[stack.length - 1][i+2] < wall[i+2]) {
                        // new wall is longer than current segment, so lengthen wall
                        stack[stack.length - 1][i+2] = wall[i+2];
                    } else {
                        // else wall is contained inside current segment
                    }
                });
                stack.forEach(wall => result.push(wall));
            });
        }

        // For every wall coordinate, offset it into the open space (away from the filled tiles)
        result.forEach((wall, index, list) => {
            for (let p = 0; p < 2; p++) {
                let x = wall[2 * p];
                let y = wall[2 * p + 1];

                // get grid:
                let subgrid = [[false, false], [false, false]];
                let parity = 0;
                for (let i = 0; i < 2; i++) {
                    for (let j = 0; j < 2; j++) {
                        subgrid[i][j] = this.get(x-1 + i, y-1 + j);
                        if (subgrid[i][j]) {
                            parity += 1;
                        }
                    }
                }
                // if outside corner case, switch to equivalent inside corner case
                if (parity == 1) {
                    subgrid = [
                        [!subgrid[1][1], !subgrid[1][0]],
                        [!subgrid[0][1], !subgrid[0][0]],
                    ]
                }

                // find the inside corner to shift the wall toward
                let inside_corner = [];
                for (let i = 0; i < 2; i++) {
                    for (let j = 0; j < 2; j++) {
                        if (!subgrid[i][j]) {
                            inside_corner = [i, j];
                        }
                    }
                }

                result[index][2 * p] = x + (inside_corner[0] == 0 ? -WALL_OFFSET : WALL_OFFSET);
                result[index][2 * p + 1] = y + (inside_corner[1] == 0 ? -WALL_OFFSET : WALL_OFFSET);
            }
        });

        return result;
    }
}

// DOOR TYPES
const DOOR_TYPE_EMPTY = 0;
const DOOR_TYPE_SINGLE_DOOR = 1;
const DOOR_TYPE_OPENING = 2;
const DOOR_TYPE_STAIR_ENTRANCE = 3;
const DOOR_TYPE_BARS = 4;
const DOOR_TYPE_DOUBLE_DOOR = 5;
const DOOR_TYPE_SECRET_WALL = 6;
const DOOR_TYPE_FLUSH_DOOR = 7;
const DOOR_TYPE_STAIR_EXIT = 8;

// Helper function that converts a JSON door input to a wall (in map grid coordinates)
function doorToWall(door) {
    let result = {};
    result["c"] = [door["x"] - 0.75 * door["dir"]["y"], door["y"] - 0.75 * door["dir"]["x"], door["x"] + 0.75 * door["dir"]["y"], door["y"] + 0.75 * door["dir"]["x"]];
    result["c"] = result["c"].map(p => p + 0.5);
    if (door["type"] == DOOR_TYPE_SECRET_WALL ||
        door["type"] == DOOR_TYPE_FLUSH_DOOR) {
        result["c"] = [result["c"][0] - WALL_OFFSET * door["dir"]["x"],
                       result["c"][1] - WALL_OFFSET * door["dir"]["y"],
                       result["c"][2] - WALL_OFFSET * door["dir"]["x"],
                       result["c"][3] - WALL_OFFSET * door["dir"]["y"]];
    }
    result["door"] =  CONST.WALL_DOOR_TYPES.DOOR;
    if (door["type"] == DOOR_TYPE_SECRET_WALL) {
        result["door"] =  CONST.WALL_DOOR_TYPES.SECRET;
    }
    if (door["type"] == DOOR_TYPE_BARS) {
        result["sense"] = CONST.WALL_SENSE_TYPES.NONE;
        result["ds"] = CONST.WALL_DOOR_STATES.LOCKED;
    }
    if (door["type"] == DOOR_TYPE_DOUBLE_DOOR) {
        result["ds"] = CONST.WALL_DOOR_STATES.LOCKED;
    }
    if (door["type"] == DOOR_TYPE_EMPTY ||
        door["type"] == DOOR_TYPE_OPENING ||
        door["type"] == DOOR_TYPE_STAIR_ENTRANCE ||
        door["type"] == DOOR_TYPE_STAIR_EXIT) {
        result["remove"] = true;
    }
    return result;
}

export class OnePageParserSD {
    /**
     * Parses Watabou's One Page Dungeon JSON object and creates wall/door/note data
     * suitable for a FoundryVTT Scene.
     * @param {Object} info - The parsed JSON data from One Page Dungeon.
     * @param {number} g - Grid size.
     * @returns {Object} An object containing arrays of wallData and noteData.
     */
    static parseDungeonData(info, g = 50, opts = {}) {
        // When `gridSpace` is set, geometry is returned in the dungeon's native
        // grid coordinate system (the same units as info.rects), with NO scaling
        // and NO top-left normalization. The caller is then responsible for
        // mapping grid → pixels (e.g. via the generator's render transform) so
        // the walls land exactly where the map is drawn in the captured image.
        const gridSpace = !!opts.gridSpace;

        const wrap = (s, w) => String(s ?? "").replace(
            new RegExp(`(?![^\\n]{1,${w}}$)([^\\n]{1,${w}})\\s`, 'g'), '$1\n'
        );

        let map = new MatrixMap();

        if (info.rects) {
            info.rects.forEach(r => map.addRect(r));
        }

        // Build walls (from filled cells) and doors in grid units first.
        let wallsGrid = [];
        if (info.rects) {
            wallsGrid = map.getProcessedWalls().map(m => ({ c: m.slice() }));
        }
        // Gets rid of doors that aren't associated with walls
        let doorsGrid = (info.doors || []).map(d => doorToWall(d)).filter(d => !d.remove);

        if (gridSpace) {
            const walls = wallsGrid.concat(doorsGrid).map(w => ({ ...w, c: w.c.slice() }));
            const notes = (info.notes || []).map(d => ({
                x: d.pos.x,
                y: d.pos.y,
                text: wrap(d.text, 24),
                iconTint: "#FF0010",
                textColor: "#FF0010"
            }));
            return { walls, notes };
        }

        // ── Legacy path: scale by `g` and normalize to the top-left corner ──
        let walls = wallsGrid.map(w => ({ c: w.c.map(v => v * g) }));
        // doors can spawn on the border of the map, so we need extra logic to find final offsets
        let doors = doorsGrid.map(d => {
            d["c"] = d["c"].map(v => v * g);
            return d;
        });

        // Creates all the walls
        walls = walls.concat(doors);

        let minvals = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
        walls.forEach(w => {
            minvals[0] = Math.min(minvals[0], w.c[0], w.c[2]);
            minvals[1] = Math.min(minvals[1], w.c[1], w.c[3]);
        });

        if (minvals[0] === Number.MAX_SAFE_INTEGER) minvals = [0, 0];

        // Find the effective top left corner coordinate of the map
        let min_tile = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
        let min_tile_pos = [ [], [] ];

        if (info.rects) {
            info.rects.forEach(r => {
                if (r.x < min_tile[0]) {
                    min_tile[0] = Math.min(min_tile[0], r.x);
                    min_tile_pos[0] = [r.y];
                } else if (r.x == min_tile[0]) {
                    min_tile_pos[0].push(r.y);
                }

                if (r.y < min_tile[1]) {
                    min_tile[1] = r.y;
                    min_tile_pos[1] = [r.x];
                } else if (r.y == min_tile[1]) {
                    min_tile_pos[1].push(r.x);
                }
            });
        }

        let x_edge_has_tile = true;
        min_tile_pos[0].forEach(r => {
            let matches = (info.doors || []).filter(d => (d.x == min_tile[0] && d.y == r));
            if (matches.length == 0) x_edge_has_tile = false;
        });

        let y_edge_has_tile = true;
        min_tile_pos[1].forEach(r => {
            let matches = (info.doors || []).filter(d => (d.x == r && d.y == min_tile[1]));
            if (matches.length == 0) y_edge_has_tile = false;
        });

        let x_offset = (x_edge_has_tile) ? -0.25 * g : 0.75 * g ;
        let y_offset = (y_edge_has_tile) ? -0.25 * g : 0.75 * g ;

        const wallData = walls.map(w => {
            w.c = [
                w.c[0] - minvals[0] + x_offset,
                w.c[1] - minvals[1] + y_offset,
                w.c[2] - minvals[0] + x_offset,
                w.c[3] - minvals[1] + y_offset
            ];
            return w;
        });

        const noteData = (info.notes || []).map(d => {
            const txt = wrap(d.text, 24);
            return {
                x: d.pos.x * g - minvals[0] + x_offset,
                y: d.pos.y * g - minvals[1] + y_offset,
                text: txt,
                iconTint: "#FF0010",
                textColor: "#FF0010"
            };
        });

        return { walls: wallData, notes: noteData };
    }
}
