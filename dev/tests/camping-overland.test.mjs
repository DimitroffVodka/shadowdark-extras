import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

installCanvasGlobals();
installAppGlobals({ dom: makeSelectorDom() });
foundry.applications.api.DialogV2.confirm = async () => false;
const camping = await import("../../scripts/party/CampingRestSD.mjs");
const { CampingRestApp } = camping;
const { SDXRollerApp } = await import("../../scripts/tray/SDXRollerApp.mjs");
const empty = { completed: false, fed: {}, mountsFed: 0 };

function actor(id, quantity = 0) {
	const items = quantity ? [{ id: `${id}-ration`, name: "Rations", system: { quantity } }] : [];
	items.get = key => items.find(item => item.id === key);
	return {
		id, uuid: `Actor.${id}`, type: "Player", name: id, items,
		system: { attributes: { hp: { value: 1, max: 5 } } },
		getFlag: () => undefined, setFlag: async () => {}, update: async () => {},
		updateEmbeddedDocuments: async (_type, updates) => {
			for (const update of updates) items.get(update._id).system.quantity = update["system.quantity"];
		},
		deleteEmbeddedDocuments: async (_type, ids) => {
			for (const id of ids) items.splice(items.findIndex(item => item.id === id), 1);
		},
	};
}
function setup() {
	const warnings = [];
	game.user = { isGM: true };
	game.settings = { get: () => undefined };
	game.i18n = { localize: key => key, format: key => key };
	game.modules = new Map([["shadowdark-enhancer", { active: true }]]);
	game.shadowdarkEnhancer = {};
	game.actors = new Map();
	game.time = { advance: async () => assert.fail("clock must not move") };
	ui.notifications = { warn: message => warnings.push(message), info() {}, error() {} };
	return warnings;
}

test("two-ration camping leaves an incomplete meal untouched; legacy still eats one", () => {
	setup();
	const party = actor("party");
	const pc = actor("pc", 1);
	const campers = [{ actor: pc }];
	const app = new CampingRestApp(party, [pc], { rationsEach: 2 });
	assert.equal(app._buildRationPlan(campers).rationByActor.get(pc.id), false);
	assert.deepEqual(app._buildRationPlan(campers).entries, []);
	assert.equal(new CampingRestApp(party, [pc])._buildRationPlan(campers).rationByActor.get(pc.id), true);
});

test("mounts eat complete meals after campers, party stash before member leftovers", () => {
	setup();
	const party = actor("party", 3);
	const pc = actor("pc", 4);
	const app = new CampingRestApp(party, [pc], { rationsEach: 2, mounts: 3 });
	const plan = app._buildRationPlan([{ actor: pc }]);
	assert.equal(plan.rationByActor.get(pc.id), true);
	assert.equal(plan.mountsFed, 2);
	assert.deepEqual(plan.entries.map(e => [e.ownerId, e.amount]), [["pc", 3], ["party", 3]]);
});

test("API opens the existing app and resolves on close; player is warned without opening", async t => {
	const warnings = setup();
	const party = actor("party");
	const pc = actor("pc");
	let app;
	t.mock.method(CampingRestApp.prototype, "render", function() { app = this; return this; });
	assert.equal(typeof camping.openCampingRest, "function");
	const pending = camping.openCampingRest({ party, members: [pc], pushed: true, harsh: true, stormy: true, advanceTime: false });
	const context = await app._prepareContext();
	assert.equal(context.members[0].pushed, true);
	assert.equal(context.huntBlocked, true);
	assert.equal(context.advanceTime, false);
	assert.equal(context.advanceTimeLocked, true);
	await app.close();
	assert.deepEqual(await pending, empty);
	game.user.isGM = false;
	app = null;
	assert.deepEqual(await camping.openCampingRest({ party, members: [pc] }), empty);
	assert.equal(app, null);
	assert.equal(warnings.length, 1);
});

test("declined confirmation settles API and cannot be resumed in the orphan window", async t => {
	setup();
	let app;
	t.mock.method(CampingRestApp.prototype, "render", function() { app = this; return this; });
	t.mock.method(foundry.applications.api.DialogV2, "confirm", async () => false);
	const pending = camping.openCampingRest({ party: actor("party"), members: [actor("pc")] });
	await app._confirmAndRun({ campers: [], campfireMode: "none" });
	assert.deepEqual(await pending, empty);
	assert.equal(app._closed, true);
});

test("completion waits for summary, applies starvation only for API camps and locks clock", async t => {
	setup();
	const party = actor("party");
	const pc = actor("pc", 1);
	const damage = [];
	game.shadowdarkEnhancer.statDamage = { apply: async (...args) => { damage.push(args); } };
	let app;
	t.mock.method(CampingRestApp.prototype, "render", function() { app = this; return this; });
	t.mock.method(foundry.applications.api.DialogV2, "confirm", async () => true);
	const pending = camping.openCampingRest({ party, members: [pc], rationsEach: 2, advanceTime: false });
	let release;
	const summaryGate = new Promise(resolve => { release = resolve; });
	let posted = false;
	app._postSummary = async () => { await summaryGate; posted = true; };
	let resolved = false;
	pending.then(() => { resolved = true; });
	const plan = { campers: [{ actor: pc, taskKey: "" }], campfireMode: "none", advanceTime: true };
	const running = app._confirmAndRun(plan);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(resolved, false);
	release();
	await running;
	assert.equal(posted, true);
	assert.deepEqual(await pending, { completed: true, fed: { pc: false }, mountsFed: 0 });
	assert.deepEqual(damage, [[pc, "con", 1]]);
	assert.equal(pc.items[0].system.quantity, 1);
	const legacy = new CampingRestApp(party, [actor("hungry")]);
	legacy._postSummary = async () => {};
	await legacy._runProcedure({ ...plan, campers: [{ actor: legacy.members[0], taskKey: "" }], advanceTime: false });
	assert.equal(damage.length, 1);
});

test("closing while confirmation is pending never runs the procedure", async t => {
	setup();
	let app;
	let confirm;
	t.mock.method(CampingRestApp.prototype, "render", function() { app = this; return this; });
	t.mock.method(foundry.applications.api.DialogV2, "confirm", () => new Promise(resolve => { confirm = resolve; }));
	const pending = camping.openCampingRest({ party: actor("party"), members: [actor("pc")] });
	app._runProcedure = async () => assert.fail("closed camp must not run");
	const running = app._confirmAndRun({ campers: [], campfireMode: "none" });
	await app.close();
	confirm(true);
	await running;
	assert.deepEqual(await pending, empty);
});

test("harsh Hunt uses DC 18 but leaves other tasks and legacy DCs alone", async t => {
	setup();
	const party = actor("party");
	party.getFlag = (_scope, key) => key === "travelDCs" ? { hunt: 9, cook: 15 } : undefined;
	const pc = actor("pc");
	t.mock.method(SDXRollerApp, "dispatchGroupRoll", async () => ({ results: {} }));
	const campers = [{ actor: pc, abilityIndex: 0 }];
	const hunt = { key: "hunt", name: "Hunt", abilities: ["WIS"] };
	const app = new CampingRestApp(party, [pc], { harsh: true });
	assert.equal((await app._rollTaskGroup(hunt, campers, true)).dc, 18);
	assert.equal((await app._rollTaskGroup({ ...hunt, key: "cook" }, campers, true)).dc, 15);
	assert.equal((await new CampingRestApp(party, [pc])._rollTaskGroup(hunt, campers, true)).dc, 9);
});

test("harsh storms and pushed campers never dispatch Hunt, and summary explains the block", async () => {
	setup();
	for (const options of [{ harsh: true, stormy: true }, { pushed: true }]) {
		const pc = actor("pc");
		const app = new CampingRestApp(actor("party"), [pc], options);
		app._rollTaskGroup = async () => assert.fail("blocked hunt must not roll");
		let result;
		app._postSummary = async data => { result = data; };
		await app._runProcedure({ campers: [{ actor: pc, taskKey: "hunt", pushed: options.pushed }], campfireMode: "none" });
		assert.equal(result.summary[0].hasTaskResult, false);
		assert.ok(result.summary[0].benefits.some(text => text.includes("hunt_blocked")));
	}
});

test("starvation respects absent, older and disabled Enhancer; a throw does not report completion", async t => {
	setup();
	t.mock.method(console, "error", () => {});
	for (const provider of [undefined, {}, { statDamage: {} }, { statDamage: { apply: async () => { throw Error("refused"); } } }]) {
		game.shadowdarkEnhancer = provider;
		const pc = actor("pc");
		const app = new CampingRestApp(actor("party"), [pc], { onComplete() {} });
		app._postSummary = async () => {};
		const reply = await app._runProcedure({ campers: [{ actor: pc, taskKey: "" }], campfireMode: "none" });
		assert.equal(reply?.completed, provider?.statDamage?.apply ? undefined : true);
	}
	game.modules.get("shadowdark-enhancer").active = false;
	game.shadowdarkEnhancer = { statDamage: { apply: async () => assert.fail("disabled") } };
	const pc = actor("pc");
	const app = new CampingRestApp(actor("party"), [pc], { onComplete() {} });
	app._postSummary = async () => {};
	assert.equal((await app._runProcedure({ campers: [{ actor: pc, taskKey: "" }], campfireMode: "none" })).completed, true);
});
