// Party token light synchronisation — extracted from
// scripts/party/PartySheetSD.mjs (Phase 5.3 split). Two plain functions: the
// search for the brightest active light across the party and its members, and
// the token update that mirrors it onto every party token on the scene.
//
// PartySheetSD re-exports both, so the composition root and the travel and
// inventory mixins keep importing them from where they always did.

import { MODULE_ID } from "../shared/module-id.mjs";
import { getCustomLightSources } from "../canvas/light-templates.mjs";

// ============================================
// PARTY TOKEN LIGHT SYNCHRONIZATION
// ============================================

/**
 * Get the brightest light source from all party members
 * @param {Actor} partyActor - The party actor
 * @returns {Promise<Object|null>} Light configuration or null if no lights
 */
export async function getBrightestPartyLight(partyActor) {
	if (!partyActor) return null;

	// Get party members
	const memberIds = partyActor.getFlag(MODULE_ID, "members") ?? [];
	// Include active shared light sources carried directly by the party actor.
	// Camping creates its temporary campfire there so the party token itself
	// emits the light while every member remains free to perform a task.
	const members = [partyActor];

	for (const id of memberIds) {
		let actor = game.actors.get(id);
		if (!actor && id.includes(".")) {
			try {
				actor = await fromUuid(id);
			}
			catch{
				continue;
			}
		}
		if (actor) members.push(actor);
	}

	// Find all active light sources from all members
	let brightestLight = null;
	let maxBright = -1;
	let maxDim = -1;

	for (const member of members) {
		// Check all items for light sources
		for (const item of member.items) {
			// Light sources are Basic or Effect items with light.isSource = true
			const isLightSource = ["Basic", "Effect"].includes(item.type) && item.system?.light?.isSource;
			const isActive = item.system?.light?.active;

			if (isLightSource && isActive) {

				// Load Shadowdark's official light source mappings
				const templateName = item.system.light.template;
				let lightTemplate = null;

				try {
					const lightSources = await foundry.utils.fetchJsonWithTimeout(
						"systems/shadowdark/assets/mappings/map-light-sources.json"
					);
					lightTemplate = lightSources[templateName]?.light;
				}
				catch(e) {
					console.warn(`${MODULE_ID} | Failed to load light mappings:`, e);
				}

				// If template not found in JSON, use fallback values
				if (!lightTemplate) {
					// Fallback values matching Shadowdark's actual light mappings
					const FALLBACK_TEMPLATES = {
						torch: { bright: 5, dim: 30, color: "#d1c846", alpha: 0.2, angle: 360 },
						lantern: { bright: 15, dim: 60, color: "#d1c846", alpha: 0.2, angle: 360 },
						lightSpellNear: { bright: 30, dim: 0, color: null, alpha: 0.2, angle: 360 },
						lightSpellDouble: {
							bright: 60, dim: 0, color: null, alpha: 0.2, angle: 360,
						},
					};

					// Merge custom templates
					const customSources = getCustomLightSources();
					for (const [key, source] of Object.entries(customSources)) {
						FALLBACK_TEMPLATES[key] = source.light;
					}

					lightTemplate = FALLBACK_TEMPLATES[templateName];
				}

				// Get bright and dim from the template or item
				let bright = lightTemplate?.bright ?? item.system.light.bright ?? 0;
				let dim = lightTemplate?.dim ?? item.system.light.dim ?? 0;

				// Compare brightness (bright distance is primary, dim is tiebreaker)
				if (bright > maxBright || (bright === maxBright && dim > maxDim)) {
					maxBright = bright;
					maxDim = dim;

					// Build light configuration using template values or item values
					brightestLight = {
						bright: bright,
						dim: dim,
						angle: lightTemplate?.angle ?? item.system.light.angle ?? 360,
						color: lightTemplate?.color ?? item.system.light.color,
						alpha: lightTemplate?.alpha ?? item.system.light.alpha ?? 0.5,
						animation: lightTemplate?.animation ?? item.system.light.animation ?? {},
						darkness: item.system.light.darkness ?? {},
						attenuation: lightTemplate?.attenuation
							?? item.system.light.attenuation ?? 0.5,
						luminosity: lightTemplate?.luminosity
							?? item.system.light.luminosity ?? 0.5,
						saturation: lightTemplate?.saturation ?? item.system.light.saturation ?? 0,
						contrast: lightTemplate?.contrast ?? item.system.light.contrast ?? 0,
						shadows: lightTemplate?.shadows ?? item.system.light.shadows ?? 0,
						coloration: lightTemplate?.coloration ?? item.system.light.coloration ?? 1,
					};
				}
			}
		}
	}

	return brightestLight;
}

/**
 * Sync party token lights with the brightest light from party members
 * @param {Actor} partyActor - The party actor
 */
export async function syncPartyTokenLight(partyActor) {

	// Check if this is a party by looking for the members flag
	const hasMembers = partyActor?.getFlag(MODULE_ID, "members");

	if (!partyActor || !hasMembers) {
		console.warn(
			`${MODULE_ID} | syncPartyTokenLight: Not a party actor (no members flag)`, partyActor
		);
		return;
	}

	// Get the brightest light from party members
	const brightestLight = await getBrightestPartyLight(partyActor);

	// Find all tokens for this party actor on the current scene
	const partyTokens = canvas?.tokens?.placeables
		?.filter(t => t.actor?.id === partyActor.id) ?? [];

	if (partyTokens.length === 0) {
		return;
	}

	// Update each party token
	for (const token of partyTokens) {
		const updates = {};

		if (brightestLight) {
			// Enable light with brightest source configuration
			updates["light.dim"] = brightestLight.dim;
			updates["light.bright"] = brightestLight.bright;
			updates["light.angle"] = brightestLight.angle;
			updates["light.color"] = brightestLight.color;
			updates["light.alpha"] = brightestLight.alpha;
			updates["light.animation"] = brightestLight.animation;
			updates["light.darkness"] = brightestLight.darkness;
			updates["light.attenuation"] = brightestLight.attenuation;
			updates["light.luminosity"] = brightestLight.luminosity;
			updates["light.saturation"] = brightestLight.saturation;
			updates["light.contrast"] = brightestLight.contrast;
			updates["light.shadows"] = brightestLight.shadows;
			updates["light.coloration"] = brightestLight.coloration;

		}
		else {
			// No lights active - turn off party token light
			updates["light.dim"] = 0;
			updates["light.bright"] = 0;

		}

		await token.document.update(updates);
	}
}
