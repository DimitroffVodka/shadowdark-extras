import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// roll-patches.mjs -> WeaponBonusConfig -> CreatureTypesApp destructures
// foundry.applications.api at module load (issue #52 harness pattern).
globalThis.foundry = {
	applications: {
		api: {
			ApplicationV2: class {},
			HandlebarsApplicationMixin: (base) => base,
		},
	},
	utils: {
		randomID: () => "id",
		Collection: class extends Map {},
	},
};
const { setupRollConfigPatches } = await import("../../scripts/combat/roll-patches.mjs");

function makeAmmo(id, { hit = "", damage = "" } = {}) {
	return {
		id,
		type: "Basic",
		system: { isAmmunition: true, quantity: 20 },
		flags: { "shadowdark-extras": { ammoHitBonus: hit, ammoDamageBonus: damage } },
		getFlag(scope, key) {
			return this.flags[scope]?.[key];
		},
	};
}

function makeWeapon({ ranged = true, damageMultiplier = 0 } = {}) {
	return {
		id: "weapon-1",
		type: "Weapon",
		usesAmmunition: ranged,
		name: { slugify: () => "longbow" },
		system: {
			type: ranged ? "ranged" : "melee",
			bonuses: { damageMultiplier },
		},
		flags: { "shadowdark-extras": { weaponBonus: { enabled: false } } },
	};
}

function makeActor({ advantage = [], actorDamageMultiplier = 0, weapon, ammo } = {}) {
	const actor = {
		id: "actor-1",
		type: "Player",
		items: [],
		system: {
			bonuses: { advantage, damageMultiplier: actorDamageMultiplier },
			rollConfigGenerators: {
				attack: async (config) => {
					config.mainRoll = {
						base: "d20",
						bonus: "",
						formula: "d20",
						tooltips: "",
						advantage: 0,
					};
					config.damageRoll = {
						formula: "1d8",
						tooltips: "",
					};
				},
			},
		},
	};
	actor.items.push(weapon ?? makeWeapon());
	actor.items.push(...(ammo ?? []));
	return actor;
}

function installWorld(actor) {
	const hooks = new Map();
	const previous = {
		Hooks: globalThis.Hooks,
		game: globalThis.game,
		fromUuid: globalThis.fromUuid,
	};
	globalThis.Hooks = {
		on: (name, callback) => hooks.set(name, callback),
		once: () => {},
	};
	globalThis.game = {
		actors: {
			get: (id) => (id === actor.id ? actor : undefined),
			[Symbol.iterator]: function* () {
				yield actor;
			},
		},
		user: { targets: { first: () => undefined } },
	};
	const byUuid = new Map([["Actor.actor-1", actor]]);
	for (const item of actor.items) byUuid.set(`Item.${item.id}`, item);
	globalThis.fromUuid = async (uuid) => byUuid.get(uuid);
	return {
		hooks,
		restore() {
			globalThis.Hooks = previous.Hooks;
			globalThis.game = previous.game;
			globalThis.fromUuid = previous.fromUuid;
		},
	};
}

/** Stub the system dice module with a rollFromConfig recorder. */
function installDice(recorder) {
	globalThis.shadowdark = {
		dice: {
			formatBonus: (bonus) => ` + ${String(bonus).trim().replace(/^\+/, "")}`,
			rollFromConfig: async (config) => {
				recorder.push(config);
			},
		},
	};
}

/** Build an attack config the way PlayerSD does, then roll it (once, like the real flow). */
async function attackAndRoll(actor, { selectedAmmoId, dialog = false, runHook = false, world, roll = true } = {}) {
	const config = {
		type: "attack",
		itemUuid: "Item.weapon-1",
		actorUuid: "Actor.actor-1",
		attack: { type: "ranged" },
	};
	if (selectedAmmoId) config.attack.selectedAmmunition = `Item.${selectedAmmoId}`;
	if (dialog) config._sdxDialogRendered = true;
	await actor.system.rollConfigGenerators.attack(config);
	if (runHook) {
		const html = { querySelector: () => null, querySelectorAll: () => [] };
		await world.hooks.get("renderRollDialogSD")({ config, render: () => {} }, html, {});
	}
	if (roll) await globalThis.shadowdark.dice.rollFromConfig(config);
	return config;
}

// ------------------------------------------------------------------ tests

test("ammo hit and damage bonuses ride the roll config", async () => {
	const actor = makeActor({ ammo: [makeAmmo("ammo-1", { hit: "+2", damage: "+3" })] });
	const world = installWorld(actor);
	const rolled = [];
	installDice(rolled);
	try {
		setupRollConfigPatches();
		const config = await attackAndRoll(actor, { selectedAmmoId: "ammo-1" });

		assert.equal(rolled.length, 1);
		assert.equal(config.mainRoll.bonus, " + 2");
		assert.equal(config.mainRoll.formula, "d20 + 2");
		assert.equal(config.damageRoll.formula, "1d8 + 3");
		assert.ok(config.mainRoll.tooltips.includes("Ammunition"));
		assert.ok(config.damageRoll.tooltips.includes("Ammunition (3)"));
	} finally {
		world.restore();
		delete globalThis.shadowdark;
	}
});

test("dialog rolls keep the ammo bonus (applied after the hook, before the roll)", async () => {
	const actor = makeActor({ ammo: [makeAmmo("ammo-1", { hit: "+2" })] });
	const world = installWorld(actor);
	const rolled = [];
	installDice(rolled);
	try {
		setupRollConfigPatches();
		const config = await attackAndRoll(actor, { selectedAmmoId: "ammo-1", dialog: true, runHook: true, world });
		assert.equal(config.mainRoll.formula, "d20 + 2");
	} finally {
		world.restore();
		delete globalThis.shadowdark;
	}
});

test("actor damage multiplier scales plain ammo bonuses", async () => {
	const actor = makeActor({ actorDamageMultiplier: 2, ammo: [makeAmmo("ammo-1", { damage: "+3" })] });
	const world = installWorld(actor);
	const rolled = [];
	installDice(rolled);
	try {
		setupRollConfigPatches();
		const config = await attackAndRoll(actor, { selectedAmmoId: "ammo-1" });
		assert.equal(config.damageRoll.formula, "1d8 + 6");
	} finally {
		world.restore();
		delete globalThis.shadowdark;
	}
});

test("damage multiplier wraps dice ammo bonuses", async () => {
	const actor = makeActor({ actorDamageMultiplier: 2, ammo: [makeAmmo("ammo-1", { damage: "1d4" })] });
	const world = installWorld(actor);
	const rolled = [];
	installDice(rolled);
	try {
		setupRollConfigPatches();
		const config = await attackAndRoll(actor, { selectedAmmoId: "ammo-1" });
		assert.equal(config.damageRoll.formula, "1d8 + (1d4) * 2");
	} finally {
		world.restore();
		delete globalThis.shadowdark;
	}
});

test("ammo without bonus flags leaves the config unchanged", async () => {
	const actor = makeActor({ ammo: [makeAmmo("ammo-1")] });
	const world = installWorld(actor);
	const rolled = [];
	installDice(rolled);
	try {
		setupRollConfigPatches();
		const config = await attackAndRoll(actor, { selectedAmmoId: "ammo-1" });
		assert.equal(config.mainRoll.bonus, "");
		assert.equal(config.mainRoll.formula, "d20");
		assert.equal(config.damageRoll.formula, "1d8");
		assert.ok(!config.mainRoll.tooltips.includes("Ammunition"));
	} finally {
		world.restore();
		delete globalThis.shadowdark;
	}
});

test("attacks without a selected ammo are unchanged", async () => {
	const actor = makeActor({ ammo: [makeAmmo("ammo-1", { hit: "+2", damage: "+3" })] });
	const world = installWorld(actor);
	const rolled = [];
	installDice(rolled);
	try {
		setupRollConfigPatches();
		const config = await attackAndRoll(actor);
		assert.equal(config.mainRoll.formula, "d20");
		assert.equal(config.damageRoll.formula, "1d8");
	} finally {
		world.restore();
		delete globalThis.shadowdark;
	}
});

test("non-attack configs never get ammo handling", async () => {
	const actor = makeActor({ ammo: [makeAmmo("ammo-1", { hit: "+2" })] });
	const world = installWorld(actor);
	const rolled = [];
	installDice(rolled);
	try {
		setupRollConfigPatches();
		const config = { type: "spell", actorUuid: "Actor.actor-1" };
		await actor.system.rollConfigGenerators.attack(config);
		config.attack = { selectedAmmunition: "Item.ammo-1" };
		await globalThis.shadowdark.dice.rollFromConfig(config);
		assert.equal(config.mainRoll.formula, "d20");
	} finally {
		world.restore();
		delete globalThis.shadowdark;
	}
});

test("skipPrompt attack gets advantage AND ammo bonuses", async () => {
	const actor = makeActor({
		advantage: ["ranged"],
		ammo: [makeAmmo("ammo-1", { hit: "+2" })],
	});
	const world = installWorld(actor);
	const rolled = [];
	installDice(rolled);
	try {
		setupRollConfigPatches();
		const config = await attackAndRoll(actor, { selectedAmmoId: "ammo-1" });
		assert.equal(config.mainRoll.advantage, 1);
		assert.equal(config.mainRoll.formula, "d20 + 2");
	} finally {
		world.restore();
		delete globalThis.shadowdark;
	}
});

test("the hit-bonus card breakdown includes the ammo part", async () => {
	const actor = makeActor({ ammo: [makeAmmo("ammo-1", { hit: "+2" })] });
	const world = installWorld(actor);
	const rolled = [];
	installDice(rolled);
	try {
		setupRollConfigPatches();
		const config = await attackAndRoll(actor, { selectedAmmoId: "ammo-1", runHook: true, world, roll: false });
		config._sdxSelectedHitBonuses = [{ formula: "+1", label: "Weapon Bonus" }];
		// the hook rebuilds the breakdown from the ticked bonuses
		const html = { querySelector: () => null, querySelectorAll: () => [] };
		await world.hooks.get("renderRollDialogSD")({ config, render: () => {} }, html, {});
		await globalThis.shadowdark.dice.rollFromConfig(config);

		assert.ok(config._sdxHitBonusInfo, "breakdown exists");
		assert.equal(config._sdxHitBonusInfo.parts.length, 2);
		assert.equal(config._sdxHitBonusInfo.parts[1].label, "Ammunition");
		assert.equal(config._sdxHitBonusInfo.formula, "+1 + 2");
		assert.equal(config._sdxHitBonusInfo.result, 3);
	} finally {
		world.restore();
		delete globalThis.shadowdark;
	}
});

test("rerolls of a stored config never double-apply the ammo bonus", async () => {
	const actor = makeActor({ ammo: [makeAmmo("ammo-1", { hit: "+2", damage: "+3" })] });
	const world = installWorld(actor);
	const rolled = [];
	installDice(rolled);
	try {
		setupRollConfigPatches();
		// First roll: dialog flow.
		const config = await attackAndRoll(actor, { selectedAmmoId: "ammo-1", dialog: true });
		assert.equal(config.mainRoll.formula, "d20 + 2");
		assert.equal(config.damageRoll.formula, "1d8 + 3");
		assert.ok(config._sdxAmmoApplied);

		// The system stores the whole config on the chat message; a reroll
		// (ChatMessageSD -> rerollFromMessage) calls rollFromConfig with the
		// stored copy. JSON round trip approximates the serialization
		// (underscore keys survive it).
		const stored = JSON.parse(JSON.stringify(config));
		assert.ok(stored._sdxAmmoApplied, "marker survives the round trip");
		await globalThis.shadowdark.dice.rollFromConfig(stored);

		assert.equal(rolled.length, 2);
		assert.equal(stored.mainRoll.formula, "d20 + 2", "no second application");
		assert.equal(stored.damageRoll.formula, "1d8 + 3", "no second application");
		assert.equal(stored.mainRoll.tooltips.match(/Ammunition/g).length, 1);
	} finally {
		world.restore();
		delete globalThis.shadowdark;
	}
});

test("the dead rollItem / availableAmmunition monkeypatches are gone", () => {
	const source = readFileSync(
		new URL("../../scripts/combat/roll-patches.mjs", import.meta.url),
		"utf8"
	);
	assert.ok(!source.includes("item.rollItem = function"));
	assert.ok(!source.includes("item.availableAmmunition = function"));
	assert.ok(!source.includes("_sdxAmmoBonusesApplied"));
});
