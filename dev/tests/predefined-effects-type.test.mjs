import assert from "node:assert/strict";
import test from "node:test";

// Shadowdark 4.1.0's createPredefinedEffect builds the change from `type` and
// ignores `mode`, and Foundry v14 defaults a missing type to "add". Without a
// type, every SDX override effect (resistance, damage dice, silenced...) would
// be created as an add.

globalThis.CONFIG = { SHADOWDARK: { PREDEFINED_EFFECTS: {} } };
globalThis.shadowdark = {
	effects: { handlePredefinedEffect() {}, modifyEffectChangesWithInput() {} },
};

const { registerPredefinedEffects } = await import("../../scripts/effects/predefined-effects.mjs");

test("SDX predefined effects carry the change type their mode names", () => {
	registerPredefinedEffects();
	const effects = CONFIG.SHADOWDARK.PREDEFINED_EFFECTS;

	for (const [key, effect] of Object.entries(effects)) {
		assert.ok(["add", "override"].includes(effect.type), `${key} has type ${effect.type}`);
	}
	assert.equal(effects.resistanceFire.type, "override");
	assert.equal(effects.meleeDamageDice.type, "override");
	assert.equal(effects.abilityAdvantageStr.type, "add");
	assert.equal(effects.spellDisadvantage.type, "add");
});
