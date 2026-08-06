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
	scene: null,
};
globalThis.foundry = {
	utils: { hasProperty: (obj, path) => {
		const parts = path.split(".");
		let cur = obj;
		for (const p of parts) {
			if (cur == null || !(p in cur)) return false;
			cur = cur[p];
		}
		return true;
	}},
};
globalThis.Hooks = { on: () => {}, once: () => {} };

const {
	stopAllTorchAnimations,
	stopTorchAnimation,
	parseTorchTokenId,
	sweepOrphanTorchEffects,
	isTorchCanvasRestoreAllowed,
	getEffectName,
} = await import(
	"../../scripts/animation/TorchAnimationSD.mjs"
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

test("stopAllTorchAnimations ends every torch effect for the token", async () => {
	endEffectsCalls.length = 0;
	await stopAllTorchAnimations(token);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assertStopsEveryPlayedEffect(filter.name);
	assert.ok(filter.name.endsWith("-*"), "anchored glob: itemId suffix follows the trailing hyphen");
});

test("stopTorchAnimation without an itemId stops every torch effect for the token", async () => {
	endEffectsCalls.length = 0;
	await stopTorchAnimation(token, null);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assertStopsEveryPlayedEffect(filter.name);
	assert.ok(filter.name.endsWith("-*"), "anchored glob: itemId suffix follows the trailing hyphen");
	assert.equal(filter.object, token, "itemId-less branch keeps the object filter");
});

test("stopTorchAnimation with an itemId still targets the exact effect name", async () => {
	endEffectsCalls.length = 0;
	await stopTorchAnimation(token, itemId);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assert.equal(filter.name, effectName);
	assert.equal(filter.object, token);
});

// #102 — orphan sweep and election

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
	assert.equal(getEffectName(token, itemId), `${MODULE_ID}-torch-${token.id}-${itemId}`);
});

test("sweepOrphanTorchEffects selects exactly orphan tokens and spares present ones", async () => {
	// Present token: tokPresent. Orphans: orphanA, orphanB (each with base + _impact)
	const presentToken = { id: "tokPresent", name: "Present" };
	globalThis.canvas.tokens.placeables = [presentToken, token];
	const effects = [
		{ data: { name: `${MODULE_ID}-torch-tokPresent-item1` } },
		{ data: { name: `${MODULE_ID}-torch-tokPresent-item1_impact` } },
		{ data: { name: `${MODULE_ID}-torch-tokA-itemB` } }, // tokA is present via `token`
		{ data: { name: `${MODULE_ID}-torch-orphanA-itemX` } },
		{ data: { name: `${MODULE_ID}-torch-orphanA-itemX_impact` } },
		{ data: { name: `${MODULE_ID}-torch-orphanB-itemY` } },
		{ data: { name: `${MODULE_ID}-weapon-tokA-itemB` } }, // weapon prefix must be ignored
		{ data: { name: "other-torch-tokA-itemB" } },
	];
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	endEffectsCalls.length = 0;
	await sweepOrphanTorchEffects();

	// Should produce one call per orphan tokenId, each with anchored glob "-*"
	const names = endEffectsCalls.map(c => c.name);
	assert.equal(endEffectsCalls.length, 2, `expected 2 orphan sweeps, got ${JSON.stringify(names)}`);
	for (const n of names) {
		assert.equal(typeof n, "string");
		assert.ok(n.endsWith("-*"), `orphan sweep must be anchored glob: ${n}`);
	}
	assert.ok(names.includes(`${MODULE_ID}-torch-orphanA-*`), "orphanA sweep");
	assert.ok(names.includes(`${MODULE_ID}-torch-orphanB-*`), "orphanB sweep");
	// Verify each orphan sweep name matches both base and _impact under Sequencer rules
	for (const n of names) {
		const matcher = sequencerNameFilter(n);
		const orphanId = n.slice(`${MODULE_ID}-torch-`.length, -2); // strip "-*"
		for (const suffix of [`${orphanId}-itemX`, `${orphanId}-itemX_impact`, `${orphanId}-itemY`, `${orphanId}-itemY_impact`]) {
			// Only the relevant orphan's suite should match its own sweep name
			if (!n.includes(orphanId)) continue;
		}
		// At least ensure the sweep name would match its base and _impact forms
		assert.ok(`${MODULE_ID}-torch-${orphanId}-someItem`.match(matcher));
		assert.ok(`${MODULE_ID}-torch-${orphanId}-someItem_impact`.match(matcher));
	}
	// Present tokens must be spared
	assert.ok(!names.includes(`${MODULE_ID}-torch-tokPresent-*`), "present token must be spared");
	assert.ok(!names.includes(`${MODULE_ID}-torch-tokA-*`), "tokA is present via placeables");
});

test("sweepOrphanTorchEffects spares _impact of present tokens and is a string - * filter", async () => {
	globalThis.canvas.tokens.placeables = [{ id: "keepTok" }];
	const effects = [
		{ data: { name: `${MODULE_ID}-torch-keepTok-item1` } },
		{ data: { name: `${MODULE_ID}-torch-keepTok-item1_impact` } },
		{ data: { name: `${MODULE_ID}-torch-goneTok-item1` } },
		{ data: { name: `${MODULE_ID}-torch-goneTok-item1_impact` } },
	];
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	endEffectsCalls.length = 0;
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.equal(endEffectsCalls[0].name, `${MODULE_ID}-torch-goneTok-*`);
	assert.equal(typeof endEffectsCalls[0].name, "string");
});

test("sweepOrphanTorchEffects handles effects stored as .name fallback", async () => {
	globalThis.canvas.tokens.placeables = [{ id: "keepTok" }];
	const effects = [
		{ name: `${MODULE_ID}-torch-goneTok-item1` }, // no .data
	];
	globalThis.Sequencer.EffectManager.getEffects = () => effects;
	endEffectsCalls.length = 0;
	await sweepOrphanTorchEffects();
	assert.equal(endEffectsCalls.length, 1);
	assert.equal(endEffectsCalls[0].name, `${MODULE_ID}-torch-goneTok-*`);
});

test("activeGM election: restores on GM, not on first-active non-GM", () => {
	const origGame = globalThis.game;
	// World where user "player1" is first active but not GM; activeGM is "gm1"
	const gmUser = { id: "gm1", active: true, isGM: true };
	const playerUser = { id: "player1", active: true, isGM: false };
	const otherGM = { id: "gm2", active: true, isGM: true };
	const usersArray = [playerUser, gmUser, otherGM];
	const gameWithElection = {
		...origGame,
		user: gmUser, // current client is the GM
		users: {
			activeGM: gmUser,
			find: fn => usersArray.find(fn),
		},
	};
	globalThis.game = gameWithElection;
	assert.equal(isTorchCanvasRestoreAllowed(), true, "GM should be allowed to restore");

	// Same world, current client is the first-active non-GM
	globalThis.game = {
		...origGame,
		user: playerUser,
		users: {
			activeGM: gmUser,
			find: fn => usersArray.find(fn),
		},
	};
	assert.equal(isTorchCanvasRestoreAllowed(), false, "first-active non-GM must NOT restore even though find() would pick them");

	// Edge: no active GM (e.g. GM offline) — no one restores
	globalThis.game = {
		...origGame,
		user: playerUser,
		users: {
			activeGM: null,
			find: fn => usersArray.find(fn),
		},
	};
	assert.equal(isTorchCanvasRestoreAllowed(), false, "no activeGM => no restore");

	// Restore original mock for subsequent tests
	globalThis.game = origGame;
});

test("stop still produces string filters carrying the -* anchor (Sequencer would throw on RegExp)", async () => {
	globalThis.canvas.tokens.placeables = [{ id: "tokA" }];
	globalThis.Sequencer.EffectManager.getEffects = () => [];
	endEffectsCalls.length = 0;
	await stopAllTorchAnimations(token);
	await stopTorchAnimation(token, null);
	// Also exercise sweep's filter shape
	globalThis.Sequencer.EffectManager.getEffects = () => [{ data: { name: `${MODULE_ID}-torch-orphan-item1` } }];
	globalThis.canvas.tokens.placeables = [];
	await sweepOrphanTorchEffects();
	for (const call of endEffectsCalls) {
		assert.equal(typeof call.name, "string", `Sequencer throws on RegExp name: got ${typeof call.name}`);
		// anchored glob check — must be `prefix-tokenId-*` with hyphen before *
		if (call.name.includes(`${MODULE_ID}-torch-`)) {
			assert.ok(call.name.endsWith("-*"), `anchored glob missing -* hyphen: ${call.name}`);
		}
	}
});
