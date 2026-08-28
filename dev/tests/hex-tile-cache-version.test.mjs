// The hex painter's shipped-asset catalogues were cached in IndexedDB with no
// version stamp and no expiry, so a catalogue written before the PNG -> WebP
// conversion was returned forever and the folder was never rescanned. The hex
// generator then built Tiles from paths whose files no longer exist and Foundry
// logged `Invalid Asset .../Hex - Mountains, medium (lush).png` for every hex,
// while its own file browser - which reads the real filesystem - showed .webp.
//
// WebpMigrationSD cannot cover this: it rewrites paths held in the world
// database, and IndexedDB is per-browser rather than per-world.

import assert from "node:assert/strict";
import test from "node:test";

const MODULE_PREFIX = "modules/shadowdark-extras/";
const HEXES_FOLDER = `${MODULE_PREFIX}assets/Hexes`;
const MOUNTAINS_FOLDER = `${HEXES_FOLDER}/Mountains`;
const LEGACY_PATH = `${MOUNTAINS_FOLDER}/Hex - Mountains, medium (lush).png`;
const CURRENT_PATH = `${MOUNTAINS_FOLDER}/Hex - Mountains, medium (lush).webp`;

function installMemoryIndexedDB() {
	const stores = new Map();

	function requestFor(action) {
		const request = {};
		queueMicrotask(() => {
			try {
				request.result = action();
				request.onsuccess?.();
			}
			catch(error) {
				request.error = error;
				request.onerror?.();
			}
		});
		return request;
	}

	globalThis.indexedDB = {
		open() {
			const request = {};
			queueMicrotask(() => {
				const db = {
					objectStoreNames: { contains: name => stores.has(name) },
					createObjectStore(name) {
						stores.set(name, new Map());
					},
					transaction() {
						return {
							objectStore(name) {
								const store = stores.get(name);
								return {
									get: key => requestFor(() => store.get(key)),
									put: (value, key) => requestFor(() => store.set(key, value)),
								};
							},
						};
					},
				};
				const event = { target: { result: db } };
				request.onupgradeneeded?.(event);
				request.onsuccess?.(event);
			});
			return request;
		},
	};
}

installMemoryIndexedDB();

const browsedFolders = [];
class TestFilePicker {
	static async browse(_source, folder) {
		browsedFolders.push(folder);
		if (folder === HEXES_FOLDER) return { files: [], dirs: [MOUNTAINS_FOLDER] };
		if (folder === MOUNTAINS_FOLDER) return { files: [CURRENT_PATH], dirs: [] };
		return { files: [], dirs: [] };
	}
}

let moduleVersion = "6.12.0";

globalThis.game = {
	user: { isGM: true },
	modules: { get: () => ({ version: moduleVersion }) },
};
globalThis.foundry = {
	applications: { apps: { FilePicker: { implementation: TestFilePicker } } },
};

const { cache } = await import("../../scripts/shared/SDXCache.mjs");
const { readShippedManifest } = await import("../../scripts/shared/shipped-asset-cache.mjs");
const colored = await import("../../scripts/hex/hex-colored-tiles.mjs");

const METADATA_KEY = "hex_tiles_metadata_colored";

test("a legacy unstamped catalogue is evicted, not served", async () => {
	// Exactly what a pre-conversion browser profile holds: a bare array, no
	// envelope, every path still .png.
	await cache.setMetadata(METADATA_KEY, [{
		key: "Hex - Mountains, medium (lush)",
		label: "Hex - Mountains, Medium (Lush)",
		path: LEGACY_PATH,
		isColored: true,
		biome: "mountains",
	}]);

	browsedFolders.length = 0;
	await colored.loadColoredTileAssets();

	const paths = colored.getColoredTiles().map(t => t.path);
	assert.deepEqual(paths, [CURRENT_PATH], "legacy .png path was served from cache");
	assert.ok(browsedFolders.includes(HEXES_FOLDER), "legacy catalogue should force a rescan");

	// The poisoned entry must be overwritten in place, not left beside its
	// replacement under the same key.
	const repaired = await cache.getMetadata(METADATA_KEY);
	assert.equal(repaired.version, moduleVersion);
	assert.deepEqual(repaired.entries.map(t => t.path), [CURRENT_PATH]);
});

test("a catalogue stamped with the running version is reused", async () => {
	browsedFolders.length = 0;
	await colored.loadColoredTileAssets();

	assert.deepEqual(browsedFolders, [], "a current catalogue should not trigger a rescan");
	assert.deepEqual(colored.getColoredTiles().map(t => t.path), [CURRENT_PATH]);
});

test("shipping a new module version invalidates the catalogue", async () => {
	// The stamp is the module version precisely so that a release which changes
	// shipped assets cannot be forgotten about, the way the WebP conversion was.
	moduleVersion = "6.13.0";
	browsedFolders.length = 0;

	await colored.loadColoredTileAssets();

	assert.ok(browsedFolders.includes(HEXES_FOLDER), "a version bump should force a rescan");
	assert.equal((await cache.getMetadata(METADATA_KEY)).version, "6.13.0");
});

test("an undeterminable module version disables the cache rather than guessing", async () => {
	const restore = globalThis.game.modules.get;
	globalThis.game.modules.get = () => undefined;

	assert.equal(await readShippedManifest(METADATA_KEY), null);

	globalThis.game.modules.get = restore;
});
