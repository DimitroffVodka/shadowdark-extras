// Characterization tests for JournalPinGraphics' pointer interaction cluster,
// captured BEFORE it is extracted out of pin-rendering.mjs.
//
// These handlers are where the pin's editing behavior actually lives: who is
// allowed to drag, how far the pointer must travel before a click becomes a
// drag, what gets persisted, and which listeners are attached and released.
// None of it was covered, because it needs a PIXI object graph to run at all —
// that is what dev/tests/helpers/pixi-harness.mjs supplies.
//
// The assertions describe current behavior, including the parts that look
// accidental. Anything genuinely wrong should be changed deliberately, with
// the test updated in the same commit, not quietly "fixed" during a move.

import assert from "node:assert/strict";
import test from "node:test";

import {
	installCanvasGlobals,
	installDom,
	makeGsapRecorder,
	makePointerEvent,
	StubParent,
} from "./helpers/pixi-harness.mjs";

const env = installCanvasGlobals();
const dom = installDom();

const { JournalPinGraphics, JournalPinTooltip } =
	await import("../../scripts/journal/pin-rendering.mjs");
const { JournalPinManager } = await import("../../scripts/journal/pin-manager.mjs");
const { openPinJournal } = await import("../../scripts/journal/pin-interactions.mjs");

// --- collaborator interception ----------------------------------------------

const tooltip = { shown: 0, hidden: 0 };
JournalPinTooltip.show = () => { tooltip.shown++; };
JournalPinTooltip.hide = () => { tooltip.hidden++; };

const updates = [];
let updateFails = false;
JournalPinManager.update = async (id, patch) => {
	if (updateFails) throw new Error("simulated persistence failure");
	updates.push({ id, patch });
	return true;
};

const managerCalls = [];
let hasCopiedStyle = false;
for (const name of ["duplicate", "copyStyle", "pasteStyle", "delete"]) {
	JournalPinManager[name] = async arg => { managerCalls.push({ name, arg }); };
}
JournalPinManager.hasCopiedStyle = () => hasCopiedStyle;

// --- fixtures ---------------------------------------------------------------

function makePin({ id = "pin-1", style = {}, hideTooltip, x = 100, y = 200, pageId, journalId = "j1" } = {}) {
	const pin = new JournalPinGraphics({
		id, journalId, pageId, x, y, style, hideTooltip,
	});
	pin.parent = new StubParent({ offsetX: 10, offsetY: 20 });
	return pin;
}

function reset({ isGM = true } = {}) {
	tooltip.shown = 0;
	tooltip.hidden = 0;
	updates.length = 0;
	updateFails = false;
	managerCalls.length = 0;
	hasCopiedStyle = false;
	env.notifications.warn.length = 0;
	env.rendered.length = 0;
	dom.reset();
	env.setGM(isGM);
	env.setGsap(makeGsapRecorder());
	return globalThis.gsap;
}

/**
 * Drive Date.now() by hand. Pairing two releases into a double-click is timed,
 * and the clock is an external boundary, so tests move it rather than wait on
 * it. Always restore in a finally — every other test shares this global.
 */
const realDateNow = Date.now;
function installClock(start = 1_000_000) {
	let now = start;
	Date.now = () => now;
	return {
		advance(ms) {
			now += ms;
		},
		restore() {
			Date.now = realDateNow;
		},
	};
}

/** One complete press-and-release on the pin, with no movement between. */
async function pressAndRelease(pin) {
	pin._onPointerDown(makePointerEvent({ button: 0 }));
	await pin._onPointerUp(makePointerEvent());
}

function addReadableJournal(id, { pageIds = [] } = {}) {
	const pages = new foundry.utils.Collection();
	for (const pageId of pageIds) {
		pages.set(pageId, { id: pageId, testUserPermission: () => true });
	}
	const journal = env.addJournal(id, { pages });
	journal.testUserPermission = () => true;
	return journal;
}

/** Labels of the context menu currently mounted, in order. */
function menuLabels() {
	const menu = dom.getElementById("sdx-journal-pin-context-menu");
	return menu ? menu.children.map(row => row.label) : null;
}

function clickMenuItem(label) {
	const menu = dom.getElementById("sdx-journal-pin-context-menu");
	const row = menu.children.find(r => r.label === label);
	assert.ok(row, `no menu row labelled "${label}"`);
	row.dispatch("click");
}

// --- listener wiring --------------------------------------------------------

test("setup subscribes exactly the five pointer events, bound to the pin", () => {
	reset();
	const pin = makePin();

	pin._setupEventListeners();

	assert.deepEqual(pin.listenerEvents(), [
		"pointerenter", "pointerleave", "pointerdown", "pointerup", "pointerupoutside",
	]);
});

test("teardown releases every listener, including press-scoped movement", () => {
	reset();
	const pin = makePin();
	pin._setupEventListeners();
	// A drag in progress adds globalpointermove on top of the standing five.
	pin.on("globalpointermove", pin._onPointerMove, pin);

	pin._removeEventListeners();

	assert.deepEqual(pin.listenerEvents(), []);
});

test("pointerupoutside ends an active drag just like pointerup", () => {
	reset();
	const pin = makePin();
	pin._setupEventListeners();

	// Both routes must end a drag, or releasing off-pin strands _isDragging.
	pin._isDragging = true;
	pin.emit("pointerupoutside", makePointerEvent());

	assert.equal(pin._isDragging, false);
});

test("teardown clears an eligible player release before listeners are reattached", () => {
	reset({ isGM: false });
	addReadableJournal("j1");
	const pin = makePin();
	const clock = installClock();
	pin._setupEventListeners();

	try {
		pin.emit("pointerdown", makePointerEvent({ button: 0 }));
		pin.emit("pointerup", makePointerEvent({ button: 0 }));
		pin._removeEventListeners();
		assert.deepEqual(pin.listenerEvents(), []);

		clock.advance(100);
		pin._setupEventListeners();
		pin.emit("pointerdown", makePointerEvent({ button: 0 }));
		pin.emit("pointerup", makePointerEvent({ button: 0 }));

		assert.equal(env.rendered.length, 0);
		assert.equal(pin.listenerCount("globalpointermove"), 0);
	}
	finally {
		clock.restore();
		pin._removeEventListeners();
	}
});

// --- hover ------------------------------------------------------------------

test("hovering shows the tooltip by default", () => {
	reset();
	makePin()._onPointerEnter(makePointerEvent());

	assert.equal(tooltip.shown, 1);
});

test("hideTooltip is honored from the pin or from its style", () => {
	reset();
	makePin({ hideTooltip: true })._onPointerEnter(makePointerEvent());
	assert.equal(tooltip.shown, 0, "pin-level flag ignored");

	reset();
	makePin({ style: { hideTooltip: true } })._onPointerEnter(makePointerEvent());
	assert.equal(tooltip.shown, 0, "style-level flag ignored");
});

test("hoverAnimation true is treated as scale, and absent as none", () => {
	let gsap = reset();
	makePin({ style: { hoverAnimation: true } })._onPointerEnter(makePointerEvent());
	assert.equal(gsap.of("to").length, 1, "legacy boolean should animate");

	gsap = reset();
	makePin({ style: {} })._onPointerEnter(makePointerEvent());
	assert.equal(gsap.of("to").length, 0, "no animation configured");

	gsap = reset();
	makePin({ style: { hoverAnimation: "none" } })._onPointerEnter(makePointerEvent());
	assert.equal(gsap.of("to").length, 0, "explicit none");
});

test("every hover animation kills prior tweens on both the pin and its scale", () => {
	for (const anim of ["scale", "pulse", "shake", "brightness", "hue"]) {
		const gsap = reset();
		const pin = makePin({ style: { hoverAnimation: anim } });

		pin._onPointerEnter(makePointerEvent());

		const killed = gsap.of("killTweensOf").map(c => c.target);
		assert.ok(killed.includes(pin), `${anim}: pin tweens not killed`);
		assert.ok(killed.includes(pin.scale), `${anim}: scale tweens not killed`);
	}
});

test("hover reveals the label only when labelShowOnHover is set", () => {
	reset();
	const shown = makePin({ style: { labelShowOnHover: true } });
	shown._labelContainer = { visible: false, parent: null, position: { set() {} } };
	shown._onPointerEnter(makePointerEvent());
	assert.equal(shown._labelContainer.visible, true);

	reset();
	const hidden = makePin({ style: { labelShowOnHover: false } });
	hidden._labelContainer = { visible: false, parent: null, position: { set() {} } };
	hidden._onPointerEnter(makePointerEvent());
	assert.equal(hidden._labelContainer.visible, false);
});

test("leaving hides the tooltip and animates back to rest", () => {
	const gsap = reset();
	const pin = makePin();

	pin._onPointerLeave(makePointerEvent());

	assert.equal(tooltip.hidden, 1);
	const scaleReset = gsap.of("to").find(c => c.target === pin.scale);
	assert.deepEqual([scaleReset.vars.x, scaleReset.vars.y], [1.0, 1.0]);
});

test("without gsap, leaving resets scale and rotation directly", () => {
	reset();
	env.setGsap(undefined);
	const pin = makePin();
	pin.scale.set(1.2);
	pin.rotation = 0.2;

	pin._onPointerLeave(makePointerEvent());

	assert.deepEqual([pin.scale.x, pin.scale.y], [1.0, 1.0]);
	assert.equal(pin.rotation, 0);
});

// --- drag gating ------------------------------------------------------------

test("a GM left-press starts a drag and subscribes global movement", () => {
	reset({ isGM: true });
	const pin = makePin({ x: 100, y: 200 });

	pin._onPointerDown(makePointerEvent({ button: 0, x: 60, y: 70 }));

	assert.equal(pin._isDragging, true);
	assert.equal(pin._hasDragged, false);
	assert.equal(pin.listenerCount("globalpointermove"), 1);
	// Offset is pin position minus the parent-local pointer position.
	assert.deepEqual([pin._dragOffset.x, pin._dragOffset.y], [100 - 50, 200 - 50]);
	assert.deepEqual([pin._dragStartPos.x, pin._dragStartPos.y], [100, 200]);
});

test("a non-GM left-press tracks click movement without starting a drag", () => {
	reset({ isGM: false });
	const pin = makePin();

	pin._onPointerDown(makePointerEvent({ button: 0 }));

	assert.equal(pin._isDragging, false);
	assert.equal(pin.listenerCount("globalpointermove"), 1);
	assert.equal(tooltip.hidden, 1);
	pin._onPointerUpOutside(makePointerEvent({ button: 0 }));
	assert.equal(pin.listenerCount("globalpointermove"), 0);
});

test("left-press always stops propagation, GM or not", () => {
	// Otherwise Foundry starts a selection marquee over the pin.
	for (const isGM of [true, false]) {
		reset({ isGM });
		const event = makePointerEvent({ button: 0 });
		makePin()._onPointerDown(event);
		assert.equal(event.stopped, 1, `isGM=${isGM}`);
	}
});

test("right-press opens the context menu for a GM only", () => {
	reset({ isGM: true });
	const gm = makePin();
	let opened = 0;
	gm._showContextMenu = () => { opened++; };
	gm._onPointerDown(makePointerEvent({ button: 2 }));
	assert.equal(opened, 1);

	reset({ isGM: false });
	const player = makePin();
	let playerOpened = 0;
	player._showContextMenu = () => { playerOpened++; };
	player._onPointerDown(makePointerEvent({ button: 2 }));
	assert.equal(playerOpened, 0);
});

test("the button is read through data.originalEvent as well as nativeEvent", () => {
	for (const native of [true, false]) {
		reset({ isGM: true });
		const pin = makePin();
		let opened = 0;
		pin._showContextMenu = () => { opened++; };
		pin._onPointerDown(makePointerEvent({ button: 2, native }));
		assert.equal(opened, 1, `native=${native}`);
	}
});

// --- drag movement ----------------------------------------------------------

test("movement is ignored entirely when no drag is active", () => {
	reset();
	const pin = makePin({ x: 100, y: 200 });

	pin._onPointerMove(makePointerEvent({ x: 999, y: 999 }));

	assert.deepEqual([pin.position.x, pin.position.y], [100, 200]);
});

test("the pin does not move until the pointer clears a 5px dead zone", () => {
	reset();
	const pin = makePin({ x: 100, y: 200 });
	pin._onPointerDown(makePointerEvent({ button: 0, x: 110, y: 220 }));

	// 5px is on the boundary: the check is strictly greater than.
	pin._onPointerMove(makePointerEvent({ x: 115, y: 225 }));
	assert.equal(pin._hasDragged, false, "5px should not trip the dead zone");
	assert.deepEqual([pin.position.x, pin.position.y], [100, 200]);

	pin._onPointerMove(makePointerEvent({ x: 116, y: 220 }));
	assert.equal(pin._hasDragged, true, "6px should trip it");
	assert.deepEqual([pin.position.x, pin.position.y], [106, 200]);
});

test("a separated label container tracks the pin by its recorded offset", () => {
	reset();
	const pin = makePin({ x: 100, y: 200 });
	const label = { visible: true, parent: new StubParent(), position: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } } };
	pin._labelContainer = label;
	pin._labelOffset = { x: 7, y: -3 };
	pin._onPointerDown(makePointerEvent({ button: 0, x: 110, y: 220 }));

	pin._onPointerMove(makePointerEvent({ x: 150, y: 220 }));

	assert.deepEqual([label.position.x, label.position.y], [pin.position.x + 7, pin.position.y - 3]);
});

// --- release ----------------------------------------------------------------

test("releasing after a real drag persists the rounded position", async () => {
	reset();
	const pin = makePin({ x: 100, y: 200 });
	pin._onPointerDown(makePointerEvent({ button: 0, x: 110, y: 220 }));
	pin._onPointerMove(makePointerEvent({ x: 150.4, y: 260.6 }));

	await pin._onPointerUp(makePointerEvent());

	assert.equal(updates.length, 1);
	assert.equal(updates[0].id, "pin-1");
	assert.deepEqual(updates[0].patch, { x: 140, y: 241 });
	assert.equal(pin._isDragging, false);
	assert.equal(pin._hasDragged, false);
	assert.equal(pin.listenerCount("globalpointermove"), 0);
});

test("a press and release without movement opens the journal instead", async () => {
	reset();
	env.addJournal("j1");
	const pin = makePin({ journalId: "j1" });
	pin._onPointerDown(makePointerEvent({ button: 0, x: 110, y: 220 }));

	await pin._onPointerUp(makePointerEvent());

	assert.equal(updates.length, 0, "a click must not write a position");
	assert.equal(env.rendered.length, 1);
});

// A player cannot drag, so their press never sets _isDragging and the release
// used to fall straight through to the cleanup — leaving a player with no way
// to open a pin at all. Double-click, so a single click still passes through to
// the canvas the way it always has.
test("a player opens the pin's journal by double-clicking it, once", async () => {
	reset({ isGM: false });
	addReadableJournal("j1", { pageIds: ["p9"] });
	const pin = makePin({ journalId: "j1", pageId: "p9" });
	const clock = installClock();

	try {
		await pressAndRelease(pin);
		assert.equal(env.rendered.length, 0, "one click must not open anything");

		clock.advance(399);
		await pressAndRelease(pin);

		assert.deepEqual(env.rendered.map(r => r.args), [[true, { pageId: "p9" }]]);
	}
	finally {
		clock.restore();
	}
});

test("two releases further apart than the window are two clicks, not a double", async () => {
	reset({ isGM: false });
	env.addJournal("j1");
	const pin = makePin({ journalId: "j1", pageId: "p9" });
	const clock = installClock();

	try {
		await pressAndRelease(pin);
		clock.advance(401);
		await pressAndRelease(pin);

		assert.equal(env.rendered.length, 0);
	}
	finally {
		clock.restore();
	}
});

// A pair is consumed by the open, so the third click starts a fresh pair rather
// than opening again off the second one.
test("a third click after a double-click does not open the journal again", async () => {
	reset({ isGM: false });
	addReadableJournal("j1", { pageIds: ["p9"] });
	const pin = makePin({ journalId: "j1", pageId: "p9" });
	const clock = installClock();

	try {
		await pressAndRelease(pin);
		clock.advance(100);
		await pressAndRelease(pin);
		clock.advance(100);
		await pressAndRelease(pin);

		assert.equal(env.rendered.length, 1);
	}
	finally {
		clock.restore();
	}
});

test("a player's double-click never writes a pin position", async () => {
	reset({ isGM: false });
	env.addJournal("j1");
	const pin = makePin({ journalId: "j1" });
	const clock = installClock();

	try {
		for (const _ of [1, 2]) {
			pin._onPointerDown(makePointerEvent({ button: 0, x: 400, y: 400 }));
			pin._onPointerMove(makePointerEvent({ x: 900, y: 900 }));
			await pin._onPointerUp(makePointerEvent({ button: 0, x: 900, y: 900 }));
			clock.advance(100);
		}
	}
	finally {
		clock.restore();
	}

	assert.deepEqual(updates, [], "a player may open a pin, never move one");
	assert.deepEqual([pin.position.x, pin.position.y], [100, 200]);
	assert.equal(env.rendered.length, 0, "moved releases are not click candidates");
});

test("a moved player release invalidates an earlier eligible click", async () => {
	reset({ isGM: false });
	env.addJournal("j1");
	const pin = makePin();
	const clock = installClock();

	try {
		await pressAndRelease(pin);
		clock.advance(100);
		pin._onPointerDown(makePointerEvent({ button: 0, x: 10, y: 10 }));
		pin._onPointerMove(makePointerEvent({ button: 0, x: 16, y: 10 }));
		await pin._onPointerUp(makePointerEvent({ button: 0, x: 16, y: 10 }));
		clock.advance(100);
		await pressAndRelease(pin);

		assert.equal(env.rendered.length, 0);
	}
	finally {
		clock.restore();
	}
});

test("registered player movement invalidates a click pair and cleans up its listener", () => {
	reset({ isGM: false });
	addReadableJournal("j1");
	const pin = makePin();
	const clock = installClock();
	pin._setupEventListeners();

	try {
		pin.emit("pointerdown", makePointerEvent({ button: 0, x: 10, y: 10 }));
		assert.equal(pin.listenerCount("globalpointermove"), 1);
		pin.emit("pointerup", makePointerEvent({ button: 0, x: 10, y: 10 }));
		assert.equal(pin.listenerCount("globalpointermove"), 0);

		clock.advance(100);
		pin.emit("pointerdown", makePointerEvent({ button: 0, x: 10, y: 10 }));
		pin.emit("globalpointermove", makePointerEvent({ button: 0, x: 16, y: 10 }));
		assert.equal(pin.listenerCount("globalpointermove"), 0);
		pin.emit("pointerup", makePointerEvent({ button: 0, x: 16, y: 10 }));

		clock.advance(100);
		pin.emit("pointerdown", makePointerEvent({ button: 0, x: 10, y: 10 }));
		pin.emit("pointerup", makePointerEvent({ button: 0, x: 10, y: 10 }));

		assert.equal(env.rendered.length, 0);
		assert.deepEqual(updates, []);
		assert.deepEqual([pin.position.x, pin.position.y], [100, 200]);
		assert.equal(pin.listenerCount("globalpointermove"), 0);
	}
	finally {
		clock.restore();
		pin._removeEventListeners();
	}
});

test("a right click invalidates a player's eligible click pair", async () => {
	reset({ isGM: false });
	env.addJournal("j1");
	const pin = makePin();
	const clock = installClock();

	try {
		await pressAndRelease(pin);
		clock.advance(100);
		pin._onPointerDown(makePointerEvent({ button: 2 }));
		await pin._onPointerUp(makePointerEvent({ button: 2 }));
		clock.advance(100);
		await pressAndRelease(pin);

		assert.equal(env.rendered.length, 0);
	}
	finally {
		clock.restore();
	}
});

test("an outside release invalidates a player's eligible click pair", async () => {
	reset({ isGM: false });
	env.addJournal("j1");
	const pin = makePin();
	const clock = installClock();

	try {
		await pressAndRelease(pin);
		clock.advance(100);
		pin._onPointerDown(makePointerEvent({ button: 0 }));
		await pin._onPointerUpOutside(makePointerEvent({ button: 0 }));
		clock.advance(100);
		await pressAndRelease(pin);

		assert.equal(env.rendered.length, 0);
	}
	finally {
		clock.restore();
	}
});

test("mixed pointer buttons cannot complete a player's click pair", async () => {
	reset({ isGM: false });
	env.addJournal("j1");
	const pin = makePin();
	const clock = installClock();

	try {
		await pressAndRelease(pin);
		clock.advance(100);
		pin._onPointerDown(makePointerEvent({ button: 0 }));
		await pin._onPointerUp(makePointerEvent({ button: 2 }));
		clock.advance(100);
		await pressAndRelease(pin);

		assert.equal(env.rendered.length, 0);
	}
	finally {
		clock.restore();
	}
});

test("an intervening different pin invalidates a player's click pair", async () => {
	reset({ isGM: false });
	env.addJournal("j1");
	const first = makePin({ id: "pin-1" });
	const second = makePin({ id: "pin-2" });
	const clock = installClock();

	try {
		await pressAndRelease(first);
		clock.advance(100);
		await pressAndRelease(second);
		clock.advance(100);
		await pressAndRelease(first);

		assert.equal(env.rendered.length, 0);
	}
	finally {
		clock.restore();
	}
});

test("a failed position save snaps the pin back to its stored coordinates", async () => {
	reset();
	const pin = makePin({ x: 100, y: 200 });
	pin._onPointerDown(makePointerEvent({ button: 0, x: 110, y: 220 }));
	pin._onPointerMove(makePointerEvent({ x: 300, y: 400 }));
	updateFails = true;

	// The handler reports the failure through console.error; capture it so the
	// deliberate failure does not read as a broken test run.
	const realError = console.error;
	const logged = [];
	console.error = (...args) => logged.push(args);
	try {
		await pin._onPointerUp(makePointerEvent());
	}
	finally {
		console.error = realError;
	}

	assert.equal(logged.length, 1, "the failure must still be reported");
	assert.deepEqual([pin.position.x, pin.position.y], [100, 200]);
	assert.equal(pin._isDragging, false);
});

test("releasing without an active drag still clears the movement listener", async () => {
	reset();
	const pin = makePin();
	pin.on("globalpointermove", pin._onPointerMove, pin);

	await pin._onPointerUp(makePointerEvent());

	assert.equal(pin.listenerCount("globalpointermove"), 0);
	assert.equal(updates.length, 0);
});

// --- opening ----------------------------------------------------------------

test("the protected openPinJournal export keeps its graphics-pin call contract", () => {
	reset();
	addReadableJournal("j1", { pageIds: ["p9"] });
	const pin = makePin({ journalId: "j1", pageId: "p9" });

	const result = openPinJournal(pin);

	assert.equal(result, undefined);
	assert.deepEqual(env.rendered[0].args, [true, { pageId: "p9" }]);
});

test("opening passes the pageId through when the pin targets a page", () => {
	reset();
	env.rendered.length = 0;
	addReadableJournal("j1", { pageIds: ["p9"] });

	makePin({ journalId: "j1", pageId: "p9" })._openJournal();

	assert.deepEqual(env.rendered[0].args, [true, { pageId: "p9" }]);
});

test("opening a pageless pin renders the sheet with no page argument", () => {
	reset();
	env.rendered.length = 0;
	env.addJournal("j1");

	makePin({ journalId: "j1" })._openJournal();

	assert.deepEqual(env.rendered[0].args, [true]);
});

test("a missing journal warns instead of throwing", () => {
	reset();
	env.notifications.warn.length = 0;

	makePin({ journalId: "does-not-exist" })._openJournal();

	assert.equal(env.notifications.warn.length, 1);
});

// --- context menu -----------------------------------------------------------

const BASE_ITEMS = ["Open Journal", "Bring Players Here", "Ping Pin", "Edit Style", "Duplicate Pin"];

test("a GM sees the base items plus the ownership actions", () => {
	reset({ isGM: true });

	makePin()._showContextMenu(makePointerEvent({ button: 2 }));

	assert.deepEqual(menuLabels(), [
		...BASE_ITEMS, "Copy Style", "Make GM-Only", "Delete Pin",
	]);
});

test("Paste Style appears only once a style has been copied", () => {
	reset({ isGM: true });
	makePin()._showContextMenu(makePointerEvent({ button: 2 }));
	assert.ok(!menuLabels().includes("Paste Style"));

	reset({ isGM: true });
	hasCopiedStyle = true;
	makePin()._showContextMenu(makePointerEvent({ button: 2 }));
	assert.ok(menuLabels().includes("Paste Style"));
});

test("the visibility toggle names the state it will move to", () => {
	reset({ isGM: true });
	const pin = makePin();
	pin.pinData.gmOnly = false;
	pin._showContextMenu(makePointerEvent({ button: 2 }));
	assert.ok(menuLabels().includes("Make GM-Only"));

	reset({ isGM: true });
	const hidden = makePin();
	hidden.pinData.gmOnly = true;
	hidden._showContextMenu(makePointerEvent({ button: 2 }));
	assert.ok(menuLabels().includes("Make Visible to All"));
});

// Documents current behavior. _onPointerDown only reaches _showContextMenu for
// a GM, so in practice these rows are GM-only anyway — but the menu itself does
// not gate them, and their callbacks refuse with a warning rather than being
// absent. Worth knowing before anyone reuses this builder somewhere unguarded.
test("the base items are built without a GM check", () => {
	reset({ isGM: false });

	makePin()._showContextMenu(makePointerEvent({ button: 2 }));

	assert.deepEqual(menuLabels(), BASE_ITEMS);
});

test("a non-GM invoking Bring Players Here is refused with a warning", async () => {
	reset({ isGM: false });
	makePin()._showContextMenu(makePointerEvent({ button: 2 }));

	clickMenuItem("Bring Players Here");
	await new Promise(r => { setTimeout(r, 0); });

	assert.equal(env.notifications.warn.length, 1);
});

test("the menu is positioned from the canvas rect plus the pointer position", () => {
	reset({ isGM: true });
	globalThis.canvas.app.view.getBoundingClientRect = () => ({ left: 40, top: 15 });

	makePin()._showContextMenu(makePointerEvent({ button: 2, x: 200, y: 300 }));

	const menu = dom.getElementById("sdx-journal-pin-context-menu");
	assert.match(menu.style.cssText, /left:240px/);
	assert.match(menu.style.cssText, /top:315px/);
	globalThis.canvas.app.view.getBoundingClientRect = () => ({ left: 0, top: 0 });
});

test("opening the menu suppresses the browser's own context menu", () => {
	reset({ isGM: true });
	const event = makePointerEvent({ button: 2 });

	makePin()._showContextMenu(event);

	assert.equal(event.prevented, 1);
});

test("Delete Pin routes to the manager with this pin's id", async () => {
	reset({ isGM: true });
	makePin()._showContextMenu(makePointerEvent({ button: 2 }));

	clickMenuItem("Delete Pin");
	await new Promise(r => { setTimeout(r, 0); });

	assert.deepEqual(managerCalls, [{ name: "delete", arg: "pin-1" }]);
});

test("the visibility toggle writes the inverted flag", async () => {
	reset({ isGM: true });
	const pin = makePin();
	pin.pinData.gmOnly = false;
	pin._showContextMenu(makePointerEvent({ button: 2 }));

	clickMenuItem("Make GM-Only");
	await new Promise(r => { setTimeout(r, 0); });

	assert.deepEqual(updates, [{ id: "pin-1", patch: { gmOnly: true } }]);
});
