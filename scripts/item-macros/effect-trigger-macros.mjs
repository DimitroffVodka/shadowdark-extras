import { MODULE_ID } from "../shared/module-id.mjs";
import { getWeaponItemMacroConfig } from "../combat/WeaponBonusConfig.mjs";
import { checkEffectRequirements } from "../effects/source-requirements.mjs";
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
 * The equip/unequip hook does three things in one awaited handler: fire
 * macroExecute triggers, fire the weapon onEquip/onUnequip macro, and
 * re-evaluate source requirements so effects enable and disable with the item.
 * The third belongs to `effects/source-requirements.mjs` and is imported from
 * there. It was briefly passed in as a parameter, while that group was still in
 * the composition root and importing it would have meant a root-and-back cycle.
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
	let macroName; let trigger;
	if (macroValue.includes("|")) {
		[macroName, trigger] = macroValue.split("|").map(s => s.trim());
	}
	else {
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
		return;
	}

	try {

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
			await macroExecuteSocket.executeAsGM("executeMacroAsGM", macro.id, contextData);
		}
		else {
			// Execute locally (either user is GM or socketlib not available)
			await macro.execute(context);
		}
	}
	catch (error) {
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
 * Register the GM-side handler for `macroExecute` triggers routed off a player
 * client — the other end of the `executeAsGM("executeMacroAsGM", …)` call in
 * `executeMacroFromEffect` above.
 *
 * It ran a Foundry Macro document rather than an item macro, so it never
 * belonged with the item-macro engine; it lived there only because it shared
 * the socket. It follows its sender here now that the sender has moved.
 *
 * The socket is passed in rather than fetched, so the root's single socket hook
 * stays the one place registration order is decided. The root calls this before
 * registerItemMacroSocket(), which is the order these two were registered in.
 *
 * @param {object} socket - The module's socketlib socket.
 */
export function registerEffectMacroSocket(socket) {
	// Register the GM execution handler
	socket.register("executeMacroAsGM", async function(macroId, contextData) {
		// This runs on the GM's client
		const sender = game.users.get(this.socketdata?.userId);
		if (!sender) return;

		// Reconstruct actor to check ownership
		const actor = contextData.actorUuid ? await fromUuid(contextData.actorUuid) :
					 (contextData.actorId ? game.actors.get(contextData.actorId) : null);

		if (!sender.isGM && (!actor || !actor.testUserPermission(sender, "OWNER"))) {
			console.warn(`${MODULE_ID} | Unauthorized macro execution attempt from user ${sender.name}`);
			return;
		}

		const macro = game.macros.get(macroId);
		if (!macro) {
			console.warn(`${MODULE_ID} | Macro with ID "${macroId}" not found`);
			return;
		}

		// Reconstruct the context from the serialized data
		const context = {
			actor: actor,
			token: contextData.tokenUuid ? (await fromUuid(contextData.tokenUuid))?.object : undefined,
			trigger: contextData.trigger,
			item: contextData.itemUuid ? await fromUuid(contextData.itemUuid) : undefined,
			effect: contextData.effectUuid ? await fromUuid(contextData.effectUuid) : undefined,
		};

		// Execute the macro as GM
		await macro.execute(context);
	});
}

/**
 * Register the five macroExecute trigger hooks. The composition root calls this
 * at the source position the first of them occupied.
 */
export function registerEffectTriggerHooks() {
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
				await checkEffectRequirements(actor);
			}
		}
	});
}
