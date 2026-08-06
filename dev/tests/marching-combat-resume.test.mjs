// Regression tests for issue #99 — the conga trail survives combat and then
// drags followers back along pre-combat waypoints.
//
// The marching state machine keeps the leader's walked trail in
// `leaderMovementPath` and drives followers along it with `processCongaMovement`.
// When combat starts (fix #87) the queue bails and followers freeze mid-path;
// when it ends, an off-path follower's `currentIndex` defaults to the tail of
// whatever path is still stored, so the FIRST post-combat leader move must
// start from a FRESH path. If the pre-combat trail is not discarded, the
// followers are marched backwards down the stale route first.
//
// The reset is driven by the combat LIFECYCLE hooks, keyed to the active
// combat's id + scene id (issue #99): each new combat episode — including a
// replacement combat that never un-started, and a combat surfaced by a scene
// change — clears the stale trail exactly once. These tests fire the module's
// real registered hooks through the suspend -> resume cycle and assert that an
// off-path follower's first post-combat conga step goes along the NEW path
// instead of back down the pre-combat trail.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

installCanvasGlobals();
const { hooks, dom } = installAppGlobals({ dom: makeSelectorDom() });

// --- harness state -----------------------------------------------------------

// Settings are registered by initMarchingMode/initFormationSpawner; pre-seed
// the marching state so loadMarchingState picks it up. register() only fills
// defaults for keys that were not pre-seeded.
const settings = new Map();
globalThis.game.settings = {
	register: (ns, key, config) => {
		const path = `${ns}.${key}`;
		if (!settings.has(path)) settings.set(path, config.default);
	},
	get: (ns, key) => settings.get(`${ns}.${key}`),
	set: async (ns, key, value) => settings.set(`${ns}.${key}`, value),
};
settings.set("shadowdark-extras.marchingModeEnabled", true);
settings.set("shadowdark-extras.marchingModeLeader", "leader");
settings.set("shadowdark-extras.tray.enabled", true);

globalThis.game.combats = { active: null };

// Canvas token stubs: conga followers are driven via `document.update`, and
// `processCongaMovement` re-reads `canvas.tokens.get(...).x/y` each cycle, so
// the stub must both record every update and apply it to the token's position.
const tokens = new Map();
const updates = [];
function makeToken(id, x, y) {
	const state = { id, x, y, name: id, actor: { type: "Player", hasPlayerOwner: true } };
	state.document = {
		update: async changes => {
			updates.push({ id: state.id, x: changes.x ?? state.x, y: changes.y ?? state.y });
			state.x = changes.x ?? state.x;
			state.y = changes.y ?? state.y;
			return state;
		},
	};
	tokens.set(id, state);
	return state;
}
makeToken("leader", 0, 0);
makeToken("f1", 0, 100);
makeToken("f2", 0, 200);

globalThis.canvas.tokens = {
	get: id => tokens.get(id) ?? null,
	placeables: [...tokens.values()],
};
globalThis.canvas.grid = { size: 100 };

// initMarchingMode skips sidebar injection when getElementById finds nothing.
dom.document.getElementById = () => null;
globalThis.$ = () => ({
	addClass: () => globalThis.$(),
	removeClass: () => globalThis.$(),
	css: () => globalThis.$(),
});

const { initMarchingMode } = await import("../../scripts/combat/MarchingModeSD.mjs");
initMarchingMode();

const updateToken = hooks.find(h => h.name === "updateToken").fn;
const combatStart = hooks.find(h => h.name === "combatStart")?.fn;
const updateCombat = hooks.find(h => h.name === "updateCombat")?.fn;
const deleteCombat = hooks.find(h => h.name === "deleteCombat")?.fn;
const canvasReady = hooks.find(h => h.name === "canvasReady").fn;
const f1 = tokens.get("f1");
const f2 = tokens.get("f2");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The regression depends on the combat lifecycle hooks existing; assert them so
// this file fails loudly against a commit that still used the old
// incidental-observation reset (it registered no combat hooks at all).
assert.ok(combatStart, "combatStart hook must be registered (issue #99)");
assert.ok(updateCombat, "updateCombat hook must be registered (issue #99)");
assert.ok(deleteCombat, "deleteCombat hook must be registered (issue #99)");

/** Drive the module's updateToken hook as if the leader walked from -> to. */
function moveLeader(from, to) {
	const leaderToken = tokens.get("leader");
	leaderToken.x = to[0];
	leaderToken.y = to[1];
	const tokenDoc = { id: "leader", _source: { x: from[0], y: from[1] }, x: to[0], y: to[1] };
	return updateToken(tokenDoc, { x: to[0], y: to[1] }, {}, "gm");
}

/** Make a combat active and fire its begin-lifecycle events. */
function beginCombat(combat) {
	globalThis.game.combats.active = combat;
	combatStart(combat);
	updateCombat(combat);
}

/** Remove a combat and fire its end-lifecycle events. */
function endCombat(combat) {
	globalThis.game.combats.active = null;
	deleteCombat(combat);
}

/** Build the shared pre-combat northward trail; followers catch up mid-way. */
async function buildNorthTrail() {
	await moveLeader([0, 0], [0, -100]);
	await sleep(300);
	await moveLeader([0, -100], [0, -200]);
	await sleep(400);
	assert.equal(f1.x, 0, "f1 should trail the leader on the north path");
	assert.equal(f1.y, -200);
	assert.equal(f2.x, 0);
	assert.equal(f2.y, -100);
}

/** The off-path follower's first post-combat conga step must go EAST. */
function assertF1MovesEast() {
	const f1Moves = updates.filter(u => u.id === "f1");
	assert.ok(f1Moves.length > 0, "conga must move the off-path follower after the post-combat leader move");
	assert.equal(
		f1Moves[0].x,
		100,
		"f1's first post-combat step must go along the NEW path (east), not back down the pre-combat trail"
	);
	assert.equal(f1Moves[0].y, -200, "f1 stays on the new eastward line");
}

test("combat suspend -> resume starts a fresh trail; off-path followers follow the NEW path", async () => {
	await buildNorthTrail();

	// Combat begins (lifecycle events) and suspends marching.
	const combatA = { id: "combatA", scene: { id: "scene-1" }, started: true };
	beginCombat(combatA);

	// During combat a follower is repositioned independently — the #87 guard
	// bails out of onUpdateToken (no recording).
	f1.x = 0;
	f1.y = 300;
	await updateToken({ id: "f1", _source: { x: 0, y: -200 }, x: 0, y: 300 }, { x: 0, y: 300 }, {}, "gm");

	// Combat ends.
	endCombat(combatA);

	// The leader moves EAST; the conga must march followers along the fresh
	// eastward path, not first drag them back down the north trail.
	updates.length = 0;
	await moveLeader([0, -200], [100, -200]);
	await sleep(400);

	assertF1MovesEast();
});

test("a replacement combat re-arms the trail reset even though started never went false", async () => {
	await buildNorthTrail();

	// Combat A begins — its episode clears the pre-combat trail.
	const combatA = { id: "combatA", scene: { id: "scene-1" }, started: true };
	beginCombat(combatA);

	// Combat A is removed WITHOUT started ever going false and a replacement
	// combat B becomes active: a new episode that must re-arm the reset.
	endCombat(combatA);
	const combatB = { id: "combatB", scene: { id: "scene-1" }, started: true };
	beginCombat(combatB);

	// A follower drifts off the path during combat.
	f1.x = 0;
	f1.y = 300;
	await updateToken({ id: "f1", _source: { x: 0, y: -200 }, x: 0, y: 300 }, { x: 0, y: 300 }, {}, "gm");

	// Combat B ends.
	endCombat(combatB);

	// The leader moves EAST; followers must follow the NEW path.
	updates.length = 0;
	await moveLeader([0, -200], [100, -200]);
	await sleep(400);

	assertF1MovesEast();
});

	test("a scene change mid-combat re-arms the trail reset for the new scene's combat", async () => {
	await buildNorthTrail();

	// Combat A on scene 1 begins — its episode clears the pre-combat trail.
	const combatA = { id: "combatA", scene: { id: "scene-1" }, started: true };
	beginCombat(combatA);

	// The GM switches to scene 2 while the combat is still started: the canvas
	// reloads, and the active combat for the new scene is different (or none).
	globalThis.game.combats.active = null;
	canvasReady();

	// A fresh trail is built on scene 2.
	await moveLeader([0, -200], [100, -200]);
	await sleep(400);

	// Combat B on scene 2 begins — must clear the scene-2 trail too.
	const combatB = { id: "combatB", scene: { id: "scene-2" }, started: true };
	beginCombat(combatB);

	// A follower drifts off the path during combat.
	f1.x = 100;
	f1.y = 300;
	await updateToken({ id: "f1", _source: { x: 0, y: -200 }, x: 100, y: 300 }, { x: 100, y: 300 }, {}, "gm");

	// Combat B ends.
	endCombat(combatB);

	// The leader continues EAST; followers must follow the NEW path, not the
	// pre-combat trail or the scene-2 trail.
	updates.length = 0;
	await moveLeader([100, -200], [200, -200]);
	await sleep(400);

	const f1Moves = updates.filter(u => u.id === "f1");
	assert.ok(f1Moves.length > 0, "conga must move the off-path follower after the post-combat leader move");
	assert.equal(
		f1Moves[0].x,
		200,
		"f1's first post-combat step must go along the NEW path (east), not back down any pre-combat trail"
	);
	assert.equal(f1Moves[0].y, -200, "f1 stays on the new eastward line");
});

test("restarting the same combat after a round-0 reset re-arms the trail reset", async () => {
	await buildNorthTrail();

	// Combat begins — its episode clears the pre-combat trail.
	const combatA = { id: "combatA", scene: { id: "scene-1" }, started: true };
	beginCombat(combatA);

	// The same combat is reset to round 0 (started goes false), ending the
	// episode. Marching resumes and a fresh trail is built.
	combatA.started = false;
	globalThis.game.combats.active = combatA;
	updateCombat(combatA);
	await moveLeader([0, -200], [100, -200]);
	await sleep(400);

	// The same combat restarts — the reset must re-arm even though the combat
	// id and scene never changed.
	combatA.started = true;
	globalThis.game.combats.active = combatA;
	combatStart(combatA);
	updateCombat(combatA);

	// A follower drifts off the path during combat.
	f1.x = 100;
	f1.y = 300;
	await updateToken({ id: "f1", _source: { x: 0, y: -200 }, x: 100, y: 300 }, { x: 100, y: 300 }, {}, "gm");

	// Combat ends.
	endCombat(combatA);

	// The leader continues EAST; followers must follow the NEW path, not the
	// trail built between the reset and the restart.
	updates.length = 0;
	await moveLeader([100, -200], [200, -200]);
	await sleep(400);

	const f1Moves = updates.filter(u => u.id === "f1");
	assert.ok(f1Moves.length > 0, "conga must move the off-path follower after the post-combat leader move");
	assert.equal(
		f1Moves[0].x,
		200,
		"f1's first post-combat step must go along the NEW path (east), not the trail built between reset and restart"
	);
	assert.equal(f1Moves[0].y, -200, "f1 stays on the new eastward line");
});
