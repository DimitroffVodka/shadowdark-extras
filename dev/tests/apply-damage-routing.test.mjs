import assert from "node:assert/strict";
import test from "node:test";
import { escapeHTML } from "./helpers/escape-html.mjs";

// Damage routing (#215): each path spends an optional Enhancer pool before its
// awaited HP update. Shadowdark's applyDamage does NOT await/return its update;
// awaiting it would acknowledge a card before HP persists (including on failure).
// With no Enhancer the original direct update and clamp still apply.

globalThis.window = globalThis;
globalThis.foundry = {
	applications: {
		api: {
			ApplicationV2: class {},
			HandlebarsApplicationMixin: base => base,
		},
	},
	utils: {
		randomID: () => "id",
		Collection: class extends Map {},
		deepClone: value => JSON.parse(JSON.stringify(value)),
		escapeHTML,
		getProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object),
	},
};
globalThis.CONST = { TEXT_ANCHOR_POINTS: { TOP: 0, BOTTOM: 1 } };
globalThis.Actor = class {};
globalThis.CONFIG = { time: { roundTime: 0, turnTime: 0 } };
globalThis.Hooks = { on: () => {}, once: () => {}, callAll: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
globalThis.canvas = {
	tokens: { get: () => null, placeables: [] },
	interface: { createScrollingText: () => {} },
};
globalThis.game = {
	settings: { get: () => undefined, register: () => {} },
	i18n: { localize: key => key, format: key => key },
	user: { id: "gm", isGM: true },
	messages: { get: () => null },
	actors: { get: () => null, contents: [] },
	shadowdarkEnhancer: {
		tempHp: {
			of: actor => actor.pool,
			set: async (actor, value) => {
				actor.applied.push(actor.pool - value);
				actor.pool = value;
			},
		},
	},
};
globalThis.ChatMessage = { create: async () => {}, getSpeaker: () => ({}) };

// `new Roll(formula).evaluate()` in aura, template, duration and focus damage.
let rollTotal = 1;
globalThis.Roll = class {
	constructor(formula) {
		this.formula = formula;
		this.total = rollTotal;
	}
	async evaluate() {
		return this;
	}
};

const { setupCombatSocket } = await import("../../scripts/shared/combat-socket.mjs");
const { applyAuraDamage } = await import("../../scripts/effects/aura-application.mjs");
const { applyTemplateDamage } = await import("../../scripts/effects/template-application.mjs");
const { onDurationDamageApplyClick } = await import("../../scripts/effects/duration-ui.mjs");
const durationSpell = await import("../../scripts/effects/duration-spell.mjs");
const focusSpell = await import("../../scripts/effects/focus-spell.mjs");

const registrations = new Map();
globalThis.socketlib = {
	registerModule: () => ({ register: (name, handler) => registrations.set(name, handler) }),
};
setupCombatSocket();
const applyCardDamage = registrations.get("applyTokenDamage");
assert.ok(applyCardDamage, "the damage card's apply handler must be registered");

/** A target with a pool of temporary hit points in front of HP. */
function makeActor({ hp = 3, max = 3, pool = 0, flags = {}, write } = {}) {
	return {
		id: "target-actor",
		name: "Target",
		pool,
		hp: { value: hp, max },
		applied: [],
		defeats: 0,
		writes: [],
		get system() {
			return { attributes: { hp: { value: this.hp.value, max: this.hp.max } } };
		},
		getFlag: (_module, key) => flags[key],
		async update(changes) {
			this.writes.push(changes);
			if (write) await write();
			const value = changes["system.attributes.hp.value"];
			if (value !== undefined) {
				if (value === 0 && this.hp.value !== 0) this.defeats += 1; // updateActor hook
				this.hp.value = value;
			}
			return this;
		},
		async applyDamage() {
			throw new Error("Do not call the system's fire-and-forget applyDamage");
		},
	};
}

function makeToken(id, actor) {
	return { id, name: actor.name, actor };
}

/** The scene the drives below read tokens from. */
function place(...tokens) {
	const byId = new Map(tokens.map(token => [token.id, token]));
	globalThis.canvas.tokens.get = id => byId.get(id) ?? null;
}

test("the damage card spends the temp HP pool before writing HP", async () => {
	const absorbed = makeActor({ pool: 2 });
	place(makeToken("target-token", absorbed));
	assert.equal(await applyCardDamage({ tokenId: "target-token", damage: 2, damageType: "damage" }), true);
	assert.deepEqual(absorbed.applied, [2], "the pool spends the hit first");
	assert.equal(absorbed.pool, 0, "the pool is spent first");
	assert.equal(absorbed.hp.value, 3, "nothing is left to reach HP");
	assert.deepEqual(absorbed.writes, [], "no HP write of the module's own");

	const overflow = makeActor({ pool: 2 });
	place(makeToken("target-token", overflow));
	assert.equal(await applyCardDamage({ tokenId: "target-token", damage: 5, damageType: "damage" }), true);
	assert.deepEqual(overflow.applied, [2]);
	assert.equal(overflow.pool, 0);
	assert.equal(overflow.hp.value, 0, "the overflow past the pool reaches HP");
	assert.equal(overflow.defeats, 1, "the existing updateActor hook marks defeat once");

	const healed = makeActor({ hp: 1, pool: 2 });
	place(makeToken("target-token", healed));
	assert.equal(await applyCardDamage({
		tokenId: "target-token", damage: 3, isHealing: true, damageType: "damage",
	}), true);
	assert.deepEqual(healed.applied, [], "healing never spends a pool");
	assert.equal(healed.pool, 2, "healing never touches the pool");
	assert.equal(healed.hp.value, 3);
});

test("the card hands over the resisted, glassboned number, not the rolled one", async () => {
	const resistant = makeActor({ pool: 3, flags: { "resistance.fire": true } });
	place(makeToken("target-token", resistant));
	await applyCardDamage({
		tokenId: "target-token", damage: 4, damageType: "fire",
		damageComponents: [{ amount: 4, type: "fire" }],
	});
	assert.deepEqual(resistant.applied, [2], "resistance halves before the pool sees the hit");
	assert.equal(resistant.pool, 1);

	const glassboned = makeActor({ pool: 5, flags: { glassbones: true } });
	place(makeToken("target-token", glassboned));
	await applyCardDamage({ tokenId: "target-token", damage: 2, damageType: "damage" });
	assert.deepEqual(glassboned.applied, [4], "Glassbones doubles before the pool sees the hit");
	assert.equal(glassboned.pool, 1);
	assert.equal(glassboned.hp.value, 3);
});

test("an aura tick spends the temp HP pool", async () => {
	rollTotal = 2;
	const absorbed = makeActor({ pool: 2 });
	const token = makeToken("target-token", absorbed);
	place(token);
	const config = { damage: { formula: "1d6" }, save: { halfOnSuccess: true } };
	assert.equal(await applyAuraDamage(token, config, false), 2);
	assert.deepEqual(absorbed.applied, [2]);
	assert.equal(absorbed.pool, 0);
	assert.equal(absorbed.hp.value, 3);

	rollTotal = 5;
	const saved = makeActor();
	place(makeToken("target-token", saved));
	assert.equal(await applyAuraDamage(makeToken("target-token", saved), config, true), 2);
	assert.deepEqual(saved.applied, [], "without a pool the halved damage reaches HP");
	assert.equal(saved.hp.value, 1);
});

test("a template hit spends the temp HP pool", async () => {
	rollTotal = 3;
	const actor = makeActor({ pool: 2 });
	const token = makeToken("target-token", actor);
	place(token);
	const result = await applyTemplateDamage({ id: "template-1" }, token, { damage: { formula: "1d6" } }, false);
	assert.equal(result.damage, 3);
	assert.deepEqual(actor.applied, [2]);
	assert.equal(actor.pool, 0);
	assert.equal(actor.hp.value, 2);
});

test("a duration spell's per-turn tick spends the temp HP pool", async () => {
	rollTotal = 2;
	const target = makeActor({ pool: 2 });
	const token = makeToken("target-token", target);
	place(token);
	const flags = {
		activeDurationSpells: [{
			instanceId: "duration-temp-hp",
			spellId: "spell-temp-hp",
			spellName: "Cloudkill",
			perTurnDamage: "1d6",
			targets: [{ actorId: target.id, tokenId: token.id, name: target.name }],
			targetEffects: [],
			lastProcessedRound: 0,
			processedTargetsThisRound: {},
		}],
	};
	const caster = Object.assign(makeActor(), {
		id: "caster-actor",
		name: "Caster",
		getFlag: (_module, key) => flags[key],
		setFlag: async (_module, key, value) => { flags[key] = value; },
	});
	globalThis.game.actors = Object.assign([caster, target], {
		get: id => [caster, target].find(actor => actor.id === id) ?? null,
	});
	globalThis.game.user = { id: "gm", isGM: true };
	globalThis.game.users = { activeGM: { id: "gm" } };
	globalThis.game.settings = { get: () => ({ damageCard: { autoApplyDamage: true } }), register: () => {} };

	await durationSpell.handleDurationSpellCombatUpdate(
		{ id: "combat-temp-hp", round: 1, turn: 1, combatant: { actor: target, token } },
		{ turn: 1 },
		{},
		"gm",
	);

	assert.deepEqual(target.applied, [2], "the tick spends the pool before HP");
	assert.equal(target.pool, 0);
	assert.equal(target.hp.value, 3);
	assert.equal(flags.activeDurationSpells[0].processedTargetsThisRound[token.id], true);
});

test("a duration card's Apply Damage button spends the pool on the GM's client", async () => {
	const actor = makeActor({ pool: 2 });
	const token = makeToken("target-token", actor);
	place(token);
	globalThis.game.user = { id: "gm", isGM: true };
	let marked = false;
	globalThis.game.messages = { get: () => ({ setFlag: async () => { marked = true; } }) };
	const button = {
		dataset: { tokenId: token.id, damage: "2", actorName: actor.name },
		classList: { contains: () => false, add: () => {} },
		closest: selector => selector === "[data-message-id]" ? { dataset: { messageId: "message-1" } } : null,
	};

	await onDurationDamageApplyClick({
		target: { closest: () => button },
		preventDefault: () => {},
		stopPropagation: () => {},
	});

	assert.deepEqual(actor.applied, [2]);
	assert.equal(actor.pool, 0);
	assert.equal(actor.hp.value, 3);
	assert.equal(marked, true, "the card is marked applied");
});

test("a focus spell's per-turn tick spends the pool, and its healing does not", async () => {
	rollTotal = 2;
	const damaged = makeActor({ pool: 2 });
	const damagedToken = makeToken("target-token", damaged);
	const healed = makeActor({ hp: 1, pool: 2 });
	const healedToken = makeToken("heal-token", healed);
	place(damagedToken, healedToken);
	globalThis.game.settings = { get: () => ({ damageCard: { autoApplyDamage: true } }), register: () => {} };
	globalThis.game.user = { id: "gm", isGM: true };

	await focusSpell.applyFocusSpellPerTurnToTargets({
		spellName: "Brain Worms",
		perTurnDamage: "1d6",
		damageType: "damage",
		targetEffects: [{ targetTokenId: damagedToken.id, targetActorId: damaged.id }],
	});
	assert.deepEqual(damaged.applied, [2]);
	assert.equal(damaged.pool, 0);
	assert.equal(damaged.hp.value, 3);

	await focusSpell.applyFocusSpellPerTurnToTargets({
		spellName: "Radiant Light",
		perTurnDamage: "1d6",
		damageType: "healing",
		targetEffects: [{ targetTokenId: healedToken.id, targetActorId: healed.id }],
	});
	assert.deepEqual(healed.applied, [], "healing does not spend the pool");
	assert.equal(healed.pool, 2, "healing leaves the pool alone");
	assert.equal(healed.hp.value, 3);
});

test("without the Enhancer, damage and healing keep the direct awaited update", async () => {
	const enhancer = game.shadowdarkEnhancer;
	game.shadowdarkEnhancer = undefined;
	try {
		const actor = makeActor({ hp: 3, max: 3 });
		place(makeToken("target-token", actor));
		assert.equal(await applyCardDamage({ tokenId: "target-token", damage: 5 }), true);
		assert.equal(actor.hp.value, 0);
		assert.equal(actor.defeats, 1);
		assert.equal(await applyCardDamage({ tokenId: "target-token", damage: 6, isHealing: true }), true);
		assert.equal(actor.hp.value, 3, "healing is capped at max HP");
		assert.deepEqual(actor.applied, [], "the system applyDamage signature is not required, even at the 3.0.0 floor");
	}
	finally {
		game.shadowdarkEnhancer = enhancer;
	}
});

test("the card waits for the HP write, then uses the updated HP for the next hit", async () => {
	let release;
	const held = new Promise(resolve => { release = resolve; });
	let writes = 0;
	const actor = makeActor({ write: () => ++writes === 1 ? held : undefined });
	place(makeToken("target-token", actor));
	const first = applyCardDamage({ tokenId: "target-token", damage: 1 });
	await Promise.resolve();
	assert.equal(await Promise.race([first.then(() => "settled"), Promise.resolve("pending")]), "pending");
	assert.equal(actor.hp.value, 3, "the first write is still pending");
	release();
	assert.equal(await first, true);
	assert.equal(actor.hp.value, 2);
	assert.equal(await applyCardDamage({ tokenId: "target-token", damage: 1 }), true);
	assert.equal(actor.hp.value, 1);
});

test("the card rejects a failed HP write rather than marking the hit applied", async () => {
	const actor = makeActor({ write: () => Promise.reject(new Error("write failed")) });
	place(makeToken("target-token", actor));
	const log = console.error;
	console.error = () => {};
	try {
		assert.equal(await applyCardDamage({ tokenId: "target-token", damage: 1 }), false);
		assert.equal(actor.hp.value, 3);
	}
	finally {
		console.error = log;
	}
});

test("a failed pool write does not advance to HP or acknowledge success", async () => {
	const original = game.shadowdarkEnhancer.tempHp.set;
	game.shadowdarkEnhancer.tempHp.set = () => Promise.reject(new Error("pool write failed"));
	const log = console.error;
	console.error = () => {};
	try {
		const actor = makeActor({ pool: 2 });
		place(makeToken("target-token", actor));
		assert.equal(await applyCardDamage({ tokenId: "target-token", damage: 5 }), false);
		assert.equal(actor.hp.value, 3);
		assert.equal(actor.pool, 2);
		assert.deepEqual(actor.writes, []);
	}
	finally {
		game.shadowdarkEnhancer.tempHp.set = original;
		console.error = log;
	}
});
