import { MODULE_ID, DURATION_SPELL_FLAG } from "./focus-constants.mjs";

const writes = new WeakMap();

/** Unlinked token actors can share both actor and embedded item IDs. */
export function matchesDurationEffect(link, item) {
	return link.effectItemId === item.id
		&& (!link.targetActorId || link.targetActorId === item.actor?.id)
		&& (!item.actor?.isToken || link.targetTokenId === item.actor.token?.id);
}

/** Serialize read-modify-write of one caster's registry, never document deletion. */
export async function updateDurationSpells(actor, mutate) {
	const previous = writes.get(actor) ?? Promise.resolve();
	const write = previous.catch(() => {}).then(async () => {
		const entries = foundry.utils.deepClone(
			actor.getFlag(MODULE_ID, DURATION_SPELL_FLAG) || []);
		const result = mutate(entries);
		if (result !== false) await actor.setFlag(MODULE_ID, DURATION_SPELL_FLAG, entries);
		return result;
	});
	writes.set(actor, write);
	try {
		return await write;
	}
	finally {
		if (writes.get(actor) === write) writes.delete(actor);
	}
}
