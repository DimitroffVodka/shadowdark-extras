/**
 * Background advancement.
 *
 * Granting of advancement items when an actor gains a background or gains a
 * level. Moved verbatim out of the composition root's HOOKS block, banner
 * comment and all.
 *
 * A sibling of BackgroundSheetSD.mjs rather than part of it: that file is the
 * Background item's sheet, and this is actor-side runtime granting. They share
 * a feature, not a responsibility.
 *
 * `updateActor` is registered three times in the root, so
 * `registerBackgroundAdvancementHooks()` is called from the position these two
 * occupied and relative order is preserved by the call site (handoff rule 2).
 * The two are kept in one register function because they are one feature and
 * were adjacent; the second's own comment calls out that it is deliberately a
 * SEPARATE hook from the first.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/* ============================================================================
 * Background Advancement System
 * ============================================================================ */

/**
 * Grant items from an advancement entry to an actor
 * @param {Actor} actor - The actor to grant items to
 * @param {Item} background - The background item
 * @param {Object} entry - The advancement entry
 */
async function grantAdvancementItems(actor, background, entry) {
	// Check if already granted
	const granted = actor.getFlag(MODULE_ID, "grantedAdvancements") || {};
	const backgroundGrants = granted[background.id] || [];

	if (backgroundGrants.includes(entry.id)) {
		//console.log(`${MODULE_ID} | Advancement ${entry.id} already granted to ${actor.name}, skipping`);
		return;
	}

	// Load items from UUIDs (skip invalid silently with console.warn)
	const itemsToCreate = [];
	for (const itemRef of entry.items || []) {
		try {
			const doc = await fromUuid(itemRef.uuid);
			if (!doc) {
				console.warn(`${MODULE_ID} | Could not load item ${itemRef.uuid}, skipping`);
				continue;
			}
			itemsToCreate.push(doc.toObject());
		}
		catch (err) {
			console.warn(`${MODULE_ID} | Error loading item ${itemRef.uuid}:`, err);
			// Continue with other items
		}
	}

	// Create items on actor
	if (itemsToCreate.length > 0) {
		await actor.createEmbeddedDocuments("Item", itemsToCreate);
		const itemNames = itemsToCreate.map(i => i.name).join(", ");
		ui.notifications.info(`${actor.name} gained: ${itemNames}`);
		//console.log(`${MODULE_ID} | Granted ${itemsToCreate.length} items to ${actor.name} from advancement ${entry.id}`);
	}
	else {
		//console.log(`${MODULE_ID} | No valid items to grant from advancement ${entry.id}`);
	}

	// Mark as granted
	backgroundGrants.push(entry.id);
	granted[background.id] = backgroundGrants;
	await actor.setFlag(MODULE_ID, "grantedAdvancements", granted);
}

export function registerBackgroundAdvancementHooks() {
	/**
	 * Hook: Grant advancement items when Background is set on actor (Level 0)
	 * Shadowdark stores background as a UUID reference in system.background, not as an embedded item
	 */
	Hooks.on("updateActor", async (actor, changes, options, userId) => {
		// Only process for the updating user
		if (userId !== game.user.id) return;

		// Check if background was set
		if (!foundry.utils.hasProperty(changes, "system.background")) return;

		const backgroundUuid = changes.system.background;
		if (!backgroundUuid) return; // Background was removed

		//console.log(`${MODULE_ID} | Background set on actor "${actor.name}": ${backgroundUuid}`);

		// Load the background item from UUID
		const background = await fromUuid(backgroundUuid);
		if (!background) {
			console.warn(`${MODULE_ID} | Could not load background from UUID: ${backgroundUuid}`);
			return;
		}

		//console.log(`${MODULE_ID} | Loaded background: ${background.name}`);

		const advancement = background.getFlag(MODULE_ID, "advancement") || [];
		//console.log(`${MODULE_ID} | Advancement data:`, advancement);

		const immediateEntries = advancement.filter(e => e.level === 0);
		//console.log(`${MODULE_ID} | Found ${immediateEntries.length} level 0 advancement entries`);

		if (immediateEntries.length === 0) {
			//console.log(`${MODULE_ID} | No level 0 entries to grant`);
			return;
		}

		//console.log(`${MODULE_ID} | Granting ${immediateEntries.length} immediate advancement entries from ${background.name} to ${actor.name}`);

		// Grant items from all level 0 entries
		for (const entry of immediateEntries) {
			await grantAdvancementItems(actor, background, entry);
		}
	});

	/**
	 * Hook: Grant advancement items when actor levels up
	 * This is a SEPARATE updateActor hook that handles level changes (not background changes)
	 */
	Hooks.on("updateActor", async (actor, changes, options, userId) => {
		// Only the user who made the change should process this
		if (userId !== game.user.id) return;

		// Check if level changed (not background - that's handled by the other hook)
		if (!foundry.utils.hasProperty(changes, "system.level.value")) return;

		const newLevel = changes.system.level.value;
		//console.log(`${MODULE_ID} | Actor ${actor.name} level updated to ${newLevel}`);

		// Get the actor's background UUID from system.background
		const backgroundUuid = actor.system.background;
		if (!backgroundUuid) {
			//console.log(`${MODULE_ID} | No background set for ${actor.name}, skipping advancement`);
			return;
		}

		//console.log(`${MODULE_ID} | Loading background from UUID: ${backgroundUuid}`);

		// Load the background item from UUID
		const background = await fromUuid(backgroundUuid);
		if (!background) {
			console.warn(`${MODULE_ID} | Could not load background from UUID: ${backgroundUuid}`);
			return;
		}

		//console.log(`${MODULE_ID} | Found Background: ${background.name}`);

		// Get advancement entries for this level
		const advancement = background.getFlag(MODULE_ID, "advancement") || [];
		//console.log(`${MODULE_ID} | Background has ${advancement.length} total advancement entries`);

		const levelEntries = advancement.filter(e => e.level === newLevel);

		if (levelEntries.length === 0) {
			//console.log(`${MODULE_ID} | No advancement entries for level ${newLevel} in ${background.name}`);
			return;
		}

		//console.log(`${MODULE_ID} | Found ${levelEntries.length} advancement entries for level ${newLevel}`);

		// Grant items from all matching entries
		// The grantAdvancementItems function has its own duplicate checking
		for (const entry of levelEntries) {
			await grantAdvancementItems(actor, background, entry);
		}
	});
}
