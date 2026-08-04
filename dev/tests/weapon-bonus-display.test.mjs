import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Phase 5.2.8 regression (issue #55) — the dead weapon damage-bonus display
// is gone, the live hit-bonus display and the live damage pipeline remain.
//
// The bug: injectWeaponBonusDisplay (jQuery-based, against the v14 plain
// DOM) had exactly one caller, inside a branch of processWeaponBonuses
// gated on `flags.itemId` — which SD 4.x chat messages never carry — so the
// entire damage-bonus display path was unreachable. The live pipeline
// (CombatSettingsSD -> calculateWeaponBonusDamage -> weaponBonusResults
// flag -> damage-apply card breakdown) already presents the same
// information, so the dead function and its branch were deleted.

// ---- helpers ----

const moduleRoot = new URL("../../", import.meta.url);

function* walkMjs(dirUrl) {
	const entries = readdirSync(dirUrl, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.isDirectory()) {
			// trailing slash required: the next-level URL resolves against it
			yield* walkMjs(new URL(entry.name + "/", dirUrl));
		}
		else if (entry.name.endsWith(".mjs")) {
			yield new URL(entry.name, dirUrl);
		}
	}
}

function allSources() {
	const sources = new Map();
	for (const url of walkMjs(new URL("../../scripts/", import.meta.url))) {
		sources.set(url.pathname, readFileSync(url, "utf8"));
	}
	return sources;
}

// ------------------------------------------------------------------ tests

test("no injectWeaponBonusDisplay call or import remains anywhere in scripts/", () => {
	// Comments may explain the removal (hit-bonus.mjs header does); the
	// call/import patterns must be gone.
	for (const [path, source] of allSources()) {
		assert.ok(
			!source.match(/injectWeaponBonusDisplay\s*\(/),
			`${path} still CALLS injectWeaponBonusDisplay`
		);
		assert.ok(
			!source.match(/import[^;]*injectWeaponBonusDisplay/),
			`${path} still IMPORTS injectWeaponBonusDisplay`
		);
	}
});

test("hit-bonus.mjs no longer imports from WeaponBonusConfig.mjs", () => {
	const hitBonus = readFileSync(new URL("../../scripts/combat/hit-bonus.mjs", import.meta.url), "utf8");
	assert.ok(!hitBonus.includes('from "./WeaponBonusConfig.mjs"'));
});

test("the live hit-bonus display path is intact", () => {
	const hitBonus = readFileSync(new URL("../../scripts/combat/hit-bonus.mjs", import.meta.url), "utf8");
	assert.ok(hitBonus.includes("export async function processWeaponBonuses"));
	assert.ok(hitBonus.includes("injectHitBonusDisplay"));
	assert.ok(hitBonus.includes("_sdxHitBonusInfo"), "roll-config hit breakdown still read");
	// the dead branch's guards are gone
	assert.ok(!hitBonus.includes("flags?.itemId"), "itemId gate removed");
	assert.ok(!hitBonus.includes("bonusFlags"), "weapon-bonus flags gate removed");
});

test("the live damage pipeline still computes and renders the breakdown", () => {
	const pipeline = readFileSync(new URL("../../scripts/combat/damage-card-pipeline.mjs", import.meta.url), "utf8");
	assert.ok(pipeline.includes("calculateWeaponBonusDamage"), "pipeline still calls the calculator");
	assert.ok(pipeline.includes("weaponBonusResults"), "breakdown still persisted for the card");
	assert.ok(pipeline.includes("bonusInFormula"), "double-add de-dup still handled");
});

test("calculateWeaponBonusDamage is still exported and used", () => {
	const config = readFileSync(new URL("../../scripts/combat/WeaponBonusConfig.mjs", import.meta.url), "utf8");
	assert.ok(config.includes("export async function calculateWeaponBonusDamage"));
	// the jQuery-era display is gone from the same file
	assert.ok(!config.includes(".dice-roll"), "no jQuery .dice-roll targeting remains in the config");
});

test("export-surface gate accepts the removal (exception registered)", () => {
	const exceptions = JSON.parse(
		readFileSync(new URL("../../dev/tools/export-surface-exceptions.json", import.meta.url), "utf8")
	);
	const entry = exceptions.removals.find(
		(r) => r.module === "scripts/combat/WeaponBonusConfig.mjs" && r.name === "injectWeaponBonusDisplay"
	);
	assert.ok(entry, "exception registered for the removal");
	assert.ok(entry.phase && entry.reason, "exception carries phase + reason");
});
