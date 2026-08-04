import assert from "node:assert/strict";
import test from "node:test";

// Lane-B combat split test (Phase 5.3, work items 3/5 — WeaponBonusConfig.mjs).
// calculateWeaponBonusDamage branch coverage + formula preservation.
//
// The module's import graph reaches CreatureTypesApp.mjs, which destructures
// foundry.applications.api at module load (issue #52 harness pattern), and the
// calculator constructs `new Roll(...)` per bonus part. Both are stubbed below;
// the calculator's DOM/jquery surface stays in weapon-bonus-ui.mjs and is not
// exercised here.
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
		mergeObject: (base, overrides) => ({ ...base, ...overrides }),
	},
};
globalThis.game = {
	settings: { get: () => undefined, register: () => {} },
	i18n: { localize: (key) => key },
	user: { isGM: true },
	dice3d: null,
};
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

// Deterministic Roll stub: "2" -> 2, "1d4" -> 4, "3d6" -> 18, "1 + 3" -> 4.
class StubRoll {
	constructor(formula) {
		this.formula = String(formula);
		this.terms = [];
		this.options = {};
		this.total = this._resolveTotal(this.formula);
	}
	_resolveTotal(formula) {
		const plain = /^\d+$/.exec(formula);
		if (plain) return parseInt(plain[0], 10);
		const dice = /^(\d+)d(\d+)$/i.exec(formula);
		if (dice) return parseInt(dice[1], 10) * parseInt(dice[2], 10);
		// Simple static arithmetic (e.g. "1 + 3") used by formula preservation.
		try {
			// eslint-disable-next-line no-new-func -- deterministic test evaluator
			const value = new Function(`return (${formula})`)();
			return typeof value === "number" && Number.isFinite(value) ? value : 1;
		}
		catch {
			return 1;
		}
	}
	async evaluate() {
		return this;
	}
}
globalThis.Roll = StubRoll;

const { calculateWeaponBonusDamage } = await import("../../scripts/combat/WeaponBonusConfig.mjs");

const MODULE_ID = "shadowdark-extras";

/** Build a weapon with the given weaponBonus flags. */
function makeWeapon({ enabled = true, damageBonus = "", damageBonuses = [], requirements = [], criticalExtraDice = 0, criticalExtraDamage = "", criticalDiceRequirements = [], criticalDamageRequirements = [] } = {}) {
	const weapon = {
		id: "weapon-1",
		type: "Weapon",
		system: { damage: { oneHanded: "d6", twoHanded: "d8" } },
		flags: {
			[MODULE_ID]: {
				weaponBonus: {
					enabled,
					damageBonus,
					damageBonuses,
					requirements,
					criticalExtraDice,
					criticalExtraDamage,
					criticalDiceRequirements,
					criticalDamageRequirements,
				},
			},
		},
	};
	return weapon;
}

function makeAttacker({ mod = 2, level = 3 } = {}) {
	return {
		id: "attacker-1",
		type: "Player",
		getRollData() {
			return { abilities: { str: { mod } }, level: { value: level } };
		},
		system: {
			level: { value: level },
			abilities: { str: { mod } },
		},
	};
}

function makeTarget({ name = "Goblin", level = 1 } = {}) {
	return {
		id: "target-1",
		type: "NPC",
		name,
		effects: { contents: [] },
		items: [],
		getRollData() {
			return {
				level: { value: level },
				abilities: { str: { mod: 0 } },
				attributes: { ac: { value: 12 }, hp: { value: 8 } },
			};
		},
		system: { details: { ancestry: "" } },
	};
}

test("disabled weapon bonus returns a zeroed result with requirementsMet true", async () => {
	const result = await calculateWeaponBonusDamage(makeWeapon({ enabled: false }), makeAttacker(), makeTarget());
	assert.deepEqual(result, {
		totalBonus: 0,
		bonusFormula: "",
		criticalExtraDice: 0,
		criticalBonus: 0,
		criticalFormula: "",
		requirementsMet: true,
	});
});

test("no flags at all also returns the zeroed result", async () => {
	const weapon = { id: "weapon-x", type: "Weapon", flags: {} };
	const result = await calculateWeaponBonusDamage(weapon, makeAttacker(), makeTarget());
	assert.equal(result.totalBonus, 0);
	assert.equal(result.bonusFormula, "");
	assert.equal(result.requirementsMet, true);
});

test("legacy single damageBonus is applied when legacy requirements pass", async () => {
	const weapon = makeWeapon({
		damageBonus: "1d4",
		requirements: [],
	});
	const result = await calculateWeaponBonusDamage(weapon, makeAttacker(), makeTarget());
	assert.equal(result.bonusFormula, "1d4");
	assert.equal(result.totalBonus, 4);
	assert.equal(result.bonusParts.length, 1);
	assert.equal(result.bonusParts[0].label, "");
});

test("legacy single damageBonus is skipped when legacy requirements fail", async () => {
	const weapon = makeWeapon({
		damageBonus: "1d4",
		requirements: [{ type: "targetName", operator: "equals", value: "Dragon" }],
	});
	const result = await calculateWeaponBonusDamage(weapon, makeAttacker(), makeTarget());
	assert.equal(result.bonusFormula, "");
	assert.equal(result.totalBonus, 0);
});

test("multiple damage bonuses join into the preserved formula string", async () => {
	const weapon = makeWeapon({
		damageBonuses: [
			{ formula: "1d4", label: "Frost", damageType: "cold" },
			{ formula: "2", label: "Flat" },
		],
	});
	const result = await calculateWeaponBonusDamage(weapon, makeAttacker(), makeTarget());
	// Formula preservation: exact joined source order, no re-rolling of parts.
	assert.equal(result.bonusFormula, "1d4 + 2");
	assert.equal(result.totalBonus, 6);
	assert.equal(result.bonusParts.length, 2);
	assert.equal(result.bonusParts[0].damageType, "cold");
	assert.equal(result.bonusParts[1].damageType, "");
});

test("formula variables are substituted through attacker roll data", async () => {
	const weapon = makeWeapon({
		damageBonuses: [{ formula: "1 + @str", label: "Str-scaled" }],
	});
	const result = await calculateWeaponBonusDamage(weapon, makeAttacker({ mod: 3 }), makeTarget());
	assert.equal(result.bonusFormula, "1 + 3");
	assert.equal(result.totalBonus, 4);
});

test("prompt bonuses are skipped in the automated calculation", async () => {
	const weapon = makeWeapon({
		damageBonuses: [
			{ formula: "1d6", label: "Prompt", prompt: true },
			{ formula: "1d4", label: "Auto" },
		],
	});
	const result = await calculateWeaponBonusDamage(weapon, makeAttacker(), makeTarget());
	assert.equal(result.bonusFormula, "1d4");
	assert.equal(result.bonusParts.length, 1);
});

test("depleted (usage === 0) bonuses are skipped", async () => {
	const weapon = makeWeapon({
		damageBonuses: [
			{ formula: "1d6", label: "Spent", usage: 0 },
			{ formula: "1d4", label: "Ready", usage: 2 },
		],
	});
	const result = await calculateWeaponBonusDamage(weapon, makeAttacker(), makeTarget());
	assert.equal(result.bonusFormula, "1d4");
	// usage tracking survives on the applied part for later decrementing
	assert.deepEqual(result.appliedBonusIndicesWithUsage, [1]);
});

test("exclusive bonus with requirements replaces all other parts", async () => {
	const weapon = makeWeapon({
		damageBonuses: [
			{ formula: "1d6", label: "Always", exclusive: false },
			{
				formula: "3d6",
				label: "Versus Undead",
				exclusive: true,
				requirements: [{ type: "targetName", operator: "equals", value: "Zombie" }],
			},
		],
	});
	const result = await calculateWeaponBonusDamage(weapon, makeAttacker(), makeTarget({ name: "Zombie" }));
	assert.equal(result.bonusFormula, "3d6");
	assert.equal(result.bonusParts.length, 1);
	assert.equal(result.bonusParts[0].label, "Versus Undead");
});

test("non-exclusive bonuses with unmet requirements are filtered out", async () => {
	const weapon = makeWeapon({
		damageBonuses: [
			{ formula: "1d4", label: "Base" },
			{
				formula: "1d6",
				label: "Versus Dragon",
				requirements: [{ type: "targetName", operator: "equals", value: "Dragon" }],
			},
		],
	});
	const result = await calculateWeaponBonusDamage(weapon, makeAttacker(), makeTarget());
	assert.equal(result.bonusFormula, "1d4");
	assert.equal(result.bonusParts.length, 1);
});

test("critical branch: extra dice and critical damage formula are rolled and preserved", async () => {
	const weapon = makeWeapon({
		damageBonuses: [{ formula: "1d4", label: "Base" }],
		criticalExtraDice: 2,
		criticalExtraDamage: "1d6",
		criticalDiceRequirements: [],
		criticalDamageRequirements: [],
	});
	const result = await calculateWeaponBonusDamage(weapon, makeAttacker(), makeTarget(), true);
	assert.equal(result.criticalExtraDice, 2);
	// 2 x d6 base die -> "2d6" from the weapon's oneHanded damage die
	assert.equal(result.criticalExtraDiceFormula, "2d6");
	assert.equal(result.criticalFormula, "1d6");
	assert.equal(result.criticalBonus, 12 + 6);
	// critical components join the damage components with standard type
	const criticalComponents = result.damageComponents.filter((c) => c.label === "Critical Dice" || c.label === "Critical");
	assert.equal(criticalComponents.length, 2);
});

test("critical branch: requirement-gated extra dice are withheld", async () => {
	const weapon = makeWeapon({
		criticalExtraDice: 3,
		criticalExtraDamage: "1d6",
		criticalDiceRequirements: [{ type: "targetName", operator: "equals", value: "Dragon" }],
		criticalDamageRequirements: [],
	});
	const result = await calculateWeaponBonusDamage(weapon, makeAttacker(), makeTarget(), true);
	assert.equal(result.criticalExtraDice, 0);
	assert.equal(result.criticalFormula, "1d6"); // damage requirement empty -> passes
});

test("non-critical call does not roll critical extras", async () => {
	const weapon = makeWeapon({
		criticalExtraDice: 2,
		criticalExtraDamage: "1d6",
	});
	const result = await calculateWeaponBonusDamage(weapon, makeAttacker(), makeTarget(), false);
	assert.equal(result.criticalExtraDice, 0);
	assert.equal(result.criticalFormula, "");
	assert.equal(result.criticalBonus, 0);
});
