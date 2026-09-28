import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

// Foundry 14 removes a key with a ForcedDeletion under the key itself; the legacy "-=" key is deprecated (#181).
installCanvasGlobals();
installAppGlobals({ dom: makeSelectorDom() });
const hooks = [];
globalThis.Hooks = { on: (name, fn) => { hooks.push([name, fn]); return hooks.length; }, off() {}, once() {}, callAll() {} };
const { ForcedDeletion } = foundry.data.operators;
foundry.utils.isEmpty ??= (value) => !value || Object.keys(value).length === 0;
const { FilterSelector } = await import("../../scripts/animation/TMFXFilterEditor.mjs");
const { performItemUpdate } = await import("../../scripts/combat/MedkitSD.mjs");

test("the TMFX filter editor re-renders on a filter removal and never maps a non-array", async () => {
	const base = Object.getPrototypeOf(FilterSelector.prototype);
	base._onFirstRender ??= async () => {};
	const editor = Object.create(FilterSelector.prototype);
	let renders = 0;
	Object.assign(editor, { _document: { id: "t1" }, _paramArray: [], render: () => { renders++; } });
	hooks.length = 0;
	await editor._onFirstRender({}, {});
	const update = hooks.find(([name]) => name === "updateToken")?.[1];
	assert.equal(typeof update, "function");
	update({ id: "t1" }, { flags: { tokenmagic: { filters: new ForcedDeletion() } } });
	assert.equal(renders, 1, "the removal re-renders");
	assert.doesNotThrow(() => update({ id: "t1" }, { flags: { tokenmagic: { filters: { a: 1 } } } }));
	update({ id: "other" }, { flags: { tokenmagic: { filters: new ForcedDeletion() } } });
	assert.equal(renders, 1, "another token's change is ignored");
});

test("a Medkit enhancement sync unsets the old flags with a ForcedDeletion, no legacy -= key", async () => {
	const updates = [];
	const item = {
		flags: { "shadowdark-extras": { targeting: { mode: "old" } } },
		update: async (data) => { updates.push(data); },
	};
	globalThis.fromUuid = async () => ({ flags: { "shadowdark-extras": { targeting: { mode: "new" } } }, toObject: () => ({}) });
	assert.equal(await performItemUpdate(item, "Compendium.x.y.Item.z", "flags"), true);
	const [unset] = updates;
	assert.ok(unset["flags.shadowdark-extras.targeting"] instanceof ForcedDeletion);
	assert.ok(updates.every((u) => Object.keys(u).every((k) => !k.includes("-="))), "no legacy deletion key");
});
