// Coverage for JournalPinManager.update's flag/style merge — issue #92.
//
// This path had none, and could not have had any. `update` calls
// `foundry.utils.expandObject` before merging, and neither test harness stubbed
// it, so the first test to reach the real function would have thrown
// "expandObject is not a function". Both existing pin tests sidestep that by
// replacing `JournalPinManager.update` wholesale:
//
//   dev/tests/journal-pin-interactions.test.mjs:40
//   dev/tests/journal-pin-tmfx-adapter.test.mjs:21
//
// So the merge that decides whether a flag patch KEEPS its sibling keys was
// never executed by anything. That is the gap this closes.
//
// The merge has to recurse. `expandObject` turns "flags.scope.key" into nested
// structure by construction, so a shallow merge would replace the whole
// `flags.<scope>` object and silently drop every other key under it — a pin
// would lose unrelated flags every time one of them was edited.

import assert from "node:assert/strict";
import test from "node:test";

import { deepClone, expandObject, mergeObject, getProperty } from "./helpers/foundry-utils.mjs";

const MODULE_ID = "shadowdark-extras";

globalThis.foundry = {
	utils: { deepClone, expandObject, mergeObject, getProperty, randomID: () => "test-id" },
};

/** A scene whose pin flag is readable and writable, recording each write. */
function makeScene(id, pins) {
	const flags = {};
	return {
		id,
		writes: [],
		getFlag: (scope, key) => flags[`${scope}.${key}`],
		setFlag: async (scope, key, value) => {
			flags[`${scope}.${key}`] = value;
			return value;
		},
		seed(key, value) { flags[`${MODULE_ID}.${key}`] = value; },
		read(key) { return flags[`${MODULE_ID}.${key}`]; },
		pins,
	};
}

let scene;

globalThis.game = {
	user: { isGM: true },
	scenes: { get: id => (id === scene?.id ? scene : null) },
};
// Deliberately NOT the pin scene: `update` only reaches into pin-rendering when
// the edited scene is the active one, and that import is not what is under test.
globalThis.canvas = { scene: { id: "some-other-scene" } };
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };

const { JournalPinManager } = await import("../../scripts/journal/pin-manager.mjs");
const FLAG_KEY = JournalPinManager.FLAG_KEY;

/** Install one pin carrying two sibling flags under our namespace. */
function seedPin(extra = {}) {
	scene = makeScene("pins-scene", null);
	scene.seed(FLAG_KEY, [{
		id: "pin-1",
		x: 10,
		y: 20,
		label: "Original",
		style: { size: 32, ringColor: "#ffffff" },
		flags: { [MODULE_ID]: { keep: "untouched", edit: "before" } },
		...extra,
	}]);
	return scene;
}

const storedPin = () => scene.read(FLAG_KEY)[0];

// --- the sibling-key guarantee ----------------------------------------------

test("patching one flag with a flattened key keeps its siblings", async () => {
	seedPin();

	await JournalPinManager.update("pin-1", {
		[`flags.${MODULE_ID}.edit`]: "after",
	}, { sceneId: "pins-scene" });

	assert.deepEqual(storedPin().flags[MODULE_ID], {
		keep: "untouched",
		edit: "after",
	});
});

test("patching a flag adds a new key without disturbing the existing ones", async () => {
	seedPin();

	await JournalPinManager.update("pin-1", {
		[`flags.${MODULE_ID}.added`]: 42,
	}, { sceneId: "pins-scene" });

	assert.deepEqual(storedPin().flags[MODULE_ID], {
		keep: "untouched",
		edit: "before",
		added: 42,
	});
});

test("a foreign namespace's flags are left alone by a patch to ours", async () => {
	seedPin({ flags: { [MODULE_ID]: { keep: "untouched", edit: "before" }, other: { theirs: 1 } } });

	await JournalPinManager.update("pin-1", {
		[`flags.${MODULE_ID}.edit`]: "after",
	}, { sceneId: "pins-scene" });

	assert.deepEqual(storedPin().flags.other, { theirs: 1 });
});

test("a nested flag patch merges rather than replacing the branch", async () => {
	seedPin({ flags: { [MODULE_ID]: { nested: { a: 1, b: 2 } } } });

	await JournalPinManager.update("pin-1", {
		[`flags.${MODULE_ID}.nested.a`]: 9,
	}, { sceneId: "pins-scene" });

	assert.deepEqual(storedPin().flags[MODULE_ID].nested, { a: 9, b: 2 });
});

// --- style merges through the same path -------------------------------------

test("a flattened style patch keeps the rest of the style", async () => {
	seedPin();

	await JournalPinManager.update("pin-1", {
		"style.ringColor": "#ff0000",
	}, { sceneId: "pins-scene" });

	assert.deepEqual(storedPin().style, { size: 32, ringColor: "#ff0000" });
});

// --- the plain fields still work --------------------------------------------

test("scalar fields are applied and the pin is written back once", async () => {
	seedPin();

	const returned = await JournalPinManager.update("pin-1", {
		label: "Renamed",
		x: 99,
	}, { sceneId: "pins-scene" });

	assert.equal(storedPin().label, "Renamed");
	assert.equal(storedPin().x, 99);
	assert.equal(returned.label, "Renamed");
	assert.equal(scene.read(FLAG_KEY).length, 1, "the pin list grew or shrank");
});

test("the returned pin is a clone, not the stored object", async () => {
	seedPin();

	const returned = await JournalPinManager.update("pin-1", { label: "Renamed" }, { sceneId: "pins-scene" });
	returned.label = "mutated by the caller";

	assert.equal(storedPin().label, "Renamed");
});

// --- guards ------------------------------------------------------------------

test("updating an unknown pin throws rather than writing", async () => {
	seedPin();

	await assert.rejects(
		() => JournalPinManager.update("no-such-pin", { label: "x" }, { sceneId: "pins-scene" }),
		/Pin not found/,
	);
});

test("a non-GM cannot update a pin", async () => {
	seedPin();
	globalThis.game.user.isGM = false;

	await assert.rejects(
		() => JournalPinManager.update("pin-1", { label: "x" }, { sceneId: "pins-scene" }),
		/Only GMs can update/,
	);

	globalThis.game.user.isGM = true;
	assert.equal(storedPin().label, "Original", "a rejected update still wrote");
});
