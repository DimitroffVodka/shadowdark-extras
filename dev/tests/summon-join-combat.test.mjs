import assert from "node:assert/strict";
import test from "node:test";
import { escapeHTML } from "./helpers/escape-html.mjs";

// Undeath reads "the creature acts on your turn", and that is the general shape
// for a summon: it belongs in the encounter on its summoner's initiative rather
// than waiting for the GM to add it by hand.
//
// `buildSummonCombatantData` is the decision — which tokens become combatants
// and on what initiative — split out from the write so the GM-local path and the
// via-GM socket path cannot disagree about it. Testing the builder tests both.

globalThis.window = globalThis;
globalThis.foundry = {
	applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b, DialogV2: class {} } },
	utils: { randomID: () => "id", Collection: class extends Map {}, escapeHTML, mergeObject: (a, b) => ({ ...a, ...b }) },
};
globalThis.game = {
	settings: { get: () => undefined, register: () => {} },
	i18n: { localize: (k) => k },
	user: { id: "user-gm", isGM: true },
	users: [], actors: { get: () => null }, scenes: { current: null },
};
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.ChatMessage = { getSpeaker: () => ({}) };
globalThis.Actor = class {};
globalThis.fromUuidSync = () => Object.assign(new globalThis.Actor(), { pack: null });
globalThis.Portal = class { origin() { return this; } addCreature() { return this; } async spawn() { return []; } };

/** Tokens the "scene" knows about, so the builder can resolve actor ids. */
let sceneTokens = {};
globalThis.canvas = {
	scene: { id: "scene-1" },
	tokens: { get: (id) => sceneTokens[id] ?? null },
};

const { buildSummonCombatantData } = await import("../../scripts/combat/damage-card-actions.mjs");

/** A combat with the given combatants; caster acts on 14. */
function combatWith(combatants) {
	return { id: "combat-1", scene: { id: "scene-1" }, combatants };
}
const CASTER = { actorId: "actor-caster", tokenId: "token-caster", initiative: 14 };

test.beforeEach(() => {
	sceneTokens = {
		"token-zombie": { actor: { id: "actor-zombie" } },
		"token-skeleton": { actor: { id: "actor-skeleton" } },
	};
});

test("summons take the caster's initiative, not a fresh roll", () => {
	const rows = buildSummonCombatantData(combatWith([CASTER]), "actor-caster", ["token-zombie"]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].initiative, 14, "the summon must act when its summoner does");
	assert.equal(rows[0].tokenId, "token-zombie");
	assert.equal(rows[0].actorId, "actor-zombie");
	assert.equal(rows[0].sceneId, "scene-1");
});

test("every summoned token is added, sharing the one initiative", () => {
	const rows = buildSummonCombatantData(combatWith([CASTER]), "actor-caster", ["token-zombie", "token-skeleton"]);
	assert.deepEqual(rows.map(r => r.tokenId), ["token-zombie", "token-skeleton"]);
	assert.deepEqual(rows.map(r => r.initiative), [14, 14]);
});

test("a caster who is not in the encounter adds nothing", () => {
	// There is no initiative to share. Guessing one would place the summons at a
	// point in the round where the caster never acts, so the GM decides instead.
	const rows = buildSummonCombatantData(combatWith([]), "actor-caster", ["token-zombie"]);
	assert.deepEqual(rows, []);
});

test("a token already in the encounter is not added twice", () => {
	// Re-casting, or a summon the GM already dragged in, must not produce a
	// duplicate row acting twice per round.
	const combat = combatWith([CASTER, { actorId: "actor-zombie", tokenId: "token-zombie", initiative: 3 }]);
	const rows = buildSummonCombatantData(combat, "actor-caster", ["token-zombie", "token-skeleton"]);
	assert.deepEqual(rows.map(r => r.tokenId), ["token-skeleton"]);
});

test("a caster who has not rolled initiative yet carries that through", () => {
	// null initiative is Foundry's "not rolled". Copying it keeps the summon
	// beside its summoner in the tracker; inventing a number would not.
	const rows = buildSummonCombatantData(
		combatWith([{ ...CASTER, initiative: null }]), "actor-caster", ["token-zombie"]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].initiative, null);
});

test("no combat, no tokens, or an empty list produce nothing", () => {
	assert.deepEqual(buildSummonCombatantData(null, "actor-caster", ["token-zombie"]), []);
	assert.deepEqual(buildSummonCombatantData(combatWith([CASTER]), "actor-caster", []), []);
	assert.deepEqual(buildSummonCombatantData(combatWith([CASTER]), "actor-caster", null), []);
});

test("falsy token ids are skipped rather than creating empty combatants", () => {
	const rows = buildSummonCombatantData(combatWith([CASTER]), "actor-caster", [null, "", "token-zombie"]);
	assert.deepEqual(rows.map(r => r.tokenId), ["token-zombie"]);
});
