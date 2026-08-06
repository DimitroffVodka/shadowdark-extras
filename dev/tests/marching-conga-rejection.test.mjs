// Marching-mode conga rejection regression — issue #98.
//
// `moveAllTokensOneStep` dispatches follower moves inside
// `Promise.all(promises).then(...)`. If any follower `document.update` rejects
// (follower deleted mid-drag, ownership changed, Foundry error), the promise
// chain rejects at the `.then` boundary and NEITHER the normal-completion reset
// nor the combat-bail reset runs — `processingCongaMovement` stays true forever,
// so every later leader move short-circuits at the "already processing" guard
// and the conga is wedged.
//
// This drives the REAL module headless through its `updateToken` hook handler
// (the only public path into the queue). The test harness stubs `game`,
// `canvas`, and the document-update channel, then:
//   1. runs a normal single-follower conga to completion (happy path),
//   2. forces the next follower update to REJECT and proves the queue stops,
//   3. runs a fresh conga after the rejection — the exact step the bug breaks.
//
// The module keeps its queue state module-scoped, so this is one ordered test
// rather than a set of independent ones (same lifecycle pattern as
// lane-b-combat-socket.test.mjs).

import assert from "node:assert/strict";
import test from "node:test";

import { deepClone, expandObject, mergeObject } from "./helpers/foundry-utils.mjs";

const MODULE_ID = "shadowdark-extras";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Recording Hooks stub. initMarchingMode registers the conga handlers here;
// the test grabs the LAST-registered "updateToken" handler (MarchingMode's —
// the journal-pins module registers its own at import time, before init runs).
// ---------------------------------------------------------------------------
const hookHandlers = new Map();
const Hooks = {
	on(event, handler) {
		if (!hookHandlers.has(event)) hookHandlers.set(event, new Set());
		hookHandlers.get(event).add(handler);
		return `hook-${event}-${hookHandlers.get(event).size}`;
	},
	once(event, handler) {
		Hooks.on(event, handler);
	},
	off(event, handler) {
		hookHandlers.get(event)?.delete(handler);
	},
	callAll() {},
	handlers(event) {
		return [...(hookHandlers.get(event) ?? [])];
	},
};

// ---------------------------------------------------------------------------
// Game globals the marching import graph reads (FormationSpawnerSD and the
// journal-pins tree destructure foundry.applications.api / extend
// foundry.canvas.layers.CanvasLayer at module scope).
// ---------------------------------------------------------------------------
const settingValues = {
	[`${MODULE_ID}.marchingModeLeader`]: "leader-1",
	[`${MODULE_ID}.marchingModeEnabled`]: true,
};
globalThis.game = {
	user: { isGM: true },
	combats: { active: { started: false } },
	users: { get: () => null },
	settings: {
		get: (scope, key) => settingValues[`${scope}.${key}`],
		set: async (scope, key, value) => {
			settingValues[`${scope}.${key}`] = value;
			return value;
		},
		register() {},
		registerMenu() {},
	},
	i18n: { localize: (key) => key },
};
globalThis.foundry = {
	applications: {
		api: {
			ApplicationV2: class {},
			HandlebarsApplicationMixin: (Base) => Base,
			DialogV2: class {},
		},
		ux: {},
	},
	canvas: { layers: { CanvasLayer: class CanvasLayer {} } },
	utils: {
		deepClone,
		expandObject,
		mergeObject,
		randomID: () => "test-id",
		getProperty: (obj, key) => key.split(".").reduce((o, k) => o?.[k], obj),
		getType: (value) => typeof value,
		debounce: (fn) => fn,
		Color: { from: (value) => ({ css: String(value) }) },
		escapeHTML: (value) => String(value),
	},
};
globalThis.PIXI = {
	Container: class {},
	Graphics: class {},
	Sprite: class {},
	Text: class {},
	Texture: { from: (source) => ({ source }) },
};
globalThis.Hooks = Hooks;
globalThis.CONFIG = {};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.window = globalThis;
globalThis.document = {
	getElementById: () => null,
	addEventListener() {},
	removeEventListener() {},
	fonts: { load: async () => {} },
	createElement: () => ({ style: {} }),
	body: { appendChild() {} },
};

// ---------------------------------------------------------------------------
// Canvas: leader + one follower token. `document.update` applies the move to
// the placeable and records the call, so the test can count conga steps and
// flip the channel to reject on demand.
// ---------------------------------------------------------------------------
const updateCalls = [];
let follower = null;
let leader = null;
const tokenById = new Map();
globalThis.canvas = {
	scene: { id: "scene-1" },
	grid: { size: 100 },
	tokens: {
		get: (id) => tokenById.get(id) ?? null,
		placeables: [],
	},
};

function makeToken({ id, name, x, y }) {
	const actor = { type: "Player", hasPlayerOwner: true, ownership: {} };
	return {
		id,
		name,
		x,
		y,
		actor,
		document: { update: async () => ({}) },
	};
}

function installFollower(rejectNext) {
	follower.document.update = async (changes) => {
		updateCalls.push({ ...changes });
		if (rejectNext) {
			throw new Error("simulated follower update rejection");
		}
		follower.x = changes.x;
		follower.y = changes.y;
		return follower.document;
	};
}

function installLeader() {
	leader = makeToken({ id: "leader-1", name: "Leader", x: 100, y: 100 });
}

function installTokens() {
	tokenById.clear();
	installLeader();
	follower = makeToken({ id: "follower-1", name: "Follower", x: 300, y: 300 });
	installFollower(false);
	for (const token of [leader, follower]) tokenById.set(token.id, token);
	canvas.tokens.placeables.length = 0;
	canvas.tokens.placeables.push(leader, follower);
}

const { initMarchingMode } = await import("../../scripts/combat/MarchingModeSD.mjs");
initMarchingMode();

/** The MarchingMode updateToken handler — the last handler registered for it. */
const onUpdateToken = Hooks.handlers("updateToken").at(-1);

/** Drive a single leader move; the conga itself runs on the module's timers. */
async function moveLeader(fromX, fromY, toX, toY) {
	const leaderDoc = { id: "leader-1", _source: { x: fromX, y: fromY }, x: toX, y: toY };
	await onUpdateToken(leaderDoc, { x: toX, y: toY }, {}, "user-1");
}

test("a rejected follower update resets the conga queue so the next leader move restarts it", async () => {
	installTokens();
	updateCalls.length = 0;

	// Phase 1 — happy path: the single follower takes one step onto the path,
	// then the queue completes. Expect exactly one follower update.
	await moveLeader(100, 100, 200, 200);
	await sleep(350);
	assert.equal(updateCalls.length, 1, "happy path: one follower step per leader step");

	// Phase 2 — rejection: the next follower update rejects mid-step. The
	// queue must stop (no further steps) and must NOT leave the flags wedged.
	installFollower(true);
	await moveLeader(200, 200, 300, 300);
	await sleep(350);
	assert.equal(updateCalls.length, 2, "rejected step counted once");
	await sleep(300);
	assert.equal(updateCalls.length, 2, "queue stops after a rejected step (no hidden steps)");

	// Phase 3 — recovery: with updates succeeding again, the NEXT leader move
	// must start a fresh conga and walk the follower the remaining two steps.
	// Before the fix this stayed stuck at 2 forever.
	installFollower(false);
	await moveLeader(300, 300, 400, 400);
	await sleep(450);
	assert.equal(updateCalls.length, 4, "a fresh conga runs after the rejection (queue not wedged)");
});
