import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Lane-B combat split test (Phase 5.3, work items 7/8 — combat-socket boundary).
// Socket authority: setupCombatSocket owns the single socketlib module
// registration; getSocket returns the registered instance. Duplicate-registration
// prevention: a second setupCombatSocket call must not call registerModule again
// (socketlib throws on re-registration) and must return the SAME instance.
//
// The module's import graph reaches FocusSpellTrackerSD -> CombatSettingsSD ->
// damage-card-pipeline.mjs, which reads window._sdx_calculatingMessages at load,
// and the effects tree, which destructures foundry.applications.api at module
// load (issue #52 harness pattern). All are stubbed below.
//
// socketlibSocket is module-scoped and not resettable, so the lifecycle is one
// ordered test: missing-socketlib first (fresh state), then registration and
// the duplicate guard on the SAME module instance. No computed dynamic imports
// (the structural gate asserts zero in dev/tests).
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
		escapeHTML: (value) => String(value),
	},
};
globalThis.CONST = { TEXT_ANCHOR_POINTS: { TOP: 0, BOTTOM: 1 } };
globalThis.canvas = {
	tokens: { get: () => null, placeables: [] },
	interface: { createScrollingText: () => {} },
};
globalThis.game = {
	settings: { get: () => undefined, register: () => {} },
	i18n: { localize: (key) => key },
	user: { isGM: true },
	messages: { get: () => null },
};
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

const { getSocket, setupCombatSocket } = await import("../../scripts/shared/combat-socket.mjs");

/** socketlib fake that records registerModule calls and registered handlers. */
function makeSocketlib() {
	const registrations = new Map();
	const socket = {
		register(name, handler) {
			registrations.set(name, handler);
		},
	};
	const calls = [];
	const registerModule = (id) => {
		calls.push(id);
		return socket;
	};
	return { registerModule, socket, calls, registrations };
}

test("socket lifecycle: missing socketlib, single registration, duplicate guard", async (t) => {
	// 1. Missing socketlib: error, no registration, getSocket stays null.
	const errors = [];
	const originalError = console.error;
	console.error = (...args) => errors.push(args.join(" "));
	delete globalThis.socketlib;
	const missingResult = setupCombatSocket();
	console.error = originalError;

	assert.equal(missingResult, undefined);
	assert.equal(getSocket(), null);
	assert.ok(errors.some((line) => line.includes("socketlib not found")));

	// 2. Present socketlib: one registerModule call, getSocket returns it.
	const fake = makeSocketlib();
	globalThis.socketlib = fake;

	const first = setupCombatSocket();
	assert.equal(fake.calls.length, 1);
	assert.equal(fake.calls[0], "shadowdark-extras");
	assert.equal(first, fake.socket);
	assert.equal(getSocket(), fake.socket);

	// 3. Duplicate guard: no re-registration, same socket instance back.
	const second = setupCombatSocket();
	const third = setupCombatSocket();

	assert.equal(fake.calls.length, 1, "registerModule must be called exactly once");
	assert.equal(second, first);
	assert.equal(third, first);
	assert.equal(getSocket(), first);
});

test("message names and authority rules are preserved on the shared boundary", () => {
	// The shared boundary must keep the exact registration surface callers rely
	// on: applyTokenDamage (damage apply), setTargetDefenseResult (defense
	// checks), showScrollingText, applyTokenCondition, and the trade window
	// handlers used by the inventory lane.
	const source = readFileSync(new URL("../../scripts/shared/combat-socket.mjs", import.meta.url), "utf8");
	for (const name of [
		"setTargetDefenseResult",
		"applyTokenDamage",
		"showScrollingText",
		"applyTokenCondition",
		"removeTargetEffect",
		"applyEffectToTarget",
		"endFocusSpell",
		"transferItemsAsGM",
		"transferCoinsAsGM",
	]) {
		assert.ok(source.includes(`.register("${name}"`), `missing message handler ${name}`);
	}
	// authority: the damage-card caller keeps the executeAsGM contract while the
	// boundary owns registration and the GM-side handlers.
	const damageCard = readFileSync(new URL("../../scripts/combat/damage-card.mjs", import.meta.url), "utf8");
	assert.match(damageCard, /getSocket\(\)\.executeAsGM\(/);
});

test("no direct socketlib module registration remains outside the shared boundary", async () => {
	// Scope: scripts/combat/** must route through combat-socket.mjs. Direct
	// registerModule calls anywhere else would bypass the duplicate guard.
	const { execFileSync } = await import("node:child_process");
	const listed = execFileSync("git", ["ls-files", "scripts/combat", "scripts/shared/combat-socket.mjs"], {
		encoding: "utf8",
	})
		.trim()
		.split("\n")
		.filter((file) => file.endsWith(".mjs") && file !== "scripts/shared/combat-socket.mjs");
	const offenders = listed.filter((file) => {
		const content = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
		return content.includes("socketlib.registerModule");
	});
	assert.deepEqual(offenders, [], "combat files must not call socketlib.registerModule directly");
});
