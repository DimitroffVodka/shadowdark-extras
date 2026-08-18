import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { escapeHTML } from "./helpers/escape-html.mjs";

// Regression cover for the two GM-routed handlers added for player casters:
// grantSummonOwnership and rollInitiativeAsGM.
//
// Both exist because a player cannot write documents the GM owns. A player
// casting a summon hit "lacks permission to update Actor" from inside
// portal-lib's own worldActor.update() during token creation, and rolling
// initiative from the character sheet failed the same way because
// combat.rollInitiative() updates the combatant. Neither failure can be
// reproduced in-process — they need a live portal-lib and a real player
// session — so what is locked here is the part that is ours: the handler
// bodies' resilience, and the call ORDER on the caster side, which is where
// the first attempt at this fix went wrong.
//
// Stub set matches lane-b-combat-socket.test.mjs: the import graph reaches
// FocusSpellTrackerSD -> CombatSettingsSD -> damage-card-pipeline.mjs, which
// reads window._sdx_calculatingMessages at load, and the effects tree, which
// destructures foundry.applications.api at module load (issue #52 harness
// pattern). game.settings.get returns undefined so no feature id reads as
// disabled, which is what puts the DAMAGE_CARDS handlers on the socket.
//
// socketlibSocket is module-scoped and not resettable, so registration happens
// once at load and the tests pull handlers back out of the fake's map. No
// computed dynamic imports (the structural gate asserts zero in dev/tests).
globalThis.window = globalThis;
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
		deepClone: (value) => JSON.parse(JSON.stringify(value)),
		escapeHTML,
	},
};
globalThis.CONST = {
	TEXT_ANCHOR_POINTS: { TOP: 0, BOTTOM: 1 },
	DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
};
globalThis.canvas = {
	tokens: { get: () => null, placeables: [] },
	interface: { createScrollingText: () => {} },
};

/** Documents the handlers resolve by id; swapped per test. */
const actors = new Map();
const combats = new Map();

globalThis.game = {
	settings: { get: () => undefined, register: () => {} },
	i18n: { localize: (key) => key },
	user: { isGM: true },
	messages: { get: () => null },
	actors: { get: (id) => actors.get(id) ?? null },
	combats: { get: (id) => combats.get(id) ?? null },
};
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

const { setupCombatSocket } = await import("../../scripts/shared/combat-socket.mjs");

const registrations = new Map();
globalThis.socketlib = {
	registerModule: () => ({
		register(name, handler) {
			registrations.set(name, handler);
		},
	}),
};
setupCombatSocket();

const grantSummonOwnership = registrations.get("grantSummonOwnership");
const rollInitiativeAsGM = registrations.get("rollInitiativeAsGM");

/** Actor double recording every update payload it is handed. */
function makeActor(id, ownership, { rejectWith = null } = {}) {
	const updates = [];
	return {
		id,
		ownership,
		updates,
		async update(data) {
			updates.push(data);
			if (rejectWith) throw new Error(rejectWith);
		},
	};
}

/** Runs fn with console.warn captured, returning the collected lines. */
async function captureWarnings(fn) {
	const warnings = [];
	const original = console.warn;
	console.warn = (...args) => warnings.push(args.join(" "));
	try {
		await fn();
	}
	finally {
		console.warn = original;
	}
	return warnings;
}

test("both GM-routed summon handlers are registered on the socket", () => {
	assert.equal(typeof grantSummonOwnership, "function", "grantSummonOwnership must be registered");
	assert.equal(typeof rollInitiativeAsGM, "function", "rollInitiativeAsGM must be registered");
});

test("grantSummonOwnership adds OWNER for the caster without dropping existing ownership", async () => {
	// The spread of actor.ownership is load-bearing: replacing the map instead of
	// extending it would strip the GM's own ownership off every summoned creature.
	actors.clear();
	const goblin = makeActor("goblin", { default: 0, gmUser: 3 });
	const wolf = makeActor("wolf", { default: 0 });
	actors.set("goblin", goblin);
	actors.set("wolf", wolf);

	await grantSummonOwnership({ actorIds: ["goblin", "wolf"], userId: "necro" });

	assert.deepEqual(goblin.updates, [{ ownership: { default: 0, gmUser: 3, necro: 3 } }]);
	assert.deepEqual(wolf.updates, [{ ownership: { default: 0, necro: 3 } }]);
});

test("grantSummonOwnership skips actor ids that no longer resolve", async () => {
	// A profile can name an actor the GM has since deleted. That is a skip, not a
	// throw — the throw would reject the socket call and abort the whole summon.
	actors.clear();
	const wolf = makeActor("wolf", { default: 0 });
	actors.set("wolf", wolf);

	await assert.doesNotReject(() =>
		grantSummonOwnership({ actorIds: ["ghost", "wolf"], userId: "necro" }));

	assert.deepEqual(wolf.updates, [{ ownership: { default: 0, necro: 3 } }]);
});

test("grantSummonOwnership keeps granting after one actor's update is refused", async () => {
	// The try/catch sits inside the loop on purpose. Hoisting it out would let a
	// single refused actor cancel the grant for every creature listed after it.
	actors.clear();
	const goblin = makeActor("goblin", { default: 0 }, { rejectWith: "no permission" });
	const wolf = makeActor("wolf", { default: 0 });
	actors.set("goblin", goblin);
	actors.set("wolf", wolf);

	const warnings = await captureWarnings(() =>
		grantSummonOwnership({ actorIds: ["goblin", "wolf"], userId: "necro" }));

	assert.deepEqual(wolf.updates, [{ ownership: { default: 0, necro: 3 } }],
		"a refusal on the first actor must not skip the second");
	assert.ok(warnings.some((line) => line.includes("grantSummonOwnership failed for actor goblin")));
});

test("rollInitiativeAsGM forwards the combatant and options to the combat", async () => {
	combats.clear();
	const calls = [];
	combats.set("combat1", {
		async rollInitiative(combatantId, options) {
			calls.push({ combatantId, options });
		},
	});

	await rollInitiativeAsGM({
		combatId: "combat1",
		combatantId: "combatant1",
		options: { updateTurn: false },
	});

	assert.deepEqual(calls, [{ combatantId: "combatant1", options: { updateTurn: false } }]);
});

test("rollInitiativeAsGM warns instead of throwing when the combat is gone", async () => {
	// The player's click and the GM's execution are separated by a round trip;
	// the encounter can end in between.
	combats.clear();

	let result;
	const warnings = await captureWarnings(async () => {
		result = await rollInitiativeAsGM({ combatId: "missing", combatantId: "combatant1" });
	});

	assert.equal(result, undefined);
	assert.ok(warnings.some((line) => line.includes("rollInitiativeAsGM: combat not found")));
});

test("rollInitiativeAsGM absorbs a rejected roll rather than failing the socket call", async () => {
	combats.clear();
	combats.set("combat1", {
		async rollInitiative() {
			throw new Error("combatant vanished");
		},
	});

	const warnings = await captureWarnings(() =>
		assert.doesNotReject(() =>
			rollInitiativeAsGM({ combatId: "combat1", combatantId: "combatant1" })));

	assert.ok(warnings.some((line) => line.includes("rollInitiativeAsGM failed")));
});

test("the ownership grant is requested before portal.spawn(), not after it", () => {
	// This is the regression that cost the most time. The first fix wrapped the
	// POST-spawn ownership grant in a try/catch and changed nothing, because the
	// permission error is raised inside portal.spawn() itself — portal-lib calls
	// worldActor.update() while creating the token. Any future edit that moves
	// the grant back below the spawn reintroduces the original bug silently.
	const source = readFileSync(
		new URL("../../scripts/combat/damage-card-actions.mjs", import.meta.url), "utf8");

	const grantAt = source.indexOf("\"grantSummonOwnership\"");
	const spawnAt = source.indexOf("portal.spawn()");

	assert.ok(grantAt !== -1, "the pre-spawn grant must route through grantSummonOwnership");
	assert.ok(spawnAt !== -1, "portal.spawn() call not found");
	assert.ok(grantAt < spawnAt,
		"grantSummonOwnership must be requested before portal.spawn(), or portal-lib's "
		+ "own worldActor.update() fails for a player caster");
});

test("initiative rolls route through the GM only for players", () => {
	// A GM calling executeAsGM would pay a socket round trip to reach itself.
	const source = readFileSync(
		new URL("../../scripts/character-sheet/enhanced-header.mjs", import.meta.url), "utf8");

	assert.match(source, /if \(game\.user\.isGM\) \{\s*await game\.combat\.rollInitiative\(/,
		"GMs must still roll initiative locally");
	assert.match(source, /executeAsGM\("rollInitiativeAsGM"/,
		"players must route the initiative roll through the GM");
});
