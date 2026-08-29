// hex-tile-cache-version.test.mjs covers the stamping rules against the hex
// catalogues, which are flat arrays. These cases cover only what generalizing
// the envelope for the dungeon painter added: `entries` is opaque, so a
// catalogue may be an object holding four arrays rather than one array, and the
// envelope's own fields must not collide with the payload's.

import assert from "node:assert/strict";
import test from "node:test";

import { installMemoryIndexedDB } from "./helpers/indexeddb-harness.mjs";

installMemoryIndexedDB();

globalThis.game = { modules: { get: () => ({ version: "6.12.0" }) } };

const { cache } = await import("../../scripts/shared/SDXCache.mjs");
const { readShippedManifest, writeShippedManifest, shippedAssetCacheVersion }
	= await import("../../scripts/shared/shipped-asset-cache.mjs");

// The dungeon painter's catalogue: four arrays under one key.
const DUNGEON_CATALOG = {
	floorTiles: [{ key: "stone_floor_00", path: "modules/x/stone_floor_00.webp" }],
	wallTiles: [],
	doorTiles: [],
	backgroundTiles: [],
};

test("an object catalogue round-trips as faithfully as an array one", async () => {
	await writeShippedManifest("envelope_key", DUNGEON_CATALOG, { isEmpty: () => false });
	assert.deepEqual(await readShippedManifest("envelope_key"), DUNGEON_CATALOG);
});

test("a payload carrying its own version key is not shadowed by the stamp", async () => {
	const payload = { version: "payload-owned", tiles: [] };
	await writeShippedManifest("shadowed_key", payload, { isEmpty: () => false });
	assert.deepEqual(await readShippedManifest("shadowed_key"), payload);
});

test("the dungeon painter's old hand-numbered envelope is still rejected", async () => {
	// What DUNGEON_TILE_CACHE_VERSION = 1 wrote: an envelope, but stamped with a
	// literal rather than the module version, and with the arrays spread across
	// it instead of nested under `entries`.
	await cache.setMetadata("legacy_numbered_key", { version: 1, ...DUNGEON_CATALOG });
	assert.equal(await readShippedManifest("legacy_numbered_key"), null);
});

test("an envelope with no entries forces a rescan", async () => {
	await cache.setMetadata("empty_envelope_key", { version: "6.12.0" });
	assert.equal(await readShippedManifest("empty_envelope_key"), null);
});

test("an empty flat catalogue is not persisted", async () => {
	await writeShippedManifest("empty_array_key", [], {
		isEmpty: entries => entries.length === 0,
	});

	assert.equal(await readShippedManifest("empty_array_key"), null);
});

test("a dungeon catalogue with an empty shipped category is not persisted", async () => {
	const emptyDungeonCatalog = {
		floorTiles: [{ key: "stone_floor_00", path: "modules/x/stone_floor_00.webp" }],
		wallTiles: [{ key: "stone_wall_00", path: "modules/x/stone_wall_00.webp" }],
		doorTiles: [{ key: "stone_door_00", path: "modules/x/stone_door_00.webp" }],
		backgroundTiles: [],
	};

	await writeShippedManifest("empty_dungeon_key", emptyDungeonCatalog, {
		isEmpty: entries => Object.values(entries).some(tiles => tiles.length === 0),
	});

	assert.equal(await readShippedManifest("empty_dungeon_key"), null);
});

test("an unbound game global yields no version rather than throwing", async () => {
	// hex-tile-cache-version covers a registry that answers with no version. This
	// is the harder case: `game` itself not bound yet. Reading it through the bare
	// binding would throw a ReferenceError, which the documented "or null when it
	// cannot be determined" contract promises not to do.
	const restore = globalThis.game;
	delete globalThis.game;
	try {
		assert.equal(shippedAssetCacheVersion(), null);
		assert.equal(await readShippedManifest("envelope_key"), null);
		await assert.doesNotReject(() => writeShippedManifest("unbound_key", [], {
			isEmpty: entries => entries.length === 0,
		}));
	}
	finally {
		globalThis.game = restore;
	}
});
