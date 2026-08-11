import { placeActorTokenWithPreview } from "./party-token-placement.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";

function collectionValues(collection) {
	if (!collection) return [];
	if (Array.isArray(collection)) return collection;
	if (Array.isArray(collection.contents)) return collection.contents;
	if (typeof collection.values === "function") return [...collection.values()];
	return [...collection];
}

/**
 * Resolve the unique Player actors represented by selected canvas tokens.
 * @param {Token[]} tokens
 * @returns {Actor[]}
 */
export function getSelectedPartyMembers(tokens = globalThis.canvas?.tokens?.controlled ?? []) {
	const members = [];
	const seen = new Set();

	for (const token of tokens) {
		const actor = token?.actor;
		if (!actor?.id || actor.type !== "Player" || seen.has(actor.id)) continue;
		seen.add(actor.id);
		members.push(actor);
	}

	return members;
}

/**
 * Build the Party actor document data, including ownership inherited from the
 * selected characters' player owners.
 * @param {Actor[]} members
 * @param {Users|User[]} users
 * @param {string} partyName
 * @returns {Object}
 */
export function buildPartyActorData(members, users, partyName) {
	const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
	const ownership = { default: levels.NONE };

	for (const user of collectionValues(users)) {
		if (!user?.id || user.isGM) continue;
		const ownsMember = members.some(member => {
			try {
				return member.testUserPermission?.(user, levels.OWNER) === true;
			}
			catch{
				const permission = member.ownership?.[user.id]
					?? member.ownership?.default
					?? levels.NONE;
				return Number(permission)
					>= levels.OWNER;
			}
		});
		if (ownsMember) ownership[user.id] = levels.OWNER;
	}

	return {
		name: partyName || "Party",
		type: "Party",
		ownership,
		flags: {
			[MODULE_ID]: {
				members: members.map(member => member.id),
			},
		},
	};
}

/**
 * Create a Party actor from the currently selected Player tokens, grant its
 * players ownership, then enter click-to-place mode for the linked token.
 * Dependencies are injectable so the orchestration remains testable outside
 * Foundry; normal callers pass no arguments.
 * @returns {Promise<Actor|null>}
 */
export async function createPartyFromSelectedTokens({
	tokens = globalThis.canvas?.tokens?.controlled ?? [],
	users = globalThis.game?.users,
	partyName = globalThis.game?.settings?.get(MODULE_ID, "tray.partyName") ?? "Party",
	createActor = data => CONFIG.Actor.documentClass.create(data),
	placeToken = placeActorTokenWithPreview,
} = {}) {
	if (!globalThis.game?.user?.isGM) {
		ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.create_from_selection_gm_only"));
		return null;
	}
	if (!globalThis.canvas?.scene) {
		ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.no_scene"));
		return null;
	}

	const members = getSelectedPartyMembers(tokens);
	if (members.length === 0) {
		ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.create_from_selection_warn"));
		return null;
	}

	let partyActor;
	try {
		partyActor = await createActor(buildPartyActorData(members, users, partyName));
	}
	catch(error) {
		console.error(`${MODULE_ID} | Failed to create Party actor from selected tokens`, error);
		ui.notifications.error(game.i18n.format(
			"SHADOWDARK_EXTRAS.party.create_from_selection_failed",
			{ message: error.message }
		));
		return null;
	}
	if (!partyActor) return null;

	try {
		await placeToken(partyActor);
	}
	catch(error) {
		console.error(`${MODULE_ID} | Failed to place newly created Party token`, error);
		ui.notifications.error(game.i18n.format(
			"SHADOWDARK_EXTRAS.party.create_from_selection_place_failed",
			{ message: error.message }
		));
	}

	return partyActor;
}
