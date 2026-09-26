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
