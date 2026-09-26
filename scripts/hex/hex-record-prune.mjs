/**
 * A deleted hex scene takes its hex records with it (#168).
 *
 * Every hex scene's records share one journal flag, keyed by scene id, so a
 * scene's key has to be removed by name when the scene goes; one world held
 * 4736 orphaned records under a scene id that no longer existed. setFlag
 * merges, so only a ForcedDeletion at the key's path removes it.
 */
import { HEX_JOURNAL_NAME } from "./HexTooltipSD.mjs";

const MODULE_ID = "shadowdark-extras";

/**
 * Drop the records of scenes that no longer exist. Ids with no records are
 * skipped, so the overwrite build and the deleteScene hook can both run for
 * one scene without a second write.
 * @param {string[]} sceneIds
 * @returns {Promise<number>} how many scene keys were removed
 */
export async function deleteHexSceneData(sceneIds) {
	const journal = game.journal.find(j => j.name === HEX_JOURNAL_NAME);
	const allData = journal?.getFlag(MODULE_ID, "hexData") ?? {};
	const gone = sceneIds.filter(id => Object.hasOwn(allData, id));
	if (!gone.length) return 0;
	await journal.update(Object.fromEntries(gone.map(id =>
		[`flags.${MODULE_ID}.hexData.${id}`, new foundry.data.operators.ForcedDeletion()])));
	return gone.length;
}

/** Prune a hand-deleted scene's records. Only the active GM writes, or two GMs would race. */
export function registerHexRecordPrune() {
	Hooks.on("deleteScene", scene => {
		if (game.users?.activeGM?.id !== game.user?.id) return;
		deleteHexSceneData([scene.id]).catch(err => console.warn(`${MODULE_ID} | hex record prune failed`, err));
	});
}
