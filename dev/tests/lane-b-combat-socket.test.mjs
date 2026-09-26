import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { escapeHTML } from "./helpers/escape-html.mjs";

// Lane-B combat split test (Phase 5.3, work items 7/8 — combat-socket boundary).
// Socket authority: setupCombatSocket owns the single socketlib module
// registration; getSocket returns the registered instance. Duplicate-registration
// prevention: a second setupCombatSocket call must not call registerModule again
// (socketlib throws on re-registration) and must return the SAME instance.
//
// The module's import graph reaches FocusSpellTrackerSD -> CombatSettingsSD ->
// damage-card-pipeline.mjs, which reads window._sdx_calculatingMessages at load,
// and the effects tree, which destructures foundry.applications.api at module
// load (issue #52 harness pattern). All are stubbed below.
//
// socketlibSocket is module-scoped and not resettable, so the lifecycle is one
// ordered test: missing-socketlib first (fresh state), then registration and
// the duplicate guard on the SAME module instance. No computed dynamic imports
// (the structural gate asserts zero in dev/tests).
globalThis.window = globalThis;
globalThis.foundry = {
	applications: {
		api: {
			ApplicationV2: class {},
			HandlebarsApplicationMixin: (base) => base,
		},
	},
	utils: {
		randomID: () => "id",
		Collection: class extends Map {},
		deepClone: (value) => JSON.parse(JSON.stringify(value)),
		escapeHTML,
	},
};
globalThis.CONST = { TEXT_ANCHOR_POINTS: { TOP: 0, BOTTOM: 1 } };
globalThis.canvas = {
	tokens: { get: () => null, placeables: [] },
	interface: { createScrollingText: () => {} },
};
globalThis.game = {
	settings: { get: () => undefined, register: () => {} },
	i18n: { localize: (key) => key },
	user: { isGM: true },
	messages: { get: () => null },
};
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
globalThis.Actor = class {};
globalThis.CONFIG = { time: { roundTime: 0, turnTime: 0 } };

const { getSocket, setupCombatSocket } = await import("../../scripts/shared/combat-socket.mjs");
const { applySpellEffect } = await import("../../scripts/effects/BreakOnDamageSD.mjs");
let socketHarness;

/** socketlib fake that records registerModule calls and registered handlers. */
function makeSocketlib() {
	const registrations = new Map();
	const socket = {
		register(name, handler) {
			registrations.set(name, handler);
		},
		executeAsGM: (name, data) => registrations.get(name)(data),
	};
	const calls = [];
	const registerModule = (id) => {
		calls.push(id);
		return socket;
	};
	return { registerModule, socket, calls, registrations };
}

test("socket lifecycle: missing socketlib, single registration, duplicate guard", async (t) => {
	// 1. Missing socketlib: error, no registration, getSocket stays null.
	const errors = [];
	const originalError = console.error;
	console.error = (...args) => errors.push(args.join(" "));
	delete globalThis.socketlib;
	const missingResult = setupCombatSocket();
	console.error = originalError;

	assert.equal(missingResult, undefined);
	assert.equal(getSocket(), null);
	assert.ok(errors.some((line) => line.includes("socketlib not found")));

	// 2. Present socketlib: one registerModule call, getSocket returns it.
	const fake = makeSocketlib();
	socketHarness = fake;
	globalThis.socketlib = fake;

	const first = setupCombatSocket();
	assert.equal(fake.calls.length, 1);
	assert.equal(fake.calls[0], "shadowdark-extras");
	assert.equal(first, fake.socket);
	assert.equal(getSocket(), fake.socket);

	// 3. Duplicate guard: no re-registration, same socket instance back.
	const second = setupCombatSocket();
	const third = setupCombatSocket();

	assert.equal(fake.calls.length, 1, "registerModule must be called exactly once");
	assert.equal(second, first);
	assert.equal(third, first);
	assert.equal(getSocket(), first);
});

test("applyTokenCondition writes Foundry v14 duration and start data", async () => {
	let created;
	const actor = {
		id: "target-actor",
		items: { filter: () => [] },
		createEmbeddedDocuments: async (_type, entries) => {
			[created] = entries;
			return [{ id: "created-effect" }];
		},
	};
	globalThis.canvas.tokens.get = id => id === "target-token" ? { actor } : null;
	globalThis.game.combat = {
		id: "combat-1",
		started: true,
		round: 3,
		turn: 1,
		combatant: { id: "combatant-1", initiative: 14 },
	};
	globalThis.game.time = { worldTime: 100 };
	globalThis.fromUuid = async () => ({
		name: "Slowed",
		toObject: () => ({
			name: "Slowed",
			type: "Effect",
			system: { duration: {} },
			effects: [{ duration: { rounds: null, seconds: null } }],
		}),
	});

	const handler = socketHarness.registrations.get("applyTokenCondition");
	assert.ok(handler, "applyTokenCondition must be registered");
	assert.equal(await handler({
		tokenId: "target-token",
		effectUuid: "Compendium.test.effect",
		duration: { rounds: 2, seconds: null, startTime: 90 },
	}), true);
	assert.deepEqual(created.effects[0], {
		duration: { value: 2, units: "rounds", expiry: "turnStart" },
		start: {
			time: 90,
			combat: "combat-1",
			combatant: "combatant-1",
			initiative: 14,
			round: 3,
			turn: 1,
		},
	});
	assert.deepEqual(created.system.duration, { value: "2", type: "rounds" });
});

test("applyTokenCondition puts a bare ActiveEffect on the actor, flags intact (#148)", async () => {
	const calls = [];
	const actor = {
		id: "target-actor",
		items: { filter: () => [] },
		effects: [{ id: "old", name: "STR damage" }, { id: "other", name: "Blessed" }],
		createEmbeddedDocuments: async (type, entries) => (calls.push(["create", type, entries]), [{ id: "new" }]),
		deleteEmbeddedDocuments: async (type, ids) => (calls.push(["delete", type, ids]), []),
	};
	globalThis.canvas.tokens.get = id => id === "target-token" ? { actor } : null;
	globalThis.game.combat = null;
	const flags = { "shadowdark-enhancer": { statDamage: { ability: "str" } } };
	globalThis.fromUuid = async () => ({
		documentName: "ActiveEffect",
		name: "STR damage",
		toObject: () => ({ name: "STR damage", duration: { value: null, units: "seconds" }, flags: structuredClone(flags) }),
	});
	const handler = socketHarness.registrations.get("applyTokenCondition");

	assert.equal(await handler({ tokenId: "target-token", effectUuid: "Compendium.x.ActiveEffect.y" }), true);
	assert.equal(calls.length, 1, "cumulative by default: two hits make two effects");
	const [op, type, [created]] = calls[0];
	assert.equal(op, "create");
	assert.equal(type, "ActiveEffect", "not wrapped in an Effect item");
	assert.deepEqual(created.flags, flags);
	assert.equal(created.start, undefined, "no duration: lasts until healed");

	calls.length = 0;
	await handler({ tokenId: "target-token", effectUuid: "Compendium.x.ActiveEffect.y", cumulative: false });
	assert.deepEqual(calls.map(c => c.slice(0, 2)), [["delete", "ActiveEffect"], ["create", "ActiveEffect"]]);
	assert.deepEqual(calls[0][2], ["old"], "non-cumulative replaces only the same-named effect");
});

test("applySpellEffect gives owners and non-owners identical canonical timing", async () => {
	let created;
	const actor = Object.assign(new Actor(), {
		id: "target-actor",
		createEmbeddedDocuments: async (_type, entries) => {
			[created] = entries;
			return [{ id: "created-effect" }];
		},
	});
	globalThis.game.actors = { get: id => id === actor.id ? actor : null };
	globalThis.game.time = { worldTime: 100 };
	const source = { type: "Effect", effects: [{ duration: { rounds: 2 } }] };
	globalThis.fromUuid = async () => ({ toObject: () => structuredClone(source) });
	for (const combat of [null, { round: 0, started: false }, {
		id: "combat-1", round: 3, turn: 1, started: true,
		combatant: { id: "combatant-1", initiative: 14 },
	}]) {
		globalThis.game.combat = combat;
		actor.isOwner = false;
		assert.equal(await applySpellEffect(actor, "Compendium.test.effect"), "created-effect");
		const socketData = structuredClone(created);
		actor.isOwner = true;
		assert.equal(await applySpellEffect(actor, "Compendium.test.effect"), "created-effect");
		assert.deepEqual(created, socketData);
		assert.deepEqual(created.effects[0].duration, combat?.started
			? { value: 2, units: "rounds", expiry: "turnStart" }
			: { value: 12, units: "seconds", expiry: null });
		assert.equal(created.effects[0].start.time, 100);
	}
	assert.deepEqual(source.effects[0], { duration: { rounds: 2 } });
});

test("applyEffectToTarget resolves the cast instance first, then the newest spell id", async () => {
	let created;
	const target = {
		createEmbeddedDocuments: async (_type, entries) => {
			[created] = entries;
			return [{ id: "created-effect" }];
		},
	};
	const oldTiming = {
		duration: { value: 5, units: "rounds", expiry: "turnStart" },
		start: { time: 100, combat: "cast-combat", combatant: "caster-turn", initiative: 18, round: 2, turn: 1 },
	};
	const newTiming = {
		duration: { value: 30, units: "seconds", expiry: null }, start: { time: 130 },
	};
	const casts = [
		{ instanceId: "old-cast", spellId: "spell", effectTiming: oldTiming },
		{ instanceId: "new-cast", spellId: "spell", effectTiming: newTiming },
		{ instanceId: "collision", spellId: "old-cast", effectTiming: newTiming },
	];
	const savedCasts = structuredClone(casts);
	globalThis.game.actors = { get: id => id === "caster" ? {
		getFlag: (module, key) => {
			assert.equal(module, "shadowdark-extras");
			assert.equal(key, "activeDurationSpells");
			return casts;
		},
	} : null };
	globalThis.canvas.tokens.get = id => id === "synthetic-token" ? { actor: target } : null;
	globalThis.game.combat = {
		id: "later-combat", started: true, round: 9, turn: 4,
		combatant: { id: "entrant-turn", initiative: 2 },
	};
	globalThis.game.time = { worldTime: 200 };
	globalThis.fromUuid = async () => ({ toObject: () => ({
		type: "Effect", effects: [{ duration: { rounds: 2 } }, {}],
	}) });
	const handler = socketHarness.registrations.get("applyEffectToTarget");
	for (const [spellId, timing] of [["old-cast", oldTiming], ["new-cast", newTiming], ["spell", newTiming]]) {
		assert.deepEqual(await handler({
			targetTokenId: "synthetic-token", effectUuid: "Compendium.test.effect",
			casterId: "caster", spellId, templateId: "area-template",
			castTiming: { start: { time: 999 } }, // Caller timing must not be trusted.
		}), { success: true, effectId: "created-effect" });
		assert.deepEqual(created.effects[0].start, timing.start);
		assert.deepEqual(created.effects[0].duration, timing === oldTiming
			? { value: 2, units: "rounds", expiry: "turnStart" }
			: { value: 12, units: "seconds", expiry: null });
		assert.deepEqual(created.effects[1], timing);
		assert.equal(created.flags["shadowdark-extras"].templateOrigin, "area-template");
	}
	assert.deepEqual(casts, savedCasts);
});

test("legacy casts reuse a linked Active Effect start when no cast snapshot exists", async () => {
	let created;
	const linkedEffect = {
		duration: { value: 30, units: "seconds", expiry: null, remaining: 12 },
		start: { time: 100 },
	};
	const target = {
		items: { get: id => id === "existing-effect" ? { effects: [linkedEffect] } : null },
		createEmbeddedDocuments: async (_type, entries) => {
			[created] = entries;
			return [{ id: "created-effect" }];
		},
	};
	const legacyCast = {
		instanceId: "legacy-cast", spellId: "spell", durationValue: 5, durationType: "rounds",
		targetEffects: [{ targetTokenId: "existing-token", effectItemId: "existing-effect" }],
	};
	globalThis.game.actors = { get: id => id === "caster" ? { getFlag: () => [legacyCast] } : target };
	globalThis.canvas.tokens.get = id => id === "existing-token" ? { actor: target } : null;
	globalThis.game.combat = { id: "later-combat", started: true, round: 5, turn: 1 };
	globalThis.game.time = { worldTime: 118 };
	globalThis.fromUuid = async () => ({ toObject: () => ({ effects: [{ duration: { rounds: 2 } }, {}] }) });
	assert.deepEqual(await socketHarness.registrations.get("applyEffectToTarget")({
		targetActorId: "target", casterId: "caster", spellId: "legacy-cast", effectUuid: "Compendium.test.effect",
	}), { success: true, effectId: "created-effect" });
	assert.deepEqual(created.effects, [
		{ duration: { value: 12, units: "seconds", expiry: null }, start: { time: 100 } },
		{ duration: { value: 30, units: "seconds", expiry: null }, start: { time: 100 } },
	]);
});

test("legacy casts without a recorded start leave expiry to the registry", async () => {
	let created;
	const legacyCast = { instanceId: "legacy-cast", spellId: "spell", expiryRound: 6, targetEffects: [] };
	globalThis.game.actors = { get: id => id === "caster" ? { getFlag: () => [legacyCast] } : {
		createEmbeddedDocuments: async (_type, entries) => {
			[created] = entries;
			return [{ id: "created-effect" }];
		},
	} };
	globalThis.game.combat = { id: "combat", started: true, round: 5, turn: 1, combatant: { id: "entrant" } };
	globalThis.game.time = { worldTime: 118 };
	globalThis.fromUuid = async () => ({ toObject: () => ({ effects: [
		{ duration: { rounds: 2 }, start: { time: 999 } }, {},
	] }) });
	assert.deepEqual(await socketHarness.registrations.get("applyEffectToTarget")({
		targetActorId: "target", casterId: "caster", spellId: "legacy-cast", effectUuid: "Compendium.test.effect",
	}), { success: true, effectId: "created-effect" });
	assert.deepEqual(created.effects.map(effect => effect.start), [null, null], "do not fabricate a fresh core clock");
	assert.equal(legacyCast.expiryRound, 6);
});

test("damage-card and area-entry effects retain the same cast anchor and duration override", async () => {
	const timing = { duration: { value: 2, units: "rounds", expiry: "turnStart" },
		start: { time: 100, combat: "combat", combatant: "caster-turn", round: 3, turn: 1 } };
	let casts = [{ instanceId: "cast", spellId: "spell", effectTiming: timing, targets: [], targetEffects: [] }];
	const caster = { id: "caster", getFlag: () => casts,
		setFlag: async (_scope, _key, entries) => { casts = entries; } };
	const created = [];
	const target = { id: "target", items: { filter: () => [] },
		createEmbeddedDocuments: async (_type, entries) => {
			created.push(entries[0]); return [{ id: `effect-${created.length}` }];
		} };
	game.actors = { get: id => id === "caster" ? caster : target };
	game.combat = { id: "combat", started: true, round: 4, turn: 0, combatant: { id: "other-turn" } };
	canvas.tokens.get = () => ({ actor: target });
	globalThis.fromUuid = async () => ({ toObject: () => ({ effects: [{ duration: { rounds: 2 } }] }) });
	assert.equal(await socketHarness.registrations.get("applyTokenCondition")({
		tokenId: "token", effectUuid: "Item.source", duration: { rounds: 5 },
		spellInfo: { casterActorId: "caster", spellId: "spell" },
	}), true);
	assert.equal(await socketHarness.registrations.get("applyEffectToTarget")({
		targetTokenId: "token", effectUuid: "Item.source", duration: { rounds: 5 },
		casterId: "caster", spellId: "cast",
	}).then(result => result.success), true);
	for (const data of created) {
		assert.deepEqual(data.effects[0].start, timing.start);
		assert.equal(data.effects[0].duration.value, 5);
	}
	assert.equal(casts[0].targetEffects[0].effectItemId, "effect-1");
});

test("player and secondary-GM duration mutations reach only the authoritative GM queue", async () => {
	const duration = await import("../../scripts/effects/duration-spell.mjs");
	const gm = { id: "gm", isGM: true }, player = { id: "player", isGM: false };
	const otherGM = { id: "other-gm", isGM: true }, stranger = { id: "stranger", isGM: false };
	const requests = [];
	const spell = { id: "spell", name: "Spell", system: { duration: { value: 2, type: "rounds" } } };
	const caster = { id: "caster", uuid: "Actor.caster", name: "Caster", documentName: "Actor",
		getFlag: () => [{ instanceId: "old", spellId: "spell", targets: [], targetEffects: [] }],
		setFlag: () => { throw new Error("a non-authoritative client wrote the registry"); },
		items: { get: () => spell, filter: () => [] },
		testUserPermission: user => user.id === player.id };
	game.users = { activeGM: gm, get: id => [gm, player, otherGM, stranger].find(user => user.id === id) };
	game.actors = { get: () => caster, contents: [] };
	game.combat = null;
	game.time = { worldTime: 123 };
	socketHarness.socket.executeAsUser = async (name, userId, data) => { requests.push({ name, userId, data }); return true; };
	globalThis.Hooks = { callAll() {} };
	globalThis.ChatMessage = { create: async () => {}, getSpeaker: () => ({}) };
	for (const user of [player, otherGM]) {
		game.user = user;
		await duration.startDurationSpell(caster, spell);
		await duration.endDurationSpell(caster.id, "old", "manual");
		await duration.linkEffectToDurationSpell(caster, "old", "target", "token", "effect");
		await duration.addTargetToDurationSpell(caster.id, "old", "token");
		await duration.removeTargetFromDurationSpell(caster.id, "old", "token");
	}
	assert.equal(requests.length, 10);
	assert.ok(requests.every(request => request.name === "durationSpellOperation" && request.userId === gm.id));
	assert.deepEqual(requests.slice(0, 5).map(request => request.data.operation), ["append", "end", "link", "addTarget", "removeTarget"]);

	// The player's stale view still contains "old"; the receiver only appends the
	// new cast while its own expiry operation removes "old" through the SAME queue.
	game.user = gm;
	globalThis.fromUuid = async uuid => uuid === caster.uuid ? caster : null;
	let saved = caster.getFlag();
	caster.getFlag = () => saved;
	caster.setFlag = async (_scope, _key, entries) => {
		await Promise.resolve(); saved = structuredClone(entries);
	};
	const handler = socketHarness.registrations.get("durationSpellOperation");
	assert.equal(typeof handler, "function");
	const payload = requests[0].data;
	await Promise.all([
		handler.call({ socketdata: { userId: player.id } }, payload),
		duration.endDurationSpell(caster.id, "old", "expired"),
	]);
	assert.equal(saved.length, 1);
	assert.equal(saved[0].instanceId, payload.entry.instanceId);
	assert.equal(saved[0].effectTiming.start.time, 123);
	await assert.rejects(handler.call({ socketdata: { userId: stranger.id } }, payload), /authorized/i);
	await assert.rejects(handler.call({}, payload), /authorized/i);
	await assert.rejects(handler.call({ socketdata: { userId: player.id } }, { ...payload, operation: "invalid" }), /operation/i);
	game.user = otherGM;
	await assert.rejects(handler.call({ socketdata: { userId: player.id } }, payload), /active GM/i);
	game.user = player;
	game.users.activeGM = null;
	await assert.rejects(duration.startDurationSpell(caster, spell), /active GM/i);
	game.user = gm;
	game.users.activeGM = gm;
});

test("duration relay resolves off-canvas targets and cleans the originating scene", async () => {
	game.i18n.format = key => key;
	const duration = await import("../../scripts/effects/duration-spell.mjs");
	let casts = [];
	const gm = { id: "gm", isGM: true }, sender = { id: "other-gm", isGM: true };
	const caster = { id: "caster", uuid: "Actor.caster", name: "Caster", documentName: "Actor",
		getFlag: () => casts, setFlag: async (_scope, _key, entries) => { casts = structuredClone(entries); },
		items: { filter: () => [] } };
	const items = new Map();
	const target = { id: "npc", isToken: true, token: { id: "targetA" }, name: "Target A", items,
		createEmbeddedDocuments: async (_type, data) => {
			const item = { ...data[0], id: "effectA", delete: async () => { items.delete("effectA"); } };
			items.set(item.id, item); return [item];
		} };
	const sceneA = { id: "sceneA", regions: new Map([["regionA", { id: "regionA" }]]),
		tokens: new Map([["targetA", { id: "targetA", actor: target, name: "Target A" }], ["summonA", { id: "summonA" }]]),
		deleteEmbeddedDocuments: async (type, ids) => { for (const id of ids) (type === "Region" ? sceneA.regions : sceneA.tokens).delete(id); } };
	const sceneB = { id: "sceneB", tokens: new Map(), regions: new Map() };
	game.user = sender;
	game.users = { activeGM: gm, get: id => id === sender.id ? sender : gm };
	game.actors = Object.assign([caster], { contents: [caster], get: id => id === caster.id ? caster : null });
	game.scenes = new Map([[sceneA.id, sceneA], [sceneB.id, sceneB]]);
	canvas.scene = sceneA;
	canvas.tokens.get = id => sceneA.tokens.get(id);
	let append;
	socketHarness.socket.executeAsUser = async (_name, _user, data) => { append = data; return true; };
	await duration.startDurationSpell(caster, { id: "spell", name: "Spell", system: { duration: { value: 2, type: "rounds" } } }, [], {
		templateId: "regionA", summonedTokenIds: ["summonA"], effects: ["Item.source"],
	});
	assert.equal(append.entry.sceneId, sceneA.id);
	game.user = gm;
	canvas.scene = sceneB;
	canvas.tokens.get = () => null;
	globalThis.fromUuid = async uuid => uuid === caster.uuid ? caster : {
		toObject: () => ({ type: "Effect", effects: [{ duration: { rounds: 2 } }] }),
	};
	const handler = socketHarness.registrations.get("durationSpellOperation");
	const call = data => handler.call({ socketdata: { userId: sender.id } }, { casterUuid: caster.uuid, ...data });
	await call(append);
	const instanceId = casts[0].instanceId;
	assert.equal(await call({ operation: "addTarget", instanceId, tokenId: "targetA" }), true);
	assert.equal(items.size, 1, "the synthetic actor outside the GM canvas receives the effect");
	assert.equal(await call({ operation: "removeTarget", instanceId, tokenId: "targetA" }), true);
	assert.equal(items.size, 0);
	assert.equal(await call({ operation: "addTarget", instanceId, tokenId: "targetA" }), true);
	await call({ operation: "end", instanceId, reason: "manual" });
	assert.equal(casts.length, 0);
	assert.equal(items.size, 0);
	assert.equal(sceneA.regions.size, 0);
	assert.equal(sceneA.tokens.has("summonA"), false);
	assert.equal(canvas.scene, sceneB, "the GM does not switch scenes");

	// Older stored casts have no scene field; preserve the requesting client's
	// scene on the relay instead of treating the elected GM's canvas as origin.
	const legacy = { ...append.entry, instanceId: "legacy", targets: [], targetEffects: [] };
	delete legacy.sceneId;
	casts = [legacy];
	sceneA.regions.set("regionA", { id: "regionA" });
	assert.equal(await call({ operation: "addTarget", instanceId: "legacy", tokenId: "targetA", sceneId: sceneA.id }), true);
	await call({ operation: "end", instanceId: "legacy", sceneId: sceneA.id });
	assert.equal(items.size, 0);
	assert.equal(sceneA.regions.size, 0);
});

test("message names and authority rules are preserved on the shared boundary", () => {
	// The shared boundary must keep the exact registration surface callers rely
	// on: applyTokenDamage (damage apply), setTargetDefenseResult (defense
	// checks), showScrollingText, applyTokenCondition, and the trade window
	// handlers used by the inventory lane.
	const source = readFileSync(new URL("../../scripts/shared/combat-socket.mjs", import.meta.url), "utf8");
	for (const name of [
		"setTargetDefenseResult",
		"applyTokenDamage",
		"showScrollingText",
		"applyTokenCondition",
		"removeTargetEffect",
		"applyEffectToTarget",
		"endFocusSpell",
		"transferItemsAsGM",
		"transferCoinsAsGM",
	]) {
		assert.ok(source.includes(`.register("${name}"`), `missing message handler ${name}`);
	}
	// authority: the damage-card caller keeps the executeAsGM contract while the
	// boundary owns registration and the GM-side handlers.
	const damageCard = readFileSync(new URL("../../scripts/combat/damage-card.mjs", import.meta.url), "utf8");
	assert.match(damageCard, /getSocket\(\)\.executeAsGM\(/);
});

test("no direct socketlib module registration remains outside the shared boundary", async () => {
	// Scope: scripts/combat/** must route through combat-socket.mjs. Direct
	// registerModule calls anywhere else would bypass the duplicate guard.
	const { execFileSync } = await import("node:child_process");
	const listed = execFileSync("git", ["ls-files", "scripts/combat", "scripts/shared/combat-socket.mjs"], {
		encoding: "utf8",
	})
		.trim()
		.split("\n")
		.filter((file) => file.endsWith(".mjs") && file !== "scripts/shared/combat-socket.mjs");
	const offenders = listed.filter((file) => {
		const content = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
		return content.includes("socketlib.registerModule");
	});
	assert.deepEqual(offenders, [], "combat files must not call socketlib.registerModule directly");
});
