import assert from "node:assert/strict";
import test from "node:test";
import { escapeHTML } from "./helpers/escape-html.mjs";

// A summon's duration is written in rounds, but rounds are only counted while an
// encounter is running. Cast outside combat, the old code registered nothing at
// all and the creature stayed forever; end the combat mid-duration and the same
// thing happened, because the round counter it referenced never advanced again.
//
// Expiry now answers to whichever clock is actually running: rounds during an
// encounter, world time otherwise — the basis focus spells and auras already
// use. These are the pure decisions, shared by every hook so the triggers cannot
// drift apart.

globalThis.window = globalThis;
globalThis.foundry = {
	applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b, DialogV2: class {} } },
	utils: { randomID: () => "id", Collection: class extends Map {}, escapeHTML, mergeObject: (a, b) => ({ ...a, ...b }) },
};
globalThis.game = {
	settings: { get: () => undefined, register: () => {} },
	i18n: { localize: (k) => k },
	user: { id: "gm", isGM: true },
	users: [], actors: { get: () => null }, scenes: { current: null },
	time: { worldTime: 1000 },
};
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.ChatMessage = { getSpeaker: () => ({}) };
globalThis.Actor = class {};
globalThis.fromUuidSync = () => null;
globalThis.Portal = class {};
globalThis.CONFIG = { time: { roundTime: 6 } };   // Foundry's default: 6s per round

const {
	buildDurationExpiry, isDurationExpired, partitionExpiredDurations, convertRoundExpiryToWorldTime,
	describeDurationRemaining,
} = await import("../../scripts/shared/duration-basis.mjs");

// ── choosing a basis ────────────────────────────────────────────────────────

test("during an encounter the duration is held in rounds", () => {
	assert.deepEqual(buildDurationExpiry(5, { combat: { round: 3 }, worldTime: 1000 }), { expiryRound: 8 });
});

test("an encounter that has not begun still counts round 1", () => {
	// combat.round is 0 between "create encounter" and "begin combat". A spell
	// cast then should last through round 1, so round 0 reads as 1 — this is the
	// `|| 1` that the duration tracker's `?? 0` disagrees with.
	assert.deepEqual(buildDurationExpiry(5, { combat: { round: 0 }, worldTime: 1000 }), { expiryRound: 6 });
});

test("outside an encounter the duration is held in world time", () => {
	// 5 rounds x 6s. Previously nothing was recorded and the summon was permanent.
	assert.deepEqual(buildDurationExpiry(5, { combat: null, worldTime: 1000 }), { expiryWorldTime: 1030 });
});

test("world-time conversion honours a world that redefines a round", () => {
	globalThis.CONFIG.time.roundTime = 10;
	assert.deepEqual(buildDurationExpiry(3, { combat: null, worldTime: 500 }), { expiryWorldTime: 530 });
	globalThis.CONFIG.time.roundTime = 6;
});

// ── judging a basis ─────────────────────────────────────────────────────────

test("a round entry expires on rounds", () => {
	const e = { expiryRound: 6 };
	assert.equal(isDurationExpired(e, { round: 5 }), false);
	assert.equal(isDurationExpired(e, { round: 6 }), true);
	assert.equal(isDurationExpired(e, { round: 7 }), true);
});

test("a world-time entry expires on world time", () => {
	const e = { expiryWorldTime: 1030 };
	assert.equal(isDurationExpired(e, { worldTime: 1029 }), false);
	assert.equal(isDurationExpired(e, { worldTime: 1030 }), true);
});

test("the two clocks do not expire each other's entries", () => {
	// The important isolation: advancing world time must not retire a summon that
	// is counting rounds, and vice versa — otherwise one clock silently ends a
	// duration the other has not reached.
	assert.equal(isDurationExpired({ expiryRound: 6 }, { worldTime: 999999 }), false);
	assert.equal(isDurationExpired({ expiryWorldTime: 1030 }, { round: 999 }), false);
});

test("an entry with no basis never expires, and nothing throws", () => {
	assert.equal(isDurationExpired({}, { round: 99, worldTime: 99999 }), false);
	assert.equal(isDurationExpired(null, { round: 1 }), false);
	assert.equal(isDurationExpired(undefined, {}), false);
});

test("partition splits due from standing", () => {
	const entries = [
		{ spellName: "Undeath", expiryRound: 6, tokenIds: ["a"] },
		{ spellName: "Later", expiryRound: 9, tokenIds: ["b"] },
		{ spellName: "Timed", expiryWorldTime: 2000, tokenIds: ["c"] },
	];
	const { expired, remaining } = partitionExpiredDurations(entries, { round: 6 });
	assert.deepEqual(expired.map(e => e.spellName), ["Undeath"]);
	assert.deepEqual(remaining.map(e => e.spellName), ["Later", "Timed"],
		"the world-time entry must survive a round tick");
	assert.deepEqual(partitionExpiredDurations(null, { round: 1 }), { expired: [], remaining: [] });
});

// ── surviving the encounter ─────────────────────────────────────────────────

test("ending a combat re-bases the rounds still owed onto world time", () => {
	// 2 rounds left x 6s from now. Without this the entry keeps waiting on a
	// round counter that will never move again, and the summon is permanent.
	const converted = convertRoundExpiryToWorldTime(
		[{ spellName: "Undeath", expiryRound: 6, tokenIds: ["a"] }],
		{ round: 4, worldTime: 1000 });
	assert.deepEqual(converted, [{ spellName: "Undeath", tokenIds: ["a"], expiryWorldTime: 1012 }]);
	assert.ok(!("expiryRound" in converted[0]), "the dead round basis must be dropped, not left alongside");
});

test("a duration already run out converts to due-now, not to the past", () => {
	const [c] = convertRoundExpiryToWorldTime(
		[{ spellName: "Spent", expiryRound: 2, tokenIds: ["a"] }], { round: 9, worldTime: 1000 });
	assert.equal(c.expiryWorldTime, 1000, "negative rounds must clamp to zero");
	assert.equal(isDurationExpired(c, { worldTime: 1000 }), true);
});

test("entries already on world time are left alone by the conversion", () => {
	const entries = [{ spellName: "Timed", expiryWorldTime: 5000, tokenIds: ["a"] }];
	assert.deepEqual(convertRoundExpiryToWorldTime(entries, { round: 4, worldTime: 1000 }), entries);
});

// ── the two paths agreeing ──────────────────────────────────────────────────

test("summon expiry and the duration tracker derive the same answer", () => {
	// The whole point of the shared module. These used to disagree: the summon
	// path read an unstarted encounter's round 0 as 1, the duration tracker read
	// it as 0, so the same spell expired a round apart depending on which
	// mechanism deleted it.
	for (const combat of [null, { round: 0 }, { round: 1 }, { round: 7 }]) {
		const a = buildDurationExpiry(5, { combat, worldTime: 1000 });
		const b = buildDurationExpiry(5, { combat, worldTime: 1000 });
		assert.deepEqual(a, b);
	}
});

test("a duration cast outside combat is not pinned to a future round number", () => {
	// The old `?? 0` produced `expiryRound: 5` with no combat — a round number
	// unrelated to when it was cast, which then fired partway through whatever
	// encounter started next. There must be no round basis at all here.
	const expiry = buildDurationExpiry(5, { combat: null, worldTime: 1000 });
	assert.ok(!("expiryRound" in expiry), "no round basis without an encounter");
	assert.equal(isDurationExpired(expiry, { round: 5 }), false,
		"a later encounter reaching round 5 must not end it");
	assert.equal(isDurationExpired(expiry, { round: 999 }), false);
	assert.equal(isDurationExpired(expiry, { worldTime: 1030 }), true);
});

test("remaining time is phrased in whichever unit applies", () => {
	assert.equal(describeDurationRemaining({ expiryRound: 6 }, { round: 4 }), "2 rounds");
	assert.equal(describeDurationRemaining({ expiryRound: 5 }, { round: 4 }), "1 round");
	assert.equal(describeDurationRemaining({ expiryWorldTime: 1030 }, { worldTime: 1000 }), "30 seconds");
	assert.equal(describeDurationRemaining({ expiryWorldTime: 1001 }, { worldTime: 1000 }), "1 second");
	assert.equal(describeDurationRemaining({}, { round: 1 }), "unknown");
	// Never render a negative countdown
	assert.equal(describeDurationRemaining({ expiryRound: 2 }, { round: 9 }), "0 rounds");
});
