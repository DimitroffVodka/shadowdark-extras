import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import "./helpers/foundry-loader.mjs";

const ROOT = new URL("../../", import.meta.url);
const rootSource = await readFile(new URL("scripts/shadowdark-extras.mjs", ROOT), "utf8");
const { FEATURE_CATALOG, FEATURE_IDS } = await import("../../scripts/settings/feature-gates.mjs");

class FoundryApplication {}
globalThis.foundry = {
	applications: {
		apps: {},
		api: {
			ApplicationV2: FoundryApplication,
			HandlebarsApplicationMixin: Base => class extends Base {},
		},
	},
	utils: {
		duplicate: value => structuredClone(value),
		setProperty: mergePath,
	},
};
globalThis.Hooks = { on() {} };
globalThis.game = { settings: { get: () => true }, user: { targets: new Set() }, actors: new Map() };

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

function matchingDelimiter(source, start, opening, closing) {
	let depth = 0;
	for (let index = start; index < source.length; index += 1) {
		if (source[index] === opening) depth += 1;
		if (source[index] === closing) {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	throw new Error(`unclosed ${opening} at ${start}`);
}

function extractIfBlock(source, marker) {
	const ifStart = source.indexOf("if (", marker);
	assert.ok(ifStart >= 0, `missing if block after ${marker}`);
	const conditionOpen = source.indexOf("(", ifStart);
	const conditionClose = matchingDelimiter(source, conditionOpen, "(", ")");
	const bodyOpen = source.indexOf("{", conditionClose);
	const bodyClose = matchingDelimiter(source, bodyOpen, "{", "}");
	return {
		condition: source.slice(conditionOpen + 1, conditionClose),
		body: source.slice(bodyOpen + 1, bodyClose),
	};
}

function extractArrowBody(source, marker) {
	const bodyOpen = source.indexOf("{", marker);
	assert.ok(bodyOpen >= 0, `missing arrow body after ${marker}`);
	const bodyClose = matchingDelimiter(source, bodyOpen, "{", "}");
	return source.slice(bodyOpen + 1, bodyClose);
}

function evaluateCondition(condition, enabled, extra = {}) {
	return Function("FEATURE_IDS", "featureEnabled", "anyFeatureEnabled", ...Object.keys(extra), `return (${condition});`)(
		FEATURE_IDS,
		featureId => enabled.has(featureId),
		(...featureIds) => featureIds.some(featureId => enabled.has(featureId)),
		...Object.values(extra),
	);
}

function mergePath(target, path, value) {
	const parts = path.split(".");
	let cursor = target;
	for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
	cursor[parts.at(-1)] = value;
}

function configureEnabledFeatures(...enabledIds) {
	const enabled = new Set(enabledIds);
	globalThis.game = {
		settings: {
			get: (_namespace, key) => key === "disabledFeatures"
				? FEATURE_CATALOG.map(feature => feature.id).filter(id => !enabled.has(id))
				: true,
		},
		user: { targets: new Set() },
		actors: new Map(),
	};
}

	test("minimal socket owners enter the gate, while unrelated features do not", () => {
	const marker = "// Socket setup gets its own ready hook";
	const markerStart = rootSource.indexOf(marker);
	const gateStart = rootSource.indexOf("anyFeatureEnabled(", markerStart);
	const gateClose = matchingDelimiter(rootSource, rootSource.indexOf("(", gateStart), "(", ")");
	const gate = rootSource.slice(gateStart, gateClose + 1);
	const evaluateGate = Function("FEATURE_IDS", "anyFeatureEnabled", `return ${gate};`);
	const partyOnly = new Set([FEATURE_IDS.PARTY_MANAGEMENT]);

	assert.equal(
		evaluateGate(FEATURE_IDS, (...ids) => ids.some(id => partyOnly.has(id))),
		true,
		"Party Management must be sufficient to enter socket registration",
	);
	assert.equal(
		evaluateGate(FEATURE_IDS, id => id === FEATURE_IDS.DAMAGE_TYPES),
		false,
		"an unrelated feature must not enter the socket registration",
	);

	const ready = extractArrowBody(rootSource, rootSource.indexOf(")) Hooks.once(\"ready\", () => {", markerStart));
	const calls = [];
	const executeReady = Function(
		"FEATURE_IDS",
		"anyFeatureEnabled",
		"featureEnabled",
		"initMacroExecuteSocket",
		"registerEffectMacroSocket",
		"registerItemMacroSocket",
		"registerPartyTravelSocket",
		"registerTemplateTargetSyncSocket",
		"registerPartyStatsSocket",
		ready,
	);
	const featureEnabled = featureId => partyOnly.has(featureId);
	executeReady(
		FEATURE_IDS,
		(...ids) => ids.some(id => partyOnly.has(id)),
		featureEnabled,
		() => ({}),
		() => calls.push("effect-macro"),
		() => calls.push("item-macro"),
		() => calls.push("party-travel"),
		() => calls.push("template-target-sync"),
		() => calls.push("party-stats"),
	);

	assert.deepEqual(calls, ["party-travel", "party-stats"]);
});

test("chat-card registration gate includes every owner and excludes unrelated features", () => {
	const marker = "// Chat-card target stash and damage-card injection";
	const gate = extractIfBlock(rootSource, rootSource.indexOf(marker));
	const evaluateGate = Function("FEATURE_IDS", "anyFeatureEnabled", `return (${gate.condition});`);
	const owners = [
		FEATURE_IDS.DAMAGE_CARDS,
		FEATURE_IDS.WEAPON_BONUSES,
		FEATURE_IDS.ITEM_MACROS,
		FEATURE_IDS.ANIMATION_FX,
	];

	for (const owner of owners) {
		assert.equal(
			evaluateGate(FEATURE_IDS, (...ids) => ids.includes(owner)),
			true,
			`${owner} must enter chat-card registration`,
		);
	}
	assert.equal(
		evaluateGate(FEATURE_IDS, id => id === FEATURE_IDS.SOURCE_REQUIREMENTS),
		false,
		"an unrelated feature must not enter chat-card registration",
	);
});

test("feature-derived chat-card options keep disabled Damage Cards from owning render work", async () => {
	const hooks = [];
	globalThis.Hooks = { on: (name, callback) => hooks.push({ name, callback }) };
	globalThis.game = {
		settings: {
			get: (namespace, key) => key === "disabledFeatures"
				? [FEATURE_IDS.DAMAGE_CARDS, FEATURE_IDS.WEAPON_BONUSES]
				: true,
		},
		user: { targets: new Set() },
		actors: new Map(),
	};
	const { registerChatCardHooks } = await import("../../scripts/combat/chat-card-hooks.mjs");
	registerChatCardHooks();

	assert.deepEqual(
		hooks.map(hook => hook.name),
		["preCreateChatMessage"],
		"Item Macros retain target capture without either combat render owner",
	);
});

test("target-aware Item Macros capture targets when Damage Cards is disabled", async () => {
	const hooks = [];
	globalThis.Hooks = { on: (name, callback) => hooks.push({ name, callback }) };
	configureEnabledFeatures(FEATURE_IDS.ITEM_MACROS);
	const { registerChatCardHooks } = await import("../../scripts/combat/chat-card-hooks.mjs");
	registerChatCardHooks();

	assert.deepEqual(hooks.map(hook => hook.name), ["preCreateChatMessage"]);
	const target = { id: "target-without-damage-cards" };
	const message = {
		_source: { flags: {} },
		flags: {},
		content: "",
		rolls: [],
		updateSource(update) {
			for (const [path, value] of Object.entries(update)) {
				mergePath(this._source, path, value);
				mergePath(this, path, value);
			}
		},
	};
	globalThis.game.user.targets = new Set([target]);
	globalThis.foundry = {
		utils: {
			duplicate: value => structuredClone(value),
			setProperty: mergePath,
		},
	};

	hooks[0].callback(message, {}, {}, "user-1");
	assert.deepEqual(message._source.flags["shadowdark-extras"].targetIds, [target.id]);
});

test("Weapon Bonuses keeps render behavior when Damage Cards is disabled", async () => {
	const hooks = [];
	globalThis.Hooks = { on: (name, callback) => hooks.push({ name, callback }) };
	configureEnabledFeatures(FEATURE_IDS.WEAPON_BONUSES);
	const { registerChatCardHooks } = await import("../../scripts/combat/chat-card-hooks.mjs");
	registerChatCardHooks();

	assert.deepEqual(hooks.map(hook => hook.name), ["renderChatMessageHTML"]);
});

test("enabled-by-default chat-card registration keeps its original order", async () => {
	const hooks = [];
	globalThis.Hooks = { on: (name, callback) => hooks.push({ name, callback }) };
	configureEnabledFeatures(...FEATURE_CATALOG.map(feature => feature.id));
	const { registerChatCardHooks } = await import("../../scripts/combat/chat-card-hooks.mjs");
	registerChatCardHooks();

	assert.deepEqual(hooks.map(hook => hook.name), ["preCreateChatMessage", "renderChatMessageHTML"]);
});

test("Source Requirements owns its config UI and persistence hook", () => {
	const marker = "// Active Effect config hooks live in";
	const gate = extractIfBlock(rootSource, rootSource.indexOf(marker));
	const sourceOnly = new Set([FEATURE_IDS.SOURCE_REQUIREMENTS]);
	const damageTypesOnly = new Set([FEATURE_IDS.DAMAGE_TYPES]);

	assert.equal(evaluateCondition(gate.condition, sourceOnly), true);
	assert.equal(evaluateCondition(gate.condition, damageTypesOnly), false);
});

test("disabled Carousing performs zero legacy renown migration while the primary GM guard remains", async () => {
	const marker = "// Shadowdark 4.x owns renown natively";
	const migration = extractIfBlock(rootSource, rootSource.indexOf(marker));
	const migrationCalls = [];
	const runMigration = new AsyncFunction(
		"FEATURE_IDS",
		"featureEnabled",
		"game",
		"migrateLegacyRenown",
		"MODULE_ID",
		"console",
		`if (${migration.condition}) {${migration.body}}`,
	);
	const game = {
		system: { id: "shadowdark" },
		user: { id: "gm-1", isGM: true },
		users: { activeGM: { id: "gm-1" } },
		actors: [],
	};

	await runMigration(
		FEATURE_IDS,
		featureId => featureId === FEATURE_IDS.CAROUSING ? false : true,
		game,
		async () => migrationCalls.push("migrated"),
		"shadowdark-extras",
		{ log() {} },
	);
	assert.deepEqual(migrationCalls, []);

	await runMigration(
		FEATURE_IDS,
		featureId => featureId === FEATURE_IDS.CAROUSING,
		game,
		async () => migrationCalls.push("migrated"),
		"shadowdark-extras",
		{ log() {} },
	);
	assert.deepEqual(migrationCalls, ["migrated"]);

	game.user.isGM = false;
	await runMigration(
		FEATURE_IDS,
		featureId => featureId === FEATURE_IDS.CAROUSING,
		game,
		async () => migrationCalls.push("non-primary-gm-migrated"),
		"shadowdark-extras",
		{ log() {} },
	);
	assert.deepEqual(migrationCalls, ["migrated"]);
});
