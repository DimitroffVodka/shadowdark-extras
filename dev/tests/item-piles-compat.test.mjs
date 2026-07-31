import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	addIdentificationSimilarity,
	getPileEquipmentUpdates,
	initItemPilesCompatibility,
	isItemPilesActor,
	normalizePileItemCreate,
	normalizePileItemUpdate
} from "../../scripts/inventory/ItemPilesCompatSD.mjs";

const moduleRoot = new URL("../../", import.meta.url);

function pileActor(enabled = true) {
	return {
		getFlag(scope, key) {
			assert.equal(scope, "item-piles");
			assert.equal(key, "data");
			return { enabled };
		}
	};
}

test("Item Piles similarities include Shadowdark's hidden identified name once", () => {
	assert.deepEqual(
		addIdentificationSimilarity(["name", "type", "system.light.remainingSecs"]),
		[
			"name",
			"type",
			"system.light.remainingSecs",
			"system.identification.name"
		]
	);
	assert.deepEqual(
		addIdentificationSimilarity(["name", "system.identification.name"]),
		["name", "system.identification.name"]
	);
});

test("different unidentified potion identities no longer compare as identical", () => {
	const similarities = addIdentificationSimilarity(["name", "type"]);
	const healing = {
		name: "Unidentified Potion",
		type: "Potion",
		system: { identification: { name: "Potion of Healing" } }
	};
	const sleep = {
		name: "Unidentified Potion",
		type: "Potion",
		system: { identification: { name: "Potion of Sleep" } }
	};

	const valueAt = (item, path) => path
		.split(".")
		.reduce((value, key) => value?.[key], item);
	const areDifferent = similarities.some(path =>
		valueAt(healing, path) !== valueAt(sleep, path)
	);

	assert.equal(areDifferent, true);
});

test("pile-owned weapons are normalized to unequipped on create and update", () => {
	const createUpdates = [];
	const createdWeapon = {
		type: "Weapon",
		parent: pileActor(),
		system: { equipped: true },
		updateSource(update) {
			createUpdates.push(update);
		}
	};

	assert.equal(isItemPilesActor(createdWeapon.parent), true);
	assert.equal(normalizePileItemCreate(createdWeapon), true);
	assert.deepEqual(createUpdates, [{ "system.equipped": false }]);

	const flagOnlyUpdate = {
		flags: {
			"shadowdark-extras": {
				weaponAnimation: { enabled: true }
			}
		}
	};
	assert.equal(normalizePileItemUpdate(createdWeapon, flagOnlyUpdate), true);
	assert.equal(flagOnlyUpdate.system.equipped, false);
});

test("existing pile equipment receives one-time unequip updates", () => {
	const actor = pileActor();
	actor.items = [
		{ id: "weapon", type: "Weapon", system: { equipped: true } },
		{ id: "armor", type: "Armor", system: { equipped: false } },
		{ id: "potion", type: "Potion", system: { equipped: true } }
	];

	assert.deepEqual(getPileEquipmentUpdates(actor), [
		{ _id: "weapon", "system.equipped": false }
	]);
});

test("normal actors keep their equipment state untouched", () => {
	const changes = { system: { equipped: true } };
	const weapon = {
		type: "Weapon",
		parent: pileActor(false),
		system: { equipped: false },
		updateSource() {
			throw new Error("normal actor item should not be normalized");
		}
	};

	assert.equal(normalizePileItemCreate(weapon, { system: { equipped: true } }), false);
	assert.equal(normalizePileItemUpdate(weapon, changes), false);
	assert.equal(changes.system.equipped, true);
});

test("Item Piles pre-hooks never cancel unrelated item creates or updates", () => {
	const registered = new Map();
	const previousHooks = globalThis.Hooks;
	globalThis.Hooks = {
		on(name, callback) {
			registered.set(name, callback);
		},
		once() {}
	};

	try {
		initItemPilesCompatibility();
		const item = {
			type: "Basic",
			parent: pileActor(false),
			system: {}
		};

		assert.equal(registered.get("preCreateItem")(item, {}), undefined);
		assert.equal(registered.get("preUpdateItem")(item, { "system.quantity": 2 }), undefined);
	} finally {
		globalThis.Hooks = previousHooks;
	}
});

test("weapon animation paths guard Item Piles actors", () => {
	const source = readFileSync(
		new URL("scripts/animation/WeaponAnimationSD.mjs", moduleRoot),
		"utf8"
	);

	assert.match(source, /isItemPilesActor\(item\?\.parent \?\? token\?\.actor\)/);
	assert.match(source, /if \(!configOverride && item\?\.system\?\.equipped !== true\)/);
	assert.match(source, /if \(isItemPilesActor\(actor\)\) \{/);
	assert.match(source, /await stopAllWeaponAnimations\(token\)/);
});
