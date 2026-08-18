import assert from "node:assert/strict";
import test from "node:test";
import { escapeHTML } from "./helpers/escape-html.mjs";

// A spell that lists several summon profiles has always summoned all of them,
// and for most spells that is right. Shadowdark's Undeath is the other shape —
// "it rises as a zombie or skeleton" — one creature, chosen when it is cast.
//
// `summoning.creatureSelectionMode` opts a spell into being asked, mirroring the
// existing `spellDamage.effectSelectionMode` all/prompt vocabulary. The default
// stays "all", so no already-configured spell changes behaviour.

globalThis.window = globalThis;

/** Records what the production code asked Portal to spawn. */
let portalCalls;
/** Controls what the picker dialog "returns"; set per test. */
let dialogChoice;
/** How many times a dialog was opened. */
let dialogOpens;

globalThis.Portal = class {
	origin() { return this; }
	addCreature(spec) { portalCalls.push(spec); return this; }
	async spawn() { return []; }   // no tokens — the ownership/duration tail is not under test
};

globalThis.foundry = {
	applications: {
		api: {
			ApplicationV2: class {},
			HandlebarsApplicationMixin: (base) => base,
			// Stands in for the picker. Rather than drive real DOM, resolve the
			// configured choice through the dialog's own callback, so the callback
			// wiring is still exercised.
			DialogV2: class {
				constructor(config) { this.config = config; }
				render() {
					dialogOpens++;
					const summon = this.config.buttons.find(b => b.action === "summon");
					if (dialogChoice === null) {
						this.config.buttons.find(b => b.action === "cancel").callback();
						return this;
					}
					summon.callback(null, null, {
						element: { querySelector: () => ({ value: String(dialogChoice) }) },
					});
					return this;
				}
			},
		},
	},
	utils: { randomID: () => "id", Collection: class extends Map {}, escapeHTML, mergeObject: (a, b) => ({ ...a, ...b }) },
};

globalThis.game = {
	settings: { get: () => undefined, register: () => {} },
	i18n: { localize: (k) => k },
	user: { id: "user-gm", isGM: true },
	users: [],
	actors: { get: () => null },
	scenes: { current: null },
};
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.ChatMessage = { getSpeaker: () => ({}) };
globalThis.CONFIG = { Item: { documentClass: class {} } };
// `_resolveActorForSummon` short-circuits for a world actor that is not in a
// pack, which keeps these tests off the compendium-import path entirely.
globalThis.Actor = class {};
globalThis.fromUuidSync = () => Object.assign(new globalThis.Actor(), { pack: null });

const { spawnSummonedCreatures } = await import("../../scripts/combat/damage-card-actions.mjs");

const ZOMBIE = { creatureUuid: "Actor.zombie", creatureName: "Zombie", count: "1" };
const SKELETON = { creatureUuid: "Actor.skeleton", creatureName: "Skeleton", count: "1" };

/** A caster with a token on the scene — the minimum the spawn path requires. */
function caster() {
	return {
		id: "actor-caster",
		name: "Necromancer",
		getActiveTokens: () => [{ id: "token-caster" }],
	};
}

const item = { name: "Undeath", system: { duration: { type: "rounds", value: "5" } } };

test.beforeEach(() => {
	portalCalls = [];
	dialogOpens = 0;
	dialogChoice = 0;
});

test("by default every listed creature is summoned", async () => {
	// The pre-existing contract. A spell configured with two creatures that means
	// to summon both must keep doing so.
	await spawnSummonedCreatures(caster(), item, [ZOMBIE, SKELETON], {}, false);
	assert.equal(dialogOpens, 0, "no prompt should appear in the default mode");
	assert.deepEqual(portalCalls.map(c => c.creature), ["Actor.zombie", "Actor.skeleton"]);
});

test("an explicit \"all\" mode behaves the same as the default", async () => {
	await spawnSummonedCreatures(caster(), item, [ZOMBIE, SKELETON], { creatureSelectionMode: "all" }, false);
	assert.equal(dialogOpens, 0);
	assert.equal(portalCalls.length, 2);
});

test("\"prompt\" summons only the chosen creature", async () => {
	dialogChoice = 1; // Skeleton
	await spawnSummonedCreatures(caster(), item, [ZOMBIE, SKELETON], { creatureSelectionMode: "prompt" }, false);
	assert.equal(dialogOpens, 1, "the caster should have been asked");
	assert.deepEqual(portalCalls.map(c => c.creature), ["Actor.skeleton"],
		"only the chosen creature is summoned — this is the zombie OR skeleton case");
});

test("\"prompt\" honours the first option too", async () => {
	dialogChoice = 0; // Zombie
	await spawnSummonedCreatures(caster(), item, [ZOMBIE, SKELETON], { creatureSelectionMode: "prompt" }, false);
	assert.deepEqual(portalCalls.map(c => c.creature), ["Actor.zombie"]);
});

test("cancelling the prompt summons nothing", async () => {
	// Declining is not the same as "summon everything" — the caster backed out.
	dialogChoice = null;
	await spawnSummonedCreatures(caster(), item, [ZOMBIE, SKELETON], { creatureSelectionMode: "prompt" }, false);
	assert.equal(dialogOpens, 1);
	assert.deepEqual(portalCalls, [], "a cancelled prompt must not fall back to summoning all");
});

test("a single creature never prompts, even in \"prompt\" mode", async () => {
	// Asking "which one?" about a list of one is noise, so the gate requires more
	// than one profile before it interrupts the caster.
	await spawnSummonedCreatures(caster(), item, [ZOMBIE], { creatureSelectionMode: "prompt" }, false);
	assert.equal(dialogOpens, 0);
	assert.deepEqual(portalCalls.map(c => c.creature), ["Actor.zombie"]);
});

test("an unrecognised mode falls back to summoning all", async () => {
	// Safe direction: a typo or a config from a future version must not silently
	// drop creatures.
	await spawnSummonedCreatures(caster(), item, [ZOMBIE, SKELETON], { creatureSelectionMode: "nonsense" }, false);
	assert.equal(dialogOpens, 0);
	assert.equal(portalCalls.length, 2);
});
