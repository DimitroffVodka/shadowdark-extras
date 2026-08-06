// Weapon animation stop-path regression test (issue #97) + #105 identity model.
//
// The "weapon went away" cleanup funnels through Sequencer.EffectManager
// .endEffects with a NAME filter. Sequencer's name filter is a string that is
// compiled to an anchored regex where `*` is a glob: `\*+` becomes `.*?`
// (see Sequencer's `str_to_search_regex_str`). The historical bug was a
// BARE `*` glued to the token id (`...weapon-<tokenId>*`), which is fragile
// and non-anchored. After #105 effect names are `shadowdark-extras-weapon-<itemId>`
// (classification key only) and token identity is via `object`/`source`.
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

const { stopAllWeaponAnimations, stopWeaponAnimation, initWeaponAnimations, getEffectName, getLegacyEffectName, sweepOrphanWeaponEffects } = await import(
	"../../scripts/animation/WeaponAnimationSD.mjs"
);

const MODULE_ID = "shadowdark-extras";
const effectName = `${MODULE_ID}-weapon-${itemId}`;
const legacyEffectName = `${MODULE_ID}-weapon-${token.id}-${itemId}`;
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

test("stopAllWeaponAnimations ends every weapon effect for the token", async () => {
	endEffectsCalls.length = 0;
	await stopAllWeaponAnimations(token);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assertStopsEveryPlayedEffect(filter.name);
	assert.equal(filter.name, `${MODULE_ID}-weapon-*`, "kind wildcard plus object covers both new and legacy (see #105)");
	assert.equal(filter.object, token, "stopAll must carry object identity");
	assert.ok(filter.name.endsWith("-*"), "anchored glob: itemId suffix follows the trailing hyphen");
	// After #105 names collide across tokens by design; object disambiguates
	assert.ok(!getEffectName(itemId).includes(token.id), "effect name must not encode token id");
});

test("stopWeaponAnimation with an itemId still targets the exact effect name (and legacy)", async () => {
	// Note: stopWeaponAnimation(token, null) is unreachable — all 6 call sites pass
	// item.id and the weapon signature has no default (unlike torch's `itemId = null`);
	// stopAllWeaponAnimations is the wildcard entry point.
	endEffectsCalls.length = 0;
	await stopWeaponAnimation(token, itemId);

	// After #105 dual termination for transition compatibility
	assert.equal(endEffectsCalls.length, 2);
	const names = endEffectsCalls.map(c => c.name);
	assert.ok(names.includes(effectName), `new name ${effectName} must be terminated`);
	assert.ok(names.includes(legacyEffectName), "legacy name must be terminated");
	for (const f of endEffectsCalls) assert.equal(f.object, token);
});

test("deleteToken hook ends every weapon effect for the deleted token (source-verified)", async () => {
	endEffectsCalls.length = 0;
	initWeaponAnimations();

	const handler = hooks.deleteToken;
	assert.ok(typeof handler === "function", "deleteToken hook registered");
	const tokenDoc = { id: token.id, uuid: `Scene.sceneA.Token.${token.id}` };
	await handler(tokenDoc, {}, game.user.id);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assert.equal(filter.name, `${MODULE_ID}-weapon-*`);
	// Verified alternative: Document object validates without lookup (dist:475-480, 11718-11720)
	assert.ok(filter.source === tokenDoc || filter.object === tokenDoc, "delete must carry source/object identity (not name-only)");
});

test("stop still produces string filters carrying the -* anchor (Sequencer would throw on RegExp)", async () => {
	// Mirror torch case 14 — covers every weapon stop path including sweep.
	// Sequencer's _validateFilters throws on RegExp name (dist:11772-11775);
	// anchored glob string is correct and must not be converted to RegExp.
	endEffectsCalls.length = 0;
	// Ensure sweep has a canvas to work with
	const origCanvas = globalThis.canvas;
	const origGetEffects = globalThis.Sequencer.EffectManager.getEffects;
	globalThis.canvas = {
		tokens: { placeables: [{ id: "tokA", document: { uuid: "Scene.sceneA.Token.tokA" } }] },
		scene: { id: "sceneA" },
	};
	globalThis.game.user = { id: "u1", viewedScene: "sceneA" };
	globalThis.Sequencer.EffectManager.getEffects = () => [];

	endEffectsCalls.length = 0;
	await stopAllWeaponAnimations(token);
	await stopWeaponAnimation(token, itemId);

	// Sweep uses effects ids, not name globs — verify it doesn't produce RegExp either
	globalThis.Sequencer.EffectManager.getEffects = () => [
		{ data: { _id: "orphW1", name: `${MODULE_ID}-weapon-item1`, source: "Scene.sceneA.Token.orphan", sceneId: "sceneA" } },
	];
	globalThis.canvas.tokens.placeables = [];
	await sweepOrphanWeaponEffects();

	for (const call of endEffectsCalls) {
		if (call.name) {
			assert.equal(typeof call.name, "string", `Sequencer throws on RegExp name: got ${typeof call.name}`);
			if (call.name.includes(`${MODULE_ID}-weapon-`)) {
				assert.ok(
					call.name.endsWith("-*") || call.name === effectName || call.name === legacyEffectName,
					`anchored glob missing -* hyphen: ${call.name}`,
				);
			}
		}
		if (call.effects) {
			assert.ok(Array.isArray(call.effects), "effects filter must be array of ids");
			for (const id of call.effects) assert.equal(typeof id, "string");
		}
	}
	// Ensure at least one anchored glob was produced among the stop calls
	const nameCalls = endEffectsCalls.filter(c => c.name);
	assert.ok(nameCalls.some(c => c.name.endsWith("-*") || c.name === `${MODULE_ID}-weapon-*`), "stop path must produce anchored glob");
	assert.ok(nameCalls.every(c => typeof c.name === "string"), "never produce a RegExp name filter");

	// Restore
	globalThis.canvas = origCanvas;
	globalThis.Sequencer.EffectManager.getEffects = origGetEffects;
});
