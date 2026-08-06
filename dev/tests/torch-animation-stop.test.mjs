// Torch animation stop-path regression test (issue #83) + #102 multi-client sweep/election.
//
// The "torch went out" cleanup funnels through Sequencer.EffectManager
// .endEffects with a NAME filter. Sequencer's name filter is a string that is
// compiled to an anchored regex where `*` is a glob: `\*+` becomes `.*?`
// (see Sequencer's `str_to_search_regex_str`). The historical bug was a
// BARE `*` glued to the token id (`...torch-<tokenId>*`), which is fragile
// and non-anchored, and the effect names this module plays are
// `shadowdark-extras-torch-<tokenId>-<itemId>`.
//
// The stop paths must therefore pass a STRING name filter (Sequencer throws
// on a RegExp — "inFilter.name must be of type string") that actually matches
// the played effect names. That invariant is what this test pins.

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
	initTorchAnimations,
} = await import(
	"../../scripts/animation/TorchAnimationSD.mjs"
);

const {
	parseWeaponTokenId,
	sweepOrphanWeaponEffects,
	isWeaponCanvasRestoreAllowed,
	getEffectName: getWeaponEffectName,
	initWeaponAnimations,
} = await import(
	"../../scripts/animation/WeaponAnimationSD.mjs"
);

const MODULE_ID = "shadowdark-extras";
const effectName = `${MODULE_ID}-torch-${token.id}-${itemId}`;
const playedNames = [effectName, `${effectName}_impact`];

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
});

test("stopTorchAnimation without an itemId stops every torch effect for the token", async () => {
	resetWorld();
	await stopTorchAnimation(token, null);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assertStopsEveryPlayedEffect(filter.name);
	assert.ok(filter.name.endsWith("-*"), "anchored glob: itemId suffix follows the trailing hyphen");
	assert.equal(filter.object, token, "itemId-less branch keeps the object filter");
});

test("stopTorchAnimation with an itemId still targets the exact effect name", async () => {
	resetWorld();
	await stopTorchAnimation(token, itemId);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assert.equal(filter.name, effectName);
	assert.equal(filter.object, token);
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

test("getEffectName builds the expected torch name", () => {
	assert.equal(getTorchEffectName(token, itemId), `${MODULE_ID}-torch-${token.id}-${itemId}`);
});

test("sweepOrphanTorchEffects selects exactly orphan tokens and spares present ones", async () => {
	resetWorld();
	const presentToken = { id: "tokPresent", name: "Present" };
	globalThis.canvas.tokens.placeables = [presentToken, token];
	globalThis.canvas.scene = { id: "sceneA" };
	const effects = [
		{ data: { name: `${MODULE_ID}-torch-tokPresent-item1`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-torch-tokPresent-item1_impact`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-torch-tokA-itemB`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-torch-orphanA-itemX`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-torch-orphanA-itemX_impact`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-torch-orphanB-itemY`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-weapon-tokA-itemB`, sceneId: "sceneA" } },
		{ data: { name: "other-torch-tokA-itemB", sceneId: "sceneA" } },
	];
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	await sweepOrphanTorchEffects();

	const names = endEffectsCalls.map(c => c.name);
	assert.equal(endEffectsCalls.length, 2, `expected 2 orphan sweeps, got ${JSON.stringify(names)}`);
	for (const n of names) {
		assert.equal(typeof n, "string");
		assert.ok(n.endsWith("-*"), `orphan sweep must be anchored glob: ${n}`);
	}
	assert.ok(names.includes(`${MODULE_ID}-torch-orphanA-*`), "orphanA sweep");
	assert.ok(names.includes(`${MODULE_ID}-torch-orphanB-*`), "orphanB sweep");
	for (const n of names) {
		const matcher = sequencerNameFilter(n);
		const orphanId = n.slice(`${MODULE_ID}-torch-`.length, -2);
		assert.ok(`${MODULE_ID}-torch-${orphanId}-someItem`.match(matcher));
		assert.ok(`${MODULE_ID}-torch-${orphanId}-someItem_impact`.match(matcher));
	}
	assert.ok(!names.includes(`${MODULE_ID}-torch-tokPresent-*`), "present token must be spared");
	assert.ok(!names.includes(`${MODULE_ID}-torch-tokA-*`), "tokA is present via placeables");
});

test("sweepOrphanTorchEffects spares _impact of present tokens and is a string -* filter", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [{ id: "keepTok" }];
	globalThis.canvas.scene = { id: "sceneA" };
	const effects = [
		{ data: { name: `${MODULE_ID}-torch-keepTok-item1`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-torch-keepTok-item1_impact`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-torch-goneTok-item1`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-torch-goneTok-item1_impact`, sceneId: "sceneA" } },
	];
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.equal(endEffectsCalls[0].name, `${MODULE_ID}-torch-goneTok-*`);
	assert.equal(typeof endEffectsCalls[0].name, "string");
});

test("sweepOrphanTorchEffects handles effects stored as .name fallback (data missing)", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [{ id: "keepTok" }];
	globalThis.canvas.scene = { id: "sceneA" };
	const effects = [
		{ name: `${MODULE_ID}-torch-goneTok-item1` }, // no .data, uses fallback
	];
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.equal(endEffectsCalls[0].name, `${MODULE_ID}-torch-goneTok-*`);
});

test("sweepOrphanTorchEffects fallback path when filtered getEffects throws", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [{ id: "keepTok" }];
	globalThis.canvas.scene = { id: "sceneA" };
	const effects = [
		{ data: { name: `${MODULE_ID}-torch-goneTok-item1`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-torch-keepTok-item1`, sceneId: "sceneA" } },
	];
	globalThis.Sequencer.EffectManager.getEffects = (filter) => {
		if (filter?.name) throw new Error("filtered getEffects not available");
		return effects;
	};
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.equal(endEffectsCalls[0].name, `${MODULE_ID}-torch-goneTok-*`);
});

test("sweepOrphanTorchEffects is scene-safe: spares valid off-scene effects", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [{ id: "keepTok" }];
	globalThis.canvas.scene = { id: "sceneA" };
	globalThis.game.user.viewedScene = "sceneA";
	const effects = [
		{ data: { name: `${MODULE_ID}-torch-keepTok-item1`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-torch-offSceneTok-item1`, sceneId: "sceneB" } }, // valid on other scene, must be spared
		{ data: { name: `${MODULE_ID}-torch-orphanA-item1`, sceneId: "sceneA" } }, // orphan on current scene
		{ data: { name: `${MODULE_ID}-torch-orphanA-item1_impact`, sceneId: "sceneA" } },
	];
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	await sweepOrphanTorchEffects();
	const names = endEffectsCalls.map(c => c.name);
	assert.equal(names.length, 1, `only current-scene orphan should be swept, got ${JSON.stringify(names)}`);
	assert.equal(names[0], `${MODULE_ID}-torch-orphanA-*`);
	assert.ok(!names.includes(`${MODULE_ID}-torch-offSceneTok-*`), "off-scene effect must be spared — sweep is scene-filtered (dist:11694/15145)");
});

test("sweepOrphanTorchEffects is idempotent and drains only after manager populated", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [];
	globalThis.canvas.scene = { id: "sceneA" };
	// Simulate early canvasReady moment: manager empty (dist:30881 debounce)
	globalThis.Sequencer.EffectManager.getEffects = () => [];
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 0, "empty manager must produce no sweep — early canvasReady would be no-op");

	// Simulate sequencerEffectManagerReady: manager now populated (dist:11953)
	globalThis.Sequencer.EffectManager.getEffects = () => [
		{ data: { name: `${MODULE_ID}-torch-orphan-item1`, sceneId: "sceneA" } },
	];
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.equal(endEffectsCalls[0].name, `${MODULE_ID}-torch-orphan-*`);

	// Second call is idempotent (manager still has same orphan, but endEffects is safe to re-issue)
	endEffectsCalls.length = 0;
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1, "idempotent re-sweep still issues same orphan glob");
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
	assert.ok(hooks.includes("canvasReady"), "GM restore still on canvasReady");
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
	globalThis.canvas.tokens.placeables = [{ id: "tokA" }];
	globalThis.canvas.scene = { id: "sceneA" };
	globalThis.Sequencer.EffectManager.getEffects = () => [];
	endEffectsCalls.length = 0;
	await stopAllTorchAnimations(token);
	await stopTorchAnimation(token, null);
	globalThis.Sequencer.EffectManager.getEffects = () => [{ data: { name: `${MODULE_ID}-torch-orphan-item1`, sceneId: "sceneA" } }];
	globalThis.canvas.tokens.placeables = [];
	await sweepOrphanTorchEffects();
	for (const call of endEffectsCalls) {
		assert.equal(typeof call.name, "string", `Sequencer throws on RegExp name: got ${typeof call.name}`);
		if (call.name.includes(`${MODULE_ID}-torch-`)) {
			assert.ok(call.name.endsWith("-*"), `anchored glob missing -* hyphen: ${call.name}`);
		}
	}
});

// Weapon mirror — same class must be covered

test("parseWeaponTokenId handles base and rejects non-weapon names", () => {
	assert.equal(parseWeaponTokenId(`${MODULE_ID}-weapon-tokA-itemB`), "tokA");
	assert.equal(parseWeaponTokenId(`${MODULE_ID}-weapon-TxKpfy58G7xu3hQr-bIHG`), "TxKpfy58G7xu3hQr");
	assert.equal(parseWeaponTokenId(`${MODULE_ID}-torch-tokA-itemB`), null);
	assert.equal(parseWeaponTokenId("some-other"), null);
	assert.equal(parseWeaponTokenId(null), null);
});

test("getEffectName builds expected weapon name", () => {
	assert.equal(getWeaponEffectName(token, itemId), `${MODULE_ID}-weapon-${token.id}-${itemId}`);
});

test("sweepOrphanWeaponEffects selects exactly orphan tokens and is scene-safe", async () => {
	resetWorld();
	const keep = { id: "keepTok" };
	globalThis.canvas.tokens.placeables = [keep];
	globalThis.canvas.scene = { id: "sceneA" };
	globalThis.game.user.viewedScene = "sceneA";
	const effects = [
		{ data: { name: `${MODULE_ID}-weapon-keepTok-item1`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-weapon-goneTok-item1`, sceneId: "sceneA" } },
		{ data: { name: `${MODULE_ID}-weapon-offSceneTok-item1`, sceneId: "sceneB" } },
	];
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	await sweepOrphanWeaponEffects();
	const names = endEffectsCalls.map(c => c.name);
	assert.equal(names.length, 1);
	assert.equal(names[0], `${MODULE_ID}-weapon-goneTok-*`);
	assert.ok(!names.includes(`${MODULE_ID}-weapon-offSceneTok-*`), "off-scene weapon effect must be spared");
});

test("sweepOrphanWeaponEffects fallback path when filtered getEffects throws", async () => {
	resetWorld();
	globalThis.canvas.tokens.placeables = [{ id: "keep" }];
	globalThis.canvas.scene = { id: "sceneA" };
	const effects = [{ data: { name: `${MODULE_ID}-weapon-gone-item1`, sceneId: "sceneA" } }];
	globalThis.Sequencer.EffectManager.getEffects = (filter) => {
		if (filter?.name) throw new Error("throw");
		return effects;
	};
	await sweepOrphanWeaponEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.equal(endEffectsCalls[0].name, `${MODULE_ID}-weapon-gone-*`);
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
