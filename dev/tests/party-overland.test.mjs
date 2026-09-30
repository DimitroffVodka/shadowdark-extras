import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

installCanvasGlobals();
const { hooks } = installAppGlobals({ dom: makeSelectorDom() });

const warnings = [];
let chatCards = 0;
const labels = new Map([
	["SHADOWDARK_EXTRAS.party.travel.state.weather.stormy", "Stormy"],
	["SHADOWDARK_EXTRAS.party.travel.state.method.walking", "Walking"],
	["SHADOWDARK_EXTRAS.party.travel.state.weather.none", "Not rolled"],
]);

globalThis.game.user = { id: "gm", isGM: true };
globalThis.game.i18n = {
	localize: key => labels.get(key) ?? key,
	format: key => key,
};
globalThis.game.time = { worldTime: 100 };
globalThis.game.actors = new Map();
globalThis.ui.notifications = {
	warn: message => warnings.push(message),
	info() {},
	error() {},
};
globalThis.ChatMessage = {
	create: async () => {
		chatCards++;
	},
	getSpeaker: () => ({}),
};

const { PartyTravel } = await import("../../scripts/party/partytravel.mjs");
const {
	default: PartySheetSD,
	getOverlandTravelState,
	registerPartySheetRerenderHooks,
} = await import("../../scripts/party/PartySheetSD.mjs");

function resetWorld({ tableUuid = "", enhancer = null, active = false } = {}) {
	warnings.length = 0;
	chatCards = 0;
	globalThis.game.modules = new Map([
		["shadowdark-enhancer", { active }],
	]);
	globalThis.game.shadowdarkEnhancer = enhancer ?? {};
	globalThis.game.settings = {
		get: (_scope, key) => key === "partyWeatherTableUuid" ? tableUuid : undefined,
		set: async () => {},
	};
	globalThis.game.time = { worldTime: 100 };
	globalThis.fromUuid = async () => null;
	globalThis.foundry.applications.api.DialogV2.confirm = async () => false;
}

function makeTravelSheet(prediction = undefined) {
	const flags = new Map([
		["campingWeatherReroll", prediction],
	]);
	const sheet = { ...PartyTravel };
	sheet.actor = {
		isOwner: true,
		getFlag: (_scope, key) => flags.get(key),
	};
	return sheet;
}

const event = { preventDefault() {} };

// --- weather delegation -----------------------------------------------------

test("a Party non-owner cannot invoke weather providers or rolls", async () => {
	let providerCalls = 0;
	resetWorld({ active: true, enhancer: { overland: {
		rollWeather: async () => { providerCalls++; return { ok: true, rolled: true }; },
	} } });
	const sheet = makeTravelSheet();
	sheet.actor.isOwner = false;
	let legacyRolls = 0;
	sheet._rollDefaultWeather = async () => { legacyRolls++; };
	await sheet._onRollWeather(event);
	assert.equal(providerCalls, 0);
	assert.equal(legacyRolls, 0);
	assert.equal(chatCards, 0);
});

test("active Enhancer owns weather rolls and Extras posts no duplicate card", async () => {
	resetWorld({
		active: true,
		enhancer: { overland: {
			rollWeather: async () => ({ ok: true, rolled: true, weather: { kind: "fair" } }),
		} },
	});
	const calls = [];
	const rollWeather = globalThis.game.shadowdarkEnhancer.overland.rollWeather;
	globalThis.game.shadowdarkEnhancer.overland.rollWeather = async (...args) => {
		calls.push(args);
		return rollWeather(...args);
	};
	const sheet = makeTravelSheet();
	let legacyRolls = 0;
	sheet._rollDefaultWeather = async () => { legacyRolls++; };

	await sheet._onRollWeather(event);

	assert.deepEqual(calls, [[]]);
	assert.equal(legacyRolls, 0);
	assert.equal(chatCards, 0);
	assert.deepEqual(warnings, []);
});

test("a held Enhancer weather result stops without Predict or a legacy roll", async () => {
	resetWorld({
		active: true,
		enhancer: { overland: {
			rollWeather: async () => ({ ok: true, rolled: false, weather: { kind: "fair" } }),
		} },
	});
	const sheet = makeTravelSheet({ uses: 1 });
	let predictionRequests = 0;
	let legacyRolls = 0;
	sheet._requestPartyTravelMutation = async () => {
		predictionRequests++;
		return { ok: true, uses: 0 };
	};
	sheet._rollDefaultWeather = async () => { legacyRolls++; };

	await sheet._onRollWeather(event);

	assert.equal(predictionRequests, 0);
	assert.equal(legacyRolls, 0);
	assert.equal(chatCards, 0);
});

test("an Enhancer refusal warns and never falls back to Extras weather", async () => {
	resetWorld({
		active: true,
		enhancer: { overland: {
			rollWeather: async () => ({ ok: false, error: "Only the GM may roll weather." }),
		} },
	});
	const sheet = makeTravelSheet();
	let legacyRolls = 0;
	sheet._rollDefaultWeather = async () => { legacyRolls++; };

	await sheet._onRollWeather(event);

	assert.deepEqual(warnings, ["Only the GM may roll weather."]);
	assert.equal(legacyRolls, 0);
	assert.equal(chatCards, 0);
});

test("an accepted Predict calls Enhancer with reroll and stops on reroll refusal", async () => {
	const calls = [];
	let first = true;
	resetWorld({
		active: true,
		enhancer: { overland: {
			rollWeather: async (...args) => {
				calls.push(args);
				if (first) {
					first = false;
					return { ok: true, rolled: true, weather: { kind: "fair" } };
				}
				return { ok: false, error: "The active GM refused the reroll." };
			},
		} },
	});
	globalThis.foundry.applications.api.DialogV2.confirm = async () => true;
	const sheet = makeTravelSheet({ uses: 1 });
	const requests = [];
	let legacyRolls = 0;
	sheet._requestPartyTravelMutation = async request => {
		requests.push(request);
		return { ok: true, uses: 0 };
	};
	sheet._rollDefaultWeather = async () => { legacyRolls++; };

	await sheet._onRollWeather(event);

	assert.deepEqual(calls, [[], [{ reroll: true }]]);
	assert.deepEqual(requests, [], "a refused reroll must not consume Predict");
	assert.deepEqual(warnings, ["The active GM refused the reroll."]);
	assert.equal(legacyRolls, 0);
	assert.equal(chatCards, 0);
});

test("Predict is consumed only after Enhancer confirms a successful reroll", async () => {
	let release;
	const drawn = new Promise(resolve => { release = resolve; });
	const calls = [];
	resetWorld({ active: true, enhancer: { overland: {
		rollWeather: async options => {
			if (options?.reroll) { calls.push("reroll"); await drawn; }
			return { ok: true, rolled: true };
		},
	} } });
	foundry.applications.api.DialogV2.confirm = async () => true;
	const sheet = makeTravelSheet({ uses: 1 });
	sheet._requestPartyTravelMutation = async () => { calls.push("consume"); return { ok: true, uses: 0 }; };
	const pending = sheet._onRollWeather(event);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(calls, ["reroll"]);
	release();
	await pending;
	assert.deepEqual(calls, ["reroll", "consume"]);
});

test("failed Predict consumption after a confirmed reroll warns permanently without retrying", async t => {
	let rolls = 0;
	resetWorld({ active: true, enhancer: { overland: {
		rollWeather: async () => { rolls++; return { ok: true, rolled: true }; },
	} } });
	foundry.applications.api.DialogV2.confirm = async () => true;
	const sheet = makeTravelSheet({ uses: 2 });
	let requests = 0;
	sheet._requestPartyTravelMutation = async () => { requests++; return null; };
	const notices = [];
	t.mock.method(ui.notifications, "warn", (...args) => notices.push(args));
	await sheet._onRollWeather(event);
	assert.equal(rolls, 2, "one initial roll and one reroll, never replayed");
	assert.equal(requests, 1, "do not retry an uncertain consume write");
	assert.equal(sheet.actor.getFlag("shadowdark-extras", "campingWeatherReroll").uses, 2);
	assert.deepEqual(notices, [["SHADOWDARK_EXTRAS.camping_rest.predict_consume_failed", { permanent: true }]]);
	assert.equal(chatCards, 0);
	// Legacy ordering has not drawn yet: do not claim that a reroll happened.
	notices.length = 0;
	await sheet._maybeUseWeatherPrediction(async () => assert.fail("legacy must not draw after failed consume"));
	assert.deepEqual(notices, []);
});

test("a provider exception warns and never falls back to Extras weather", async () => {
	resetWorld({
		active: true,
		enhancer: { overland: {
			rollWeather: async () => { throw new Error("Enhancer unavailable"); },
		} },
	});
	const sheet = makeTravelSheet();
	let legacyRolls = 0;
	sheet._rollDefaultWeather = async () => { legacyRolls++; };

	await sheet._onRollWeather(event);

	assert.deepEqual(warnings, ["Enhancer unavailable"]);
	assert.equal(legacyRolls, 0);
	assert.equal(chatCards, 0);
});

test("a configured weather table keeps precedence over Enhancer, including its fallback", async () => {
	const table = {
		documentName: "RollTable",
		draw: async () => { table.draws++; },
		draws: 0,
	};
	let providerCalls = 0;
	resetWorld({
		tableUuid: "RollTable.custom",
		active: true,
		enhancer: { overland: {
			rollWeather: async () => {
				providerCalls++;
				return { ok: true, rolled: true };
			},
		} },
	});
	globalThis.fromUuid = async () => table;
	const tableSheet = makeTravelSheet();
	let legacyRolls = 0;
	tableSheet._rollDefaultWeather = async () => { legacyRolls++; };

	await tableSheet._onRollWeather(event);
	assert.equal(table.draws, 1);
	assert.equal(providerCalls, 0);
	assert.equal(legacyRolls, 0);

	resetWorld({
		tableUuid: "RollTable.missing",
		active: true,
		enhancer: { overland: {
			rollWeather: async () => {
				providerCalls++;
				return { ok: true, rolled: true };
			},
		} },
	});
	const fallbackSheet = makeTravelSheet();
	fallbackSheet._rollDefaultWeather = async () => { legacyRolls++; };

	await fallbackSheet._onRollWeather(event);
	assert.equal(providerCalls, 0);
	assert.equal(legacyRolls, 1);
	assert.equal(warnings[0], "SHADOWDARK_EXTRAS.party_weather.fallback_warning");
});

test("missing, disabled, and older Enhancer APIs preserve the legacy weather path", async () => {
	for (const setup of [
		{},
		{ active: false, enhancer: { overland: { rollWeather: async () => assert.fail("disabled provider called") } } },
		{ active: true, enhancer: { overland: {} } },
	]) {
		resetWorld(setup);
		const sheet = makeTravelSheet();
		let legacyRolls = 0;
		sheet._rollDefaultWeather = async () => { legacyRolls++; };
		await sheet._onRollWeather(event);
		assert.equal(legacyRolls, 1);
	}
});

// --- read-only state and refresh hook ---------------------------------------

test("Overland state is read-only, localized, and visible even when inactive", () => {
	let stateCalls = 0;
	let activeCalls = 0;
	const formatArgs = [];
	const writes = [];
	resetWorld({
		active: true,
		enhancer: {
			overland: {
				state: () => {
					stateCalls++;
					return {
						hexesLeft: 2,
						budget: 6,
						method: "walking",
						pushed: true,
						weather: { kind: "stormy", until: 240 },
					};
				},
				isActive: () => {
					activeCalls++;
					return false;
				},
			},
			time: {
				format: value => {
					formatArgs.push(value);
					return value === undefined ? "Day 4" : `Until ${value}`;
				},
			},
		},
	});
	globalThis.game.settings.set = async (...args) => writes.push(args);

	const view = getOverlandTravelState();

	assert.deepEqual(view, {
		date: "Day 4",
		weather: { kind: "stormy", label: "Stormy", until: "Until 240" },
		hexesLeft: 2,
		budget: 6,
		method: "walking",
		methodLabel: "Walking",
		pushed: true,
		travelling: false,
	});
	assert.equal(stateCalls, 1);
	assert.equal(activeCalls, 1);
	assert.deepEqual(formatArgs, [undefined, 240]);
	assert.deepEqual(writes, []);
});

test("disabled or incomplete Enhancer state APIs leave the old Travel context alone", () => {
	for (const setup of [
		{},
		{ active: false, enhancer: { overland: { state: () => ({}), isActive: () => true } } },
		{ active: true, enhancer: { overland: { state: () => ({}) } } },
		{ active: true, enhancer: { overland: { isActive: () => true } } },
	]) {
		resetWorld(setup);
		assert.equal(getOverlandTravelState(), null);
	}
});

test("state dates fall back safely when Enhancer has no time formatter", () => {
	resetWorld({
		active: true,
		enhancer: {
			overland: {
				state: () => ({
					hexesLeft: 0,
					budget: 0,
					weather: { kind: "fair", until: 88 },
				}),
				isActive: () => true,
			},
		},
	});
	const view = getOverlandTravelState();
	assert.equal(view.date, "100");
	assert.equal(view.weather.until, "88");
	assert.equal(view.travelling, true);
});

test("party sheets re-render on the Enhancer Overland hook", () => {
	registerPartySheetRerenderHooks();
	const hook = hooks.find(entry => entry.name === "shadowdark-enhancer.overlandChanged");
	assert.ok(hook, "Overland refresh hook is registered");
	let partyRenders = 0;
	let otherRenders = 0;
	const party = Object.create(PartySheetSD.prototype);
	party.render = () => { partyRenders++; };
	foundry.applications.instances = new Map([
		["party", party],
		["other", { render: () => { otherRenders++; } }],
	]);

	hook.fn();

	assert.equal(partyRenders, 1);
	assert.equal(otherRenders, 0);
});

test("party sheets re-render on the Enhancer rumorsChanged hook", () => {
	registerPartySheetRerenderHooks();
	const hook = hooks.find(entry => entry.name === "shadowdark-enhancer.rumorsChanged");
	assert.ok(hook, "rumors refresh hook is registered");
	let partyRenders = 0;
	let otherRenders = 0;
	const party = Object.create(PartySheetSD.prototype);
	party.render = () => { partyRenders++; };
	foundry.applications.instances = new Map([
		["party", party],
		["other", { render: () => { otherRenders++; } }],
	]);

	hook.fn({ ids: ["page1"] });

	assert.equal(partyRenders, 1);
	assert.equal(otherRenders, 0);
});

test("the Travel template hides only speed and renders the read-only state", () => {
	const template = readFileSync(new URL("../../templates/party.hbs", import.meta.url), "utf8");
	const source = readFileSync(new URL("../../scripts/party/PartySheetSD.mjs", import.meta.url), "utf8");
	assert.match(template, /\{\{#unless overlandState\}\}[\s\S]*sdx-travel-speed-selector/);
	assert.match(template, /sdx-overland-state/);
	assert.match(template, /overlandState\.hexesLeft/);
	assert.match(source, /context\.overlandState = getOverlandTravelState\(\)/);
	assert.match(source, /shadowdark-enhancer\.overlandChanged/);
});

test("translation leaves do not collide with namespaces when Foundry expands them", () => {
	const translations = JSON.parse(readFileSync(new URL("../../i18n/en.json", import.meta.url), "utf8"));
	for (const key of Object.keys(translations)) {
		const parts = key.split(".");
		while (parts.length > 1) {
			parts.pop();
			assert.equal(Object.hasOwn(translations, parts.join(".")), false, `${key} collides with ${parts.join(".")}`);
		}
	}
});
