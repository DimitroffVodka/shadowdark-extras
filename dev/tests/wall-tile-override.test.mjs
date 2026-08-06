// Regression pin for issue #93: `rebuildWallsForLevel` used to override the
// module-level `_selectedWallTile` for the whole rebuild window so the wall
// visual generators would render with a caller-supplied tile. Every other
// reader of the selection (`getSelectedWallTile`, the tray's data feed) saw
// the rebuild's tile instead of the user's for the duration of the rebuild.
//
// The fix threads the tile as an argument instead of mutating the selection:
// `generateWallVisualsWithElevation` now takes an explicit `wallTilePath`,
// defaulting to the current selection so existing callers behave identically.
// These tests pin both halves of that contract headlessly:
//
//   1. an explicit `wallTilePath` wins over the current selection, and
//   2. omitting it falls back to the current selection.
//
// `generateWallVisualsWithElevation` is pure geometry plus `game.user.id`, so
// the pixi-harness globals are enough — no scene or canvas graph is needed.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals, installDom } from "./helpers/pixi-harness.mjs";

installCanvasGlobals();
installDom();

// Foundry globals these modules read at import time or in module-scope code.
// Same shape as split-module-load.test.mjs, which proves DungeonPainterSD
// loads under exactly these.
globalThis.game.scenes = { get: () => null };
globalThis.game.settings = { get: () => undefined, set: async () => {}, register() {}, registerMenu() {} };
globalThis.game.i18n = { localize: key => key };
globalThis.canvas.grid = { size: 100, isHexagonal: false };
globalThis.CONST = { GRID_TYPES: { SQUARE: 1 }, DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
globalThis.foundry.applications = {
	api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base, DialogV2: class {} },
	apps: { FilePicker: class {} },
	ux: { TextEditor: {} },
};
globalThis.foundry.canvas = { layers: { CanvasLayer: class {} } };
// DungeonPainterSD registers a setting inside Hooks.once("init") at module scope.
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };

const painter = await import("../../scripts/dungeon/DungeonPainterSD.mjs");
const toolState = await import("../../scripts/dungeon/dungeon-tool-state.mjs");

const FLOOR = new Set(["0,0"]);
const NO_ENTRANCES = new Set();
const GRID_SIZE = 100;
const WALL_THICKNESS = 20;

function wallVisuals(wallTilePath) {
	return painter.generateWallVisualsWithElevation(
		FLOOR, NO_ENTRANCES, GRID_SIZE, WALL_THICKNESS, 0, 10, wallTilePath,
	);
}

test("an explicit wallTilePath wins over the current selection", async () => {
	const original = toolState.getSelectedWallTile();
	try {
		toolState.selectWallTile("user-choice.webp");

		const drawings = wallVisuals("rebuild-choice.webp");

		assert.ok(drawings.length > 0, "expected wall visual drawings for a floor cell");
		for (const drawing of drawings) {
			assert.equal(
				drawing.texture, "rebuild-choice.webp",
				"explicit wallTilePath must be used, not the module-level selection",
			);
		}
	}
	finally {
		toolState.selectWallTile(original);
	}
});

test("omitting wallTilePath falls back to the current selection", async () => {
	const original = toolState.getSelectedWallTile();
	try {
		toolState.selectWallTile("default-choice.webp");

		const drawings = wallVisuals(undefined);

		assert.ok(drawings.length > 0, "expected wall visual drawings for a floor cell");
		for (const drawing of drawings) {
			assert.equal(
				drawing.texture, "default-choice.webp",
				"omitted wallTilePath must default to the current selection",
			);
		}
	}
	finally {
		toolState.selectWallTile(original);
	}
});
