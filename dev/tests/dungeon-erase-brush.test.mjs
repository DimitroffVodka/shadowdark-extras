// A dragged box assumes rooms are rectangles, and on a cave map nothing is.
// Measured on two real maps, the wall-bounded area a bucket clears runs to 348
// squares — far larger than "this bit" — so neither box nor bucket gives fine
// control. The brush erases the squares the cursor actually went over.
//
// The property that matters is that a FAST stroke leaves no holes: pointer
// events are far apart at speed, and sampling only where they land would skip
// squares the user dragged straight through.

import assert from "node:assert/strict";
import test from "node:test";

import {
	beginBrushStroke,
	brushStrokeCells,
	clearBrushStroke,
	extendBrushStroke,
} from "../../scripts/dungeon/dungeon-erase-brush.mjs";

test("a stroke records the square it starts in", () => {
	beginBrushStroke({ x: 250, y: 250 }, 100);
	assert.deepEqual([...brushStrokeCells()], ["2,2"]);
});

test("a fast stroke fills in the squares it jumped over", () => {
	// Two events 500px apart. Sampling only the endpoints would record 2 squares
	// and leave a four-square hole through the middle of the drag.
	beginBrushStroke({ x: 50, y: 50 }, 100);
	extendBrushStroke({ x: 550, y: 50 }, 100);

	assert.deepEqual([...brushStrokeCells()].sort(),
		["0,0", "1,0", "2,0", "3,0", "4,0", "5,0"]);
});

test("a diagonal stroke records the squares it passes through", () => {
	beginBrushStroke({ x: 50, y: 50 }, 100);
	extendBrushStroke({ x: 350, y: 350 }, 100);

	const cells = brushStrokeCells();
	for (const key of ["0,0", "1,1", "2,2", "3,3"]) {
		assert.ok(cells.has(key), `expected ${key} in ${[...cells].join(" ")}`);
	}
});

test("the stroke honours the scene's grid size", () => {
	beginBrushStroke({ x: 250, y: 250 }, 50);
	assert.deepEqual([...brushStrokeCells()], ["5,5"]);
});

test("clearing drops the stroke so the next drag starts clean", () => {
	beginBrushStroke({ x: 50, y: 50 }, 100);
	clearBrushStroke();
	assert.equal(brushStrokeCells().size, 0);

	beginBrushStroke({ x: 950, y: 50 }, 100);
	assert.deepEqual([...brushStrokeCells()], ["9,0"], "no squares carried over");
});
