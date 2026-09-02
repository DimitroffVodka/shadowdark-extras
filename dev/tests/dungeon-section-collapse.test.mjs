// The Dungeons tab shows five tile grids and there is a lot of scrolling in it.
// Collapsing a section is only useful if it STAYS collapsed: the tray re-renders
// on almost every action, so a class toggled on the element would be undone by
// the next unrelated change. The state therefore lives in module scope and is
// fed back into the template on each render.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals, installDom } from "./helpers/pixi-harness.mjs";

installCanvasGlobals();
installDom();

globalThis.game.scenes = { get: () => null };
globalThis.game.users = [{ isGM: true, active: true }];
globalThis.game.settings = { get: () => undefined, set: async () => {}, register() {}, registerMenu() {} };
globalThis.game.i18n = { localize: key => key };
globalThis.canvas.grid = { size: 100, isHexagonal: false };
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

const SECTIONS = ["floor", "wall", "intwall", "intdoor", "door"];

/** Reset, since the state is module-level and shared across these tests. */
function collapseNone() {
	for (const key of SECTIONS) {
		if (painter.isDungeonSectionCollapsed(key)) painter.toggleDungeonSection(key);
	}
}

test("every tile section starts open", () => {
	collapseNone();
	for (const key of SECTIONS) {
		assert.equal(painter.isDungeonSectionCollapsed(key), false, key);
	}
});

test("toggling collapses and restores one section", () => {
	collapseNone();
	painter.toggleDungeonSection("wall");

	assert.equal(painter.isDungeonSectionCollapsed("wall"), true);
	painter.toggleDungeonSection("wall");
	assert.equal(painter.isDungeonSectionCollapsed("wall"), false);
});

test("sections collapse independently", () => {
	// Rolling up Wall Tiles must not take Floor Tiles with it — the whole point
	// is getting one grid out of the way while working in another.
	collapseNone();
	painter.toggleDungeonSection("wall");
	painter.toggleDungeonSection("intdoor");

	assert.equal(painter.isDungeonSectionCollapsed("wall"), true);
	assert.equal(painter.isDungeonSectionCollapsed("intdoor"), true);
	assert.equal(painter.isDungeonSectionCollapsed("floor"), false);
	assert.equal(painter.isDungeonSectionCollapsed("intwall"), false);
	assert.equal(painter.isDungeonSectionCollapsed("door"), false);
});

test("the tray render carries the collapsed state", async () => {
	// This is what makes it survive a re-render: the template reads these, so a
	// section that was rolled up comes back rolled up.
	collapseNone();
	painter.toggleDungeonSection("floor");

	const data = await painter.getDungeonPainterData();

	assert.deepEqual(data.collapsed, {
		floor: true,
		wall: false,
		intwall: false,
		intdoor: false,
		door: false,
	});
});
