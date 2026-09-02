// Freehand stroke tracking for the floor eraser.
//
// A dragged box assumes rooms are rectangles. Measured on two real maps, the
// wall-bounded area a bucket would clear runs to 348 squares on a cave map —
// far larger than "this bit" — so neither a box nor a bucket gives fine
// control. A brush does: the squares erased are the squares the cursor went
// over.
//
// Lives outside DungeonPainterSD.mjs because that file sits at the repo's
// 2000-line split threshold, which dev/tests/phase5-metrics.test.mjs enforces.

const GRID_SIZE = 100;

let _cells = new Set();
let _last = null;

/** Begin a stroke at a canvas point. */
export function beginBrushStroke(point, gridSize = GRID_SIZE) {
	_cells = new Set();
	_last = null;
	extendBrushStroke(point, gridSize);
}

/**
 * Extend the stroke to a canvas point, filling in the squares between.
 *
 * Pointer events are far apart at speed, so sampling only where they land
 * leaves holes in a quick stroke. Stepping along the segment in half-square
 * increments closes them.
 */
export function extendBrushStroke(point, gridSize = GRID_SIZE) {
	const size = gridSize || GRID_SIZE;
	const from = _last ?? point;
	const distance = Math.hypot(point.x - from.x, point.y - from.y);
	const steps = Math.max(1, Math.ceil(distance / (size / 2)));
	for (let i = 0; i <= steps; i++) {
		const x = from.x + ((point.x - from.x) * (i / steps));
		const y = from.y + ((point.y - from.y) * (i / steps));
		_cells.add(`${Math.floor(x / size)},${Math.floor(y / size)}`);
	}
	_last = { x: point.x, y: point.y };
}

/** The squares swept so far. */
export function brushStrokeCells() {
	return _cells;
}

/** Drop the stroke, e.g. after it has been applied or on a scene change. */
export function clearBrushStroke() {
	_cells = new Set();
	_last = null;
}
