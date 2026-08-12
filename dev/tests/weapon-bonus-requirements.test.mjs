import assert from "node:assert/strict";
import test from "node:test";

// Requirement evaluation and requirement-row UI for weapon bonuses.
//
// Two bugs from a user report ("weapon gives +3 vs undead, bonus never applies"):
//
//   1. `targetAncestry` read `target.system.ancestry?.name`, but SD 4.x declares
//      PlayerSD.ancestry as a DocumentUUIDField — a UUID *string*, so `.name` was
//      always undefined. The `system.details.ancestry` fallback does not exist in
//      4.x either, so every ancestry requirement compared against "" and could
//      never match. The requirement-row placeholder read "e.g., Undead, Humanoid",
//      steering users straight into the dead path.
//
//   2. The creature-type requirement (persisted as `targetSubtype`, now labelled
//      "Target Creature Type") took a free-text value that had to match
//      getEffectiveCreatureType() exactly. It is a dropdown of the configured
//      creature types now.
//
// The import graph reaches CreatureTypesApp.mjs, which destructures
// foundry.applications.api at module load — stubbed below, as in
// lane-b-weapon-bonus-damage.test.mjs.

const ANCESTRY_UUID = "Compendium.shadowdark.ancestries.Item.abc123";

let creatureTypeSetting;
let uuidIndex;

globalThis.window = globalThis;
globalThis.foundry = {
	applications: {
		api: {
			ApplicationV2: class {},
			HandlebarsApplicationMixin: (base) => base,
		},
	},
	utils: { mergeObject: (base, overrides) => ({ ...base, ...overrides }) },
};
globalThis.game = {
	settings: {
		get: (_namespace, key) => key === "creatureTypes"
			? creatureTypeSetting
			: true,
		register: () => {},
	},
	i18n: { localize: (key) => key },
	user: { isGM: true },
};
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
globalThis.fromUuidSync = (uuid) => uuidIndex[uuid] ?? null;

const { evaluateRequirements } = await import("../../scripts/combat/WeaponBonusConfig.mjs");
const { injectWeaponBonusTab } = await import("../../scripts/combat/weapon-bonus-ui.mjs");

test.beforeEach(() => {
	creatureTypeSetting = undefined; // fall back to DEFAULT_CREATURE_TYPES
	uuidIndex = { [ANCESTRY_UUID]: { name: "Dwarf" } };
});

/** A Shadowdark 4.x Player: `system.ancestry` is a compendium UUID string. */
function player(ancestry = ANCESTRY_UUID) {
	return { name: "Thorin", type: "Player", system: { ancestry, alignment: "lawful" } };
}

/** A Shadowdark 4.x NPC: no `ancestry` field exists on the data model at all. */
function npc(name = "Skeleton") {
	return {
		name,
		type: "NPC",
		system: { alignment: "chaotic" },
		getFlag: () => "",
		flags: {},
	};
}

const req = (type, operator, value) => [{ type, operator, value }];

// ---------------------------------------------------------------- targetAncestry

test("targetAncestry resolves a Player's ancestry UUID to its name", () => {
	assert.equal(evaluateRequirements(req("targetAncestry", "equals", "Dwarf"), null, player()), true);
	assert.equal(evaluateRequirements(req("targetAncestry", "contains", "dwa"), null, player()), true);
	assert.equal(evaluateRequirements(req("targetAncestry", "equals", "Elf"), null, player()), false);
});

test("targetAncestry accepts a bare ancestry name (pre-4.x data)", () => {
	assert.equal(evaluateRequirements(req("targetAncestry", "equals", "Elf"), null, player("Elf")), true);
});

test("targetAncestry accepts an embedded ancestry object", () => {
	const actor = { system: { ancestry: { name: "Halfling" } } };
	assert.equal(evaluateRequirements(req("targetAncestry", "equals", "Halfling"), null, actor), true);
});

test("targetAncestry never matches an NPC, which has no ancestry field", () => {
	assert.equal(evaluateRequirements(req("targetAncestry", "contains", "Undead"), null, npc()), false);
});

test("targetAncestry survives an unresolvable uuid instead of throwing", () => {
	globalThis.fromUuidSync = () => {
		throw new Error("pack not loaded");
	};
	assert.equal(evaluateRequirements(req("targetAncestry", "equals", "Dwarf"), null, player()), false);
});

test("targetAncestry survives fromUuidSync being unavailable", () => {
	delete globalThis.fromUuidSync;
	assert.equal(evaluateRequirements(req("targetAncestry", "equals", "Dwarf"), null, player()), false);
	globalThis.fromUuidSync = (uuid) => uuidIndex[uuid] ?? null;
});

// ------------------------------------------------------------- requirement rows

/**
 * Render the Bonuses tab and return the injected HTML.
 *
 * injectWeaponBonusTab drives a jQuery-ish surface; this is the minimal stub
 * from feature-manager-ui-ownership.test.mjs, which collects every fragment the
 * injector writes into the sheet.
 */
function renderBonusesTab(weaponBonus) {
	const fragments = [];
	// A sheet with no native Bonuses tab, so the injector renders the whole tab
	// (requirement rows included) rather than patching an existing one.
	const ABSENT = ['[data-tab="tab-bonuses"]', '[data-tab="tab-source"]', ".sdx-weapon-animation-btn"];
	const makeQuery = (length) => ({
		length,
		find: (selector) => makeQuery(ABSENT.includes(selector) ? 0 : 1),
		on: () => makeQuery(length),
		before: (html) => { fragments.push(String(html)); return makeQuery(length); },
		after: (html) => { fragments.push(String(html)); return makeQuery(length); },
		append: (html) => { fragments.push(String(html)); return makeQuery(length); },
		removeClass: () => makeQuery(length),
	});
	const query = makeQuery(1);

	const item = {
		type: "Weapon",
		name: "Mace",
		flags: { "shadowdark-extras": { weaponBonus } },
		getFlag: () => "",
	};

	injectWeaponBonusTab({ _tabs: [] }, { find: (selector) => query.find(selector) }, item);
	return fragments.join("");
}

const withRequirement = (requirement) => ({
	enabled: true,
	hitBonuses: [{ formula: "3", label: "Undead", requirements: [requirement] }],
	damageBonuses: [],
});

test("a creature-type requirement renders a dropdown of the configured types", () => {
	const html = renderBonusesTab(
		withRequirement({ type: "targetSubtype", operator: "equals", value: "Undead" })
	);

	assert.match(html, /<select class="sdx-hit-bonus-req-value">/,
		"the value control is a dropdown, not a free-text input");
	assert.match(html, /<option value="Undead" selected>Undead<\/option>/,
		"the saved type is selected");
	assert.match(html, /<option value="Dragon" [^>]*>Dragon<\/option>/,
		"the other configured types are offered");
});

test("the creature-type requirement is labelled Target Creature Type", () => {
	const html = renderBonusesTab(
		withRequirement({ type: "targetSubtype", operator: "equals", value: "Undead" })
	);

	assert.match(html, /<option value="targetSubtype" selected>Target Creature Type<\/option>/);
	assert.ok(!html.includes("Target Subtype"), "the old label is gone");
});

test("a saved creature type missing from the world's list stays selectable", () => {
	creatureTypeSetting = ["", "Undead", "Dragon"];
	const html = renderBonusesTab(
		withRequirement({ type: "targetSubtype", operator: "equals", value: "Eldritch" })
	);

	// Without this the <select> renders nothing selected, the browser reports
	// option 0, and the next save silently rewrites the requirement to "".
	assert.match(html, /<option value="Eldritch" selected>Eldritch<\/option>/);
});

test("non-creature-type requirements keep their free-text value input", () => {
	const html = renderBonusesTab(
		withRequirement({ type: "targetName", operator: "contains", value: "Skeleton" })
	);

	assert.match(html, /<input type="text" class="sdx-hit-bonus-req-value" value="Skeleton"/);
});

test("the ancestry placeholder no longer advertises creature types", () => {
	const html = renderBonusesTab(
		withRequirement({ type: "targetAncestry", operator: "contains", value: "" })
	);

	assert.ok(!html.includes("e.g., Undead, Humanoid"),
		"the placeholder pointed users at a requirement that cannot match an NPC");
});
