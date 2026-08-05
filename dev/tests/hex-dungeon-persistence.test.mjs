// Persistence freeze for the hex roots, sweep 6, written before anything moves.
//
// `scripts/hex/HexTooltipSD.mjs` (1,900 lines) and `scripts/hex/SDXHexFogSD.mjs`
// are both scheduled to be split. Between them they own every hex-crawl write
// that reaches a GM's world database:
//
//   journal flag  shadowdark-extras.hexData        the per-hex record store
//   scene flag    shadowdark-extras.hexFogEnabled  per-scene fog toggle
//   scene flag    shadowdark-extras.hexFogEffect   per-scene fog shader name
//
// Settings KEYS are already frozen by `dev/snapshots/settings-keys.json`, and
// flag keys are frozen structurally by `dev/snapshots/flag-keys.json`. Neither
// says anything about the VALUE that gets stored. That is the gap this file
// closes: it drives the real exported writers and pins the exact payload, so a
// split is provable against what lands in the database.
//
// Every expectation here was measured against the current code, not predicted.
// These are characterization tests — they record what the code does today,
// including the asymmetries called out in comments below. They are not a
// statement that today's behaviour is correct.

import assert from "node:assert/strict";
import test from "node:test";

import { installPersistenceGlobals } from "./helpers/persistence-harness.mjs";

const MODULE_ID = "shadowdark-extras";

const world = installPersistenceGlobals();

const {
	HEX_JOURNAL_NAME,
	saveHexRecord,
	setHexTerrain,
	setHexTerrainBatch,
} = await import("../../scripts/hex/HexTooltipSD.mjs");
const {
	setHexFogEnabled,
	setHexFogEffect,
} = await import("../../scripts/hex/SDXHexFogSD.mjs");

/**
 * The 15 fields of a default hex record, in declaration order.
 *
 * This list is the stored schema. Adding a field is a migration for every
 * existing world, so it should be a deliberate edit to this array and not a
 * silent consequence of moving code between files.
 */
const DEFAULT_RECORD_FIELDS = [
	"name", "zone", "terrain", "travel", "exploration", "cleared", "claimed",
	"revealRadius", "revealCells", "rollTable", "rollTableChance",
	"rollTableFirstOnly", "showToPlayers", "features", "notes",
];

const DEFAULT_RECORD = {
	name: "", zone: "", terrain: "", travel: "",
	exploration: "unexplored", cleared: false, claimed: false,
	revealRadius: -1, revealCells: "",
	rollTable: "", rollTableChance: 100, rollTableFirstOnly: false,
	showToPlayers: false, features: [], notes: [],
};

test.beforeEach(() => {
	world.reset();
	world.setGM(true);
	world.showScenes();
});

// --- the store's identity ----------------------------------------------------

test("the hex data journal is identified by a fixed name", () => {
	// Renaming this orphans every existing world's hex data: the lookup is by
	// name, so a new name silently creates a second, empty journal. The same
	// literal is re-declared in SDXHexFogSD.mjs and SceneExporter.mjs.
	assert.equal(HEX_JOURNAL_NAME, "__sdx_hex_data__");
});

test("the hex data journal is created observer-visible to all players", async () => {
	await setHexTerrain("scene-1", "3_4", "Forest");

	assert.deepEqual(world.recorder.documentsCreated, [{
		type: "JournalEntry",
		data: { name: "__sdx_hex_data__", ownership: { default: 2 } },
	}]);
});

test("the journal is created once and reused thereafter", async () => {
	await setHexTerrain("scene-1", "3_4", "Forest");
	world.clearRecords();

	await setHexTerrain("scene-1", "5_5", "Swamp");

	assert.deepEqual(world.recorder.documentsCreated, []);
});

// --- hexData: the stored record shape ----------------------------------------

test("a new hex is stored as a full default record under scene then hex key", async () => {
	await setHexTerrain("scene-1", "3_4", "Forest");

	const [write] = world.flagWrites();
	assert.equal(write.doc, "__sdx_hex_data__");
	assert.equal(write.op, "set");
	assert.equal(write.scope, MODULE_ID);
	assert.equal(write.key, "hexData");
	assert.deepEqual(write.value, {
		"scene-1": { "3_4": { ...DEFAULT_RECORD, terrain: "Forest" } },
	});
});

test("the default record carries exactly 15 fields in a fixed order", async () => {
	await setHexTerrain("scene-1", "3_4", "Forest");

	const record = world.lastFlagValue()["scene-1"]["3_4"];
	assert.deepEqual(Object.keys(record), DEFAULT_RECORD_FIELDS);
});

test("updating terrain on an existing hex leaves every other field alone", async () => {
	await saveHexRecord("scene-1", "3_4", {
		...DEFAULT_RECORD,
		name: "Gloomwood",
		terrain: "Forest",
		cleared: true,
		notes: ["a note"],
	});
	world.clearRecords();

	await setHexTerrain("scene-1", "3_4", "Swamp");

	assert.deepEqual(world.lastFlagValue()["scene-1"]["3_4"], {
		...DEFAULT_RECORD,
		name: "Gloomwood",
		terrain: "Swamp",
		cleared: true,
		notes: ["a note"],
	});
});

test("setHexTerrain returns the record it stored", async () => {
	const returned = await setHexTerrain("scene-1", "3_4", "Tundra");

	assert.deepEqual(returned, { ...DEFAULT_RECORD, terrain: "Tundra" });
	assert.deepEqual(returned, world.lastFlagValue()["scene-1"]["3_4"]);
});

test("saveHexRecord stores the record verbatim without filling defaults", async () => {
	// The normalization lives in setHexTerrain, not in the save path. A caller
	// that hands saveHexRecord a partial record persists a partial record —
	// readers are what tolerate the missing fields.
	await saveHexRecord("scene-1", "9_9", { name: "Partial" });

	assert.deepEqual(world.lastFlagValue()["scene-1"]["9_9"], { name: "Partial" });
});

test("records from different scenes coexist under their own scene keys", async () => {
	await setHexTerrain("scene-a", "0_0", "Hills");
	await setHexTerrain("scene-b", "0_0", "Coast");

	assert.deepEqual(world.lastFlagValue(), {
		"scene-a": { "0_0": { ...DEFAULT_RECORD, terrain: "Hills" } },
		"scene-b": { "0_0": { ...DEFAULT_RECORD, terrain: "Coast" } },
	});
});

// --- hexData: the batch writer -----------------------------------------------

test("a terrain batch is a single flag write however many hexes it touches", async () => {
	await setHexTerrainBatch("scene-1", { "0_0": "Hills", "1_1": "Coast", "2_2": "Marsh" });

	assert.equal(world.flagWrites().length, 1);
});

test("a terrain batch fills defaults for hexes it has not seen", async () => {
	await setHexTerrainBatch("scene-1", { "0_0": "Hills", "1_1": "Coast" });

	assert.deepEqual(world.lastFlagValue(), {
		"scene-1": {
			"0_0": { ...DEFAULT_RECORD, terrain: "Hills" },
			"1_1": { ...DEFAULT_RECORD, terrain: "Coast" },
		},
	});
});

test("a terrain batch preserves hexes and scenes outside the batch", async () => {
	await saveHexRecord("scene-other", "7_7", { ...DEFAULT_RECORD, name: "Keep me" });
	await setHexTerrain("scene-1", "9_9", "Desert");
	world.clearRecords();

	await setHexTerrainBatch("scene-1", { "0_0": "Hills" });

	const value = world.lastFlagValue();
	assert.deepEqual(value["scene-other"]["7_7"], { ...DEFAULT_RECORD, name: "Keep me" });
	assert.deepEqual(value["scene-1"]["9_9"], { ...DEFAULT_RECORD, terrain: "Desert" });
	assert.deepEqual(value["scene-1"]["0_0"], { ...DEFAULT_RECORD, terrain: "Hills" });
});

test("a terrain batch updates only the terrain of a hex that already exists", async () => {
	await saveHexRecord("scene-1", "0_0", { ...DEFAULT_RECORD, name: "Named", claimed: true });
	world.clearRecords();

	await setHexTerrainBatch("scene-1", { "0_0": "Hills" });

	assert.deepEqual(world.lastFlagValue()["scene-1"]["0_0"], {
		...DEFAULT_RECORD, name: "Named", claimed: true, terrain: "Hills",
	});
});

// --- hexData: permission asymmetry -------------------------------------------

test("a non-GM still issues a hexData write when the journal exists", async () => {
	// CHARACTERIZATION, not an endorsement. The fog setters below refuse to
	// write for a non-GM; the hexData writers have no such guard and lean on
	// Foundry rejecting the update server-side (the journal is created at
	// OBSERVER, which is below the level an update needs). Recorded here so a
	// split cannot change it silently in either direction.
	await setHexTerrain("scene-1", "3_4", "Forest");
	world.clearRecords();
	world.setGM(false);

	await setHexTerrain("scene-1", "5_5", "Desert");

	assert.equal(world.flagWrites().length, 1);
	assert.equal(world.flagWrites()[0].key, "hexData");
});

test("a non-GM cannot bring the hex journal into being", async () => {
	world.setGM(false);

	await setHexTerrain("scene-1", "3_4", "Forest");

	assert.deepEqual(world.recorder.documentsCreated, []);
	assert.deepEqual(world.flagWrites(), []);
});

// --- fog: hexFogEnabled ------------------------------------------------------

test("fog enablement is stored as a coerced boolean", async () => {
	for (const [input, stored] of [[1, true], [0, false], ["yes", true], [null, false]]) {
		world.clearRecords();

		await setHexFogEnabled("scene-1", input);

		assert.deepEqual(world.flagWrites(), [{
			doc: "scene", op: "set", scope: MODULE_ID, key: "hexFogEnabled", value: stored,
		}], `input ${JSON.stringify(input)}`);
	}
});

test("setHexFogEnabled returns the boolean it stored", async () => {
	assert.equal(await setHexFogEnabled("scene-1", "yes"), true);
	assert.equal(await setHexFogEnabled("scene-1", 0), false);
});

test("a non-GM does not write fog enablement", async () => {
	world.setGM(false);

	await setHexFogEnabled("scene-1", true);

	assert.deepEqual(world.flagWrites(), []);
});

test("an unknown scene does not write fog enablement", async () => {
	world.hideScenes();

	await setHexFogEnabled("scene-1", true);

	assert.deepEqual(world.flagWrites(), []);
});

// --- fog: hexFogEffect -------------------------------------------------------

test("a named fog effect is stored as its bare name", async () => {
	await setHexFogEffect("scene-1", "mist");

	assert.deepEqual(world.flagWrites(), [{
		doc: "scene", op: "set", scope: MODULE_ID, key: "hexFogEffect", value: "mist",
	}]);
});

test("clearing a fog effect unsets the flag rather than storing a falsy value", async () => {
	// The read path is `getFlag(...) ?? null`, so a stored "" or null would read
	// back as a falsy effect name and behave the same — but it would leave a
	// dead key in every scene. Unsetting is what keeps scene flags clean.
	for (const input of ["", null, undefined, 0]) {
		world.clearRecords();

		await setHexFogEffect("scene-1", input);

		assert.deepEqual(world.flagWrites(), [{
			doc: "scene", op: "unset", scope: MODULE_ID, key: "hexFogEffect",
		}], `input ${JSON.stringify(input)}`);
	}
});

test("a non-GM does not write or clear a fog effect", async () => {
	world.setGM(false);

	await setHexFogEffect("scene-1", "mist");
	await setHexFogEffect("scene-1", "");

	assert.deepEqual(world.flagWrites(), []);
});

test("an unknown scene does not write or clear a fog effect", async () => {
	world.hideScenes();

	await setHexFogEffect("scene-1", "mist");
	await setHexFogEffect("scene-1", "");

	assert.deepEqual(world.flagWrites(), []);
});
