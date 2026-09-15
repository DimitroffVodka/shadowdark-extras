// #138: Transfer to Player on a lit torch moved the item but left the light
// (token light and torch sprite) on the giver. nativeTransferItems now hands
// the light over the way the system's own sheet drop does.

import assert from "node:assert/strict";
import test from "node:test";

class Stub {}
globalThis.foundry = {
	applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: Base => Base, DialogV2: Stub } },
	appv1: { api: { Application: Stub, FormApplication: Stub } },
	utils: {},
};
globalThis.Hooks = { on() {}, once() {} };
globalThis.game = {};

const { nativeTransferItems } = await import("../../scripts/inventory/TradeWindowSD.mjs");

function makeActor(name, log) {
	const actor = {
		name,
		items: [],
		async createEmbeddedDocuments(type, data, opts) {
			const created = data.map((d, i) => makeItem(`${name}-new${i}`, d, actor, log));
			actor.items.push(...created);
			log.push(["create", name, data[0].system.light?.active ?? null, opts?.sdxBypassLock]);
			return created;
		},
		async updateEmbeddedDocuments(type, updates, opts) {
			log.push(["putOut", name, updates.map(u => u._id), updates[0]["system.light.active"], opts?.sdxBypassLock]);
		},
		async turnLightOff() { log.push(["lightOff", name]); },
		async turnLightOn(id) { log.push(["lightOn", name, id]); },
	};
	actor.items.get = id => actor.items.find(it => it.id === id);
	return actor;
}

function makeItem(id, { name = "Torch", quantity = 1, active = false } = {}, actor, log) {
	const system = arguments[1]?.system ?? { quantity, light: { active, template: "torch" } };
	return {
		id, type: "Basic", name, system, _stats: {}, flags: {},
		isActiveLight() { return Boolean(this.system.light?.active); },
		toObject() { return structuredClone({ _id: id, type: "Basic", name, system: this.system }); },
		async update(changes) { log.push(["update", actor.name, id, changes["system.quantity"]]); },
		async delete() { log.push(["delete", actor.name, id]); },
	};
}

test("a lit torch carries its light from giver to receiver", async () => {
	const log = [];
	const a = makeActor("A", log);
	const b = makeActor("B", log);
	a.items.push(makeItem("torchA", { active: true }, a, log));
	b.items.push(makeItem("lanternB", { name: "Lantern", active: true }, b, log));

	await nativeTransferItems(a, b, [{ _id: "torchA", quantity: 1 }]);

	assert.deepEqual(log, [
		["putOut", "B", ["lanternB"], false, true],
		["create", "B", true, true],
		["lightOff", "A"],
		["lightOn", "B", "B-new0"],
		["delete", "A", "torchA"],
	]);
});

test("a lit torch never merges into the receiver's unlit stack", async () => {
	const log = [];
	const a = makeActor("A", log);
	const b = makeActor("B", log);
	a.items.push(makeItem("torchA", { active: true }, a, log));
	b.items.push(makeItem("torchB", { quantity: 2 }, b, log));

	await nativeTransferItems(a, b, [{ _id: "torchA", quantity: 1 }]);

	assert.ok(!log.some(e => e[0] === "update"), "the receiver's stack is left alone");
	assert.deepEqual(log.find(e => e[0] === "create"), ["create", "B", true, true]);
	assert.deepEqual(log.find(e => e[0] === "lightOn"), ["lightOn", "B", "B-new0"]);
});

test("splitting a lit stack leaves the light with the giver", async () => {
	const log = [];
	const a = makeActor("A", log);
	const b = makeActor("B", log);
	a.items.push(makeItem("torchA", { quantity: 3, active: true }, a, log));

	await nativeTransferItems(a, b, [{ _id: "torchA", quantity: 1 }]);

	assert.deepEqual(log, [
		["create", "B", false, true],
		["update", "A", "torchA", 2],
	]);
});

test("an unlit torch still merges and touches no light", async () => {
	const log = [];
	const a = makeActor("A", log);
	const b = makeActor("B", log);
	a.items.push(makeItem("torchA", {}, a, log));
	b.items.push(makeItem("torchB", { quantity: 2 }, b, log));

	await nativeTransferItems(a, b, [{ _id: "torchA", quantity: 1 }]);

	assert.deepEqual(log, [
		["update", "B", "torchB", 3],
		["delete", "A", "torchA"],
	]);
});
