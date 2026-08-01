import { MODULE_ID } from "../shared/module-id.mjs";
import { spawnSummonedCreatures } from "../combat/CombatSettingsSD.mjs";
import { hasItemMacro, executeItemMacro } from "./item-macro-engine.mjs";

/**
 * NPC Feature item macro and activity execution.
 *
 * Extracted from the composition root in Phase 3. The feature map puts NPC
 * *sheets* under `npc/` and NPC-feature macro *execution* here with the other
 * three execution paths, which is what this is.
 *
 * Two `ready` hooks drive it, both patching prototypes after a 100ms delay:
 * `Item#rollItem`, because SD 4.x does not reliably provide one for NPC
 * Feature / NPC Spell / NPC Special Attack; and `NpcSheetSD#_displayFeature`,
 * because the system's NPC sheet posts those cards through
 * `shadowdark.chat.showItemCard` and bypasses `rollItem` entirely.
 *
 * A third registration was dropped in the move: an empty
 * `Hooks.once("ready", () => { /* Redundant handler removed *\/ })` left behind
 * by an earlier cleanup. An empty callback has no behaviour, so removing it is
 * not a change — it just stops the registration snapshot counting a hook that
 * does nothing.
 *
 * **Dead code carried over deliberately.** `processNPCFeatureDamage` and
 * `processNPCFeatureEffects` are unreachable: their only call sites inside
 * `processNPCFeatureActivities` are commented out, with the reasoning left in
 * place — both were superseded by `injectDamageCard`, which handles Challenge
 * Mode. That is ~140 lines of unreachable code. Deleting it is a decision about
 * whether the two-card style is ever coming back, not part of a move, so it
 * travels as-is.
 */

/**
 * Execute the item macro for an NPC Feature when used
 * @param {Item} item - The NPC Feature item
 * @param {Actor} actor - The actor using the item
 * @param {Object} context - Additional context
 */
async function executeNPCFeatureItemMacro(item, actor, context = {}) {
	// Check if the item has a macro
	if (!hasItemMacro(item)) return;

	// Check if the item has a macro and if executeOnUse is enabled
	const macroConfig = item.getFlag(MODULE_ID, "itemMacro") || {};
	const executeOnUse = macroConfig.executeOnUse ?? true;

	if (!executeOnUse) return;

	// Build context for the macro
	const macroContext = {
		...context,
		actor,
		args: context.args ?? [],
	};

	return executeItemMacro(item, macroContext);
}

/**
 * Process NPC Feature activities (damage, effects, summoning, item give)
 * @param {Item} item - The NPC Feature item
 * @param {Actor} actor - The actor using the item
 * @param {Token} token - The token using the item (optional)
 */
async function processNPCFeatureActivities(item, actor, token) {
	const flags = item.flags?.[MODULE_ID] || {};
	const spellDamage = flags.spellDamage || {};
	const summoning = flags.summoning || {};
	const itemGive = flags.itemGive || {};

	// Get targets
	const targets = Array.from(game.user?.targets || []);
	const targetToken = targets[0] || null;
	const targetActor = targetToken?.actor || null;

	// 1. Process Damage/Healing
	// 1. Process Damage/Healing
	// If automatic damage card is enabled (CombatSettingsSD), we SKIP manual processing here
	// to avoid double-rolling. injectDamageCard will pick up the Item Card and add the damage.
	// We only keep this for legacy or if the module setting is disabled?
	// For now, let's assume if it has spellDamage enabled, we rely on injectDamageCard
	// BUT wait, injectDamageCard needs the flags. The item has flags.
	// So we can just COMMENT OUT or conditionally skip this.

	// Check if this item type is handled by injectDamageCard (NPC Feature, NPC Spell)
	// And if damage is enabled.
	if (spellDamage.enabled) {
		// Only run legacy processing if it's NOT likely to be picked up by injectDamageCard
		// OR if we want to explicitly support the "Two Card" style (Description + Roll).
		// The user wants "Healing" to work. injectDamageCard logic is superior (Challenge Mode etc).
		// So we want injectDamageCard to win.
		// If we skip this, we get NO second card. injectDamageCard MUST pick up the first card.
		// The first card is the Item Card.

		// Let's check if we should skip.
		// For now, I will Comment it out for NPC Spell/Feature to rely on the new system.
		// await processNPCFeatureDamage(item, actor, token, targetToken, targetActor, spellDamage);
		console.log(`${MODULE_ID} | processNPCFeatureActivities | Skipping manual damage roll, relying on injectDamageCard`);
	}

	// 2. Process Effects - REMOVED
	// We now handle effects via the chat card logic (injectDamageCard) to support Challenge Mode
	/*
	const effects = spellDamage.effects || [];
	if (effects.length > 0) {
		await processNPCFeatureEffects(item, actor, token, targetToken, targetActor, spellDamage);
	}
	*/

	// 3. Process Summoning
	const summoningProfiles = Array.isArray(summoning.profiles)
		? summoning.profiles
		: (summoning.profiles && typeof summoning.profiles === "object" ? Object.values(summoning.profiles) : []);
	if (summoning.enabled && summoningProfiles.length > 0) {
		await processNPCFeatureSummoning(item, actor, token, { ...summoning, profiles: summoningProfiles });
	}

	// 4. Process Item Give
	if (itemGive.enabled && itemGive.profiles?.length > 0) {
		await processNPCFeatureItemGive(item, actor, token, targetToken, targetActor, itemGive);
	}
}

/**
 * Process damage/healing for NPC Feature
 */
async function processNPCFeatureDamage(item, actor, token, targetToken, targetActor, spellDamage) {
	// Note: We always roll and show the chat card
	// Target is only needed if auto-apply damage is enabled (handled elsewhere)

	// Build the damage formula
	let formula = "";
	const formulaType = spellDamage.formulaType || "basic";

	if (formulaType === "basic") {
		const numDice = spellDamage.numDice || 1;
		const dieType = spellDamage.dieType || "d6";
		const bonus = parseInt(spellDamage.bonus) || 0;
		formula = `${numDice}${dieType}`;
		if (bonus !== 0) {
			formula += bonus > 0 ? `+${bonus}` : `${bonus}`;
		}
	} else if (formulaType === "formula") {
		formula = spellDamage.formula || "1d6";
	} else if (formulaType === "tiered") {
		// Parse tiered formula like "1-3:1d6, 4-6:2d8, 7+:3d10"
		const level = actor.system?.level?.value || 1;
		const tieredFormula = spellDamage.tieredFormula || "";
		const tiers = tieredFormula.split(",").map(t => t.trim());

		for (const tier of tiers) {
			const [range, tierFormula] = tier.split(":").map(s => s.trim());
			if (range.includes("-")) {
				const [min, max] = range.split("-").map(n => parseInt(n));
				if (level >= min && level <= max) {
					formula = tierFormula;
					break;
				}
			} else if (range.includes("+")) {
				const min = parseInt(range.replace("+", ""));
				if (level >= min) {
					formula = tierFormula;
					break;
				}
			}
		}
		if (!formula) formula = "1d6"; // Fallback
	}

	// Roll the damage
	const roll = await new Roll(formula).evaluate();
	const damageType = spellDamage.damageType || "";
	const isHealing = damageType === "Healing";

	// Create chat message for the roll
	const flavor = isHealing
		? `${item.name} heals for`
		: `${item.name} deals${damageType ? " " + damageType : ""} damage`;
	const escapedItemImg = foundry.utils.escapeHTML(item.img ?? "");
	const escapedItemName = foundry.utils.escapeHTML(item.name);

	// Create chat card HTML with the required data attributes for injectDamageCard
	const rollHtml = await roll.render();
	const content = `
		<div class="shadowdark chat-card item-card" data-actor-id="${actor.id}" data-item-id="${item.id}">
			<header class="card-header flexrow">
				<img src="${escapedItemImg}" data-tooltip="${escapedItemName}"/>
				<h3 class="item-name">${escapedItemName}</h3>
			</header>
			<div class="card-content">
				<h4 class="damage-roll-header">${flavor}</h4>
				${rollHtml}
			</div>
		</div>
	`;

	// Create the chat message with roll data
	await ChatMessage.create({
		content: content,
		speaker: ChatMessage.getSpeaker({ actor }),
		rolls: [roll],
		flags: {
			"shadowdark": {
				itemId: item.uuid,
				isHealing: isHealing,
				rollType: "damage",
			},
			[MODULE_ID]: {
				itemConfig: {
					name: item.name,
					type: item.type,
					spellDamage: item.flags?.[MODULE_ID]?.spellDamage,
				},
			},
		},
	});

	// Note: Damage/healing is NOT auto-applied here

	// Users can use chat card buttons or auto-apply settings to apply damage
}

/**
 * Process effects for NPC Feature
 */
async function processNPCFeatureEffects(item, actor, token, targetToken, targetActor, spellDamage) {
	const effectsApplyToSelf = spellDamage.effectsApplyToTarget === false || spellDamage.effectsApplyToTarget === "false";
	const recipient = effectsApplyToSelf ? actor : targetActor;

	if (!recipient) {
		if (!effectsApplyToSelf) {
			ui.notifications.warn("No target selected for effects");
		}
		return;
	}

	const effects = spellDamage.effects || [];
	const selectionMode = spellDamage.effectSelectionMode || "all";

	// Determine which effects to apply
	let effectsToApply = [...effects];

	if (selectionMode === "random" && effectsToApply.length > 1) {
		const randomIndex = Math.floor(Math.random() * effectsToApply.length);
		effectsToApply = [effectsToApply[randomIndex]];
	} else if (selectionMode === "prompt" && effectsToApply.length > 1) {
		// For now, just apply all - prompt could be added later
		// effectsToApply = effectsToApply;
	}

	// Apply each effect
	for (const effectData of effectsToApply) {
		const effectUuid = typeof effectData === "string" ? effectData : effectData.uuid;
		if (!effectUuid) continue;

		try {
			const effectDoc = await fromUuid(effectUuid);
			if (!effectDoc) continue;

			// Create a copy of the effect for the recipient
			const effectDataObj = effectDoc.toObject();
			delete effectDataObj._id;

			await recipient.createEmbeddedDocuments("Item", [effectDataObj]);
			ui.notifications.info(`Applied ${effectDoc.name} to ${recipient.name}`);
		} catch (err) {
			console.error(`${MODULE_ID} | Failed to apply effect ${effectUuid}:`, err);
		}
	}
}

/**
 * Process summoning for NPC Feature
 */
async function processNPCFeatureSummoning(item, actor, token, summoning) {
	const profiles = Array.isArray(summoning.profiles)
		? summoning.profiles
		: (summoning.profiles && typeof summoning.profiles === "object" ? Object.values(summoning.profiles) : []);
	if (profiles.length === 0) return;

	// Use the same summoning logic as spells (Portal library)
	await spawnSummonedCreatures(actor, item, profiles, summoning, false);
}

/**
 * Process item give for NPC Feature
 */
async function processNPCFeatureItemGive(item, actor, token, targetToken, targetActor, itemGive) {
	const recipient = targetActor;

	if (!recipient) {
		ui.notifications.warn("No target selected to give items to");
		return;
	}

	const profiles = itemGive.profiles || [];

	for (const profile of profiles) {
		if (!profile.itemUuid) continue;

		try {
			const itemDoc = await fromUuid(profile.itemUuid);
			if (!itemDoc) continue;

			const quantity = parseInt(profile.quantity) || 1;

			// Create item data
			const itemData = itemDoc.toObject();
			delete itemData._id;

			// Set quantity if applicable
			if (itemData.system?.quantity !== undefined) {
				itemData.system.quantity = quantity;
			}

			await recipient.createEmbeddedDocuments("Item", [itemData]);
			ui.notifications.info(`Gave ${quantity}x ${itemDoc.name} to ${recipient.name}`);
		} catch (err) {
			console.error(`${MODULE_ID} | Failed to give item:`, err);
		}
	}
}

/**
 * Register the NPC Feature prototype patches. The composition root calls this at
 * the source position these two registrations occupied.
 */
export function registerNPCFeatureItemMacros() {
	// SD 4.x may not provide Item#rollItem/displayCard for NPC Features/Spells/
	// Special Attacks. Install a small rollItem path so sheet/tool callers can run
	// their configured macros + activities on use.
	Hooks.once("ready", () => {
		// Wait a short time to ensure the system is fully loaded
		setTimeout(() => {
			const itemDocClass = CONFIG.Item.documentClass;
			if (!itemDocClass?.prototype) {
				console.warn(`${MODULE_ID} | Item document class not found, cannot patch NPC Feature macro execution`);
				return;
			}
			if (itemDocClass.prototype.__sdxNpcFeatureMacroPatched) return;
			itemDocClass.prototype.__sdxNpcFeatureMacroPatched = true;

			const originalRollItem = itemDocClass.prototype.rollItem;

			itemDocClass.prototype.rollItem = async function(...args) {
				// Call the original (possibly already-wrapped) rollItem first, when
				// the current Shadowdark system version provides one.
				const result = typeof originalRollItem === "function"
					? await originalRollItem.apply(this, args)
					: null;

				// Only process NPC Features, NPC Spells, and NPC Special Attacks.
				if (this.type === "NPC Feature" || this.type === "NPC Spell" || this.type === "NPC Special Attack") {
					try {
						const actor = this.actor;
						const selectedTokens = canvas.tokens?.controlled || [];
						const token = selectedTokens.find(t => t.actor?.id === actor?.id) || null;
						await executeNPCFeatureItemMacro(this, actor, {});
						await processNPCFeatureActivities(this, actor, token);
					} catch (err) {
						console.error(`${MODULE_ID} | NPC Feature macro/activity execution failed:`, err);
					}
				}
				return result;
			};

			console.log(`${MODULE_ID} | Patched Item.rollItem for NPC Feature macro and activity execution`);

		}, 100);
	});

	// Shadowdark's NPC sheet displays NPC Feature / Special Attack cards directly via
	// shadowdark.chat.showItemCard(item.uuid), bypassing Item#rollItem. Route those
	// clicks through rollItem so SDX macro/effect/summon activity hooks run too.
	Hooks.once("ready", () => {
		setTimeout(() => {
			const npcSheetClass = globalThis.shadowdark?.applications?.NpcSheetSD
				|| globalThis.shadowdark?.applications?.sheets?.NpcSheetSD
				|| Object.values(CONFIG.Actor.sheetClasses?.NPC || {})
					.map(entry => entry?.cls)
					.find(cls => cls?.name === "NpcSheetSD");

			if (!npcSheetClass?.prototype?._displayFeature) {
				console.warn(`${MODULE_ID} | NpcSheetSD._displayFeature not found, cannot patch NPC sheet feature activity execution`);
				return;
			}
			if (npcSheetClass.prototype.__sdxNpcSheetFeatureActivityPatched) return;
			npcSheetClass.prototype.__sdxNpcSheetFeatureActivityPatched = true;

			const originalDisplayFeature = npcSheetClass.prototype._displayFeature;
			npcSheetClass.prototype._displayFeature = async function(event) {
				event?.preventDefault?.();
				const itemId = event?.currentTarget?.dataset?.itemId;
				const item = itemId ? this.actor?.items?.get(itemId) : null;
				if (
					item
					&& ["NPC Feature", "NPC Spell", "NPC Special Attack"].includes(item.type)
					&& typeof item.rollItem === "function"
				) {
					return item.rollItem(null, { actor: this.actor, item }, {});
				}
				return originalDisplayFeature.call(this, event);
			};

			console.log(`${MODULE_ID} | Patched NpcSheetSD._displayFeature for NPC Feature activity execution`);
		}, 100);
	});
}
