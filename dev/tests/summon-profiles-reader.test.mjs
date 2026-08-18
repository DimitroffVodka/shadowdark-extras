import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Reported as "I still have not been able to successfully cast and summon a
// monster yet", with a correctly configured spell and no console error.
//
// The item sheet persists summon profiles as a JSON string — a hidden input
// holding JSON.stringify(profiles). Every consumer guarded with
//
//     Array.isArray(config.profiles) ? … : (typeof config.profiles === "object" ? … : [])
//
// which is false for a string, so the guard produced an empty list and
// `summoningProfiles.length > 0` was never true. The entire summoning block was
// skipped on every real cast: no creature, no error, nothing to see.
//
// The spawn function behind the gate even parsed the string itself, so the
// string shape was expected — the gate in front of it just never let anything
// reach it.

globalThis.console = { ...console, warn() {} };  // the corrupt-input path logs

const { readSummonProfiles } = await import("../../scripts/shared/summon-profiles.mjs");

const PROFILES = [
	{ creatureUuid: "Compendium.shadowdark.monsters.zombie", creatureName: "Zombie", count: "1" },
	{ creatureUuid: "Compendium.shadowdark.monsters.skeleton", creatureName: "Skeleton", count: "1" },
];

test("a JSON string — what the item sheet actually stores — reads as profiles", () => {
	// The exact shape that made casting do nothing.
	const config = { enabled: true, profiles: JSON.stringify(PROFILES) };
	const read = readSummonProfiles(config);
	assert.equal(read.length, 2);
	assert.deepEqual(read.map(p => p.creatureName), ["Zombie", "Skeleton"]);
});

test("the gate in front of the summon block now passes for a stored config", () => {
	// This is the condition that decides whether anything is summoned at all.
	const config = { enabled: true, profiles: JSON.stringify(PROFILES) };
	assert.equal(!!(config.enabled && readSummonProfiles(config).length > 0), true);
});

test("an array is returned unchanged", () => {
	assert.deepEqual(readSummonProfiles({ profiles: PROFILES }), PROFILES);
});

test("an index-keyed object is read as values", () => {
	// Foundry's form expansion can turn an array into {0: …, 1: …}.
	const config = { profiles: { 0: PROFILES[0], 1: PROFILES[1] } };
	assert.deepEqual(readSummonProfiles(config).map(p => p.creatureName), ["Zombie", "Skeleton"]);
});

test("absent, empty and blank configs read as no profiles", () => {
	for (const config of [null, undefined, {}, { profiles: null }, { profiles: "" }, { profiles: "   " }, { profiles: [] }]) {
		assert.deepEqual(readSummonProfiles(config), [], `unexpected profiles for ${JSON.stringify(config)}`);
	}
});

test("a corrupt string yields no profiles rather than throwing", () => {
	// This runs inside a chat-card render; throwing here would take out the card.
	assert.deepEqual(readSummonProfiles({ profiles: "{not json" }), []);
	assert.deepEqual(readSummonProfiles({ profiles: "\"a string\"" }), [], "valid JSON that is not an array");
	assert.deepEqual(readSummonProfiles({ profiles: "42" }), []);
});

test("no consumer still hand-rolls the guard that caused this", () => {
	// Three call sites shared the broken shape. A fourth reintroducing it would
	// silently break casting again, and the behavioural tests above cannot see
	// that — they only exercise the reader.
	for (const file of [
		"scripts/combat/damage-card-pipeline.mjs",
		"scripts/item-macros/npc-feature-macros.mjs",
	]) {
		const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
		assert.ok(
			!/Array\.isArray\([^)]*\.profiles\)/.test(source),
			`${file} guards summon profiles by hand instead of using readSummonProfiles`);
	}
});
