import assert from "node:assert/strict";
import test from "node:test";
import { escapeHTML } from "./helpers/escape-html.mjs";

globalThis.CONST = { TABLE_RESULT_TYPES: {}, USER_ROLES: {}, DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 }, JOURNAL_ENTRY_PAGE_FORMATS: { HTML: 1 } };
const { captureCarousingActors, canRedoCarousing, restoreCarousingActors, finishCarousingOuting } = await import("../../scripts/party/carousing/carousing-outing.mjs");
const MOD = "shadowdark-extras";
class ForcedDeletion {}
function fixture(t, advance = async seconds => seconds) {
	const originals = Object.fromEntries(["game", "foundry", "ui", "Handlebars", "JournalEntryPage"].map(k => [k, globalThis[k]]));
	t.after(() => Object.assign(globalThis, originals));
	const warnings = [], pages = [], writes = [];
	const actor = {
		id: "pc", name: "PC", system: { level: { xp: 2 }, renown: 1, notes: "Earlier notes", coins: { gp: 20 } },
		async update(changes) {
			for (const [key, value] of Object.entries(changes)) {
				const parts = key.split(".");
				let obj = this;
				for (const part of parts.slice(0, -1)) obj = obj[part];
				obj[parts.at(-1)] = value;
			}
		},
	};
	const sync = { id: "sync", name: "__sdx_carousing_sync__", getFlag: (scope, key) => key === "isCarousingLog" ? false : {}, async update() {}, async setFlag(scope, key, value) { writes.push(structuredClone(value)); } };
	const log = { id: "log", getFlag: (scope, key) => key === "isCarousingLog", pages: { find: fn => pages.find(fn) } };
	globalThis.game = {
		user: { isGM: true }, modules: new Map(),
		actors: new Map([[actor.id, actor]]),
		journal: { get: () => null, find: fn => [sync, log].find(fn) },
		time: { advance }, settings: { get: () => true },
		i18n: { localize: k => k, format: (k, args) => `${k}:${JSON.stringify(args)}` },
	};
	let id = 0;
	globalThis.foundry = { utils: { randomID: () => `outing-${++id}`, escapeHTML }, data: { operators: { ForcedDeletion } } };
	globalThis.ui = { notifications: { warn: m => warnings.push(m) } };
	globalThis.Handlebars = { Utils: { escapeExpression: escapeHTML } };
	globalThis.JournalEntryPage = { async create(data) {
		const page = { ...data, getFlag: (scope, key) => data.flags[scope][key], async update(changes) { Object.assign(this, changes); } };
		pages.push(page); return page;
	} };
	const participants = [{ participantId: "actor-pc", droppedActor: actor }];
	const before = captureCarousingActors(participants);
	const session = { phase: "complete", results: { "actor-pc": { roll: 4 } }, outing: { mode: "original", before } };
	return { actor, participants, session, warnings, pages, writes };
}

test("receipt records holiday duration; redo updates the same log without moving time", async t => {
	const advances = [];
	const f = fixture(t, async seconds => { advances.push(seconds); return seconds; });
	const tier = { bonus: 3, cost: 10 };
	await finishCarousingOuting(f.session, tier, { carousing: { eventBonus: 1 } }, f.participants, false);
	assert.deepEqual(advances, [345600]);
	assert.equal(f.session.logMeta.time.status, "advanced");
	assert.equal(f.session.logMeta.time.days, 4);
	assert.equal(f.session.phase, "complete");
	assert.equal(canRedoCarousing(f.session, f.participants, "original"), true);
	const logId = f.session.logId;
	await finishCarousingOuting(f.session, tier, null, f.participants, true);
	assert.equal(f.session.logId, logId);
	assert.equal(f.pages.length, 1);
	assert.equal(f.session.logMeta.redos, 1);
	assert.deepEqual(advances, [345600]);
	assert.match(f.pages[0]["text.content"], /log_time/);
	assert.match(f.pages[0]["text.content"], /log_redos/);
});

test("a plain clock rejection leaves completed results and an unconfirmed receipt", async t => {
	const f = fixture(t, async () => { throw Error("offline"); });
	t.mock.method(console, "warn", () => {});
	await finishCarousingOuting(f.session, { bonus: 3, cost: 0 }, null, f.participants, false);
	assert.equal(f.session.phase, "complete");
	assert.equal(f.session.logMeta.time.status, "unconfirmed");
	assert.equal(f.session.results["actor-pc"].roll, 4);
	assert.equal(f.warnings.length, 1);
	assert.equal(f.writes.at(-1).phase, "complete");
});

test("Enhancer refusal records doused lights without falling back", async t => {
	const f = fixture(t, async () => assert.fail("no fallback"));
	game.modules.set("shadowdark-enhancer", { active: true });
	game.shadowdarkEnhancer = { time: { advanceOffDuty: async () => ({ ok: false, doused: [{}] }) } };
	await finishCarousingOuting(f.session, { bonus: 2, cost: 0 }, null, f.participants, false);
	assert.deepEqual(f.session.logMeta.time, { days: 2, status: "unconfirmed", doused: 1 });
});

test("redo restores automatic XP, renown and notes but not payment", async t => {
	const f = fixture(t);
	f.session.outing.mode = "expanded";
	f.session.logId = "same-outing";
	Object.assign(f.actor.system, { level: { xp: 5 }, renown: 3, notes: "Earlier notes + outing", coins: { gp: 10 } });
	f.session.outing.after = captureCarousingActors(f.participants);
	assert.equal(await restoreCarousingActors(f.session, f.participants), true);
	assert.deepEqual(f.actor.system, { level: { xp: 2 }, renown: 1, notes: "Earlier notes", coins: { gp: 10 } });
});

test("redo refuses later edits, changed participants, applied outcomes and old sessions", async t => {
	const f = fixture(t);
	f.session.logId = "same-outing";
	f.session.outing.after = captureCarousingActors(f.participants);
	assert.equal(canRedoCarousing(f.session, f.participants, "original"), true);
	assert.equal(canRedoCarousing(f.session, [], "original"), false);
	assert.equal(canRedoCarousing(f.session, f.participants, "expanded"), false);
	f.actor.system.notes += " later";
	assert.equal(await restoreCarousingActors(f.session, f.participants), false);
	f.actor.system.notes = "Earlier notes";
	f.session.results["actor-pc"].applied = { at: 1 };
	assert.equal(canRedoCarousing(f.session, f.participants, "original"), false);
	assert.equal(canRedoCarousing({ phase: "complete" }, f.participants, "original"), false);
});
