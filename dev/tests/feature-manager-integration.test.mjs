import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import "./helpers/foundry-loader.mjs";

const ROOT = new URL("../../", import.meta.url);
const source = async path => readFile(new URL(path, ROOT), "utf8");

test("every FEATURE_IDS reference names a catalog constant", async () => {
	const { FEATURE_IDS } = await import("../../scripts/settings/feature-gates.mjs");
	const scriptsRoot = new URL("scripts/", ROOT);
	const entries = await readdir(scriptsRoot, { recursive: true, withFileTypes: true });
	const invalid = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
		const file = `${entry.parentPath}/${entry.name}`;
		const contents = await readFile(file, "utf8");
		for (const match of contents.matchAll(/FEATURE_IDS\.([A-Z][A-Z0-9_]+)/g)) {
			if (!(match[1] in FEATURE_IDS)) invalid.push(`${file}: ${match[1]}`);
		}
	}
	assert.deepEqual(invalid, []);
});

test("every catalog switch gates at least one runtime path outside the catalog", async () => {
	const { FEATURE_IDS } = await import("../../scripts/settings/feature-gates.mjs");
	const scriptsRoot = new URL("scripts/", ROOT);
	const entries = await readdir(scriptsRoot, { recursive: true, withFileTypes: true });
	const runtimeSource = [];
	for (const entry of entries) {
		if (
			!entry.isFile()
			|| !entry.name.endsWith(".mjs")
			|| ["feature-gates.mjs", "feature-manager-choices.mjs"].includes(entry.name)
		) continue;
		const file = `${entry.parentPath}/${entry.name}`;
		runtimeSource.push(await readFile(file, "utf8"));
	}
	const combined = runtimeSource.join("\n");
	const missing = Object.keys(FEATURE_IDS).filter(key => !combined.includes(`FEATURE_IDS.${key}`));
	assert.deepEqual(missing, [], "catalog-only switches do not disable anything");
});

test("Feature Manager registers one restricted menu backed by a hidden world setting", async () => {
	const registrations = [];
	const menus = [];
	globalThis.foundry = {
		applications: {
			api: {
				ApplicationV2: class {},
				HandlebarsApplicationMixin: Base => class extends Base {},
			},
		},
	};
	globalThis.game = {
		settings: {
			register: (namespace, key, config) => registrations.push({ namespace, key, config }),
			registerMenu: (namespace, key, config) => menus.push({ namespace, key, config }),
		},
	};
	const { registerFeatureManagerSettings } = await import("../../scripts/settings/FeatureManagerApp.mjs");
	registerFeatureManagerSettings();

	assert.equal(registrations.length, 1);
	assert.equal(registrations[0].namespace, "shadowdark-extras");
	assert.equal(registrations[0].key, "disabledFeatures");
	assert.equal(registrations[0].config.scope, "world");
	assert.equal(registrations[0].config.config, false);
	assert.equal(registrations[0].config.type, Array);
	assert.deepEqual(registrations[0].config.default, []);
	assert.equal(registrations[0].config.requiresReload, true);

	assert.equal(menus.length, 1);
	assert.equal(menus[0].key, "featureManagerMenu");
	assert.equal(menus[0].config.restricted, true);
});

test("the Scenes form choice disables and re-enables every ToM runtime gate together", async () => {
	const { FEATURE_IDS } = await import("../../scripts/settings/feature-gates.mjs");
	const { FeatureManagerApp } = await import("../../scripts/settings/FeatureManagerApp.mjs");
	const sceneIds = [
		FEATURE_IDS.TOM_SCENES,
		FEATURE_IDS.TOM_VIDEO_OVERLAYS,
		FEATURE_IDS.TOM_SCENE_EDITOR,
		FEATURE_IDS.TOM_PLAYER_VIEW,
		FEATURE_IDS.TOM_SCENE_NAVIGATION,
	];
	let stored = [];
	globalThis.ui = { notifications: { info: () => {} } };
	globalThis.game = {
		settings: {
			get: () => stored,
			set: async (_namespace, _key, value) => {
				stored = value;
			},
		},
	};

	const form = checked => ({
		querySelectorAll: selector => {
			if (selector === 'input[name="featureChoices"]') return [{ value: "scenes", checked }];
			return [];
		},
	});

	await FeatureManagerApp.formHandler(null, form(false));
	assert.deepEqual(stored, sceneIds);

	await FeatureManagerApp.formHandler(null, form(true));
	assert.deepEqual(stored, []);
});

test("every visible tray control and panel is feature-conditional", async () => {
	const template = await source("templates/sdx-tray/tray.hbs");
	const requiredBranches = [
		"features.tomScenes",
		"features.partyManagement",
		"features.journalPins",
		"features.journalPlaceableNotes",
		"features.hexPainter",
		"features.dungeonPainter",
		"features.hexDecorPainter",
		"features.combatMarchingMode",
		"features.combatFormationSpawner",
		"features.canvasLightTracker",
		"features.partyCarousing",
		"features.canvasDrawingTools",
		"features.sceneMapGenerators",
		"features.hexCoordinates",
		"features.hexTooltip",
		"features.hexFog",
		"features.hexSoloMode",
		"features.trayRoller",
		"features.tomVideoOverlays",
	];
	for (const branch of requiredBranches) {
		assert.match(template, new RegExp(branch.replaceAll(".", "\\.")), `missing ${branch}`);
	}
});

test("the gated tray template has balanced Handlebars blocks", async () => {
	const template = await source("templates/sdx-tray/tray.hbs");
	const stack = [];
	for (const match of template.matchAll(/{{([#/])(if|unless|each|with)\b[^}]*}}/g)) {
		if (match[1] === "#") stack.push({ name: match[2], index: match.index });
		else {
			const open = stack.pop();
			assert.ok(open, `unexpected {{/${match[2]}}} at ${match.index}`);
			assert.equal(match[2], open.name, `{{#${open.name}}} at ${open.index} closes as {{/${match[2]}}}`);
		}
	}
	assert.deepEqual(stack, [], "unclosed Handlebars blocks");
});

test("the visual Feature Manager template has balanced Handlebars blocks", async () => {
	const template = await source("templates/feature-manager.hbs");
	const stack = [];
	for (const match of template.matchAll(/{{([#/])(if|unless|each|with)\b[^}]*}}/g)) {
		if (match[1] === "#") stack.push({ name: match[2], index: match.index });
		else {
			const open = stack.pop();
			assert.ok(open, `unexpected {{/${match[2]}}} at ${match.index}`);
			assert.equal(match[2], open.name, `{{#${open.name}}} at ${open.index} closes as {{/${match[2]}}}`);
		}
	}
	assert.deepEqual(stack, [], "unclosed Handlebars blocks");
});

test("tray mode cycling and expensive loaders use the feature gate context", async () => {
	const tray = await source("scripts/tray/TraySD.mjs");
	assert.match(tray, /getVisibleTrayModes\(/);
	assert.match(tray, /features\.journalPins \? getMapNotesData\(\) : \[\]/);
	assert.match(tray, /features\.journalPlaceableNotes && viewMode === "notes"\s*\?\s*await getNoteGroupsData\(scene\)\s*:\s*null/);
	assert.match(tray, /features\.dungeonPainter \? await getDungeonPainterData\(\) : \{\}/);
	assert.match(tray, /features\.hexPainter \|\| features\.hexDecorPainter/);
});

test("feature-owned module-scope hooks were moved behind explicit registration", async () => {
	const pins = await source("scripts/journal/JournalPinsSD.mjs");
	const pinList = await source("scripts/journal/PinListApp.mjs");
	const flatten = await source("scripts/canvas/TileFlattenSD.mjs");
	const multiLevel = await source("scripts/dungeon/DungeonMultiLevelSD.mjs");
	const settlement = await source("scripts/hex/SettlementGenerator.mjs");
	const shapechanger = await source("scripts/macros/shapechanger.mjs");
	const dungeonPainter = await source("scripts/dungeon/DungeonPainterSD.mjs");
	const dungeonBiomes = await source("scripts/dungeon/DungeonBiomesSD.mjs");
	const biomeEditor = await source("scripts/dungeon/BiomeEditorSD.mjs");

	assert.match(pins, /function initJournalPins\(\)/);
	assert.match(pinList, /export function registerPinListHooks\(\)/);
	assert.match(flatten, /export function registerTileFlattenHooks\(\)/);
	assert.match(multiLevel, /export function registerDungeonMultiLevelHooks\(\)/);
	assert.match(settlement, /export function registerSettlementHooks\(\)/);
	assert.match(shapechanger, /export function registerShapechangerHooks\(\)/);
	for (const [name, contents] of Object.entries({ shapechanger, dungeonPainter, dungeonBiomes, biomeEditor })) {
		assert.doesNotMatch(contents, /^Hooks\.(?:on|once)\(/m, `${name} still registers hooks on import`);
	}
});

test("the composition root gates representative visible and hidden initializers", async () => {
	const root = await source("scripts/shadowdark-extras.mjs");
	const requiredGates = [
		"FEATURE_IDS.JOURNAL_PINS",
		"FEATURE_IDS.DUNGEON_PAINTER",
		"FEATURE_IDS.DAMAGE_CARDS",
		"FEATURE_IDS.WEAPON_BONUSES",
		"FEATURE_IDS.ITEM_MACROS",
		"FEATURE_IDS.ENHANCED_HEADER",
		"FEATURE_IDS.CONTAINERS",
		"FEATURE_IDS.NPC_INVENTORY",
		"FEATURE_IDS.TEMPLATE_EFFECTS",
		"FEATURE_IDS.DISPLAY_CARDS",
		"FEATURE_IDS.TOM_SCENES",
	];
	for (const gate of requiredGates) assert.match(root, new RegExp(gate.replaceAll(".", "\\.")));
});

test("the feature setting registers before the gated composition root runs", async () => {
	const root = await source("scripts/shadowdark-extras.mjs");
	const manifest = JSON.parse(await readFile(new URL("../../module.json", import.meta.url), "utf8"));
	const settingHook = root.indexOf('Hooks.once("init", registerFeatureManagerSettings)');
	const compositionHook = root.indexOf('Hooks.once("init", () => {', settingHook + 1);
	const firstFeatureDecision = root.indexOf("FEATURE_IDS.ITEM_MACROS", compositionHook);

	assert.ok(settingHook >= 0, "missing Feature Manager setting init hook");
	assert.ok(compositionHook > settingHook, "feature composition must register after the setting hook");
	assert.ok(firstFeatureDecision > compositionHook, "feature decisions must run inside the gated init phase");
	assert.equal(manifest.esmodules[0], "scripts/shadowdark-extras.mjs");
});
