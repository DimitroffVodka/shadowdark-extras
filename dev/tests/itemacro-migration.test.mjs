import assert from "node:assert/strict";
import test from "node:test";

// Phase 5.2.7 regression (issue #49) — the itemacro migration must be
// idempotent and re-runnable.
//
// The bug: migrateLegacyItemMacros was gated on the itemacroMigrationDone
// world setting and ran once per world. Items arriving AFTER the first run
// (compendium imports, drag-in, future SDX packs) kept only the legacy
// flags.itemacro namespace forever. Measured in world 0100: 20 legacy-only
// items despite the gate being true.
//
// The fix: drop the one-shot gate — the per-item migrateItem is already
// idempotent (migrates only when a legacy command exists AND the SDX flag
// does not), so an ungated sweep on every ready is safe and cheap.
//
// These tests drive the REAL migrateLegacyItemMacros with fake documents
// that record setFlag writes.

// ---- stubs (the module imports only MODULE_ID) ----

const MODULE_ID = "shadowdark-extras";

const worldItems = [];
const actors = [];
const settingValues = { itemacroMigrationDone: true }; // like a world post-migration

globalThis.game = {
	items: worldItems,
	actors,
	user: { id: "user-1", isGM: true },
	settings: {
		get: (scope, key) => settingValues[key],
		set: async (scope, key, value) => {
			settingValues[key] = value;
		},
	},
};

let migrateLegacyItemMacros;
({ migrateLegacyItemMacros } = await import("../../scripts/item-macros/item-macro-engine.mjs"));

// ---- fakes ----

function makeItem({ name, legacyCommand, legacyName, legacyRunAsGM, sdxCommand }) {
	const flags = {};
	if (legacyCommand !== undefined) {
		flags.itemacro = {
			macro: {
				command: legacyCommand,
				name: legacyName,
				runAsGM: legacyRunAsGM,
			},
		};
	}
	if (sdxCommand !== undefined) {
		flags[MODULE_ID] = { macroCommand: sdxCommand };
	}
	const writes = [];
	return {
		name,
		flags,
		writes,
		async setFlag(scope, key, value) {
			if (scope !== MODULE_ID) throw new Error(`unexpected scope ${scope}`);
			writes.push([key, value]);
			this.flags[scope] = { ...(this.flags[scope] || {}), [key]: value };
		},
		// Foundry Document#getFlag is SYNC (only setFlag is async); the
		// migration's `!item.getFlag(...)` guard depends on that.
		getFlag(scope, key) {
			return this.flags[scope]?.[key];
		},
	};
}

function reset() {
	worldItems.length = 0;
	actors.length = 0;
	settingValues.itemacroMigrationDone = true;
}

// ------------------------------------------------------------------ tests

test("legacy-only items are migrated even after the migration gate was set", async () => {
	reset();
	const item = makeItem({
		name: "Firebolt",
		legacyCommand: "console.log('fire');",
		legacyName: "Firebolt (custom)",
		legacyRunAsGM: true,
	});
	worldItems.push(item);
	// a second actor-owned item, also legacy-only
	const actor = { name: "NPC", items: [] };
	const actorItem = makeItem({
		name: "Healing Potion",
		legacyCommand: "game.messages.get('x')",
		legacyName: undefined,
		legacyRunAsGM: false,
	});
	actor.items.push(actorItem);
	actors.push(actor);

	await migrateLegacyItemMacros();

	assert.equal(item.writes.length, 3);
	assert.deepEqual(item.writes[0], ["macroCommand", "console.log('fire');"]);
	assert.deepEqual(item.writes[1], ["macroName", "Firebolt (custom)"]);
	assert.deepEqual(item.writes[2], ["macroRunAsGM", true]);

	assert.equal(actorItem.writes.length, 3);
	assert.deepEqual(actorItem.writes[0], ["macroCommand", "game.messages.get('x')"]);
	// legacy name missing -> falls back to the item name, byte-for-byte
	assert.deepEqual(actorItem.writes[1], ["macroName", "Healing Potion"]);
	assert.deepEqual(actorItem.writes[2], ["macroRunAsGM", false]);
});

test("a second run performs no updates (idempotent)", async () => {
	reset();
	const item = makeItem({
		name: "Firebolt",
		legacyCommand: "console.log('fire');",
		legacyName: "Firebolt (custom)",
	});
	worldItems.push(item);

	await migrateLegacyItemMacros();
	assert.equal(item.writes.length, 3, "first run migrates");

	await migrateLegacyItemMacros();
	assert.equal(item.writes.length, 3, "second run must not write again");
});

test("an already-migrated item (SDX flag present) is untouched", async () => {
	reset();
	const item = makeItem({
		name: "Firebolt",
		legacyCommand: "console.log('fire');",
		sdxCommand: "game.messages.get('custom')",
	});
	worldItems.push(item);

	await migrateLegacyItemMacros();

	assert.equal(item.writes.length, 0, "SDX flag wins; no write");
});

test("items without a legacy command are untouched", async () => {
	reset();
	const item = makeItem({ name: "Plain Sword" });
	worldItems.push(item);

	await migrateLegacyItemMacros();

	assert.equal(item.writes.length, 0);
});

test("macro content is preserved byte-for-byte", async () => {
	reset();
	const command = "await game.messages.get('a').then(x => x.content); //  trailing comment ";
	const item = makeItem({ name: "Whisper", legacyCommand: command });
	worldItems.push(item);

	await migrateLegacyItemMacros();

	assert.equal(item.writes[0][1], command, "command copied verbatim");
});

test("a player client performs no writes (GM-only sweep)", async () => {
	reset();
	const item = makeItem({
		name: "Firebolt",
		legacyCommand: "console.log('fire');",
	});
	worldItems.push(item);
	game.user = { id: "player-1", isGM: false };

	await migrateLegacyItemMacros();

	assert.equal(item.writes.length, 0, "player client must not attempt setFlag");
	game.user = { id: "user-1", isGM: true };
});
