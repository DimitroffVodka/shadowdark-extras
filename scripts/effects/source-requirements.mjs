import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * Source requirements for Active Effects.
 *
 * Extracted from the composition root in Phase 3. An effect may carry a
 * `sourceRequirement` expression and/or a `requireEquipped` flag; this module
 * evaluates them and drives the effect's `disabled` state to match, on effect
 * create/update, actor update, sheet render, and item transfer.
 *
 * Three behaviours are load-bearing and easy to break:
 *
 * - **`byRequirementSystem`.** Every update this module makes passes that
 *   option, and the update hook ignores changes carrying it. Without the flag
 *   the system would react to its own writes.
 * - **`manualOverride`.** Disabling an effect whose requirement *is* met is a
 *   deliberate user choice and is recorded, so later checks leave it alone. The
 *   override is one-directional: enabling an effect whose requirement is not
 *   met is refused and reverted. It is cleared when the requirement or
 *   `requireEquipped` changes, and when an item moves to a new actor — the
 *   override belonged to the previous owner.
 * - **The transferred-effect indirection.** An effect on an actor that has no
 *   requirement of its own may have been transferred from an item; the source
 *   effect is resolved through `effect.origin` and it is the *source* whose
 *   `disabled` state is toggled, so the change propagates.
 *
 * `evaluateSourceRequirement` builds a `new Function` over a fixed context
 * rather than using `Roll.safeEval`, because requirements are string
 * comparisons against ancestry/class/background/alignment, not dice formulas.
 * That is a deliberate trade recorded in the code below.
 */

/**
 * Safely evaluates a source requirement expression
 * @param {string} requirement - JavaScript expression to evaluate
 * @param {Actor} actor - The actor being evaluated
 * @param {Token} token - The token being evaluated (if available)
 * @returns {Promise<boolean>} - Whether the requirement is met
 */
async function evaluateSourceRequirement(requirement, actor, token = null, sourceEffect = null) {
	// Check if the effect requires the parent item to be equipped
	if (sourceEffect) {
		const requireEquipped = sourceEffect.getFlag(MODULE_ID, "requireEquipped");
		if (requireEquipped) {
			// Check if the effect's parent is an Item
			const parentItem = sourceEffect.parent;
			if (parentItem && parentItem instanceof Item) {
				// Check if the item has an equipped property
				const isEquipped = parentItem.system?.equipped;
				//console.log(`${MODULE_ID} | Effect "${sourceEffect.name}" requires equipped. Item "${parentItem.name}" equipped: ${isEquipped}`);

				// If not equipped, the requirement is not met
				if (!isEquipped) {
					//console.log(`${MODULE_ID} | Effect "${sourceEffect.name}" requirement NOT MET - item not equipped`);
					return false;
				}
			}
		}
	}

	if (!requirement || requirement.trim() === "") return true;

	try {
		// Resolve Compendium UUIDs to get actual names/keys
		let ancestryName = "";
		let className = "";
		let backgroundName = "";

		// Resolve ancestry
		if (actor?.system?.ancestry) {
			try {
				const ancestryDoc = await fromUuid(actor.system.ancestry);
				if (ancestryDoc) {
					ancestryName = ancestryDoc.name?.toLowerCase() ?? "";
				}
			}
			catch (e) {
				console.warn(`${MODULE_ID} | Could not resolve ancestry UUID`);
			}
		}

		// Resolve class
		if (actor?.system?.class) {
			try {
				const classDoc = await fromUuid(actor.system.class);
				if (classDoc) {
					className = classDoc.name?.toLowerCase() ?? "";
				}
			}
			catch (e) {
				console.warn(`${MODULE_ID} | Could not resolve class UUID`);
			}
		}

		// Resolve background
		if (actor?.system?.background) {
			try {
				const backgroundDoc = await fromUuid(actor.system.background);
				if (backgroundDoc) {
					backgroundName = backgroundDoc.name?.toLowerCase() ?? "";
				}
			}
			catch (e) {
				console.warn(`${MODULE_ID} | Could not resolve background UUID`);
			}
		}

		// Create a safe evaluation context
		const context = {
			actor: actor,
			token: token,
			// Add commonly used shortcuts
			level: actor?.system?.level?.value ?? 0,
			attributes: actor?.system?.attributes ?? {},
			abilities: actor?.system?.abilities ?? {},
			// Add shortcuts with resolved names (lowercase for easy matching)
			ancestry: ancestryName,
			charClass: className,
			background: backgroundName,
			alignment: (actor?.system?.alignment ?? "").toLowerCase(),
		};

		//console.log(`${MODULE_ID} | Evaluating requirement: "${requirement}"`);
		//console.log(`${MODULE_ID} | Actor: ${actor.name} (Level ${context.level})`);
		//console.log(`${MODULE_ID} | Resolved names - ancestry: "${context.ancestry}", class: "${context.charClass}", background: "${context.background}", alignment: "${context.alignment}"`);

		// Requirements support string comparisons and actor/token property access.
		// Roll.safeEval is numeric-only, so keep the existing scoped expression evaluator.
		const fn = new Function(...Object.keys(context), `return ${requirement};`);
		const result = fn(...Object.values(context));

		//console.log(`${MODULE_ID} | Requirement "${requirement}" evaluated to: ${result}`);

		return Boolean(result);
	}
	catch (error) {
		console.error(`${MODULE_ID} | Error evaluating source requirement "${requirement}":`, error);
		return false;
	}
}

/**
 * Check and update effect disabled state based on requirements
 */
export async function checkEffectRequirements(actor) {
	//console.log(`${MODULE_ID} | checkEffectRequirements called for actor: ${actor.name}`);
	//console.log(`${MODULE_ID} | Total effects on actor: ${actor.effects.size}`);
	//console.log(`${MODULE_ID} | Total items on actor: ${actor.items.size}`);

	// Debug: log all effects and their flags
	for (const effect of actor.effects) {
		const requirement = effect.getFlag(MODULE_ID, "sourceRequirement");
		const origin = effect.origin || "Unknown";
		const isTransferred = effect.transfer;
		//console.log(`${MODULE_ID} | Effect "${effect.name}" (origin: ${origin}, transferred: ${isTransferred}) - requirement: "${requirement}" - flags:`, effect.flags);
	}

	const effectsToCheck = [];

	// Check effects directly on the actor
	for (const effect of actor.effects) {
		let requirement = effect.getFlag(MODULE_ID, "sourceRequirement");
		let requireEquipped = effect.getFlag(MODULE_ID, "requireEquipped");
		let sourceEffect = effect;

		// If this is a transferred effect and it doesn't have a requirement, check the source item
		if ((!requirement && !requireEquipped) && effect.origin) {
			try {
				// Parse the origin to get the source document
				const originDoc = await fromUuid(effect.origin);
				if (originDoc && originDoc instanceof ActiveEffect) {
					requirement = originDoc.getFlag(MODULE_ID, "sourceRequirement");
					requireEquipped = originDoc.getFlag(MODULE_ID, "requireEquipped");
					sourceEffect = originDoc;
					//console.log(`${MODULE_ID} | Effect "${effect.name}" is transferred, checking source effect for requirement: "${requirement}", requireEquipped: ${requireEquipped}`);
				}
			}
			catch (err) {
				//console.log(`${MODULE_ID} | Could not resolve origin for effect "${effect.name}"`);
			}
		}

		// Add to check list if it has a requirement or requireEquipped
		if ((requirement && requirement.trim() !== "") || requireEquipped) {
			effectsToCheck.push({ effect, sourceEffect, requirement });
		}
	}

	// Also check effects on items owned by the actor
	//console.log(`${MODULE_ID} | Checking effects on actor's items...`);
	for (const item of actor.items) {
		for (const effect of item.effects) {
			const requirement = effect.getFlag(MODULE_ID, "sourceRequirement");
			const requireEquipped = effect.getFlag(MODULE_ID, "requireEquipped");
			if ((requirement && requirement.trim() !== "") || requireEquipped) {
				//console.log(`${MODULE_ID} | Found effect "${effect.name}" on item "${item.name}" with requirement: "${requirement}", requireEquipped: ${requireEquipped}`);
				// For item effects, we need to check if they transfer
				if (effect.transfer) {
					effectsToCheck.push({ effect: effect, sourceEffect: effect, requirement });
				}
			}
		}
	}

	//console.log(`${MODULE_ID} | Found ${effectsToCheck.length} effects with requirements`);

	if (effectsToCheck.length === 0) return;

	const token = actor.token?.object || actor.getActiveTokens()[0];

	for (const { effect, sourceEffect, requirement } of effectsToCheck) {
		//console.log(`${MODULE_ID} | Checking effect "${effect.name}" (currently disabled: ${sourceEffect.disabled})`);

		// Check for manual override
		const manualOverride = sourceEffect.getFlag(MODULE_ID, "manualOverride");
		if (manualOverride !== undefined && manualOverride !== null) {
			//console.log(`${MODULE_ID} | Effect "${effect.name}" has manual override (disabled: ${manualOverride}), skipping automatic requirement check`);
			continue;
		}

		const requirementMet = await evaluateSourceRequirement(requirement, actor, token, sourceEffect);

		// Toggle the SOURCE effect's disabled state (this will propagate to transferred effects)
		// Use the byRequirementSystem option to distinguish from manual changes
		if (requirementMet && sourceEffect.disabled) {
			//console.log(`${MODULE_ID} | ENABLING effect "${effect.name}" - requirement met: ${requirement}`);
			await sourceEffect.update({ disabled: false }, { byRequirementSystem: true });
		}
		else if (!requirementMet && !sourceEffect.disabled) {
			//console.log(`${MODULE_ID} | DISABLING effect "${effect.name}" - requirement not met: ${requirement}`);
			await sourceEffect.update({ disabled: true }, { byRequirementSystem: true });
		}
		else {
			//console.log(`${MODULE_ID} | Effect "${effect.name}" already in correct state (disabled: ${sourceEffect.disabled}, requirement met: ${requirementMet})`);
		}
	}
}

/**
 * Register the five source-requirement hooks. The composition root calls this
 * immediately after registerActiveEffectConfigHooks(), which is where the first
 * of them sat — the config hooks must still register first.
 */
export function registerSourceRequirementHooks() {
	/**
	 * Hook to check requirements after effect is updated
	 */
	Hooks.on("updateActiveEffect", async (effect, changes, options, userId) => {
		//console.log(`${MODULE_ID} | updateActiveEffect hook fired for effect: ${effect.name}`);
		//console.log(`${MODULE_ID} | Effect parent type: ${effect.parent?.constructor?.name}`);
		//console.log(`${MODULE_ID} | Effect saved requirement: "${effect.getFlag(MODULE_ID, "sourceRequirement")}"`);

		if (userId !== game.user.id) return;

		// If user manually toggled the disabled state, handle one-directional override
		if (changes.disabled !== undefined && !options.byRequirementSystem) {
			const requirement = effect.getFlag(MODULE_ID, "sourceRequirement");
			if (requirement && requirement.trim() !== "") {
				// Get the actor to evaluate requirements
				const parent = effect.parent;
				const actor = (parent instanceof Item) ? parent.parent : parent;

				if (actor && actor instanceof Actor) {
					const token = actor.token?.object || actor.getActiveTokens()[0];
					const requirementMet = await evaluateSourceRequirement(requirement, actor, token, effect);

					// Only allow manual override when DISABLING an effect that meets requirements
					if (requirementMet && changes.disabled === true) {
						//console.log(`${MODULE_ID} | User manually disabled effect "${effect.name}" (requirements met), setting manual override`);
						await effect.setFlag(MODULE_ID, "manualOverride", true);
					}
					else if (!requirementMet && changes.disabled === false) {
						// Requirements not met, user trying to enable - block it
						//console.log(`${MODULE_ID} | Cannot enable effect "${effect.name}" - requirements not met: ${requirement}`);
						ui.notifications.warn(game.i18n.format("SHADOWDARK_EXTRAS.effects.requirementNotMet", {
							name: effect.name,
							requirement: requirement,
						}));
						// Prevent the enable by re-disabling
						setTimeout(() => {
							effect.update({ disabled: true }, { byRequirementSystem: true });
						}, 0);
					}
				}
			}
		}

		// If the source requirement was updated, check it immediately
		if (changes.flags?.[MODULE_ID]?.sourceRequirement !== undefined) {
			const parent = effect.parent;
			//console.log(`${MODULE_ID} | Source requirement was updated to: "${changes.flags[MODULE_ID].sourceRequirement}"`);

			// Clear manual override when requirement changes
			if (effect.getFlag(MODULE_ID, "manualOverride") !== undefined) {
				await effect.unsetFlag(MODULE_ID, "manualOverride");
			}

			// Check if parent is an item (meaning this is a transferred effect)
			if (parent && parent instanceof Item) {
				//console.log(`${MODULE_ID} | Effect is on an Item, checking the item's actor`);
				const actor = parent.parent;
				if (actor && actor instanceof Actor) {
					//console.log(`${MODULE_ID} | Checking requirements on actor: ${actor.name}`);

					// Add a delay to ensure transferred effects are updated
					setTimeout(async () => {
						await checkEffectRequirements(actor);
					}, 100);
				}
			}
			else if (parent && parent instanceof Actor) {
				//console.log(`${MODULE_ID} | Effect is directly on an Actor`);
				await checkEffectRequirements(parent);
			}
		}

		// If the requireEquipped flag was updated, check it immediately
		if (changes.flags?.[MODULE_ID]?.requireEquipped !== undefined) {
			const parent = effect.parent;
			//console.log(`${MODULE_ID} | requireEquipped was updated to: ${changes.flags[MODULE_ID].requireEquipped}`);

			// Clear manual override when requireEquipped changes
			if (effect.getFlag(MODULE_ID, "manualOverride") !== undefined) {
				await effect.unsetFlag(MODULE_ID, "manualOverride");
			}

			// Check if parent is an item (meaning this is a transferred effect)
			if (parent && parent instanceof Item) {
				//console.log(`${MODULE_ID} | Effect is on an Item, checking the item's actor`);
				const actor = parent.parent;
				if (actor && actor instanceof Actor) {
					//console.log(`${MODULE_ID} | Checking requirements on actor: ${actor.name}`);

					// Add a delay to ensure transferred effects are updated
					setTimeout(async () => {
						await checkEffectRequirements(actor);
					}, 100);
				}
			}
			else if (parent && parent instanceof Actor) {
				//console.log(`${MODULE_ID} | Effect is directly on an Actor`);
				await checkEffectRequirements(parent);
			}
		}
	});

	/**
	 * Hook to check requirements when effect is created
	 */
	Hooks.on("createActiveEffect", async (effect, options, userId) => {
		//console.log(`${MODULE_ID} | createActiveEffect hook fired for effect: ${effect.name}`);

		if (userId !== game.user.id) {
			//console.log(`${MODULE_ID} | Skipping - not our user (userId: ${userId}, game.user.id: ${game.user.id})`);
			return;
		}

		const requirement = effect.getFlag(MODULE_ID, "sourceRequirement");
		const requireEquipped = effect.getFlag(MODULE_ID, "requireEquipped");
		//console.log(`${MODULE_ID} | Effect requirement: "${requirement}", requireEquipped: ${requireEquipped}`);

		if ((!requirement || requirement.trim() === "") && !requireEquipped) {
			//console.log(`${MODULE_ID} | No requirement or requireEquipped set for this effect`);
			return;
		}

		const actor = effect.parent;
		if (!actor || !(actor instanceof Actor)) {
			//console.log(`${MODULE_ID} | No valid actor parent found`);
			return;
		}

		const token = actor.token?.object || actor.getActiveTokens()[0];
		const requirementMet = await evaluateSourceRequirement(requirement, actor, token, effect);

		if (!requirementMet && !effect.disabled) {
			//console.log(`${MODULE_ID} | DISABLING newly created effect "${effect.name}" - requirement not met: ${requirement}`);
			await effect.update({ disabled: true }, { byRequirementSystem: true });
		}
		else {
			//console.log(`${MODULE_ID} | Effect "${effect.name}" - requirementMet: ${requirementMet}, already disabled: ${effect.disabled}`);
		}
	});

	/**
	 * Hook to check requirements when actor is prepared
	 */
	// Source requirements are now handled via updateActor, createItem, and renderActorSheet hooks
	// for better performance and to avoid async updates during data preparation.

	/**
	 * Hook to update effects when actor data changes (e.g., level up)
	 * This re-evaluates effects to see if requirements are now met or unmet
	 */
	Hooks.on("updateActor", async (actor, changes, options, userId) => {
		//console.log(`${MODULE_ID} | updateActor hook fired for actor: ${actor.name}`);

		// Only process on the user who made the update
		if (userId !== game.user.id) {
			//console.log(`${MODULE_ID} | Skipping - not our user`);
			return;
		}

		await checkEffectRequirements(actor);
	});

	/**
	 * Hook to check requirements when actor sheet is rendered
	 * This ensures requirements are enforced when viewing the sheet
	 */
	Hooks.on("renderActorSheet", async (app, html, data) => {
		const actor = app.actor;
		//console.log(`${MODULE_ID} | renderActorSheet hook fired for actor: ${actor?.name}`);

		if (!actor) return;

		// Check requirements after a short delay to ensure data is fully prepared
		setTimeout(async () => {
			//console.log(`${MODULE_ID} | [renderActorSheet setTimeout] Checking requirements for ${actor.name}`);
			await checkEffectRequirements(actor);
		}, 100);
	});

	/**
	 * Hook to check requirements when an item is added to an actor
	 * This ensures transferred items have their effect requirements checked on the new actor
	 */
	Hooks.on("createItem", async (item, options, userId) => {
		//console.log(`${MODULE_ID} | createItem hook fired for item: ${item.name}`);

		if (userId !== game.user.id) return;

		// Check if this item belongs to an actor
		const actor = item.parent;
		if (!actor || !(actor instanceof Actor)) {
			//console.log(`${MODULE_ID} | Item not owned by an actor, skipping`);
			return;
		}

		// Check if this item has any effects with requirements. The filter
		// must also catch effects carrying ONLY the requireEquipped flag —
		// the createActiveEffect hook bails when the effect's parent is an
		// Item, so creation itself never enforced it (issue #51).
		const effectsWithRequirements = item.effects.filter(e => {
			const requirement = e.getFlag(MODULE_ID, "sourceRequirement");
			const requireEquipped = e.getFlag(MODULE_ID, "requireEquipped");
			return (requirement && requirement.trim() !== "") || requireEquipped;
		});

		if (effectsWithRequirements.length === 0) {
			//console.log(`${MODULE_ID} | Item has no effects with requirements, skipping`);
			return;
		}

		//console.log(`${MODULE_ID} | Item "${item.name}" has ${effectsWithRequirements.length} effect(s) with requirements, checking requirements for new owner: ${actor.name}`);

		// Clear manual override flags on transferred item effects
		// The override was for the previous actor, not this new owner
		for (const effect of effectsWithRequirements) {
			const hasOverride = effect.getFlag(MODULE_ID, "manualOverride");
			if (hasOverride !== undefined && hasOverride !== null) {
				//console.log(`${MODULE_ID} | Clearing manual override flag on transferred effect "${effect.name}"`);
				await effect.unsetFlag(MODULE_ID, "manualOverride");
			}
		}

		// Check requirements after a delay to ensure transferred effects are fully created
		setTimeout(async () => {
			await checkEffectRequirements(actor);
		}, 100);
	});
}
