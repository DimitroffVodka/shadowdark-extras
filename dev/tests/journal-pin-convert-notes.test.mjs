// Converting Foundry Map Notes into journal pins — the visibility question.
//
// A GM converts a scene's map notes in bulk, usually while prepping: the notes
// are keyed room descriptions, secret doors, "what the party finds here". Pins
// created from them therefore start GM-only, and are revealed one at a time
// through the visibility toggle the pin list and context menu already offer.
//
// Visibility is asserted through checkPinVisibility as a player, which is what
// the renderer consults, rather than by reading the stored flag.
//
// The pin scene is deliberately NOT the active one, so `update` does not reach
// into the renderer — that path needs a live PIXI tree and is not under test.

import assert from "node:assert/strict";
import test from "node:test";

import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";

const env = installCanvasGlobals();
let nextId = 0;
globalThis.foundry.utils.randomID = () => `pin-${++nextId}`;
globalThis.game.scenes = new Map();
globalThis.canvas.scene = { id: "some-other-scene" };
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };

const { JournalPinManager, checkPinVisibility } =
	await import("../../scripts/journal/pin-manager.mjs");

const SCENE_ID = "pins-scene";

/** A scene holding map notes, whose pin flag is readable and writable. */
function makeScene(notes) {
	const flags = {};
	const scene = {
		id: SCENE_ID,
		notes: { contents: notes, size: notes.length },
		getFlag: (scope, key) => flags[`${scope}.${key}`],
		setFlag: async (scope, key, value) => { flags[`${scope}.${key}`] = value; },
		deleteEmbeddedDocuments: async () => {},
	};
	globalThis.game.scenes.set(SCENE_ID, scene);
	return scene;
}

function makeNote({ id = "note-1", text = "Old Well" } = {}) {
	return {
		id,
		x: 100,
		y: 200,
		entryId: "j1",
		pageId: null,
		text,
		iconSize: 40,
		texture: { src: "icons/svg/door-closed.svg" },
	};
}

/** Convert one note and hand back the pin it produced. */
async function convertOneNote() {
	makeScene([makeNote()]);
	env.setGM(true);
	const result = await JournalPinManager.convertNotesToPins({ sceneId: SCENE_ID });
	assert.equal(result.created, 1, "the note must have converted");
	const [created] = JournalPinManager.list({ sceneId: SCENE_ID });
	return created;
}

test("a pin converted from a map note starts hidden from players", async () => {
	const created = await convertOneNote();

	env.setGM(false);

	assert.equal(checkPinVisibility(created), false);
});

test("the GM still sees a converted pin", async () => {
	const created = await convertOneNote();

	assert.equal(checkPinVisibility(created), true);
});

test("the visibility toggle reveals a converted pin to players", async () => {
	const created = await convertOneNote();

	await JournalPinManager.update(created.id, { gmOnly: false }, { sceneId: SCENE_ID });
	const revealed = JournalPinManager.get(created.id, { sceneId: SCENE_ID });
	env.setGM(false);

	assert.equal(checkPinVisibility(revealed), true);
});
