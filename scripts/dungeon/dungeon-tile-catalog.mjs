// Tile catalogue state for the dungeon tools — the leaf that the rest of the
// DungeonPainterSD.mjs split can import without a cycle.
// Extracted verbatim from scripts/dungeon/DungeonPainterSD.mjs (Phase 5.3
// sweep 6 split).
//
// Imports nothing by design: the painter and its callers import these names
// back under the same identifiers, and a leaf module is what keeps the
// extraction provable (read-only ESM bindings forbid cross-module assignment).
//
// The only writers are loadDungeonAssets and reloadDungeonAssets, which stay in
// the painter (they read _dungeonSocket and call isGMOnline). They write these
// bindings only through the pure setters below, mirroring how the tile
// selection state in dungeon-tool-state.mjs is written.

// State
export let _floorTiles = null;
export let _wallTiles = null;
export let _doorTiles = null;
export let _backgroundTiles = null;

/**
 * Set floor tiles
 */
export function setFloorTiles(tiles) {
	_floorTiles = tiles;
}

/**
 * Set wall tiles
 */
export function setWallTiles(tiles) {
	_wallTiles = tiles;
}

/**
 * Set door tiles
 */
export function setDoorTiles(tiles) {
	_doorTiles = tiles;
}

/**
 * Set background tiles
 */
export function setBackgroundTiles(tiles) {
	_backgroundTiles = tiles;
}
