import { MODULE_ID } from "../shared/module-id.mjs";
import { isUnidentified, getUnidentifiedName, getUnidentifiedNameFromData } from "../shared/sd4Compat.mjs";

/**
 * Container packing and slot accounting.
 *
 * Extracted from the composition root in Phase 3 step 32. This group was chosen
 * because its coupling is explicit and bounded: the two Sets below are module
 * state shared by exactly these registrations and helpers, and the transitive
 * call closure of those helpers is closed — they call no other function in the
 * root.
 *
 * The four helpers are exported because the root still has 39 call sites for
 * them. That direction is composition (root -> feature) and is allowed; the
 * reverse would be a cycle and is not.
 *
 * Registration ORDER is preserved by `registerContainerHooks()`, which the root
 * calls at the exact point the two `Hooks.on` calls used to sit.
 */

// Track containers currently being unpacked to prevent race conditions
const _containersBeingUnpacked = new Set();

// Track containers currently being recomputed to prevent recursion
const _containersBeingRecomputed = new Set();


function isContainerItem(item) {
	return Boolean(item?.getFlag(MODULE_ID, "isContainer"));
}


function isItemPilesEnabledActor(actor) {
	try {
		return Boolean(actor?.getFlag?.("item-piles", "data")?.enabled);
	}
	catch {
		return false;
	}
}


function calculateSlotsCostForItemData(itemData, { recursive = false } = {}) {
	const system = itemData?.system ?? {};
	// Packed items are stored as hidden/non-physical; assume they were meant to count unless explicitly marked otherwise.
	const originallyPhysical = itemData?.flags?.[MODULE_ID]?.containerOrigIsPhysical;
	if (originallyPhysical === false) return 0;
	if (itemData?.type === "Gem") return 0;
	if (system.stashed) return 0;

	const qty = Math.max(0, Number(system.quantity ?? 1) || 0);
	const perSlot = Math.max(1, Number(system.slots?.per_slot ?? 1) || 1);
	const freeCarry = Math.max(0, Number(system.slots?.free_carry ?? 0) || 0);

	// For containers, use base slots when recursive to avoid double-counting
	const isContainer = Boolean(itemData?.flags?.[MODULE_ID]?.isContainer);
	let slotsUsed;
	if (recursive && isContainer) {
		// Use base slots for nested containers
		const baseSlots = itemData?.flags?.[MODULE_ID]?.containerBaseSlots;
		slotsUsed = baseSlots?.slots_used ?? (Number(system.slots?.slots_used ?? 1) || 1);
	}
	else {
		slotsUsed = Math.max(0, Number(system.slots?.slots_used ?? 1) || 0);
	}

	// Calculate base slot cost for this item
	let baseSlotCost = Math.ceil(qty / perSlot) * slotsUsed;
	// Apply free carry to the item itself (but not contents)
	// Free carry of 1 means the container itself is free (0 slots)
	if (freeCarry > 0) {
		baseSlotCost = 0;
	}
	let slots = baseSlotCost;

	// If recursive and this is a container, add its nested contents
	if (recursive && isContainer) {
		const packedItems = itemData?.flags?.[MODULE_ID]?.containerPackedItems;
		if (Array.isArray(packedItems)) {
			for (const nestedData of packedItems) {
				slots += calculateSlotsCostForItemData(nestedData, { recursive: true });
			}
		}

		// Add coin weight from nested container
		const coins = itemData?.flags?.[MODULE_ID]?.containerCoins || {};
		const gp = Number(coins.gp ?? 0);
		const sp = Number(coins.sp ?? 0);
		const cp = Number(coins.cp ?? 0);
		const totalCoins = gp + sp + cp;
		const coinSlots = Math.floor(totalCoins / 100);
		slots += coinSlots;
	}

	return slots;
}


async function recomputeContainerSlots(containerItem, { skipSync = false } = {}) {
	if (!containerItem || !isContainerItem(containerItem)) return;

	// Prevent recursive recomputation
	const recomputeKey = containerItem.uuid;
	if (_containersBeingRecomputed.has(recomputeKey)) return;
	_containersBeingRecomputed.add(recomputeKey);

	try {
		await ensureContainerBaseSlots(containerItem);
		const base = containerItem.getFlag(MODULE_ID, "containerBaseSlots") || {};
		const baseSlotsUsed = Number(base.slots_used ?? 1) || 1;

		const packedOnly = !containerItem.parent || isItemPilesEnabledActor(containerItem.parent);
		let containedSlots = 0;
		if (packedOnly) {
			// Actorless containers and Item Piles actors shouldn't rely on embedded contained items.
			// Use recursive calculation to handle nested containers
			for (const data of getPackedContainedItemData(containerItem)) containedSlots += calculateSlotsCostForItemData(data, { recursive: true });
		}
		else {
			const contained = getContainedItems(containerItem);
			// calculateContainedItemSlots now handles recursion automatically
			for (const item of contained) containedSlots += calculateContainedItemSlots(item);
		}

		// Add coin weight: 1 slot per 100 coins (regardless of denomination)
		const coins = containerItem.getFlag(MODULE_ID, "containerCoins") || {};
		const gp = Number(coins.gp ?? 0);
		const sp = Number(coins.sp ?? 0);
		const cp = Number(coins.cp ?? 0);
		const totalCoins = gp + sp + cp;
		const coinSlots = Math.floor(totalCoins / 100);
		containedSlots += coinSlots;

		const nextSlotsUsed = Math.max(baseSlotsUsed, containedSlots);
		const current = Number(containerItem.system?.slots?.slots_used ?? 1) || 1;
		if (current !== nextSlotsUsed) {
			await containerItem.update({
				"system.slots.slots_used": nextSlotsUsed,
			}, { sdxInternal: true });
		}

		// Keep a packed snapshot so copies/transfers can recreate contents.
		// For packed-only containers we preserve the existing snapshot.
		// Skip syncing when unpacking to prevent doubling items.
		if (!packedOnly && !skipSync) await syncContainerPackedItems(containerItem);

		// If this container is itself inside another container, update the parent container too
		const parentContainer = getParentContainer(containerItem);
		if (parentContainer && !_containersBeingRecomputed.has(parentContainer.uuid)) {
			await recomputeContainerSlots(parentContainer, { skipSync });
		}
	}
	finally {
		_containersBeingRecomputed.delete(recomputeKey);
	}
}

/**
 * Register the container hooks. Called by the composition root in the original
 * source position, so hook registration order is unchanged.
 */
export function registerContainerHooks() {
	// Keep container slot values in sync when contained items change
	Hooks.on("updateItem", async (item, changes, options, userId) => {
		if (options?.sdxInternal) return;

		// Only the user who made the update should process it
		if (userId !== game.user.id) return;

		const actor = item?.parent;

		// If the unidentified flag changed, re-render the actor sheet
		if (changes?.flags?.[MODULE_ID]?.unidentified !== undefined && actor) {
			for (const app of Object.values(ui.windows)) {
				if (app.actor?.id === actor.id) {
					app.render();
				}
			}
		}

		if (!actor) return;

		// Skip recomputing if a container is currently being unpacked (prevents double-unpacking)
		const unpackKey = `${actor.id}-${item.id}`;
		if (_containersBeingUnpacked.has(unpackKey)) return;

		// If this item is inside a container, recompute that container (but skip sync during unpack)
		const containerId = item.getFlag(MODULE_ID, "containerId");
		if (containerId) {
			const containerUnpackKey = `${actor.id}-${containerId}`;
			const skipSync = _containersBeingUnpacked.has(containerUnpackKey);
			const container = actor.items.get(containerId);
			if (container) await recomputeContainerSlots(container, { skipSync });
			return;
		}

		// If the updated item is a container, recompute in case its contents changed.
		if (isContainerItem(item)) {
			await recomputeContainerSlots(item);
		}
	});

	// Unpack container contents when a container item is created on an actor (e.g., drag/drop transfer)
	Hooks.on("createItem", async (item, options, userId) => {
		if (options?.sdxInternal) return;

		// CRITICAL: Only the user who created the item should unpack it.
		// This prevents multi-client duplication where all connected clients try to unpack.
		if (userId !== game.user.id) return;

		const actor = item?.parent;
		if (!actor) return;
		if (!isContainerItem(item)) return;

		// Item Piles actors should not have embedded contained items (they show up as separate loot).
		// Keep contents packed on the container item and only unpack when moved to a normal actor.
		if (isItemPilesEnabledActor(actor)) return;

		// Check if this container has already been unpacked (persisted flag on the item)
		// This is more reliable than checking embedded items which might not be synced yet
		if (item.getFlag(MODULE_ID, "containerUnpackedOnActor") === actor.id) return;

		// Use a unique key for this specific container instance to prevent race conditions
		const unpackKey = `${actor.id}-${item.id}`;
		if (_containersBeingUnpacked.has(unpackKey)) return;

		// Skip if contained items already exist for this container (e.g., from explicit transfer)
		const existing = actor.items.filter(i => i.getFlag(MODULE_ID, "containerId") === item.id);
		if (existing.length > 0) {
			// Items exist but containerUnpackedOnActor might not be set - set it now to prevent issues
			if (!item.getFlag(MODULE_ID, "containerUnpackedOnActor")) {
				await item.setFlag(MODULE_ID, "containerUnpackedOnActor", actor.id);
			}
			return;
		}

		const packed = item.getFlag(MODULE_ID, "containerPackedItems");
		if (!Array.isArray(packed) || packed.length === 0) {
			// No packed items, but ensure containerUnpackedOnActor is set to prevent future issues
			if (!item.getFlag(MODULE_ID, "containerUnpackedOnActor")) {
				await item.setFlag(MODULE_ID, "containerUnpackedOnActor", actor.id);
			}
			return;
		}

		// Mark as being unpacked SYNCHRONOUSLY before any async operations
		_containersBeingUnpacked.add(unpackKey);

		try {
			const toCreate = packed.map(d => {
				const data = foundry.utils.duplicate(d);
				delete data._id;
				data.flags = data.flags ?? {};
				data.flags[MODULE_ID] = data.flags[MODULE_ID] ?? {};
				data.flags[MODULE_ID].containerId = item.id;
				data.system = data.system ?? {};
				data.system.isPhysical = false;
				if (data.flags[MODULE_ID].containerOrigIsPhysical === undefined) data.flags[MODULE_ID].containerOrigIsPhysical = true;
				return data;
			});

			await actor.createEmbeddedDocuments("Item", toCreate, { sdxInternal: true });

			// Mark this container as unpacked on this actor (persisted to database)
			// This prevents any other client from trying to unpack it again
			await item.setFlag(MODULE_ID, "containerUnpackedOnActor", actor.id);

			// Update the slot count directly
			const base = item.getFlag(MODULE_ID, "containerBaseSlots") || {};
			const baseSlotsUsed = Number(base.slots_used ?? 1) || 1;
			let containedSlots = 0;
			for (const d of packed) containedSlots += calculateSlotsCostForItemData(d);
			const coins = item.getFlag(MODULE_ID, "containerCoins") || {};
			const totalCoins = (Number(coins.gp ?? 0)) + (Number(coins.sp ?? 0)) + (Number(coins.cp ?? 0));
			containedSlots += Math.floor(totalCoins / 100);
			const nextSlotsUsed = Math.max(baseSlotsUsed, containedSlots);

			await item.update({
				"system.slots.slots_used": nextSlotsUsed,
			}, { sdxInternal: true });
		}
		finally {
			// Keep the lock active for a bit longer to let any triggered hooks complete
			// Then clear containerPackedItems to prevent any future sync from re-populating
			setTimeout(async () => {
				_containersBeingUnpacked.delete(unpackKey);
				// Clear packed items after everything has settled
				try {
					const currentItem = actor.items.get(item.id);
					if (currentItem) {
						await currentItem.setFlag(MODULE_ID, "containerPackedItems", []);
					}
				}
				catch (e) {
					// Ignore errors
				}
			}, 100);
		}
	});

	// The container half of item deletion. These two sat in the composition
	// root immediately after the `registerContainerHooks()` call, so
	// registering them at the END of this function reproduces the original
	// order exactly: updateItem, createItem, preDeleteItem, deleteItem.
	Hooks.on("preDeleteItem", releaseContainedItemsBeforeDelete);
	Hooks.on("deleteItem", recomputeSlotsAfterContainedDelete);
}

/**
 * Release contained items BEFORE their container is deleted.
 *
 * Extracted from the composition root in Phase 3 (step 39). Named functions
 * rather than the arrows they were, so the 41- and 14-line bodies keep their
 * original single-tab indentation instead of shifting by one.
 */
async function releaseContainedItemsBeforeDelete(item, options, userId) {
	if (options?.sdxInternal) return;

	// Only the user who deleted the item should release contained items
	if (userId !== game.user.id) return;

	const actor = item?.parent;
	if (!actor) return;

	// If a container item is being deleted, release all items that were inside it
	// (make them visible again in inventory) BEFORE the container is gone
	if (item.getFlag(MODULE_ID, "isContainer")) {
		const containedIds = [];
		for (const i of actor.items) {
			if (i.getFlag(MODULE_ID, "containerId") === item.id) {
				containedIds.push(i.id);
			}
		}

		if (containedIds.length > 0) {
			// Batch update all contained items to release them
			const updates = containedIds.map(id => {
				const child = actor.items.get(id);
				if (!child) return null;
				const restorePhysical = child.getFlag(MODULE_ID, "containerOrigIsPhysical");
				return {
					_id: id,
					"system.isPhysical": (restorePhysical === undefined) ? true : Boolean(restorePhysical),
					[`flags.${MODULE_ID}.containerId`]: null,
					[`flags.${MODULE_ID}.containerOrigIsPhysical`]: null,
				};
			}).filter(u => u !== null);

			if (updates.length > 0) {
				try {
					await actor.updateEmbeddedDocuments("Item", updates, { sdxInternal: true });
				}
				catch (e) {
					console.warn(`${MODULE_ID} | Could not release contained items`, e);
				}
			}
		}
	}
}

/** Recompute a container's slots after one of its contained items is deleted. */
async function recomputeSlotsAfterContainedDelete(item, options, userId) {
	if (options?.sdxInternal) return;

	// Only the user who deleted the item should update container slots
	if (userId !== game.user.id) return;

	const actor = item?.parent;
	if (!actor) return;

	// If a contained item was deleted, update its container slots.
	const containerId = item.getFlag(MODULE_ID, "containerId");
	if (containerId) {
		const container = actor.items.get(containerId);
		if (container) await recomputeContainerSlots(container);
	}
}


function getContainedItems(containerItem) {
	const actor = containerItem?.parent;
	if (!actor) return [];
	return actor.items.filter(i => i.getFlag(MODULE_ID, "containerId") === containerItem.id);
}

function getParentContainer(item) {
	const containerId = item?.getFlag(MODULE_ID, "containerId");
	if (!containerId) return null;
	const actor = item?.parent;
	if (!actor) return null;
	return actor.items.get(containerId);
}

function getPackedContainedItemData(containerItem) {
	const packed = containerItem?.getFlag?.(MODULE_ID, "containerPackedItems");
	return Array.isArray(packed) ? packed : [];
}

function calculateSlotsCostForItem(item, { ignoreIsPhysical = false } = {}) {
	// Mirror the simple Shadowdark slot math used elsewhere in this module:
	// cost = ceil(qty / per_slot) * slots_used
	const system = item?.system ?? {};
	if (!ignoreIsPhysical && !system.isPhysical) return 0;
	if (item?.type === "Gem") return 0;
	if (system.stashed) return 0;

	const qty = Math.max(0, Number(system.quantity ?? 1) || 0);
	const perSlot = Math.max(1, Number(system.slots?.per_slot ?? 1) || 1);
	const slotsUsed = Math.max(0, Number(system.slots?.slots_used ?? 1) || 0);
	return Math.ceil(qty / perSlot) * slotsUsed;
}

function calculateContainedItemSlots(item) {
	// Contained items are forcibly set to non-physical to hide them; for container math we
	// treat them as physical only if they originally were.
	const originallyPhysical = item?.getFlag?.(MODULE_ID, "containerOrigIsPhysical");
	if (originallyPhysical === false) return 0;

	// For containers, use base slots to avoid double-counting
	let slots;
	if (isContainerItem(item)) {
		// Use base slots for nested containers
		const baseSlots = item.getFlag(MODULE_ID, "containerBaseSlots");
		if (baseSlots) {
			const qty = Math.max(0, Number(item.system?.quantity ?? 1) || 0);
			const perSlot = Math.max(1, Number(baseSlots.per_slot ?? 1) || 1);
			const baseSlotsUsed = Math.max(0, Number(baseSlots.slots_used ?? 1) || 0);
			const freeCarry = Math.max(0, Number(item.system?.slots?.free_carry ?? 0) || 0);
			let baseSlotCost = Math.ceil(qty / perSlot) * baseSlotsUsed;
			// Apply free carry to the container itself (but not contents)
			// Free carry of 1 means the container itself is free (0 slots)
			if (freeCarry > 0) {
				baseSlotCost = 0;
			}
			slots = baseSlotCost;
		}
		else {
			slots = calculateSlotsCostForItem(item, { ignoreIsPhysical: true });
		}
	}
	else {
		slots = calculateSlotsCostForItem(item, { ignoreIsPhysical: true });
	}

	// If this item is itself a container, recursively add its contained items' slots
	if (isContainerItem(item)) {
		const actor = item.parent;
		const packedOnly = !actor || isItemPilesEnabledActor(actor);

		if (packedOnly) {
			// Use packed data for actorless or Item Piles containers
			for (const data of getPackedContainedItemData(item)) {
				slots += calculateSlotsCostForItemData(data, { recursive: true });
			}
		}
		else {
			// Use embedded items for normal actors
			const contained = getContainedItems(item);
			for (const nestedItem of contained) {
				slots += calculateContainedItemSlots(nestedItem);
			}
		}

		// Add coin weight from nested container
		const coins = item.getFlag(MODULE_ID, "containerCoins") || {};
		const gp = Number(coins.gp ?? 0);
		const sp = Number(coins.sp ?? 0);
		const cp = Number(coins.cp ?? 0);
		const totalCoins = gp + sp + cp;
		const coinSlots = Math.floor(totalCoins / 100);
		slots += coinSlots;
	}

	return slots;
}

async function ensureContainerBaseSlots(containerItem) {
	if (!containerItem) return;
	const existing = containerItem.getFlag(MODULE_ID, "containerBaseSlots");
	if (existing && typeof existing === "object") return;
	const base = {
		slots_used: Number(containerItem.system?.slots?.slots_used ?? 1) || 1,
		per_slot: Number(containerItem.system?.slots?.per_slot ?? 1) || 1,
		max: Number(containerItem.system?.slots?.max ?? 1) || 1,
	};
	await containerItem.setFlag(MODULE_ID, "containerBaseSlots", base);
}

async function syncContainerPackedItems(containerItem) {
	if (!containerItem || !isContainerItem(containerItem) || !containerItem.parent) return;
	if (isItemPilesEnabledActor(containerItem.parent)) return;
	const contained = getContainedItems(containerItem);
	const packed = contained.map(i => {
		const data = i.toObject();
		// Store as a template for recreation on another actor
		delete data._id;
		data.flags = data.flags ?? {};
		data.flags[MODULE_ID] = data.flags[MODULE_ID] ?? {};
		// ContainerId will be rewritten on unpack
		data.flags[MODULE_ID].containerId = null;
		// Clear the unpacked flag so it can be unpacked when copied to another actor
		delete data.flags[MODULE_ID].containerUnpacked;
		// Clear the actor-specific unpack flag
		delete data.flags[MODULE_ID].containerUnpackedOnActor;
		// Ensure it stays hidden when recreated
		data.system = data.system ?? {};
		data.system.isPhysical = false;
		return data;
	});
	// Use update with sdxInternal to prevent hook recursion
	await containerItem.update({
		[`flags.${MODULE_ID}.containerPackedItems`]: packed,
	}, { sdxInternal: true });
	// Clear the unpacked flag on the current container since we just synced
	if (containerItem.getFlag(MODULE_ID, "containerUnpacked")) {
		await containerItem.update({
			[`flags.${MODULE_ID}.-=containerUnpacked`]: null,
		}, { sdxInternal: true });
	}
}


// ============================================
// BASIC ITEM CONTAINERS (non-invasive)
// ============================================
//
// Moved from the composition root in Phase 3. These twelve functions called
// eight of the helpers above directly, so co-locating them turns eight
// cross-module imports into local calls. Four are exported because the sheet
// dispatchers still in the root call them.

function isBasicItem(item) {
	return item?.type === "Basic";
}


/**
 * SD 4.x made `isPhysical` a hardcoded getter, so setting it to false via
 * item.update() no longer hides items from inventory. Patch getPhysicalItems()
 * on the base data-model prototype to also exclude items that have a containerId
 * (i.e. are stored inside an SDX container).
 */
function patchGetPhysicalItemsForContainers() {
	const PlayerSD = CONFIG.Actor.dataModels?.Player;
	if (!PlayerSD) return;

	// Walk up to ActorBaseSD (the prototype that defines getPhysicalItems) so the
	// patch applies to both PlayerSD and NpcSD in a single write.
	const baseProto = Object.getPrototypeOf(PlayerSD.prototype);
	const target = (typeof baseProto?.getPhysicalItems === "function") ? baseProto : PlayerSD.prototype;

	if (!target.getPhysicalItems || target.__sdxContainerItemsPatched) return;

	const _original = target.getPhysicalItems;
	target.getPhysicalItems = function(group = true) {
		return _original.call(this, group).filter(
			i => !i.getFlag(MODULE_ID, "containerId")
		);
	};
	target.__sdxContainerItemsPatched = true;
}

function getPackedKeyFromItemData(itemData) {
	return itemData?.flags?.[MODULE_ID]?.packedKey ?? null;
}

function ensurePackedKeyOnItemData(itemData) {
	itemData.flags = itemData.flags ?? {};
	itemData.flags[MODULE_ID] = itemData.flags[MODULE_ID] ?? {};
	if (!itemData.flags[MODULE_ID].packedKey) itemData.flags[MODULE_ID].packedKey = foundry.utils.randomID();
	return itemData.flags[MODULE_ID].packedKey;
}

async function packItemToContainerData(sourceItem) {
	if (!sourceItem || !(sourceItem instanceof Item)) return null;
	// If the source is a container owned by a normal actor, ensure its packed snapshot is current before copying.
	try {
		if (isContainerItem(sourceItem) && sourceItem.parent && !isItemPilesEnabledActor(sourceItem.parent)) {
			await syncContainerPackedItems(sourceItem);
		}
	}
	catch {
		// Ignore snapshot refresh errors
	}

	const data = foundry.utils.duplicate(sourceItem.toObject());
	delete data._id;
	// Remove relationships that don't make sense outside ownership contexts
	data.flags = data.flags ?? {};
	data.flags[MODULE_ID] = data.flags[MODULE_ID] ?? {};
	// ContainerId will be rewritten on unpack/contain
	data.flags[MODULE_ID].containerId = null;
	// Clear the unpacked flag so the container can be unpacked on the new actor
	delete data.flags[MODULE_ID].containerUnpacked;
	// Clear the "unpacked on actor" flag so it can be unpacked on a different actor
	delete data.flags[MODULE_ID].containerUnpackedOnActor;
	// Ensure packed entries have a stable key for UI removal
	ensurePackedKeyOnItemData(data);
	return data;
}


async function restoreContainerBaseSlots(containerItem) {
	if (!containerItem) return;
	const base = containerItem.getFlag(MODULE_ID, "containerBaseSlots");
	if (!base || typeof base !== "object") return;
	await containerItem.update({
		"system.slots.slots_used": Number(base.slots_used ?? 1) || 1,
		"system.slots.per_slot": Number(base.per_slot ?? 1) || 1,
		"system.slots.max": Number(base.max ?? 1) || 1,
	}, { sdxInternal: true });
}


async function setContainedState(item, containerId) {
	if (!item) return;
	const makeContained = Boolean(containerId);
	const actor = item.parent;
	const previousContainerId = item.getFlag(MODULE_ID, "containerId");
	const isItemPilesActor = isItemPilesEnabledActor(actor);

	if (makeContained) {
		// Preserve original isPhysical so we can restore.
		const origPhysical = item.getFlag(MODULE_ID, "containerOrigIsPhysical");
		if (origPhysical === undefined) {
			await item.setFlag(MODULE_ID, "containerOrigIsPhysical", Boolean(item.system?.isPhysical));
		}
		await item.update({
			"system.isPhysical": false,
			[`flags.${MODULE_ID}.containerId`]: containerId,
			// If the item is on an Item Piles actor, also hide it from the Item Piles UI
			...(isItemPilesActor ? { "flags.item-piles.item.hidden": true } : {}),
		}, { sdxInternal: true });
		const container = actor?.items?.get(containerId);
		if (container) {
			// Mark container as unpacked on this actor to prevent duplicate unpack attempts
			if (actor && !container.getFlag(MODULE_ID, "containerUnpackedOnActor")) {
				await container.setFlag(MODULE_ID, "containerUnpackedOnActor", actor.id);
			}
			await recomputeContainerSlots(container);
		}
		return;
	}

	// Remove from container: restore physical state
	const restorePhysical = item.getFlag(MODULE_ID, "containerOrigIsPhysical");
	await item.update({
		"system.isPhysical": (restorePhysical === undefined) ? true : Boolean(restorePhysical),
		[`flags.${MODULE_ID}.containerId`]: null,
		[`flags.${MODULE_ID}.containerOrigIsPhysical`]: null,
		...(isItemPilesActor ? { "flags.item-piles.item.hidden": false } : {}),
	}, { sdxInternal: true });
	await item.unsetFlag(MODULE_ID, "containerId");
	await item.unsetFlag(MODULE_ID, "containerOrigIsPhysical");
	// Refresh the container we removed it from
	if (actor && previousContainerId) {
		const container = actor.items.get(previousContainerId);
		if (container) await recomputeContainerSlots(container);
	}
}

async function setItemContainerId(item, containerId) {
	if (!item) return;
	if (containerId) return item.setFlag(MODULE_ID, "containerId", containerId);
	return item.unsetFlag(MODULE_ID, "containerId");
}

function injectBasicContainerUI(app, html) {
	// Check if containers are enabled
	if (!game.settings.get(MODULE_ID, "enableContainers")) return;

	const item = app?.item;
	if (!isBasicItem(item)) return;

	// Only for Shadowdark system
	if (game.system.id !== "shadowdark") return;

	// De-dupe on re-render
	html.find(".sdx-container-toggle").remove();
	html.find(".sdx-container-box").remove();

	const detailsTab = html.find('.tab[data-tab="details"], .tab[data-tab="tab-details"], .tab.details').first();
	if (!detailsTab.length) return;

	const isOwned = Boolean(item.parent);
	const isEditable = Boolean(app.isEditable);
	const labelSlots = (game.i18n.localize("SHADOWDARK.inventory.slots") || "Slots").toLowerCase();
	let slotsBox = null;

	// Try to find the SLOTS box to add the toggle under it
	detailsTab.find(".SD-box").each(function() {
		const label = $(this).find(".header label").first().text().trim().toLowerCase();
		if (label && (label === labelSlots || label.includes(labelSlots))) {
			slotsBox = $(this);
			return false;
		}
	});

	const containerLabel = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.is_container");
	const containerHint = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.is_container_hint");
	const toggleHtml = `
		<div class="sdx-container-toggle">
			<label title="${foundry.utils.escapeHTML(containerHint)}">${foundry.utils.escapeHTML(containerLabel)}</label>
			<input type="checkbox" ${isContainerItem(item) ? "checked" : ""} ${isEditable ? "" : "disabled"} />
		</div>
	`;

	if (slotsBox?.length) {
		slotsBox.find(".content").first().append(toggleHtml);
	}
	else {
		// Fallback: append to the top of Details
		detailsTab.prepend(toggleHtml);
	}

	// Bind toggle
	const toggle = html.find(".sdx-container-toggle input[type=checkbox]").first();
	toggle.on("change", async (ev) => {
		if (!isEditable) return;
		const enabled = Boolean(ev.currentTarget.checked);

		// Check if trying to make this a container while it's inside another container
		if (enabled) {
			const allowNestedContainers = game.settings.get(MODULE_ID, "enableNestedContainers");
			const containerId = item.getFlag(MODULE_ID, "containerId");
			if (!allowNestedContainers && containerId) {
				ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.item.container.nested_not_allowed"));
				ev.currentTarget.checked = false;
				return;
			}
		}

		await item.setFlag(MODULE_ID, "isContainer", enabled);

		// If disabling, release contained items and restore base slots
		if (!enabled && item.parent) {
			const contained = getContainedItems(item);
			for (const child of contained) {
				await setContainedState(child, null);
			}
			await restoreContainerBaseSlots(item);
		}

		app.render();
	});

	// Handle container-specific slot field modifications
	if (isContainerItem(item)) {
		// Disable per_slot input for containers (always 1)
		const perSlotInput = html.find('input[name="system.slots.per_slot"]');
		if (perSlotInput.length) {
			perSlotInput.prop("disabled", true);
			perSlotInput.css("opacity", "0.5");
			perSlotInput.attr("title", "Cannot edit for containers");
		}

		// Replace free_carry number input with checkbox
		const freeCarryInput = html.find('input[name="system.slots.free_carry"]');
		if (freeCarryInput.length) {
			const currentValue = Number(item.system?.slots?.free_carry ?? 0);
			const isChecked = currentValue > 0;
			const freeCarryLabel = freeCarryInput.closest(".SD-grid").find("h3").filter(function() {
				return $(this).text().trim().toLowerCase().includes("free");
			});

			const checkboxHtml = `
				<input type="checkbox"
					data-sdx-free-carry
					${isChecked ? "checked" : ""}
					${isEditable ? "" : "disabled"}
					style="width: auto; height: auto;"
				/>
			`;

			freeCarryInput.replaceWith(checkboxHtml);

			// Bind checkbox change event
			html.find("[data-sdx-free-carry]").on("change", async (ev) => {
				if (!isEditable) return;
				const checked = ev.currentTarget.checked;
				// Set to 1 if checked, 0 if unchecked
				await item.update({ "system.slots.free_carry": checked ? 1 : 0 });
			});
		}
	}

	// Only render contents area when enabled
	if (!isContainerItem(item)) return;

	const title = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.contents_title");
	const dropHint = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.drop_hint");
	const removeTip = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.remove_tooltip");
	const slotsLabel = game.i18n.localize("SHADOWDARK.inventory.slots") || "Slots";

	const onItemPilesActor = isItemPilesEnabledActor(item.parent);
	const packedOnly = !isOwned || onItemPilesActor;
	const contained = packedOnly ? [] : getContainedItems(item);
	const packed = packedOnly ? getPackedContainedItemData(item) : [];

	// Track totals for GP, CP, SP
	let totalGP = 0;
	let totalCP = 0;
	let totalSP = 0;

	const rows = (packedOnly ? packed : contained).map((entry, index) => {
		const isData = !(entry instanceof Item);
		// Check if this individual item is unidentified and mask accordingly
		const isItemUnidentified = isData
			? (entry.flags?.[MODULE_ID]?.unidentified === true)
			: isUnidentified(entry);
		const name = isItemUnidentified && !game.user?.isGM
			? (isData ? getUnidentifiedNameFromData(entry) : getUnidentifiedName(entry))
			: (isData ? (entry.name ?? "") : entry.name);
		const img = isData ? (entry.img ?? "") : entry.img;
		const qty = Number(entry.system?.quantity ?? 1);
		// Use recursive calculation to show total slots including nested container contents
		const slots = isData ? calculateSlotsCostForItemData(entry, { recursive: true }) : calculateContainedItemSlots(entry);
		const packedKey = isData ? (getPackedKeyFromItemData(entry) ?? String(index)) : null;

		// Extract cost values
		const costGP = Number(entry.system?.cost?.gp ?? 0);
		const costCP = Number(entry.system?.cost?.cp ?? 0);
		const costSP = Number(entry.system?.cost?.sp ?? 0);

		// Add to totals (multiplied by quantity)
		totalGP += costGP * qty;
		totalCP += costCP * qty;
		totalSP += costSP * qty;

		const liAttrs = isData
			? `data-packed-key="${foundry.utils.escapeHTML(String(packedKey))}"`
			: `data-item-id="${entry.id}"`;
		const canRemove = isEditable && !onItemPilesActor;
		const removeAction = canRemove ? `<a class=\"fa-solid fa-xmark\" data-action=\"remove-from-container\" title=\"${foundry.utils.escapeHTML(removeTip)}\"></a>` : "";
		return `
			<li class="item" ${liAttrs}>
				<div class="item-image" style="background-image: url(${img})" data-action="open-item"></div>
				<a class="item-name" data-action="open-item">${foundry.utils.escapeHTML(name)}</a>
				<div class="quantity">${Number.isFinite(qty) ? qty : ""}</div>
				<div class="cost-gp">${costGP > 0 ? costGP : ""}</div>
				<div class="cost-sp">${costSP > 0 ? costSP : ""}</div>
				<div class="cost-cp">${costCP > 0 ? costCP : ""}</div>
				<div class="slots">${Number.isFinite(slots) ? slots : ""}</div>
				<div class="actions">${removeAction}</div>
			</li>
		`;
	}).join("");

	// Build total row if there are items
	const totalRow = (packedOnly ? packed.length : contained.length) > 0 ? `
		<li class="item sdx-container-total">
			<div class="item-image"></div>
			<div class="item-name" style="font-weight: bold;">${foundry.utils.escapeHTML(game.i18n.localize("SHADOWDARK_EXTRAS.item.container.total") || "Total")}</div>
			<div class="quantity"></div>
			<div class="cost-gp" style="font-weight: bold;">${totalGP > 0 ? totalGP : ""}</div>
			<div class="cost-sp" style="font-weight: bold;">${totalSP > 0 ? totalSP : ""}</div>
			<div class="cost-cp" style="font-weight: bold;">${totalCP > 0 ? totalCP : ""}</div>
			<div class="slots"></div>
			<div class="actions"></div>
		</li>
	` : "";

	// Get container coins
	const containerCoins = item.getFlag(MODULE_ID, "containerCoins") || {};
	const coinGP = Number(containerCoins.gp ?? 0);
	const coinSP = Number(containerCoins.sp ?? 0);
	const coinCP = Number(containerCoins.cp ?? 0);

	// Calculate coin slots (1 slot per 100 coins, regardless of denomination)
	const totalCoins = coinGP + coinSP + coinCP;
	const coinSlots = Math.floor(totalCoins / 100);

	// Build coin row for container's own coins
	const coinRow = `
		<li class="sdx-container-coins-row">
			<div class="item-image"><i class="fas fa-coins"></i></div>
			<div class="item-name">${foundry.utils.escapeHTML(game.i18n.localize("SHADOWDARK_EXTRAS.item.container.coins") || "Coins")}</div>
			<div class="quantity"></div>
			<div class="cost-gp">
				<input type="number" class="sdx-container-coin-input" data-coin-type="gp" value="${coinGP}" min="0" ${isEditable ? "" : "disabled"} />
			</div>
			<div class="cost-sp">
				<input type="number" class="sdx-container-coin-input" data-coin-type="sp" value="${coinSP}" min="0" ${isEditable ? "" : "disabled"} />
			</div>
			<div class="cost-cp">
				<input type="number" class="sdx-container-coin-input" data-coin-type="cp" value="${coinCP}" min="0" ${isEditable ? "" : "disabled"} />
			</div>
			<div class="slots">${coinSlots > 0 ? coinSlots : ""}</div>
			<div class="actions"></div>
		</li>
	`;

	let contentsHtml = `
		<div class="sdx-container-dropzone ${isEditable ? "editable" : ""}" data-sdx-dropzone="1">
			${(packedOnly ? packed.length : contained.length) ? "" : `<p class="sdx-container-hint">${foundry.utils.escapeHTML(dropHint)}</p>`}
			<ol class="SD-list item-list sdx-container-list">
				<li class="header">
					<div class="item-name">${foundry.utils.escapeHTML(game.i18n.localize("SHADOWDARK_EXTRAS.party.item_name"))}</div>
					<div class="quantity">${foundry.utils.escapeHTML(game.i18n.localize("SHADOWDARK_EXTRAS.party.qty"))}</div>
					<div class="cost-gp">GP</div>
					<div class="cost-sp">SP</div>
					<div class="cost-cp">CP</div>
					<div class="slots">${foundry.utils.escapeHTML(slotsLabel)}</div>
					<div class="actions"></div>
				</li>
				${coinRow}
				${rows}
				${totalRow}
			</ol>
		</div>
	`;

	const boxHtml = `
		<div class="SD-box sdx-container-box">
			<div class="header"><label>${foundry.utils.escapeHTML(title)}</label><span></span></div>
			<div class="content">${contentsHtml}</div>
		</div>
	`;

	// Insert after the top grid of the Details tab, if present
	const topGrid = detailsTab.find(".grid-3-columns, .grid-3, .grid-3col, .grid-3columms, .grid-3-columns").first();
	if (topGrid.length) topGrid.after(boxHtml);
	else detailsTab.append(boxHtml);

	async function openPackedItemSheet(packedItemData, { containerItem, packedKey } = {}) {
		if (!packedItemData) return;
		// Foundry v13: safest is constructing an in-memory document (no DB/world creation).
		try {
			const data = foundry.utils.duplicate(packedItemData);
			if (!data._id) data._id = foundry.utils.randomID();
			const DocClass = CONFIG?.Item?.documentClass ?? Item?.implementation ?? Item;
			const temp = new DocClass(data, { temporary: true });

			// If this packed entry belongs to a container item (sidebar/compendium), persist edits back into the container's packed array.
			if (containerItem && packedKey) {
				const originalUpdate = temp.update?.bind(temp);
				temp.update = async (changes = {}, options = {}) => {
					// Update the in-memory doc source so the sheet reflects changes.
					try {
						temp.updateSource(changes);
					}
					catch {
						// If updateSource isn't available for some reason, fall back to default update.
						return originalUpdate ? originalUpdate(changes, options) : temp;
					}

					// Write back to the container's packed list.
					const current = getPackedContainedItemData(containerItem);
					const idx = current.findIndex(d => String(getPackedKeyFromItemData(d)) === String(packedKey));
					if (idx < 0) return temp;

					const nextEntry = temp.toObject();
					delete nextEntry._id;
					nextEntry.flags = nextEntry.flags ?? {};
					nextEntry.flags[MODULE_ID] = nextEntry.flags[MODULE_ID] ?? {};
					nextEntry.flags[MODULE_ID].containerId = null;
					nextEntry.flags[MODULE_ID].packedKey = packedKey;
					nextEntry.system = nextEntry.system ?? {};
					// Packed entries should remain hidden from normal inventory listings.
					nextEntry.system.isPhysical = false;

					const next = current.slice();
					next[idx] = nextEntry;
					await containerItem.setFlag(MODULE_ID, "containerPackedItems", next);
					await recomputeContainerSlots(containerItem);
					return temp;
				};
			}

			temp?.sheet?.render(true);
		}
		catch {
			// Give up silently
		}
	}

	// Wire up actions
	html.find('.sdx-container-box [data-action="open-item"]').on("click", async (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		const li = ev.currentTarget.closest("li.item");
		const actor = item.parent;

		// Owned container contents: open the real embedded item.
		const itemId = li?.dataset?.itemId;
		if (actor && itemId) {
			const target = actor.items?.get(itemId);
			target?.sheet?.render(true);
			return;
		}

		// Packed-only contents (sidebar/compendium/Item Piles): open a temporary sheet.
		const packedKey = li?.dataset?.packedKey;
		if (!packedKey) return;
		const packedItems = getPackedContainedItemData(item);
		const packedEntry = packedItems.find(d => String(getPackedKeyFromItemData(d)) === String(packedKey));
		await openPackedItemSheet(packedEntry, { containerItem: item, packedKey });
	});

	html.find('.sdx-container-box [data-action="remove-from-container"]').on("click", async (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		if (!isEditable) return;
		const li = ev.currentTarget.closest("li.item");
		const packedKey = li?.dataset?.packedKey;
		if (packedKey) {
			const current = getPackedContainedItemData(item);
			const next = current.filter(d => getPackedKeyFromItemData(d) !== packedKey);
			await item.setFlag(MODULE_ID, "containerPackedItems", next);
			await recomputeContainerSlots(item);
			app.render();
			return;
		}

		const itemId = li?.dataset?.itemId;
		const actor = item.parent;
		const target = actor?.items?.get(itemId);
		if (!target) return;
		await setContainedState(target, null);
		await recomputeContainerSlots(item);
		app.render();
	});

	// Bind coin input changes
	html.find(".sdx-container-box .sdx-container-coin-input").on("change", async (ev) => {
		if (!isEditable) return;
		const coinType = ev.currentTarget.dataset.coinType;
		const value = Math.max(0, parseInt(ev.currentTarget.value) || 0);
		const currentCoins = item.getFlag(MODULE_ID, "containerCoins") || {};
		const nextCoins = { ...currentCoins, [coinType]: value };
		await item.setFlag(MODULE_ID, "containerCoins", nextCoins);
		await recomputeContainerSlots(item);
	});

	// Drag/drop assignment (actor-owned or packed-only)
	const dropzone = html.find(".sdx-container-box .sdx-container-dropzone").first();
	if (dropzone.length) {
		dropzone.on("dragover", (ev) => {
			if (!isEditable) return;
			ev.preventDefault();
		});
		dropzone.on("drop", async (ev) => {
			if (!isEditable) return;
			ev.preventDefault();
			const originalEvent = ev.originalEvent ?? ev;
			const ctrlMove = Boolean(originalEvent?.ctrlKey);
			const getDragEventData = foundry?.applications?.ux?.TextEditor?.implementation?.getDragEventData ?? TextEditor.getDragEventData;
			const data = getDragEventData(originalEvent);
			if (!data || data.type !== "Item") return;
			const dropped = await fromUuid(data.uuid);
			if (!dropped || !(dropped instanceof Item)) return;
			if (dropped.id === item.id && dropped.parent === item.parent) return;

			// Check if nested containers are allowed
			const allowNestedContainers = game.settings.get(MODULE_ID, "enableNestedContainers");
			if (!allowNestedContainers && isContainerItem(dropped)) {
				ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.item.container.nested_not_allowed"));
				return;
			}

			// Actor-owned container: ensure the dropped item becomes owned by the same actor, then contain it.
			if (item.parent) {
				if (dropped.parent && dropped.parent === item.parent) {
					await setContainedState(dropped, item.id);
					await recomputeContainerSlots(item);
					app.render();
					return;
				}

				const packedData = await packItemToContainerData(dropped);
				if (!packedData) return;
				// Create an owned copy on this actor, then contain that copy.
				const created = await item.parent.createEmbeddedDocuments("Item", [packedData], { sdxInternal: true });
				const createdItem = created?.[0];
				if (createdItem) {
					await setContainedState(createdItem, item.id);
					await recomputeContainerSlots(item);
				}

				// Optional move: delete the source if CTRL is held and the user can.
				if (ctrlMove && dropped.parent && dropped.parent !== item.parent) {
					try {
						await dropped.delete({ sdxInternal: true });
					}
					catch {
						// Ignore delete failures
					}
				}

				app.render();
				return;
			}

			// Packed-only container (sidebar/compendium or Item Piles): store dropped item as packed data.
			const packedData = await packItemToContainerData(dropped);
			if (!packedData) return;
			const current = getPackedContainedItemData(item);
			current.push(packedData);
			await item.setFlag(MODULE_ID, "containerPackedItems", current);
			await recomputeContainerSlots(item);

			// Optional move: delete the source if CTRL is held and the user can.
			if (ctrlMove && dropped.parent) {
				try {
					await dropped.delete({ sdxInternal: true });
				}
				catch {
					// Ignore delete failures
				}
			}

			app.render();
		});
	}
}

function buildContainerTooltip(containerItem) {
	const actor = containerItem?.parent;
	if (!actor) return null;
	const packed = getPackedContainedItemData(containerItem);
	const isItemPiles = isItemPilesEnabledActor(actor);
	const contained = isItemPiles ? [] : actor.items.filter(i => i.getFlag(MODULE_ID, "containerId") === containerItem.id);
	const label = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.contains_label");

	// Prefer embedded contents on normal actors, but fall back to packed snapshot when needed.
	const hasEmbedded = contained.length > 0;
	const entries = hasEmbedded ? contained : packed;
	if (!entries.length) {
		const empty = game.i18n.localize("SHADOWDARK_EXTRAS.item.container.contains_empty");
		return `${label} ${empty}`;
	}

	// Build a plain text list for tooltip
	const items = entries
		.slice(0, 50)
		.map(entry => {
			const isOwnedItem = entry instanceof Item;
			const name = entry?.name ?? "";
			const qty = Number(entry?.system?.quantity ?? 1);
			const qtySuffix = Number.isFinite(qty) && qty > 1 ? ` x${qty}` : "";
			return `• ${name}${qtySuffix}`;
		})
		.join("\n");

	const more = entries.length > 50 ? `\n• ... and ${entries.length - 50} more` : "";
	return `${label}\n${items}${more}`;
}

function attachContainerContentsToActorSheet(app, html) {
	// Check if containers are enabled
	if (!game.settings.get(MODULE_ID, "enableContainers")) return;

	const actor = app?.actor;
	if (!actor) return;

	// Add tooltips to container items in inventory
	html.find(".item[data-item-id]").each((_, el) => {
		const $el = $(el);
		const itemId = $el.data("itemId") ?? $el.attr("data-item-id");
		if (!itemId) return;
		const item = actor.items?.get?.(itemId);
		if (!item) return;
		if (!(item.type === "Basic" && Boolean(item.getFlag(MODULE_ID, "isContainer")))) return;

		// Build tooltip content
		const tooltip = buildContainerTooltip(item);
		if (!tooltip) return;

		// Add tooltip to the item row
		$el.attr("title", tooltip);
		$el.addClass("sdx-has-container-tooltip");
	});
}






/**
 * Enable chat icon on item images to show item in chat
 * NOTE: This only handles items that Shadowdark doesn't natively handle.
 * Shadowdark's PlayerSheetSD already has _onItemChatClick which calls displayCard()
 * for all items via .item-image click. We only need to handle NPC items.
 */
function enableItemChatIcon(app, html) {
	const actor = app?.actor;
	if (!actor) return;

	// Skip for player sheets - Shadowdark handles these natively via _onItemChatClick
	// This prevents duplicate chat messages when clicking item images
	if (actor.type === "Player") return;

	// Handle click on item image (when it has the chat icon)
	html.find(".item-image").off("click.sdxChat").on("click.sdxChat", async function(ev) {
		// Only handle if this item-image has a comment icon
		if (!$(this).find(".fa-comment").length) return;

		ev.preventDefault();
		ev.stopPropagation();

		const $itemRow = $(this).closest(".item[data-item-id]");
		const itemId = $itemRow.data("itemId") ?? $itemRow.attr("data-item-id");
		if (!itemId) return;

		const item = actor.items.get(itemId);
		if (!item) return;

		// Check if unidentified (and user is not GM)
		if (!game.user?.isGM && isUnidentified(item)) {
			ui.notifications.warn("Cannot show unidentified item in chat");
			return;
		}

		// Show item in chat - Shadowdark 4.x removed item.displayCard; the
		// equivalent is ChatSD.showItemCard(uuid) (PlayerSheetSD._onItemChatClick).
		try {
			await shadowdark.chat.showItemCard(item.uuid);
		}
		catch(err) {
			// Be loud: the old unhandled promise rejection hid this failure.
			console.error("shadowdark-extras: showItemCard failed", err);
		}
	});
}

export {
	isContainerItem,
	isItemPilesEnabledActor,
	calculateSlotsCostForItemData,
	recomputeContainerSlots,
	calculateContainedItemSlots,
	calculateSlotsCostForItem,
	ensureContainerBaseSlots,
	getContainedItems,
	getPackedContainedItemData,
	getParentContainer,
	syncContainerPackedItems,
	patchGetPhysicalItemsForContainers,
	injectBasicContainerUI,
	attachContainerContentsToActorSheet,
	enableItemChatIcon,
};
