import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * The two gates that refuse a spellcast outright.
 *
 * Extracted from the composition root in Phase 3, verbatim. They are one unit
 * because they wrap the same method: each replaces
 * `castSpell` on the PlayerSD and NpcSD data models, so the second to be
 * installed wraps the first. That chain is why they must be read together —
 * and why the root still owns the calls. `setupWandUsesBlocker` runs first and
 * only when the `enableWandUses` setting is on, `setupSilencedCastingBlocker`
 * unconditionally after it; splitting them across modules would hide an
 * ordering dependency that is currently obvious.
 *
 * Both resolve the invoked item the same way, because Shadowdark 4.x moved
 * `castSpell` off `ActorSD.prototype` and changed its first argument from an
 * item id to a UUID: try `fromUuid` when the string looks like one, then fall
 * back to an id lookup. Legacy callers passing an id still work.
 *
 * They live under `effects/` because the silenced gate is driven by a condition
 * effect and reads its `effectsSettings.silenced.*` switches, which
 * `EffectsSettingsSD` owns.
 */

/**
 * Setup a wrapper to prevent casting depleted wands.
 *
 * Shadowdark 4.x moved castSpell from ActorSD.prototype to the PlayerSD and
 * NpcSD data models. Inside the wrapped method `this` is the data model, and
 * the actor is reached via `this.parent`. The first arg is now a spell/item
 * UUID rather than an item ID.
 */
export function setupWandUsesBlocker() {
	const patchModel = (model, label) => {
		if (!model?.prototype?.castSpell) return false;
		if (model.prototype.__sdxCastSpellWandPatched) return true;
		const original = model.prototype.castSpell;
		model.prototype.castSpell = async function(spellUuid, config = {}) {
			const actor = this.parent;
			// Resolve the item the user is invoking. New API passes an item UUID;
			// legacy callers may still pass an item id. Cover both.
			let item = null;
			if (typeof spellUuid === "string") {
				if (spellUuid.includes(".")) {
					try { item = await fromUuid(spellUuid); } catch (_) { item = null; }
				}
				if (!item) item = actor?.items.get(spellUuid) ?? null;
			}

			if (item?.type === "Wand") {
				const wandUsesFlags = item.flags?.[MODULE_ID]?.wandUses;
				if (wandUsesFlags?.enabled && (wandUsesFlags.current ?? 0) <= 0) {
					ui.notifications.warn(game.i18n.format("SHADOWDARK_EXTRAS.wand.no_uses_remaining", { name: item.name }));
					return null;
				}
			}
			return original.call(this, spellUuid, config);
		};
		model.prototype.__sdxCastSpellWandPatched = true;
		return true;
	};
	const playerOK = patchModel(CONFIG.Actor.dataModels?.Player, "Player");
	const npcOK = patchModel(CONFIG.Actor.dataModels?.NPC, "NPC");
	if (!playerOK && !npcOK) {
		console.warn(`${MODULE_ID} | Could not find castSpell on PlayerSD/NpcSD data models; wand uses blocking inactive`);
	}
}

/**
 * Setup a wrapper to prevent spellcasting when silenced.
 *
 * Shadowdark 4.x moved castSpell from ActorSD.prototype to the PlayerSD and
 * NpcSD data models. Inside the wrapped method `this` is the data model, and
 * the actor is reached via `this.parent`. The first arg is now a spell/item
 * UUID rather than an item ID.
 */
export function setupSilencedCastingBlocker() {
	const patchModel = (model) => {
		if (!model?.prototype?.castSpell) return false;
		if (model.prototype.__sdxCastSpellSilencedPatched) return true;
		const original = model.prototype.castSpell;
		model.prototype.castSpell = async function(spellUuid, config = {}) {
			const actor = this.parent;
			const isSilenced = actor?.getFlag(MODULE_ID, "silenced");
			if (isSilenced) {
				// Resolve the item the user is invoking
				let item = null;
				if (typeof spellUuid === "string") {
					if (spellUuid.includes(".")) {
						try { item = await fromUuid(spellUuid); } catch (_) { item = null; }
					}
					if (!item) item = actor?.items.get(spellUuid) ?? null;
				}

				if (item) {
					const effectsSettings = game.settings.get(MODULE_ID, "effectsSettings");
					let shouldBlock = false;
					let blockedType = "";

					if (item.type === "Spell" || item.type === "NPC Spell") {
						shouldBlock = effectsSettings.silenced.blocksSpells;
						blockedType = "spells";
					} else if (item.type === "Scroll") {
						shouldBlock = effectsSettings.silenced.blocksScrolls;
						blockedType = "scrolls";
					} else if (item.type === "Wand") {
						shouldBlock = effectsSettings.silenced.blocksWands;
						blockedType = "wands";
					}

					if (shouldBlock) {
						ui.notifications.warn(`You are silenced and cannot cast ${blockedType}!`);
						return null;
					}
				}
			}
			return original.call(this, spellUuid, config);
		};
		model.prototype.__sdxCastSpellSilencedPatched = true;
		return true;
	};
	patchModel(CONFIG.Actor.dataModels?.Player);
	patchModel(CONFIG.Actor.dataModels?.NPC);
}
