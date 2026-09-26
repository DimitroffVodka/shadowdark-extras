import assert from "node:assert/strict";
import test from "node:test";

import {
	calculateGrinderHp,
	grinderHpFormula,
	healStatDamage,
	pickRegainedSpells,
} from "../../scripts/party/CampingRestData.mjs";

// Grinder Mode in the camping rest (#149, core rulebook p.111).

test("Grinder HP rolls N class hit dice, each with advantage when Stout", () => {
	assert.equal(grinderHpFormula("d8", 1, false), "1d8");
	assert.equal(grinderHpFormula("d8", 2, false), "2d8");
	assert.equal(grinderHpFormula("d10", 2, true), "2d10kh + 2d10kh");
	assert.equal(grinderHpFormula("1d6", 1, true), "2d6kh");
	assert.equal(grinderHpFormula("d4", 9), "4d4", "the setting offers 1 to 4");
	assert.equal(grinderHpFormula("d4", "0"), "1d4");
	assert.equal(grinderHpFormula(undefined, 2), null, "no class, no die");
});

test("Grinder HP adds the roll to current HP, capped at maximum", () => {
	assert.equal(calculateGrinderHp(5, 20, 6), 11);
	assert.equal(calculateGrinderHp(5, 20, 30), 20);
	assert.equal(calculateGrinderHp(22, 20, 4), 22, "HP already above maximum is kept");
});

test("Grinder regains at most the 1d4 roll of lost spells, as picked", () => {
	const lost = ["a", "b", "c", "d"].map(id => ({ id }));
	assert.deepEqual(pickRegainedSpells(lost, 2, { a: true, b: false, c: true, d: true }).map(s => s.id), ["a", "c"]);
	assert.deepEqual(pickRegainedSpells(lost, 4, null), lost, "nothing to choose when the roll covers them all");
	assert.deepEqual(pickRegainedSpells(lost, 1, null), [], "no answer regains none");
});

test("a rest heals stat damage through Enhancer: all normally, 1 per ability on Grinder", async () => {
	const actor = { id: "pc" };
	const calls = [];
	globalThis.game = { shadowdarkEnhancer: { statDamage: { heal: async (...args) => { calls.push(args); } } } };
	try {
		await healStatDamage(actor, false);
		await healStatDamage(actor, true);
		assert.deepEqual(calls, [[actor], [actor, { perAbility: 1 }]]);

		globalThis.game = { shadowdarkEnhancer: { statDamage: { heal: async () => { throw new Error("no"); } } } };
		const warn = console.warn;
		console.warn = () => {};
		try {
			await healStatDamage(actor, true); // a failing Enhancer must not stop the rest
		}
		finally {
			console.warn = warn;
		}

		globalThis.game = {};
		await healStatDamage(actor, false); // without Enhancer: skipped silently
	}
	finally {
		delete globalThis.game;
	}
});
