import assert from "node:assert/strict";
import test from "node:test";
import { escapeHTML } from "./helpers/escape-html.mjs";

globalThis.window = globalThis;
globalThis.foundry = {
	applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: cls => cls } },
	documents: { RegionDocument: { implementation: class {} } },
	utils: { deepClone: structuredClone, escapeHTML },
};
globalThis.CONFIG = { time: { roundTime: 0, turnTime: 0 } };
globalThis.Hooks = { on() {}, off() {}, callAll() {} };
const duration = await import("../../scripts/effects/duration-spell.mjs");
const { handleEffectDeleted } = await import("../../scripts/effects/focus-spell.mjs");
const { DURATION_SPELL_FLAG: FLAG } = await import("../../scripts/effects/focus-constants.mjs");

function collection(values = []) {
	values.get = id => values.find(value => value.id === id);
	values.contents = values;
	return values;
}

function actor(id) {
	const flags = {};
	return {
		id, name: id, items: collection(), effects: collection(),
		getFlag: (_scope, key) => flags[key],
		// Foundry only changes document state after the server round trip.
		setFlag: async (_scope, key, value) => {
			const payload = structuredClone(value);
			await Promise.resolve();
			flags[key] = payload;
		},
	};
}

function setup() {
	const caster = actor("caster");
	const target = actor("target");
	const actors = collection([caster, target]);
	const chat = [];
	globalThis.game = {
		actors, user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } },
		time: { worldTime: 100 }, combat: null,
		i18n: { localize: key => key, format: key => key },
	};
	globalThis.canvas = { tokens: collection(), scene: null };
	globalThis.ui = { notifications: { info() {}, warn() {} } };
	globalThis.ChatMessage = { create: async data => chat.push(data), getSpeaker: () => ({}) };
	return { caster, target, chat };
}

function effectItem(target, id, remaining = 0) {
	const item = {
		id, name: id, type: "Effect", actor: target, getFlag: () => null,
		delete: async (options = {}) => {
			target.items.splice(target.items.indexOf(item), 1);
			await handleEffectDeleted(item, options, "gm");
		},
	};
	item.effects = collection([{
		id: `${id}-ae`, parent: item, actor: target, start: { time: 100 },
		duration: { units: "seconds", remaining, expired: remaining <= 0 },
	}]);
	target.items.push(item);
	return item;
}

function entry(id, items) {
	return {
		instanceId: id, spellId: id, spellName: id, targets: [],
		targetEffects: items.map(item => ({ targetActorId: item.actor.id, effectItemId: item.id })),
	};
}

const expired = { duration: { expired: true } };

test("only the active GM expires world-time fallback casts", async () => {
	const { caster, chat } = setup();
	const cast = { ...entry("legacy", []), expiryWorldTime: 100 };
	await caster.setFlag("shadowdark-extras", FLAG, [cast]);
	game.user = { id: "other-gm", isGM: true };
	await duration.handleDurationSpellWorldTimeUpdate();
	assert.equal(duration.getActiveDurationSpells(caster).length, 1);
	assert.equal(chat.length, 0);
	game.user = { id: "gm", isGM: true };
	await duration.handleDurationSpellWorldTimeUpdate();
	assert.equal(duration.getActiveDurationSpells(caster).length, 0);
	assert.equal(chat.length, 1);
});

test("a running effect on another target does not grant an expiry damage tick", async () => {
	const { caster, target } = setup();
	const other = actor("other");
	game.actors.push(other);
	const short = effectItem(target, "short", 0), long = effectItem(other, "long", 2);
	for (const item of [short, long]) {
		Object.assign(item.effects[0].start, { combat: "target-clocks", combatant: "caster-turn" });
		Object.assign(item.effects[0].duration, { units: "rounds", expiry: "turnStart", expired: false });
		item.effects[0].isExpiryEvent = event => event === "turnStart";
	}
	const cast = entry("cast", [short, long]);
	Object.assign(cast, { perTurnDamage: "1", lastProcessedRound: 1,
		targets: [{ actorId: target.id, tokenId: "short" }, { actorId: other.id, tokenId: "long" }] });
	await caster.setFlag("shadowdark-extras", FLAG, [cast]);
	canvas.tokens.push({ id: "short", actor: target }, { id: "long", actor: other });
	game.settings = { get: () => ({ damageCard: { autoApplyDamage: false } }) };
	let rolls = 0;
	globalThis.Roll = class { async evaluate() { rolls++; } total = 1; };
	const combat = { id: "target-clocks", round: 2, turn: 0,
		combatant: { actor: target, token: { id: "short" } } };
	await duration.handleDurationSpellCombatUpdate(combat, { turn: 0 }, {}, "gm");
	assert.equal(rolls, 0, "the expiring target must not borrow another target's timer");
	combat.turn = 1;
	combat.combatant = { actor: other, token: { id: "long" } };
	await duration.handleDurationSpellCombatUpdate(combat, { turn: 1 }, {}, "gm");
	assert.equal(rolls, 1, "the still-running target must retain its damage tick");
	short.effects[0].duration.expired = true;
	short.effects[0].isExpiryEvent = () => false;
	combat.turn = 2;
	combat.combatant = { actor: target, token: { id: "short" } };
	await duration.handleDurationSpellCombatUpdate(combat, { turn: 2 }, {}, "gm");
	assert.equal(rolls, 1, "a persisted expiry must suppress damage while unlinking awaits");
});

test("legacy add, remove and end select the newest cast without restarting its clock", async () => {
	const { caster, target } = setup();
	const old = entry("old", []), recent = entry("recent", []);
	for (const cast of [old, recent]) Object.assign(cast, {
		spellId: "spell", effects: ["Item.source"], expiryRound: 5,
	});
	await caster.setFlag("shadowdark-extras", FLAG, [old, recent]);
	game.combat = { id: "combat", started: true, round: 4, turn: 0, combatant: { id: "entrant" } };
	canvas.tokens.push({ id: "token", actor: target });
	globalThis.fromUuid = async () => ({ toObject: () => ({ effects: [{ duration: { rounds: 2 } }] }) });
	let data;
	target.createEmbeddedDocuments = async (_type, entries) => { data = entries[0]; return [{ id: "created" }]; };
	await duration.addTargetToDurationSpell(caster.id, "spell", "token");
	const casts = duration.getActiveDurationSpells(caster);
	assert.equal(casts[0].targets.length, 0);
	assert.equal(casts[1].targetEffects[0].effectItemId, "created");
	assert.equal(data.effects[0].start, null);
	assert.equal(await duration.removeTargetFromDurationSpell(caster.id, "spell", "token"), true);
	assert.equal(duration.getActiveDurationSpells(caster)[1].targets.length, 0);
	await duration.endDurationSpell(caster.id, "spell", "manual");
	assert.deepEqual(duration.getActiveDurationSpells(caster).map(cast => cast.instanceId), ["old"]);
});

test("late area entry retains the cast's round and turn rather than restarting", async () => {
	const { caster, target } = setup();
	game.combat = { id: "late-combat", started: true, round: 3, turn: 2,
		combatant: { id: "caster-turn", initiative: 10 } };
	const spell = { id: "area", name: "Area", system: { duration: { value: 2, type: "rounds" } } };
	const cast = await duration.startDurationSpell(caster, spell, [], {
		effects: [{ uuid: "Item.source", duration: { rounds: 5 } }],
	});
	game.combat.round = 4;
	game.combat.turn = 0;
	game.combat.combatant = { id: "other-turn", initiative: 20 };
	canvas.tokens.push({ id: "late-token", actor: target, name: "Late" });
	globalThis.fromUuid = async () => ({ toObject: () => ({ type: "Effect", effects: [{ duration: { rounds: 2 } }] }) });
	let created;
	target.createEmbeddedDocuments = async (_type, data) => { created = data[0]; return [{ id: "new-effect" }]; };
	await duration.addTargetToDurationSpell(caster.id, cast.instanceId, "late-token");
	assert.deepEqual(created.effects[0].start, { time: 100, combat: "late-combat", combatant: "caster-turn", initiative: 10, round: 3, turn: 2 });
	assert.equal(created.effects[0].duration.value, 5, "late targets retain the configured override");
});

test("an item's longer nested Active Effect survives its shorter sibling", async () => {
	const { caster, target } = setup();
	const item = effectItem(target, "multi");
	Object.assign(item.effects[0].duration, { units: "rounds", expiry: "turnStart" });
	Object.assign(item.effects[0].start, { combat: "nested", combatant: "caster-turn" });
	item.effects[0].isExpiryEvent = event => event === "turnStart";
	const longer = { ...item.effects[0], id: "longer", duration: { ...item.effects[0].duration, remaining: 2, expired: false } };
	item.effects.push(longer);
	const cast = entry("cast", [item]);
	Object.assign(cast, { perTurnDamage: "1", lastProcessedRound: 0,
		targets: [{ tokenId: "multi", actorId: target.id }] });
	await caster.setFlag("shadowdark-extras", FLAG, [cast]);
	assert.equal(await duration.handleDurationEffectUpdate(item.effects[0], expired), false);
	assert.equal(target.items.length, 1);
	canvas.tokens.push({ id: "multi", actor: target });
	game.settings = { get: () => ({ damageCard: { autoApplyDamage: false } }) };
	let rolls = 0;
	globalThis.Roll = class { async evaluate() { rolls++; } total = 1; };
	await duration.handleDurationSpellCombatUpdate({ id: "nested", round: 1, turn: 0,
		combatant: { actor: target, token: { id: "multi" } } }, { turn: 0 }, {}, "gm");
	assert.equal(rolls, 1, "the live sibling still drives duration damage");
	longer.duration.expired = true;
	assert.equal(await duration.handleDurationEffectUpdate(longer, expired), true);
	assert.equal(target.items.length, 0);
});

test("simultaneous core expirations leave a third cast and its effect intact", async () => {
	const { caster, target } = setup();
	const a = effectItem(target, "core-A"), b = effectItem(target, "core-B"), c = effectItem(target, "core-C", 12);
	await caster.setFlag("shadowdark-extras", FLAG, [entry("A", [a]), entry("B", [b]), entry("C", [c])]);
	await Promise.all([duration.handleDurationEffectUpdate(a.effects[0], expired), duration.handleDurationEffectUpdate(b.effects[0], expired)]);
	assert.deepEqual(duration.getActiveDurationSpells(caster).map(e => e.instanceId), ["C"]);
	assert.deepEqual(target.items.map(item => item.id), ["core-C"]);
});

test("failed core deletion preserves tracking and releases the retry guard", async () => {
	const { caster, target } = setup();
	const item = effectItem(target, "retry");
	await caster.setFlag("shadowdark-extras", FLAG, [entry("cast", [item])]);
	const remove = item.delete;
	item.delete = async () => { throw new Error("server refused"); };
	await assert.rejects(duration.handleDurationEffectUpdate(item.effects[0], expired), /server refused/);
	assert.equal(duration.getActiveDurationSpells(caster)[0].targetEffects.length, 1);
	item.delete = remove;
	assert.equal(await duration.handleDurationEffectUpdate(item.effects[0], expired), true);
	assert.equal(duration.getActiveDurationSpells(caster).length, 0);
});

test("summons linked to a core-timed cast survive the legacy round deadline", async () => {
	const { caster, target } = setup();
	const item = effectItem(target, "summon-clock", 6);
	const cast = entry("summon", [item]);
	cast.summonedTokenIds = ["summon-token"];
	await caster.setFlag("shadowdark-extras", FLAG, [cast]);
	const deleted = [];
	const scene = { id: "summon-regression", flags: {}, setFlag: async () => {}, unsetFlag: async () => {},
		deleteEmbeddedDocuments: async (_type, ids) => deleted.push(...ids) };
	canvas.scene = scene;
	canvas.tokens.push({ id: "summon-token" }, { id: "legacy-token" });
	game.scenes = collection([scene]);
	const { saveSummonedTokensExpiry } = await import("../../scripts/combat/damage-card.mjs");
	await saveSummonedTokensExpiry(scene.id, [
		{ tokenIds: ["summon-token"], expiryRound: 3, spellName: "Summon" },
		{ tokenIds: ["legacy-token"], expiryRound: 3, spellName: "Legacy" },
	]);
	const hooks = new Map();
	const originalOn = Hooks.on;
	Hooks.on = (event, fn) => hooks.set(event, fn);
	try {
		const { setupSummonExpiryHook } = await import("../../scripts/combat/combat-settings-app.mjs");
		setupSummonExpiryHook();
		await hooks.get("updateCombat")({ round: 3 }, { round: 3 });
		assert.deepEqual(deleted, ["legacy-token"]);
	}
	finally { Hooks.on = originalOn; }
});

test("per-turn persistence cannot resurrect a cast ended during its damage roll", async () => {
	const { caster, target } = setup();
	const cast = entry("cast", []);
	Object.assign(cast, { perTurnDamage: "1", lastProcessedRound: 1,
		targets: [{ actorId: target.id, tokenId: "token" }], expiryRound: 9 });
	await caster.setFlag("shadowdark-extras", FLAG, [cast]);
	canvas.tokens.push({ id: "token", actor: target });
	game.settings = { get: () => ({ damageCard: { autoApplyDamage: false } }) };
	const gate = Promise.withResolvers(), started = Promise.withResolvers();
	globalThis.Roll = class {
		async evaluate() { started.resolve(); await gate.promise; }
		total = 1;
	};
	const combat = { id: "damage-race", round: 2, turn: 0, combatant: { actor: target, token: { id: "token" } } };
	const processing = duration.handleDurationSpellCombatUpdate(combat, { round: 2 }, {}, "gm");
	await started.promise;
	await duration.endDurationSpell(caster.id, "cast", "manual");
	gate.resolve();
	await processing;
	assert.deepEqual(duration.getActiveDurationSpells(caster), []);
});

test("core summon cleanup clears both the scene flag and its cached expiry list", async () => {
	const { caster, target } = setup();
	const item = effectItem(target, "summon");
	const cast = { ...entry("summon", [item]), summonedTokenIds: ["summon-token"] };
	await caster.setFlag("shadowdark-extras", FLAG, [cast]);
	const flags = {};
	const scene = {
		id: "summon-cache", flags: { "shadowdark-extras": flags }, tokens: collection([{ id: "summon-token" }]),
		getFlag: (_scope, key) => flags[key],
		setFlag: async (_scope, key, value) => { flags[key] = structuredClone(value); },
		unsetFlag: async (_scope, key) => { delete flags[key]; },
		deleteEmbeddedDocuments: async () => { scene.tokens.length = 0; },
	};
	canvas.scene = scene;
	game.scenes = collection([scene]);
	const { getSummonedTokensExpiry, saveSummonedTokensExpiry, trackSummonedTokensForExpiry } =
		await import("../../scripts/combat/damage-card-actions.mjs");
	await saveSummonedTokensExpiry(scene.id, [{ tokenIds: ["summon-token"], expiryRound: 3 }]);
	assert.equal(await duration.handleDurationEffectUpdate(item.effects[0], expired), true);
	assert.equal(scene.tokens.length, 0);
	assert.deepEqual(getSummonedTokensExpiry(scene.id) ?? [], []);
	assert.deepEqual(flags.summonedTokensExpiry ?? [], []);
	await trackSummonedTokensForExpiry(scene.id, ["new-token"], 9, "New summon");
	assert.deepEqual(flags.summonedTokensExpiry.map(entry => entry.tokenIds), [["new-token"]]);
});

test("overlapping damage rolls merge completed targets without rolling the round back", async t => {
	for (const nextRound of [2, 3]) await t.test(`later turn in round ${nextRound}`, async () => {
		const { caster, target } = setup();
		const other = actor("other");
		game.actors.push(other);
		const cast = entry("cast", []);
		Object.assign(cast, { perTurnDamage: "1", lastProcessedRound: 1, expiryRound: 9,
			targets: [{ actorId: target.id, tokenId: "A" }, { actorId: other.id, tokenId: "B" }] });
		await caster.setFlag("shadowdark-extras", FLAG, [cast]);
		canvas.tokens.push({ id: "A", actor: target }, { id: "B", actor: other });
		game.settings = { get: () => ({ damageCard: { autoApplyDamage: false } }) };
		const gate = Promise.withResolvers(), started = Promise.withResolvers();
		let rolls = 0;
		globalThis.Roll = class {
			async evaluate() { if (++rolls === 1) { started.resolve(); await gate.promise; } }
			total = 1;
		};
		const combat = { id: `overlap-${nextRound}`, round: 2, turn: 0,
			combatant: { actor: target, token: { id: "A" } } };
		const first = duration.handleDurationSpellCombatUpdate(combat, { turn: 0 }, {}, "gm");
		await started.promise;
		combat.round = nextRound;
		combat.turn = 1;
		combat.combatant = { actor: other, token: { id: "B" } };
		await duration.handleDurationSpellCombatUpdate(combat, { turn: 1 }, {}, "gm");
		gate.resolve();
		await first;
		const [saved] = duration.getActiveDurationSpells(caster);
		assert.equal(saved.lastProcessedRound, nextRound);
		assert.deepEqual(saved.processedTargetsThisRound, nextRound === 2 ? { A: true, B: true } : { B: true });
	});
});

test("concurrent new casts do not overwrite each other's registry writes", async () => {
	const { caster } = setup();
	const spell = id => ({ id, name: id, system: { duration: { value: 2, type: "rounds" } } });
	await Promise.all([duration.startDurationSpell(caster, spell("A")), duration.startDurationSpell(caster, spell("B"))]);
	assert.deepEqual(duration.getActiveDurationSpells(caster).map(e => e.spellId).sort(), ["A", "B"]);
});

test("expiry unlinks only the expired item; the last item ends the cast once", async () => {
	const { caster, target, chat } = setup();
	const short = effectItem(target, "short"), long = effectItem(target, "long", 12);
	await caster.setFlag("shadowdark-extras", FLAG, [entry("cast", [short, long])]);
	await duration.handleDurationEffectUpdate(short.effects[0], expired);
	assert.deepEqual(target.items.map(item => item.id), ["long"]);
	assert.deepEqual(duration.getActiveDurationSpells(caster)[0].targetEffects.map(e => e.effectItemId), ["long"]);
	assert.equal(chat.length, 0, "whole-cast side effects wait for the last linked item");
	long.effects[0].duration.expired = true;
	await duration.handleDurationEffectUpdate(long.effects[0], expired);
	assert.equal(duration.getActiveDurationSpells(caster).length, 0);
	assert.equal(chat.length, 1);
});

test("concurrent cast cleanup preserves the unrelated active registry entry", async () => {
	const { caster, target } = setup();
	const a = effectItem(target, "A"), b = effectItem(target, "B"), c = effectItem(target, "C", 12);
	await caster.setFlag("shadowdark-extras", FLAG, [entry("A", [a]), entry("B", [b]), entry("C", [c])]);
	const gate = Promise.withResolvers();
	const started = Promise.withResolvers();
	const remove = b.delete;
	b.delete = async () => { started.resolve(); await gate.promise; await remove(); };
	const pendingB = duration.endDurationSpell(caster.id, "B");
	await started.promise;
	await duration.endDurationSpell(caster.id, "A");
	gate.resolve();
	await pendingB;
	assert.deepEqual(duration.getActiveDurationSpells(caster).map(e => e.instanceId), ["C"]);
	assert.deepEqual(target.items.map(item => item.id), ["C"]);
});
