// The dungeon tools are destructive and were one-way: the only recovery from a
// wrong action was Clear, which throws away everything rather than the mistake.
// That made trying anything cost the price of redoing all of it.
//
// Undo reverses the last action. Creations are deleted, deletions are restored
// with their ids, and a retexture is both — the document comes back as it was.

import assert from "node:assert/strict";
import test from "node:test";

globalThis.game = { user: { isGM: true } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const {
	clearDungeonHistory,
	pendingUndoLabel,
	recordDungeonAction,
	undoLastDungeonAction,
} = await import("../../scripts/dungeon/dungeon-undo.mjs");

function makeScene(collections = {}) {
	const scene = {
		calls: [],
		collections: {
			Drawing: new Map(Object.entries(collections.Drawing ?? {})),
			Tile: new Map(Object.entries(collections.Tile ?? {})),
		},
		getEmbeddedCollection(type) {
			return scene.collections[type];
		},
		async deleteEmbeddedDocuments(type, ids) {
			scene.calls.push({ op: "delete", type, ids });
			for (const id of ids) scene.collections[type].delete(id);
			return ids;
		},
		async createEmbeddedDocuments(type, data, options) {
			scene.calls.push({ op: "create", type, data, options });
			for (const d of data) scene.collections[type].set(d._id, d);
			return data;
		},
	};
	return scene;
}

test("undo deletes what an action created", async () => {
	clearDungeonHistory();
	const scene = makeScene({ Drawing: { a: {}, b: {} } });
	recordDungeonAction("Floor room", { created: [{ type: "Drawing", ids: ["a", "b"] }] });

	assert.equal(pendingUndoLabel(), "Floor room");
	assert.equal(await undoLastDungeonAction(scene), "Floor room");
	assert.deepEqual(scene.calls, [{ op: "delete", type: "Drawing", ids: ["a", "b"] }]);
});

test("undo restores what an action deleted, keeping ids", async () => {
	clearDungeonHistory();
	const scene = makeScene();
	recordDungeonAction("Erase floor", {
		deleted: [{ type: "Drawing", data: [{ _id: "gone", x: 5 }] }],
	});

	await undoLastDungeonAction(scene);

	assert.equal(scene.calls[0].op, "create");
	assert.deepEqual(scene.calls[0].data, [{ _id: "gone", x: 5 }]);
	assert.deepEqual(scene.calls[0].options, { keepId: true },
		"the id must survive so a later undo and anything holding it still resolve");
});

test("a retexture is reversed by restoring the original document", async () => {
	clearDungeonHistory();
	const scene = makeScene({ Drawing: { room: {} } });
	recordDungeonAction("Paint room floor", {
		created: [{ type: "Drawing", ids: ["room"] }],
		deleted: [{ type: "Drawing", data: [{ _id: "room", texture: "old.webp" }] }],
	});

	await undoLastDungeonAction(scene);

	// Delete then re-create with the old data: the room comes back as it was.
	assert.deepEqual(scene.calls.map(c => c.op), ["delete", "create"]);
	assert.equal(scene.calls[1].data[0].texture, "old.webp");
});

test("ids the user already removed by hand are skipped, not re-deleted", async () => {
	clearDungeonHistory();
	const scene = makeScene({ Drawing: { a: {} } });
	recordDungeonAction("Floor room", { created: [{ type: "Drawing", ids: ["a", "vanished"] }] });

	await undoLastDungeonAction(scene);

	assert.deepEqual(scene.calls[0].ids, ["a"], "deleting a missing id would throw");
});

test("undo is one action at a time, most recent first", async () => {
	clearDungeonHistory();
	const scene = makeScene({ Drawing: { first: {}, second: {} } });
	recordDungeonAction("First", { created: [{ type: "Drawing", ids: ["first"] }] });
	recordDungeonAction("Second", { created: [{ type: "Drawing", ids: ["second"] }] });

	assert.equal(await undoLastDungeonAction(scene), "Second");
	assert.equal(await undoLastDungeonAction(scene), "First");
	assert.equal(await undoLastDungeonAction(scene), null, "and then nothing is left");
});

test("an action that changed nothing is not recorded", async () => {
	// Otherwise pressing Undo appears to do nothing, because it spent itself on
	// an entry with no work in it.
	clearDungeonHistory();
	recordDungeonAction("No-op", { created: [{ type: "Drawing", ids: [] }] });

	assert.equal(pendingUndoLabel(), null);
});

test("history is bounded", async () => {
	clearDungeonHistory();
	for (let i = 0; i < 25; i++) {
		recordDungeonAction(`Action ${i}`, { created: [{ type: "Drawing", ids: [`d${i}`] }] });
	}
	// Each entry pins the full data of deleted documents, so the stack cannot
	// grow without limit.
	assert.equal(pendingUndoLabel(), "Action 24");

	const scene = makeScene();
	let undone = 0;
	while (await undoLastDungeonAction(scene) !== null) undone += 1;
	assert.ok(undone <= 10, `kept ${undone} entries, expected the cap to hold`);
});
