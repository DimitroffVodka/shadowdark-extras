import { MODULE_ID } from "../shared/module-id.mjs";
import { getWeaponItemMacroConfig } from "../combat/WeaponBonusConfig.mjs";
import { getMacroExecuteSocket } from "./macro-socket.mjs";
import { executeWeaponItemMacro } from "./weapon-item-macros.mjs";

/**
 * The `macroExecute` effect trigger system: run a named world Macro when a
 * round starts or ends, when an effect is created or deleted, or when an item
 * is equipped or unequipped.
 *
 * Extracted from the composition root in Phase 3. This is the last item-macro
 * group to leave it. Unlike the four execution paths it does not run an item's
 * own script — it looks up a Macro document by name from a
 * `flags.<module>.macroExecute` value shaped `"macroName|trigger"`, on the
 * actor, on its effects, and on its items' effects.
 *
 * ## Why `checkEffectRequirements` is a parameter
 *
 * The equip/unequip hook does three things in one handler: fire macroExecute
 * triggers, fire the weapon onEquip/onUnequip macro, and re-evaluate source
 * requirements so effects enable and disable with the item. The third belongs
 * to the source-requirement group, which is still in the root and has seven
 * other call sites there.
 *
 * Splitting the handler is not free — the three run sequentially inside one
 * awaited handler, and two `Hooks.on("updateItem")` registrations would run
 * concurrently instead. Importing the helper back from the root would add a
 * root-and-back cycle, which is what Phase 3 exists to remove. So the root
 * hands it in, the same way it hands the socket to the socket registrars.
 *
 * This is an interim seam. When the source-requirement group moves to
 * `effects/`, replace the parameter with an import and delete this note.
 */

/**
 * Parse macro value and execute the macro
 * @param {Actor} actor - The actor on which to execute the macro
 * @param {string} macroValue - The value in format "macroName|trigger" or just "macroName"
 * @param {string} currentTrigger - The trigger that is currently executing
 * @param {Object} options - Additional context options
 * @param {Item} options.item - The item that has the effect (if applicable)
 * @param {ActiveEffect} options.effect - The effect that triggered the macro (if applicable)
 */
async function executeMacroFromEffect(actor, macroValue, currentTrigger, options = {}) {
	if (!macroValue || macroValue === "REPLACEME") return;

	// Parse the value format: "macroName|trigger"
	let macroName, trigger;
	if (macroValue.includes("|")) {
		[macroName, trigger] = macroValue.split("|").map(s => s.trim());
	} else {
		// No trigger specified, default to effectCreated
		macroName = macroValue.trim();
		trigger = "effectCreated";
	}

	// Check if this trigger matches the current trigger
	if (trigger !== currentTrigger) return;

	// Find the macro by name
	const macro = game.macros.find(m => m.name === macroName);
	if (!macro) {
		console.warn(`${MODULE_ID} | Macro "${macroName}" not found for macro.execute effect`);
		return;
	}

	// Check permissions - only execute if user owns the actor or is GM
	if (!actor.isOwner && !game.user.isGM) {
		//console.log(`${MODULE_ID} | User does not have permission to execute macro for actor ${actor.name}`);
		return;
	}

	try {
		//console.log(`${MODULE_ID} | Executing macro "${macroName}" for actor ${actor.name} on trigger "${currentTrigger}"`);

		// Get the actor's token (if available on canvas)
		const token = actor.token || canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);

		// Build the context object to pass to the macro
		const context = {
			actor,           // The actor that has the effect
			token,           // The token representing the actor (if on canvas)
			trigger: currentTrigger,  // The trigger type (roundStart, itemEquipped, etc.)
			item: options.item,       // The item that has the effect (if applicable)
			effect: options.effect,   // The active effect (if applicable)
		};

		// Use socketlib for GM execution if available, otherwise execute locally
		const macroExecuteSocket = getMacroExecuteSocket();
		if (macroExecuteSocket && !game.user.isGM) {
			// Serialize context data for socket transmission
			const contextData = {
				actorUuid: actor.uuid,
				tokenUuid: token?.document?.uuid,
				trigger: currentTrigger,
				itemUuid: options.item?.uuid,
				effectUuid: options.effect?.uuid,
			};

			// Execute macro as GM via socketlib
			//console.log(`${MODULE_ID} | Executing macro via GM (socketlib)`);
			await macroExecuteSocket.executeAsGM("executeMacroAsGM", macro.id, contextData);
		} else {
			// Execute locally (either user is GM or socketlib not available)
			await macro.execute(context);
		}
	} catch (error) {
		console.error(`${MODULE_ID} | Error executing macro "${macroName}":`, error);
		ui.notifications.error(`Failed to execute macro "${macroName}": ${error.message}`);
	}
}

/**
 * Check actor for macro execute effects and run them for the given trigger
 * @param {Actor} actor - The actor to check for macro execute effects
 * @param {string} trigger - The trigger type (roundStart, roundEnd, etc.)
 */
async function checkAndExecuteMacros(actor, trigger) {
	if (!actor) return;

	// Get the macro execute flag value
	const macroValue = actor.getFlag?.(MODULE_ID, "macroExecute");
	if (macroValue) {
		await executeMacroFromEffect(actor, macroValue, trigger);
	}

	// Also check all active effects for macro execute
	for (const effect of actor.effects || []) {
		const effectMacroValue = effect.flags?.[MODULE_ID]?.macroExecute;
		if (effectMacroValue) {
			await executeMacroFromEffect(actor, effectMacroValue, trigger, { effect });
		}
	}

	// Also check all items for macro execute effects
	for (const item of actor.items || []) {
		const itemMacroValue = item.getFlag?.(MODULE_ID, "macroExecute");
		if (itemMacroValue) {
			await executeMacroFromEffect(actor, itemMacroValue, trigger, { item });
		}

		// Check item's active effects
		for (const effect of item.effects || []) {
			const effectMacroValue = effect.flags?.[MODULE_ID]?.macroExecute;
			if (effectMacroValue) {
				await executeMacroFromEffect(actor, effectMacroValue, trigger, { item, effect });
			}
		}
	}
}

/**
 * Register the five macroExecute trigger hooks. The composition root calls this
 * at the source position the first of them occupied.
 *
 * @param {object} deps
 * @param {(actor: Actor) => Promise<void>} deps.checkEffectRequirements - see
 *   the module note; supplied by the root until the source-requirement group
 *   moves out of it.
 */
export function registerEffectTriggerHooks({ checkEffectRequirements }) {
	// Hook: Combat turn start (roundStart)
	Hooks.on("combatTurn", async (combat, updateData, updateOptions) => {
		// Only execute for the active combatant at the start of their turn
		const combatant = combat.combatant;
		if (!combatant?.actor) return;

		// Only execute on the user who owns the combatant
		if (combatant.actor.isOwner) {
			await checkAndExecuteMacros(combatant.actor, "roundStart");
		}
	});

	// Hook: Combat turn end (roundEnd) - this fires before the next turn
	Hooks.on("combatTurn", async (combat, updateData, updateOptions) => {
		// Get the previous combatant (whose turn just ended)
		const prevTurn = updateData.turn - 1;
		if (prevTurn >= 0 && prevTurn < combat.turns.length) {
			const prevCombatant = combat.turns[prevTurn];
			if (prevCombatant?.actor && prevCombatant.actor.isOwner) {
				await checkAndExecuteMacros(prevCombatant.actor, "roundEnd");
			}
		}
	});

	// Hook: Effect created (effectCreated)
	Hooks.on("createActiveEffect", async (effect, options, userId) => {
		// Only execute for the user who created the effect
		if (userId !== game.user.id) return;

		const actor = effect.parent;
		if (!actor) return;

		// Check if this specific effect has macro execute
		const macroValue = effect.flags?.[MODULE_ID]?.macroExecute;
		if (macroValue) {
			await executeMacroFromEffect(actor, macroValue, "effectCreated", { effect });
		}
	});

	// Hook: Effect deleted (effectDeleted)
	Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
		// Only execute for the user who deleted the effect
		if (userId !== game.user.id) return;

		const actor = effect.parent;
		if (!actor) return;

		// Check if this specific effect has macro execute
		const macroValue = effect.flags?.[MODULE_ID]?.macroExecute;
		if (macroValue) {
			await executeMacroFromEffect(actor, macroValue, "effectDeleted", { effect });
		}
	});

	// Hook: Item equipped/unequipped (itemEquipped, itemUnequipped)
	Hooks.on("updateItem", async (item, changes, options, userId) => {
		// Only execute for the user who made the change
		if (userId !== game.user.id) return;

		const actor = item.parent;
		if (!actor) return;

		// Check if equipped status changed
		if (changes.system?.equipped !== undefined) {
			const nowEquipped = changes.system.equipped;
			const trigger = nowEquipped ? "itemEquipped" : "itemUnequipped";

			// Check if this item has macro execute
			const macroValue = item.getFlag?.(MODULE_ID, "macroExecute");
			if (macroValue) {
				await executeMacroFromEffect(actor, macroValue, trigger, { item });
			}

			// Also check item's effects
			for (const effect of item.effects || []) {
				const effectMacroValue = effect.flags?.[MODULE_ID]?.macroExecute;
				if (effectMacroValue) {
					await executeMacroFromEffect(actor, effectMacroValue, trigger, { item, effect });
				}
			}

			// Check for weapon item macro triggers (onEquip/onUnequip)
			if (item.type === "Weapon") {
				const macroConfig = getWeaponItemMacroConfig(item);
				if (macroConfig.enabled) {
					const weaponTrigger = nowEquipped ? "onEquip" : "onUnequip";
					if (macroConfig.triggers.includes(weaponTrigger)) {
						await executeWeaponItemMacro(item, actor, weaponTrigger, {});
					}
				}
			}

			// Check if any effects on this item require equipped status
			// Trigger requirement checks to enable/disable effects based on equipped status
			if (actor instanceof Actor) {
				//console.log(`${MODULE_ID} | Item "${item.name}" equipped status changed to ${nowEquipped}, checking effect requirements`);
				await checkEffectRequirements(actor);
			}
		}
	});
}
