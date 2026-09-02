// An SDX wall is two documents on two layers — a Drawing for the art and a Wall
// for the collision — and before pairing, removing one meant hand-deleting both.
// These tests pin the three properties that make Delete behave as one object:
//
//   1. deleting either half takes the other, whichever layer it came from
//   2. the cascade terminates instead of ping-ponging between the two hooks
//   3. SDX's own bulk deletes can suppress it, because they already remove both
//      halves by id and would otherwise race the cascade to the same documents
//
// NOT TESTED HERE — that legacy documents keep working. findPairedWall's
// endpoint fallback is exercised, but the real assurance is that pairing is
// additive: an unpaired document has no pair id, so cascade() returns before it
// touches anything.

import assert from "node:assert/strict";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";

/** Minimal stand-ins for the two embedded collections and their delete hook. */
function makeScene() {
	const hooks = { deleteDrawing: [], deleteWall: [] };
	const scene = {
		deletions: [],
		drawings: [],
		walls: [],
		async deleteEmbeddedDocuments(type, ids) {
			const key = type === "Wall" ? "walls" : "drawings";
			const removed = scene[key].filter(d => ids.includes(d.id));
			// A stale id is exactly the corruption suppression exists to prevent,
			// so make it loud rather than letting the test pass over it.
			for (const id of ids) {
				assert.ok(removed.some(d => d.id === id), `deleted a document that was already gone: ${id}`);
			}
			scene[key] = scene[key].filter(d => !ids.includes(d.id));
			scene.deletions.push({ type, ids: [...ids] });
			for (const doc of removed) {
				for (const fn of hooks[type === "Wall" ? "deleteWall" : "deleteDrawing"]) fn(doc);
			}
			return removed;
		},
	};
	return { scene, hooks };
}

function pairedDocs(scene, pairId) {
	const drawing = { id: `d-${pairId}`, parent: scene, flags: { [MODULE_ID]: { wallPairId: pairId } } };
	const wall = { id: `w-${pairId}`, parent: scene, c: [0, 0, 100, 0], flags: { [MODULE_ID]: { wallPairId: pairId } } };
	scene.drawings.push(drawing);
	scene.walls.push(wall);
	return { drawing, wall };
}

// One module instance for the whole file, deliberately. A cache-busting dynamic
// import would give each test its own copy, but it would also be the only
// computed dynamic import in the tree, which structural-gates.test.mjs treats as
// a manual smoke-test obligation — not something to take on for test hygiene.
//
// Sharing is safe because the module's only mutable state is the suppression
// depth, and every path that raises it lowers it in a finally. "suppression is
// lifted afterwards" below is what keeps that honest.
const pairsModule = await import("../../scripts/dungeon/dungeon-wall-pairs.mjs");

/** Point the module's globals at this test's scene, then hand it back. */
function loadPairs(hooks) {
	globalThis.game = { user: { isGM: true } };
	globalThis.foundry = { utils: { randomID: () => `id${scene_counter += 1}` } };
	globalThis.Hooks = { on: (name, fn) => hooks[name]?.push(fn) };
	return pairsModule;
}
let scene_counter = 0;

test("deleting the art removes the collision", async () => {
	const { scene, hooks } = makeScene();
	const pairs = loadPairs(hooks);
	pairs.registerWallPairCascade();
	const { drawing } = pairedDocs(scene, "p1");

	await scene.deleteEmbeddedDocuments("Drawing", [drawing.id]);
	await new Promise(r => setImmediate(r));

	assert.equal(scene.walls.length, 0, "the paired wall must go with the drawing");
	assert.deepEqual(scene.deletions.map(d => d.type), ["Drawing", "Wall"]);
});

test("deleting the collision removes the art", async () => {
	const { scene, hooks } = makeScene();
	const pairs = loadPairs(hooks);
	pairs.registerWallPairCascade();
	const { wall } = pairedDocs(scene, "p2");

	await scene.deleteEmbeddedDocuments("Wall", [wall.id]);
	await new Promise(r => setImmediate(r));

	assert.equal(scene.drawings.length, 0, "the paired drawing must go with the wall");
	assert.deepEqual(scene.deletions.map(d => d.type), ["Wall", "Drawing"]);
});

test("the cascade terminates instead of ping-ponging", async () => {
	const { scene, hooks } = makeScene();
	const pairs = loadPairs(hooks);
	pairs.registerWallPairCascade();
	const { drawing } = pairedDocs(scene, "p3");

	await scene.deleteEmbeddedDocuments("Drawing", [drawing.id]);
	await new Promise(r => setImmediate(r));

	// Exactly two deletes: the original and its one partner. A third would mean
	// the partner's own hook found its way back to something.
	assert.equal(scene.deletions.length, 2, JSON.stringify(scene.deletions));
});

test("an unpaired document cascades to nothing", async () => {
	const { scene, hooks } = makeScene();
	const pairs = loadPairs(hooks);
	pairs.registerWallPairCascade();
	scene.drawings.push({ id: "loose", parent: scene, flags: {} });
	scene.walls.push({ id: "other", parent: scene, c: [0, 0, 1, 1], flags: {} });

	await scene.deleteEmbeddedDocuments("Drawing", ["loose"]);
	await new Promise(r => setImmediate(r));

	assert.equal(scene.walls.length, 1, "an unpaired delete must not touch other documents");
});

test("a suppressed bulk delete can remove both halves by id itself", async () => {
	// This is the clearSceneAtLevel shape: collect ids for both layers up front,
	// then delete each layer. Without suppression the wall delete cascades into
	// the drawings, and the drawing delete then references documents that are
	// already gone — which makeScene asserts against.
	const { scene, hooks } = makeScene();
	const pairs = loadPairs(hooks);
	pairs.registerWallPairCascade();
	pairedDocs(scene, "a");
	pairedDocs(scene, "b");

	const wallIds = scene.walls.map(w => w.id);
	const drawingIds = scene.drawings.map(d => d.id);

	await pairs.withoutPairCascade(async () => {
		await scene.deleteEmbeddedDocuments("Wall", wallIds);
		await scene.deleteEmbeddedDocuments("Drawing", drawingIds);
	});

	assert.equal(scene.walls.length, 0);
	assert.equal(scene.drawings.length, 0);
	assert.equal(scene.deletions.length, 2, "the bulk path owns both deletes, the cascade adds none");
});

test("suppression is lifted afterwards", async () => {
	const { scene, hooks } = makeScene();
	const pairs = loadPairs(hooks);
	pairs.registerWallPairCascade();

	await pairs.withoutPairCascade(async () => {});
	const { drawing } = pairedDocs(scene, "p4");
	await scene.deleteEmbeddedDocuments("Drawing", [drawing.id]);
	await new Promise(r => setImmediate(r));

	assert.equal(scene.walls.length, 0, "the cascade must work again once the bulk op is done");
});

test("findPairedWall prefers the pair id and falls back to endpoints", async () => {
	const { scene, hooks } = makeScene();
	const pairs = loadPairs(hooks);
	scene.walls.find = Array.prototype.find.bind(scene.walls);

	const { drawing, wall } = pairedDocs(scene, "p5");
	assert.equal(pairs.findPairedWall(scene, drawing), wall, "the recorded pair id wins");

	// A legacy drawing: no pair id, so only the endpoint match can find it.
	const legacyDrawing = { id: "old-d", parent: scene, flags: { [MODULE_ID]: {} } };
	const legacyWall = {
		id: "old-w", parent: scene, c: [500, 500, 700, 500],
		flags: { [MODULE_ID]: { dungeonIntWall: true } },
	};
	scene.walls.push(legacyWall);
	scene.walls.find = Array.prototype.find.bind(scene.walls);

	const found = pairs.findPairedWall(scene, legacyDrawing, [{ x: 500, y: 500 }, { x: 700, y: 500 }]);
	assert.equal(found, legacyWall, "documents made before pairing must still resolve");
});
