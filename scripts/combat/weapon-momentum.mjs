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
 * The system is left untouched. Its `applyExploding` rewrites only the FIRST
 * dice term of a formula (its regex has no `g` flag), which is why the world
 * setting never reaches added bonus dice — that is a system-side bug and fixing
 * it is not this module's business. The two `shouldExplode*` predicates below
 * exist so this override neither duplicates nor collides with whatever the
 * system does.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * A dice term (`2d6`, `d20`) plus any modifiers already attached to it.
 * Deliberately global, unlike the system's single-term equivalent.
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
 * `applyExploding` inside `roll()` AFTER this runs, so exploding here as well
 * would hand it `1d8x`, which its regex rewrites to `1d8xx` — a second explode
 * modifier on the same die, and inflated damage. When the world setting is on
 * the system already explodes the weapon, so the override has nothing to add.
 *
 * Keeping the check on the setting rather than on the system's current
 * behaviour is also what makes this survive a system-side fix: if
 * `applyExploding` ever grows its missing `g` flag, this path stays dormant
 * exactly when it should.
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
 * No world-setting check: these Roll objects never pass through
 * `shadowdark.dice.roll()`, so the system cannot double-apply to them. That
 * also means the world setting has never reached them — a separately rolled
 * bonus die only explodes if this override says so.
 *
 * @param {Item} weapon - The weapon item.
 * @returns {boolean}
 */
export function shouldExplodeOwnRoll(weapon) {
	return weaponHasMomentum(weapon);
}
