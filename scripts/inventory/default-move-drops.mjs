/**
 * The root's DEFAULT-MOVE ITEM DROPS section, moved verbatim.
 *
 * Makes a normal drag between actor sheets MOVE the item, with Ctrl+drag to
 * copy — the inverse of Foundry's default — by patching ActorSheet's
 * `_onDropItem`. Non-invasive: it guards on the Shadowdark system and on its
 * own `_sdxCtrlMovePatched` marker so it cannot double-patch.
 *
 * This is the ONLY thing that banner ever described. The 1,910 lines that
 * followed it in the root — light templates, NPC sheet state, sheet
 * decoration styles, and registerSettings itself — were unrelated code that
 * happened to sit underneath it, because the banner is four lines
 * (rule/title/subtitle/rule) and every section detector that assumed three
 * read it as unclosed and swallowed everything to the next banner.
 *
 * Zero registrations, so the registration snapshot is untouched.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

// ============================================
// DEFAULT-MOVE ITEM DROPS (non-invasive)
// Normal drag = move, Ctrl+drag = copy
// ============================================

export function patchCtrlMoveOnActorSheetDrops() {
	// Only relevant for Shadowdark in this module
	if (game.system.id !== "shadowdark") return;
	const ActorSheetClass = foundry.appv1?.sheets?.ActorSheet || globalThis.ActorSheet;
	if (!ActorSheetClass?.prototype?._onDropItem) return;
	const proto = ActorSheetClass.prototype;
	if (proto._sdxCtrlMovePatched) return;
	proto._sdxCtrlMovePatched = true;

	const original = proto._onDropItem;
	proto._onDropItem = async function(event, data) {
		const targetActor = this.actor;
		const ctrlCopy = Boolean(event?.ctrlKey); // Ctrl = copy, normal = move
		const sourceUuid = data?.uuid;
		let sourceItem = null;
		try {
			if (!ctrlCopy && sourceUuid) sourceItem = await fromUuid(sourceUuid);
		} catch (e) {
			// Ignore uuid resolution failures
		}

		const result = await original.call(this, event, data);

		// Default move: delete the source unless CTRL is held (copy mode).
		if (ctrlCopy) return result; // Ctrl held = copy, don't delete
		if (result === false) return result;
		if (!sourceItem || !(sourceItem instanceof Item)) return result;
		const sourceActor = sourceItem.parent;
		if (!sourceActor || !targetActor) return result;
		if (sourceActor === targetActor || sourceActor.id === targetActor.id) return result;
		// Permission safety: only owners/GM can delete
		if (!(game.user.isGM || sourceActor.isOwner || sourceItem.isOwner)) return result;

		try {
			const isContainer = sourceItem.type === "Basic" && Boolean(sourceItem.getFlag?.(MODULE_ID, "isContainer"));
			if (isContainer) {
				const children = sourceActor.items.filter(i => i.getFlag(MODULE_ID, "containerId") === sourceItem.id);
				for (const child of children) {
					await child.delete({ sdxInternal: true });
				}
				await sourceItem.delete({ sdxInternal: true });
			} else {
				await sourceItem.delete();
			}
		} catch (err) {
			console.warn(`${MODULE_ID} | Ctrl-move delete failed`, err);
		}

		return result;
	};
}
