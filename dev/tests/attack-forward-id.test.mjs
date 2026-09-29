import assert from "node:assert/strict";
import test from "node:test";

// roll-patches' import graph destructures foundry.applications.api at load.
globalThis.foundry = {
	applications: {
		api: {
			ApplicationV2: class {},
			HandlebarsApplicationMixin: base => base,
		},
	},
};
const { attackForwardId } = await import("../../scripts/combat/roll-patches.mjs");

// #184: an NpcSD-backed sub-type (Enhancer's mount, warband) gets the bare id
// NpcSD.rollAttack looks up; a UUID made it log "invalid attack ID" and post nothing.
test("an NPC model gets the bare attack id, whatever its type string", () => {
	const item = { id: "atk1", uuid: "Actor.a.Item.atk1" };
	for (const type of ["NPC", "shadowdark-enhancer.mount", "shadowdark-enhancer.warband"]) {
		assert.equal(attackForwardId({ type, system: { isNPC: true } }, item, "atk1", item.uuid), "atk1", type);
	}
});

test("a player character still gets the UUID", () => {
	const item = { id: "w1", uuid: "Actor.p.Item.w1" };
	assert.equal(attackForwardId({ type: "Player", system: { isNPC: false } }, item, "w1", item.uuid), "Actor.p.Item.w1");
});

test("without the item, the NPC path falls back to the id it was given", () => {
	assert.equal(attackForwardId({ system: { isNPC: true } }, null, "raw", "raw"), "raw");
});

// #184: the token toolbar lists an NPC-model actor's NPC Attacks, whatever its type string.
const { getEquippedItems } = await import("../../scripts/canvas/TokenToolbarSD.mjs");
test("the token toolbar lists NPC attacks for a mount and a warband, and equipped gear for a player", () => {
	const items = [
		{ id: "a1", name: "Bite", type: "NPC Attack", system: { damage: { value: "1d6" }, attack: { num: "1" } } },
		{ id: "w1", name: "Sword", type: "Weapon", system: { equipped: true, damage: {} } },
	];
	for (const type of ["NPC", "shadowdark-enhancer.mount", "shadowdark-enhancer.warband"]) {
		assert.deepEqual(getEquippedItems({ type, system: { isNPC: true }, items }).map(i => i.id), ["a1"], type);
	}
	assert.deepEqual(getEquippedItems({ type: "Player", system: { isNPC: false }, items }).map(i => i.id), ["w1"]);
});
