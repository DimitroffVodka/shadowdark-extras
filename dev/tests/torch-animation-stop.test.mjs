// Torch animation stop-path regression test (issue #83).
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
	},
};

const { stopAllTorchAnimations, stopTorchAnimation } = await import(
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
	for (const effectName of playedNames) {
		assert.ok(
			effectName.match(matcher)?.length,
			`name filter ${JSON.stringify(name)} must match played effect ${effectName}`
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
