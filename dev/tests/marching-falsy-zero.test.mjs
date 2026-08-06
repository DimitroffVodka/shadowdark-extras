// Regression for issue #100 — falsy-zero guard in onUpdateToken.
//
// onUpdateToken:708 used `if (!changes.x && !changes.y) return;` which
// treats 0 as falsy. A leader move to x===0 or y===0 with a single-key
// changes object ({x:0} or {y:0}) therefore returned early: no path was
// recorded and no conga was scheduled. onPreUpdateToken:684 already used
// `=== undefined` with the comment "a move to x/y===0 still counts" —
// onUpdateToken must match.
//
// These two tests drive the real module through its `updateToken` hook with
// changes {x:0} and {y:0} respectively and assert that a follower is moved
// (path length increments / processCongaMovement triggered). Against the
// old `!changes.x && !changes.y` guard both tests fail (0 follower updates);
// after the fix both pass.

import assert from "node:assert/strict";
import test from "node:test";

import { deepClone, expandObject, mergeObject } from "./helpers/foundry-utils.mjs";

const MODULE_ID = "shadowdark-extras";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Hooks stub (same shape as marching-conga-rejection.test.mjs) -----------
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

// --- globals the marching graph reads at import time ------------------------
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

// --- canvas / tokens --------------------------------------------------------
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
	return {
		id,
		name,
		x,
		y,
		actor: { type: "Player", hasPlayerOwner: true, ownership: {} },
		document: { update: async () => ({}) },
	};
}

function installFollower() {
	follower.document.update = async (changes) => {
		updateCalls.push({ ...changes });
		follower.x = changes.x ?? follower.x;
		follower.y = changes.y ?? follower.y;
		return follower.document;
	};
}

function installTokens() {
	tokenById.clear();
	leader = makeToken({ id: "leader-1", name: "Leader", x: 100, y: 100 });
	follower = makeToken({ id: "follower-1", name: "Follower", x: 300, y: 300 });
	installFollower();
	for (const token of [leader, follower]) tokenById.set(token.id, token);
	canvas.tokens.placeables.length = 0;
	canvas.tokens.placeables.push(leader, follower);
}

const { initMarchingMode } = await import("../../scripts/combat/MarchingModeSD.mjs");
initMarchingMode();

const onUpdateToken = Hooks.handlers("updateToken").at(-1);
assert.ok(onUpdateToken, "onUpdateToken hook must be registered");

// Helper: drive a leader move where the changes object contains ONLY the
// axis that actually changed (Foundry's real shape). For x:0 that is {x:0}.
async function moveLeaderSingleAxis(fromX, fromY, toX, toY) {
	const changes = {};
	if (toX !== fromX) changes.x = toX;
	if (toY !== fromY) changes.y = toY;
	const leaderDoc = { id: "leader-1", _source: { x: fromX, y: fromY }, x: toX, y: toY };
	await onUpdateToken(leaderDoc, changes, {}, "user-1");
	// Mirror the leader's own position as the real canvas would.
	leader.x = toX;
	leader.y = toY;
}

test("leader move to x:0 with changes {x:0} is not swallowed — follower conga runs", async () => {
	installTokens();
	updateCalls.length = 0;
	// Ensure marching is considered not-in-combat and enabled.
	globalThis.game.combats.active = { started: false };
	// Give any previous conga time to settle before we measure.
	await sleep(400);
	updateCalls.length = 0;

	await moveLeaderSingleAxis(100, 100, 0, 100);
	await sleep(400);

	assert.ok(
		updateCalls.length >= 1,
		`onUpdateToken with changes {x:0} must trigger conga (got ${updateCalls.length} follower updates) — falsy-zero guard would swallow x:0`,
	);
});

test("leader move to y:0 with changes {y:0} is not swallowed — follower conga runs", async () => {
	installTokens();
	updateCalls.length = 0;
	globalThis.game.combats.active = { started: false };
	await sleep(400);
	updateCalls.length = 0;

	await moveLeaderSingleAxis(100, 100, 100, 0);
	await sleep(400);

	assert.ok(
		updateCalls.length >= 1,
		`onUpdateToken with changes {y:0} must trigger conga (got ${updateCalls.length} follower updates) — falsy-zero guard would swallow y:0`,
	);
});
