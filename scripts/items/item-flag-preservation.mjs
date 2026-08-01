/**
 * SDX flag preservation across Item creation paths.
 *
 * Foundry and Shadowdark both build new Items by copying a chosen subset of
 * fields, and neither copies module flags. Every SDX configuration attached to
 * an item — spell damage, targeting, summoning, item-give, item macros, aura
 * effects, template effects, unidentified state — is therefore silently lost
 * unless something puts it back. These two wraps are that something.
 *
 * WHY A NEW `items/` BUCKET. The eight flag families are configured by apps in
 * four different features: `item-sheets` holds four (SpellDamageConfig,
 * TemplateTargetingConfig, SummoningConfig, ItemGiveConfig), `effects` two
 * (AuraConfig, TemplateEffectsSD), `item-macros` one, `inventory` one. A
 * plurality is not ownership, and the concern here is not sheets at all — it is
 * Item DOCUMENT LIFECYCLE, which no existing folder covered. Same reasoning as
 * `settings/`: a cross-cutting surface is not a `shared/` kernel helper.
 *
 * TWO REGISTER FUNCTIONS, NOT ONE. The root called these at two different
 * points in its sequence, and hook order is fixed by the position of the
 * register CALL. Collapsing them into a single `registerItemFlags()` would
 * quietly move one of them.
 *
 * Both bodies are the root's verbatim, carried at their original indentation.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/** `preCreateItem`: covers item-piles transfers, compendium drops, and the
 *  scroll-to-spell "Learn Spell" path. */
function preserveFlagsOnItemCreate(item, data, options, userId) {
	// Note: This hook handles flag preservation for items created directly

	// Preserve spell damage flags when learning a spell from a scroll
	// This handles the "Learn Spell" button functionality
	if (item.type === "Spell" && item.parent) {
		// Check if there's a scroll being learned from (stored in temporary flag)
		const sourceScrollId = item.parent.getFlag(MODULE_ID, "_learningFromScroll");
		if (sourceScrollId) {
			const sourceScroll = item.parent.items.get(sourceScrollId);
			if (sourceScroll) {
				// Preserve the spell damage configuration from the scroll
				if (sourceScroll.flags?.[MODULE_ID]?.spellDamage) {
					item.updateSource({
						[`flags.${MODULE_ID}.spellDamage`]: foundry.utils.duplicate(sourceScroll.flags[MODULE_ID].spellDamage),
					});
					//console.log(`${MODULE_ID} | Preserved spell damage flags when learning from scroll:`, sourceScroll.name);
				}
				// Preserve targeting configuration from the scroll
				if (sourceScroll.flags?.[MODULE_ID]?.targeting) {
					item.updateSource({
						[`flags.${MODULE_ID}.targeting`]: foundry.utils.duplicate(sourceScroll.flags[MODULE_ID].targeting),
					});
					//console.log(`${MODULE_ID} | Preserved targeting flags when learning from scroll:`, sourceScroll.name);
				}
				// Preserve template effects configuration from the scroll
				if (sourceScroll.flags?.[MODULE_ID]?.templateEffects) {
					item.updateSource({
						[`flags.${MODULE_ID}.templateEffects`]: foundry.utils.duplicate(sourceScroll.flags[MODULE_ID].templateEffects),
					});
					//console.log(`${MODULE_ID} | Preserved templateEffects flags when learning from scroll:`, sourceScroll.name);
				}
				// Preserve aura effects configuration from the scroll
				if (sourceScroll.flags?.[MODULE_ID]?.auraEffects) {
					item.updateSource({
						[`flags.${MODULE_ID}.auraEffects`]: foundry.utils.duplicate(sourceScroll.flags[MODULE_ID].auraEffects),
					});
					//console.log(`${MODULE_ID} | Preserved auraEffects flags when learning from scroll:`, sourceScroll.name);
				}
			}
		}
	}

	// Preserve Item Macro trigger configuration flags
	if (data.flags?.[MODULE_ID]?.itemMacro) {
		item.updateSource({
			[`flags.${MODULE_ID}.itemMacro`]: foundry.utils.duplicate(data.flags[MODULE_ID].itemMacro),
		});
		//console.log(`${MODULE_ID} | Preserved itemMacro flags on item creation:`, item.name);
	}

	// Preserve Targeting configuration flags
	if (data.flags?.[MODULE_ID]?.targeting) {
		item.updateSource({
			[`flags.${MODULE_ID}.targeting`]: foundry.utils.duplicate(data.flags[MODULE_ID].targeting),
		});
		//console.log(`${MODULE_ID} | Preserved targeting flags on item creation:`, item.name);
	}

	// Preserve Template Effects configuration flags
	if (data.flags?.[MODULE_ID]?.templateEffects) {
		item.updateSource({
			[`flags.${MODULE_ID}.templateEffects`]: foundry.utils.duplicate(data.flags[MODULE_ID].templateEffects),
		});
		//console.log(`${MODULE_ID} | Preserved templateEffects flags on item creation:`, item.name);
	}

	// Preserve Aura Effects configuration flags
	if (data.flags?.[MODULE_ID]?.auraEffects) {
		item.updateSource({
			[`flags.${MODULE_ID}.auraEffects`]: foundry.utils.duplicate(data.flags[MODULE_ID].auraEffects),
		});
		//console.log(`${MODULE_ID} | Preserved auraEffects flags on item creation:`, item.name);
	}

	// Preserve Item Macro module's macro data (itemacro module)
	if (data.flags?.itemacro?.macro) {
		item.updateSource({
			"flags.itemacro.macro": foundry.utils.duplicate(data.flags.itemacro.macro),
		});
		//console.log(`${MODULE_ID} | Preserved itemacro macro on item creation:`, item.name);
	}
}

export function registerItemCreateFlagPreservation() {
	Hooks.on("preCreateItem", preserveFlagsOnItemCreate);
}

/** Shadowdark's `createItemFromSpell` copies only type/name/system/img, so
 *  every SDX flag has to be re-attached to the derived item. */
function wrapCreateItemFromSpell() {
	// CRITICAL FIX: Wrap Shadowdark's createItemFromSpell to preserve our spell damage flags
	// The system's function only copies type/name/system/img, stripping all flags
	if (globalThis.shadowdark?.utils?.createItemFromSpell) {
		const originalCreateItemFromSpell = globalThis.shadowdark.utils.createItemFromSpell;

		globalThis.shadowdark.utils.createItemFromSpell = async function(type, spell) {
			// Call the original function to get the base item data
			const itemData = await originalCreateItemFromSpell.call(this, type, spell);

			// Initialize flags object if needed
			itemData.flags = itemData.flags || {};
			itemData.flags[MODULE_ID] = itemData.flags[MODULE_ID] || {};

			// Preserve spell damage configuration flags
			if (spell.flags?.[MODULE_ID]?.spellDamage) {
				itemData.flags[MODULE_ID].spellDamage = foundry.utils.duplicate(spell.flags[MODULE_ID].spellDamage);
				//console.log(`${MODULE_ID} | Preserved spell damage flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].spellDamage);
			}

			// Preserve Targeting configuration flags
			if (spell.flags?.[MODULE_ID]?.targeting) {
				itemData.flags[MODULE_ID].targeting = foundry.utils.duplicate(spell.flags[MODULE_ID].targeting);
				//console.log(`${MODULE_ID} | Preserved targeting flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].targeting);
			}

			// Preserve summoning configuration flags
			if (spell.flags?.[MODULE_ID]?.summoning) {
				itemData.flags[MODULE_ID].summoning = foundry.utils.duplicate(spell.flags[MODULE_ID].summoning);
				//console.log(`${MODULE_ID} | Preserved summoning flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].summoning);
			}

			// Preserve item give configuration flags
			if (spell.flags?.[MODULE_ID]?.itemGive) {
				itemData.flags[MODULE_ID].itemGive = foundry.utils.duplicate(spell.flags[MODULE_ID].itemGive);
				//console.log(`${MODULE_ID} | Preserved item give flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].itemGive);
			}

			// Preserve unidentified flags
			if (spell.flags?.[MODULE_ID]?.unidentified) {
				itemData.flags[MODULE_ID].unidentified = spell.flags[MODULE_ID].unidentified;
				itemData.flags[MODULE_ID].unidentifiedDescription = spell.flags[MODULE_ID].unidentifiedDescription || "";
			}

			// Preserve Item Macro trigger configuration flags
			if (spell.flags?.[MODULE_ID]?.itemMacro) {
				itemData.flags[MODULE_ID].itemMacro = foundry.utils.duplicate(spell.flags[MODULE_ID].itemMacro);
				//console.log(`${MODULE_ID} | Preserved itemMacro flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].itemMacro);
			}

			// Preserve Template Effects configuration flags
			if (spell.flags?.[MODULE_ID]?.templateEffects) {
				itemData.flags[MODULE_ID].templateEffects = foundry.utils.duplicate(spell.flags[MODULE_ID].templateEffects);
				//console.log(`${MODULE_ID} | Preserved templateEffects flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].templateEffects);
			}

			// Preserve Aura Effects configuration flags
			if (spell.flags?.[MODULE_ID]?.auraEffects) {
				itemData.flags[MODULE_ID].auraEffects = foundry.utils.duplicate(spell.flags[MODULE_ID].auraEffects);
				//console.log(`${MODULE_ID} | Preserved auraEffects flags for ${spell.name} -> ${itemData.name}`, itemData.flags[MODULE_ID].auraEffects);
			}

			// Preserve Item Macro module's macro data (itemacro module)
			if (spell.flags?.itemacro?.macro) {
				itemData.flags.itemacro = itemData.flags.itemacro || {};
				itemData.flags.itemacro.macro = foundry.utils.duplicate(spell.flags.itemacro.macro);
				//console.log(`${MODULE_ID} | Preserved itemacro macro for ${spell.name} -> ${itemData.name}`);
			}

			return itemData;
		};

		//console.log(`${MODULE_ID} | Wrapped shadowdark.utils.createItemFromSpell to preserve spell flags`);
	}
}

export function registerSpellItemFlagPreservation() {
	Hooks.once("ready", wrapCreateItemFromSpell);
}
