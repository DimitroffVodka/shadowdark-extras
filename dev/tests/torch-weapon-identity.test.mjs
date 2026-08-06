// Identity model regression test for #105 — token identity structurally unrepresentable in effect names.
//
// After #105, effect names are classification keys only: `${MODULE_ID}-<kind>-<itemId>`.
// Token identity comes solely from Sequencer's `object`/`source` (dist:11762-11703).
// Names collide across tokens by design (11 unlinked Dropped Torch tokens share
// one base actor and item id, so all 11 produce identical names). Any surviving
// name-only, token-local query becomes wrong: it would match other tokens' effects.
//
// This suite pins:
//  - names must not encode token ids (structurally)
//  - every token-scoped lookup/termination carries object/source
//  - name collision: N tokens sharing actor+item produce identical names; stopping one stops only that token
//  - legacy compatibility: legacy `${MODULE_ID}-<kind>-${tokenId}-${itemId}` is still terminated

import assert from "node:assert/strict";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";
const tokenA = { id: "tokA", name: "TokenA", document: { uuid: "Scene.sceneA.Token.tokA" } };
const tokenB = { id: "tokB", name: "TokenB", document: { uuid: "Scene.sceneA.Token.tokB" } };
const tokenC = { id: "tokC", name: "TokenC", document: { uuid: "Scene.sceneA.Token.tokC" } };
const itemId = "itemX";
const itemId2 = "itemY";

// Minimal world stand-ins
globalThis.game = {
	modules: { get: id => ({ active: id === "sequencer" || id === "JB2A_DnD5e" }) },
	settings: { get: () => true },
	user: { id: "testUser", viewedScene: "sceneA" },
	users: { activeGM: { id: "testUser" }, find: () => ({ id: "testUser" }) },
	scenes: { get: () => null },
};
const endEffectsCalls = [];
globalThis.Sequencer = {
	EffectManager: {
		endEffects: async filter => endEffectsCalls.push(filter),
		getEffects: () => [],
		effects: [],
	},
};
globalThis.canvas = { tokens: { placeables: [] }, scene: { id: "sceneA" } };
globalThis.foundry = {
	applications: { apps: {} },
	abstract: { Document: class {} },
	canvas: { placeables: { PlaceableObject: class {} } },
	utils: { hasProperty: (obj, path) => { const parts = path.split("."); let cur = obj; for (const p of parts) { if (cur == null || !(p in cur)) return false; cur = cur[p]; } return true; }, mergeObject: (a,b) => Object.assign(a,b) },
};
globalThis.Hooks = { on: () => {}, once: () => {}, callAll: () => {} };

const {
	getEffectName: getTorchEffectName,
	getLegacyEffectName: getTorchLegacyEffectName,
	stopTorchAnimation,
	stopAllTorchAnimations,
} = await import("../../scripts/animation/TorchAnimationSD.mjs");

const {
	getEffectName: getWeaponEffectName,
	getLegacyEffectName: getWeaponLegacyEffectName,
	stopWeaponAnimation,
	stopAllWeaponAnimations,
} = await import("../../scripts/animation/WeaponAnimationSD.mjs");

// Replicate Sequencer 4.2.3 name compilation (dist:11694-11702)
function sequencerNameFilter(name) {
	const escaped = name.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*+/g, ".*?");
	return new RegExp(`^${escaped}$`, "gu");
}
// Simulate _filterEffects logic for name+source (dist:11702)
function filterEffects(effects, inFilter) {
	let nameRegex = null;
	if (inFilter.name) {
		const escaped = inFilter.name.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*+/g, ".*?");
		nameRegex = new RegExp(`^${escaped}$`, "gu");
	}
	// _validateFilters object→source rewrite (dist:11762-11765): object becomes source
	let source = inFilter.source ?? null;
	if (inFilter.object) source = inFilter.object?.document?.uuid ?? inFilter.object?.id ?? inFilter.object;
	// source strings are UUIDs; we compare exact
	return effects.filter(e => {
		const nameOk = !nameRegex || (e.data.name && e.data.name.match(nameRegex)?.length);
		const sourceOk = !source || e.data.source === source;
		return nameOk && sourceOk;
	});
}

function resetCalls() { endEffectsCalls.length = 0; }

// — Structural: names must not encode token ids —

test("torch effect name does not encode token id (structurally)", () => {
	const nameA = getTorchEffectName(itemId);
	const nameB = getTorchEffectName(itemId); // same item, any token would be same
	assert.equal(nameA, nameB);
	assert.equal(nameA, `${MODULE_ID}-torch-${itemId}`);
	assert.ok(!nameA.includes(tokenA.id) && !nameA.includes(tokenB.id), "must not contain token ids");
});

test("weapon effect name does not encode token id (structurally)", () => {
	const name = getWeaponEffectName(itemId);
	assert.equal(name, `${MODULE_ID}-weapon-${itemId}`);
	assert.ok(!name.includes(tokenA.id));
});

// — Token-scoped stop paths always supply object/source —

test("torch stop-one carries object identity (new and legacy)", async () => {
	resetCalls();
	await stopTorchAnimation(tokenA, itemId);
	// Must be 4 calls: new, legacy, new_impact, legacy_impact — each with object
	assert.equal(endEffectsCalls.length, 4);
	for (const c of endEffectsCalls) {
		assert.ok(c.object === tokenA || c.source === tokenA.document.uuid || c.source?.uuid === tokenA.document.uuid, "each stop-one filter must carry object/source");
		assert.equal(typeof c.name, "string");
	}
	const names = endEffectsCalls.map(c => c.name);
	assert.ok(names.includes(`${MODULE_ID}-torch-${itemId}`));
	assert.ok(names.includes(`${MODULE_ID}-torch-${tokenA.id}-${itemId}`));
});

test("torch stop-all carries object identity and uses kind wildcard", async () => {
	resetCalls();
	await stopAllTorchAnimations(tokenA);
	assert.equal(endEffectsCalls.length, 1);
	const f = endEffectsCalls[0];
	assert.equal(f.name, `${MODULE_ID}-torch-*`);
	assert.equal(f.object, tokenA);
});

test("weapon stop-one carries object identity", async () => {
	resetCalls();
	await stopWeaponAnimation(tokenA, itemId);
	assert.equal(endEffectsCalls.length, 2);
	for (const c of endEffectsCalls) assert.equal(c.object, tokenA);
});

test("weapon stop-all carries object identity and uses kind wildcard", async () => {
	resetCalls();
	await stopAllWeaponAnimations(tokenB);
	assert.equal(endEffectsCalls.length, 1);
	assert.equal(endEffectsCalls[0].name, `${MODULE_ID}-weapon-*`);
	assert.equal(endEffectsCalls[0].object, tokenB);
});

// — Name collision across tokens —

test("N tokens sharing actor and item produce identical names (collision by design)", () => {
	const nA = getTorchEffectName(itemId);
	const nB = getTorchEffectName(itemId);
	const nC = getTorchEffectName(itemId);
	assert.equal(nA, nB);
	assert.equal(nB, nC);
	const wA = getWeaponEffectName(itemId);
	const wB = getWeaponEffectName(itemId);
	assert.equal(wA, wB);
});

test("stopping one token's torch does NOT affect other tokens' identical-named effects (collision test, condition 2)", async () => {
	// Simulate 11 unlinked Dropped Torch tokens: same itemId, different sources, same name
	const sharedName = getTorchEffectName(itemId);
	const effects = [
		{ data: { name: sharedName, source: tokenA.document.uuid, _id: "effA" } },
		{ data: { name: sharedName, source: tokenB.document.uuid, _id: "effB" } },
		{ data: { name: sharedName, source: tokenC.document.uuid, _id: "effC" } },
	];
	// Stop tokA
	resetCalls();
	await stopTorchAnimation(tokenA, itemId);
	// The filter for new name with object:tokenA should match only effA, not effB/C
	// Find the call that is new name (not legacy, not _impact)
	const newCall = endEffectsCalls.find(c => c.name === sharedName && c.object === tokenA);
	assert.ok(newCall, "new name call with object tokA must exist");
	const matched = filterEffects(effects, newCall);
	assert.equal(matched.length, 1, "must match exactly one token's effect");
	assert.equal(matched[0].data._id, "effA");
	// Legacy call should match none for these new-format effects (since they have no tokenId in name)
	const legacyName = getTorchLegacyEffectName(tokenA, itemId);
	const legacyCall = endEffectsCalls.find(c => c.name === legacyName);
	assert.ok(legacyCall);
	const legacyMatched = filterEffects(effects, legacyCall);
	assert.equal(legacyMatched.length, 0, "legacy name should not match new-format effects, but is still terminated safely");
	// Most importantly: no call should have matched effB or effC without object
	const anyWithoutObject = endEffectsCalls.filter(c => !c.object && !c.source);
	assert.equal(anyWithoutObject.length, 0, "every token-scoped termination must carry object/source (condition 2)");
});

test("weapon collision: identical names disambiguated by object", async () => {
	const sharedName = getWeaponEffectName(itemId);
	const effects = [
		{ data: { name: sharedName, source: tokenA.document.uuid, _id: "wA" } },
		{ data: { name: sharedName, source: tokenB.document.uuid, _id: "wB" } },
	];
	resetCalls();
	await stopWeaponAnimation(tokenB, itemId);
	const newCall = endEffectsCalls.find(c => c.name === sharedName && c.object === tokenB);
	assert.ok(newCall);
	const matched = filterEffects(effects, newCall);
	assert.equal(matched.length, 1);
	assert.equal(matched[0].data._id, "wB");
});

// — Legacy compatibility —

test("legacy torch effect is still terminated by stop-one", async () => {
	const legacyName = getTorchLegacyEffectName(tokenA, itemId);
	const effects = [
		{ data: { name: legacyName, source: tokenA.document.uuid, _id: "legacyA" } },
		{ data: { name: getTorchEffectName(itemId), source: tokenA.document.uuid, _id: "newA" } },
	];
	resetCalls();
	await stopTorchAnimation(tokenA, itemId);
	// Both new and legacy calls together cover both formats
	const allMatchedIds = new Set();
	for (const call of endEffectsCalls) {
		for (const m of filterEffects(effects, call)) allMatchedIds.add(m.data._id);
	}
	assert.ok(allMatchedIds.has("legacyA"), "legacy effect must be matched by legacy-named filter");
	assert.ok(allMatchedIds.has("newA"), "new effect must be matched");
});

test("legacy torch effect is still terminated by stop-all kind wildcard plus object", async () => {
	const legacyName = getTorchLegacyEffectName(tokenA, itemId);
	const newName = getTorchEffectName(itemId);
	const effects = [
		{ data: { name: legacyName, source: tokenA.document.uuid, _id: "leg1" } },
		{ data: { name: newName, source: tokenA.document.uuid, _id: "new1" } },
		{ data: { name: newName, source: tokenB.document.uuid, _id: "other" } },
	];
	resetCalls();
	await stopAllTorchAnimations(tokenA);
	assert.equal(endEffectsCalls.length, 1);
	const call = endEffectsCalls[0];
	assert.equal(call.name, `${MODULE_ID}-torch-*`);
	assert.equal(call.object, tokenA);
	const matched = filterEffects(effects, call);
	assert.ok(matched.some(e => e.data._id === "leg1"), "wildcard plus object must match legacy name");
	assert.ok(matched.some(e => e.data._id === "new1"), "wildcard plus object must match new name");
	assert.ok(!matched.some(e => e.data._id === "other"), "must not match other token's effect");
});

test("legacy weapon effect terminated by stop-all", async () => {
	const legacyName = getWeaponLegacyEffectName(tokenA, itemId);
	const effects = [{ data: { name: legacyName, source: tokenA.document.uuid, _id: "legW" } }];
	resetCalls();
	await stopAllWeaponAnimations(tokenA);
	const call = endEffectsCalls[0];
	const matched = filterEffects(effects, call);
	assert.equal(matched.length, 1);
});
