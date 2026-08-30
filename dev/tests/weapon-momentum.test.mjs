import assert from "node:assert/strict";
import test from "node:test";

// Per-weapon Momentum — exploding damage dice for a single weapon (issue #134).
//
// The system ships a world-wide Momentum Mode setting whose `applyExploding`
// rewrites only the FIRST dice term of a formula (its regex has no `g` flag),
// so added bonus dice never explode. That is a system bug and is deliberately
// NOT fixed here. What this module adds is a per-weapon override that explodes
// the weapon's damage dice even when the world setting is off.
//
// The interesting behaviour is therefore not "does it append an x" but the two
// collision rules:
//
//   1. A formula handed to the system's roll() must NOT be pre-exploded while
//      the world setting is on, or the system's own pass rewrites `1d8x` into
//      `1d8xx` — a second explode modifier, and inflated damage.
//   2. Rolls this module builds itself never reach the system's roll(), so the
//      world setting is irrelevant to them and only the override applies.

let momentumSetting = false;
let settingsThrow = false;

globalThis.game = {
	settings: {
		get: (namespace, key) => {
			if (settingsThrow) throw new Error("setting not registered");
			if (namespace === "shadowdark" && key === "useMomentumMode") return momentumSetting;
			return undefined;
		},
	},
};

const {
	applyExplodingAll,
	coreMomentumEnabled,
	shouldExplodeOwnRoll,
	shouldExplodeSystemFormula,
	weaponHasMomentum,
} = await import("../../scripts/combat/weapon-momentum.mjs");

/** The system's own applyExploding, copied verbatim, to test against. */
function systemApplyExploding(formula) {
	return formula.replace(/(\d*)d(\d+[a-z0-9]*)/i, match => `${match}x`);
}

const weapon = (weaponBonus) => ({ flags: { "shadowdark-extras": { weaponBonus } } });

test.beforeEach(() => {
	momentumSetting = false;
	settingsThrow = false;
});

// --- applyExplodingAll --------------------------------------------------

test("explodes every dice term, not just the first", () => {
	// The exact case the system misses: base die plus an added bonus die.
	assert.equal(applyExplodingAll("1d8 + 1d6"), "1d8x + 1d6x");
	assert.equal(systemApplyExploding("1d8 + 1d6"), "1d8x + 1d6", "system still only does the first");
});

test("is idempotent — an already-exploding term is left alone", () => {
	assert.equal(applyExplodingAll("1d8x + 1d6x"), "1d8x + 1d6x");
	assert.equal(applyExplodingAll(applyExplodingAll("1d8 + 1d6")), "1d8x + 1d6x");
});

test("explodes only the terms that are not already exploding", () => {
	assert.equal(applyExplodingAll("1d8x + 1d6"), "1d8x + 1d6x");
});

test("leaves flat modifiers and non-dice formulas untouched", () => {
	assert.equal(applyExplodingAll("1d8 + 3"), "1d8x + 3");
	assert.equal(applyExplodingAll("5"), "5");
	assert.equal(applyExplodingAll("@abilities.str.mod"), "@abilities.str.mod");
});

test("handles a term with no dice count", () => {
	assert.equal(applyExplodingAll("d20"), "d20x");
});

test("preserves existing modifiers", () => {
	assert.equal(applyExplodingAll("2d6kh1"), "2d6kh1x");
	assert.equal(applyExplodingAll("4d6kh3 + 1d4"), "4d6kh3x + 1d4x");
});

test("the x inside `max` does not read as an explode modifier", () => {
	// A naive /x/ test on the modifier string skips this term forever.
	assert.equal(applyExplodingAll("1d6max3"), "1d6max3x");
});

test("`xo` (explode once) counts as already exploding", () => {
	assert.equal(applyExplodingAll("1d8xo"), "1d8xo");
});

test("returns non-string and empty input unchanged", () => {
	assert.equal(applyExplodingAll(""), "");
	assert.equal(applyExplodingAll(null), null);
	assert.equal(applyExplodingAll(undefined), undefined);
	assert.equal(applyExplodingAll(7), 7);
});

// --- weaponHasMomentum --------------------------------------------------

test("momentum requires both the master switch and the toggle", () => {
	assert.equal(weaponHasMomentum(weapon({ enabled: true, momentum: true })), true);
	assert.equal(weaponHasMomentum(weapon({ enabled: true, momentum: false })), false);
	// A disabled weapon-bonus config is inert, not partially live.
	assert.equal(weaponHasMomentum(weapon({ enabled: false, momentum: true })), false);
});

test("momentum is false for weapons with no config at all", () => {
	assert.equal(weaponHasMomentum(weapon(undefined)), false);
	assert.equal(weaponHasMomentum({ flags: {} }), false);
	assert.equal(weaponHasMomentum(undefined), false);
});

// --- coreMomentumEnabled ------------------------------------------------

test("core momentum reads the system setting and survives it being unregistered", () => {
	momentumSetting = true;
	assert.equal(coreMomentumEnabled(), true);
	momentumSetting = false;
	assert.equal(coreMomentumEnabled(), false);
	settingsThrow = true;
	assert.equal(coreMomentumEnabled(), false, "an unregistered setting must not throw");
});

// --- shouldExplodeSystemFormula ----------------------------------------

test("system formulas explode only while the world setting is off", () => {
	const explodingWeapon = weapon({ enabled: true, momentum: true });

	momentumSetting = false;
	assert.equal(shouldExplodeSystemFormula(explodingWeapon), true);

	// The whole point of the guard: the system explodes these itself.
	momentumSetting = true;
	assert.equal(shouldExplodeSystemFormula(explodingWeapon), false);
});

test("pre-exploding while the world setting is on would double the modifier", () => {
	// Demonstrates the collision the guard above exists to prevent.
	const doubled = systemApplyExploding(applyExplodingAll("1d8 + 1d6"));
	assert.equal(doubled, "1d8xx + 1d6x");

	// With the guard, the system is handed the untouched formula instead.
	momentumSetting = true;
	assert.equal(shouldExplodeSystemFormula(weapon({ enabled: true, momentum: true })), false);
	assert.equal(systemApplyExploding("1d8 + 1d6"), "1d8x + 1d6");
});

test("a weapon without the override never explodes system formulas", () => {
	assert.equal(shouldExplodeSystemFormula(weapon({ enabled: true, momentum: false })), false);
	assert.equal(shouldExplodeSystemFormula(undefined), false);
});

// --- shouldExplodeOwnRoll ----------------------------------------------

test("self-built rolls explode on the override alone, whatever the world setting", () => {
	const explodingWeapon = weapon({ enabled: true, momentum: true });

	momentumSetting = false;
	assert.equal(shouldExplodeOwnRoll(explodingWeapon), true);
	// No double-apply risk here: these Rolls never pass through the system.
	momentumSetting = true;
	assert.equal(shouldExplodeOwnRoll(explodingWeapon), true);
});

test("self-built rolls do not explode without the override", () => {
	momentumSetting = true;
	assert.equal(shouldExplodeOwnRoll(weapon({ enabled: true, momentum: false })), false);
});
