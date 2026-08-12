import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { escapeHTML } from "./helpers/escape-html.mjs";

// Lane-B combat split test (Phase 5.3, work items 3/5 — damage-card split).
// Pure-builders behavior + action-layer routing. The DOM listener attachment
// stays in damage-card.mjs; the action layer lives in damage-card-actions.mjs
// and is re-exported so external importers (CombatSettingsSD facade, item-macro
// callers) keep working.
//
// The builders module imports CreatureTypesApp.mjs, which destructures
// foundry.applications.api at module load (issue #52 harness pattern), and the
// formula evaluator calls Roll.safeEval — stubbed below.
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
		escapeHTML,
	},
};
globalThis.game = {
	settings: { get: () => undefined, register: () => {} },
	i18n: { localize: (key) => key },
	user: { isGM: true },
};
globalThis.Roll = {
	safeEval: (expr) => {
		// eslint-disable-next-line no-new-func -- scoped test evaluator mirroring the runtime sandbox
		return new Function(`return (${expr})`)();
	},
};

const {
	doubleDiceInFormula,
	evaluateFormulaExpressions,
	evaluateRequirement,
	normalizeConfiguredEffectUuids,
	parseTieredFormula,
} = await import("../../scripts/combat/damage-card-builders.mjs");

// ---------------------------------------------------------------- formula utils

test("doubleDiceInFormula doubles every dice term and preserves static bonuses", () => {
	assert.equal(doubleDiceInFormula("2d6+3"), "4d6+3");
	assert.equal(doubleDiceInFormula("1d8+1d4"), "2d8+2d4");
	assert.equal(doubleDiceInFormula("(1)d6"), "2d6");
	assert.equal(doubleDiceInFormula("4d10+1d4+2"), "8d10+2d4+2");
	assert.equal(doubleDiceInFormula(""), "");
});

test("parseTieredFormula picks the matching tier by level", () => {
	const formula = "1-3:1d6, 4-6:2d8, 7-9:3d10, 10+:4d12";
	assert.equal(parseTieredFormula(formula, 1), "1d6");
	assert.equal(parseTieredFormula(formula, 3), "1d6");
	assert.equal(parseTieredFormula(formula, 4), "2d8");
	assert.equal(parseTieredFormula(formula, 9), "3d10");
	assert.equal(parseTieredFormula(formula, 12), "4d12");
	assert.equal(parseTieredFormula(formula, 0), null);
	assert.equal(parseTieredFormula("", 5), null);
});

test("evaluateFormulaExpressions resolves @variables and parenthetical math", () => {
	const rollData = { level: 3, target: { level: 5 } };
	// Nested floor() inside the dice-count parens: the first replace resolves
	// @level, the second replace simplifies the expression, preserving the
	// outer parens as written (existing runtime behavior).
	assert.equal(evaluateFormulaExpressions("(1 + floor(@level / 2))d6", rollData), "(2)d6");
	assert.equal(evaluateFormulaExpressions("1 + @level", rollData), "1 + 3");
	assert.equal(evaluateFormulaExpressions("2d6", rollData), "2d6");
});

test("evaluateRequirement supports comparison, boolean logic, and bareword quoting", () => {
	const rollData = { target: { level: 3, subtype: "undead" } };
	assert.equal(evaluateRequirement("@target.level < 5", rollData), true);
	assert.equal(evaluateRequirement("@target.level > 5", rollData), false);
	assert.equal(evaluateRequirement("@target.subtype == undead", rollData), true);
	assert.equal(evaluateRequirement("@target.subtype == dragon", rollData), false);
	assert.equal(evaluateRequirement("@target.level >= 3 && @target.subtype == undead", rollData), true);
	assert.equal(evaluateRequirement("", rollData), true);
});

test("normalizeConfiguredEffectUuids parses JSON strings and drops entries without uuid", () => {
	assert.deepEqual(normalizeConfiguredEffectUuids(null), []);
	assert.deepEqual(normalizeConfiguredEffectUuids('["Actor.a1"]'), [{ uuid: "Actor.a1" }]);
	assert.deepEqual(
		normalizeConfiguredEffectUuids([
			"Actor.a1",
			{ uuid: "Item.i2", name: "Burning", img: "icons/burn.svg" },
			{ name: "NoUuid" },
		]),
		[
			{ uuid: "Actor.a1" },
			{ uuid: "Item.i2", name: "Burning", img: "icons/burn.svg", duration: {} },
		]
	);
	assert.deepEqual(normalizeConfiguredEffectUuids("not json"), []);
});

// ------------------------------------------------------------ split/routing shape

const moduleRoot = new URL("../../scripts/combat/", import.meta.url);
const damageCardSource = readFileSync(new URL("damage-card.mjs", moduleRoot), "utf8");
const actionsSource = readFileSync(new URL("damage-card-actions.mjs", moduleRoot), "utf8");
const pipelineSource = readFileSync(new URL("damage-card-pipeline.mjs", moduleRoot), "utf8");
const targetingSource = readFileSync(new URL("damage-card-targeting.mjs", moduleRoot), "utf8");
const facadeSource = readFileSync(new URL("CombatSettingsSD.mjs", moduleRoot), "utf8");

test("damage-card.mjs stays under the 1200-line split ceiling", () => {
	const lines = damageCardSource.split("\n").length;
	assert.ok(lines <= 1200, `damage-card.mjs is ${lines} lines, expected <= 1200`);
});

test("applying damage also marks the system's apply-damage anchors as applied", () => {
	// The system fades its own `.apply-damage` anchors off `flags.shadowdark.damageApplied`
	// (ChatMessageSD#_addEventHandlers adds `.damage-applied`, opacity 0.4). SDX applies the
	// same damage from its own button, so it has to set that flag or the anchors stay live
	// and invite a second application. Source gate: the runtime path is inside a jQuery
	// click handler with no seam to call directly.
	assert.ok(
		damageCardSource.includes('setFlag("shadowdark", "damageApplied", true)'),
		"damage-card.mjs must set the shadowdark-scope damageApplied flag when damage is applied"
	);
	assert.ok(
		damageCardSource.includes("markSystemAnchorsApplied($card)"),
		"damage-card.mjs must fade the on-screen system anchors immediately"
	);
	assert.match(
		damageCardSource,
		/function markSystemAnchorsApplied[\s\S]*?addClass\("damage-applied"\)/,
		"markSystemAnchorsApplied must apply the system's own .damage-applied class"
	);
});

test("the action layer is extracted and re-exported through damage-card.mjs", () => {
	// action layer exists as its own module
	assert.ok(actionsSource.includes("trackSummonedTokensForExpiry"));
	// damage-card.mjs imports from it (routing seam)
	assert.match(damageCardSource, /from "\.\/damage-card-actions\.mjs"/);
	// public surface is preserved on damage-card.mjs
	assert.match(damageCardSource, /export \{/);
	assert.ok(damageCardSource.includes("spawnSummonedCreatures"));
	assert.ok(damageCardSource.includes("giveItemsToCaster"));
	assert.ok(damageCardSource.includes("applyCoatingPoison"));
});

test("pure builders are exported from damage-card-builders.mjs and damage-card.mjs", () => {
	const buildersSource = readFileSync(new URL("damage-card-builders.mjs", moduleRoot), "utf8");
	for (const name of [
		"buildRollBreakdown",
		"buildDamageCardHtml",
		"normalizeConfiguredEffectUuids",
		"evaluateFormulaExpressions",
		"doubleDiceInFormula",
		"parseTieredFormula",
		"evaluateRequirement",
		"buildTargetRollData",
	]) {
		assert.ok(buildersSource.includes(name), `builders missing ${name}`);
		assert.ok(damageCardSource.includes(name), `damage-card.mjs missing re-export ${name}`);
	}
});

test("CombatSettingsSD facade keeps the damage-card pipeline exports", () => {
	assert.match(facadeSource, /injectDamageCard/);
	assert.match(facadeSource, /trackSummonedTokensForExpiry/);
	assert.match(facadeSource, /spawnSummonedCreatures/);
	assert.match(facadeSource, /setupCombatSocket/);
});

test("socket access flows through the shared combat-socket boundary", () => {
	assert.match(damageCardSource, /from "\.\.\/shared\/combat-socket\.mjs"/);
	assert.match(damageCardSource, /getSocket\(\)/);
	// no direct socketlib use in the damage-card modules
	assert.ok(!damageCardSource.includes("socketlib.registerModule"));
	assert.ok(!actionsSource.includes("socketlib.registerModule"));
});

test("the pipeline stays under the 2000-line split threshold after the target extraction", () => {
	const lines = pipelineSource.split("\n").length;
	assert.ok(lines <= 2000, `damage-card-pipeline.mjs is ${lines} lines, expected <= 2000`);
});

test("template targeting is extracted into damage-card-targeting.mjs and routed through the pipeline", () => {
	// the seam exists
	assert.match(targetingSource, /export async function resolveDamageCardTargets/);
	// the pipeline calls the extracted seam instead of inlining template logic
	assert.match(pipelineSource, /resolveDamageCardTargets\(/);
	// template-placement state stays shared via combat-settings-app
	assert.match(targetingSource, /_templatePlacedMessages/);
	// the pipeline no longer imports the template-effects builders directly
	assert.ok(!pipelineSource.includes("buildTemplateEffectsFlag"));
	assert.ok(!pipelineSource.includes("processTemplateCreationEffects"));
});
