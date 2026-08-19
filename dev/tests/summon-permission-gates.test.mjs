import assert from "node:assert/strict";
import test from "node:test";
import { escapeHTML } from "./helpers/escape-html.mjs";

// F1 regression: the two GM-routed summon handlers were gated on DAMAGE_CARDS
// while their callers ship under other feature flags. With damage cards
// disabled and ENHANCED_HEADER enabled, rollInitiativeAsGM was never registered
// and the enhanced-header initiative click threw inside socketlib; the same for
// grantSummonOwnership when only ITEM_MACROS was on.
//
// This file must run in its OWN process: socketlibSocket is module-scoped and
// not resettable, so registration happens once at module load. summon-
// permission-handlers.test.mjs cannot install a feature-disable stub — its
// game.settings.get returns undefined, which reads every feature as enabled,
// which is exactly why the original defect was invisible. node --test spawns
// each test file in a separate child process, so the fresh settings stub below
// is picked up by this file's one import of the module graph.
//
// Stub set matches summon-permission-handlers.test.mjs (the import graph
// reaches FocusSpellTrackerSD -> CombatSettingsSD -> damage-card-pipeline.mjs,
// which reads window._sdx_calculatingMessages at load, and the effects tree,
// which destructures foundry.applications.api at module load).
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

// The point of this file: feature-gates resolves against this real array rather
// than undefined. DAMAGE_CARDS is off while every other feature — including
// ENHANCED_HEADER and ITEM_MACROS — stays on.
globalThis.game = {
	settings: {
		get: (namespace, key) =>
			namespace === "shadowdark-extras" && key === "disabledFeatures"
				? ["combat.damageCards"]
				: undefined,
		register: () => {},
		// feature-gates.mjs falls back to game.settings.storage when settings.get
		// throws; this stub never throws, but keep storage present so the fallback
		// path, if ever reached, is deterministic rather than a TypeError.
		storage: { get: () => new Map() },
	},
	i18n: { localize: (key) => key },
	user: { isGM: true },
	messages: { get: () => null },
	actors: { get: () => null },
	combats: { get: () => null },
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

const registered = (name) => registrations.has(name);

test("DAMAGE_CARDS disabled: summon handlers still register under their real gates", () => {
	// grantSummonOwnership is reached from spawnSummonedCreatures, which the
	// damage-card pipeline (DAMAGE_CARDS) and the NPC-feature item-macro path
	// (ITEM_MACROS) both call; WEAPON_BONUSES and ANIMATION_FX share the same
	// registerChatCardHooks gate as the pipeline.
	assert.equal(registered("grantSummonOwnership"), true,
		"grantSummonOwnership must be registered with ITEM_MACROS enabled even when DAMAGE_CARDS is off");
	assert.equal(registered("revokeSummonOwnership"), true,
		"revokeSummonOwnership must be gated identically to grantSummonOwnership");
	// addSummonsToCombatViaGM is reached from addSummonsToCombat inside the same
	// spawnSummonedCreatures, so it must share the same gate — otherwise an
	// ITEM_MACROS-only summon succeeds but silently skips joining the encounter.
	assert.equal(registered("addSummonsToCombatViaGM"), true,
		"addSummonsToCombatViaGM must be registered with ITEM_MACROS enabled even when DAMAGE_CARDS is off");
});

test("DAMAGE_CARDS disabled: rollInitiativeAsGM still registers under ENHANCED_HEADER", () => {
	// The only caller of rollInitiativeAsGM is the enhanced-header initiative
	// click. With DAMAGE_CARDS off but ENHANCED_HEADER on, the handler must be
	// present or the player's click no-ops.
	assert.equal(registered("rollInitiativeAsGM"), true,
		"rollInitiativeAsGM must be registered with ENHANCED_HEADER enabled even when DAMAGE_CARDS is off");
});

test("DAMAGE_CARDS disabled: damage-card-only handlers are NOT registered", () => {
	// Sanity check that the stub genuinely disabled the feature — if these were
	// still registered, the assertions above would be vacuous. addSummonsToCombatViaGM
	// is deliberately NOT here: its gate now covers the same flags as the
	// grant/revoke handlers, so it must stay registered.
	for (const name of ["setTargetDefenseResult", "applyTokenDamage"]) {
		assert.equal(registered(name), false,
			`${name} is gated on DAMAGE_CARDS alone and must be absent`);
	}
});
