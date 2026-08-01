/**
 * Pure data helpers shared by Party travel rolls and the SDX Roller.
 * Kept free of Foundry globals so roll payload behavior can be unit tested.
 */

const VALID_ABILITIES = new Set(["none", "str", "dex", "con", "int", "wis", "cha"]);

/**
 * Normalize a Shadowdark ability identifier for the SDX Roller.
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
export function normalizeSdxAbility(value, fallback = "none") {
	const normalized = String(value ?? "").trim().toLowerCase();
	if (VALID_ABILITIES.has(normalized)) return normalized;

	const normalizedFallback = String(fallback ?? "none").trim().toLowerCase();
	return VALID_ABILITIES.has(normalizedFallback) ? normalizedFallback : "none";
}

/**
 * Resolve the ability assigned to one actor in a group roll.
 * Legacy/general rolls fall back to the single shared ability.
 * @param {Object} rollData
 * @param {string} actorUuid
 * @returns {string}
 */
export function getSdxActorAbility(rollData = {}, actorUuid = "") {
	const fallback = normalizeSdxAbility(rollData.ability);
	return normalizeSdxAbility(rollData.actorAbilities?.[actorUuid], fallback);
}

/**
 * Determine whether this browser client owns completion of an SDX roll.
 * Foundry user IDs are not sufficient here because the same GM can have
 * multiple connected tabs, each of which receives the same socket update.
 * @param {Object} rollData
 * @param {string} clientId
 * @returns {boolean}
 */
export function isSdxRollAuthority(rollData = {}, clientId = "") {
	const authorityClientId = String(rollData.authorityClientId ?? "").trim();
	const normalizedClientId = String(clientId ?? "").trim();
	return authorityClientId !== "" && authorityClientId === normalizedClientId;
}

/**
 * Build a cinematic SDX roll payload for one configured Party travel task.
 * @param {Object} task
 * @param {Actor[]} actors
 * @param {Object<string, number>} selections Selection indices keyed by member ID/UUID
 * @param {number} dc
 * @returns {Object}
 */
export function buildTravelTaskRollData(task, actors, selections = {}, dc = 12) {
	const taskAbilities = (task?.abilities ?? [])
		.map(ability => normalizeSdxAbility(ability))
		.filter(ability => ability !== "none");
	const fallbackAbility = taskAbilities[0] ?? "none";
	const actorAbilities = {};
	const actorUuids = [];

	for (const actor of actors ?? []) {
		const uuid = String(actor?.uuid ?? "").trim();
		if (!uuid) continue;

		const memberKey = uuid.startsWith("Compendium.") ? uuid : String(actor.id ?? uuid);
		const rawSelection = Number(selections?.[memberKey] ?? 0);
		const selectionIndex = Number.isInteger(rawSelection) && rawSelection >= 0 ? rawSelection : 0;
		actorUuids.push(uuid);
		actorAbilities[uuid] = taskAbilities[selectionIndex] ?? fallbackAbility;
	}

	return {
		actors: actorUuids,
		contestants: [],
		ability: fallbackAbility,
		abilityLabel: fallbackAbility === "none" ? "None" : fallbackAbility.toUpperCase(),
		actorAbilities,
		dc: Number.isFinite(Number(dc)) ? Number(dc) : 12,
		showDc: false,
		hideNames: false,
		useAverage: false,
		customLabel: String(task?.name ?? "Travel Activity"),
		activityDescription: String(task?.description ?? "").trim(),
		bannerImage: String(task?.bannerImage ?? "").trim(),
		activityKey: String(task?.key ?? ""),
	};
}

export { VALID_ABILITIES };
