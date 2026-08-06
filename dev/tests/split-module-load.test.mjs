// Every module extracted by the Phase 5.3 splits must actually load, and its
// public names must actually resolve.
//
// WHY THIS EXISTS. Two bugs this sweep were caught by luck, not coverage:
//
//   1. `getHexPainterData` read `_poiRedoStack` while the import block named
//      only `_poiUndoStack`. A ReferenceError on opening the tray. All four
//      gates were green — prove-move compares declaration trees, the snapshots
//      compare names, eslint has `no-undef` off for scripts/, and no test
//      executed the file.
//
//   2. `hex-custom-tiles.mjs` imported `_formatLabel` from `hex-decor.mjs` at
//      the same moment another branch hoisted it into `hex-tile-labels.mjs`.
//      The merged tree threw `SyntaxError: does not provide an export named
//      '_formatLabel'` — a semantic conflict spanning two files that git cannot
//      see and no gate checks.
//
// The second was caught only because `tray-app-bindings.test.mjs` happens to
// import the hex module graph — it was the ONLY test in the suite that did.
// That is too thin a thread for a sweep that has moved 69 declarations across
// eight modules.
//
// A module-level `import` is the cheapest possible check and catches both
// shapes: an unresolvable specifier, a missing named export, and any
// module-scope code that throws on evaluation. It does not catch an unbound
// identifier inside a function body — the widened binding gate covers that.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals, installDom } from "./helpers/pixi-harness.mjs";

installCanvasGlobals();
installDom();

// Foundry globals these modules read at import time or in an accessor the
// smoke test touches. Deliberately minimal: this asserts the modules LOAD, not
// that they work — behaviour is covered by the persistence freeze and the
// Quench batches.
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

/**
 * The modules the Phase 5.3 splits created, with the names each must export.
 *
 * Names are the ones OTHER modules import — the ones whose loss breaks a
 * caller. A module can export more; this asserts the contract, not the surface.
 */
const EXTRACTED = [
	["../../scripts/dungeon/dungeon-level-context.mjs", [
		"getSceneLevelContext", "getDocumentLevelId", "applySceneLevelData", "getCurrentElevation",
	]],
	["../../scripts/dungeon/dungeon-selection-overlay.mjs", [
		"createSelectionRect", "updateSelectionRect", "clearSelectionRect", "destroySelectionRect",
	]],
	["../../scripts/dungeon/dungeon-tool-state.mjs", [
		"getSelectedWallTile", "selectWallTile", "getDungeonMode", "setDungeonMode",
	]],
	["../../scripts/dungeon/dungeon-tile-catalog.mjs", ["setFloorTiles", "setWallTiles", "setDoorTiles"]],
	["../../scripts/dungeon/dungeon-interior-walls.mjs", [
		"updateIntWallLine", "handleIntWallDrag", "handleIntWallClick", "handleIntWallDoorRemove",
	]],
	["../../scripts/hex/hex-tile-labels.mjs", ["_formatLabel"]],
	["../../scripts/hex/hex-decor.mjs", ["registerDecorAsset", "reloadDecorAssets", "getDecorSort"]],
	["../../scripts/hex/hex-colored-tiles.mjs", ["getColoredTiles", "getColoredTileDimensions"]],
	["../../scripts/hex/hex-custom-tiles.mjs", ["getCustomTiles", "getCustomTileDimensions"]],
	["../../scripts/hex/hex-map-effects.mjs", ["isWaterEffect", "toggleWaterEffect"]],
	["../../scripts/hex/hex-scene-format.mjs", ["getMapDimensions", "setMapDimension"]],
	["../../scripts/hex/hex-poi-history.mjs", ["canUndoPoi", "canRedoPoi", "clearPoiHistory"]],
	["../../scripts/hex/hex-tile-selection.mjs", ["getActiveTileTab", "setActiveTileTab", "getSearchFilter"]],
];

for (const [specifier, names] of EXTRACTED) {
	const label = specifier.split("/").pop();

	test(`${label} loads and exports its contract`, async () => {
		const module = await import(specifier);

		for (const name of names) {
			assert.notEqual(
				module[name], undefined,
				`${label} stopped exporting ${name} — a caller that imports it breaks at load`,
			);
		}
	});
}

// --- the origin modules, which is where a broken import block actually bites --

test("DungeonPainterSD loads with every extracted binding resolved", async () => {
	// The `_poiRedoStack` bug lived in a file exactly like this one: a stayer
	// reading a moved binding it forgot to import. An unresolvable named import
	// throws here at load, before any behaviour runs.
	const module = await import("../../scripts/dungeon/DungeonPainterSD.mjs");

	// Re-exports the extracted names so its existing importers keep working.
	for (const name of ["getSceneLevelContext", "applySceneLevelData", "getSelectedWallTile"]) {
		assert.notEqual(module[name], undefined, `DungeonPainterSD stopped re-exporting ${name}`);
	}
});

test("the extracted modules are a single instance, not two", async () => {
	// A module reached through two specifiers loads twice, each copy with its
	// own duplicated constants, while every name-based gate stays green. The
	// live Quench batch asserts this in the browser; this is the headless half.
	const direct = await import("../../scripts/dungeon/dungeon-level-context.mjs");
	const viaPainter = await import("../../scripts/dungeon/DungeonPainterSD.mjs");

	assert.equal(
		viaPainter.getSceneLevelContext, direct.getSceneLevelContext,
		"the painter re-exports a different function object — the module loaded twice",
	);
});
