// Regression test for issue #96: `getCurrentElevation` silently returned its
// default (`0`) whenever the Levels module was active, because a probe it
// reached under that branch read an unbound identifier.
//
// The dead probe was:
//
//   // Try getting from Levels' internal state
//   if (typeof _levels?.currentElevation === "number") {
//       return _levels.currentElevation;
//   }
//
// `_levels` was never declared anywhere. `typeof` does not guard a member
// expression, so `typeof _levels?.currentElevation` throws a ReferenceError on
// the base identifier. That sat inside the function's `try`, so the throw was
// swallowed by the catch and the function returned 0 — skipping the twelve
// probes after it (scene flags, the `levels.currentFloor` setting, the Layer
// Tool window, controlled-tile elevation, wall-height, levels-3d-preview)
// whenever Levels was active.
//
// The installed Levels module (v7.0.3) exposes `CONFIG.Levels = { handlers,
// helpers }` — no `_levels` global, no `currentElevation` at all — so the stub
// below is the real world's shape, not a synthetic fixture. The scenario it
// pins is "Levels is active, exposes none of the globals the function probes,
// and the scene flags carry the answer": the function must fall through past
// the Levels block instead of aborting the chain.
//
// `getCurrentElevation` reads game/CONFIG/ui/canvas at call time, and
// dungeon-level-context.mjs imports nothing, so a handful of plain-object
// globals — the same style as the rest of the headless suite — is all the stub
// this needs.

import assert from "node:assert/strict";
import test from "node:test";

const { getCurrentElevation } = await import("../../scripts/dungeon/dungeon-level-context.mjs");

/**
 * Run with Levels installed+active and every Levels global the function probes
 * present-but-empty, so only the fallback chain can produce an answer.
 */
function withLevelsActive(scene, run) {
	const previous = {
		game: globalThis.game,
		CONFIG: globalThis.CONFIG,
		ui: globalThis.ui,
		canvas: globalThis.canvas,
	};

	// Levels v7.0.3's real shape: CONFIG.Levels without currentElevation or a
	// UI.currentRange, no `_levels` global, no layer-tool app reporting a floor.
	globalThis.game = {
		modules: { get: id => (id === "levels" ? { active: true } : null) },
		settings: { get: () => undefined },
	};
	globalThis.CONFIG = { Levels: { handlers: {}, helpers: {} } };
	globalThis.ui = { levels: null, windows: {} };
	globalThis.canvas = {
		level: null, // no native v14 collection — Levels is the elevation source
		scene,
		tiles: { controlled: [] },
	};

	try {
		return run();
	}
	finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete globalThis[key];
			else globalThis[key] = value;
		}
	}
}

test("getCurrentElevation falls through past the Levels block to the scene flags", () => {
	// Before the fix this returned 0: the unbound `_levels` probe threw, the
	// catch swallowed it, and the scene-flags read never ran.
	withLevelsActive(
		{ flags: { levels: { currentElevation: 42 } } },
		() => {
			assert.equal(getCurrentElevation(), 42);
		},
	);
});

test("getCurrentElevation returns 0 when Levels is active but no probe holds an elevation", () => {
	// The end-of-chain behaviour a real Levels-active world without any probe
	// hit sees: 0, and no throw escaping the function's catch.
	withLevelsActive(
		{ flags: {} },
		() => {
			assert.equal(getCurrentElevation(), 0);
		},
	);
});
