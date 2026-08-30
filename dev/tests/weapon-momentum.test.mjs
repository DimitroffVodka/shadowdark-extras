import assert from "node:assert/strict";
import test from "node:test";

// Per-weapon Momentum — exploding damage dice for a single weapon (issue #134).
//
// The system ships a world-wide Momentum Mode setting. Its `applyExploding`
// explodes EVERY dice term of the formula it is handed (SD 4.0.6: the regex
// carries `g`), but it only ever sees what reaches `shadowdark.dice.roll` —
// damage bonuses this module rolls separately never pass through it. This
// module adds a per-weapon override that explodes the weapon's damage dice even
// when the world setting is off.
//
// The interesting behaviour is therefore not "does it append an x" but the two
// collision rules:
//
//   1. A formula handed to the system's roll() must NOT be pre-exploded while
//      the world setting is on. The system's pattern matches an already-
//      exploding term as readily as a bare one, so it would turn `1d8x + 1d6x`
//      into `1d8xx + 1d6xx` — a second explode modifier on every die.
//   2. Rolls this module builds itself never reach the system's roll(), so the
//      world setting can neither double-apply to them nor explode them at all,
//      and only the override applies.

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

/**
 * The system's own applyExploding, copied verbatim from SD 4.0.6
 * (src/dice/dice.mjs:47 and the compiled build Foundry loads). The `g` matters:
 * without it this replica would understate what the system does to a formula
 * that has already been exploded, which is the whole collision under test.
 */
function systemApplyExploding(formula) {
	return formula.replace(/(\d*)d(\d+[a-z0-9]*)/ig, match => `${match}x`);
}

const weapon = (weaponBonus) => ({ flags: { "shadowdark-extras": { weaponBonus } } });

test.beforeEach(() => {
	momentumSetting = false;
	settingsThrow = false;
});

// --- applyExplodingAll --------------------------------------------------

test("explodes every dice term", () => {
	assert.equal(applyExplodingAll("1d8 + 1d6"), "1d8x + 1d6x");
	// On a bare formula the system agrees; the two differ only on idempotence.
	assert.equal(systemApplyExploding("1d8 + 1d6"), "1d8x + 1d6x");
});

test("is idempotent — an already-exploding term is left alone", () => {
	assert.equal(applyExplodingAll("1d8x + 1d6x"), "1d8x + 1d6x");
	assert.equal(applyExplodingAll(applyExplodingAll("1d8 + 1d6")), "1d8x + 1d6x");
	// The system's is not idempotent — which is exactly the hazard being guarded.
	assert.equal(systemApplyExploding("1d8x + 1d6x"), "1d8xx + 1d6xx");
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
	// Demonstrates the collision the guard above exists to prevent: every die
	// picks up a second explode modifier, not just the first.
	const doubled = systemApplyExploding(applyExplodingAll("1d8 + 1d6"));
	assert.equal(doubled, "1d8xx + 1d6xx");

	// With the guard, the system is handed the untouched formula and explodes
	// the whole thing itself — base die and folded-in bonus alike.
	momentumSetting = true;
	assert.equal(shouldExplodeSystemFormula(weapon({ enabled: true, momentum: true })), false);
	assert.equal(systemApplyExploding("1d8 + 1d6"), "1d8x + 1d6x");
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
