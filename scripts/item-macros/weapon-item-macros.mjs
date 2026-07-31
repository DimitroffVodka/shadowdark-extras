import { getWeaponItemMacroConfig } from "../combat/WeaponBonusConfig.mjs";
import { hasItemMacro, executeItemMacro } from "./item-macro-engine.mjs";

/**
 * Weapon item macro execution.
 *
 * Extracted from the composition root in Phase 3. This is the thinnest of the
 * four execution paths — it only gates on the weapon's trigger list and hands
 * off to the shared engine, with no socket handler of its own, because a
 * weapon macro's runAsGm routing happens inside `executeItemMacro`.
 *
 * Its two callers are still in the root: the equip/unequip `updateItem` hook,
 * and the attack-card `renderChatMessageHTML` dispatch. Both stay until the
 * effect-trigger and chat-dispatch groups move.
 *
 * The config lives in `combat/WeaponBonusConfig.mjs` rather than here — weapon
 * macro settings are stored inside the `weaponBonus` flag namespace and are
 * edited on that tab, so the reader belongs with the writer.
 */

/**
 * Execute a weapon's Item Macro
 * @param {Item} weapon - The weapon item
 * @param {Actor} actor - The actor using the weapon
 * @param {string} trigger - The trigger type (beforeAttack, onHit, onCritical, onMiss, onCriticalMiss, onEquip, onUnequip)
 * @param {Object} context - Additional context for the macro
 */
export async function executeWeaponItemMacro(weapon, actor, trigger, context = {}) {
	// Check if the weapon has a macro
	if (!hasItemMacro(weapon)) return;

	// Get the weapon item macro config
	const macroConfig = getWeaponItemMacroConfig(weapon);
	if (!macroConfig.enabled) return;

	// Verify the trigger is enabled
	if (!macroConfig.triggers.includes(trigger)) return;

	// Build context for the macro
	const macroContext = {
		...context,
		actor,
		trigger,
		args: context.args ?? []
	};

	return executeItemMacro(weapon, macroContext);
}
