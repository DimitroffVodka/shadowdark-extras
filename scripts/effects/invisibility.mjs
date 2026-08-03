import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * Invisibility effect: restore token visibility when the effect ends.
 *
 * Extracted from the composition root in Phase 3. Five hooks — the effect being
 * disabled or deleted, the token refreshing, an offensive action breaking
 * concealment, and the Condition item itself being deleted. Every one ignores
 * anything that is not an invisibility effect, so this is the whole feature.
 *
 * These share their hook names with other root registrations — updateActiveEffect
 * and deleteActiveEffect are registered three times each. Co-location is NOT what
 * preserves firing order; the position of the register() CALL is. The root calls
 * registerInvisibilityHooks() where the first of them sat, which lands after the
 * condition-toggle handlers and before the remaining ones for both names, exactly
 * as before. Same-name handlers may therefore live in different feature modules.
 *
 * The deleteItem handler arrived last (5648cd6): it was left behind in the root
 * by the original extraction and appended here, which is why it is the only one
 * registered after the offensive-action guard.
 */

/**
 * Register the invisibility hooks. The composition root calls this at
 * the source position the first registration occupied.
 */
export function registerInvisibilityHooks() {
	// Restore visibility when invisibility effect is disabled or deleted
	Hooks.on("updateActiveEffect", async (effect, changes, options, userId) => {
		// Check if this is an invisibility effect being disabled
		const isInvisibilityEffect = effect.changes.some(c => c.key === `flags.${MODULE_ID}.invisibility`);
		if (!isInvisibilityEffect) return;


		// If effect was disabled, restore visibility
		if (changes.disabled === true) {
			// Effect.parent is the Item (Condition), we need the Actor that owns the item
			const item = effect.parent;
			const actor = item?.parent; // Item's parent is the Actor
			if (actor) {
				// Find all token documents for this actor across all scenes
				const tokens = [];
				for (const scene of game.scenes) {
					const sceneTokens = scene.tokens.filter(t => {
						const match = t.actorId === actor.id || t.actor?.id === actor.id;
						if (t.actor?.name === actor.name) {
						}
						return match;
					});
					tokens.push(...sceneTokens);
				}
				for (const tokenDoc of tokens) {
					await tokenDoc.update({ hidden: false });
				}
			}
		}
	});

	Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
		// Check if this is an invisibility effect being deleted
		const isInvisibilityEffect = effect.changes.some(c => c.key === `flags.${MODULE_ID}.invisibility`);
		if (!isInvisibilityEffect) return;

		// Restore visibility when effect is deleted
		// Effect.parent is the Item (Condition), we need the Actor that owns the item
		const item = effect.parent;
		const actor = item?.parent; // Item's parent is the Actor
		if (actor) {
			// Find all token documents for this actor across all scenes
			const tokens = [];
			for (const scene of game.scenes) {
				const sceneTokens = scene.tokens.filter(t => t.actorId === actor.id);
				tokens.push(...sceneTokens);
			}
			for (const tokenDoc of tokens) {
				await tokenDoc.update({ hidden: false });
			}
		}
	});

	// Apply invisibility visual effect to tokens using Foundry's built-in hidden property
	Hooks.on("refreshToken", (token) => {
		const hasInvisibility = token.actor?.getFlag(MODULE_ID, "invisibility");

		if (hasInvisibility) {
			// Use Foundry's hidden property (same as token HUD invisible button)
			if (!token.document.hidden) {
				token.document.update({ hidden: true });
			}
		}
	});

	// Auto-disable invisibility when attacking or casting spells
	Hooks.on("preCreateChatMessage", async (message) => {
		const speaker = message.speaker;
		if (!speaker?.actor) return;

		const actor = game.actors.get(speaker.actor);
		if (!actor) return;

		// Check if actor has invisibility
		const hasInvisibility = actor.getFlag(MODULE_ID, "invisibility");
		if (!hasInvisibility) return;

		// Check if this is an attack or spell
		const shadowdarkFlags = message.flags?.shadowdark;
		const isAttack = shadowdarkFlags?.roll?.type === "attack";
		const isSpell = shadowdarkFlags?.spell || message.flags?.shadowdark?.itemId;

		// Also check if spell item is being cast
		let isSpellCast = false;
		if (message.flags?.shadowdark?.itemId) {
			const item = actor.items.get(message.flags.shadowdark.itemId);
			if (item && item.type === "Spell") {
				isSpellCast = true;
			}
		}

		if (isAttack || isSpell || isSpellCast) {

			// Find and disable the invisibility effect
			const effect = actor.effects.find(e =>
				e.changes.some(c => c.key === `flags.${MODULE_ID}.invisibility`)
			);

			if (effect) {
				await effect.update({ disabled: true });

				// Notify about invisibility breaking
				ChatMessage.create({
					content: `<p>${actor.name}'s invisibility fades as they take offensive action!</p>`,
					speaker: ChatMessage.getSpeaker({ actor }),
					whisper: [],
				});

				// Restore token visibility using Foundry's hidden property
				const tokens = actor.getActiveTokens();
				for (const token of tokens) {
					await token.document.update({ hidden: false });
				}
			}
		}
	});

	// Also restore visibility when the Condition item itself is deleted
	Hooks.on("deleteItem", async (item, options, userId) => {
		// Check if this item has an invisibility effect
		const hasInvisibilityEffect = item.effects?.some(e =>
			e.changes.some(c => c.key === `flags.${MODULE_ID}.invisibility`)
		);
		if (!hasInvisibilityEffect) return;

		// Item's parent is the Actor
		const actor = item.parent;
		if (actor) {
			// Find all token documents for this actor across all scenes
			const tokens = [];
			for (const scene of game.scenes) {
				const sceneTokens = scene.tokens.filter(t => t.actorId === actor.id);
				tokens.push(...sceneTokens);
			}
			for (const tokenDoc of tokens) {
				await tokenDoc.update({ hidden: false });
			}
		}
	});
}
