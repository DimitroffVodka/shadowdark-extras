import assert from "node:assert/strict";
import test from "node:test";

import {
	calculateSlotsCostForItemData as containerCalc,
} from "../../scripts/inventory/containers.mjs";
import {
	calculateSlotsCostForItemData as slotCalc,
} from "../../scripts/inventory/container-slots.mjs";
import { MODULE_ID } from "../../scripts/shared/module-id.mjs";

/**
 * Pure calculator tests for the Phase 5.3 sweep 2 container slot split.
 *
 * No Foundry globals and no document writes: every fixture is plain data in
 * the same shape the packed-item flags and system fields use at runtime.
 */

/** Build a packed-item-shaped data object with sane slot defaults. */
function makeItem({
	type = "Basic",
	quantity = 1,
	perSlot = 1,
	slotsUsed = 1,
	freeCarry = 0,
	stashed = false,
	flags = {},
} = {}) {
	return {
		type,
		system: {
			quantity,
			stashed,
			slots: {
				per_slot: perSlot,
				slots_used: slotsUsed,
				free_carry: freeCarry,
			},
		},
		flags: {
			[MODULE_ID]: flags,
		},
	};
}

test("the old containers.mjs export is strict-identical to the new module export", () => {
	// The extraction must re-export the SAME binding, not a wrapper or copy.
	assert.equal(containerCalc, slotCalc);
	assert.equal(typeof slotCalc, "function");
});

test("basic quantity / per-slot / slots-used arithmetic", () => {
	// ceil(qty / per_slot) * slots_used
	assert.equal(slotCalc(makeItem({ quantity: 6, perSlot: 2, slotsUsed: 1 })), 3);
	assert.equal(slotCalc(makeItem({ quantity: 5, perSlot: 2, slotsUsed: 3 })), 9);
	assert.equal(slotCalc(makeItem({ quantity: 1, slotsUsed: 2 })), 2);
	assert.equal(slotCalc(makeItem({ quantity: 7, perSlot: 1, slotsUsed: 2 })), 14);
	// Zero and negative quantities clamp to 0.
	assert.equal(slotCalc(makeItem({ quantity: 0, slotsUsed: 5 })), 0);
	assert.equal(slotCalc(makeItem({ quantity: -3, slotsUsed: 4 })), 0);
	// Missing system fields fall back to defaults (qty 1, per_slot 1, slots_used 1).
	assert.equal(slotCalc({}), 1);
	assert.equal(slotCalc(undefined), 1);
});

test("free-carry zeroes the item's own base slot cost", () => {
	assert.equal(slotCalc(makeItem({ quantity: 7, perSlot: 1, slotsUsed: 2, freeCarry: 1 })), 0);
	assert.equal(slotCalc(makeItem({ quantity: 7, perSlot: 1, slotsUsed: 2, freeCarry: 0 })), 14);
	// Free carry applies to the item itself but not to its packed contents.
	const container = makeItem({
		quantity: 3,
		perSlot: 1,
		slotsUsed: 4,
		freeCarry: 1,
		flags: {
			isContainer: true,
			containerBaseSlots: { slots_used: 4, per_slot: 1 },
			containerPackedItems: [
				makeItem({ quantity: 2, perSlot: 1, slotsUsed: 3 }),
			],
			containerCoins: { gp: 100, sp: 0, cp: 0 },
		},
	});
	assert.equal(slotCalc(container, { recursive: true }), 7);
});

test("Gem, stashed, and non-physical-origin items cost zero slots", () => {
	assert.equal(slotCalc(makeItem({ type: "Gem" })), 0);
	assert.equal(slotCalc(makeItem({ type: "Gem", quantity: 12, slotsUsed: 9 })), 0);
	assert.equal(slotCalc(makeItem({ stashed: true })), 0);
	assert.equal(slotCalc(makeItem({ stashed: true, quantity: 8, slotsUsed: 5 })), 0);
	assert.equal(slotCalc(makeItem({ flags: { containerOrigIsPhysical: false } })), 0);
	// The zero-cost checks fire before any quantity math.
	assert.equal(slotCalc(makeItem({ type: "Gem", stashed: true, flags: { containerOrigIsPhysical: false } })), 0);
});

test("recursive containers use base slots and add packed contents plus coin slots", () => {
	// Non-recursive call uses system.slots.slots_used and ignores contents/coins.
	const container = makeItem({
		quantity: 1,
		slotsUsed: 5,
		flags: {
			isContainer: true,
			containerBaseSlots: { slots_used: 2, per_slot: 1 },
			containerPackedItems: [makeItem({ quantity: 3, perSlot: 1, slotsUsed: 1 })],
			containerCoins: { gp: 100, sp: 100, cp: 100 },
		},
	});
	assert.equal(slotCalc(container), 5);
	// Recursive call uses base slots (2) + packed item (3) + floor(300/100)=3 coins.
	assert.equal(slotCalc(container, { recursive: true }), 8);

	// Nested packed items that are themselves containers recurse into base slots.
	const inner = makeItem({
		quantity: 1,
		slotsUsed: 99, // must be ignored when recursive; base slots win
		flags: {
			isContainer: true,
			containerBaseSlots: { slots_used: 3, per_slot: 1 },
			containerPackedItems: [makeItem({ quantity: 2, perSlot: 1, slotsUsed: 4 })],
			containerCoins: { gp: 50, sp: 0, cp: 0 },
		},
	});
	const outer = makeItem({
		quantity: 1,
		slotsUsed: 1,
		flags: {
			isContainer: true,
			containerBaseSlots: { slots_used: 1, per_slot: 1 },
			containerPackedItems: [inner],
			containerCoins: { gp: 300, sp: 0, cp: 0 },
		},
	});
	// outer base 1 + inner(3 + 2*4=8 + floor(50/100)=0 => 11) + outer floor(300/100)=3 => 15
	assert.equal(slotCalc(outer, { recursive: true }), 15);
});

test("a packed coin hoard rounds down to one slot per 100 coins", () => {
	const hoard = makeItem({
		flags: {
			isContainer: true,
			containerBaseSlots: { slots_used: 0, per_slot: 1 },
			containerCoins: { gp: 0, sp: 250, cp: 0 },
		},
	});
	// 250 sp is 2 slots; 199 coins is 1; 0 coins is 0.
	assert.equal(slotCalc(hoard, { recursive: true }), 2);
	const oneHundredNinetyNine = makeItem({
		flags: {
			isContainer: true,
			containerBaseSlots: { slots_used: 0, per_slot: 1 },
			containerCoins: { gp: 0, sp: 199, cp: 0 },
		},
	});
	assert.equal(slotCalc(oneHundredNinetyNine, { recursive: true }), 1);
	const none = makeItem({
		flags: {
			isContainer: true,
			containerBaseSlots: { slots_used: 0, per_slot: 1 },
		},
	});
	assert.equal(slotCalc(none, { recursive: true }), 0);
});
