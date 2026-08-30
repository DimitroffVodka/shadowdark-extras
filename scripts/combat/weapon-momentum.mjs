/**
 * Per-weapon Momentum — exploding damage dice for a single weapon (issue #134).
 *
 * The Shadowdark system already has a world-wide "Momentum Mode"
 * (`shadowdark.useMomentumMode`) that makes damage dice explode. This module
 * adds a per-weapon OVERRIDE so one weapon can explode even when that world
 * setting is off, which is what building a custom exploding weapon needs.
 *
 * Storage is `flags.shadowdark-extras.weaponBonus.momentum`, alongside the rest
 * of the weapon-bonus config, so the toggle rides the existing Bonuses tab, the
 * existing `enabled` master switch, and the existing WEAPON_BONUSES feature
 * gate rather than introducing a parallel set of any of them.
 *
 * The system is left untouched, and this module deliberately does not model
 * what its `applyExploding` does to a formula. Stock SD 4.0.6 explodes only the
 * FIRST dice term (its regex is `/i`), which is the bug behind the first half
 * of #134; a one-character local patch to `/ig` makes it explode all of them,
 * and such patched installs exist. Either way the rule here is the same: when
 * Momentum Mode is on, the system owns that formula and this module keeps its
 * hands off it. Nothing below depends on which variant is installed.
 *
 * What no variant of the system ever sees is a damage bonus this module rolls
 * separately, outside `shadowdark.dice.roll`. That structural gap, not the
 * regex, is why the world setting alone does not reach every bonus die.
 *
 * The two `shouldExplode*` predicates below exist so this override neither
 * duplicates nor collides with what the system does, and the split between
 * them follows exactly that line: formulas the system will roll, versus rolls
 * this module evaluates itself.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * A dice term plus any modifiers already attached to it: an optional count, the
 * `d`, then faces as a number (`2d6`), Fate's `F` (`4dF`), or a parenthesised
 * expression (`1d(6+2)`). Capturing the trailing modifiers is what makes the
 * idempotence check below possible.
 */
const DICE_TERM = /(\d*)d(\d+|F|\([^()]*\))([a-z0-9!<>=]*)/gi;

/** Fate/Fudge faces, which this module never explodes — see below. */
const FATE_FACES = /^F$/i;

/**
 * Foundry's die modifiers, longest and most specific first so that `max` is not
 * read as `ma`, `xo` not as `x`, and `dh`/`dl`/`df` not as a bare `d`. Each may
 * carry a comparison and/or a number: `kh1`, `r<3`, `xo>=5`.
 *
 * Sticky, because the point is to walk a modifier string token by token rather
 * than search it — searching is what makes the `x` in `max` look like an
 * explode, and makes the `x` in `khx` invisible.
 */
const MODIFIER_TOKEN =
	/(min|max|mi|ma|ms|rr|xo|kh|kl|dh|dl|df|cs|cf|ct|sf|x|r|k|d)([<>=]{0,2}\d*)/iy;

/**
 * Whether a term's modifier string already carries an explode modifier.
 *
 * Tokenising rather than substring-matching is what distinguishes the two cases
 * a regex search gets wrong in opposite directions: `1d6max3` does NOT explode
 * (the `x` belongs to `max`), and `2d6khx` DOES (the `x` trails `kh`, where a
 * `[^a-z]` guard cannot see it). Getting the second wrong is the dangerous one
 * — it appends a second modifier and silently inflates damage.
 *
 * @param {string} modifiers - The modifier text following a dice term.
 * @returns {boolean}
 */
function alreadyExplodes(modifiers) {
	if (!modifiers) return false;

	MODIFIER_TOKEN.lastIndex = 0;
	while (MODIFIER_TOKEN.lastIndex < modifiers.length) {
		const match = MODIFIER_TOKEN.exec(modifiers);
		// Unrecognised text: report it as already exploding so nothing is
		// appended. Under-exploding is a visible no-op the user can see and
		// report; appending to something this cannot parse risks a silent
		// second explode modifier, which just inflates damage.
		if (!match) return true;
		const keyword = match[1].toLowerCase();
		if (keyword === "x" || keyword === "xo") return true;
	}
	return false;
}

/**
 * Append Foundry's explode modifier to every dice term in a formula.
 *
 * Idempotent: a term that already explodes is returned untouched, so running
 * this twice — or over a formula the system has already rewritten — never
 * produces the double `1d8xx` that a naive append would.
 *
 * Fate dice are deliberately skipped. Their maximum face is +1, so exploding
 * them would re-roll roughly a third of the pool; no weapon means that.
 *
 * @param {string} formula - A Foundry roll formula.
 * @returns {string} The formula with every dice term exploding.
 */
export function applyExplodingAll(formula) {
	if (typeof formula !== "string" || !formula) return formula;

	return formula.replace(DICE_TERM, (match, _count, faces, modifiers) => {
		if (FATE_FACES.test(faces)) return match;
		return alreadyExplodes(modifiers) ? match : `${match}x`;
	});
}

/**
 * Whether this weapon carries the per-weapon momentum override.
 *
 * Gated on the weapon-bonus `enabled` master switch for the same reason every
 * other bonus on the tab is: a disabled config is inert, not partially live.
 *
 * @param {Item} weapon - The weapon item.
 * @returns {boolean}
 */
export function weaponHasMomentum(weapon) {
	const flags = weapon?.flags?.[MODULE_ID]?.weaponBonus;
	return !!(flags?.enabled && flags?.momentum);
}

/**
 * Whether the world-wide Momentum Mode setting is on.
 *
 * Wrapped because `game.settings.get` throws on an unregistered setting, which
 * is the case on a non-Shadowdark system and before the system registers it.
 *
 * @returns {boolean}
 */
export function coreMomentumEnabled() {
	try {
		return !!game?.settings?.get("shadowdark", "useMomentumMode");
	}
	catch{
		return false;
	}
}

/**
 * Whether to explode a formula that is about to be handed to the SYSTEM's roll
 * pipeline (`shadowdark.dice.roll`).
 *
 * Requires the world setting to be OFF. The system applies its own
 * `applyExploding` inside `roll()` AFTER this runs, and its pattern matches a
 * term that already explodes just as readily as a bare one — so pre-exploding
 * here would hand it `1d8x` and get back `1d8xx`, a second explode modifier and
 * inflated damage. Both the stock and the patched system do this; they differ
 * only in how many terms they double.
 *
 * Checking the setting rather than trying to predict the system's output is
 * what keeps this stable across both: it stays dormant whenever the system is
 * doing the work, without this module having to model how the system does it.
 *
 * @param {Item} weapon - The weapon item.
 * @returns {boolean}
 */
export function shouldExplodeSystemFormula(weapon) {
	return weaponHasMomentum(weapon) && !coreMomentumEnabled();
}

/**
 * Whether to explode a Roll this module builds and evaluates ITSELF.
 *
 * No world-setting check, and it must stay that way. These Roll objects never
 * pass through `shadowdark.dice.roll()`, so the system can neither double-apply
 * to them nor explode them in the first place — a separately rolled bonus die
 * explodes only if this override says so, whatever the world setting is. Adding
 * the setting check here would silently un-explode them.
 *
 * @param {Item} weapon - The weapon item.
 * @returns {boolean}
 */
export function shouldExplodeOwnRoll(weapon) {
	return weaponHasMomentum(weapon);
}
