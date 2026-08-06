// Tile-selection and display-tool state for the dungeon tools — the leaf that
// the rest of the DungeonPainterSD.mjs split can import without a cycle.
// Extracted verbatim from scripts/dungeon/DungeonPainterSD.mjs (Phase 5.3
// sweep 6 split).
//
// Imports nothing by design: the painter and its callers import these names
// back under the same identifiers, and a leaf module is what keeps the
// extraction provable (read-only ESM bindings forbid cross-module assignment).

// State
export let _selectedFloorTile = null;
export let _selectedWallTile = null;
export let _selectedDoorTile = null;
// "tiles", "intwalls", or "doors"
export let _dungeonMode = "tiles";
// Toggle to skip creating Foundry wall documents (but keep visuals)
export let _noFoundryWalls = false;
export let _wallShadows = false; // Toggle to apply TokenMagic dropshadow2 to wall drawings
export let _selectedIntWallTile = null; // Selected tile for interior wall placement
export let _selectedIntDoorTile = null; // Selected door tile for interior wall door cutting
export let _selectedBackground = "none";

/**
 * Set dungeon mode
 */
export function setDungeonMode(mode) {
	if (mode === "tiles" || mode === "doors" || mode === "intwalls") {
		_dungeonMode = mode;
	}
}

/**
 * Get current dungeon mode
 */
export function getDungeonMode() {
	return _dungeonMode;
}

/**
 * Select a floor tile
 */
export function selectFloorTile(tilePath) {
	_selectedFloorTile = tilePath;
}

/**
 * Select a wall tile
 */
export function selectWallTile(tilePath) {
	_selectedWallTile = tilePath;
}

/**
 * Select a door tile
 */
export function selectDoorTile(tilePath) {
	_selectedDoorTile = tilePath;
}

/**
 * Get selected floor tile path
 */
export function getSelectedFloorTile() {
	return _selectedFloorTile;
}

/**
 * Get selected wall tile path
 */
export function getSelectedWallTile() {
	return _selectedWallTile;
}

/**
 * Get selected door tile path
 */
export function getSelectedDoorTile() {
	return _selectedDoorTile;
}

/**
 * Set whether to skip creating Foundry walls (visuals only)
 */
export function setNoFoundryWalls(value) {
	_noFoundryWalls = !!value;
}

/**
 * Get whether Foundry walls are disabled
 */
export function getNoFoundryWalls() {
	return _noFoundryWalls;
}

/**
 * Set whether to apply wall shadows (TokenMagic dropshadow2) to wall drawings
 */
export function setWallShadows(value) {
	_wallShadows = !!value;
}

/**
 * Get whether wall shadows are enabled
 */
export function getWallShadows() {
	return _wallShadows;
}

/**
 * Select an interior wall tile
 */
export function selectIntWallTile(path) {
	_selectedIntWallTile = path || null;
}

/**
 * Get the selected interior wall tile path
 */
export function getSelectedIntWallTile() {
	return _selectedIntWallTile;
}

/**
 * Select a door tile for interior wall door cutting
 */
export function selectIntDoorTile(path) {
	_selectedIntDoorTile = path || null;
}

/**
 * Get the selected interior door tile path
 */
export function getSelectedIntDoorTile() {
	return _selectedIntDoorTile;
}

/**
 * Set dungeon background selection
 */
export function setDungeonBackground(value) {
	_selectedBackground = value;
}

/**
 * Get dungeon background selection
 */
export function getDungeonBackground() {
	return _selectedBackground;
}
