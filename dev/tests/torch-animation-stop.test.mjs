// Torch animation stop-path regression test (issue #83) + #102 multi-client sweep/election + #105 identity model.
//
// The "torch went out" cleanup funnels through Sequencer.EffectManager
// .endEffects with a NAME filter. Sequencer's name filter is a string that is
// compiled to an anchored regex where `*` is a glob: `\*+` becomes `.*?`
// (see Sequencer's `str_to_search_regex_str`). The historical bug was a
// BARE `*` glued to the token id (`...torch-<tokenId>*`), which is fragile
// and non-anchored, and the effect names this module plays were
// `shadowdark-extras-torch-<tokenId>-<itemId>` (legacy). After #105 they are
// `shadowdark-extras-torch-<itemId>` (classification key only, token identity
// via `object`/`source`). The stop paths must therefore pass a STRING name
// filter (Sequencer throws on a RegExp — "inFilter.name must be of type
// string") that actually matches the played effect names. That invariant is
// what this test pins.

import assert from "node:assert/strict";
import test from "node:test";

const token = { id: "tokA", name: "TestToken" };
const itemId = "itemB";

// Minimal live-world stand-ins: the stop functions read game.modules /
// game.settings through checkDependencies() and fire Sequencer.EndEffects.
globalThis.game = {
	modules: {
		get: id => ({ active: id === "sequencer" || id === "JB2A_DnD5e" }),
	},
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
	},
};
// canvas stand-in for sweep tests — mutated per test
globalThis.canvas = {
	tokens: { placeables: [] },
	scene: { id: "sceneA" },
};
globalThis.foundry = {
	applications: { apps: {} },
	abstract: { Document: class {} },
	canvas: { placeables: { PlaceableObject: class {} } },
	utils: { hasProperty: (obj, path) => {
		const parts = path.split(".");
		let cur = obj;
		for (const p of parts) {
			if (cur == null || !(p in cur)) return false;
			cur = cur[p];
		}
		return true;
	},
	mergeObject: (a, b) => Object.assign(a, b),
	},
};
globalThis.Hooks = { on: () => {}, once: () => {}, callAll: () => {} };

const {
	stopAllTorchAnimations,
	stopTorchAnimation,
	parseTorchTokenId,
	sweepOrphanTorchEffects,
	isTorchCanvasRestoreAllowed,
	getEffectName: getTorchEffectName,
	getLegacyEffectName: getTorchLegacyEffectName,
	initTorchAnimations,
} = await import(
	"../../scripts/animation/TorchAnimationSD.mjs"
);

const {
	parseWeaponTokenId,
	sweepOrphanWeaponEffects,
	isWeaponCanvasRestoreAllowed,
	getEffectName: getWeaponEffectName,
	getLegacyEffectName: getWeaponLegacyEffectName,
	initWeaponAnimations,
} = await import(
	"../../scripts/animation/WeaponAnimationSD.mjs"
);

const MODULE_ID = "shadowdark-extras";
const effectName = `${MODULE_ID}-torch-${itemId}`;
const legacyEffectName = `${MODULE_ID}-torch-${token.id}-${itemId}`;
const playedNames = [effectName, `${effectName}_impact`];
const legacyPlayedNames = [legacyEffectName, `${legacyEffectName}_impact`];

/**
 * Replicates Sequencer 4.2.3's name-filter compilation: a string name is
 * escaped, `*` runs become a non-greedy wildcard, and the result is anchored.
 * The stop filters must match the effect names under exactly these rules.
 */
function sequencerNameFilter(name) {
	const escaped = name
		.trim()
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\*+/g, ".*?");
	return new RegExp(`^${escaped}$`, "gu");
}

function assertStopsEveryPlayedEffect(name) {
	assert.equal(typeof name, "string", "Sequencer rejects a RegExp name filter");
	const matcher = sequencerNameFilter(name);
	for (const effName of playedNames) {
		assert.ok(
			effName.match(matcher)?.length,
			`name filter ${JSON.stringify(name)} must match played effect ${effName}`
		);
	}
}

function resetWorld() {
	endEffectsCalls.length = 0;
	globalThis.canvas.tokens.placeables = [];
	globalThis.canvas.scene = { id: "sceneA" };
	globalThis.game.user = { id: "testUser", viewedScene: "sceneA" };
	globalThis.game.users = { activeGM: { id: "testUser" }, find: () => ({ id: "testUser" }) };
	globalThis.Sequencer.EffectManager.getEffects = () => [];
}

test("stopAllTorchAnimations ends every torch effect for the token", async () => {
	resetWorld();
	await stopAllTorchAnimations(token);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assertStopsEveryPlayedEffect(filter.name);
	assert.ok(filter.name.endsWith("-*"), "anchored glob: itemId suffix follows the trailing hyphen");
	assert.equal(filter.object, token, "stopAll must carry object identity (see #105)");
	assert.equal(filter.name, `${MODULE_ID}-torch-*`, "kind wildcard plus object covers both new and legacy");
});

test("stopTorchAnimation without an itemId stops every torch effect for the token", async () => {
	resetWorld();
	await stopTorchAnimation(token, null);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assertStopsEveryPlayedEffect(filter.name);
	assert.ok(filter.name.endsWith("-*"), "anchored glob: itemId suffix follows the trailing hyphen");
	assert.equal(filter.object, token, "itemId-less branch keeps the object filter");
	assert.equal(filter.name, `${MODULE_ID}-torch-*`);
});

test("stopTorchAnimation with an itemId still targets the exact effect name (and legacy for transition)", async () => {
	resetWorld();
	await stopTorchAnimation(token, itemId);

	// After #105 stop-one terminates both new and legacy names, each with object
	assert.equal(endEffectsCalls.length, 4, "must terminate new + legacy + both _impact variants");
	const names = endEffectsCalls.map(c => c.name);
	assert.ok(names.includes(effectName), `new name ${effectName} must be terminated`);
	assert.ok(names.includes(legacyEffectName), `legacy name ${legacyEffectName} must be terminated for compatibility`);
	assert.ok(names.includes(`${effectName}_impact`), "new _impact variant");
	assert.ok(names.includes(`${legacyEffectName}_impact`), "legacy _impact variant");
	for (const f of endEffectsCalls) assert.equal(f.object, token, "every stop-one filter must carry object");
});

// #102 — orphan sweep and election — Torch

test("parseTorchTokenId handles base and _impact and rejects non-torch names", () => {
	assert.equal(parseTorchTokenId(`${MODULE_ID}-torch-tokA-itemB`), "tokA");
	assert.equal(parseTorchTokenId(`${MODULE_ID}-torch-tokA-itemB_impact`), "tokA");
	assert.equal(parseTorchTokenId(`${MODULE_ID}-torch-TxKpfy58G7xu3hQr-bIHGQiaQJlCQTG3R`), "TxKpfy58G7xu3hQr");
	assert.equal(parseTorchTokenId(`${MODULE_ID}-torch-TxKpfy58G7xu3hQr-bIHGQiaQJlCQTG3R_impact`), "TxKpfy58G7xu3hQr");
	assert.equal(parseTorchTokenId(`${MODULE_ID}-weapon-tokA-itemB`), null);
	assert.equal(parseTorchTokenId("some-other"), null);
	assert.equal(parseTorchTokenId(null), null);
});

test("getEffectName builds the expected torch name (classification key only, no token)", () => {
	assert.equal(getTorchEffectName(itemId), `${MODULE_ID}-torch-${itemId}`);
	assert.equal(getTorchLegacyEffectName(token, itemId), `${MODULE_ID}-torch-${token.id}-${itemId}`);
	// Structural: must not encode token id
	assert.ok(!getTorchEffectName(itemId).includes(token.id), "effect name must not encode token ids (see #105)");
});

test("sweepOrphanTorchEffects selects exactly orphan tokens and spares present ones (source-based, #105)", async () => {
	resetWorld();
	const presentToken = { id: "tokPresent", name: "Present", document: { uuid: "Scene.sceneA.Token.tokPresent" } };
	const tokAWithDoc = { id: "tokA", name: "TestToken", document: { uuid: "Scene.sceneA.Token.tokA" } };
	globalThis.canvas.tokens.placeables = [presentToken, tokAWithDoc];
	globalThis.canvas.scene = { id: "sceneA" };
	// After #105 names are classification-only; identity is source UUID.
	const effects = [
		{ data: { _id: "e1", name: `${MODULE_ID}-torch-item1`, source: "Scene.sceneA.Token.tokPresent", sceneId: "sceneA" } },
		{ data: { _id: "e2", name: `${MODULE_ID}-torch-item1_impact`, source: "Scene.sceneA.Token.tokPresent", sceneId: "sceneA" } },
		{ data: { _id: "e3", name: `${MODULE_ID}-torch-${itemId}`, source: "Scene.sceneA.Token.tokA", sceneId: "sceneA" } },
		{ data: { _id: "e4", name: `${MODULE_ID}-torch-itemX`, source: "Scene.sceneA.Token.orphanA", sceneId: "sceneA" } },
		{ data: { _id: "e5", name: `${MODULE_ID}-torch-itemX_impact`, source: "Scene.sceneA.Token.orphanA", sceneId: "sceneA" } },
		{ data: { _id: "e6", name: `${MODULE_ID}-torch-itemY`, source: "Scene.sceneA.Token.orphanB", sceneId: "sceneA" } },
		{ data: { _id: "e7", name: `${MODULE_ID}-weapon-itemB`, source: "Scene.sceneA.Token.tokA", sceneId: "sceneA" } },
		{ data: { _id: "e8", name: "other-torch-item", source: "Scene.sceneA.Token.tokA", sceneId: "sceneA" } },
	];
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	await sweepOrphanTorchEffects();

	assert.equal(endEffectsCalls.length, 1, `expected 1 sweep via effects ids, got ${JSON.stringify(endEffectsCalls)}`);
	const call = endEffectsCalls[0];
	assert.ok(Array.isArray(call.effects), "orphan sweep now uses effects ids (avoids validating missing source string dist:11720-11729)");
	assert.equal(call.effects.length, 3, "orphanA (2 effects) + orphanB (1) = 3");
	assert.ok(call.effects.includes("e4") && call.effects.includes("e5") && call.effects.includes("e6"), "orphan ids");
	// Present tokens must be spared — their effect ids not in sweep
	assert.ok(!call.effects.includes("e1") && !call.effects.includes("e3"), "present tokens spared");
});

test("sweepOrphanTorchEffects spares _impact of present tokens (source-based)", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [{ id: "keepTok", document: { uuid: "Scene.sceneA.Token.keepTok" } }];
	globalThis.canvas.scene = { id: "sceneA" };
	const effects = [
		{ data: { _id: "k1", name: `${MODULE_ID}-torch-item1`, source: "Scene.sceneA.Token.keepTok", sceneId: "sceneA" } },
		{ data: { _id: "k2", name: `${MODULE_ID}-torch-item1_impact`, source: "Scene.sceneA.Token.keepTok", sceneId: "sceneA" } },
		{ data: { _id: "o1", name: `${MODULE_ID}-torch-item1`, source: "Scene.sceneA.Token.goneTok", sceneId: "sceneA" } },
		{ data: { _id: "o2", name: `${MODULE_ID}-torch-item1_impact`, source: "Scene.sceneA.Token.goneTok", sceneId: "sceneA" } },
	];
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.ok(endEffectsCalls[0].effects.includes("o1") && endEffectsCalls[0].effects.includes("o2"), "goneTok both variants swept");
	assert.ok(!endEffectsCalls[0].effects.includes("k1"), "keepTok spared");
});

test("sweepOrphanTorchEffects handles effects stored as .name fallback (data missing) via legacy parse", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [{ id: "keepTok", document: { uuid: "Scene.sceneA.Token.keepTok" } }];
	globalThis.canvas.scene = { id: "sceneA" };
	// Legacy name with tokenId embedded and no source — fallback to name parsing
	const effects = [
		{ name: `${MODULE_ID}-torch-goneTok-item1`, data: { _id: "lg1", name: `${MODULE_ID}-torch-goneTok-item1`, sceneId: "sceneA" } },
	];
	// Explicitly delete source to force legacy path
	delete effects[0].data.source;
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.ok(endEffectsCalls[0].effects.includes("lg1"));
});

test("sweepOrphanTorchEffects fallback path when filtered getEffects throws", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [{ id: "keepTok", document: { uuid: "Scene.sceneA.Token.keepTok" } }];
	globalThis.canvas.scene = { id: "sceneA" };
	const effects = [
		{ data: { _id: "o1", name: `${MODULE_ID}-torch-item1`, source: "Scene.sceneA.Token.goneTok", sceneId: "sceneA" } },
		{ data: { _id: "k1", name: `${MODULE_ID}-torch-item1`, source: "Scene.sceneA.Token.keepTok", sceneId: "sceneA" } },
	];
	globalThis.Sequencer.EffectManager.getEffects = (filter) => {
		if (filter?.name) throw new Error("filtered getEffects not available");
		return effects;
	};
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.ok(endEffectsCalls[0].effects.includes("o1"));
});

test("sweepOrphanTorchEffects is scene-safe: spares valid off-scene effects", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [{ id: "keepTok", document: { uuid: "Scene.sceneA.Token.keepTok" } }];
	globalThis.canvas.scene = { id: "sceneA" };
	globalThis.game.user.viewedScene = "sceneA";
	const effects = [
		{ data: { _id: "k1", name: `${MODULE_ID}-torch-item1`, source: "Scene.sceneA.Token.keepTok", sceneId: "sceneA" } },
		{ data: { _id: "off1", name: `${MODULE_ID}-torch-item1`, source: "Scene.sceneB.Token.offSceneTok", sceneId: "sceneB" } },
		{ data: { _id: "o1", name: `${MODULE_ID}-torch-item1`, source: "Scene.sceneA.Token.orphanA", sceneId: "sceneA" } },
		{ data: { _id: "o2", name: `${MODULE_ID}-torch-item1_impact`, source: "Scene.sceneA.Token.orphanA", sceneId: "sceneA" } },
	];
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.ok(endEffectsCalls[0].effects.includes("o1") && endEffectsCalls[0].effects.includes("o2"));
	assert.ok(!endEffectsCalls[0].effects.includes("off1"), "off-scene effect must be spared — sweep is scene-filtered (dist:11694/15145)");
});

test("sweepOrphanTorchEffects is idempotent and drains only after manager populated", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [];
	globalThis.canvas.scene = { id: "sceneA" };
	globalThis.Sequencer.EffectManager.getEffects = () => [];
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 0, "empty manager must produce no sweep — early canvasReady would be no-op");

	globalThis.Sequencer.EffectManager.getEffects = () => [
		{ data: { _id: "orph1", name: `${MODULE_ID}-torch-item1`, source: "Scene.sceneA.Token.orphan", sceneId: "sceneA" } },
	];
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.ok(endEffectsCalls[0].effects.includes("orph1"));

	endEffectsCalls.length = 0;
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1, "idempotent re-sweep still issues same orphan via effects");
});

test("initTorchAnimations wires sweep to sequencerEffectManagerReady, not just canvasReady", () => {
	const hooks = [];
	const origHooks = globalThis.Hooks;
	globalThis.Hooks = {
		on: (ev) => hooks.push(ev),
		once: () => {},
		callAll: () => {},
	};
	// Ensure deps allow init to register
	globalThis.game.modules = { get: id => ({ active: id === "sequencer" || id === "JB2A_DnD5e" }) };
	globalThis.game.settings = { get: () => true };
	initTorchAnimations();
	globalThis.Hooks = origHooks;
	assert.ok(hooks.includes("sequencerEffectManagerReady"), "sweep must be hooked to sequencerEffectManagerReady (dist:11953) — getEffects at canvasReady t=0 is empty (dist:30881)");
	// After #110 torch restore also on sequencerEffectManagerReady (not canvasReady) so
	// our dedup sees Sequencer's restored copy before replaying — net one, not duplicate.
	assert.ok(hooks.filter(h => h === "sequencerEffectManagerReady").length >= 2, "torch restore must also be on sequencerEffectManagerReady (see #110 double-restore — canvasReady races Sequencer and produced duplicate)");
	assert.ok(!hooks.includes("canvasReady"), "torch restore no longer on canvasReady — canvasReady raced Sequencer restore");
});

test("activeGM election: restores on GM, not on first-active non-GM", () => {
	const origGame = globalThis.game;
	const gmUser = { id: "gm1", active: true, isGM: true };
	const playerUser = { id: "player1", active: true, isGM: false };
	const otherGM = { id: "gm2", active: true, isGM: true };
	const usersArray = [playerUser, gmUser, otherGM];
	globalThis.game = {
		...origGame,
		user: gmUser,
		users: { activeGM: gmUser, find: fn => usersArray.find(fn) },
	};
	assert.equal(isTorchCanvasRestoreAllowed(), true, "GM should be allowed to restore");
	globalThis.game = {
		...origGame,
		user: playerUser,
		users: { activeGM: gmUser, find: fn => usersArray.find(fn) },
	};
	assert.equal(isTorchCanvasRestoreAllowed(), false, "first-active non-GM must NOT restore even though find() would pick them");
	globalThis.game = {
		...origGame,
		user: playerUser,
		users: { activeGM: null, find: fn => usersArray.find(fn) },
	};
	assert.equal(isTorchCanvasRestoreAllowed(), false, "no activeGM => no restore");
	globalThis.game = origGame;
});

test("stop still produces string filters carrying the -* anchor (Sequencer would throw on RegExp)", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [{ id: "tokA", document: { uuid: "Scene.sceneA.Token.tokA" } }];
	globalThis.canvas.scene = { id: "sceneA" };
	globalThis.Sequencer.EffectManager.getEffects = () => [];
	endEffectsCalls.length = 0;
	await stopAllTorchAnimations(token);
	await stopTorchAnimation(token, null);
	// Sweep now uses effects ids, not name globs — verify it doesn't produce RegExp either
	globalThis.Sequencer.EffectManager.getEffects = () => [{ data: { _id: "orph1", name: `${MODULE_ID}-torch-item1`, source: "Scene.sceneA.Token.orphan", sceneId: "sceneA" } }];
	globalThis.canvas.tokens.placeables = [];
	await sweepOrphanTorchEffects();
	for (const call of endEffectsCalls) {
		if (call.name) {
			assert.equal(typeof call.name, "string", `Sequencer throws on RegExp name: got ${typeof call.name}`);
			if (call.name.includes(`${MODULE_ID}-torch-`)) {
				assert.ok(call.name.endsWith("-*") || call.name.endsWith("_impact") || call.name === `${MODULE_ID}-torch-${itemId}`, `anchored glob missing -* hyphen: ${call.name}`);
			}
		}
		if (call.effects) {
			assert.ok(Array.isArray(call.effects), "effects filter must be array of ids");
			for (const id of call.effects) assert.equal(typeof id, "string");
		}
	}
	// Ensure at least the two stop calls produced anchored globs
	const nameCalls = endEffectsCalls.filter(c => c.name);
	assert.ok(nameCalls.some(c => c.name.endsWith("-*")), "stop path must produce anchored glob");
});

// Weapon mirror — same class must be covered

test("parseWeaponTokenId handles base and rejects non-weapon names", () => {
	assert.equal(parseWeaponTokenId(`${MODULE_ID}-weapon-tokA-itemB`), "tokA");
	assert.equal(parseWeaponTokenId(`${MODULE_ID}-weapon-TxKpfy58G7xu3hQr-bIHG`), "TxKpfy58G7xu3hQr");
	assert.equal(parseWeaponTokenId(`${MODULE_ID}-torch-tokA-itemB`), null);
	assert.equal(parseWeaponTokenId("some-other"), null);
	assert.equal(parseWeaponTokenId(null), null);
});

test("getEffectName builds expected weapon name (classification key only)", () => {
	assert.equal(getWeaponEffectName(itemId), `${MODULE_ID}-weapon-${itemId}`);
	assert.equal(getWeaponLegacyEffectName(token, itemId), `${MODULE_ID}-weapon-${token.id}-${itemId}`);
	assert.ok(!getWeaponEffectName(itemId).includes(token.id), "weapon effect name must not encode token ids");
});

test("sweepOrphanWeaponEffects selects exactly orphan tokens and is scene-safe (source-based)", async () => {
	resetWorld();
	const keep = { id: "keepTok", document: { uuid: "Scene.sceneA.Token.keepTok" } };
	globalThis.canvas.tokens.placeables = [keep];
	globalThis.canvas.scene = { id: "sceneA" };
	globalThis.game.user.viewedScene = "sceneA";
	const effects = [
		{ data: { _id: "k1", name: `${MODULE_ID}-weapon-item1`, source: "Scene.sceneA.Token.keepTok", sceneId: "sceneA" } },
		{ data: { _id: "o1", name: `${MODULE_ID}-weapon-item1`, source: "Scene.sceneA.Token.goneTok", sceneId: "sceneA" } },
		{ data: { _id: "off1", name: `${MODULE_ID}-weapon-item1`, source: "Scene.sceneB.Token.offSceneTok", sceneId: "sceneB" } },
	];
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	await sweepOrphanWeaponEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.ok(endEffectsCalls[0].effects.includes("o1"), "goneTok swept via effects ids");
	assert.ok(!endEffectsCalls[0].effects.includes("k1"), "keepTok spared");
	assert.ok(!endEffectsCalls[0].effects.includes("off1"), "off-scene weapon effect must be spared");
});

test("sweepOrphanWeaponEffects fallback path when filtered getEffects throws", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [{ id: "keep", document: { uuid: "Scene.sceneA.Token.keep" } }];
	globalThis.canvas.scene = { id: "sceneA" };
	const effects = [{ data: { _id: "o1", name: `${MODULE_ID}-weapon-item1`, source: "Scene.sceneA.Token.gone", sceneId: "sceneA" } }];
	globalThis.Sequencer.EffectManager.getEffects = (filter) => {
		if (filter?.name) throw new Error("throw");
		return effects;
	};
	await sweepOrphanWeaponEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.ok(endEffectsCalls[0].effects.includes("o1"));
});

test("sweepOrphanWeaponEffects handles legacy-name parse when source is missing", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [{ id: "keepTok", document: { uuid: "Scene.sceneA.Token.keepTok" } }];
	globalThis.canvas.scene = { id: "sceneA" };
	// Legacy name carries tokenId; when source is absent the sweep falls back to name parsing.
	// Fixture retains data.name (real Sequencer always populates data.source, so data-missing is near-unreachable — tested path is source-missing).
	const effects = [
		{ name: `${MODULE_ID}-weapon-goneTok-item1`, data: { _id: "lgW1", name: `${MODULE_ID}-weapon-goneTok-item1`, sceneId: "sceneA" } },
	];
	delete effects[0].data.source;
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	await sweepOrphanWeaponEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.ok(endEffectsCalls[0].effects.includes("lgW1"));
});

test("sweepOrphanWeaponEffects re-issues termination for a still-present orphan", async () => {
	// Covers re-sweep for a still-present orphan (hook wiring already verified by
	// `initWeaponAnimations wires sweep to sequencerEffectManagerReady`). The mock
	// retains the orphan, so a second sweep re-issues the same termination.
	resetWorld();
	globalThis.canvas.tokens.placeables = [];
	globalThis.canvas.scene = { id: "sceneA" };
	globalThis.Sequencer.EffectManager.getEffects = () => [];
	await sweepOrphanWeaponEffects();
	assert.equal(endEffectsCalls.length, 0, "empty manager must produce no sweep");

	globalThis.Sequencer.EffectManager.getEffects = () => [
		{ data: { _id: "orphW1", name: `${MODULE_ID}-weapon-item1`, source: "Scene.sceneA.Token.orphan", sceneId: "sceneA" } },
	];
	await sweepOrphanWeaponEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.ok(endEffectsCalls[0].effects.includes("orphW1"));

	endEffectsCalls.length = 0;
	await sweepOrphanWeaponEffects();
	assert.equal(endEffectsCalls.length, 1, "re-sweep still issues same orphan while it remains (termination re-issued)");
});

test("isWeaponCanvasRestoreAllowed mirrors torch election", () => {
	const orig = globalThis.game;
	const gm = { id: "gm1" };
	const player = { id: "p1" };
	globalThis.game = { ...orig, user: gm, users: { activeGM: gm, find: () => player } };
	assert.equal(isWeaponCanvasRestoreAllowed(), true);
	globalThis.game = { ...orig, user: player, users: { activeGM: gm, find: () => player } };
	assert.equal(isWeaponCanvasRestoreAllowed(), false);
	globalThis.game = orig;
});

test("initWeaponAnimations wires sweep to sequencerEffectManagerReady", () => {
	const hooks = [];
	const orig = globalThis.Hooks;
	globalThis.Hooks = { on: (ev) => hooks.push(ev), once: () => {}, callAll: () => {} };
	globalThis.game.modules = { get: id => ({ active: id === "sequencer" }) };
	globalThis.game.settings = { get: () => true };
	initWeaponAnimations();
	globalThis.Hooks = orig;
	assert.ok(hooks.includes("sequencerEffectManagerReady"), "weapon sweep must also be on sequencer ready");
});
