import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { parse } from "acorn";

// Run the real initializers and handlers, replacing only their imported leaves.
// Foundry's dispatcher/replay itself is verified in the disposable client.
function fixture(kind) {
	const calls = [];
	const hooks = new Map();
	const originals = [];
	class Combat {
		async _onStartTurn(...args) { originals.push([this, "start", ...args]); }
		async _onEndTurn(...args) { originals.push([this, "end", ...args]); }
	}
	const tokens = ["X", "Y", "Z"].map(id => ({ id, name: id, actor: {} }));
	const combatants = tokens.map(token => ({ id: token.id, token }));
	const combat = Object.assign(new Combat(), {
		round: 2, turn: 2, combatant: combatants[2],
		previous: { round: 2, turn: 1, combatantId: "Y" },
		current: { round: 2, turn: 2, combatantId: "Z" },
		combatants: new Map(combatants.map(c => [c.id, c])),
	});
	const auras = tokens.map(token => ({
		token, effect: { id: `aura-${token.id}`, duration: {} },
		config: { includeSelf: true, triggers: { onSourceTurnStart: true, onSourceTurnEnd: true } },
	}));
	const templates = [{ id: "template", flags: { "shadowdark-extras": {
		templateEffects: { enabled: true, triggers: { onTurnStart: true, onTurnEnd: true } },
	} } }];
	const deleted = [];
	const game = { user: { isGM: true, isActiveGM: true }, settings: { get: () => false }, combat };
	const sandbox = {
		console: { log() {}, warn() {}, error(...args) { calls.push(["error", ...args]); } },
		CONFIG: { Combat: { documentClass: Combat } }, game,
		Hooks: { on(name, fn) { hooks.set(name, [...(hooks.get(name) ?? []), fn]); } },
		canvas: { ready: true, tokens: { placeables: tokens, get: id => tokens.find(t => t.id === id) },
			scene: { regions: templates, async deleteEmbeddedDocuments(type, ids) { deleted.push([type, ids]); } } },
		ChatMessage: { create() {} },
		MODULE_ID: "shadowdark-extras", _recentAuraTriggers: new Map(),
		isCanvasAvailable: () => sandbox.canvas.ready,
		getActiveAuras: () => auras,
		isTokenInAura: (source, target) => source.id === target.id,
		checkDisposition: () => true, checkAuraVisibility: () => true,
		applyAuraEffect: async (source, target, trigger) => { calls.push([source.id, target.id, trigger]); },
		getTemplatesContainingToken: () => templates,
		applyTemplateEffect: async (template, token, trigger) => { calls.push([token.id, trigger]); },
	};
	const path = `../../scripts/effects/${kind}EffectsSD.mjs`;
	let source = readFileSync(new URL(path, import.meta.url), "utf8");
	const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
	for (const node of ast.body.toReversed()) {
		if (node.type === "ImportDeclaration" || (node.type === "ExportNamedDeclaration" && !node.declaration)) {
			source = source.slice(0, node.start) + source.slice(node.end);
		} else if (node.type === "ExportNamedDeclaration") {
			source = source.slice(0, node.start) + source.slice(node.declaration.start);
		}
	}
	vm.runInNewContext(`${source}\ninit${kind}Effects();`, sandbox);
	return { calls, originals, game, combat, combatants, auras, templates, deleted, sandbox,
		async update(changes) { for (const fn of hooks.get("updateCombat")) await fn(combat, changes, {}, "gm"); },
		async event(phase, id, context = {}) {
			await combat[phase === "start" ? "_onStartTurn" : "_onEndTurn"](combat.combatants.get(id),
				{ round: combat.round, turn: combat.turn, skipped: false, ...context });
		},
	};
}

for (const kind of ["Aura", "Template"]) {
	const expected = (id, phase) => kind === "Aura" ? [id, id, `sourceTurn${phase}`] : [id, `turn${phase}`];
	test(`${kind}: held Chaos round fires only the replayed new top, then the old top's real turn`, async () => {
		const f = fixture(kind);
		Object.assign(f.combat, { round: 3, turn: 0, combatant: f.combatants[1],
			previous: { round: 2, turn: 2, combatantId: "Z" }, current: { round: 3, turn: 0, combatantId: "Y" } });
		await f.update({ round: 3, turn: 0 });
		assert.deepEqual(f.calls, [], "updateCombat must not act on the pre-reroll top");
		// Combatant reorder sends no updateCombat, and changes the mutable state.
		f.combat.previous = { round: 3, turn: 0, combatantId: "Y" };
		f.combat.current.combatantId = "X";
		f.combat.combatant = f.combatants[0];
		await f.event("end", "Z", { round: 2, turn: 2 });
		await f.event("start", "X");
		assert.deepEqual(f.calls, [expected("Z", "End"), expected("X", "Start")]);
		await f.update({ turn: 1 });
		await f.event("end", "X");
		await f.event("start", "Y", { turn: 1 });
		assert.deepEqual(f.calls, [expected("Z", "End"), expected("X", "Start"), expected("X", "End"), expected("Y", "Start")]);
	});

	test(`${kind}: normal turns preserve start/end and per-turn reset`, async () => {
		const f = fixture(kind);
		await f.update({ turn: 0 });
		await f.event("start", "X");
		await f.update({ turn: 1 });
		await f.event("end", "X");
		await f.event("start", "Y");
		assert.deepEqual(f.calls, [expected("X", "Start"), expected("X", "End"), expected("Y", "Start")]);
		await f.update({ round: 3 });
		await f.event("start", "X");
		assert.deepEqual(f.calls.at(-1), expected("X", "Start"));
		assert.equal(f.calls.length, 4);
	});

	test(`${kind}: skipped events and non-active GMs do not apply, but original wrappers still run`, async () => {
		const f = fixture(kind);
		await f.event("start", "X", { skipped: true });
		await f.event("end", "X", { skipped: true });
		f.game.user.isActiveGM = false;
		await f.event("start", "Y");
		await f.event("end", "Y");
		assert.deepEqual(f.calls, []);
		assert.equal(f.originals.length, 4);
		assert.equal(f.originals[0][0], f.combat);
		assert.equal(f.originals[0][2], f.combatants[0]);
		assert.equal(f.originals[0][3].skipped, true);
	});

	test(`${kind}: passed combatant survives an awaited upstream wrapper and mutable combat state`, async () => {
		const f = fixture(kind);
		const pending = f.event("end", "Z", { round: 2, turn: 2 });
		f.combat.previous.combatantId = "Y";
		f.combat.combatant = f.combatants[0];
		await pending;
		assert.deepEqual(f.calls, [expected("Z", "End")]);
	});

	test(`${kind}: tokenless combatants do not suppress the other turn event`, async () => {
		const f = fixture(kind);
		f.combatants[0].token = null;
		await f.event("end", "Z");
		await f.event("start", "X");
		assert.deepEqual(f.calls, [expected("Z", "End")]);
	});

	test(`${kind}: expiry deletion in flight cannot grant an extra turn hit`, async () => {
		const f = fixture(kind);
		f.combat.round = 3;
		let release;
		const pending = new Promise(resolve => { release = resolve; });
		if (kind === "Aura") {
			f.auras[0].effect.duration = { startRound: 1, rounds: 2 };
			f.auras[0].effect.delete = () => pending;
		} else {
			f.templates[0].flags["shadowdark-extras"].templateExpiry = { expiryRound: 2 };
			f.sandbox.canvas.scene.deleteEmbeddedDocuments = () => pending;
		}
		const maintenance = f.update({ round: 3 });
		try {
			await f.event("end", "X", { round: 2 });
			await f.event("start", "X");
			assert.deepEqual(f.calls, []);
		} finally { release(); await maintenance; }
	});

	test(`${kind}: an effect failure is reported without rejecting Foundry's event`, async () => {
		const f = fixture(kind);
		f.sandbox[kind === "Aura" ? "applyAuraEffect" : "applyTemplateEffect"] = async () => { throw Error("fixture failure"); };
		await assert.doesNotReject(f.event("start", "X"));
		assert.equal(f.calls[0][0], "error");
	});

	test(`${kind}: unavailable canvas does not apply turn effects`, async () => {
		const f = fixture(kind);
		f.sandbox.canvas.ready = false;
		await f.event("start", "X");
		await f.event("end", "X");
		assert.deepEqual(f.calls, []);
		assert.equal(f.originals.length, 2);
	});
}

for (const component of ["triggers", "damageTriggers", "effectsTriggers", "macroTriggers"]) {
	for (const role of ["Source", "Target"]) {
		test(`Aura: ${component} routes ${role.toLowerCase()} start and end independently`, async () => {
			const f = fixture("Aura");
			f.auras.splice(1);
			f.auras[0].config = { includeSelf: true, [component]: {
				[`on${role}TurnStart`]: true, [`on${role}TurnEnd`]: true,
			} };
			const id = role === "Source" ? "X" : "Y";
			f.sandbox.isTokenInAura = (source, target) => target.id === id;
			await f.event("start", id);
			await f.event("end", id);
			const prefix = role.toLowerCase();
			assert.deepEqual(f.calls, [["X", id, `${prefix}TurnStart`], ["X", id, `${prefix}TurnEnd`]]);
		});
	}
}

test("Aura: expiry stays on updateCombat", async () => {
	const f = fixture("Aura");
	let deletes = 0;
	f.auras[0].effect.duration = { startRound: 1, rounds: 1 };
	f.auras[0].effect.delete = async () => { deletes++; };
	await f.update({ round: 2 });
	assert.equal(deletes, 1);
	assert.deepEqual(f.calls, []);
});

test("Template: expiry stays round-only and inclusive of its final round", async () => {
	const f = fixture("Template");
	f.templates[0].flags["shadowdark-extras"].templateExpiry = { expiryRound: 2, spellName: "test" };
	await f.update({ round: 2 });
	assert.equal(f.deleted.length, 0);
	f.combat.round = 3;
	await f.update({ turn: 1 });
	assert.equal(f.deleted.length, 0);
	await f.update({ round: 3 });
	assert.equal(f.deleted.length, 1);
	assert.equal(f.deleted[0][0], "Region");
	assert.deepEqual(Array.from(f.deleted[0][1]), ["template"]);
	assert.deepEqual(f.calls, []);
});
