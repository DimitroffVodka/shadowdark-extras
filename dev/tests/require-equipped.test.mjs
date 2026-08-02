import assert from "node:assert/strict";
import test from "node:test";

// Phase 5.2.6 regression (issue #51) — a requireEquipped-only effect on a
// newly created (unequipped) item must arrive DISABLED.
//
// The bug: the createItem hook filtered item effects for requirements by
// testing `sourceRequirement` only, so an effect carrying JUST
// `requireEquipped` (no expression) was skipped — the hook returned early
// and the effect stayed active until something else ran
// (renderActorSheet/updateActor). The createActiveEffect hook checks
// requireEquipped but bails when the effect's parent is an Item (exactly
// where item effects live), so creation itself never enforced it.
//
// These tests drive the real hook chain: createItem -> (100ms) ->
// checkEffectRequirements -> evaluateSourceRequirement (requireEquipped
// branch reads sourceEffect.parent.system.equipped).

// ---- stubs (minimal, module uses only MODULE_ID at import time) ----

const MODULE_ID = "shadowdark-extras";
const hooks = new Map();

globalThis.Hooks = {
	on: (name, callback) => hooks.set(name, callback),
	once: () => {},
};

globalThis.game = { user: { id: "user-1" } };
globalThis.Actor = class {};
globalThis.Item = class {};
globalThis.fromUuid = async () => undefined;

// ---- fakes ----

function makeEffect(item, { requireEquipped = true, sourceRequirement = "", transfer = true } = {}) {
	return {
		parent: item,
		name: "Test Effect",
		transfer,
		disabled: false,
		flags: { [MODULE_ID]: { requireEquipped, sourceRequirement } },
		updates: [],
		getFlag(scope, key) {
			return this.flags[scope]?.[key];
		},
		async update(data) {
			Object.assign(this, data);
			this.updates.push(data);
		},
	};
}

function makeItem(actor, effects, { equipped = false } = {}) {
	const item = Object.assign(new Item(), {
		name: "Test Sword",
		type: "Weapon",
		parent: actor,
		system: { equipped },
		effects,
	});
	for (const effect of effects) effect.parent = item;
	if (!actor.items.includes(item)) actor.items.push(item);
	return item;
}

function makeActor(items) {
	return Object.assign(new Actor(), {
		name: "Test Player",
		effects: [],
		items,
		token: undefined,
		getActiveTokens: () => [],
	});
}

let registerSourceRequirementHooks;
let checkEffectRequirements;
({ registerSourceRequirementHooks, checkEffectRequirements } = await import("../../scripts/effects/source-requirements.mjs"));

function setup() {
	hooks.clear();
	registerSourceRequirementHooks();
}

/** Fire the createItem hook and wait for its deferred requirement check. */
async function createItemAndSettle(item) {
	const actor = item.parent;
	const callback = hooks.get("createItem");
	assert.ok(callback, "createItem hook registered");
	await callback(item, {}, game.user.id);
	// the hook defers checkEffectRequirements by 100ms
	await new Promise((resolve) => setTimeout(resolve, 150));
	return actor;
}

// ------------------------------------------------------------------ tests

test("requireEquipped-only effect on a new unequipped item arrives disabled", async () => {
	const actor = makeActor([]);
	const effect = makeEffect(null, { requireEquipped: true, sourceRequirement: "" });
	const item = makeItem(actor, [effect], { equipped: false });
	setup();

	await createItemAndSettle(item);

	assert.equal(effect.disabled, true, "effect must be disabled (item unequipped)");
	assert.equal(effect.updates.length, 1);
	assert.deepEqual(effect.updates[0], { disabled: true });
});

test("requireEquipped effect on an equipped item stays enabled", async () => {
	const actor = makeActor([]);
	const effect = makeEffect(null, { requireEquipped: true });
	const item = makeItem(actor, [effect], { equipped: true });
	setup();

	await createItemAndSettle(item);

	assert.equal(effect.disabled, false, "effect stays enabled (item equipped)");
	assert.equal(effect.updates.length, 0, "no update needed");
});

test("sourceRequirement-only effect still triggers the check (existing path intact)", async () => {
	const actor = makeActor([]);
	const effect = makeEffect(null, { requireEquipped: false, sourceRequirement: "actor.level >= 10" });
	const item = makeItem(actor, [effect], { equipped: false });
	setup();

	await createItemAndSettle(item);

	// requirement evaluates false on a stub actor (level 0) -> disabled
	assert.equal(effect.disabled, true, "expression requirement enforced on creation");
	assert.equal(effect.updates.length, 1);
});

test("effect with neither flag is untouched by the createItem path", async () => {
	const actor = makeActor([]);
	const effect = makeEffect(null, { requireEquipped: false, sourceRequirement: "" });
	const item = makeItem(actor, [effect], { equipped: false });
	setup();

	await createItemAndSettle(item);

	assert.equal(effect.disabled, false);
	assert.equal(effect.updates.length, 0);
});

test("non-transferred item effects are not forced (transfer=false)", async () => {
	const actor = makeActor([]);
	const effect = makeEffect(null, { requireEquipped: true, transfer: false });
	const item = makeItem(actor, [effect], { equipped: false });
	setup();

	await createItemAndSettle(item);

	// checkEffectRequirements only evaluates transferred item effects;
	// non-transferred ones are the item's own display state.
	assert.equal(effect.disabled, false);
	assert.equal(effect.updates.length, 0);
});
