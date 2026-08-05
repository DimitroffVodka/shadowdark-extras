// Characterization tests for TrayApp, captured BEFORE its _onRender is split
// out of scripts/tray/TrayApp.mjs.
//
// TrayApp is 1,957 lines and 1,515 of them are a single _onRender method that
// wires the whole tray: handle buttons, the dungeon painter, the Theatre of
// the Mind scene list, and the pin/note list. Splitting that method is a pure
// move — every binding must survive, attached to the same selector, listening
// for the same event.
//
// So the primary assertion here is the binding manifest: the complete set of
// (selector, event) pairs one render produces, frozen as a literal. It is a
// direct measurement of the real code through a selector-keyed DOM, not a
// summary, and it fails on a dropped, renamed, or duplicated binding.
//
// Around it sit behaviour tests for the parts that are more than wiring —
// open/close, the search filter, and the action routing that reads an
// element's dataset to decide what to call.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

installCanvasGlobals();
installAppGlobals({ dom: makeSelectorDom() });
globalThis.game.settings = { get: () => undefined, set: async () => {}, register() {} };
globalThis.game.scenes = new Map();
globalThis.canvas.grid = { size: 100, isHexagonal: true };

const { TrayApp } = await import("../../scripts/tray/TrayApp.mjs");
const { getViewMode } = await import("../../scripts/tray/TraySD.mjs");
const { getPoiMirror, getPoiScale } = await import("../../scripts/hex/HexPainterSD.mjs");

/**
 * Render a tray into a fresh selector-keyed DOM.
 *
 * seedAll gives every querySelectorAll one element, so the per-element
 * bindings (tab buttons, tile thumbnails, pin rows) reach the manifest too.
 */
function render({ seedAll = true, ...options } = {}) {
	const dom = makeSelectorDom({ seedAll, ...options });
	globalThis.document = dom.document;
	const app = new TrayApp({});
	app._onRender({}, {});
	return { app, dom };
}

// --- the binding manifest ---------------------------------------------------

// Every (selector, event) pair one render attaches. Entries ending in `[n]`
// come from a querySelectorAll, so they are per-element bindings.
const BINDINGS = [
	".sdx-tray .button-clear :: click",
	".sdx-tray .decor-ddpack-btn :: click",
	".sdx-tray .decor-elevation-input :: change",
	".sdx-tray .decor-folder-header[0] :: click",
	".sdx-tray .decor-import-btn :: click",
	".sdx-tray .decor-search-input :: input",
	".sdx-tray .decor-sort-input :: change",
	".sdx-tray .decor-tile-thumb[0] :: click",
	".sdx-tray .decor-tile-thumb[0] :: contextmenu",
	".sdx-tray .dgen-apply :: click",
	".sdx-tray .dgen-levels :: input",
	".sdx-tray .dgen-row input[type='range'][0] :: input",
	".sdx-tray .dgen-seed-refresh :: click",
	".sdx-tray .dgen-textured :: change",
	".sdx-tray .dungeon-background-select :: change",
	".sdx-tray .dungeon-curved-walls-checkbox :: change",
	".sdx-tray .dungeon-flatten-level-btn :: click",
	".sdx-tray .dungeon-generator-close :: click",
	".sdx-tray .dungeon-generator-toggle :: click",
	".sdx-tray .dungeon-intdoor-thumb[data-dungeon-intdoor][0] :: click",
	".sdx-tray .dungeon-intwall-thumb[data-dungeon-intwall][0] :: click",
	".sdx-tray .dungeon-mode-tab[0] :: click",
	".sdx-tray .dungeon-no-walls-checkbox :: change",
	".sdx-tray .dungeon-tile-thumb[data-dungeon-door][0] :: click",
	".sdx-tray .dungeon-tile-thumb[data-dungeon-tile][0] :: click",
	".sdx-tray .dungeon-tile-thumb[data-dungeon-wall][0] :: click",
	".sdx-tray .dungeon-unflatten-level-btn :: click",
	".sdx-tray .dungeon-wall-shadows-checkbox :: change",
	".sdx-tray .hex-apply-btn :: click",
	".sdx-tray .hex-bw-checkbox :: change",
	".sdx-tray .hex-colored-folder-header[0] :: click",
	".sdx-tray .hex-custom-breadcrumb-segment[0] :: click",
	".sdx-tray .hex-custom-chip[0] :: click",
	".sdx-tray .hex-custom-reload-btn[0] :: click",
	".sdx-tray .hex-custom-size-input[0] :: change",
	".sdx-tray .hex-custom-up-btn[0] :: click",
	".sdx-tray .hex-flatten-btn :: click",
	".sdx-tray .hex-fog-checkbox :: change",
	".sdx-tray .hex-format-btn :: click",
	".sdx-tray .hex-gen-clear-btn :: click",
	".sdx-tray .hex-gen-generate-btn :: click",
	".sdx-tray .hex-gen-slider-row input[type='range'][0] :: input",
	".sdx-tray .hex-generator-toggle-btn :: click",
	".sdx-tray .hex-search-input :: input",
	".sdx-tray .hex-slider-row input[type='range'][0] :: input",
	".sdx-tray .hex-symbol-folder-header:not(.decor-folder-header)[0] :: click",
	".sdx-tray .hex-tile-tab[0] :: click",
	".sdx-tray .hex-tile-thumb:not(.decor-tile-thumb)[0] :: click",
	".sdx-tray .hex-tile-thumb:not(.decor-tile-thumb)[0] :: contextmenu",
	".sdx-tray .hex-tint-checkbox :: change",
	".sdx-tray .hex-water-checkbox :: change",
	".sdx-tray .hex-wind-checkbox :: change",
	".sdx-tray .map-note-control[0] :: click",
	".sdx-tray .note-control[0] :: click",
	".sdx-tray .note-entry[0] :: contextmenu",
	".sdx-tray .note-header[0] :: click",
	".sdx-tray .pin-control[0] :: click",
	".sdx-tray .pin-folder-header[0] .pin-folder-caret :: click",
	".sdx-tray .pin-folder-header[0] .pin-folder-control[0] :: click",
	".sdx-tray .pin-folder-header[0] .pin-folder-name :: click",
	".sdx-tray .pin-folder-newbtn[data-action='convert-notes'] :: click",
	".sdx-tray .pin-folder-newbtn[data-action='folder-new'] :: click",
	".sdx-tray .pin-search-input :: input",
	".sdx-tray .pins-view .sdx-pin-list:not(.map-notes-list) .pin-entry[draggable='true'], .pin-folder-header[draggable='true'][0] :: dragend",
	".sdx-tray .pins-view .sdx-pin-list:not(.map-notes-list) .pin-entry[draggable='true'], .pin-folder-header[draggable='true'][0] :: dragstart",
	".sdx-tray .pins-view .sdx-pin-list:not(.map-notes-list) :: dragleave",
	".sdx-tray .pins-view .sdx-pin-list:not(.map-notes-list) :: dragover",
	".sdx-tray .pins-view .sdx-pin-list:not(.map-notes-list) :: drop",
	".sdx-tray .scene-card[0] .scene-card-activate :: click",
	".sdx-tray .scene-card[0] :: dragend",
	".sdx-tray .scene-card[0] :: dragleave",
	".sdx-tray .scene-card[0] :: dragover",
	".sdx-tray .scene-card[0] :: dragstart",
	".sdx-tray .scene-card[0] [data-action='delete-scene'] :: click",
	".sdx-tray .scene-card[0] [data-action='edit-scene'] :: click",
	".sdx-tray .scene-folder, .scene-uncat-container[0] :: dragleave",
	".sdx-tray .scene-folder, .scene-uncat-container[0] :: dragover",
	".sdx-tray .scene-folder, .scene-uncat-container[0] :: drop",
	".sdx-tray .tray-handle-button-toggle :: click",
	".sdx-tray .tray-handle-button-tool[data-action='add-pin'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='carousing'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='formation'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='leader'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='light-tracker'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='marching'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='pin-list'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='poi-mirror'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='poi-redo'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='poi-rotate-left'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='poi-rotate-right'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='poi-scale-down'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='poi-scale-up'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='poi-undo'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='sdx-coords'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='sdx-drawing'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='sdx-hex-fog'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='sdx-hex-fog'] :: contextmenu",
	".sdx-tray .tray-handle-button-tool[data-action='sdx-hex-tooltip'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='sdx-maphub-launcher'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='sdx-roller'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='sdx-solo-mode'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='tom-overlay-manager'] :: click",
	".sdx-tray .tray-handle-button-tool[data-action='tom-scene-switcher'] :: click",
	".sdx-tray .tray-handle-button-viewcycle :: click",
	".sdx-tray .tray-tab-button[0] :: click",
	`.sdx-tray [data-action="select-party"] :: click`,
	`.sdx-tray [data-action="toggle-npc-visibility"] :: click`,
	".sdx-tray [data-action='create-folder'] :: click",
	".sdx-tray [data-action='create-scene'] :: click",
	".sdx-tray [data-action='delete-folder'][0] :: click",
	".sdx-tray [data-action='rename-folder'][0] :: click",
	".sdx-tray [data-action='stop-broadcast'] :: click",
	".sdx-tray [data-action='toggle-folder'][0] :: click",
];

test("a render binds exactly this set of selectors and events", () => {
	const { dom } = render();

	assert.deepEqual(dom.manifest(), BINDINGS);
});

test("every binding hangs off the tray root, never off the document", () => {
	const { dom } = render();

	for (const binding of dom.bindings) {
		assert.ok(binding.selector.startsWith(".sdx-tray "),
			`binding on "${binding.selector}" escapes the tray element`);
	}
});

test("the hex painter mixin is merged onto the prototype and binds too", () => {
	const { app, dom } = render();

	assert.equal(typeof app._bindHexPainterEvents, "function");
	assert.ok(dom.manifest().some(entry => entry.includes(".hex-format-btn")));
});

test("a render with no tray element in the document binds nothing", () => {
	const { dom } = render({ absent: [".sdx-tray"] });

	assert.deepEqual(dom.bindings, []);
});

// _onRender attaches unconditionally: it has no guard against binding the same
// element twice. That is safe only because .sdx-tray is the root of tray.hbs,
// so ApplicationV2 replaces the whole element on every render. Rendering twice
// into one element — which the harness makes possible and Foundry does not —
// doubles every listener.
test("re-rendering into the same element doubles every listener", () => {
	const { app, dom } = render();
	const first = dom.bindings.length;

	app._onRender({}, {});

	assert.equal(dom.bindings.length, first * 2);
	assert.deepEqual(dom.manifest(), BINDINGS, "the selector set itself is unchanged");
});

// --- open / close -----------------------------------------------------------

test("the toggle button flips the expanded state", () => {
	const { app, dom } = render();

	assert.equal(app.isExpanded(), false);
	dom.fire(".sdx-tray .tray-handle-button-toggle", "click");
	assert.equal(app.isExpanded(), true);
	dom.fire(".sdx-tray .tray-handle-button-toggle", "click");
	assert.equal(app.isExpanded(), false);
});

test("expanding adds the expanded class and turns the chevron inward", () => {
	const { app, dom } = render();
	const tray = dom.node(".sdx-tray");
	const icon = dom.node(".sdx-tray .tray-handle-button-toggle i");

	app.setExpanded(true);

	assert.equal(tray.classList.contains("expanded"), true);
	assert.equal(icon.classList.contains("fa-chevron-left"), true);
	assert.equal(icon.classList.contains("fa-chevron-right"), false);

	app.setExpanded(false);

	assert.equal(tray.classList.contains("expanded"), false);
	assert.equal(icon.classList.contains("fa-chevron-right"), true);
});

test("toggling closes the three TOM panels, which are positioned off the handle", () => {
	const { app, dom } = render();

	app.toggleExpanded();

	assert.deepEqual(dom.removed, [
		".tom-scene-switcher-panel",
		".tom-cast-manager-panel",
		".tom-overlay-manager-panel",
	]);
});

test("setExpanded closes the TOM panels as well", () => {
	const { app, dom } = render();

	app.setExpanded(true);

	assert.deepEqual(dom.removed, [
		".tom-scene-switcher-panel",
		".tom-cast-manager-panel",
		".tom-overlay-manager-panel",
	]);
});

// --- action routing ---------------------------------------------------------

test("a tab button routes its data-view to the view mode", () => {
	const { dom } = render({ lists: { ".tray-tab-button": [{ dataset: { view: "dungeons" } }] } });

	dom.fire(".sdx-tray .tray-tab-button[0]", "click");

	assert.equal(getViewMode(), "dungeons");
});

test("a tab button with no data-view leaves the view mode alone", () => {
	const { dom } = render({ lists: { ".tray-tab-button": [{ dataset: { view: "hexes" } }] } });
	dom.fire(".sdx-tray .tray-tab-button[0]", "click");
	assert.equal(getViewMode(), "hexes");

	const blank = render({ lists: { ".tray-tab-button": [{ dataset: {} }] } });
	blank.dom.fire(".sdx-tray .tray-tab-button[0]", "click");

	assert.equal(getViewMode(), "hexes");
});

test("the POI mirror button toggles the painter's mirror flag", () => {
	const { dom } = render();
	const before = getPoiMirror();

	dom.fire(".sdx-tray .tray-handle-button-tool[data-action='poi-mirror']", "click");
	assert.equal(getPoiMirror(), !before);

	dom.fire(".sdx-tray .tray-handle-button-tool[data-action='poi-mirror']", "click");
	assert.equal(getPoiMirror(), before);
});

test("the POI scale buttons step the painter scale in both directions", () => {
	const { dom } = render();
	const start = getPoiScale();

	dom.fire(".sdx-tray .tray-handle-button-tool[data-action='poi-scale-up']", "click");
	const up = getPoiScale();
	assert.ok(up > start, `scale up: ${start} -> ${up}`);

	dom.fire(".sdx-tray .tray-handle-button-tool[data-action='poi-scale-down']", "click");

	assert.ok(getPoiScale() < up);
});

test("the search input records its term on the application", () => {
	const { app, dom } = render();
	const input = dom.node(".sdx-tray .pin-search-input");
	input.value = "  Goblin Camp  ";

	dom.fire(".sdx-tray .pin-search-input", "input", { target: input });

	assert.equal(app._pinSearchTerm, "  Goblin Camp  ");
});

// --- pin list filtering -----------------------------------------------------

const PINS = ".sdx-tray .pins-view .sdx-pin-list:not(.map-notes-list)";

/** Render with a pin list of the given names, each inside the named folder. */
function renderPinList(entries) {
	const { app, dom } = render({
		lists: {
			[`${PINS} .pin-entry`]: entries.map(e => ({ dataset: { ancestors: e.folder ?? "" } })),
			[`${PINS} .pin-folder-header`]: [{ dataset: { folderId: "f1" } }],
			".sdx-tray .map-notes-list .pin-entry": [{}],
		},
	});
	entries.forEach((entry, index) => {
		dom.node(`${PINS} .pin-entry[${index}] .pin-name`).textContent = entry.name;
		dom.node(`${PINS} .pin-entry[${index}] .pin-page-name`).textContent = entry.page ?? "";
	});
	dom.node(".sdx-tray .map-notes-list .pin-entry[0] .pin-name").textContent = "Old Well";
	return { app, dom };
}

test("an empty search term clears the inline display of every row", () => {
	const { app, dom } = renderPinList([{ name: "Goblin Camp", folder: "f1" }]);

	app._filterPins("");

	assert.equal(dom.node(`${PINS} .pin-entry[0]`).style.display, "");
	assert.equal(dom.node(`${PINS} .pin-folder-header[0]`).style.display, "");
});

test("a search term hides the pins whose name and page both miss", () => {
	const { app, dom } = renderPinList([
		{ name: "Goblin Camp", folder: "f1" },
		{ name: "Dragon Lair", folder: "f1" },
	]);

	app._filterPins("goblin");

	assert.equal(dom.node(`${PINS} .pin-entry[0]`).style.display, "flex");
	assert.equal(dom.node(`${PINS} .pin-entry[1]`).style.display, "none");
});

test("a pin matches on its page name as well as its own", () => {
	const { app, dom } = renderPinList([{ name: "Marker", page: "Goblin Camp", folder: "f1" }]);

	app._filterPins("goblin");

	assert.equal(dom.node(`${PINS} .pin-entry[0]`).style.display, "flex");
});

test("a folder survives the filter only while it holds a match", () => {
	const { app, dom } = renderPinList([{ name: "Goblin Camp", folder: "f1" }]);
	const folder = dom.node(`${PINS} .pin-folder-header[0]`);

	app._filterPins("goblin");
	assert.equal(folder.style.display, "flex", "the folder is an ancestor of the match");

	app._filterPins("dragon");

	assert.equal(folder.style.display, "none");
});

test("map notes filter on name alone, independently of the pin tree", () => {
	const { app, dom } = renderPinList([{ name: "Goblin Camp", folder: "f1" }]);
	const note = dom.node(".sdx-tray .map-notes-list .pin-entry[0]");

	app._filterPins("well");
	assert.equal(note.style.display, "");

	app._filterPins("goblin");

	assert.equal(note.style.display, "none");
});

// --- context ----------------------------------------------------------------

test("the render context carries the state the template branches on", async () => {
	const app = new TrayApp({ actors: [] });

	const context = await app._prepareContext({});

	assert.equal(context.isExpanded, false);
	assert.equal(context.viewMode, getViewMode());
	assert.equal(context.pinSearchTerm, "");
	assert.equal(context.poiScalePercent, Math.round(getPoiScale() * 100));
	assert.equal(context.isHexagonal, true);
	assert.ok(Array.isArray(context.tomScenes));
	assert.ok(Array.isArray(context.tomFolders));
});
