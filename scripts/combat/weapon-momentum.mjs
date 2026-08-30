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
 * The system is left untouched. Its own `applyExploding` (SD 4.0.6) explodes
 * EVERY dice term of the formula it is handed — its regex carries `g`. What it
 * never sees is a damage bonus this module rolls separately, outside
 * `shadowdark.dice.roll`; that, not the regex, is why the world setting alone
 * does not reach every bonus die.
 *
 * The two `shouldExplode*` predicates below exist so this override neither
 * duplicates nor collides with what the system does, and the split between
 * them follows exactly that line: formulas the system will roll, versus rolls
 * this module evaluates itself.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * A dice term (`2d6`, `d20`) plus any modifiers already attached to it.
 * Capturing the trailing modifiers is what makes the idempotence check below
 * possible; the system's equivalent pattern does not, and cannot skip a term
 * that already explodes.
 */
const DICE_TERM = /(\d*)d(\d+)([a-z0-9!<>=]*)/gi;

/**
 * True when a modifier string already carries Foundry's explode modifier.
 *
 * The `[^a-z]` guard is what keeps `max3` from reading as an explode on the
 * strength of the `x` in the middle of it; a real explode modifier is only ever
 * preceded by the faces, another modifier's digits, or nothing at all.
 */
const EXPLODE_MODIFIER = /(?:^|[^a-z])x/i;

/**
 * Append Foundry's explode modifier to every dice term in a formula.
 *
 * Idempotent: a term that already explodes is returned untouched, so running
 * this twice — or over a formula the system has already rewritten — never
 * produces the double `1d8xx` that a naive append would.
 *
 * @param {string} formula - A Foundry roll formula.
 * @returns {string} The formula with every dice term exploding.
 */
export function applyExplodingAll(formula) {
	if (typeof formula !== "string" || !formula) return formula;

	return formula.replace(DICE_TERM, (match, _count, _faces, modifiers) => (
		EXPLODE_MODIFIER.test(modifiers || "") ? match : `${match}x`
	));
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
 * here would hand it `1d8x + 1d6x` and get back `1d8xx + 1d6xx`, a second
 * explode modifier on every die and inflated damage. When the world setting is
 * on the system already explodes this whole formula, bonuses included, so the
 * override has nothing to add.
 *
 * Checking the setting rather than trying to predict the system's output is
 * what keeps this stable: it stays dormant whenever the system is doing the
 * work, without this module having to model how the system does it.
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
