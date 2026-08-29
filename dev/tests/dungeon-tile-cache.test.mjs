import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installMemoryIndexedDB } from "./helpers/indexeddb-harness.mjs";
import { installCanvasGlobals, installDom } from "./helpers/pixi-harness.mjs";

const METADATA_KEY = "dungeon_tiles_metadata";
const FLOOR_FOLDER = "modules/shadowdark-extras/assets/Dungeon/floor_tiles";
const WALL_FOLDER = "modules/shadowdark-extras/assets/Dungeon/wall_tiles";
const DOOR_FOLDER = "modules/shadowdark-extras/assets/Dungeon/door_tiles";
const BACKGROUND_FOLDER = "modules/shadowdark-extras/assets/Dungeon/backgrounds";
const LEGACY_FLOOR_PATH = `${FLOOR_FOLDER}/stone_floor_00.png`;
const CURRENT_FLOOR_PATH = `${FLOOR_FOLDER}/stone_floor_00.webp`;
const CURRENT_WALL_PATH = `${WALL_FOLDER}/stone_wall_00.webp`;
const CURRENT_DOOR_PATH = `${DOOR_FOLDER}/stone_door_00.webp`;
const CURRENT_BACKGROUND_PATH = `${BACKGROUND_FOLDER}/stone_background_00.webp`;

installCanvasGlobals();
installDom();
installMemoryIndexedDB();

const browsedFolders = [];
const unavailableFolders = new Set();
class TestFilePicker {
	static async browse(_source, folder) {
		browsedFolders.push(folder);
		if (unavailableFolders.has(folder)) throw new Error(`Unavailable: ${folder}`);
		return {
			files: {
				[FLOOR_FOLDER]: [CURRENT_FLOOR_PATH],
				[WALL_FOLDER]: [CURRENT_WALL_PATH],
				[DOOR_FOLDER]: [CURRENT_DOOR_PATH],
				[BACKGROUND_FOLDER]: [CURRENT_BACKGROUND_PATH],
			}[folder] || [],
		};
	}
}

globalThis.game.user = { isGM: true };
globalThis.game.users = [{ isGM: true, active: true }];
globalThis.game.scenes = { get: () => null };
globalThis.game.settings = { get: () => undefined, set: async () => {}, register() {}, registerMenu() {} };
globalThis.game.i18n = { localize: key => key };
globalThis.canvas.grid = { size: 100, isHexagonal: false };
globalThis.canvas.scene = null;
globalThis.CONST = { GRID_TYPES: { SQUARE: 1 }, DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
globalThis.foundry.applications = {
	api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base, DialogV2: class {} },
	apps: { FilePicker: { implementation: TestFilePicker } },
	ux: { TextEditor: {} },
};
globalThis.foundry.canvas = { layers: { CanvasLayer: class {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };

// A real world always has this module registered with a version, and the cache
// is stamped with it. Tests that care about invalidation reassign this.
let installedVersion = "6.12.0";
globalThis.game.modules = {
	get: id => (id === "shadowdark-extras"
		? { active: true, version: installedVersion }
		: { active: id === "socketlib" }),
};

const requestedImages = [];
globalThis.fetch = async path => {
	requestedImages.push(path);
	return { ok: false };
};

const { cache } = await import("../../scripts/shared/SDXCache.mjs");
const painter = await import("../../scripts/dungeon/DungeonPainterSD.mjs");
const tileCatalog = await import("../../scripts/dungeon/dungeon-tile-catalog.mjs");

test("legacy dungeon catalog is refreshed before image preloading", async () => {
	await cache.setMetadata(METADATA_KEY, {
		floorTiles: [{
			key: "stone_floor_00",
			label: "Stone Floor 00",
			path: LEGACY_FLOOR_PATH,
			type: "floor",
		}],
		wallTiles: [],
		doorTiles: [],
		backgroundTiles: [],
	});

	await painter.loadDungeonAssets();
	for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));

	assert.equal(painter.getSelectedFloorTile(), CURRENT_FLOOR_PATH);
	assert.ok(requestedImages.includes(CURRENT_FLOOR_PATH));
	assert.ok(!requestedImages.includes(LEGACY_FLOOR_PATH));
	assert.ok(browsedFolders.includes(FLOOR_FOLDER), "legacy metadata should trigger a fresh folder scan");
});

test("player without a GM ignores a legacy dungeon catalog safely", async () => {
	tileCatalog.setFloorTiles(null);
	tileCatalog.setWallTiles(null);
	tileCatalog.setDoorTiles(null);
	tileCatalog.setBackgroundTiles(null);
	painter.selectFloorTile(null);
	painter.selectWallTile(null);
	painter.selectDoorTile(null);
	requestedImages.length = 0;
	browsedFolders.length = 0;
	globalThis.game.user = { isGM: false };
	globalThis.game.users = [];

	await cache.setMetadata(METADATA_KEY, {
		floorTiles: [{
			key: "stone_floor_00",
			label: "Stone Floor 00",
			path: LEGACY_FLOOR_PATH,
			type: "floor",
		}],
		wallTiles: [],
		doorTiles: [],
		backgroundTiles: [],
	});

	await assert.doesNotReject(() => painter.loadDungeonAssets());
	for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));

	assert.equal(painter.getSelectedFloorTile(), null);
	assert.deepEqual(requestedImages, []);
	assert.deepEqual(browsedFolders, []);
});

test("player replaces a legacy catalog with the current catalog received from the GM", async () => {
	tileCatalog.setFloorTiles(null);
	tileCatalog.setWallTiles(null);
	tileCatalog.setDoorTiles(null);
	tileCatalog.setBackgroundTiles(null);
	painter.selectFloorTile(null);
	painter.selectWallTile(null);
	painter.selectDoorTile(null);
	requestedImages.length = 0;
	browsedFolders.length = 0;
	globalThis.game.user = { isGM: false };
	globalThis.game.users = [{ isGM: true, active: true }];

	let gmRequests = 0;
	globalThis.socketlib = {
		registerModule: () => ({
			register() {},
			async executeAsGM(name) {
				assert.equal(name, "dungeonGetTileList");
				gmRequests++;
				return {
					floorTiles: [{
						key: "stone_floor_00",
						label: "Stone Floor 00",
						path: CURRENT_FLOOR_PATH,
						type: "floor",
					}],
					wallTiles: [{
						key: "stone_wall_00",
						label: "Stone Wall 00",
						path: CURRENT_WALL_PATH,
						type: "wall",
					}],
					doorTiles: [{
						key: "stone_door_00",
						label: "Stone Door 00",
						path: CURRENT_DOOR_PATH,
						type: "door",
					}],
					backgroundTiles: [{
						key: "stone_background_00",
						label: "Stone Background 00",
						path: CURRENT_BACKGROUND_PATH,
						type: "background",
					}],
				};
			},
		}),
	};
	painter.initDungeonSocket();

	await cache.setMetadata(METADATA_KEY, {
		floorTiles: [{
			key: "stone_floor_00",
			label: "Stone Floor 00",
			path: LEGACY_FLOOR_PATH,
			type: "floor",
		}],
		wallTiles: [],
		doorTiles: [],
		backgroundTiles: [],
	});

	await painter.loadDungeonAssets();
	for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
	assert.equal(painter.getSelectedFloorTile(), CURRENT_FLOOR_PATH);
	assert.equal(gmRequests, 1);

	// A later reload with no GM online must reuse the repaired local catalog.
	tileCatalog.setFloorTiles(null);
	tileCatalog.setWallTiles(null);
	tileCatalog.setDoorTiles(null);
	tileCatalog.setBackgroundTiles(null);
	painter.selectFloorTile(null);
	painter.selectWallTile(null);
	painter.selectDoorTile(null);
	requestedImages.length = 0;
	globalThis.game.users = [];

	await painter.loadDungeonAssets();
	for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));

	assert.equal(painter.getSelectedFloorTile(), CURRENT_FLOOR_PATH);
	assert.ok(requestedImages.includes(CURRENT_FLOOR_PATH));
	assert.equal(gmRequests, 1, "repaired metadata should avoid a second GM request");
});

test("a module version bump invalidates the cached dungeon catalog", async () => {
	// The GM cache-hit path always re-scans the (small) backgrounds folder, so
	// only a scan of the floor folder distinguishes a rebuild from a cache hit.
	function reloadAsGM() {
		tileCatalog.setFloorTiles(null);
		tileCatalog.setWallTiles(null);
		tileCatalog.setDoorTiles(null);
		tileCatalog.setBackgroundTiles(null);
		painter.selectFloorTile(null);
		painter.selectWallTile(null);
		painter.selectDoorTile(null);
		requestedImages.length = 0;
		browsedFolders.length = 0;
		globalThis.game.user = { isGM: true };
		globalThis.game.users = [{ isGM: true, active: true }];
		return painter.loadDungeonAssets();
	}

	await cache.setMetadata(METADATA_KEY, null);
	await reloadAsGM();
	assert.ok(browsedFolders.includes(FLOOR_FOLDER), "an empty cache should trigger a folder scan");

	// Same version: the freshly written catalog is trusted, no floor re-scan.
	await reloadAsGM();
	assert.equal(painter.getSelectedFloorTile(), CURRENT_FLOOR_PATH);
	assert.ok(!browsedFolders.includes(FLOOR_FOLDER), "an unchanged module version should reuse the cached catalog");

	// Publishing a release must invalidate it without anyone bumping a constant.
	installedVersion = "6.13.0";
	await reloadAsGM();
	assert.equal(painter.getSelectedFloorTile(), CURRENT_FLOOR_PATH);
	assert.ok(browsedFolders.includes(FLOOR_FOLDER), "a module version bump should force a fresh folder scan");
});

test("a failed non-floor scan is not cached and is retried", async () => {
	function resetAsGM() {
		tileCatalog.setFloorTiles(null);
		tileCatalog.setWallTiles(null);
		tileCatalog.setDoorTiles(null);
		tileCatalog.setBackgroundTiles(null);
		painter.selectFloorTile(null);
		painter.selectWallTile(null);
		painter.selectDoorTile(null);
		globalThis.game.user = { isGM: true };
		globalThis.game.users = [{ isGM: true, active: true }];
		return painter.loadDungeonAssets();
	}

	await cache.setMetadata(METADATA_KEY, null);
	unavailableFolders.add(WALL_FOLDER);
	await resetAsGM();
	assert.equal(await cache.getMetadata(METADATA_KEY), null);

	unavailableFolders.delete(WALL_FOLDER);
	browsedFolders.length = 0;
	await resetAsGM();

	assert.ok(browsedFolders.includes(WALL_FOLDER), "the failed wall folder should be retried");
	assert.deepEqual(
		(await cache.getMetadata(METADATA_KEY)).entries.wallTiles.map(tile => tile.path),
		[CURRENT_WALL_PATH],
	);
});
