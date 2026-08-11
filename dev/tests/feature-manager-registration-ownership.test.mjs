import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals, installDom } from "./helpers/pixi-harness.mjs";
import { installAppGlobals } from "./helpers/dom-harness.mjs";

installCanvasGlobals();
installDom();
installAppGlobals();

const MODULE_ID = "shadowdark-extras";
let disabledFeatureIds = [];
const settings = new Map();
const settingRegistrations = [];
const menuRegistrations = [];
const keybindingRegistrations = [];
const browseCalls = [];
const cacheCalls = [];
const fetchCalls = [];
let decorListingEnabled = false;

globalThis.CONST = { KEYBINDING_PRECEDENCE: { NORMAL: 0 } };
globalThis.game.settings = {
	get: (namespace, key) => {
		if (namespace === MODULE_ID && key === "disabledFeatures") return disabledFeatureIds;
		if (namespace !== MODULE_ID) return undefined;
		return settings.get(key);
	},
	set: async (namespace, key, value) => settings.set(`${namespace}.${key}`, value),
	register: (namespace, key, config) => settingRegistrations.push({ namespace, key, config }),
	registerMenu: (namespace, key, config) => menuRegistrations.push({ namespace, key, config }),
};
globalThis.game.keybindings = {
	register: (namespace, key, config) => keybindingRegistrations.push({ namespace, key, config }),
};
globalThis.game.i18n = {
	localize: key => key,
	format: (key, data) => `${key}:${JSON.stringify(data)}`,
};
globalThis.foundry.applications.apps.FilePicker = {
	implementation: {
		browse: async (_source, path) => {
			browseCalls.push(path);
			if (path.endsWith("/assets/tiles")) return { files: ["modules/shadowdark-extras/assets/tiles/hex-tile-base.webp"], dirs: [] };
			if (path.endsWith("/assets/symbols")) return { files: ["modules/shadowdark-extras/assets/symbols/symbol.webp"], dirs: [] };
			if (decorListingEnabled && path === "decor") return { files: ["decor/tree.webp"], dirs: [] };
			return { files: [], dirs: [] };
		},
	},
};
globalThis.fetch = async path => {
	fetchCalls.push(String(path));
	return { ok: true, blob: async () => new Blob(["tile"]) };
};

const { FEATURE_IDS } = await import("../../scripts/settings/feature-gates.mjs");
const { cache } = await import("../../scripts/shared/SDXCache.mjs");
cache.getMetadata = async key => {
	cacheCalls.push(["getMetadata", key]);
	return null;
};
cache.setMetadata = async (key, value) => {
	cacheCalls.push(["setMetadata", key, value]);
};
cache.getBinary = async key => {
	cacheCalls.push(["getBinary", key]);
	return null;
};
cache.setBinary = async (key, value) => {
	cacheCalls.push(["setBinary", key, value]);
};
cache.getCachedSrc = async key => {
	cacheCalls.push(["getCachedSrc", key]);
	return key;
};

const { registerTraySettings, getPartyTokens } = await import("../../scripts/tray/TraySD.mjs");
const drawingSettings = await import("../../scripts/settings/drawing-settings.mjs");
const { registerSettings, SETTING_OWNERS } = await import("../../scripts/settings/module-settings.mjs");

function resetSpies() {
	settingRegistrations.length = 0;
	menuRegistrations.length = 0;
	keybindingRegistrations.length = 0;
	browseCalls.length = 0;
	cacheCalls.length = 0;
	fetchCalls.length = 0;
}

function registeredSettingKeys() {
	return settingRegistrations.map(registration => registration.key);
}

function registeredMenuKeys() {
	return menuRegistrations.map(registration => registration.key);
}

function registerModuleSettings(...featureIds) {
	resetSpies();
	withDisabled(...featureIds);
	const previousLog = console.log;
	console.log = () => {};
	try {
		registerSettings();
	}
	finally {
		console.log = previousLog;
	}
}

function withDisabled(...featureIds) {
	disabledFeatureIds = featureIds;
}

const TRAY_KEYS = [
	"tray.enabled",
	"tray.showPartyTab",
	"tray.partyName",
	"tray.showHealthBars",
	"tray.showNPCs",
	"tray.hideNpcsFromPlayers",
];
const HEX_KEYS = [
	"hexFog.defaultRevealRadius",
	"hexPainter.customTileWidth",
	"hexPainter.customTileHeight",
	"hexPainter.poiScale",
];
const MAP_GENERATOR_KEYS = ["settlement.useLocalMaphub"];
const MENU_KEYS = new Set([
	"inventoryStylesMenu",
	"sheetEditorMenu",
	"decorDungeondraftPacksMenu",
	"customLightTemplatesMenu",
	"medkitWorldScanMenu",
	"carousingTablesMenu",
	"manageCreatureTypes",
	"combatSettingsMenu",
	"effectsSettingsMenu",
	"hpWavesSettingsMenu",
	"travelActivitiesMenu",
	"travelSpeedsMenu",
	"partyWeatherTableMenu",
	"pinStyleEditorMenu",
	"sdxCoordsMenu",
]);

test("registerSettings registers exactly the mapped settings and menus when all owners are enabled", () => {
	registerModuleSettings();

	const actualSettings = new Set(registeredSettingKeys());
	const actualMenus = new Set(registeredMenuKeys());
	const expectedSettings = new Set(
		Object.keys(SETTING_OWNERS).filter(key => !MENU_KEYS.has(key)),
	);
	const expectedMenus = new Set(
		Object.keys(SETTING_OWNERS).filter(key => MENU_KEYS.has(key)),
	);

	assert.deepEqual([...actualSettings].sort(), [...expectedSettings].sort());
	assert.deepEqual([...actualMenus].sort(), [...expectedMenus].sort());
	assert.deepEqual(registeredSettingKeys().slice(0, 8), [
		"combatSettings",
		"effectsSettings",
		"hpWavesSettings",
		"travelActivities",
		"travelSpeeds",
		"partyWeatherTableUuid",
		"itemacroMigrationDone",
		"webpMigrationDone",
	]);
	assert.equal(settingRegistrations.find(r => r.key === "webpMigrationDone").config.default, false);
	assert.equal(settingRegistrations.find(r => r.key === "customDecorAssets").config.config, false);
	assert.equal(settingRegistrations.find(r => r.key === "customDecorAssets").config.scope, "world");
	for (const [key, expected] of Object.entries({
		"enableFocusTracker": { default: true, scope: "world" },
		"enhanceSpells": { default: true, scope: "world" },
		"enableEnhancedHeader": { default: true, scope: "world" },
		"enableJournalNotes": { default: true, scope: "world" },
		"enableContainers": { default: true, scope: "world" },
		"enableCarousing": { default: true, scope: "world" },
		"enableNpcInventory": { default: true, scope: "world" },
		"enableTorchAnimations": { default: true, scope: "world" },
		"pixelPerfectPins": { default: false, scope: "world" },
	})) {
		const config = settingRegistrations.find(registration => registration.key === key)?.config;
		assert.equal(config?.default, expected.default, `${key} default changed`);
		assert.equal(config?.scope, expected.scope, `${key} scope changed`);
	}
});

test("ownership matrix disables single-owner registrations and preserves shared registrations", () => {
	for (const [key, featureIds] of Object.entries(SETTING_OWNERS)) {
		if (featureIds === null) continue;
		const isMenu = MENU_KEYS.has(key);
		const registrations = () => isMenu ? registeredMenuKeys() : registeredSettingKeys();

		for (const featureId of featureIds) {
			registerModuleSettings(featureId);
			assert.equal(
				registrations().includes(key),
				featureIds.length > 1,
				`${key} must ${featureIds.length > 1 ? "survive" : "disappear"} when ${featureId} is disabled`,
			);
		}

		registerModuleSettings(...featureIds);
		assert.equal(registrations().includes(key), false, `${key} must disappear when all owners are disabled`);
	}
});

test("hidden feature data registrations have an ownership entry and disappear with their owner", () => {
	registerModuleSettings();
	const hiddenKeys = settingRegistrations
		.filter(registration => registration.config.config === false)
		.map(registration => registration.key);

	assert.ok(hiddenKeys.length > 50, "the matrix should include the hidden settings surface");
	for (const key of hiddenKeys) {
		assert.notEqual(SETTING_OWNERS[key], undefined, `${key} is missing from the ownership map`);
		const ownersForKey = SETTING_OWNERS[key];
		if (ownersForKey === null) continue;
		registerModuleSettings(...ownersForKey);
		const isMenu = MENU_KEYS.has(key);
		assert.equal(
			(isMenu ? registeredMenuKeys() : registeredSettingKeys()).includes(key),
			false,
			`${key} remained registered after all feature owners were disabled`,
		);
	}
});

test("enabled tray setting owners preserve the established keys, defaults, and order", () => {
	resetSpies();
	withDisabled();
	registerTraySettings();

	assert.deepEqual(registeredSettingKeys(), [...TRAY_KEYS, ...HEX_KEYS, ...MAP_GENERATOR_KEYS]);
	assert.equal(settingRegistrations.find(r => r.key === "tray.enabled").config.default, true);
	assert.equal(settingRegistrations.find(r => r.key === "hexFog.defaultRevealRadius").config.default, 1);
	assert.equal(settingRegistrations.find(r => r.key === "hexPainter.customTileWidth").config.default, 296);
	assert.equal(settingRegistrations.find(r => r.key === "hexPainter.customTileHeight").config.default, 256);
	assert.equal(settingRegistrations.find(r => r.key === "hexPainter.poiScale").config.default, 0.5);
	assert.equal(settingRegistrations.find(r => r.key === "settlement.useLocalMaphub").config.default, false);
});

test("tray registrations are split by owner and enabled children survive a disabled Tray master", () => {
	resetSpies();
	withDisabled(FEATURE_IDS.TRAY);
	registerTraySettings();

	assert.deepEqual(registeredSettingKeys(), [...TRAY_KEYS.slice(1), ...HEX_KEYS, ...MAP_GENERATOR_KEYS]);

	resetSpies();
	withDisabled(FEATURE_IDS.PARTY_MANAGEMENT, FEATURE_IDS.HEX_PAINTER, FEATURE_IDS.HEX_FOG, FEATURE_IDS.MAP_GENERATORS);
	registerTraySettings();
	assert.deepEqual(registeredSettingKeys(), ["tray.enabled"]);
});

test("Tray data paths do not read unregistered Party settings when Party is disabled", () => {
	const previousGet = game.settings.get;
	const previousModules = game.modules;
	const previousTokens = canvas.tokens;
	let partySettingReads = 0;
	game.settings.get = (namespace, key) => {
		if (namespace === MODULE_ID && key.startsWith("tray.")) partySettingReads++;
		return previousGet(namespace, key);
	};
	game.modules = { get: () => ({ active: false }) };
	canvas.tokens = {
		placeables: [{
			id: "npc",
			name: "NPC",
			actor: {
				type: "NPC",
				isOwner: true,
				hasPlayerOwner: false,
				img: "npc.webp",
				system: { attributes: { hp: { value: 1, max: 1 }, ac: { value: 10 } } },
				getFlag: () => null,
			},
			document: { hidden: false, getFlag: () => null },
		}],
		controlled: [],
	};

	try {
		withDisabled(FEATURE_IDS.PARTY_MANAGEMENT);
		assert.doesNotThrow(() => getPartyTokens());
		assert.equal(partySettingReads, 0);
	}
	finally {
		game.settings.get = previousGet;
		game.modules = previousModules;
		canvas.tokens = previousTokens;
	}
});

test("drawing settings and drawHotkey are absent while Drawing Tools is disabled", () => {
	resetSpies();
	withDisabled(FEATURE_IDS.DRAWING_TOOLS);
	drawingSettings.registerDrawingSettings();

	assert.deepEqual(registeredSettingKeys(), [], "disabled drawing feature must not register settings");
	assert.deepEqual(keybindingRegistrations, [], "disabled drawing feature must not register drawHotkey");
});

test("enabled Drawing Tools preserves its setting/keybinding registration surface", () => {
	resetSpies();
	withDisabled();
	drawingSettings.registerDrawingSettings();

	assert.deepEqual(registeredSettingKeys(), [
		"drawing.enablePlayerDrawing",
		"drawing.timedEraseTimeout",
		"drawing.hotkeyEnabled",
		"drawing.blockWhenTyping",
		"drawing.toolbar.drawingMode",
		"drawing.toolbar.stampStyle",
		"drawing.toolbar.symbolSize",
		"drawing.toolbar.lineWidth",
		"drawing.toolbar.lineStyle",
		"drawing.toolbar.color",
		"drawing.toolbar.timedEraseEnabled",
		"drawing.toolbar.opacity",
		"drawing.toolbar.position",
	]);
	assert.deepEqual(keybindingRegistrations.map(registration => registration.key), ["drawHotkey"]);
	assert.equal(settingRegistrations.find(r => r.key === "drawing.timedEraseTimeout").config.default, 30);
	assert.equal(settingRegistrations.find(r => r.key === "drawing.toolbar.opacity").config.default, 1.0);
});

test("disabling and re-enabling an owner does not overwrite persisted setting values", () => {
	settings.set("tray.partyName", "Expedition");
	settings.set("drawing.toolbar.opacity", 0.42);

	resetSpies();
	withDisabled(FEATURE_IDS.PARTY_MANAGEMENT, FEATURE_IDS.DRAWING_TOOLS);
	registerTraySettings();
	drawingSettings.registerDrawingSettings();
	assert.equal(settings.get("tray.partyName"), "Expedition");
	assert.equal(settings.get("drawing.toolbar.opacity"), 0.42);

	resetSpies();
	withDisabled();
	registerTraySettings();
	drawingSettings.registerDrawingSettings();
	assert.equal(settings.get("tray.partyName"), "Expedition");
	assert.equal(settings.get("drawing.toolbar.opacity"), 0.42);
});

test("Hex Painter keeps its base asset work but does no Decor work when Decor is disabled", async () => {
	withDisabled(FEATURE_IDS.DECOR_PAINTER);
	resetSpies();
	const hexPainter = await import("../../scripts/hex/HexPainterSD.mjs?decor-ownership-disabled");

	await hexPainter.loadTileAssets();
	const data = await hexPainter.getHexPainterData();
	await new Promise(resolve => setImmediate(resolve));

	assert.ok(browseCalls.some(path => path.endsWith("/assets/tiles")), "Hex Painter base tiles still load");
	assert.ok(browseCalls.some(path => path.endsWith("/assets/symbols")), "Hex Painter symbols still load");
	assert.ok(fetchCalls.some(path => path.includes("hex-tile-base.webp")), "Hex Painter background preload still runs");
	assert.equal(browseCalls.some(path => path === "decor"), false, "disabled Decor must not enumerate imported assets");
	assert.equal(browseCalls.some(path => path.startsWith("decor/")), false, "disabled Decor must not enumerate nested assets");
	assert.equal(cacheCalls.some(([, key]) => String(key).includes("decor")), false, "disabled Decor must not use the cache");
	assert.equal(fetchCalls.some(path => path.includes("decor")), false, "disabled Decor must not fetch images");
	assert.deepEqual(data.decorFolders, [], "disabled Decor must not build Decor folders");
});

test("enabled Decor retains imported-asset loading and background preload", async () => {
	withDisabled();
	decorListingEnabled = true;
	resetSpies();
	const hexPainter = await import("../../scripts/hex/HexPainterSD.mjs?decor-ownership-enabled");

	await hexPainter.loadTileAssets();
	await new Promise(resolve => setImmediate(resolve));

	assert.ok(browseCalls.includes("decor"), "enabled Decor still enumerates imported assets");
	assert.ok(fetchCalls.includes("decor/tree.webp"), "enabled Decor still preloads imported images");
	assert.ok(cacheCalls.some(([operation, key]) => operation === "setBinary" && key === "decor/tree.webp"),
		"enabled Decor still caches imported images");
});
