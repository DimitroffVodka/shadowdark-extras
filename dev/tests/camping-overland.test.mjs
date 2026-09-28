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

test("render rejection settles the camping API instead of leaving a pending handoff", async t => {
	setup();
	t.mock.method(console, "error", () => {});
	const failure = Promise.reject(Error("render boom"));
	failure.catch(() => {});
	t.mock.method(CampingRestApp.prototype, "render", () => failure);
	const pending = camping.openCampingRest({ party: actor("party"), members: [actor("pc")] });
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(await Promise.race([pending, Promise.resolve("pending")]), empty);
});

test("confirmation rejection settles and closes the API window", async t => {
	setup();
	t.mock.method(console, "error", () => {});
	let app;
	t.mock.method(CampingRestApp.prototype, "render", function() { app = this; return this; });
	t.mock.method(foundry.applications.api.DialogV2, "confirm", async () => { throw Error("dialog boom"); });
	const pending = camping.openCampingRest({ party: actor("party"), members: [actor("pc")] });
	await app._confirmAndRun({ campers: [], campfireMode: "none" });
	assert.deepEqual(await Promise.race([pending, Promise.resolve("pending")]), empty);
	assert.equal(app._closed, true);
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

test("provider failure after food and recovery is terminal, not a replayable cancellation", async t => {
	setup();
	t.mock.method(console, "error", () => {});
	const fed = actor("fed", 1);
	const hungry = actor("hungry");
	let recoveries = 0;
	fed.update = async () => { recoveries++; };
	const cards = [];
	globalThis.ChatMessage = { getSpeaker: () => ({}), create: async data => cards.push(data) };
	game.shadowdarkEnhancer.statDamage = { apply: async () => { throw Error("provider failed"); } };
	const app = new CampingRestApp(actor("party"), [fed, hungry], { onComplete() {} });
	const reply = await app._runProcedure({ campers: [{ actor: fed }, { actor: hungry }], campfireMode: "none" });
	assert.equal(fed.items.length, 0);
	assert.equal(recoveries, 1);
	assert.equal(reply?.completed, true, "Enhancer must not replay a partially applied camp");
	assert.equal(reply.partial, true);
	assert.deepEqual(reply.fed, { fed: true, hungry: false });
	assert.equal(cards.length, 1, "leave a persistent manual-recovery warning");
});

for (const failure of ["notification", "chat", "both"]) {
	test(`partial camping stays terminal when ${failure} reporting fails`, async t => {
		setup();
		t.mock.method(console, "error", () => {});
		const fed = actor("fed", 1);
		const hungry = actor("hungry");
		let recoveries = 0;
		let notifications = 0;
		const cards = [];
		fed.update = async () => { recoveries++; };
		ui.notifications.error = () => {
			notifications++;
			if (failure !== "chat") throw Error("notification failed");
		};
		globalThis.ChatMessage = { getSpeaker: () => ({}), create: async data => {
			if (failure !== "notification") throw Error("chat failed");
			cards.push(data);
		} };
		game.shadowdarkEnhancer.statDamage = { apply: async () => { throw Error("provider failed"); } };
		let app;
		t.mock.method(CampingRestApp.prototype, "render", function() { app = this; return this; });
		t.mock.method(foundry.applications.api.DialogV2, "confirm", async () => true);
		const pending = camping.openCampingRest({ party: actor("party"), members: [fed, hungry], advanceTime: false });
		await app._confirmAndRun({ campers: [{ actor: fed }, { actor: hungry }], campfireMode: "none" });
		assert.deepEqual(await pending, {
			completed: true, partial: true, error: "provider failed",
			fed: { fed: true, hungry: false }, mountsFed: 0,
		});
		assert.equal(fed.items.length, 0);
		assert.equal(recoveries, 1);
		assert.equal(notifications, 1);
		assert.equal(cards.length, failure === "notification" ? 1 : 0);
	});
}

test("cleanup reporting failure cannot replace a successful camping API result", async t => {
	setup();
	t.mock.method(console, "error", () => {});
	ui.notifications.error = () => { throw Error("notification failed"); };
	const pc = actor("pc", 1);
	let app;
	t.mock.method(CampingRestApp.prototype, "render", function() { app = this; return this; });
	t.mock.method(foundry.applications.api.DialogV2, "confirm", async () => true);
	const pending = camping.openCampingRest({ party: actor("party"), members: [pc], advanceTime: false });
	app._postSummary = async () => {};
	app.onCampfireChange = async () => { throw Error("cleanup failed"); };
	await app._confirmAndRun({ campers: [{ actor: pc }], campfireMode: "none" });
	assert.deepEqual(await pending, { completed: true, fed: { pc: true }, mountsFed: 0 });
	assert.equal(pc.items.length, 0);
});

test("a missing or changed planned ration cancels before any food or recovery writes", async t => {
	setup();
	t.mock.method(console, "error", () => {});
	for (const change of [pc => pc.items.splice(0), pc => { pc.items[0].system.quantity = 1; }]) {
		const pc = actor("pc", 2);
		let writes = 0;
		pc.update = pc.updateEmbeddedDocuments = pc.deleteEmbeddedDocuments = async () => { writes++; };
		const app = new CampingRestApp(actor("party"), [pc], { rationsEach: 2, onComplete() {} });
		const build = app._buildRationPlan.bind(app);
		app._buildRationPlan = campers => { const plan = build(campers); change(pc); return plan; };
		app._postSummary = async () => assert.fail("must not grant rest from stale food");
		const reply = await app._runProcedure({ campers: [{ actor: pc }], campfireMode: "none" });
		assert.notEqual(reply?.completed, true);
		assert.equal(writes, 0);
	}
});

test("unconfirmed inventory writes never grant rest or report a camper fed", async t => {
	setup();
	t.mock.method(console, "error", () => {});
	globalThis.ChatMessage = { getSpeaker: () => ({}), create: async () => {} };
	const pc = actor("pc", 2);
	pc.updateEmbeddedDocuments = async () => [];
	pc.update = async () => assert.fail("no recovery without verified food consumption");
	const app = new CampingRestApp(actor("party"), [pc], { onComplete() {} });
	app._postSummary = async () => assert.fail("no successful summary");
	const reply = await app._runProcedure({ campers: [{ actor: pc }], campfireMode: "none" });
	assert.equal(reply?.partial, true);
	assert.equal(reply.completed, true, "uncertain writes must not be automatically replayed");
	assert.deepEqual(reply.fed, {});
	assert.equal(pc.items[0].system.quantity, 2);
});

test("cleanup rejection does not turn an applied rest into a replayable cancellation", async t => {
	setup();
	t.mock.method(console, "error", () => {});
	const pc = actor("pc", 1);
	const app = new CampingRestApp(actor("party"), [pc], {
		onComplete() {}, onCampfireChange: async () => { throw Error("cleanup boom"); },
	});
	app._postSummary = async () => {};
	const reply = await app._runProcedure({ campers: [{ actor: pc }], campfireMode: "none" });
	assert.equal(reply.completed, true);
	assert.equal(reply.fed.pc, true);
});

test("starvation respects absent, older and disabled Enhancer", async t => {
	setup();
	t.mock.method(console, "error", () => {});
	for (const provider of [undefined, {}, { statDamage: {} }]) {
		game.shadowdarkEnhancer = provider;
		const pc = actor("pc");
		const app = new CampingRestApp(actor("party"), [pc], { onComplete() {} });
		app._postSummary = async () => {};
		const reply = await app._runProcedure({ campers: [{ actor: pc, taskKey: "" }], campfireMode: "none" });
		assert.equal(reply?.completed, true);
	}
	game.modules.get("shadowdark-enhancer").active = false;
	game.shadowdarkEnhancer = { statDamage: { apply: async () => assert.fail("disabled") } };
	const pc = actor("pc");
	const app = new CampingRestApp(actor("party"), [pc], { onComplete() {} });
	app._postSummary = async () => {};
	assert.equal((await app._runProcedure({ campers: [{ actor: pc, taskKey: "" }], campfireMode: "none" })).completed, true);
});

function flagged(id) {
	const party = actor(id);
	const flags = {};
	party.getFlag = (_scope, key) => flags[key];
	party.setFlag = async (_scope, key, value) => { flags[key] = structuredClone(value); };
	party.unsetFlag = async (_scope, key) => { delete flags[key]; };
	return { party, flags };
}

test("a deferred camp rolls the tasks and eats, then stores the rest for the dawn (#186)", async () => {
	setup();
	const { party, flags } = flagged("party");
	const pc = actor("pc", 1);
	game.actors = new Map([["pc", pc]]);
	const app = new CampingRestApp(party, [pc], { deferRest: true, onComplete: () => {} });
	app._rollTaskGroup = async () => ({ dc: 12, result: { results: { "Actor.pc": 15 } } });
	app._rollInterruptionChecks = async () => assert.fail("no CON checks at camp");
	app._postSummary = async () => assert.fail("no summary at camp");
	const reply = await app._runProcedure({ campers: [{ actor: pc, taskKey: "battenDown" }], campfireMode: "none", torchPlan: { complete: false } });
	assert.deepEqual(reply, { completed: true, pending: true, fed: { pc: true }, mountsFed: 0 });
	assert.equal(pc.items.length, 0, "its one ration eaten at camp");
	const [stored] = flags.campingPendingRest.campers;
	assert.deepEqual([stored.actorId, stored.result, stored.ate], ["pc", { taskKey: "battenDown", value: 15, success: true }, true]);
});

test("the dawn rolls CON only for who ate and failed Bed Down when interrupted, then rests (#186)", async () => {
	setup();
	const { party, flags } = flagged("party");
	const [a, b, c] = [actor("a"), actor("b"), actor("c")];
	game.actors = new Map([["a", a], ["b", b], ["c", c]]);
	const camper = (actorId, result, ate) => ({ actorId, taskKey: result?.taskKey ?? "", result, ate, benefits: null });
	flags.campingPendingRest = { campfireEstablished: false, campfireMode: "none", harsh: false, huntBlocked: false, campers: [
		camper("a", { taskKey: "battenDown", value: 15, success: true }, true),
		camper("b", null, true),
		camper("c", null, false),
	] };
	let rolled = null;
	let posted = null;
	const original = CampingRestApp.prototype._rollInterruptionChecks;
	const originalPost = CampingRestApp.prototype._postSummary;
	CampingRestApp.prototype._rollInterruptionChecks = async function(campers) {
		rolled = campers.map(entry => entry.actor.id);
		return { results: { "Actor.b": 14, "Actor.c": 3 } };
	};
	CampingRestApp.prototype._postSummary = async data => { posted = data; };
	try {
		const reply = await camping.finishCampingRest({ party, interrupted: true });
		assert.deepEqual(rolled, ["b"], "Bed Down's success skips the check, and c, who didn't eat, has no rest to keep");
		assert.deepEqual(reply, { completed: true, rested: { a: true, b: true, c: false } }, "c didn't eat: no rest");
		assert.equal(posted.interrupted, true);
		assert.equal(flags.campingPendingRest, undefined, "cleared");
		assert.deepEqual(await camping.finishCampingRest({ party }), { completed: false, nothingPending: true }, "nothing left pending");
	}
	finally {
		CampingRestApp.prototype._rollInterruptionChecks = original;
		CampingRestApp.prototype._postSummary = originalPost;
	}
});

function pendingRest(flags, campers) {
	flags.campingPendingRest = { campfireEstablished: false, campfireMode: "none", harsh: false, huntBlocked: false, campers:
		campers.map(([actorId, ate]) => ({ actorId, taskKey: "", result: null, ate, benefits: null })) };
}

test("two dawns at once for one party roll the CON checks and grant the rest once (#186)", async () => {
	setup();
	const { party, flags } = flagged("party");
	const a = actor("a");
	game.actors = new Map([["a", a]]);
	pendingRest(flags, [["a", true]]);
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	let dispatched = 0;
	let posted = 0;
	const original = CampingRestApp.prototype._rollInterruptionChecks;
	const originalPost = CampingRestApp.prototype._postSummary;
	CampingRestApp.prototype._rollInterruptionChecks = async function() { dispatched++; await gate; return { results: { "Actor.a": 15 } }; };
	CampingRestApp.prototype._postSummary = async () => { posted++; };
	try {
		const first = camping.finishCampingRest({ party, interrupted: true });
		const second = camping.finishCampingRest({ party, interrupted: true });
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(flags.campingPendingRest, undefined, "claimed before the roll");
		release();
		const replies = await Promise.all([first, second]);
		assert.deepEqual(replies[0], { completed: true, rested: { a: true } });
		assert.deepEqual(replies[1], replies[0], "the second call shares the first dawn");
		assert.deepEqual([dispatched, posted], [1, 1]);
	}
	finally {
		CampingRestApp.prototype._rollInterruptionChecks = original;
		CampingRestApp.prototype._postSummary = originalPost;
	}
});

test("canceled dawn checks put the rest back; a failure while applying it is final and reported (#186)", async () => {
	setup();
	const { party, flags } = flagged("party");
	const [a, b] = [actor("a"), actor("b")];
	game.actors = new Map([["a", a], ["b", b]]);
	pendingRest(flags, [["a", true], ["b", true]]);
	const original = CampingRestApp.prototype._rollInterruptionChecks;
	const originalPost = CampingRestApp.prototype._postSummary;
	const errors = [];
	const chat = [];
	ui.notifications.error = message => errors.push(message);
	globalThis.ChatMessage = { create: async data => { chat.push(data.content); }, getSpeaker: () => ({}) };
	try {
		CampingRestApp.prototype._rollInterruptionChecks = async () => ({ canceled: true });
		assert.deepEqual(await camping.finishCampingRest({ party, interrupted: true }), { completed: false });
		assert.equal(flags.campingPendingRest.campers.length, 2, "put back for another try");

		CampingRestApp.prototype._rollInterruptionChecks = async () => ({ results: { "Actor.a": 15, "Actor.b": 15 } });
		CampingRestApp.prototype._postSummary = async () => assert.fail("no summary after a failure");
		b.update = async () => { throw new Error("write failed"); };
		const reply = await camping.finishCampingRest({ party, interrupted: true });
		assert.deepEqual(reply, { completed: true, partial: true, error: "write failed", rested: {} }, "final: Overland moves on");
		assert.equal(flags.campingPendingRest, undefined, "never replayed");
		assert.equal(errors.length, 1);
		assert.equal(chat.length, 1);
		assert.deepEqual(await camping.finishCampingRest({ party, interrupted: true }), { completed: false, nothingPending: true });
	}
	finally {
		CampingRestApp.prototype._rollInterruptionChecks = original;
		CampingRestApp.prototype._postSummary = originalPost;
	}
});

test("the torch question gives the party's unlit torches (#186)", async t => {
	setup();
	const torch = (id, quantity, active = false) => ({ id, name: "Torch", system: { quantity, light: { active } } });
	const party = actor("party");
	party.items.push(torch("t1", 2));
	const pc = actor("pc");
	pc.items.push(torch("t2", 3), torch("t3", 1, true));
	let data;
	game.i18n.format = (key, values) => { if (key.endsWith("torches_question")) data = values; return key; };
	t.mock.method(foundry.applications.api.DialogV2, "confirm", async () => true);
	const app = new CampingRestApp(party, [pc], { deferRest: true, onComplete: () => {} });
	const groups = [{ task: { key: "cook", name: "Cook", campfire: true }, campers: [{ actor: pc }] }];
	assert.equal(await app._askTorches({ campers: [{ actor: pc }], torchPlan: { complete: true } }, groups), true);
	assert.deepEqual([data.count, data.total, data.tasks], [3, 5, "pc (Cook)"], "the lit torch doesn't count");
});

test("a CON check that throws puts the rest back, and a retry finishes it (#187 review)", async () => {
	setup();
	const { party, flags } = flagged("party");
	const a = actor("a");
	game.actors = new Map([["a", a]]);
	pendingRest(flags, [["a", true]]);
	const original = CampingRestApp.prototype._rollInterruptionChecks;
	const originalPost = CampingRestApp.prototype._postSummary;
	CampingRestApp.prototype._postSummary = async () => {};
	try {
		CampingRestApp.prototype._rollInterruptionChecks = async () => { throw new Error("roll service failed"); };
		assert.deepEqual(await camping.finishCampingRest({ party, interrupted: true }), { completed: false, error: "roll service failed" });
		assert.equal(flags.campingPendingRest.campers.length, 1, "put back, not lost");
		CampingRestApp.prototype._rollInterruptionChecks = async () => ({ results: { "Actor.a": 15 } });
		assert.deepEqual(await camping.finishCampingRest({ party, interrupted: true }), { completed: true, rested: { a: true } });
	}
	finally {
		CampingRestApp.prototype._rollInterruptionChecks = original;
		CampingRestApp.prototype._postSummary = originalPost;
	}
});

test("only the active GM finishes a rest; another GM's call leaves it pending (#187 review)", async () => {
	const warnings = setup();
	const { party, flags } = flagged("party");
	pendingRest(flags, [["a", true]]);
	game.user = { id: "gm2", isGM: true };
	game.users = { activeGM: { id: "gm1" } };
	assert.deepEqual(await camping.finishCampingRest({ party, interrupted: true }), { completed: false, notActiveGM: true });
	assert.equal(flags.campingPendingRest.campers.length, 1);
	assert.deepEqual(warnings, ["SHADOWDARK_EXTRAS.camping_rest.dawn_active_gm"]);
});
