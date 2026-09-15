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
 * Stock SD 4.0.6 explodes only the first dice term. At the roll-config seam we
 * pre-explode only the later terms, then let the system add the first `x` as
 * usual. A runtime probe leaves fixed/patched system versions untouched.
 * Damage bonuses this module evaluates itself never enter the system's roll
 * helper, so either the world setting or the per-weapon override applies there.
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
 * Stock SD 4.0.6's own dice pattern, from its `applyExploding`. It needs
 * numeric faces, so it skips `1dF` and `1d(6+2)` where DICE_TERM does not —
 * the first term the system will explode must be found with this one.
 */
const SYSTEM_DICE_TERM = /(\d*)d(\d+[a-z0-9]*)/i;

/**
 * Supplement stock Shadowdark's first-term-only Momentum transform.
 *
 * For an initial roll, every term except the one the system will append `x` to
 * is prepared here. Rerolls skip the system transform, so every term is
 * prepared. A system version that already transforms every term is detected
 * from its own helper and left alone.
 *
 * @param {string} formula - A Foundry roll formula.
 * @param {boolean} reroll - Whether Shadowdark will skip its transforms.
 * @returns {string}
 */
export function prepareCoreMomentumFormula(formula, reroll = false) {
	if (!coreMomentumEnabled()) return formula;
	if (reroll) return applyExplodingAll(formula);

	const applyCore = globalThis.shadowdark?.dice?.applyExploding;
	if (typeof applyCore !== "function") return formula;
	try {
		if (applyCore("1d4 + 1d6") !== "1d4x + 1d6") return formula;
	}
	catch{
		return formula;
	}

	const first = SYSTEM_DICE_TERM.exec(formula);
	if (!first) return formula;
	const end = first.index + first[0].length;
	return applyExplodingAll(formula.slice(0, first.index))
		+ first[0]
		+ applyExplodingAll(formula.slice(end));
}

/**
 * Whether this weapon carries the per-weapon momentum override.
 *
 * Deliberately INDEPENDENT of the tab's `enabled` master switch, unlike every
 * other setting stored beside it. #134 asks for exploding dice on "any weapon",
 * and a weapon that only wants exploding damage has no reason to switch on the
 * hit/damage/critical bonus machinery it is not using. The checkbox sits
 * outside the collapsible bonus content to match, so nothing here fires from a
 * control that looks greyed out.
 *
 * @param {Item} weapon - The weapon item.
 * @returns {boolean}
 */
export function weaponHasMomentum(weapon) {
	return !!weapon?.flags?.[MODULE_ID]?.weaponBonus?.momentum;
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
 * This predicate owns only the per-weapon full transform. World Momentum uses
 * `prepareCoreMomentumFormula`, which can supplement later terms without
 * pre-exploding the first one.
 *
 * @param {Item} weapon - The weapon item.
 * @returns {boolean}
 */
export function shouldExplodeSystemFormula(weapon) {
	return weaponHasMomentum(weapon) && !coreMomentumEnabled();
}

/**
 * Whether to explode a Roll this module builds and evaluates ITSELF. These
 * rolls never pass through `shadowdark.dice.roll()`, so world Momentum must be
 * applied here as well as the per-weapon override.
 *
 * @param {Item} weapon - The weapon item.
 * @returns {boolean}
 */
export function shouldExplodeOwnRoll(weapon) {
	return coreMomentumEnabled() || weaponHasMomentum(weapon);
}
