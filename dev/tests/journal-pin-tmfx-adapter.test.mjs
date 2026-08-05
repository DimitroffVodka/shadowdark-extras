// Characterization tests for the document/flag adapter on JournalPinGraphics,
// captured BEFORE it is extracted out of pin-rendering.mjs.
//
// A journal pin is a bare PIXI container, but TokenMagic FX expects to be
// handed something that behaves like a Foundry placeable: a `document` with
// flag accessors, a stable id, and a set of _TMFX* hooks. This adapter is that
// impersonation, and everything in it is a contract with a third-party module —
// exactly the kind of code that breaks quietly when moved.

import assert from "node:assert/strict";
import test from "node:test";

import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";

const env = installCanvasGlobals();

const { JournalPinGraphics } = await import("../../scripts/journal/pin-rendering.mjs");
const { JournalPinManager } = await import("../../scripts/journal/pin-manager.mjs");

const updates = [];
JournalPinManager.update = async (id, patch) => {
	updates.push({ id, patch });
	return "updated";
};

function makePin({ flags, label, id = "pin-1" } = {}) {
	return new JournalPinGraphics({ id, journalId: "j1", x: 0, y: 0, flags, label });
}

function reset() {
	updates.length = 0;
	globalThis.window.TokenMagic = undefined;
}

// --- the document impersonation ---------------------------------------------

test("the document wrapper carries the identity TMFX reads", () => {
	reset();
	const pin = makePin({ label: "Tavern" });

	const doc = pin.document;

	assert.equal(doc.id, "pin-1");
	assert.equal(doc.documentName, "JournalPin");
	assert.equal(doc.name, "Tavern");
	assert.equal(doc.parent, globalThis.canvas.scene);
});

test("an unlabelled pin gets a default document name", () => {
	reset();
	assert.equal(makePin().document.name, "Journal Pin");
});

test("the wrapper's flag methods route back to the pin", async () => {
	reset();
	const pin = makePin({ flags: { tokenmagic: { filters: ["a"] } } });

	assert.deepEqual(pin.document.getFlag("tokenmagic", "filters"), ["a"]);
	await pin.document.setFlag("tokenmagic", "filters", ["b"]);

	assert.deepEqual(updates, [{ id: "pin-1", patch: { "flags.tokenmagic.filters": ["b"] } }]);
});

// Documents current behavior. `object` is a getter on the returned literal, so
// `this` is the wrapper — document.object is the wrapper, not the pin. TMFX
// normally uses document.object to get back to the placeable, so this is worth
// knowing before anyone relies on it; it is left as-is here rather than
// "fixed" inside a move.
test("document.object returns the wrapper itself, not the pin", () => {
	reset();
	const pin = makePin();
	const doc = pin.document;

	assert.equal(doc.object, doc);
	assert.notEqual(doc.object, pin);
});

test("a fresh wrapper is produced per access", () => {
	reset();
	const pin = makePin();

	assert.notEqual(pin.document, pin.document);
});

test("the pin's id mirrors its data", () => {
	reset();
	assert.equal(makePin({ id: "abc" }).id, "abc");
});

// --- flag accessors ---------------------------------------------------------

test("getFlag resolves a scope and key, a whole scope, or everything", () => {
	reset();
	const flags = { tokenmagic: { filters: [1], animeInfo: { a: 1 } }, other: { x: 2 } };
	const pin = makePin({ flags });

	assert.deepEqual(pin.getFlag("tokenmagic", "filters"), [1]);
	assert.deepEqual(pin.getFlag("tokenmagic"), flags.tokenmagic);
	assert.deepEqual(pin.getFlag(), flags);
});

test("getFlag on a pin with no flags yields empty rather than throwing", () => {
	reset();
	const pin = makePin();

	assert.deepEqual(pin.getFlag(), {});
	assert.equal(pin.getFlag("tokenmagic", "filters"), undefined);
});

test("setFlag writes a dotted flag path through the manager", async () => {
	reset();
	const result = await makePin().setFlag("scope", "key", { v: 1 });

	assert.deepEqual(updates, [{ id: "pin-1", patch: { "flags.scope.key": { v: 1 } } }]);
	assert.equal(result, "updated", "the manager's return value must pass through");
});

test("unsetFlag writes the v14 deletion sentinel, not a legacy -= key", async () => {
	reset();
	await makePin().unsetFlag("tokenmagic", "filters");

	assert.equal(updates.length, 1);
	const patch = updates[0].patch;
	assert.deepEqual(Object.keys(patch), ["flags.tokenmagic.filters"]);
	assert.ok(patch["flags.tokenmagic.filters"] instanceof foundry.data.operators.ForcedDeletion);
});

// --- TMFX hooks -------------------------------------------------------------

test("the TMFX flag hooks target the tokenmagic scope", async () => {
	reset();
	const pin = makePin();

	await pin._TMFXsetFlag(["f"]);
	await pin._TMFXsetAnimeFlag({ a: 1 });

	assert.deepEqual(updates.map(u => Object.keys(u.patch)[0]), [
		"flags.tokenmagic.filters", "flags.tokenmagic.animeInfo",
	]);
});

test("the TMFX unset hooks use the deletion sentinel too", async () => {
	reset();
	const pin = makePin();

	await pin._TMFXunsetFlag();
	await pin._TMFXunsetAnimeFlag();

	assert.deepEqual(updates.map(u => Object.keys(u.patch)[0]), [
		"flags.tokenmagic.filters", "flags.tokenmagic.animeInfo",
	]);
	assert.ok(updates.every(u =>
		Object.values(u.patch)[0] instanceof foundry.data.operators.ForcedDeletion));
});

test("the pin reports itself as its own TMFX sprite", () => {
	reset();
	const pin = makePin();

	assert.equal(pin._TMFXgetPlaceableType(), "JournalPin");
	assert.equal(pin._TMFXgetSprite(), pin);
	assert.equal(pin._TMFXcheckSprite(), true);
});

test("filter rank starts high when nothing is applied, then climbs", () => {
	reset();
	const pin = makePin();

	assert.equal(pin._TMFXgetMaxFilterRank(), 10000);

	pin.filters = [{ rank: 5 }, { rank: 12 }, {}];
	assert.equal(pin._TMFXgetMaxFilterRank(), 13, "one above the highest rank");
});

test("raw filters replace on an array, clear on null, and append otherwise", () => {
	reset();
	const pin = makePin();

	pin._TMFXsetRawFilters([{ a: 1 }]);
	assert.deepEqual(pin.filters, [{ a: 1 }]);

	pin._TMFXsetRawFilters({ b: 2 });
	assert.deepEqual(pin.filters, [{ a: 1 }, { b: 2 }]);

	pin._TMFXsetRawFilters(null);
	assert.equal(pin.filters, null);

	// After a clear, a non-array pushes onto a freshly created list.
	pin._TMFXsetRawFilters({ c: 3 });
	assert.deepEqual(pin.filters, [{ c: 3 }]);
});

// --- optional dependency ----------------------------------------------------

test("the filter calls are inert when TokenMagic is absent", async () => {
	reset();
	const pin = makePin();

	// Must not throw — TokenMagic is an optional dependency.
	await pin.TMFXaddFilters([{ a: 1 }]);
	await pin.TMFXupdateFilters([{ a: 1 }]);
	await pin.TMFXdeleteFilters();
});

test("the filter calls hand the pin itself to TokenMagic when present", async () => {
	reset();
	const seen = [];
	globalThis.window.TokenMagic = {
		addFilters: (...a) => seen.push(["addFilters", ...a]),
		updateFiltersByPlaceable: (...a) => seen.push(["updateFiltersByPlaceable", ...a]),
		deleteFilters: (...a) => seen.push(["deleteFilters", ...a]),
	};
	const pin = makePin();

	await pin.TMFXaddFilters([{ a: 1 }]);
	await pin.TMFXupdateFilters([{ b: 2 }]);
	await pin.TMFXdeleteFilters("filter-1");

	assert.deepEqual(seen, [
		["addFilters", pin, [{ a: 1 }], false],
		["updateFiltersByPlaceable", pin, [{ b: 2 }]],
		["deleteFilters", pin, "filter-1"],
	]);
	reset();
});
