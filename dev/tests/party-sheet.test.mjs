// Characterization tests for PartySheetSD, captured BEFORE it is split.
//
// The sheet is 1,918 lines. Unlike TrayApp its weight is not one giant method
// but thirty-eight of them, so what has to be pinned before anything moves is
// different: the routing table activateListeners builds, and the arithmetic
// and authorization the methods actually perform.
//
// PartySheetSD is an AppV1 ActorSheet, so it binds through jQuery —
// html.find(sel).click(fn) — and makeJquery records those the same way
// makeSelectorDom records addEventListener. Because every handler is passed as
// `this._onFoo.bind(this)`, the recorded function's name carries the method it
// routes to, which makes the manifest a selector -> event -> method table
// rather than just a list of wired selectors.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom, makeJquery } from "./helpers/dom-harness.mjs";

const dom = makeSelectorDom();
installCanvasGlobals();
installAppGlobals({ dom });
globalThis.game.settings = { get: () => undefined, set: async () => {}, register() {} };
globalThis.game.actors = new Map();
globalThis.game.users = new Map();
globalThis.game.i18n = { localize: key => key, format: key => key };
globalThis.shadowdark = { utils: { toggleItemDetails() {} } };

/** fromUuid is swapped per test; default to "nothing resolves". */
let uuidTable = new Map();
globalThis.fromUuid = async uuid => uuidTable.get(uuid) ?? null;

const MODULE_ID = "shadowdark-extras";

const module = await import("../../scripts/party/PartySheetSD.mjs");
const PartySheetSD = module.default;
const { getBrightestPartyLight, getPartiesContainingActor, isPartyActor } = module;

/** A sheet with no Foundry construction behind it — methods only. */
function makeSheet(actor = null) {
	const sheet = Object.create(PartySheetSD.prototype);
	sheet.actor = actor;
	return sheet;
}

/** A minimal actor: flags by key, plus items and permissions. */
function makeActor({ id = "a1", name = id, type = "Player", flags = {}, items = [],
	isOwner = true, owners = [] } = {}) {
	return {
		id,
		name,
		type,
		uuid: `Actor.${id}`,
		items,
		isOwner,
		getFlag: (scope, key) => (scope === MODULE_ID ? flags[key] : undefined),
		setFlag: async (scope, key, value) => {
			flags[key] = value;
			return value;
		},
		update: async () => undefined,
		testUserPermission: user => owners.includes(user?.id),
	};
}

// --- the routing table ------------------------------------------------------

// Every binding activateListeners makes, as selector :: event -> method.
const ROUTING = [
	".coin-value :: change -> bound _onCoinChange",
	".item-image :: click -> bound _onItemChat",
	".item-name[data-action='show-details'] :: click -> (anonymous)",
	".sdx-task-dc :: change -> bound _onChangeTravelDC",
	".sdx-task-header :: click -> bound _onRollTravelTask",
	".sdx-task-member :: contextmenu -> bound _onToggleTravelAbility",
	"[data-action='add-coins'] :: click -> bound _onAddCoins",
	"[data-action='begin-camping-rest'] :: click -> bound _onBeginCampingRest",
	"[data-action='change-travel-speed'] :: change -> bound _onChangeTravelSpeed",
	"[data-action='configure-party-slots'] :: click -> bound _onConfigurePartySlots",
	"[data-action='configure-weather'] :: click -> bound _onConfigureWeather",
	"[data-action='create-item'] :: click -> bound _onCreateItem",
	"[data-action='divide-coins'] :: click -> bound _onDivideCoins",
	"[data-action='edit-description'] :: click -> bound _onEditDescription",
	"[data-action='item-decrement'] :: click -> bound _onItemDecrement",
	"[data-action='item-increment'] :: click -> bound _onItemIncrement",
	"[data-action='npc-count-change'] :: change -> bound _onNpcCountChange",
	"[data-action='npc-count-decrement'] :: click -> bound _onNpcCountDecrement",
	"[data-action='npc-count-increment'] :: click -> bound _onNpcCountIncrement",
	"[data-action='open-member'] :: click -> bound _onOpenMember",
	"[data-action='place-members'] :: click -> bound _onPlaceMembers",
	"[data-action='recall-members'] :: click -> bound _onRecallMembers",
	"[data-action='remove-member'] :: click -> bound _onRemoveMember",
	"[data-action='remove-travel-member'] :: click -> bound _onRemoveTravelMember",
	"[data-action='reset-travel'] :: click -> bound _onResetTravel",
	"[data-action='reward-coins'] :: click -> bound _onRewardCoins",
	"[data-action='reward-xp'] :: click -> bound _onRewardXp",
	"[data-action='roll-weather'] :: click -> bound _onRollWeather",
	"[data-action='select-travel-ability'] :: change -> bound _onSelectTravelAbility",
	"[data-action='select-travel-task'] :: change -> bound _onSelectTravelTask",
	"[data-action='sync-lights'] :: click -> bound _onSyncLights",
	"[data-action='toggle-light'] :: click -> bound _onToggleLightSource",
	"[data-action='xp-decrement'] :: click -> bound _onXpDecrement",
	"[data-action='xp-increment'] :: click -> bound _onXpIncrement",
];

function bind() {
	const listenerDom = makeSelectorDom();
	const sheet = makeSheet();
	const contextMenus = [];
	sheet._itemContextMenu = element => contextMenus.push(element);
	sheet.activateListeners(makeJquery(listenerDom));
	return { sheet, dom: listenerDom, contextMenus };
}

test("activateListeners wires exactly this selector, event and method table", () => {
	const { dom: bound } = bind();

	const routes = bound.bindings
		.map(b => `${b.selector} :: ${b.event} -> ${b.handler.name || "(anonymous)"}`)
		.sort();
	assert.deepEqual(routes, ROUTING);
});

test("every routed method exists on the prototype, mixins included", () => {
	const { dom: bound } = bind();

	for (const binding of bound.bindings) {
		const method = binding.handler.name.replace(/^bound /, "");
		if (method === "") continue; // the one inline arrow, asserted above
		assert.equal(typeof PartySheetSD.prototype[method], "function",
			`${binding.selector} routes to a missing ${method}`);
	}
});

// The travel, XP and inventory handlers were split into prototype mixins in
// Phase 5.1; that they are still reachable is what makes the table above bind.
test("the three Phase 5.1 mixins are merged onto the prototype", () => {
	for (const method of ["_onResetTravel", "_onXpIncrement", "_onCreateItem"]) {
		assert.equal(typeof PartySheetSD.prototype[method], "function", method);
	}
});

test("the item context menu is built against the raw element, not the jQuery wrapper", () => {
	const { contextMenus } = bind();

	assert.equal(contextMenus.length, 1);
	assert.equal(typeof contextMenus[0].querySelector, "function");
});

// --- party token recall -----------------------------------------------------

test("recall removes every Player-member token while leaving NPC and Party tokens", async () => {
	const player = makeActor({ id: "hero", type: "Player" });
	const compendiumPlayer = {
		id: "compendium-hero",
		type: "Player",
		uuid: "Compendium.shadowdark.actors.compendium-hero",
	};
	const npc = makeActor({ id: "guide", type: "NPC" });
	const party = makeActor({ id: "party", type: "NPC", flags: { isParty: true } });
	const deleted = [];
	const previousScene = globalThis.canvas.scene;
	const previousUser = globalThis.game.user;
	const previousConfirm = foundry.applications.api.DialogV2.confirm;

	globalThis.game.user = { id: "gm", isGM: true };
	globalThis.canvas.scene = {
		tokens: {
			contents: [
				{ id: "hero-1", actorId: "hero" },
				{ id: "hero-2", actorId: "hero" },
				{
					id: "imported-hero-1",
					actorId: "imported-hero",
					actor: { _stats: { compendiumSource: compendiumPlayer.uuid } },
				},
				{
					id: "imported-hero-2",
					actorId: "imported-hero-2",
					actor: { _source: { _stats: { compendiumSource: compendiumPlayer.uuid } } },
				},
				{
					id: "legacy-imported-hero",
					actorId: "legacy-imported-hero",
					actor: { flags: { core: { sourceId: compendiumPlayer.uuid } } },
				},
				{ id: "guide-1", actorId: "guide" },
				{ id: "party-1", actorId: "party" },
				{ id: "stranger-1", actorId: "stranger" },
			],
		},
		deleteEmbeddedDocuments: async (type, ids) => deleted.push({ type, ids }),
	};
	foundry.applications.api.DialogV2.confirm = async () => true;

	try {
		const sheet = makeSheet(party);
		sheet.getMembers = async () => [player, compendiumPlayer, npc];
		await sheet._onRecallMembers({ preventDefault() {} });

		assert.deepEqual(deleted, [{
			type: "Token",
			ids: [
				"hero-1",
				"hero-2",
				"imported-hero-1",
				"imported-hero-2",
				"legacy-imported-hero",
			],
		}]);
	}
	finally {
		globalThis.canvas.scene = previousScene;
		globalThis.game.user = previousUser;
		foundry.applications.api.DialogV2.confirm = previousConfirm;
	}
});

test("canceling recall leaves every scene token untouched", async () => {
	const player = makeActor({ id: "hero", type: "Player" });
	const deleted = [];
	const previousScene = globalThis.canvas.scene;
	const previousUser = globalThis.game.user;
	const previousConfirm = foundry.applications.api.DialogV2.confirm;

	globalThis.game.user = { id: "gm", isGM: true };
	globalThis.canvas.scene = {
		tokens: { contents: [{ id: "hero-1", actorId: "hero" }] },
		deleteEmbeddedDocuments: async (type, ids) => deleted.push({ type, ids }),
	};
	foundry.applications.api.DialogV2.confirm = async () => false;

	try {
		const sheet = makeSheet();
		sheet.getMembers = async () => [player];
		await sheet._onRecallMembers({ preventDefault() {} });
		assert.deepEqual(deleted, []);
	}
	finally {
		globalThis.canvas.scene = previousScene;
		globalThis.game.user = previousUser;
		foundry.applications.api.DialogV2.confirm = previousConfirm;
	}
});

test("recall deletes from the scene that opened the confirmation", async () => {
	const player = makeActor({ id: "hero", type: "Player" });
	const originalDeletes = [];
	const switchedDeletes = [];
	const previousScene = globalThis.canvas.scene;
	const previousUser = globalThis.game.user;
	const previousConfirm = foundry.applications.api.DialogV2.confirm;
	const switchedScene = {
		tokens: { contents: [] },
		deleteEmbeddedDocuments: async (type, ids) => switchedDeletes.push({ type, ids }),
	};
	const originalScene = {
		tokens: { contents: [{ id: "hero-1", actorId: "hero" }] },
		deleteEmbeddedDocuments: async (type, ids) => originalDeletes.push({ type, ids }),
	};

	globalThis.game.user = { id: "gm", isGM: true };
	globalThis.canvas.scene = originalScene;
	foundry.applications.api.DialogV2.confirm = async () => {
		globalThis.canvas.scene = switchedScene;
		return true;
	};

	try {
		const sheet = makeSheet();
		sheet.getMembers = async () => [player];
		await sheet._onRecallMembers({ preventDefault() {} });

		assert.deepEqual(originalDeletes, [{ type: "Token", ids: ["hero-1"] }]);
		assert.deepEqual(switchedDeletes, []);
	}
	finally {
		globalThis.canvas.scene = previousScene;
		globalThis.game.user = previousUser;
		foundry.applications.api.DialogV2.confirm = previousConfirm;
	}
});

test("non-GMs cannot recall Party tokens", async () => {
	const player = makeActor({ id: "hero", type: "Player" });
	const deleted = [];
	const previousScene = globalThis.canvas.scene;
	const previousUser = globalThis.game.user;
	const previousConfirm = foundry.applications.api.DialogV2.confirm;

	globalThis.game.user = { id: "player", isGM: false };
	globalThis.canvas.scene = {
		tokens: { contents: [{ id: "hero-1", actorId: "hero" }] },
		deleteEmbeddedDocuments: async (type, ids) => deleted.push({ type, ids }),
	};
	foundry.applications.api.DialogV2.confirm = async () => {
		throw new Error("non-GM recall reached confirmation");
	};

	try {
		const sheet = makeSheet();
		sheet.getMembers = async () => [player];
		await sheet._onRecallMembers({ preventDefault() {} });
		assert.deepEqual(deleted, []);
	}
	finally {
		globalThis.canvas.scene = previousScene;
		globalThis.game.user = previousUser;
		foundry.applications.api.DialogV2.confirm = previousConfirm;
	}
});

test("recall handles no scene, no matching tokens, and deletion failure safely", async () => {
	const player = makeActor({ id: "hero", type: "Player" });
	const previousScene = globalThis.canvas.scene;
	const previousUser = globalThis.game.user;
	const previousConfirm = foundry.applications.api.DialogV2.confirm;
	const previousError = globalThis.ui.notifications.error;
	let confirmCount = 0;
	const errors = [];

	globalThis.game.user = { id: "gm", isGM: true };
	foundry.applications.api.DialogV2.confirm = async () => {
		confirmCount++;
		return true;
	};
	globalThis.ui.notifications.error = message => errors.push(message);

	try {
		const sheet = makeSheet();
		sheet.getMembers = async () => [player];

		globalThis.canvas.scene = null;
		await sheet._onRecallMembers({ preventDefault() {} });

		globalThis.canvas.scene = { tokens: { contents: [] } };
		await sheet._onRecallMembers({ preventDefault() {} });

		globalThis.canvas.scene = {
			tokens: { contents: [{ id: "hero-1", actorId: "hero" }] },
			deleteEmbeddedDocuments: async () => { throw new Error("delete failed"); },
		};
		await sheet._onRecallMembers({ preventDefault() {} });

		assert.equal(confirmCount, 1);
		assert.deepEqual(errors, ["SHADOWDARK_EXTRAS.party.recall_failed"]);
	}
	finally {
		globalThis.canvas.scene = previousScene;
		globalThis.game.user = previousUser;
		foundry.applications.api.DialogV2.confirm = previousConfirm;
		globalThis.ui.notifications.error = previousError;
	}
});

// --- ability modifiers ------------------------------------------------------

test("ability scores map to Shadowdark's modifier table", () => {
	const sheet = makeSheet();
	const expected = [
		[1, -4], [3, -4], [4, -3], [5, -3], [6, -2], [7, -2], [8, -1], [9, -1],
		[10, 0], [11, 0], [12, 1], [13, 1], [14, 2], [15, 2], [16, 3], [17, 3],
		[18, 4], [20, 4],
	];

	for (const [score, mod] of expected) {
		assert.equal(sheet._calculateMod(score), mod, `score ${score}`);
	}
});

test("a score below the table falls back to zero rather than extrapolating", () => {
	const sheet = makeSheet();

	assert.equal(sheet._calculateMod(0), 0);
	assert.equal(sheet._calculateMod(-5), 0);
	assert.equal(sheet._calculateMod(undefined), 0);
});

// --- party statistics -------------------------------------------------------

const member = (hp, max, ac, level, isNPC = false) => ({ hp: { value: hp, max }, ac, level, isNPC });

test("an empty party reports zeroes rather than dividing by zero", () => {
	assert.deepEqual(makeSheet()._calculatePartyStats([]), {
		totalHp: 0, maxHp: 0, avgAc: 0, avgLevel: 0,
	});
});

test("hit points sum and armour class averages across the party", () => {
	const stats = makeSheet()._calculatePartyStats([
		member(5, 10, 12, 1),
		member(7, 12, 15, 3),
	]);

	assert.equal(stats.totalHp, 12);
	assert.equal(stats.maxHp, 22);
	assert.equal(stats.avgAc, 14, "13.5 rounds up");
});

test("NPCs count toward hit points and armour but not average level", () => {
	const stats = makeSheet()._calculatePartyStats([
		member(5, 10, 10, 2),
		member(5, 10, 10, 99, true),
	]);

	assert.equal(stats.totalHp, 10);
	assert.equal(stats.avgLevel, 2, "the level-99 NPC is excluded");
});

test("a party of only NPCs reports level zero", () => {
	const stats = makeSheet()._calculatePartyStats([member(5, 10, 10, 4, true)]);

	assert.equal(stats.avgLevel, 0);
});

test("a non-numeric level is skipped instead of poisoning the average", () => {
	const stats = makeSheet()._calculatePartyStats([
		member(5, 10, 10, 2),
		member(5, 10, 10, "unknown"),
	]);

	assert.equal(stats.avgLevel, 2);
});

// --- class and ancestry lookup ----------------------------------------------

test("class and ancestry resolve through the UUID they are stored as", async () => {
	const sheet = makeSheet();
	uuidTable = new Map([
		["Compendium.class.thief", { name: "Thief" }],
		["Compendium.ancestry.elf", { name: "Elf" }],
	]);
	const actor = { system: { class: "Compendium.class.thief", ancestry: "Compendium.ancestry.elf" } };

	assert.equal(await sheet._getMemberClassName(actor), "Thief");
	assert.equal(await sheet._getMemberAncestryName(actor), "Elf");
});

test("an unset or unresolvable class and ancestry read as empty, never undefined", async () => {
	const sheet = makeSheet();
	uuidTable = new Map();

	assert.equal(await sheet._getMemberClassName({ system: {} }), "");
	assert.equal(await sheet._getMemberAncestryName({ system: {} }), "");
	assert.equal(await sheet._getMemberClassName({ system: { class: "Compendium.gone" } }), "");
});

// --- containers and slots ---------------------------------------------------

test("only a Basic item carrying the container flag counts as a container", () => {
	const sheet = makeSheet();
	const flagged = { type: "Basic", getFlag: (s, k) => k === "isContainer" };

	assert.equal(sheet._isContainerItem(flagged), true);
	assert.equal(sheet._isContainerItem({ type: "Basic", getFlag: () => false }), false);
	assert.equal(sheet._isContainerItem({ type: "Weapon", getFlag: () => true }), false);
	assert.equal(sheet._isContainerItem(null), false);
	assert.equal(sheet._isContainerItem({ type: "Basic" }), false, "no getFlag at all");
});

test("container contents are the sibling items pointing back at its id", () => {
	const sheet = makeSheet();
	const items = [
		{ id: "i1", getFlag: () => "bag" },
		{ id: "i2", getFlag: () => "other" },
		{ id: "i3", getFlag: () => "bag" },
	];
	const bag = { id: "bag", parent: { items } };

	assert.deepEqual(sheet._getContainedItems(bag).map(i => i.id), ["i1", "i3"]);
});

test("an unparented container reports no contents instead of throwing", () => {
	assert.deepEqual(makeSheet()._getContainedItems({ id: "bag" }), []);
	assert.deepEqual(makeSheet()._getContainedItems(null), []);
});

test("slots are quantity over per-slot, rounded up, times slots used", () => {
	const sheet = makeSheet();
	const slots = (quantity, per_slot, slots_used) =>
		sheet._calculateSlotsFromItemData({ system: { quantity, slots: { per_slot, slots_used } } });

	assert.equal(slots(1, 1, 1), 1);
	assert.equal(slots(10, 5, 1), 2);
	assert.equal(slots(11, 5, 1), 3, "a partial slot still occupies a whole one");
	assert.equal(slots(2, 1, 3), 6);
	assert.equal(slots(0, 1, 1), 0);
});

test("missing or nonsensical slot data falls back to one of each", () => {
	const sheet = makeSheet();

	assert.equal(sheet._calculateSlotsFromItemData({}), 1);
	assert.equal(sheet._calculateSlotsFromItemData(undefined), 1);
	assert.equal(
		sheet._calculateSlotsFromItemData({ system: { quantity: -5, slots: { per_slot: 0 } } }),
		0,
		"a negative quantity clamps to zero and a zero per-slot to one",
	);
});

// --- member movement permission ---------------------------------------------

test("a GM may move any member, present in the world or not", () => {
	const sheet = makeSheet();
	globalThis.game.user = { isGM: true, id: "gm" };

	assert.equal(sheet._canUserMoveMember({ id: "nobody" }), true);
	assert.equal(sheet._canUserMoveMember(null), true);
});

test("a player may move only the members they own", () => {
	const sheet = makeSheet();
	globalThis.game.user = { isGM: false, id: "p1" };
	globalThis.game.actors = new Map([
		["mine", makeActor({ id: "mine", isOwner: true })],
		["theirs", makeActor({ id: "theirs", isOwner: false })],
	]);

	assert.equal(sheet._canUserMoveMember({ id: "mine" }), true);
	assert.equal(sheet._canUserMoveMember({ id: "theirs" }), false);
	assert.equal(sheet._canUserMoveMember({ id: "missing" }), false);
	assert.equal(sheet._canUserMoveMember(null), false);
});

// --- party membership -------------------------------------------------------

test("a party is an NPC actor flagged isParty", () => {
	assert.equal(isPartyActor(makeActor({ type: "NPC", flags: { isParty: true } })), true);
	assert.equal(isPartyActor(makeActor({ type: "NPC", flags: {} })), false);
	assert.equal(isPartyActor(makeActor({ type: "Player", flags: { isParty: true } })), false);
	assert.equal(isPartyActor(null), false);
});

test("membership matches on either the world id or the compendium uuid", () => {
	const byId = makeActor({ id: "p-id", flags: { members: ["hero"] } });
	const byUuid = makeActor({ id: "p-uuid", flags: { members: ["Actor.hero"] } });
	const notAParty = makeActor({ id: "plain", flags: {} });
	globalThis.game.actors = [byId, byUuid, notAParty];

	const parties = getPartiesContainingActor(makeActor({ id: "hero" }));

	assert.deepEqual(parties.map(p => p.id), ["p-id", "p-uuid"]);
});

test("an actor in no party, and no actor at all, both yield an empty list", () => {
	globalThis.game.actors = [makeActor({ id: "party", flags: { members: ["someone"] } })];

	assert.deepEqual(getPartiesContainingActor(makeActor({ id: "loner" })), []);
	assert.deepEqual(getPartiesContainingActor(null), []);
});

// --- brightest party light --------------------------------------------------

const lightItem = (name, template, { type = "Basic", active = true, extra = {} } = {}) => ({
	name,
	type,
	system: { light: { isSource: true, active, template, ...extra } },
});

/** A party whose own inventory holds the given items, with no members. */
function lightParty(items, memberIds = []) {
	return makeActor({ id: "party", flags: { members: memberIds }, items });
}

// getBrightestPartyLight first tries to read Shadowdark's own light mappings
// out of the system's JSON and only falls back to its inlined table when that
// read fails. Absent an override the harness has no fetchJsonWithTimeout, so
// the call throws into the function's own catch and every test below the next
// two runs on the fallback table — which is the path a world without the
// system's assets takes.
test("the system's light mappings win when they can be read", async () => {
	globalThis.foundry.utils.fetchJsonWithTimeout = async () => ({
		torch: { light: { bright: 99, dim: 111, color: "#abcdef", alpha: 0.9, angle: 180 } },
	});
	try {
		const light = await getBrightestPartyLight(lightParty([lightItem("Torch", "torch")]));

		assert.equal(light.bright, 99, "the JSON value, not the fallback 5");
		assert.equal(light.dim, 111);
		assert.equal(light.angle, 180);
		assert.equal(light.color, "#abcdef");
	}
	finally {
		delete globalThis.foundry.utils.fetchJsonWithTimeout;
	}
});

test("a template absent from the system's mappings still falls back", async () => {
	globalThis.foundry.utils.fetchJsonWithTimeout = async () => ({});
	try {
		const light = await getBrightestPartyLight(lightParty([lightItem("Torch", "torch")]));

		assert.equal(light.bright, 5, "the inlined fallback torch");
	}
	finally {
		delete globalThis.foundry.utils.fetchJsonWithTimeout;
	}
});

test("no active light source leaves the party dark", async () => {
	const party = lightParty([lightItem("Torch", "torch", { active: false })]);

	assert.equal(await getBrightestPartyLight(party), null);
	assert.equal(await getBrightestPartyLight(null), null);
});

test("an item that is not a light source is ignored even when active", async () => {
	const sword = { name: "Sword", type: "Weapon", system: { light: { active: true } } };

	assert.equal(await getBrightestPartyLight(lightParty([sword])), null);
});

test("a known fallback template supplies the light geometry", async () => {
	const light = await getBrightestPartyLight(lightParty([lightItem("Torch", "torch")]));

	assert.equal(light.bright, 5);
	assert.equal(light.dim, 30);
	assert.equal(light.angle, 360);
	assert.equal(light.color, "#d1c846");
});

test("the brightest source wins, with dim breaking a tie", async () => {
	const brighter = await getBrightestPartyLight(
		lightParty([lightItem("Torch", "torch"), lightItem("Lantern", "lantern")]),
	);
	assert.equal(brighter.bright, 15, "the lantern out-brights the torch");

	const tie = await getBrightestPartyLight(lightParty([
		lightItem("Narrow", "custom", { extra: { bright: 10, dim: 10 } }),
		lightItem("Wide", "custom", { extra: { bright: 10, dim: 40 } }),
	]));

	assert.equal(tie.dim, 40, "equal bright, so the wider dim radius wins");
});

test("an unknown template falls back to the item's own light values", async () => {
	const light = await getBrightestPartyLight(lightParty([
		lightItem("Weird", "no-such-template", { extra: { bright: 7, dim: 9, angle: 90 } }),
	]));

	assert.equal(light.bright, 7);
	assert.equal(light.dim, 9);
	assert.equal(light.angle, 90);
});

test("the party actor's own items count, so a campfire lights the party token", async () => {
	// Camping puts its temporary campfire on the party actor rather than a
	// member, precisely so every member stays free to perform a task.
	const light = await getBrightestPartyLight(lightParty([lightItem("Campfire", "lantern")]));

	assert.equal(light.bright, 15);
});

test("member lights are gathered alongside the party's own", async () => {
	const hero = makeActor({ id: "hero", items: [lightItem("Lantern", "lantern")] });
	globalThis.game.actors = new Map([["hero", hero]]);

	const light = await getBrightestPartyLight(lightParty([lightItem("Torch", "torch")], ["hero"]));

	assert.equal(light.bright, 15, "the member's lantern beats the party's torch");
});

test("an Effect item lights just as a Basic one does", async () => {
	const spell = lightItem("Light", "lightSpellNear", { type: "Effect" });

	assert.equal((await getBrightestPartyLight(lightParty([spell]))).bright, 30);
});

// --- travel mutation authorization ------------------------------------------

const gm = { id: "gm", isGM: true };
const player = { id: "p1", isGM: false };

function travelParty({ members = ["hero"], assignments = {}, selections = {} } = {}) {
	const updates = [];
	const actor = makeActor({
		id: "party",
		type: "NPC",
		flags: {
			isParty: true,
			members,
			travelAssignments: assignments,
			travelSelections: selections,
		},
	});
	actor.update = async data => {
		updates.push(data);
		return actor;
	};
	actor.updates = updates;
	return actor;
}

test("a mutation is refused unless the target really is a Party actor", async () => {
	const notFlagged = makeActor({ id: "x", type: "NPC", flags: {} });
	const notNpc = makeActor({ id: "y", type: "Player", flags: { isParty: true } });
	const request = { operation: "selectTask", memberId: "hero", taskKey: "hunt" };

	for (const target of [null, notFlagged, notNpc]) {
		await assert.rejects(
			() => PartySheetSD.applyPartyTravelMutation(target, request, gm),
			/Invalid Party actor/,
		);
	}
});

test("a mutation with no requesting user is refused", async () => {
	await assert.rejects(
		() => PartySheetSD.applyPartyTravelMutation(travelParty(), { operation: "selectTask" }, null),
		/Unknown requesting user/,
	);
});

test("a mutation naming a non-member is refused before any authorization", async () => {
	await assert.rejects(
		() => PartySheetSD.applyPartyTravelMutation(
			travelParty({ members: ["hero"] }),
			{ operation: "selectTask", memberId: "stranger", taskKey: "hunt" },
			gm,
		),
		/not a member of this Party/,
	);
});

test("a player cannot move a member they do not own", async () => {
	const party = travelParty({ members: ["hero"] });
	globalThis.game.actors = new Map([["hero", makeActor({ id: "hero", owners: ["someone-else"] })]]);

	await assert.rejects(
		() => PartySheetSD.applyPartyTravelMutation(
			party,
			{ operation: "selectTask", memberId: "hero", taskKey: "hunt" },
			player,
		),
		/Not authorized to change that Party member/,
	);
	assert.deepEqual(party.updates, [], "nothing was written");
});

test("a player may move a member they own", async () => {
	const party = travelParty({ members: ["hero"] });
	globalThis.game.actors = new Map([["hero", makeActor({ id: "hero", owners: ["p1"] })]]);

	const result = await PartySheetSD.applyPartyTravelMutation(
		party,
		{ operation: "selectTask", memberId: "hero", taskKey: "hunt" },
		player,
	);

	assert.deepEqual(result, { ok: true });
	assert.equal(party.updates.length, 1);
});

// A compendium member key contains dots, which Foundry would read as a nested
// property path. The selections object is replaced wholesale instead.
test("a compendium member's selections are replaced, not written by dot path", async () => {
	const uuid = "Compendium.pack.Actor.hero";
	const party = travelParty({ members: [uuid] });
	const setFlags = [];
	party.setFlag = async (scope, key, value) => setFlags.push([key, value]);

	const result = await PartySheetSD.applyPartyTravelMutation(
		party,
		{ operation: "selectTask", memberId: uuid, taskKey: "hunt" },
		gm,
	);

	assert.deepEqual(result, { ok: true });
	assert.equal(setFlags.length, 1);
	assert.equal(setFlags[0][0], "travelSelections");
	const [written] = party.updates;
	assert.ok(
		written[`flags.${MODULE_ID}.travelSelections`] instanceof foundry.data.operators.ForcedDeletion,
		"the old selections object is deleted before being rewritten",
	);
});

test("selecting a task clears the member's prior task selections", async () => {
	const party = travelParty({
		members: ["hero"],
		selections: { forage: { hero: 0 }, hunt: {} },
	});

	await PartySheetSD.applyPartyTravelMutation(
		party,
		{ operation: "selectTask", memberId: "hero", taskKey: "hunt" },
		gm,
	);

	const [written] = party.updates;
	assert.ok(
		written[`flags.${MODULE_ID}.travelSelections.forage.hero`]
			instanceof foundry.data.operators.ForcedDeletion,
		"the stale forage selection is deleted",
	);
	assert.equal(written[`flags.${MODULE_ID}.travelSelections.hunt.hero`], 0);
});

test("clearing a task deletes every selection and sets none", async () => {
	const party = travelParty({ members: ["hero"], selections: { hunt: { hero: 0 } } });

	await PartySheetSD.applyPartyTravelMutation(
		party,
		{ operation: "selectTask", memberId: "hero", taskKey: null },
		gm,
	);

	const [written] = party.updates;
	const keys = Object.keys(written).filter(k => k.includes("travelSelections"));
	assert.deepEqual(keys, [`flags.${MODULE_ID}.travelSelections.hunt.hero`]);
	assert.ok(written[keys[0]] instanceof foundry.data.operators.ForcedDeletion);
});

// --- delegation to the base sheet -------------------------------------------
//
// These three methods override ActorSheet's drag/drop entry points and end in
// a fallback to the base implementation. Inside the class body that was
// `super._onDrop(event)`. As object-literal methods merged onto the prototype
// it could not stay: `super` in an object literal resolves against that
// literal's prototype, which is Object.prototype, so every fallback threw
// TypeError — invisible to a byte-identical move, and to any test that only
// exercised the paths which return early.

/** A sheet whose base-class methods record that they were reached. */
let dragPayload = { type: "Item", uuid: "Item.x" };

function makeDelegatingSheet() {
	const reached = [];
	const base = {
		_onDragStart(event) {
			reached.push(["_onDragStart", event]);
			return "base drag";
		},
		_onDrop(event) {
			reached.push(["_onDrop", event]);
			return "base drop";
		},
		_onDropItem(event, data) {
			reached.push(["_onDropItem", event, data]);
			return "base drop item";
		},
	};
	const saved = { appv1: globalThis.foundry.appv1 };
	globalThis.foundry.appv1 = { sheets: { ActorSheet: { prototype: base } } };
	// foundry.applications is a vivifying proxy, so assigning the whole branch
	// is shadowed by its overrides; set the leaf directly instead.
	globalThis.foundry.applications.ux.TextEditor.implementation.getDragEventData =
		() => dragPayload;
	const sheet = makeSheet(makeActor({ id: "party", flags: {} }));
	return {
		sheet,
		reached,
		restore: () => {
			globalThis.foundry.appv1 = saved.appv1;
			delete globalThis.foundry.applications.ux.TextEditor.implementation.getDragEventData;
		},
	};
}

test("an item drag with no member row behind it falls back to the base sheet", () => {
	const { sheet, reached, restore } = makeDelegatingSheet();
	try {
		const event = {
			currentTarget: { classList: { contains: () => false }, closest: () => null },
			dataTransfer: { setData() {} },
		};

		assert.equal(sheet._onDragStart(event), "base drag");
		assert.deepEqual(reached.map(r => r[0]), ["_onDragStart"]);
	}
	finally {
		restore();
	}
});

test("a drop that is not an Actor falls back to the base sheet", async () => {
	const { sheet, reached, restore } = makeDelegatingSheet();
	try {
		dragPayload = { type: "Item", uuid: "Item.x" };
		const event = { preventDefault() {}, target: { closest: () => null } };

		assert.equal(await sheet._onDrop(event), "base drop");
		assert.deepEqual(reached.map(r => r[0]), ["_onDrop"]);
	}
	finally {
		restore();
	}
});

test("an item dropped outside a member row falls back to the base sheet", async () => {
	const { sheet, reached, restore } = makeDelegatingSheet();
	try {
		uuidTable = new Map([["Item.x", { name: "Rope", parent: null }]]);
		const event = { target: { closest: () => null } };
		const data = { type: "Item", uuid: "Item.x" };

		assert.equal(await sheet._onDropItem(event, data), "base drop item");
		assert.deepEqual(reached.map(r => r[0]), ["_onDropItem"]);
		assert.deepEqual(reached[0][2], data, "the payload is forwarded, not dropped");
	}
	finally {
		restore();
	}
});
