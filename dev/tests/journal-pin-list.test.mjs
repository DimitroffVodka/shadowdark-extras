// Behaviour of the two pin lists — the standalone PinListApp window and the
// tray's Pins tab — as a user of them experiences it:
//
//   - the order rows come out in, read off the prepared render data;
//   - which pins a player is shown at all;
//   - what double-clicking a row does.
//
// Both lists are fed by real JournalPinManager reads against a scene whose pin
// flag is seeded here, so the data path under test is the production one. Only
// the Foundry globals around it (scene, journal collection, application base
// class) are stood in for.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals, installDom, StubElement } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

const pans = [];

const env = installCanvasGlobals();
installAppGlobals({ dom: makeSelectorDom() });
globalThis.game.settings = { get: () => undefined, set: async () => {}, register() {} };
globalThis.game.scenes = new Map();
globalThis.canvas.animatePan = target => { pans.push(target); };

const { PinListApp } = await import("../../scripts/journal/PinListApp.mjs");
const { JournalPinManager, checkPinVisibility } =
	await import("../../scripts/journal/pin-manager.mjs");
const { JournalPinTooltip } = await import("../../scripts/journal/pin-tooltip.mjs");
const { getPinsData } = await import("../../scripts/tray/TraySD.mjs");
const { TrayApp } = await import("../../scripts/tray/TrayApp.mjs");

const TRAY_PINS = ".sdx-tray .pins-view .sdx-pin-list:not(.map-notes-list)";

/** Seed the active scene with these pins (and folders), as the flags store them. */
function seedPins(pins, folders = []) {
	const flags = {
		"shadowdark-extras.journalPins": pins,
		"shadowdark-extras.pinFolders": folders,
	};
	globalThis.canvas.scene = {
		id: "scene-1",
		getFlag: (scope, key) => flags[`${scope}.${key}`],
		setFlag: async (scope, key, value) => { flags[`${scope}.${key}`] = value; },
	};
	globalThis.game.scenes.set("scene-1", globalThis.canvas.scene);
	return globalThis.canvas.scene;
}

/** A pin carrying an explicit label, which is what both lists display. */
function pin(id, label, extra = {}) {
	return { id, x: 0, y: 0, journalId: null, pageId: null, label, nameSource: "auto", style: {}, ...extra };
}

const OWNERSHIP = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

function permits(level) {
	return (_user, requested) => level >= OWNERSHIP[requested];
}

/** Register a journal whose entry and page permissions can diverge. */
function seedJournal({
	id = "j1",
	entryName = "Entry",
	entryLevel = OWNERSHIP.OBSERVER,
	pageId = "p9",
	pageName = "Page",
	pageLevel = entryLevel,
	pageContent = "Readable page content",
} = {}) {
	const pages = new foundry.utils.Collection();
	if (pageId) {
		pages.set(pageId, {
			id: pageId,
			name: pageName,
			sort: 0,
			text: { content: pageContent },
			testUserPermission: permits(pageLevel),
		});
	}
	const journal = env.addJournal(id, { pages });
	journal.name = entryName;
	journal.testUserPermission = permits(entryLevel);
	return { journal, page: pageId ? pages.get(pageId) : null };
}

async function standaloneRows() {
	return (await new PinListApp()._prepareContext({})).pins;
}

// --- ordering ---------------------------------------------------------------

// "Room 10" sorts before "Room 2" under a plain string comparison, because the
// comparison never gets past the first digit. Numbered rooms, levels and keyed
// map locations are the normal way these pins are named, so the list has to
// order them the way the numbers read.
test("the pin list window orders numbered names by their number", async () => {
	seedPins([pin("p1", "Room 10"), pin("p2", "Room 2"), pin("p3", "Room 1")]);

	const context = await new PinListApp()._prepareContext({});

	assert.deepEqual(context.pins.map(p => p.name), ["Room 1", "Room 2", "Room 10"]);
});

test("the tray's pin rows order numbered names by their number", () => {
	seedPins([pin("p1", "Room 10"), pin("p2", "Room 2"), pin("p3", "Room 1")]);

	const rows = getPinsData();

	assert.deepEqual(rows.map(r => r.name), ["Room 1", "Room 2", "Room 10"]);
});

// --- who sees which pins ----------------------------------------------------

// A GM-only pin must not reach a player through a list either. The row carries
// the pin's name, its journal subtitle and — since rows open on double-click —
// a way into the linked document, so "hidden" has to mean hidden here too, not
// only on the canvas. The revealed state is the one the visibility toggle
// writes (that write itself is covered in journal-pin-convert-notes.test.mjs).

test("the pin list window hides a GM-only pin from players, and returns it once revealed", async () => {
	const names = async () => (await new PinListApp()._prepareContext({})).pins.map(p => p.name);

	seedPins([pin("p1", "Room 1"), pin("p2", "Secret Vault", { gmOnly: true })]);
	assert.deepEqual(await names(), ["Room 1", "Secret Vault"], "the GM sees both");

	env.setGM(false);
	assert.deepEqual(await names(), ["Room 1"]);

	seedPins([pin("p1", "Room 1"), pin("p2", "Secret Vault", { gmOnly: false })]);
	assert.deepEqual(await names(), ["Room 1", "Secret Vault"], "revealed, so the player sees it");

	env.setGM(true);
});

test("the tray's pin rows hide a GM-only pin from players, and return it once revealed", () => {
	seedPins([pin("p1", "Room 1"), pin("p2", "Secret Vault", { gmOnly: true })]);
	assert.deepEqual(getPinsData().map(r => r.name), ["Room 1", "Secret Vault"], "the GM sees both");

	env.setGM(false);
	assert.deepEqual(getPinsData().map(r => r.name), ["Room 1"]);

	seedPins([pin("p1", "Room 1"), pin("p2", "Secret Vault", { gmOnly: false })]);
	assert.deepEqual(getPinsData().map(r => r.name), ["Room 1", "Secret Vault"]);

	env.setGM(true);
});

// --- opening a row's journal ------------------------------------------------

/** Render a PinListApp into a fresh selector DOM and hand back its one row. */
function renderPinListWindow({ id = "p1", x = "300", y = "400" } = {}) {
	const dom = makeSelectorDom();
	globalThis.document = dom.document;
	const app = new PinListApp();
	app.element = dom.node(".pin-list-app");
	app._onRender({}, {});
	const entry = dom.node(".pin-list-app .pin-entry");
	Object.assign(entry.dataset, { id, x, y });
	return { app, dom, root: dom.node(".pin-list-app"), entry };
}

test("double-clicking a row in the pin list window opens its linked page", () => {
	seedPins([pin("p1", "Room 1", { journalId: "j1", pageId: "p9" })]);
	seedJournal();
	env.rendered.length = 0;
	const { root, entry } = renderPinListWindow();

	root.dispatch("dblclick", { target: entry });

	assert.deepEqual(env.rendered, [{ id: "j1", args: [true, { pageId: "p9" }] }]);
});

test("a single click on a row still pans the canvas and opens nothing", () => {
	seedPins([pin("p1", "Room 1", { journalId: "j1", pageId: "p9" })]);
	env.addJournal("j1");
	env.rendered.length = 0;
	pans.length = 0;
	const { root, entry } = renderPinListWindow();

	root.dispatch("click", { target: entry });

	assert.deepEqual(pans, [{ x: 300, y: 400, scale: 1.5, duration: 500 }]);
	assert.deepEqual(env.rendered, []);
});

// The row's own buttons (pan, ping, visibility, delete) are clicked in place,
// sometimes twice in a row. That must not also open the journal behind them.
test("double-clicking a row's control leaves the journal closed", () => {
	seedPins([pin("p1", "Room 1", { journalId: "j1", pageId: "p9" })]);
	env.addJournal("j1");
	env.rendered.length = 0;
	const { root, entry } = renderPinListWindow();
	// Resolved through the row, so closest() walks a real ancestor chain.
	const control = entry.querySelector(".pin-control");
	Object.assign(control.dataset, { action: "pan" });

	root.dispatch("dblclick", { target: control });

	assert.deepEqual(env.rendered, []);
});

// The tray's rows open the same way (asserted in tray-app-bindings.test.mjs,
// alongside its binding manifest); the control guard is checked here.
test("double-clicking a control in a tray pin row leaves the journal closed", () => {
	seedPins([pin("pin-1", "Room 1", { journalId: "j1", pageId: "p9" })]);
	env.addJournal("j1");
	env.rendered.length = 0;
	const dom = makeSelectorDom({
		lists: { [`${TRAY_PINS} .pin-entry`]: [{ dataset: { id: "pin-1" } }] },
	});
	globalThis.document = dom.document;
	new TrayApp({})._onRender({}, {});
	const row = dom.node(`${TRAY_PINS} .pin-entry[0]`);

	dom.fire(`${TRAY_PINS} .pin-entry[0]`, "dblclick", {
		target: row.querySelector(".pin-control"),
	});

	assert.deepEqual(env.rendered, []);
});

// --- journal ownership policy ----------------------------------------------

test("1: an unlinked pin keeps its tooltip fallback and opens silently", async () => {
	seedPins([pin("p1", "Journal Pin", { tooltipTitle: "Public marker" })]);
	env.setGM(false);
	env.rendered.length = 0;
	env.notifications.warn.length = 0;

	const rows = await standaloneRows();
	const { root, entry } = renderPinListWindow();
	root.dispatch("dblclick", { target: entry });

	assert.equal(rows[0].name, "Public marker");
	assert.deepEqual(env.rendered, []);
	assert.deepEqual(env.notifications.warn, []);
	env.setGM(true);
});

test("2: an unreadable entry redacts its name and blocks opening silently", async () => {
	seedJournal({ entryLevel: OWNERSHIP.NONE, pageId: null });
	seedPins([pin("p1", "Journal Pin", { journalId: "j1", tooltipTitle: "Public marker" })]);
	env.setGM(false);
	env.rendered.length = 0;
	env.notifications.warn.length = 0;

	const rows = await standaloneRows();
	const { root, entry } = renderPinListWindow();
	root.dispatch("dblclick", { target: entry });

	assert.deepEqual(rows.map(row => [row.name, row.pageName]), [["Public marker", ""]]);
	assert.deepEqual(env.rendered, []);
	assert.deepEqual(env.notifications.warn, []);
	env.setGM(true);
});

test("3: LIMITED entry ownership reveals its name and permits opening", async () => {
	seedJournal({ entryLevel: OWNERSHIP.LIMITED, pageId: null });
	seedPins([pin("p1", "Journal Pin", { journalId: "j1" })]);
	env.setGM(false);
	env.rendered.length = 0;

	const rows = await standaloneRows();
	const { root, entry } = renderPinListWindow();
	root.dispatch("dblclick", { target: entry });

	assert.deepEqual(rows.map(row => [row.name, row.pageName]), [["Entry", "Entry"]]);
	assert.deepEqual(env.rendered.map(item => item.args), [[true]]);
	env.setGM(true);
});

test("4: OBSERVER entry ownership reveals its name and permits opening", async () => {
	seedJournal({ entryLevel: OWNERSHIP.OBSERVER, pageLevel: OWNERSHIP.OBSERVER });
	seedPins([pin("p1", "Journal Pin", { journalId: "j1" })]);
	env.setGM(false);
	env.rendered.length = 0;

	const rows = await standaloneRows();
	const { root, entry } = renderPinListWindow();
	root.dispatch("dblclick", { target: entry });

	assert.equal(rows[0].name, "Entry");
	assert.deepEqual(env.rendered.map(item => item.args), [[true]]);
	const tooltipDom = installDom();
	StubElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 40 });
	const createElement = tooltipDom.createElement;
	let createdDivs = 0;
	tooltipDom.createElement = tag => {
		const element = createElement(tag);
		if (tag === "div" && createdDivs++ === 0) {
			Object.defineProperty(element, "innerHTML", {
				get() { return this._html ?? ""; },
				set(value) {
					this._html = value;
					this.textContent = value.replace(/<[^>]*>/g, "");
				},
			});
		}
		return element;
	};
	JournalPinTooltip.show({ journalId: "j1", pageId: null, style: {} }, { global: { x: 0, y: 0 } });
	assert.match(tooltipDom.body.children[0].innerHTML, /Readable page content/);
	JournalPinTooltip.hide();
	env.setGM(true);
});

test("5: an inherited readable page reveals both subtitle halves and opens the page", async () => {
	seedJournal({ entryLevel: OWNERSHIP.OBSERVER, pageLevel: OWNERSHIP.OBSERVER });
	seedPins([pin("p1", "Journal Pin", { journalId: "j1", pageId: "p9" })]);
	env.setGM(false);
	env.rendered.length = 0;

	const rows = await standaloneRows();
	const { root, entry } = renderPinListWindow();
	root.dispatch("dblclick", { target: entry });

	assert.deepEqual(rows.map(row => [row.name, row.pageName]), [["Page", "Entry • Page"]]);
	assert.deepEqual(env.rendered.map(item => item.args), [[true, { pageId: "p9" }]]);
	env.setGM(true);
});

test("6: a readable entry with an unreadable page keeps only the entry subtitle", async () => {
	seedJournal({ entryLevel: OWNERSHIP.OBSERVER, pageLevel: OWNERSHIP.NONE });
	seedPins([pin("p1", "Journal Pin", {
		journalId: "j1", pageId: "p9", tooltipTitle: "Public marker",
	})]);
	env.setGM(false);
	env.rendered.length = 0;

	const rows = await standaloneRows();
	const trayRow = getPinsData().find(row => row.rowType === "pin");
	const { root, entry } = renderPinListWindow();
	root.dispatch("dblclick", { target: entry });

	assert.deepEqual(rows.map(row => [row.name, row.pageName]), [["Public marker", "Entry"]]);
	assert.deepEqual([trayRow.name, trayRow.pageName], ["Public marker", "Entry"]);
	assert.deepEqual(env.rendered, []);
	env.setGM(true);
});

test("7: an unreadable entry with a readable page keeps only the page subtitle", async () => {
	seedJournal({ entryLevel: OWNERSHIP.NONE, pageLevel: OWNERSHIP.OBSERVER });
	seedPins([pin("p1", "Journal Pin", { journalId: "j1", pageId: "p9" })]);
	env.setGM(false);
	env.rendered.length = 0;

	const rows = await standaloneRows();
	const trayRow = getPinsData().find(row => row.rowType === "pin");
	const { root, entry } = renderPinListWindow();
	root.dispatch("dblclick", { target: entry });

	assert.deepEqual(rows.map(row => [row.name, row.pageName]), [["Page", "Page"]]);
	assert.deepEqual([trayRow.name, trayRow.pageName], ["Page", "Page"]);
	assert.deepEqual(env.rendered.map(item => item.args), [[true, { pageId: "p9" }]]);
	env.setGM(true);
});

test("8: a deleted linked journal retains the existing warning", () => {
	seedPins([pin("p1", "Marker", { journalId: "deleted" })]);
	env.setGM(false);
	env.notifications.warn.length = 0;
	const { root, entry } = renderPinListWindow();

	root.dispatch("dblclick", { target: entry });

	assert.deepEqual(env.notifications.warn, ["Journal not found"]);
	env.setGM(true);
});

test("9: a GM still sees both names and opens regardless of ownership", async () => {
	seedJournal({ entryLevel: OWNERSHIP.NONE, pageLevel: OWNERSHIP.NONE });
	seedPins([pin("p1", "Journal Pin", { journalId: "j1", pageId: "p9" })]);
	env.setGM(true);
	env.rendered.length = 0;

	const rows = await standaloneRows();
	const { root, entry } = renderPinListWindow();
	root.dispatch("dblclick", { target: entry });

	assert.deepEqual(rows.map(row => [row.name, row.pageName]), [["Page", "Entry • Page"]]);
	assert.deepEqual(env.rendered.map(item => item.args), [[true, { pageId: "p9" }]]);
});

test("10: nameSource journal falls through to tooltip when its target is unreadable", async () => {
	seedJournal({ entryLevel: OWNERSHIP.NONE, pageId: null });
	seedPins([pin("p1", "Journal Pin", {
		journalId: "j1", nameSource: "journal", tooltipTitle: "Public marker",
	})]);
	env.setGM(false);

	assert.equal((await standaloneRows())[0].name, "Public marker");
	env.setGM(true);
});

test("11: journal ownership never hides an otherwise visible canvas pin", async () => {
	seedJournal({ entryLevel: OWNERSHIP.NONE, pageId: null });
	seedPins([pin("p1", "Marker", {
		journalId: "j1", gmOnly: false, requiresVision: false,
	})]);
	env.setGM(false);

	assert.equal(checkPinVisibility(JournalPinManager.get("p1")), true);
	env.setGM(true);
});

test("12: journal ownership never removes an otherwise visible list row", async () => {
	seedJournal({ entryLevel: OWNERSHIP.NONE, pageId: null });
	seedPins([pin("p1", "Journal Pin", { journalId: "j1", tooltipTitle: "Public marker" })]);
	env.setGM(false);

	assert.deepEqual((await standaloneRows()).map(row => row.name), ["Public marker"]);
	assert.deepEqual(getPinsData().filter(row => row.rowType === "pin").map(row => row.name), ["Public marker"]);
	env.setGM(true);
});

test("13: the globally exposed manager has no openJournal member", () => {
	assert.equal("openJournal" in JournalPinManager, false);
});

test("the tray's folder rows order numbered names by their number", () => {
	seedPins([], [
		{ id: "f1", name: "Level 10", parentId: null },
		{ id: "f2", name: "Level 2", parentId: null },
		{ id: "f3", name: "Level 1", parentId: null },
	]);

	const rows = getPinsData();

	assert.deepEqual(rows.map(r => r.name), ["Level 1", "Level 2", "Level 10"]);
});
