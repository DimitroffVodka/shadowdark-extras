// #151: the pure rules behind the carousing window's settlement limit,
// Enhancer's holidays, the no-overlap check against an Enhancer downtime
// session, and the two-week warning. The holiday fixtures are invented; they
// only copy the SHAPE Shadowdark Enhancer's holidays.today() returns
// (scripts/holidays/holidays.mjs). No book data belongs in this file.

import assert from "node:assert/strict";
import test from "node:test";

const {
	carousingLimit, d100Formula, downtimeOpen, holidayEffects, recentCarousers, settlementOf,
	tierOverLimit,
} = await import("../../scripts/party/carousing/carousing-rules.mjs");

const DAY = 24 * 60 * 60 * 1000;
// Invented numbers: the book's limits never ship, in code or in tests.
const FALLBACK = { village: 40, town: 250, city: 900, city_state: null };

/** An invented fair: event bonus, benefit bonus, two garb questions. */
const lanternFair = {
	key: "lanternFair", name: "Lantern Fair",
	carousing: { eventBonus: 3, benefitBonus: 7, chances: [] },
	garb: [
		{ key: "lanternNoLamp", modifier: -2, label: "Carrying no lantern?" },
		{ key: "lanternFeathers", modifier: 1, label: "Wearing feathers?" },
	],
};
/** An invented gala: a required garb, a garb with a note, advantage and a chance. */
const glassGala = {
	key: "glassGala", name: "Glass Gala",
	carousing: {
		eventBonus: 1, benefitAdvantage: true,
		chances: [{ key: "galaToast", oneIn: 8, label: "Asked to give the toast" }],
	},
	garb: [
		{ key: "galaSilverMask", modifier: 0, label: "Silver mask?", required: true },
		{ key: "galaMud", modifier: -4, label: "Muddy boots?", note: "The butler takes note." },
	],
};

test("settlementOf reads the settlement feature Enhancer sends", () => {
	const record = {
		name: "Hex 0712",
		features: [
			{ id: "poi-1", type: "ruin", name: "Old Tower" },
			{ id: "settlement-712", type: "city_state", name: "Hollowmere" },
		],
	};
	assert.deepEqual(settlementOf(record), {
		kind: "city_state", name: "Hollowmere", place: "settlement-712",
	});
});

test("settlementOf falls back to the name when the feature id is not Enhancer's", () => {
	const record = { name: "Brindle", features: [{ id: "abc", type: "Village", name: "" }] };
	assert.deepEqual(settlementOf(record), { kind: "village", name: "Brindle", place: "Brindle" });
	assert.equal(settlementOf({ features: [{ type: "ruin" }] }), null);
	assert.equal(settlementOf(undefined), null);
});

test("the limit comes from Enhancer, and its null falls back to the local table", () => {
	const enhancer = limit => ({ rules: { carousingLimit: () => limit } });
	assert.equal(carousingLimit("village", { enhancer: enhancer(250), fallback: FALLBACK }), 250);
	assert.equal(
		carousingLimit("village", { enhancer: enhancer(Infinity), fallback: FALLBACK }), Infinity
	);
	// null is "the GM never set the table up", not "no limit"
	assert.equal(carousingLimit("village", { enhancer: enhancer(null), fallback: FALLBACK }), 40);
	assert.equal(carousingLimit("town", { fallback: FALLBACK }), 250);
});

test("an empty local value, no settlement, or a broken Enhancer call", () => {
	assert.equal(carousingLimit("city_state", { fallback: FALLBACK }), Infinity);
	assert.equal(carousingLimit("none", { fallback: FALLBACK }), Infinity);
	assert.equal(carousingLimit("hamlet", { fallback: FALLBACK }), Infinity);
	const throwing = { rules: { carousingLimit: () => { throw new Error("boom"); } } };
	const warn = console.warn;
	console.warn = () => {};
	try {
		assert.equal(carousingLimit("city", { enhancer: throwing, fallback: FALLBACK }), 900);
	}
	finally {
		console.warn = warn;
	}
});

test("tiers above the limit are refused, tiers at it are offered", () => {
	assert.equal(tierOverLimit({ cost: 40 }, 40), false);
	assert.equal(tierOverLimit({ cost: 41 }, 40), true);
	assert.equal(tierOverLimit({ cost: 5000 }, Infinity), false);
	assert.equal(tierOverLimit({}, 0), false);
});

test("an event bonus, a benefit bonus, and each garb answer's modifier", () => {
	const plain = holidayEffects(lanternFair, {});
	assert.equal(plain.admitted, true);
	assert.equal(plain.eventBonus, 3);
	assert.equal(plain.benefitBonus, 7);
	assert.equal(holidayEffects(lanternFair, { lanternNoLamp: true }).eventBonus, 1);
	assert.equal(
		holidayEffects(lanternFair, { lanternNoLamp: true, lanternFeathers: true }).eventBonus, 2
	);
	assert.equal(holidayEffects(null, {}), null);
});

test("a required garb gates the holiday; a garb with a note posts it", () => {
	const out = holidayEffects(glassGala, {});
	assert.equal(out.admitted, false);
	assert.equal(out.eventBonus, 0);
	assert.equal(out.benefitAdvantage, false);
	assert.deepEqual(out.chances, []);

	const muddy = holidayEffects(glassGala, { galaSilverMask: true, galaMud: true });
	assert.equal(muddy.admitted, true);
	assert.equal(muddy.eventBonus, -3);
	assert.equal(muddy.benefitAdvantage, true);
	assert.deepEqual(muddy.notes, ["The butler takes note."]);
	assert.equal(muddy.chances.length, 1);
});

test("a holiday changes benefit d100 rolls only", () => {
	const fair = holidayEffects(lanternFair, {});
	assert.equal(d100Formula("benefit", "", fair), "1d100 + 7");
	assert.equal(d100Formula("benefit", "2", fair), "1d100 + 2 + 7");
	assert.equal(d100Formula("mishap", "", fair), "1d100");
	const gala = holidayEffects(glassGala, { galaSilverMask: true });
	assert.equal(d100Formula("benefit", "", gala), "2d100kh");
	assert.equal(d100Formula("benefit", "", holidayEffects(glassGala, {})), "1d100");
	assert.equal(d100Formula("benefit", "", null), "1d100");
});

test("downtime overlap: isOpen() when Enhancer has it, else the session state", async () => {
	assert.equal(await downtimeOpen(null), false);
	assert.equal(await downtimeOpen({ downtime: { isOpen: () => true } }), true);
	assert.equal(await downtimeOpen({ downtime: { isOpen: async () => false } }), false);
	// isOpen outranks the older session state
	assert.equal(await downtimeOpen({
		downtime: { isOpen: () => false, sessionState: () => ({ active: true }) },
	}), false);
	assert.equal(await downtimeOpen({ downtime: { sessionState: () => ({ active: true }) } }), true);
	assert.equal(await downtimeOpen({ downtime: { sessionState: () => ({ active: false }) } }), false);
	assert.equal(await downtimeOpen({ downtime: {} }), false);
});

test("the two-week warning names who caroused less than 14 real days ago", () => {
	const now = Date.UTC(2026, 8, 26, 12);
	const entries = [
		{ actorIds: ["a", "b"], at: now - 20 * DAY },
		{ actorIds: ["a"], at: now - 5 * DAY },
		{ actorIds: ["c"], at: now - 14 * DAY },
		{ actorIds: ["d"], at: undefined },
	];
	assert.deepEqual(recentCarousers(entries, ["a", "b", "c", "d", "e"], now), [
		{ actorId: "a", daysAgo: 5 },
	]);
	assert.deepEqual(recentCarousers(entries, ["b"], now - 10 * DAY), [
		{ actorId: "b", daysAgo: 10 },
	]);
	assert.deepEqual(recentCarousers([], ["a"], now), []);
});

// ── Review fixes on PR #159 ────────────────────────────────────────────────

globalThis.CONST ??= {
	TABLE_RESULT_TYPES: { TEXT: "text", DOCUMENT: "document" },
	USER_ROLES: {},
	DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 },
};
const { clampToOutcomeRows, expandedOutcomeFor } = await import(
	"../../scripts/party/carousing/carousing-core.mjs"
);
const { getOutcome } = await import("../../scripts/party/carousing/CarousingSD.mjs");
const { carousingLogEntries } = await import("../../scripts/party/carousing/carousing-log.mjs");
const { clearCarousingPlaceCache, resolveCarousingPlace } = await import(
	"../../scripts/party/carousing/carousing-rules.mjs"
);

// Invented rows; `xp` only tells them apart.
const expandedRows = count => Array.from({ length: count }, (_, i) => ({ roll: i + 1, xp: i + 1 }));

test("Expanded: a total below the first row gets the first row, not the best", () => {
	const rows = expandedRows(25);
	assert.equal(expandedOutcomeFor(0, rows).roll, 1);
	assert.equal(expandedOutcomeFor(-3, rows).roll, 1);
	assert.equal(expandedOutcomeFor(7, rows).roll, 7);
	assert.equal(expandedOutcomeFor(40, rows).roll, 25);
	// a shorter table tops out at its own last row
	assert.equal(expandedOutcomeFor(23, expandedRows(20)).roll, 20);
});

test("Original: a total below the first row gets the first row; above, the top row", () => {
	const rows = [
		{ roll: "1", description: "worst" }, { roll: "2", description: "two" },
		{ roll: "3", description: "three" }, { roll: "4+", description: "best" },
	];
	assert.equal(getOutcome(0, rows).description, "worst");
	assert.equal(getOutcome(-2, rows).description, "worst");
	assert.equal(getOutcome(3, rows).description, "three");
	assert.equal(getOutcome(9, rows).description, "best");
	const closed = [{ roll: "1", description: "one" }, { roll: "2", description: "two" }];
	assert.equal(getOutcome(8, closed).description, "two");
	assert.equal(clampToOutcomeRows(5, []), 5);
});

// Foundry stand-ins for the log journal, the hex journal and Enhancer.
const NOW = Date.UTC(2026, 8, 26, 12);
const logPages = [];
const logJournal = {
	name: "Carousing Log",
	getFlag: (scope, key) => key === "isCarousingLog",
	pages: { get contents() { return logPages; } },
};
const hexRecords = {
	"3_4": { features: [{ id: "settlement-712", type: "town", name: "Hollowmere" }] },
	"5_4": { features: [{ id: "settlement-914", type: "village", name: "Dunwold" }] },
};
const hexJournal = {
	name: "__sdx_hex_data__",
	getFlag: (scope, key) => (key === "hexData" ? { s1: hexRecords } : undefined),
};
const party = { i: 3, j: 4 };
const scene = {
	id: "s1",
	grid: { isHexagonal: true, getOffset: () => ({ ...party }) },
	tokens: [{
		actor: { type: "NPC", getFlag: (scope, key) => key === "isParty" },
		getCenterPoint: () => ({ x: 0, y: 0 }),
	}],
};
const calls = { today: 0, list: 0 };
const worldDay = { year: 3, day: 40 };
globalThis.game = {
	modules: { get: id => (id === "shadowdark-enhancer" ? { active: true } : undefined) },
	shadowdarkEnhancer: {
		holidays: {
			today: async () => { calls.today++; return []; },
			list: async () => { calls.list++; return [lanternFair]; },
		},
	},
	settings: { get: () => { throw new Error("not registered"); } },
	scenes: { active: scene },
	time: { components: worldDay },
	journal: { find: predicate => [hexJournal, logJournal].find(predicate) },
};

test("the warning counts the session the live carouse last rolled", () => {
	// This page's logId is still session.logId until the next roll makes a new
	// one; excluding it hid a party that caroused 5 days ago without a Reset.
	logPages.push({
		getFlag: (scope, key) => ({ logId: "last-roll", actorIds: ["a"] })[key],
		_stats: { createdTime: NOW - 5 * DAY },
	});
	assert.deepEqual(recentCarousers(carousingLogEntries(), ["a"], NOW), [
		{ actorId: "a", daysAgo: 5 },
	]);
});

test("the holiday lookup is cached per hex and world day, and reset on open", async () => {
	clearCarousingPlaceCache();
	const first = await resolveCarousingPlace({});
	assert.equal(first.kind, "town");
	assert.equal(first.chosen, false);
	assert.equal(first.fromMap.place, "settlement-712");
	assert.equal(first.limit, Infinity);
	assert.equal(first.holidaysImported, true);
	assert.deepEqual(calls, { today: 1, list: 1 });

	// Another render, and the GM's own choice: no new lookup
	const chosen = await resolveCarousingPlace({ settlement: "city" });
	assert.equal(chosen.kind, "city");
	assert.equal(chosen.chosen, true);
	assert.deepEqual(calls, { today: 1, list: 1 });

	worldDay.day = 41;
	await resolveCarousingPlace({});
	assert.deepEqual(calls, { today: 2, list: 2 });

	party.i = 5;
	assert.equal((await resolveCarousingPlace({})).kind, "village");
	assert.deepEqual(calls, { today: 3, list: 3 });

	clearCarousingPlaceCache();
	await resolveCarousingPlace({});
	assert.deepEqual(calls, { today: 4, list: 4 });
});
