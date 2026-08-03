/**
 * Pure container slot calculator.
 *
 * Extracted from containers.mjs in Phase 5.3 sweep 2 to bring that file under
 * the 1,200-line cap. containers.mjs imports this binding and re-exports it
 * from the old path, so every existing caller is unchanged. No formula,
 * coercion, recursive option, flag, or fallback was altered by the move.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

export function calculateSlotsCostForItemData(itemData, { recursive = false } = {}) {
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
