// Characterization tests for the CarousingSD functions that are about to move
// out of it, captured BEFORE the split.
//
// CarousingSD is 1,636 lines of forty-eight plain functions. Three test files
// already cover parts of it — outcome-effect parsing, the log note builder,
// and native renown reads — so this one takes what those do not and what the
// split touches: the copper arithmetic, the change-making deduction, the
// renown write path with its Shadowdark Enhancer delegation, and the smaller
// participant and UI helpers.
//
// The module is written against Foundry globals but reaches them through
// `globalThis` at call time rather than at import, so a plain object graph is
// enough — no loader hook needed here.

import assert from "node:assert/strict";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";

globalThis.CONST = {
	TABLE_RESULT_TYPES: { TEXT: "text", DOCUMENT: "document" },
	USER_ROLES: {},
	DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 },
};
globalThis.foundry = { utils: { escapeHTML: value => String(value) } };

/** Settings are read through a try/catch, so a throwing get is a real case. */
let settings = new Map();
let actorsById = new Map();
// Participant drops live on a flag of the carousing journal, which the core
// module finds by name.
let journalFlags = {};
const carousingJournal = {
	id: "carousing-journal",
	name: "__sdx_carousing_sync__",
	getFlag: (scope, key) => (scope === MODULE_ID ? journalFlags[key] : undefined),
};
globalThis.game = {
	journal: {
		get: id => (id === carousingJournal.id ? carousingJournal : null),
		find: predicate => ([carousingJournal].find(predicate) ?? null),
	},
	user: { isGM: true, id: "gm" },
	modules: { get: () => undefined },
	settings: {
		get: (scope, key) => {
			if (!settings.has(key)) throw new Error(`unregistered setting ${scope}.${key}`);
			return settings.get(key);
		},
	},
	actors: { get: id => actorsById.get(id) ?? null },
	i18n: { localize: key => key },
};

const carousing = await import("../../scripts/party/carousing/CarousingSD.mjs");
const {
	formatCoins, getCarousingWealthBaseMode, getCarousingWealthBaseCp, getActorWealthDisplay,
	parseRenownDelta, getActorRenown, applyRenownDelta, migrateLegacyRenown,
	getParticipantActor, rerenderPlayerSheets,
} = carousing;

/** An actor whose update() records what was written. */
function makeActor({ coins = {}, items = [], renown, type = "Player", flags = {} } = {}) {
	const updates = [];
	return {
		type,
		updates,
		unsetFlags: [],
		system: { coins: { gp: 0, sp: 0, cp: 0, ...coins }, renown },
		items,
		getFlag: (scope, key) => (scope === MODULE_ID ? flags[key] : undefined),
		unsetFlag(scope, key) {
			this.unsetFlags.push(key);
			return Promise.resolve();
		},
		update(data) {
			updates.push(data);
			if (data["system.renown"] !== undefined) this.system.renown = data["system.renown"];
			if (data["system.coins"]) this.system.coins = data["system.coins"];
			return Promise.resolve(this);
		},
	};
}

const gear = (gp = 0, sp = 0, cp = 0, quantity = 1) =>
	({ system: { cost: { gp, sp, cp }, quantity } });

// --- copper arithmetic ------------------------------------------------------

test("a purse converts to copper at 1 gp = 10 sp = 100 cp", () => {
	assert.equal(getCarousingWealthBaseCp(makeActor({ coins: { gp: 1 } })), 100);
	assert.equal(getCarousingWealthBaseCp(makeActor({ coins: { sp: 1 } })), 10);
	assert.equal(getCarousingWealthBaseCp(makeActor({ coins: { cp: 1 } })), 1);
	assert.equal(getCarousingWealthBaseCp(makeActor({ coins: { gp: 2, sp: 3, cp: 4 } })), 234);
});

test("missing or unparseable coin fields read as zero", () => {
	assert.equal(getCarousingWealthBaseCp(makeActor({ coins: { gp: "x", sp: null } })), 0);
	assert.equal(getCarousingWealthBaseCp(makeActor()), 0);
	assert.equal(getCarousingWealthBaseCp(undefined), 0);
});

test("a coin string names only the denominations that are present", () => {
	assert.equal(formatCoins(234), "2 gp 3 sp 4 cp");
	assert.equal(formatCoins(200), "2 gp");
	assert.equal(formatCoins(204), "2 gp 4 cp");
	assert.equal(formatCoins(30), "3 sp");
});

test("nothing at all reads as zero gold, never an empty string", () => {
	assert.equal(formatCoins(0), "0 gp");
	assert.equal(formatCoins(-50), "0 gp", "a negative total clamps rather than inverting");
	assert.equal(formatCoins(undefined), "0 gp");
	assert.equal(formatCoins("nonsense"), "0 gp");
});

test("a fractional copper total is rounded before being split", () => {
	assert.equal(formatCoins(100.4), "1 gp");
	assert.equal(formatCoins(0.6), "1 cp");
});

// --- the wealth base --------------------------------------------------------

test("the wealth base defaults to coins when the setting is unset or throws", () => {
	settings = new Map();
	assert.equal(getCarousingWealthBaseMode(), "coins");

	settings = new Map([["carousingWealthBase", ""]]);
	assert.equal(getCarousingWealthBaseMode(), "coins", "an empty value is not a mode");
});

test("gear widens the base only when the setting says so", () => {
	const actor = makeActor({ coins: { gp: 1 }, items: [gear(5)] });

	settings = new Map([["carousingWealthBase", "coins"]]);
	assert.equal(getCarousingWealthBaseCp(actor), 100);

	settings = new Map([["carousingWealthBase", "coinsAndGear"]]);
	assert.equal(getCarousingWealthBaseCp(actor), 600, "100 coin + 500 gear");
});

test("gear value multiplies by quantity and skips items with no cost", () => {
	settings = new Map([["carousingWealthBase", "coinsAndGear"]]);
	const actor = makeActor({
		items: [gear(2, 0, 0, 3), gear(0, 5, 0), { system: { quantity: 9 } }],
		coins: {},
	});

	assert.equal(getCarousingWealthBaseCp(actor), 650, "600 + 50, the costless item ignored");
});

test("the display card carries coins, gear and total, both raw and labelled", () => {
	const display = getActorWealthDisplay(makeActor({ coins: { gp: 2, sp: 5 }, items: [gear(1)] }));

	assert.deepEqual(display, {
		coinsCp: 250,
		gearCp: 100,
		totalCp: 350,
		coinsLabel: "2 gp 5 sp",
		totalLabel: "3 gp 5 sp",
	});
});

// --- making change ----------------------------------------------------------
//
// New coverage, not carried across: deductCoinsCp had no public entry point
// before the Phase 5.3 split — it was reached only from the roll executors and
// applyCarousingOutcome — so nothing could reach it to assert. carousing-wealth
// exports it, and these are its first tests.
//
// It spends the smallest coins first and breaks a larger one only when the
// remainder cannot be covered, so the actor's coin COUNT stays as close to
// unchanged as it can. In Shadowdark 100 coins is a gear slot regardless of
// denomination, so silently normalising a purse would alter encumbrance.

const { deductCoinsCp } = await import("../../scripts/party/carousing/carousing-wealth.mjs");

/** Deduct and report both the purse left behind and what was actually taken. */
async function deduct(coins, cpAmount) {
	const actor = makeActor({ coins });
	const spent = await deductCoinsCp(actor, cpAmount);
	return { purse: actor.system.coins, spent, wrote: actor.updates.length };
}

test("copper alone covers a small debt, leaving larger coins whole", async () => {
	const { purse, spent } = await deduct({ gp: 1, sp: 0, cp: 10 }, 5);

	assert.deepEqual(purse, { gp: 1, sp: 0, cp: 5 }, "the gold piece is not broken for no reason");
	assert.equal(spent, 5);
});

test("a silver is broken only when copper runs short, and the change comes back", async () => {
	const { purse, spent } = await deduct({ gp: 0, sp: 1, cp: 0 }, 5);

	assert.deepEqual(purse, { gp: 0, sp: 0, cp: 5 });
	assert.equal(spent, 5);
});

test("breaking a gold piece returns change as silver and copper, not raw copper", async () => {
	const { purse, spent } = await deduct({ gp: 1, sp: 0, cp: 0 }, 5);

	assert.deepEqual(purse, { gp: 0, sp: 9, cp: 5 }, "95 copper of change, denominated");
	assert.equal(spent, 5);
});

test("copper is spent first even when silver would cover the whole debt", async () => {
	const { purse } = await deduct({ gp: 0, sp: 5, cp: 8 }, 8);

	assert.deepEqual(purse, { gp: 0, sp: 5, cp: 0 }, "no silver was broken");
});

test("a debt beyond the purse takes everything and reports only what was there", async () => {
	const { purse, spent } = await deduct({ gp: 2, sp: 0, cp: 0 }, 250);

	assert.deepEqual(purse, { gp: 0, sp: 0, cp: 0 });
	assert.equal(spent, 200, "clamped to the purse, not the amount asked for");
});

test("an exact payment empties the purse without leaving change", async () => {
	const { purse, spent } = await deduct({ gp: 1, sp: 2, cp: 3 }, 123);

	assert.deepEqual(purse, { gp: 0, sp: 0, cp: 0 });
	assert.equal(spent, 123);
});

test("a zero, negative or unparseable amount writes nothing at all", async () => {
	for (const amount of [0, -10, undefined, "nonsense"]) {
		const { wrote, spent } = await deduct({ gp: 1, sp: 1, cp: 1 }, amount);
		assert.equal(wrote, 0, `amount ${amount} should not touch the actor`);
		assert.equal(spent, 0);
	}
});

test("deducting from an empty purse is a no-op rather than a negative balance", async () => {
	const { wrote, spent } = await deduct({ gp: 0, sp: 0, cp: 0 }, 50);

	assert.equal(spent, 0);
	assert.equal(wrote, 0);
});

test("a gold amount is converted to copper before being deducted", async () => {
	const { deductCoins } = await import("../../scripts/party/carousing/carousing-wealth.mjs");
	const actor = makeActor({ coins: { gp: 3, sp: 0, cp: 0 } });

	await deductCoins(actor, 2);

	assert.deepEqual(actor.system.coins, { gp: 1, sp: 0, cp: 0 }, "2 gp = 200 cp");
});

// --- renown deltas ----------------------------------------------------------

test("a signed renown amount is read out of a result description", () => {
	assert.equal(parseRenownDelta("You gain +2 renown in the city"), 2);
	assert.equal(parseRenownDelta("Word spreads: -1 renown"), -1);
	assert.equal(parseRenownDelta("+10 Renown"), 10);
});

test("a conditional renown grant is left for the GM to apply", () => {
	assert.equal(parseRenownDelta("-1 renown if anyone sees it"), 0,
		"the 'if' lookahead keeps conditional rows manual");
});

test("a description with no renown clause yields no delta", () => {
	assert.equal(parseRenownDelta("You wake in a ditch"), 0);
	assert.equal(parseRenownDelta(""), 0);
	assert.equal(parseRenownDelta(null), 0);
	assert.equal(parseRenownDelta("renown"), 0, "a bare mention is not a delta");
});

test("native renown reads as a number, defaulting to zero", () => {
	assert.equal(getActorRenown(makeActor({ renown: 5 })), 5);
	assert.equal(getActorRenown(makeActor({ renown: -3 })), -3, "negative renown is legal");
	assert.equal(getActorRenown(makeActor({ renown: "x" })), 0);
	assert.equal(getActorRenown(makeActor()), 0);
	assert.equal(getActorRenown(null), 0);
});

test("a renown delta writes the system field and reports what it applied", async () => {
	const actor = makeActor({ renown: 4 });

	assert.equal(await applyRenownDelta(actor, 3), 3);
	assert.deepEqual(actor.updates, [{ "system.renown": 7 }]);
});

test("renown is allowed to go negative, as the system intends", async () => {
	const actor = makeActor({ renown: 1 });

	await applyRenownDelta(actor, -5);

	assert.deepEqual(actor.updates, [{ "system.renown": -4 }]);
});

test("a zero delta or absent actor writes nothing", async () => {
	const actor = makeActor({ renown: 4 });

	assert.equal(await applyRenownDelta(actor, 0), 0);
	assert.equal(await applyRenownDelta(null, 3), 0);
	assert.deepEqual(actor.updates, []);
});

// Shadowdark Enhancer owns the renown ledger when it is installed: it commits
// the value and its history row together and carries the reason through to the
// Session Recap, which a bare field write cannot do.
function withEnhancer(renownApi, { isGM = true } = {}) {
	globalThis.game.user.isGM = isGM;
	globalThis.game.modules = { get: id => (id === "shadowdark-enhancer" ? { active: true } : undefined) };
	globalThis.game.shadowdarkEnhancer = { renown: renownApi };
	return () => {
		globalThis.game.user.isGM = true;
		globalThis.game.modules = { get: () => undefined };
		delete globalThis.game.shadowdarkEnhancer;
	};
}

test("a GM hands the award to Shadowdark Enhancer with the reason attached", async () => {
	const awards = [];
	const restore = withEnhancer({
		award: async payload => {
			awards.push(payload);
			return { ok: true, delta: payload.delta };
		},
	});
	try {
		const actor = makeActor({ renown: 4 });

		assert.equal(await applyRenownDelta(actor, 2, "Carousing benefit"), 2);
		assert.deepEqual(actor.updates, [], "SDE wrote it, not us");
		assert.equal(awards.length, 1);
		assert.equal(awards[0].reason, "Carousing benefit");
		assert.equal(awards[0].source, "carousing");
		assert.equal(awards[0].chat, false, "our own card already reports the change");
	}
	finally {
		restore();
	}
});

// The session stores the applied delta and replays it negated when a result is
// removed, so a clamped award must not leave SDX holding a number SDE never wrote.
test("the number Shadowdark Enhancer actually wrote is the one reported back", async () => {
	const restore = withEnhancer({ award: async () => ({ ok: true, delta: 1 }) });
	try {
		assert.equal(await applyRenownDelta(makeActor({ renown: 0 }), 5), 1);
	}
	finally {
		restore();
	}
});

test("a refusal from Shadowdark Enhancer still applies the renown directly", async () => {
	const restore = withEnhancer({ award: async () => ({ ok: false, error: "nope" }) });
	try {
		const actor = makeActor({ renown: 4 });

		assert.equal(await applyRenownDelta(actor, 2), 2);
		assert.deepEqual(actor.updates, [{ "system.renown": 6 }]);
	}
	finally {
		restore();
	}
});

test("a throwing Shadowdark Enhancer does not lose the renown either", async () => {
	const restore = withEnhancer({
		award: async () => {
			throw new Error("boom");
		},
	});
	try {
		const actor = makeActor({ renown: 4 });

		assert.equal(await applyRenownDelta(actor, 2), 2);
		assert.deepEqual(actor.updates, [{ "system.renown": 6 }]);
	}
	finally {
		restore();
	}
});

// SDE rejects player-side awards outright — its recap is a world setting only a
// GM may write — so a player keeps the direct write and SDE's external-change
// watcher picks it up.
test("a player writes the field directly rather than delegating", async () => {
	const awards = [];
	const restore = withEnhancer({ award: async p => (awards.push(p), { ok: true, delta: p.delta }) },
		{ isGM: false });
	try {
		const actor = makeActor({ renown: 4 });

		assert.equal(await applyRenownDelta(actor, 2), 2);
		assert.deepEqual(actor.updates, [{ "system.renown": 6 }]);
		assert.deepEqual(awards, [], "SDE was never asked");
	}
	finally {
		restore();
	}
});

// --- legacy renown migration ------------------------------------------------

test("a legacy flag populates native renown only while native is zero", async () => {
	const empty = makeActor({ renown: 0, flags: { renown: 7 } });
	const occupied = makeActor({ renown: 2, flags: { renown: 7 } });

	assert.equal(await migrateLegacyRenown([empty, occupied]), 1);
	assert.deepEqual(empty.updates, [{ "system.renown": 7 }]);
	assert.deepEqual(occupied.updates, [], "system-owned data is never overwritten");
});

test("the legacy flag is cleared either way, so there is one source of truth", async () => {
	const empty = makeActor({ renown: 0, flags: { renown: 7 } });
	const occupied = makeActor({ renown: 2, flags: { renown: 7 } });

	await migrateLegacyRenown([empty, occupied]);

	assert.deepEqual(empty.unsetFlags, ["renown"]);
	assert.deepEqual(occupied.unsetFlags, ["renown"]);
});

test("migration skips non-players and actors with no legacy flag", async () => {
	const npc = makeActor({ type: "NPC", renown: 0, flags: { renown: 7 } });
	const clean = makeActor({ renown: 0 });

	assert.equal(await migrateLegacyRenown([npc, clean]), 0);
	assert.deepEqual(npc.unsetFlags, [], "a non-player is not touched at all");
	assert.deepEqual(clean.updates, []);
});

test("a legacy zero clears the flag without counting as a migration", async () => {
	const zero = makeActor({ renown: 0, flags: { renown: 0 } });

	assert.equal(await migrateLegacyRenown([zero]), 0);
	assert.deepEqual(zero.updates, []);
	assert.deepEqual(zero.unsetFlags, ["renown"]);
});

// --- participants -----------------------------------------------------------

test("an actor-prefixed participant id names a GM-managed actor directly", () => {
	const hero = makeActor();
	actorsById = new Map([["hero", hero]]);

	assert.equal(getParticipantActor("actor-hero"), hero);
});

test("a plain participant id is a user whose dropped actor must be looked up", () => {
	journalFlags = { carousingDrops: { "user-1": "hero" } };
	const hero = makeActor();
	actorsById = new Map([["hero", hero]]);

	assert.equal(getParticipantActor("user-1"), hero);
});

test("an unknown participant resolves to nothing rather than throwing", () => {
	journalFlags = {};
	actorsById = new Map();

	assert.equal(getParticipantActor("user-nobody"), null);
	assert.equal(getParticipantActor(undefined), null);
});

// --- sheet refresh ----------------------------------------------------------

test("refreshing reaches the overlay and only the sheets carrying a carousing tab", () => {
	const refreshed = [];
	globalThis.window = { sdxCarousingOverlayRefresh: () => refreshed.push("overlay") };
	const sheet = (type, tabCount) => ({
		actor: { type },
		element: { find: () => ({ length: tabCount }) },
		render: () => refreshed.push(`${type}:${tabCount}`),
	});
	globalThis.ui = { windows: { a: sheet("Player", 1), b: sheet("Player", 0), c: sheet("NPC", 1) } };

	rerenderPlayerSheets();

	assert.deepEqual(refreshed, ["overlay", "Player:1"]);
});

test("refreshing works with no overlay open", () => {
	globalThis.window = {};
	globalThis.ui = { windows: {} };

	assert.doesNotThrow(() => rerenderPlayerSheets());
});
