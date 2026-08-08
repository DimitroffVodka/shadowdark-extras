// POI placement undo/redo history for the hex tools — the leaf that the rest
// of the HexPainterSD.mjs split can import without a cycle.
// Extracted verbatim from scripts/hex/HexPainterSD.mjs (Phase 5.3 sweep 6
// split).
//
// Imports nothing by design: the painter and its callers import these names
// back under the same identifiers, and a leaf module is what keeps the
// extraction provable (read-only ESM bindings forbid cross-module assignment).
//
// The POI preview cluster (createPreview, the transform helpers, the scale and
// rotation state) could NOT come with this. All of it funnels through
// _getAvailablePoiTiles, which reads _activeTileTab, _chosenTiles, _symbolTiles
// and four decor bindings that are still in the painter. It moves once those
// have their own leaves.

const MODULE_ID = "shadowdark-extras";

// State
export let _poiUndoStack = [];          // Stack of placed POI tile IDs and data
export let _poiRedoStack = [];          // Stack of tile data for redo

/**
 * Check if undo is available
 */
export function canUndoPoi() {
	return _poiUndoStack.length > 0;
}

/**
 * Check if redo is available
 */
export function canRedoPoi() {
	return _poiRedoStack.length > 0;
}

/**
 * Clear POI history (both stacks)
 */
export function clearPoiHistory() {
	_poiUndoStack = [];
	_poiRedoStack = [];
}

/**
 * Clear the POI redo stack, leaving the undo stack alone
 */
export function clearPoiRedoStack() {
	_poiRedoStack = [];
}

/**
 * Undo the last POI tile placement
 */
export async function undoLastPoi() {
	if (_poiUndoStack.length === 0) return false;

	const lastEntry = _poiUndoStack.pop();
	if (!lastEntry) return false;

	// Find and delete the tile
	const tile = canvas.tiles.get(lastEntry.id);
	if (tile) {
		// Store the full tile data for redo
		const tileData = tile.document.toObject();
		_poiRedoStack.push(tileData);

		// Delete the tile
		await canvas.scene.deleteEmbeddedDocuments("Tile", [lastEntry.id]);
		return true;
	}

	return false;
}

/**
 * Redo the last undone POI tile
 */
export async function redoLastPoi() {
	if (_poiRedoStack.length === 0) return false;

	const tileData = _poiRedoStack.pop();
	if (!tileData) return false;

	// Recreate the tile
	try {
		const created = await canvas.scene.createEmbeddedDocuments("Tile", [tileData]);
		if (created && created.length > 0) {
			// Add to undo stack
			_poiUndoStack.push({ id: created[0].id });
			return true;
		}
	}
	catch(err) {
		console.error(`${MODULE_ID} | Failed to redo POI tile:`, err);
	}

	return false;
}
