/**
 * Keeping party actors out of the system's light-source tracker.
 *
 * Extracted from the composition root in Phase 3. A party actor is stored as
 * an NPC carrying an `isParty` flag, so the tracker counts it as a creature
 * with light sources unless it is filtered out.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isPartyActor } from "./PartySheetSD.mjs";

export function patchLightSourceTrackerForParty() {
	const tracker = game.shadowdark?.lightSourceTracker;
	if (!tracker) {
		console.warn(`${MODULE_ID} | Light Source Tracker not found, skipping patch`);
		return;
	}

	// Store the original _gatherLightSources method
	const originalGatherLightSources = tracker._gatherLightSources.bind(tracker);

	// Override _gatherLightSources to also include Party actors
	tracker._gatherLightSources = async function() {
		// Call the original method first
		await originalGatherLightSources();

		// Track if we added anything
		let addedPartyActors = false;

		// Now add Party actors with active light sources
		const partyActors = game.actors.filter(actor => isPartyActor(actor));

		for (const actor of partyActors) {
			// Get active light sources for this party
			const activeLightSources = actor.items.filter(
				item => ["Basic", "Effect"].includes(item.type) &&
					item.system.light?.isSource &&
					item.system.light?.active
			);

			if (activeLightSources.length === 0) continue;

			const actorData = actor.toObject(false);
			actorData.lightSources = [];

			for (const item of activeLightSources) {
				actorData.lightSources.push(item.toObject(false));
			}

			// Only add if not already in the list
			if (!this.monitoredLightSources.some(a => a._id === actorData._id)) {
				this.monitoredLightSources.push(actorData);
				addedPartyActors = true;
			}
		}

		// Only re-sort if we actually added party actors
		if (addedPartyActors) {
			this.monitoredLightSources.sort((a, b) => {
				if (a.name < b.name) return -1;
				if (a.name > b.name) return 1;
				return 0;
			});
		}
	};
}
