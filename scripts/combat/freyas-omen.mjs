/**
 * Freya's Omen: a reroll button on a critically-failed spell card.
 *
 * Moved verbatim out of the composition root's HOOKS block. Gated on the
 * actor flag `freyasOmen`, and only for a spell whose roll critically failed.
 *
 * It lives in combat/ because that is where this module already keeps its
 * `renderChatMessageHTML` card injectors and its roll machinery —
 * `hit-bonus.mjs` is the same shape, and `roll-patches.mjs` is next door.
 * It is not an ActiveEffect, and there is no spells/ folder to prefer.
 *
 * `renderChatMessageHTML` is registered several times across the module, so
 * `registerFreyasOmenHooks()` is called from the position this one occupied
 * and relative order is preserved by the call site (handoff rule 2).
 */

import { MODULE_ID } from "../shared/module-id.mjs";

export function registerFreyasOmenHooks() {
	// Inject Freya's Omen reroll button
	Hooks.on("renderChatMessageHTML", (message, html, context) => {
		const flags = message.flags?.shadowdark;
		if (!flags?.isRoll) return;

		// Check if it's a critical failure on a spell
		const isCriticalFailure = flags.critical === "failure";
		if (!isCriticalFailure) return;

		let actor = message.author?.character; // Default to user character
		if (message.speaker.actor) actor = game.actors.get(message.speaker.actor);
		if (message.speaker.token && canvas.tokens) {
			const token = canvas.tokens.get(message.speaker.token);
			if (token) actor = token.actor;
		}
		if (!actor && message.actor) actor = message.actor;
		if (!actor) return;

		const hasFreyasOmen = actor.getFlag(MODULE_ID, "freyasOmen");
		if (!hasFreyasOmen) return;

		// v14: html is a raw HTMLElement, not jQuery. Use vanilla DOM.
		const itemCard = html.querySelector(".item-card");
		const itemId = itemCard?.dataset?.itemId;
		if (!itemId) return;

		const item = actor.items.get(itemId);
		if (!item || !item.isSpell()) return;

		const diceRoll = html.querySelector(".dice-roll");
		if (!diceRoll) return;

		const btn = document.createElement("button");
		btn.className = "sdx-freyas-omen-reroll";
		btn.style.marginTop = "5px";
		btn.innerHTML = `<i class="fas fa-redo"></i> ${game.i18n.localize("SHADOWDARK.chat_card.button.freyas_omen_reroll")}`;

		btn.addEventListener("click", async (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			// Reroll the item
			if (item) {
				//console.log(`${MODULE_ID} | Rerrolling spell: ${item.name}`);

				// Reconstruct roll data for a spell roll
				// Based on system logic (which isn't exposed directly for us to reuse easily)
				let abilityId = item.system.ability;

				// Fallback: Try to find ability from Class if not on item
				if (!abilityId) {
					// Check if item has spellAttribute
					if (item.system.spellAttribute) {
						abilityId = item.system.spellAttribute;
					}
					else {
						// Find spellcasting class
						const classes = actor.items.filter(i => i.type === "Class");
						for (const cls of classes) {
							// shadowdark system structure for class spellcasting
							if (cls.system.spellcasting?.ability) {
								abilityId = cls.system.spellcasting.ability;
								break;
							}
						}
					}
				}

				// Final fallback
				if (!abilityId) {
					console.warn(`${MODULE_ID} | Could not determine spellcasting ability for ${item.name}. Defaulting to INT.`);
					abilityId = "int";
				}

				if (!abilityId) {
					console.error(`${MODULE_ID} | Cannot reroll spell without associated ability.`);
					return;
				}

				const parts = ["1d20", "@abilityBonus"];

				// Calculate bonuses
				const abilityBonus = actor.abilityModifier(abilityId);
				// Use system config if available, otherwise fallback map or Title Case
				const abilityName = CONFIG.SHADOWDARK?.ABILITIES_LONG?.[abilityId] || abilityId.charAt(0).toUpperCase() + abilityId.slice(1);

				const data = {
					rollType: "ability",
					abilityBonus,
					ability: abilityName,
					actor: actor,
					item: item,
					baseDifficulty: 10, // Spell DC is 10 + Tier
				};

				const options = {
					title: game.i18n.format("SHADOWDARK.dialog.ability_check.header", { ability: abilityName }),
					flavor: game.i18n.format("SHADOWDARK.chat_card.button.freyas_omen_reroll") + ": " + item.name,
					speaker: ChatMessage.getSpeaker({ actor: actor }),
					// Trigger Freya's Omen specific behavior if we wanted, but standard roll is fine
				};

				item.rollSpell(parts, data, options);
			}
		});

		diceRoll.after(btn);
	});
}
