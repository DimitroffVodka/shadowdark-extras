import assert from "node:assert/strict";
import test from "node:test";
import { passCarousingTime } from "../../scripts/party/carousing/carousing-rules.mjs";

const DAY = 86400;

function world(t, { active = false, time, isGM = true } = {}) {
	const original = globalThis.game;
	const advances = [];
	globalThis.game = {
		user: { isGM },
		modules: new Map([["shadowdark-enhancer", { active }]]),
		shadowdarkEnhancer: { time },
		time: {
			async advance(seconds) { advances.push(seconds); return 100 + seconds; },
		},
	};
	t.after(() => { globalThis.game = original; });
	return advances;
}

test("carousing advances once by the tier bonus in days without Enhancer", async t => {
	const advances = world(t);
	await passCarousingTime({ bonus: 3 });
	assert.deepEqual(advances, [3 * DAY]);
});

test("the holiday's event bonus extends the outing, with a one-day minimum", async t => {
	const advances = world(t);
	await passCarousingTime({ bonus: 3 }, { carousing: { eventBonus: 1 } });
	await passCarousingTime({ bonus: 0 }, { carousing: { eventBonus: -2 } });
	assert.deepEqual(advances, [4 * DAY, DAY]);
});

test("carousing lasts at least one day, including missing or invalid tier bonuses", async t => {
	const advances = world(t);
	for (const bonus of [0, -2, undefined, NaN, Infinity, "bad"]) {
		await passCarousingTime({ bonus });
	}
	await passCarousingTime();
	assert.deepEqual(advances, Array(7).fill(DAY));
});

test("an active Enhancer gets the seconds and carousing reason, and is awaited", async t => {
	let release;
	const pending = new Promise(resolve => { release = resolve; });
	const calls = [];
	const time = {
		async advanceOffDuty(...args) {
			assert.equal(this, time);
			calls.push(args);
			return pending;
		},
	};
	const advances = world(t, { active: true, time });
	let finished = false;
	const move = passCarousingTime({ bonus: 3 }).then(result => { finished = true; return result; });
	await Promise.resolve();
	assert.equal(finished, false);
	assert.deepEqual(calls, [[3 * DAY, { reason: "carousing" }]]);
	const result = { ok: true, worldTime: 3 * DAY, doused: [{ actorId: "pc", itemId: "torch" }] };
	release(result);
	assert.equal(await move, result);
	assert.deepEqual(advances, []);
});

test("an Enhancer refusal never falls back to a destructive plain clock move", async t => {
	const refusal = { ok: false, error: "Two primary GMs", doused: [] };
	const advances = world(t, { active: true, time: { advanceOffDuty: async () => refusal } });
	assert.equal(await passCarousingTime({ bonus: 3 }), refusal);
	assert.deepEqual(advances, []);
});

test("a thrown Enhancer error never falls back or retries", async t => {
	let calls = 0;
	const advances = world(t, {
		active: true,
		time: { advanceOffDuty: async () => { calls++; throw new Error("connection lost"); } },
	});
	await assert.rejects(passCarousingTime({ bonus: 3 }), /connection lost/);
	assert.equal(calls, 1);
	assert.deepEqual(advances, []);
});

test("older Enhancer without the time feature uses the plain clock", async t => {
	const advances = world(t, { active: true, time: {} });
	await passCarousingTime({ bonus: 2 });
	assert.deepEqual(advances, [2 * DAY]);
});

test("an inactive Enhancer API is not called", async t => {
	const advances = world(t, {
		time: { advanceOffDuty: () => assert.fail("inactive Enhancer must not be called") },
	});
	await passCarousingTime({ bonus: 2 });
	assert.deepEqual(advances, [2 * DAY]);
});

test("a player cannot move either clock", async t => {
	const advances = world(t, {
		isGM: false, active: true,
		time: { advanceOffDuty: () => assert.fail("player must not call off-duty time") },
	});
	await passCarousingTime({ bonus: 3 });
	globalThis.game.modules.get("shadowdark-enhancer").active = false;
	await passCarousingTime({ bonus: 3 });
	assert.deepEqual(advances, []);
});
