/**
 * Chat-card hooks: stash on create, inject on render.
 *
 * Two halves of one pipeline, moved verbatim out of the composition root.
 * `preCreateChatMessage` records the rolling user's targets (and duration-spell
 * state) onto the message; `renderChatMessageHTML` is the dispatcher that then
 * injects the damage card and the weapon-bonus display onto the rendered card.
 *
 * A new module rather than an addition to `CombatSettingsSD.mjs` or
 * `hit-bonus.mjs` because the render handler dispatches to BOTH of them —
 * `injectDamageCard` from the former, `processWeaponBonuses` from the latter.
 * It belongs to neither, so it sits beside them.
 *
 * `renderChatMessageHTML` is registered several times across the module and
 * `preCreateChatMessage` reads state the render side consumes, so
 * `registerChatCardHooks()` is called from the position these two occupied and
 * relative order is preserved by the call site (handoff rule 2).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { endDurationSpell, getActiveDurationSpells } from "../effects/FocusSpellTrackerSD.mjs";
import { injectDamageCard } from "./CombatSettingsSD.mjs";
import { processWeaponBonuses } from "./hit-bonus.mjs";

export function registerChatCardHooks() {
	// Store original user's targets in chat message flags (for damage cards)
	Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
		try {
			// Get current user's targets
			const targets = Array.from(game.user.targets || []);
			if (targets.length > 0) {
				// Store target token IDs in message flags
				const targetIds = targets.map(t => t.id);
				message.updateSource({
					"flags.shadowdark-extras.targetIds": targetIds
				});
				//console.log(`${MODULE_ID} | Stored ${targetIds.length} targets in message flags:`, targetIds);

				// Mirror Image Automation
				// If this is an attack roll targeting someone with Mirror Image duplicates
				const isAttack = message.rolls?.some(r => r.terms?.some(t => t.faces === 20));
				if (isAttack) {
					for (const targetToken of targets) {
						const targetActor = targetToken.actor;
						if (!targetActor) continue;

						const mirrorImages = targetActor.getFlag(MODULE_ID, "mirrorImages");
						if (mirrorImages > 0) {
							// Decrement duplicates
							const newCount = mirrorImages - 1;

							// Update actor flag and effect (async but we don't await blocking the message)
							(async () => {
								await targetActor.setFlag(MODULE_ID, "mirrorImages", newCount);

								// Update visual effect and duration tracker
								const mirrorEffect = targetActor.effects.find(e => e.getFlag(MODULE_ID, "isMirrorImage"));
								if (mirrorEffect) {
									if (newCount <= 0) {
										await mirrorEffect.delete();

										// If duration tracking is active, end it
										// If duration tracking is active, end it
										if (typeof endDurationSpell === 'function') {
											const activeSpells = getActiveDurationSpells(targetActor);
											const mirrorSpell = activeSpells.find(s => s.spellName === "Mirror Image");
											if (mirrorSpell) {
												await endDurationSpell(targetActor.id, mirrorSpell.instanceId || mirrorSpell.spellId, "expired");
											}
										}
									} else {
										await mirrorEffect.update({
											"flags.shadowdark-extras.duplicates": newCount,
											"name": `Mirror Image (${newCount})`
										});
									}
								}
							})();

							// Notify in chat (modifying the message source)
							const interceptHtml = `
								<div class="shadowdark mirror-image-intercept" style="margin-top: 5px; padding: 5px; border: 1px solid #7a7a7a; border-radius: 3px; background: rgba(0, 0, 0, 0.1);">
									<p><i class="fas fa-clone"></i> <strong>Mirror Image Intercepted!</strong></p>
									<p>An illusory duplicate evaporates, causing the attack to miss <strong>${targetActor.name}</strong>.</p>
									<p style="font-size: 0.9em; font-style: italic;">Remaining duplicates: ${newCount}</p>
								</div>
							`;

							message.updateSource({
								content: (message.content || "") + interceptHtml,
								flavor: (message.flavor || "") + ` [Intercepted: ${targetActor.name}]`
							});

							// Only consume one duplicate per attack message even if multiple targets?
							// Usually attacks only target one person in SD, so this is fine.
							break;
						}
					}
				}
			}

			// Store item configuration for consumables (scrolls, potions, wands)
			// This is needed because these items are consumed and removed from the actor
			// before the chat message is processed
			const content = message.content || '';
			const actorIdMatch = content.match(/data-actor-id="([^"]+)"/);
			const itemIdMatch = content.match(/data-item-id="([^"]+)"/);

			if (actorIdMatch && itemIdMatch) {
				const actorId = actorIdMatch[1];
				const itemId = itemIdMatch[1];
				const actor = game.actors.get(actorId);
				const item = actor?.items.get(itemId);

				if (item && ["Spell", "NPC Spell", "Scroll", "Potion", "Wand"].includes(item.type)) {
					// Store the item type and relevant configurations
					const itemConfig = {
						type: item.type,
						name: item.name
					};

					// Store summoning config if it exists
					if (item.flags?.[MODULE_ID]?.summoning) {
						itemConfig.summoning = foundry.utils.duplicate(item.flags[MODULE_ID].summoning);
					}

					// Store itemGive config if it exists
					if (item.flags?.[MODULE_ID]?.itemGive) {
						itemConfig.itemGive = foundry.utils.duplicate(item.flags[MODULE_ID].itemGive);
					}

					// Store auraEffects config if it exists
					if (item.flags?.[MODULE_ID]?.auraEffects) {
						itemConfig.auraEffects = foundry.utils.duplicate(item.flags[MODULE_ID].auraEffects);
					}

					// Store spellDamage config if it exists
					if (item.flags?.[MODULE_ID]?.spellDamage) {
						itemConfig.spellDamage = foundry.utils.duplicate(item.flags[MODULE_ID].spellDamage);
					}

					// Store coatingPoison config if it exists
					if (item.flags?.[MODULE_ID]?.coatingPoison) {
						itemConfig.coatingPoison = foundry.utils.duplicate(item.flags[MODULE_ID].coatingPoison);
					}

					message.updateSource({
						"flags.shadowdark-extras.itemConfig": itemConfig
					});

					//console.log(`${MODULE_ID} | Stored item config for ${item.name}:`, itemConfig);
				}
			}

			// The hit-bonus stash consumer used to live here, matching a pending entry
			// by `${speakerActorId}-${itemId}` and copying it onto
			// `flags.shadowdark-extras.hitBonus`. Nothing ever filled that stash — its
			// writer was never installed — and the breakdown now travels to the card
			// on the roll config instead, so no key matching is needed at all.
			// See combat/hit-bonus.mjs.

			// Store current targets in flags for Item Macro use
			if (game.user.targets.size > 0 && !message.flags[MODULE_ID]?.targetIds) {
				const targetIds = Array.from(game.user.targets).map(t => t.id);
				foundry.utils.setProperty(message._source, `flags.${MODULE_ID}.targetIds`, targetIds);
			}
		} catch (err) {
			console.error(`${MODULE_ID} | Failed to store data in message`, err);
		}
	});

	// Inject damage card into chat messages
	Hooks.on("renderChatMessageHTML", (message, html, context) => {
		try {
			injectDamageCard(message, html, context);
		} catch (err) {
			console.error(`${MODULE_ID} | Failed to inject damage card`, err);
		}

		// Also process weapon bonuses for weapon attack messages.
		// `processWeaponBonuses` is async, so a throw inside it becomes a rejected
		// promise that a surrounding try/catch can never observe — which is exactly
		// how a `html.find is not a function` TypeError went unreported here for as
		// long as it did. Attach the handler to the promise instead.
		processWeaponBonuses(message, html).catch(err => {
			console.error(`${MODULE_ID} | Failed to process weapon bonuses`, err);
		});

		// Hide item description if setting is enabled
		try {
			const combatSettings = game.settings.get(MODULE_ID, "combatSettings");
			if (combatSettings?.hideItemDescription) {
				// Hide the card-content which contains weapon/spell descriptions
				const cardContent = html.querySelector('.card-content');
				if (cardContent) cardContent.style.display = 'none';
			}
		} catch (err) {
			// Settings may not be registered yet, ignore
		}
	});
}
