// Weapon animation stop-path regression test (issue #97).
//
// The "weapon went away" cleanup funnels through Sequencer.EffectManager
// .endEffects with a NAME filter. Sequencer's name filter is a string that is
// compiled to an anchored regex where `*` is a glob: `\*+` becomes `.*?`
// (see Sequencer's `str_to_search_regex_str`). The historical bug was a
// BARE `*` glued to the token id (`...weapon-<tokenId>*`), which is fragile
// and non-anchored: token id `tokA` also matched token `tokA1`'s effects.
// The effect names this module plays are
// `shadowdark-extras-weapon-<tokenId>-<itemId>` (no suffix variant).
//
// The stop paths must therefore pass a STRING name filter (Sequencer throws
// on a RegExp — "inFilter.name must be of type string") that actually matches
// the played effect names and carries the trailing-hyphen anchor. That
// invariant is what this test pins.

import assert from "node:assert/strict";
import test from "node:test";

const token = { id: "tokA", name: "TestToken" };
const itemId = "itemB";

// Minimal live-world stand-ins: the stop functions read game.modules /
// game.settings through checkDependencies() and fire Sequencer.EndEffects.
// Unlike TorchAnimationSD, WeaponAnimationSD also resolves FilePicker from
// foundry.applications.apps at import time, so `foundry` needs a stub too.
globalThis.foundry = { applications: { apps: {} } };
globalThis.game = {
	user: { id: "u1" },
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
const hooks = {};
globalThis.Hooks = {
	on: (name, fn) => { hooks[name] = fn; },
};

const { stopAllWeaponAnimations, stopWeaponAnimation, initWeaponAnimations } = await import(
	"../../scripts/animation/WeaponAnimationSD.mjs"
);

const MODULE_ID = "shadowdark-extras";
const effectName = `${MODULE_ID}-weapon-${token.id}-${itemId}`;
const playedNames = [effectName];

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

function assertDoesNotStopPrefixSharingToken(name) {
	const matcher = sequencerNameFilter(name);
	const foreignEffect = `${MODULE_ID}-weapon-tokA1-${itemId}`;
	assert.ok(
		!foreignEffect.match(matcher),
		`name filter ${JSON.stringify(name)} must not match prefix-sharing token id ${foreignEffect}`
	);
}

test("stopAllWeaponAnimations ends every weapon effect for the token", async () => {
	endEffectsCalls.length = 0;
	await stopAllWeaponAnimations(token);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assertStopsEveryPlayedEffect(filter.name);
	assert.ok(filter.name.endsWith("-*"), "anchored glob: itemId suffix follows the trailing hyphen");
	assertDoesNotStopPrefixSharingToken(filter.name);
});

test("stopWeaponAnimation with an itemId still targets the exact effect name", async () => {
	endEffectsCalls.length = 0;
	await stopWeaponAnimation(token, itemId);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assert.equal(filter.name, effectName);
	assert.equal(filter.object, token);
});

test("deleteToken hook ends every weapon effect for the deleted token", async () => {
	endEffectsCalls.length = 0;
	initWeaponAnimations();

	const handler = hooks.deleteToken;
	assert.ok(typeof handler === "function", "deleteToken hook registered");
	await handler({ id: token.id }, {}, game.user.id);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assertStopsEveryPlayedEffect(filter.name);
	assert.ok(filter.name.endsWith("-*"), "anchored glob: itemId suffix follows the trailing hyphen");
	assertDoesNotStopPrefixSharingToken(filter.name);
});
