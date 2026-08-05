// Party drag, drop and item transfer — extracted from
// scripts/party/PartySheetSD.mjs (Phase 5.3 split). Prototype mixin: member
// reordering, actors and items dropped onto the sheet, container awareness,
// and the slot accounting that moving an item between actors depends on.
// Merged via Object.assign(PartySheetSD.prototype, PartyDropTransfer).

import { MODULE_ID } from "../shared/module-id.mjs";
import { getMaskedItemName, isItemUnidentified } from "./party-unidentified.mjs";

/**
 * The prototype these overrides fall back to.
 *
 * These methods override ActorSheet's drag/drop entry points and used to call
 * `super` from inside the class body. They are now object-literal methods
 * merged onto the prototype with Object.assign, and `super` in an object
 * literal resolves against that literal's prototype — Object.prototype — not
 * the sheet's base class, so every fallback path would throw TypeError.
 *
 * Resolved at call time, not at module load, because `foundry` does not exist
 * when this module is imported under node:test. The expression is the same one
 * PartySheetSD extends.
 */
function baseSheetPrototype() {
	return (foundry.appv1?.sheets?.ActorSheet ?? ActorSheet).prototype;
}

export const PartyDropTransfer = {
	/**
	 * Check if current user can move a member in travel assignments
	 * @param {Object} memberData - Member data object
	 * @returns {boolean}
	 */
	_canUserMoveMember(memberData) {
		if (game.user.isGM) return true;
		if (!memberData) return false;
		// Check if user owns the actor
		const actor = game.actors.get(memberData.id);
		return actor?.isOwner ?? false;
	},

	_onDragStart(event) {
		const target = event.currentTarget;

		// Check if this is a member being dragged (for dropping on canvas to create token)
		if (target.classList.contains("member") || target.closest(".member") || target.classList.contains("sdx-task-member") || target.closest(".sdx-task-member")) {
			const memberEl = target.closest(".member") || target.closest(".sdx-task-member");
			const uuid = memberEl?.dataset?.uuid;

			if (uuid) {
				// Set drag data as Actor type so Foundry creates a token on canvas drop
				const dragData = {
					type: "Actor",
					uuid: uuid,
				};
				event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
				return;
			}
		}

		// Fall back to default behavior for items
		return baseSheetPrototype()._onDragStart.call(this, event);
	},

	/** @inheritdoc */
	async _onDrop(event) {
		const uxTextEditor = foundry?.applications?.ux?.TextEditor?.implementation;
		const getDragEventData = uxTextEditor?.getDragEventData ?? TextEditor.getDragEventData;
		const data = getDragEventData(event);

		// Handle drop on travel task
		const travelTarget = event.target.closest(".sdx-camping-task");
		if (travelTarget && data?.type === "Actor") {
			event.preventDefault(); // Stop propagation
			const taskKey = travelTarget.dataset.taskKey;

			if (!taskKey) return;

			// Get the actor
			const dropped = data.uuid ? await fromUuid(data.uuid) : game.actors.get(data.id);
			if (!dropped) return;

			// Check if actor is in party
			// Use UUID for compendium actors, ID for world actors to match storage
			const isCompendiumActor = dropped.uuid?.startsWith("Compendium.");
			const memberKey = isCompendiumActor ? dropped.uuid : dropped.id;

			if (!this.memberIds.includes(memberKey)) {
				ui.notifications.warn(
					game.i18n.localize("SHADOWDARK_EXTRAS.party.travel.warn_not_member")
				);
				return;
			}

			// Check ownership
			if (!dropped.isOwner && !game.user.isGM) {
				ui.notifications.warn(
					game.i18n.localize("SHADOWDARK_EXTRAS.party.travel.warn_not_owner")
				);
				return;
			}

			// Assign to task
			await this._assignMemberToTask(taskKey, memberKey);
			return;
		}

		if (data?.type === "Actor") {
			if (!this.actor.isOwner) return;
			const dropped = data.uuid ? await fromUuid(data.uuid) : game.actors.get(data.id);
			if (!dropped) return;
			if (dropped.type !== "Player" && dropped.type !== "NPC") return;
			if (dropped.id === this.actor.id) return;

			// Use UUID for compendium actors, ID for world actors
			// Compendium UUIDs contain "Compendium." prefix
			const isCompendiumActor = dropped.uuid?.startsWith("Compendium.");
			const memberKey = isCompendiumActor ? dropped.uuid : dropped.id;

			// Check if already a member - handle reordering
			if (this.memberIds.includes(memberKey)) {
				const targetMemberEl = event.target.closest(".member");
				if (targetMemberEl) {
					const targetKey = targetMemberEl.dataset.memberId;
					if (targetKey && targetKey !== memberKey) {
						await this._reorderMember(memberKey, targetKey);
					}
				}
				return;
			}

			// Enforce sorting on add (Players first)
			// We need to fetch all members to sort them
			const currentMembers = await this.getMembers();
			const newMember = dropped;
			const allMembers = [...currentMembers, newMember];

			allMembers.sort((a, b) => {
				if (a.type === "Player" && b.type === "NPC") return -1;
				if (a.type === "NPC" && b.type === "Player") return 1;
				return 0;
			});

			const nextIds = allMembers.map(m => m.uuid?.startsWith("Compendium.") ? m.uuid : m.id);

			await this.actor.setFlag(MODULE_ID, "members", nextIds);
			if (dropped.type === "NPC") {
				const counts = this._getNpcSpawnCounts();
				// Use the same key for NPC spawn counts
				if (counts[memberKey] === undefined) await this._setNpcSpawnFormula(memberKey, "1");
			}
			return;
		}

		return baseSheetPrototype()._onDrop.call(this, event);
	},

	/**
	 * Reorder a member in the list
	 * @param {string} sourceKey
	 * @param {string} targetKey
	 */
	async _reorderMember(sourceKey, targetKey) {
		const members = await this.getMembers();
		const sourceIndex = members.findIndex(m => (m.uuid === sourceKey || m.id === sourceKey));
		if (sourceIndex === -1) return;

		const sourceMember = members[sourceIndex];

		// Remove source
		members.splice(sourceIndex, 1);

		// Find target index in the array without source
		// We need to check uuid or id
		const targetIndex = members.findIndex(m => (m.uuid === targetKey || m.id === targetKey));

		if (targetIndex !== -1) {
			members.splice(targetIndex, 0, sourceMember);
		}
		else {
			members.push(sourceMember);
		}

		// Enforce Player -> NPC sorting
		members.sort((a, b) => {
			if (a.type === "Player" && b.type === "NPC") return -1;
			if (a.type === "NPC" && b.type === "Player") return 1;
			return 0;
		});

		const nextIds = members.map(m => m.uuid?.startsWith("Compendium.") ? m.uuid : m.id);
		await this.actor.setFlag(MODULE_ID, "members", nextIds);
	},

	/**
	 * Handle dropping an actor onto the party sheet
	 * @inheritdoc
	 */
	async _onDropActor(event, data) {
		if (!this.actor.isOwner) return false;

		const actor = await fromUuid(data.uuid);
		if (!actor) return false;

		// Only allow Player and NPC type actors
		if (actor.type !== "Player" && actor.type !== "NPC") {
			ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.only_players"));
			return false;
		}

		// Use UUID for compendium actors, ID for world actors
		const isCompendiumActor = actor.uuid?.startsWith("Compendium.");
		const memberKey = isCompendiumActor ? actor.uuid : actor.id;

		// Check if actor is already a member
		const memberIds = this.memberIds;
		if (memberIds.includes(memberKey)) {
			ui.notifications.info(
				game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.already_member")
			);
			return false;
		}

		// Add member
		memberIds.push(memberKey);
		await this.actor.setFlag(MODULE_ID, "members", memberIds);

		// Set NPC spawn formula if NPC
		if (actor.type === "NPC") {
			const counts = this._getNpcSpawnCounts();
			if (counts[memberKey] === undefined) await this._setNpcSpawnFormula(memberKey, "1");
		}

		ui.notifications.info(
			game.i18n.format("SHADOWDARK_EXTRAS.party.member_added", { name: actor.name })
		);
		return true;
	},

	/**
	 * Handle dropping an item onto the party sheet
	 * @inheritdoc
	 */
	async _onDropItem(event, data) {
		if (!this.actor.isOwner) return false;

		const item = await fromUuid(data.uuid);
		if (!item) return false;

		// Check if item is being dropped on a member (for transfer)
		const memberElement = event.target.closest(".member[data-uuid]");
		if (memberElement) {
			const memberUuid = memberElement.dataset.uuid;
			const member = await fromUuid(memberUuid);
			if (member && member.isOwner) {
				const move = item.parent === this.actor;
				await this._transferItemToActor(item, member, { move });

				// Mask item name if unidentified and user is not GM
				const displayName = (isItemUnidentified(item) && !game.user.isGM)
					? getMaskedItemName(item)
					: item.name;

				ui.notifications.info(
					game.i18n.format("SHADOWDARK_EXTRAS.party.item_transferred", {
						item: displayName,
						member: member.name,
					})
				);
				return true;
			}
		}

		// Standard item drop to party inventory
		return baseSheetPrototype()._onDropItem.call(this, event, data);
	},

	_isContainerItem(item) {
		return item?.type === "Basic" && Boolean(item.getFlag?.(MODULE_ID, "isContainer"));
	},

	_getContainedItems(containerItem) {
		const actor = containerItem?.parent;
		if (!actor) return [];
		return actor.items.filter(i => i.getFlag(MODULE_ID, "containerId") === containerItem.id);
	},

	_calculateSlotsFromItemData(itemData) {
		const system = itemData?.system ?? {};
		const qty = Math.max(0, Number(system.quantity ?? 1) || 0);
		const perSlot = Math.max(1, Number(system.slots?.per_slot ?? 1) || 1);
		const slotsUsed = Math.max(0, Number(system.slots?.slots_used ?? 1) || 0);
		return Math.ceil(qty / perSlot) * slotsUsed;
	},

	async _transferItemToActor(item, targetActor, { move }) {
		if (!item || !targetActor) return;
		const targetIsItemPiles = Boolean(targetActor.getFlag?.("item-piles", "data")?.enabled);

		// Non-container: default behavior
		if (!this._isContainerItem(item) || !item.parent) {
			const itemData = item.toObject();
			await targetActor.createEmbeddedDocuments("Item", [itemData]);
			if (move) await item.delete();
			return;
		}

		// Container transfer/copy
		const contained = this._getContainedItems(item);
		const containerData = item.toObject();
		// Clear the packed items to prevent the createItem hook from unpacking them
		// (we will manually create the contained items from the source actor's embedded items)
		if (containerData.flags?.[MODULE_ID]) {
			containerData.flags[MODULE_ID].containerPackedItems = [];
			// Also clear the unpacked flags
			delete containerData.flags[MODULE_ID].containerUnpacked;
			delete containerData.flags[MODULE_ID].containerUnpackedOnActor;
		}
		const [createdContainer] = await targetActor.createEmbeddedDocuments(
			"Item", [containerData]
		);
		if (!createdContainer) {
			if (move) return;
			return;
		}

		const childData = contained.map(child => {
			const data = child.toObject();
			data.flags = data.flags ?? {};
			data.flags[MODULE_ID] = data.flags[MODULE_ID] ?? {};
			data.flags[MODULE_ID].containerId = createdContainer.id;
			// Keep hidden while contained
			data.system = data.system ?? {};
			data.system.isPhysical = false;
			// Ensure we can restore if removed later
			if (data.flags[MODULE_ID].containerOrigIsPhysical === undefined) {
				data.flags[MODULE_ID].containerOrigIsPhysical = true;
			}
			// Let Foundry assign fresh IDs
			delete data._id;
			return data;
		});

		// If the target is an Item Piles actor, do not create embedded contained items.
		// Keep contents packed on the container item only.
		if (!targetIsItemPiles && childData.length) {
			await targetActor.createEmbeddedDocuments("Item", childData, { sdxInternal: true });
		}

		// For Item Piles targets, restore the packed items since we cleared them
		if (targetIsItemPiles && contained.length) {
			// Rebuild packed data from source contained items
			const packedData = contained.map(child => {
				const data = child.toObject();
				delete data._id;
				data.flags = data.flags ?? {};
				data.flags[MODULE_ID] = data.flags[MODULE_ID] ?? {};
				data.flags[MODULE_ID].containerId = null;
				data.system = data.system ?? {};
				data.system.isPhysical = false;
				return data;
			});
			await createdContainer.setFlag(MODULE_ID, "containerPackedItems", packedData);
		}

		// Update container slot cost to reflect contents
		const baseSlotsUsed = Number(createdContainer.system?.slots?.slots_used ?? 1) || 1;
		const containedSlots = childData.reduce(
			(sum, d) => sum + this._calculateSlotsFromItemData(d), 0
		);
		await createdContainer.update({
			"system.slots.slots_used": Math.max(baseSlotsUsed, containedSlots),
		}, { sdxInternal: true });

		if (move) {
			// Delete children first so deleteItem hook doesn't try to "release" them
			for (const child of contained) {
				await child.delete({ sdxInternal: true });
			}
			await item.delete({ sdxInternal: true });
		}
	},
};
