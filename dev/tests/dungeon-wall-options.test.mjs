// The dungeon painter's three wall options — No Foundry Walls, Wall Shadows,
// Curved Walls — are peers in the tray: independent toggles, each of which
// reports its own state and leaves the other two alone.
//
// What is tested here is that state contract, through the painter's public
// data feed — the object TraySD hands to templates/sdx-tray/tray.hbs, and
// therefore the thing that decides which checkboxes render checked.
//
// NOT TESTED HERE — whether a checked Curved Walls control *looks* selected.
// That is a `:has(:checked)` rule in styles/sdx-tray.css with no JavaScript to
// observe, and asserting on the stylesheet's source text would prove only that
// a string exists, not that Chromium paints anything. Verifying the rendered
// selected state is a mandatory live-V14 acceptance item, not a Node test.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals, installDom } from "./helpers/pixi-harness.mjs";

installCanvasGlobals();
installDom();

// Same ambient shape wall-tile-override.test.mjs uses to load the painter.
globalThis.game.scenes = { get: () => null };
globalThis.game.users = [{ isGM: true, active: true }];
globalThis.game.settings = { get: () => undefined, set: async () => {}, register() {}, registerMenu() {} };
globalThis.game.i18n = { localize: key => key };
globalThis.canvas.grid = { size: 100, isHexagonal: false };
// No scene, so setCurvedWalls records the choice without scheduling a rebuild.
globalThis.canvas.scene = null;
globalThis.CONST = { GRID_TYPES: { SQUARE: 1 }, DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
globalThis.foundry.applications = {
	api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base, DialogV2: class {} },
	apps: { FilePicker: class {} },
	ux: { TextEditor: {} },
};
globalThis.foundry.canvas = { layers: { CanvasLayer: class {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };

const painter = await import("../../scripts/dungeon/DungeonPainterSD.mjs");

/** The three wall options as the tray sees them: a setter and a context key. */
const WALL_OPTIONS = [
	{ name: "No Foundry Walls", set: painter.setNoFoundryWalls, key: "noFoundryWalls" },
	{ name: "Wall Shadows", set: painter.setWallShadows, key: "wallShadows" },
	{ name: "Curved Walls", set: painter.setCurvedWalls, key: "curvedWalls" },
];

/** Turn every option off, then read the tray's view of them. */
async function trayViewAfter(changes) {
	for (const option of WALL_OPTIONS) option.set(false);
	for (const option of changes) option.set(true);

	const data = await painter.getDungeonPainterData();
	return Object.fromEntries(WALL_OPTIONS.map(o => [o.key, data[o.key]]));
}

for (const option of WALL_OPTIONS) {
	test(`turning on ${option.name} shows only ${option.name} as on`, async () => {
		const view = await trayViewAfter([option]);

		assert.deepEqual(view, {
			noFoundryWalls: option.key === "noFoundryWalls",
			wallShadows: option.key === "wallShadows",
			curvedWalls: option.key === "curvedWalls",
		});
	});
}

test("the wall options are independent, not mutually exclusive", async () => {
	const view = await trayViewAfter(WALL_OPTIONS);

	assert.deepEqual(view, {
		noFoundryWalls: true,
		wallShadows: true,
		curvedWalls: true,
	});
});
