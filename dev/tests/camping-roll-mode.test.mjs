import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

import { DEFAULT_TRAVEL_ACTIVITIES } from "../../scripts/party/CampingRulesData.mjs";
import { campingTaskDc, describeCampingTask } from "../../scripts/party/CampingRestData.mjs";
import { buildSdxCheck, buildSdxRecapDice } from "../../scripts/tray/SDXRollerData.mjs";

installCanvasGlobals();
installAppGlobals({ dom: makeSelectorDom() });
const { CampingRestApp } = await import("../../scripts/party/CampingRestSD.mjs");
const { SDXRollerApp } = await import("../../scripts/tray/SDXRollerApp.mjs");
const { rollGroupInstant } = await import("../../scripts/tray/SDXRollerInstant.mjs");

const task = key => DEFAULT_TRAVEL_ACTIVITIES.find(entry => entry.key === key);
const NOTE = "no fire";

/* ---------- the description and DC line (#197 A) ---------- */

test("Bed Down (WIS) reads its own description and WIS · DC 12; the Ability select changes the line", () => {
	const bedDown = task("battenDown");
	const wis = describeCampingTask({ task: bedDown, abilityIndex: 0, dc: 12, campfire: true });
	assert.equal(wis.description, bedDown.description);
	assert.equal(wis.line, "WIS · DC 12");
	assert.equal(describeCampingTask({ task: bedDown, abilityIndex: "1", dc: 12, campfire: true }).line, "CON · DC 12");
});

test("an edited description shows as edited, and DC 18 is Hunt on a harsh day only", () => {
	const edited = { ...task("cook"), description: "Success: Everyone eats well." };
	assert.equal(describeCampingTask({ task: edited, campfire: true }).description, "Success: Everyone eats well.");
	assert.equal(campingTaskDc(task("hunt"), {}, true), 18);
	assert.equal(campingTaskDc(task("hunt"), { hunt: 9 }, false), 9);
	assert.equal(campingTaskDc(task("cook"), { cook: 15 }, true), 15);
	assert.equal(campingTaskDc(task("cook"), undefined, false), 12);
	assert.equal(describeCampingTask({ task: task("hunt"), abilityIndex: 0, dc: 18 }).line, "STR · DC 18");
});

test("a campfire task with no fire carries the disadvantage note; a lit fire or a plain task does not", () => {
	const cook = task("cook");
	const cold = describeCampingTask({ task: cook, dc: 12, campfire: false, disadvantageNote: NOTE });
	assert.deepEqual([cold.disadvantage, cold.line], [true, `INT · DC 12 · ${NOTE}`]);
	const lit = describeCampingTask({ task: cook, dc: 12, campfire: true, disadvantageNote: NOTE });
	assert.deepEqual([lit.disadvantage, lit.line], [false, "INT · DC 12"]);
	const firewood = describeCampingTask({ task: task("firewood"), dc: 12, campfire: false, disadvantageNote: NOTE });
	assert.deepEqual([firewood.disadvantage, firewood.line], [false, "STR · DC 12"]);
});

/** A camper's row in the camp window: just what _refreshTaskInfo reads and writes. */
function row(taskKey, ability = "0") {
	const info = { hidden: null, description: { textContent: "" }, line: { textContent: "" } };
	const node = {
		info,
		taskKey,
		ability,
		querySelector(selector) {
			if (selector === ".sdx-rest-task-info") {
				return {
					classList: { toggle: (_name, hidden) => { info.hidden = hidden; } },
					querySelector: inner => inner === ".sdx-rest-task-description" ? info.description : info.line,
				};
			}
			if (selector === ".sdx-rest-task-select") return { value: node.taskKey };
			if (selector === ".sdx-rest-ability-select") return { value: node.ability };
			return null;
		},
	};
	return node;
}

async function windowWith(rows, { checked = null, dcs = {}, harsh = false } = {}) {
	game.i18n = { localize: key => key === "SHADOWDARK_EXTRAS.camping_rest.task_disadvantage" ? NOTE : key, format: key => key };
	const party = { id: "party", items: [], getFlag: (_scope, key) => key === "travelDCs" ? dcs : undefined };
	const app = new CampingRestApp(party, [], { harsh });
	await app._prepareContext();
	Object.defineProperty(app, "element", {
		value: {
			querySelector: selector => selector.includes(":checked") && checked ? { value: checked } : null,
			querySelectorAll: () => rows,
		},
	});
	return app;
}

test("the camp window's task line follows the Task select, the Ability select and the campfire choice", async () => {
	const bedDown = row("battenDown");
	const app = await windowWith([bedDown], { checked: "torches" });
	app._refreshTaskInfo(bedDown);
	assert.equal(bedDown.info.hidden, false);
	assert.equal(bedDown.info.description.textContent, task("battenDown").description);
	assert.equal(bedDown.info.line.textContent, "WIS · DC 12");

	bedDown.ability = "1";
	app._refreshTaskInfo(bedDown);
	assert.equal(bedDown.info.line.textContent, "CON · DC 12");

	bedDown.taskKey = "cook";
	bedDown.ability = "0";
	app._refreshTaskInfo();
	assert.equal(bedDown.info.description.textContent, task("cook").description);
	assert.equal(bedDown.info.line.textContent, "INT · DC 12");

	bedDown.taskKey = "";
	app._refreshTaskInfo();
	assert.deepEqual([bedDown.info.hidden, bedDown.info.description.textContent, bedDown.info.line.textContent], [true, "", ""]);
});

test("the task line says DC 18 for Hunt on a harsh day, and no fire is a disadvantage note", async () => {
	const hunter = row("hunt");
	await (await windowWith([hunter], { harsh: true, dcs: { hunt: 9 } }))._refreshTaskInfo(hunter);
	assert.equal(hunter.info.line.textContent, "STR · DC 18");

	const cook = row("cook");
	await (await windowWith([cook], { checked: "none" }))._refreshTaskInfo(cook);
	assert.equal(cook.info.line.textContent, `INT · DC 12 · ${NOTE}`);
	// Deferred camps (no campfire radios) have no fire to start with either.
	await (await windowWith([cook], { checked: null }))._refreshTaskInfo(cook);
	assert.equal(cook.info.line.textContent, `INT · DC 12 · ${NOTE}`);
	await (await windowWith([cook], { checked: "torches" }))._refreshTaskInfo(cook);
	assert.equal(cook.info.line.textContent, "INT · DC 12");
});

/* ---------- the check both rollers build (#197 B: one code path) ---------- */

test("a group check is the ability's modifier with the advantage or disadvantage formula", () => {
	const actor = { system: { abilities: { wis: { mod: 2 }, con: { mod: -1 } } } };
	const data = { ability: "wis", actorAbilities: { a: "con", b: "none" } };
	assert.deepEqual(buildSdxCheck(data, "x", actor), {
		abilityId: "wis", isNone: false, mod: 2, formula: "1d20 + @mod", rollMode: "normal",
	});
	assert.equal(buildSdxCheck(data, "a", actor, "advantage").formula, "2d20kh + @mod");
	assert.deepEqual(
		[buildSdxCheck(data, "a", actor, "disadvantage").formula, buildSdxCheck(data, "a", actor).mod],
		["2d20kl + @mod", -1]
	);
	assert.deepEqual(
		[buildSdxCheck(data, "b", actor, "disadvantage").formula, buildSdxCheck(data, "b", actor).mod],
		["2d20kl", 0]
	);
	assert.deepEqual(buildSdxRecapDice([4, 14], "disadvantage").map(die => die.css), ["sdx-die-dis", "sdx-die-dropped"]);
	assert.deepEqual(buildSdxRecapDice([4, 14], "advantage").map(die => die.css), ["sdx-die-dropped", "sdx-die-adv"]);
	assert.deepEqual(buildSdxRecapDice([9], "normal"), [{ value: 9, css: "" }]);
});

/* ---------- the instant roller (#197 B) ---------- */

/** Stub the dice: each actor's total is fixed, and 2d20 shows a 4 and a 14. */
function stubDice(t, totals, actors) {
	let current = null;
	const rolls = [];
	const messages = [];
	const rendered = [];
	const saved = ["Roll", "fromUuidSync", "ChatMessage"].map(key => [key, globalThis[key]]);
	globalThis.fromUuidSync = uuid => {
		current = actors.find(actor => actor.uuid === uuid) ?? null;
		return current;
	};
	globalThis.Roll = class {
		constructor(formula, data) {
			this.formula = formula;
			this.data = data;
			this.uuid = current?.uuid;
			rolls.push(this);
		}

		async evaluate() {
			this.total = totals[this.uuid];
			this.dice = [{ results: this.formula.startsWith("2d20") ? [{ result: 4 }, { result: 14 }] : [{ result: this.total }] }];
			return this;
		}
	};
	globalThis.ChatMessage = {
		create: async data => { messages.push(data); },
		getWhisperRecipients: () => ["gm"],
	};
	foundry.applications.handlebars = {
		renderTemplate: async (path, data) => { rendered.push({ path, data }); return `card:${data.label}`; },
	};
	t.after(() => { for (const [key, value] of saved) globalThis[key] = value; });
	return { rolls, messages, rendered };
}

const sdxActor = (id, mods = {}) => ({ id, uuid: `Actor.${id}`, name: id, img: `${id}.png`, system: { abilities: mods } });

test("the instant roller rolls every actor in one pass and posts one card carrying every roll", async t => {
	const actors = [sdxActor("a", { wis: { mod: 2 } }), sdxActor("b", { con: { mod: 1 } }), sdxActor("c")];
	const { rolls, messages, rendered } = stubDice(t, { "Actor.a": 15, "Actor.b": 9, "Actor.c": 12 }, actors);
	t.mock.method(SDXRollerApp, "_launchOverlay", () => assert.fail("instant mode opens no overlay"));
	t.mock.method(SDXRollerApp, "dispatchGroupRoll", () => assert.fail("instant mode opens no overlay"));

	const outcome = await rollGroupInstant({
		actors: actors.map(actor => actor.uuid), contestants: [], ability: "wis", dc: 12,
		actorAbilities: { "Actor.a": "wis", "Actor.b": "con", "Actor.c": "none" },
		actorRollModes: { "Actor.b": "disadvantage" },
		customLabel: "Cook", activityDescription: "Success: Everyone eats well.",
	});

	assert.deepEqual(outcome, { results: { "Actor.a": 15, "Actor.b": 9, "Actor.c": 12 }, canceled: false });
	assert.deepEqual(rolls.map(roll => [roll.formula, roll.data.mod]), [["1d20 + @mod", 2], ["2d20kl + @mod", 1], ["1d20", 0]]);
	assert.equal(SDXRollerApp._activeOverlay, null);

	assert.equal(messages.length, 1, "one card for the group");
	assert.deepEqual(messages[0].rolls, rolls);
	assert.equal(messages[0].content, "card:Cook");
	const card = rendered[0].data;
	assert.deepEqual([card.dc, card.activityDescription], [12, "Success: Everyone eats well."]);
	assert.deepEqual(card.actors.map(entry => [entry.name, entry.result, entry.modLabel, entry.abilityShort, entry.pass]), [
		["a", 15, "+2", "WIS", true], ["b", 9, "+1", "CON", false], ["c", 12, "+0", "", true],
	]);
	assert.deepEqual(card.actors[1].diceResults.map(die => die.css), ["sdx-die-dis", "sdx-die-dropped"]);
	assert.deepEqual([card.success, card.successLabel], [true, "SUCCESS"]);
});

test("the instant roller skips an actor it cannot find, as the overlay does, and posts nothing for an empty group", async t => {
	const { messages } = stubDice(t, {}, []);
	assert.deepEqual(await rollGroupInstant({ actors: ["Actor.gone"], contestants: [], ability: "str", dc: 12 }), { results: {}, canceled: false });
	assert.deepEqual(messages, []);
});

/* ---------- the camp uses it by default, and both modes agree (#197 B) ---------- */

const campSettings = {};

function camper(id, rations = 1) {
	const items = rations ? [{ id: `${id}-ration`, name: "Rations", system: { quantity: rations } }] : [];
	items.get = key => items.find(item => item.id === key);
	items.has = key => items.some(item => item.id === key);
	return {
		id, uuid: `Actor.${id}`, type: "Player", name: id, img: `${id}.png`, items,
		system: { attributes: { hp: { value: 1, max: 5 } }, abilities: { wis: { mod: 1 }, int: { mod: 1 }, str: { mod: 1 } } },
		statuses: new Set(),
		getFlag: () => undefined, setFlag: async () => {}, update: async () => {},
		updateEmbeddedDocuments: async (_type, updates) => {
			for (const update of updates) items.get(update._id).system.quantity = update["system.quantity"];
		},
		deleteEmbeddedDocuments: async (_type, ids) => {
			for (const id of ids) items.splice(items.findIndex(item => item.id === id), 1);
		},
	};
}

function camp() {
	game.user = { isGM: true };
	game.settings = { get: (_module, key) => campSettings[key] };
	game.i18n = { localize: key => key, format: key => key };
	game.modules = new Map();
	game.actors = new Map();
	game.time = { advance: async () => assert.fail("clock must not move") };
	ui.notifications = { warn() {}, info() {}, error() {} };
	const party = camper("party", 0);
	party.type = "Party";
	party.createEmbeddedDocuments = async (_type, docs) => docs.map((doc, index) => {
		const created = { id: `fire${index}`, ...doc, getFlag: () => true };
		party.items.push(created);
		return created;
	});
	party.toggleLight = async () => {};
	party.turnLightOff = async () => {};
	return party;
}

/** Firewood, Bed Down and Cook, a Hunt and a keep-watch: four task groups, five campers. */
const CAMPERS = [
	["a", "firewood"], ["b", "battenDown"], ["c", "cook"], ["d", "hunt"], ["e", "keepWatch"],
];
const TOTALS = { "Actor.a": 15, "Actor.b": 14, "Actor.c": 9, "Actor.d": 8, "Actor.e": 17 };

async function runCamp(t, mode) {
	Object.assign(campSettings, { campingRollMode: mode });
	const party = camp();
	const members = CAMPERS.map(([id]) => camper(id));
	const cinematic = [];
	t.mock.method(SDXRollerApp, "dispatchGroupRoll", async rollData => {
		cinematic.push(rollData.customLabel);
		return {
			canceled: false,
			results: Object.fromEntries(rollData.actors.map(uuid => [uuid, TOTALS[uuid]])),
		};
	});
	const instant = stubDice(t, TOTALS, members);
	const app = new CampingRestApp(party, members, { onComplete: () => {} });
	let summary;
	app._postSummary = async data => { summary = data; };
	const reply = await app._runProcedure({
		campers: CAMPERS.map(([id, taskKey], index) => ({ actor: members[index], taskKey, abilityIndex: 0, id })),
		campfireMode: "firewood", torchPlan: { complete: false }, interrupted: false, advanceTime: false,
	});
	return { reply, summary, cinematic, instant, members };
}

test("the default camp rolls every task in one pass with no overlay and one card per task group", async t => {
	campSettings.campingRollMode = undefined;
	const { reply, summary, cinematic, instant } = await runCamp(t, undefined);
	assert.equal(reply.completed, true);
	assert.deepEqual(cinematic, [], "no cinematic overlay was dispatched");
	assert.equal(SDXRollerApp._activeOverlay, null);
	assert.deepEqual(instant.rendered.map(card => card.data.label), ["Firewood", "Bed Down", "Cook", "Hunt", "Keep Watch"]);
	assert.equal(instant.messages.length, 5);
	const line = id => summary.summary.find(row => row.actorId === id).taskLine;
	// The Firewood success lit the fire before the starred tasks, so no disadvantage note.
	assert.deepEqual(["a", "b", "c", "d", "e"].map(line), [
		"STR · DC 12", "WIS · DC 12", "INT · DC 12", "STR · DC 12", "WIS · DC 12",
	]);
	assert.equal(summary.summary.find(row => row.actorId === "c").taskDescription, task("cook").description);
});

test("cinematic mode dispatches the overlays as before, and the outcome matches instant for the same totals", async t => {
	const instant = await runCamp(t, "instant");
	assert.equal(instant.cinematic.length, 0);
	const overlay = await runCamp(t, "cinematic");
	assert.deepEqual(overlay.cinematic, ["Firewood", "Bed Down", "Cook", "Hunt", "Keep Watch"]);
	assert.equal(overlay.instant.messages.length, 0, "no instant card in cinematic mode");
	assert.deepEqual(overlay.reply, instant.reply);
	assert.deepEqual(overlay.summary, instant.summary);
	assert.deepEqual(overlay.members.map(member => member.items.map(item => item.system.quantity)),
		instant.members.map(member => member.items.map(item => item.system.quantity)));
	const cook = instant.summary.summary.find(row => row.actorId === "c");
	assert.deepEqual([cook.taskValue, cook.taskSuccess], [9, false]);
	assert.equal(instant.summary.campfireEstablished, true);
});

test("without a fire, the summary's task line says the starred task was rolled at disadvantage", async t => {
	Object.assign(campSettings, { campingRollMode: "instant" });
	const party = camp();
	const members = [camper("c")];
	stubDice(t, { "Actor.c": 12 }, members);
	const app = new CampingRestApp(party, members, { onComplete: () => {} });
	let summary;
	app._postSummary = async data => { summary = data; };
	await app._runProcedure({
		campers: [{ actor: members[0], taskKey: "cook", abilityIndex: 0 }],
		campfireMode: "none", torchPlan: { complete: false }, interrupted: false, advanceTime: false,
	});
	assert.equal(summary.summary[0].taskLine, "INT · DC 12 · SHADOWDARK_EXTRAS.camping_rest.task_disadvantage_rolled");
});

test("dawn's CON checks are instant too, in the shape the dawn already reads", async t => {
	Object.assign(campSettings, { campingRollMode: "instant" });
	const party = camp();
	const members = [camper("a"), camper("b")];
	const { rolls, messages } = stubDice(t, { "Actor.a": 13, "Actor.b": 6 }, members);
	t.mock.method(SDXRollerApp, "dispatchGroupRoll", () => assert.fail("no overlay"));
	const app = new CampingRestApp(party, members, { onComplete: () => {} });
	const result = await app._rollInterruptionChecks(members.map(actor => ({ actor })));
	assert.deepEqual(result, { results: { "Actor.a": 13, "Actor.b": 6 }, canceled: false });
	assert.equal(rolls.length, 2);
	assert.equal(messages.length, 1);
});
