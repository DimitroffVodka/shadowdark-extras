import assert from "node:assert/strict";
import test from "node:test";

// Per-weapon Momentum — exploding damage dice for a single weapon (issue #134).
//
// The system ships a world-wide Momentum Mode setting, and its `applyExploding`
// comes in TWO forms in the wild:
//
//   - stock SD 4.0.6 uses `/i` and explodes only the FIRST dice term, which is
//     the bug behind the first half of #134;
//   - a one-character local patch to `/ig` explodes all of them.
//
// This module must be correct on both: it supplements only stock's missing tail
// terms and leaves the fixed variant alone.
//
// Two collision rules matter: only tail terms may be prepared before stock
// Shadowdark runs, because pre-exploding the first gives `1d8xx`; rolls built
// and evaluated by SDX need the complete world transform applied by SDX.

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
	prepareCoreMomentumFormula,
	shouldExplodeOwnRoll,
	shouldExplodeSystemFormula,
	weaponHasMomentum,
} = await import("../../scripts/combat/weapon-momentum.mjs");

/**
 * The system's applyExploding, copied verbatim in both forms it takes in the
 * wild (src/dice/dice.mjs:46-50 of SD 4.0.6, and the same function with the
 * `g` flag added by a local patch). Dated to SD 4.0.6 — if the system changes
 * this function these replicas go stale silently.
 */
const SYSTEM_VARIANTS = {
	// Stock: only the first dice term explodes. The bug half of #134.
	stock: formula => formula.replace(/(\d*)d(\d+[a-z0-9]*)/i, match => `${match}x`),
	// Patched: every dice term explodes.
	patched: formula => formula.replace(/(\d*)d(\d+[a-z0-9]*)/ig, match => `${match}x`),
};

let systemApplyExploding = SYSTEM_VARIANTS.stock;
globalThis.shadowdark = {
	dice: { applyExploding: formula => systemApplyExploding(formula) },
};

const weapon = (weaponBonus) => ({ flags: { "shadowdark-extras": { weaponBonus } } });

test.beforeEach(() => {
	momentumSetting = false;
	settingsThrow = false;
	systemApplyExploding = SYSTEM_VARIANTS.stock;
});

// --- applyExplodingAll --------------------------------------------------

test("explodes every dice term, which stock Shadowdark does not", () => {
	assert.equal(applyExplodingAll("1d8 + 1d6"), "1d8x + 1d6x");
	assert.equal(SYSTEM_VARIANTS.stock("1d8 + 1d6"), "1d8x + 1d6", "stock misses the bonus die");
	assert.equal(SYSTEM_VARIANTS.patched("1d8 + 1d6"), "1d8x + 1d6x");
});

test("is idempotent — an already-exploding term is left alone", () => {
	assert.equal(applyExplodingAll("1d8x + 1d6x"), "1d8x + 1d6x");
	assert.equal(applyExplodingAll(applyExplodingAll("1d8 + 1d6")), "1d8x + 1d6x");
	// Neither system variant is idempotent — exactly the hazard being guarded.
	assert.equal(SYSTEM_VARIANTS.stock("1d8x + 1d6x"), "1d8xx + 1d6x");
	assert.equal(SYSTEM_VARIANTS.patched("1d8x + 1d6x"), "1d8xx + 1d6xx");
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

// The two modifier cases a substring search gets wrong in OPPOSITE directions.
// Both are why the modifier string is tokenised rather than searched.

test("the x inside `max` does not read as an explode modifier", () => {
	// A naive /x/ test on the modifier string skips this term forever.
	assert.equal(applyExplodingAll("1d6max3"), "1d6max3x");
	assert.equal(applyExplodingAll("1d6min2"), "1d6min2x");
});

test("an x trailing another modifier IS an explode modifier", () => {
	// The dangerous direction: a `(?:^|[^a-z])x` guard cannot see the x after
	// `kh` and appends a second one, silently inflating damage.
	assert.equal(applyExplodingAll("2d6khx"), "2d6khx");
	assert.equal(applyExplodingAll("4d6kh3xo"), "4d6kh3xo");
});

test("`xo` (explode once) counts as already exploding", () => {
	assert.equal(applyExplodingAll("1d8xo"), "1d8xo");
	assert.equal(applyExplodingAll("1d8xo>4"), "1d8xo>4");
});

test("Fate dice are never exploded", () => {
	// Max face is +1; exploding would re-roll about a third of the pool.
	assert.equal(applyExplodingAll("4dF"), "4dF");
	assert.equal(applyExplodingAll("4df"), "4df");
});

test("parenthesised faces still explode", () => {
	assert.equal(applyExplodingAll("1d(6+2)"), "1d(6+2)x");
});

test("an unparseable modifier string is left alone rather than appended to", () => {
	// Failing closed: under-exploding is visible, a stray second `x` is not.
	assert.equal(applyExplodingAll("1d6zzz"), "1d6zzz");
});

test("returns non-string and empty input unchanged", () => {
	assert.equal(applyExplodingAll(""), "");
	assert.equal(applyExplodingAll(null), null);
	assert.equal(applyExplodingAll(undefined), undefined);
	assert.equal(applyExplodingAll(7), 7);
});

// --- weaponHasMomentum --------------------------------------------------

test("momentum is independent of the weapon-bonus master switch", () => {
	assert.equal(weaponHasMomentum(weapon({ enabled: true, momentum: true })), true);
	assert.equal(weaponHasMomentum(weapon({ enabled: true, momentum: false })), false);
	// #134 asks for exploding dice on "any weapon" — a weapon that wants only
	// exploding damage should not have to switch on the bonus machinery. The
	// checkbox lives outside the collapsible content to match.
	assert.equal(weaponHasMomentum(weapon({ enabled: false, momentum: true })), true);
	assert.equal(weaponHasMomentum(weapon({ momentum: true })), true);
	assert.equal(weaponHasMomentum(weapon({ enabled: true })), false);
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

// --- prepareCoreMomentumFormula -----------------------------------------

test("stock core Momentum gets every later dice term prepared", () => {
	momentumSetting = true;
	const prepared = prepareCoreMomentumFormula("1d8 + 1d6 + 1d4");
	assert.equal(prepared, "1d8 + 1d6x + 1d4x");
	assert.equal(SYSTEM_VARIANTS.stock(prepared), "1d8x + 1d6x + 1d4x");
});

test("a core helper that already explodes every term is left untouched", () => {
	momentumSetting = true;
	systemApplyExploding = SYSTEM_VARIANTS.patched;
	const prepared = prepareCoreMomentumFormula("1d8 + 1d6");
	assert.equal(prepared, "1d8 + 1d6");
	assert.equal(SYSTEM_VARIANTS.patched(prepared), "1d8x + 1d6x");
});

test("core Momentum rerolls are fully prepared because the system skips transforms", () => {
	momentumSetting = true;
	assert.equal(prepareCoreMomentumFormula("1d8 + 1d6", true), "1d8x + 1d6x");
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

test("pre-exploding while the world setting is on doubles the modifier — on BOTH variants", () => {
	// The collision the guard exists to prevent. It is present either way, so
	// the guard cannot be relaxed by assuming a particular system build.
	const ours = applyExplodingAll("1d8 + 1d6");
	assert.equal(SYSTEM_VARIANTS.stock(ours), "1d8xx + 1d6x");
	assert.equal(SYSTEM_VARIANTS.patched(ours), "1d8xx + 1d6xx");

	// With the guard, the system is handed the untouched formula instead.
	momentumSetting = true;
	assert.equal(shouldExplodeSystemFormula(weapon({ enabled: true, momentum: true })), false);
});

test("a reroll after the world setting flips on does not double", () => {
	// Rerolls skip the system's own transform, and this module's pass is
	// idempotent, so a formula exploded while the setting was off survives a
	// flip intact rather than picking up a second modifier.
	momentumSetting = false;
	const explodingWeapon = weapon({ enabled: true, momentum: true });
	assert.equal(shouldExplodeSystemFormula(explodingWeapon), true);
	const first = applyExplodingAll("1d8 + 1d6");

	momentumSetting = true;
	assert.equal(shouldExplodeSystemFormula(explodingWeapon), false);
	assert.equal(applyExplodingAll(first), first, "re-running the pass changes nothing");
});

test("a weapon with ONLY momentum set still explodes its base damage", () => {
	// The case decoupling exists for: no hit/damage/critical bonuses configured,
	// the master switch off, just an exploding weapon.
	momentumSetting = false;
	assert.equal(shouldExplodeSystemFormula(weapon({ momentum: true })), true);
	assert.equal(shouldExplodeOwnRoll(weapon({ momentum: true })), true);
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

test("world Momentum reaches self-built rolls without the weapon override", () => {
	momentumSetting = true;
	assert.equal(shouldExplodeOwnRoll(weapon({ enabled: true, momentum: false })), true);
});

test("self-built rolls do not explode when both Momentum controls are off", () => {
	momentumSetting = false;
	assert.equal(shouldExplodeOwnRoll(weapon({ enabled: true, momentum: false })), false);
});
