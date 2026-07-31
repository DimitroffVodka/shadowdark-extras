import { MODULE_ID } from "../shared/module-id.mjs";

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
	} catch {
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
	} else {
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
		} else {
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
	} finally {
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
		} finally {
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
				} catch (e) {
					// Ignore errors
				}
			}, 100);
		}
	});
}

export { isContainerItem, isItemPilesEnabledActor, calculateSlotsCostForItemData, recomputeContainerSlots };
