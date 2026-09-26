// Carousing rules from the Western Reaches GM Guide and Cursed Scroll 6
// (#151): a settlement's carousing limit, Enhancer's holidays, no
// overlap with an Enhancer downtime session, and the two-week warning.
//
// Shadowdark Enhancer supplies the rules data and the holiday calendar. Every
// call to it sits behind a feature check, the way carousing-renown.mjs hands
// renown to it: without Enhancer, limits come from this module's own settings,
// there are no holidays, and nothing else changes. Foundry globals are read
// through `globalThis` at call time, so the pure half runs under node:test.

import { getHexRecordMap } from "../../hex/hex-water-terrain.mjs";

const MODULE_ID = "shadowdark-extras";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Settlement kinds, as Enhancer names them on hex-record features. */
export const SETTLEMENT_KINDS = ["village", "town", "city", "city_state"];

/** GMWR p.34: carouse at most once every two weeks of real time. */
const CAROUSING_COOLDOWN_DAYS = 14;

/** The world settings that hold this module's own limits, by kind. */
const LIMIT_SETTINGS = {
	village: "carousingLimitVillage",
	town: "carousingLimitTown",
	city: "carousingLimitCity",
	city_state: "carousingLimitCityState",
};

/** Shadowdark Enhancer's API, or null when it is not installed and active. */
export function getEnhancer() {
	const g = globalThis.game;
	return g?.modules?.get("shadowdark-enhancer")?.active ? g.shadowdarkEnhancer ?? null : null;
}

/**
 * The settlement a hex record holds: the first feature whose type is a
 * settlement kind. `place` is what Enhancer's holidays.today() takes: the
 * `settlement-<num>` id Enhancer sends, else the settlement's name.
 * @returns {{kind: string, name: string, place: string|null}|null}
 */
export function settlementOf(record) {
	for (const feature of Array.isArray(record?.features) ? record.features : []) {
		const kind = String(feature?.type ?? "").toLowerCase();
		if (!SETTLEMENT_KINDS.includes(kind)) continue;
		const name = String(feature.name || record.name || "");
		const id = String(feature.id ?? "");
		return { kind, name, place: /^settlement-\d+$/.test(id) ? id : (name || null) };
	}
	return null;
}

/**
 * The most a carousing event may cost in a settlement of this kind, in gp.
 * Enhancer's table answers first. Its `null` means "not set up", so this
 * module's own table answers instead; `Infinity` means no limit. An empty
 * local value is no limit too, and so is "none" (not in a settlement).
 * @param {string} kind
 * @param {{enhancer?: object|null, fallback?: Object<string, number|null>}} sources
 * @returns {number}
 */
export function carousingLimit(kind, { enhancer = null, fallback = {} } = {}) {
	if (!SETTLEMENT_KINDS.includes(kind)) return Infinity;
	if (typeof enhancer?.rules?.carousingLimit === "function") {
		try {
			const limit = enhancer.rules.carousingLimit(kind);
			if (typeof limit === "number" && limit >= 0) return limit;
		}
		catch(err) {
			console.warn(`${MODULE_ID} | carousing: Enhancer's carousingLimit failed`, err);
		}
	}
	const local = fallback?.[kind];
	return typeof local === "number" && Number.isFinite(local) && local >= 0 ? local : Infinity;
}

/** True when a tier costs more than the limit, so it is not offered. */
export function tierOverLimit(tier, limit) {
	return (Number(tier?.cost) || 0) > limit;
}

/**
 * What a holiday does to one character's carouse, given the GM's garb answers
 * for that character (garb key → true for "yes").
 *
 * Every "yes" adds its garb modifier to the event roll. A `required` garb
 * answered "no" keeps the character out, so the holiday does nothing for them.
 * `notes` are the ones a "yes" posts, as Enhancer supplies them.
 * @returns {{admitted: boolean, eventBonus: number, benefitBonus: number,
 *   benefitAdvantage: boolean, extraBenefit: boolean, extraMishap: boolean,
 *   chances: object[], notes: string[]}|null} null when there is no holiday
 */
export function holidayEffects(holiday, answers = {}) {
	if (!holiday) return null;
	const garb = Array.isArray(holiday.garb) ? holiday.garb : [];
	const yes = garb.filter(question => answers?.[question.key] === true);
	const admitted = garb.every(question => !question.required || answers?.[question.key] === true);
	const carousing = holiday.carousing ?? {};
	if (!admitted) {
		return {
			admitted, eventBonus: 0, benefitBonus: 0, benefitAdvantage: false,
			extraBenefit: false, extraMishap: false, chances: [], notes: [],
		};
	}
	return {
		admitted,
		eventBonus: (Number(carousing.eventBonus) || 0)
			+ yes.reduce((sum, question) => sum + (Number(question.modifier) || 0), 0),
		benefitBonus: Number(carousing.benefitBonus) || 0,
		benefitAdvantage: carousing.benefitAdvantage === true,
		extraBenefit: carousing.extraBenefit === true,
		extraMishap: carousing.extraMishap === true,
		chances: Array.isArray(carousing.chances) ? carousing.chances : [],
		notes: yes.map(question => question.note).filter(Boolean),
	};
}

/**
 * The d100 formula for an Expanded benefit or mishap roll. A holiday touches
 * benefit rolls only: advantage (roll two, keep the higher) and a flat bonus.
 * @param {"benefit"|"mishap"} type
 * @param {string} [extra] the GM's per-character modifier for this table
 * @param {object|null} [effects] holidayEffects() for this character
 */
export function d100Formula(type, extra = "", effects = null) {
	const holiday = type === "benefit" && effects?.admitted ? effects : null;
	const parts = [holiday?.benefitAdvantage ? "2d100kh" : "1d100"];
	if (extra) parts.push(extra);
	if (holiday?.benefitBonus) parts.push(String(holiday.benefitBonus));
	return parts.join(" + ");
}

/**
 * Whether an Enhancer downtime session is open. Uses `downtime.isOpen()` once
 * Enhancer has it (#198); until then the documented `sessionState().active`.
 */
export async function downtimeOpen(enhancer) {
	const downtime = enhancer?.downtime;
	try {
		if (typeof downtime?.isOpen === "function") return !!(await downtime.isOpen());
		if (typeof downtime?.sessionState === "function") return !!downtime.sessionState()?.active;
	}
	catch(err) {
		console.warn(`${MODULE_ID} | carousing: could not read Enhancer's downtime session`, err);
	}
	return false;
}

/**
 * Which of `actorIds` caroused less than `days` real days before `now`.
 * @param {{actorIds: string[], at: number}[]} entries one per logged session
 * @param {string[]} actorIds
 * @returns {{actorId: string, daysAgo: number}[]} in `actorIds` order
 */
export function recentCarousers(
	entries, actorIds, now = Date.now(), days = CAROUSING_COOLDOWN_DAYS
) {
	const last = new Map();
	for (const { actorIds: ids = [], at } of entries ?? []) {
		if (!Number.isFinite(at) || now - at >= days * DAY_MS) continue;
		for (const id of ids) last.set(id, Math.max(last.get(id) ?? -Infinity, at));
	}
	return (actorIds ?? []).filter(id => last.has(id)).map(id => ({
		actorId: id, daysAgo: Math.max(0, Math.floor((now - last.get(id)) / DAY_MS)),
	}));
}

/**
 * SEAM — carousing duration (#151, item 3). Not built yet.
 *
 * A carouse takes days equal to its event bonus, minimum 1 (GMWR p.34), and
 * resolving it should move the world clock that far: through Enhancer's
 * `time.advanceOffDuty(seconds, { reason: "carousing" })` when it exists,
 * else `game.time.advance`. That waits on Enhancer's Overland time API
 * (Enhancer #198, draft PR #222). Called once a carouse's rolls are saved.
 * @param {{bonus?: number}} tier the tier that was caroused
 */
export async function passCarousingTime(tier) {}

// ── Foundry-bound ───────────────────────────────────────────────────────────

/** A holiday's carousing mechanics, one localised line each. */
export function holidayLines(holiday) {
	const i18n = globalThis.game.i18n;
	const key = name => `SHADOWDARK_EXTRAS.carousing.holiday_${name}`;
	const carousing = holiday?.carousing ?? {};
	const lines = [];
	const bonus = Number(carousing.eventBonus) || 0;
	if (bonus) {
		lines.push(i18n.format(key("event_bonus"), { bonus: bonus > 0 ? `+${bonus}` : bonus }));
	}
	if (carousing.benefitBonus) {
		lines.push(i18n.format(key("benefit_bonus"), { bonus: carousing.benefitBonus }));
	}
	if (carousing.benefitAdvantage) lines.push(i18n.localize(key("benefit_advantage")));
	if (carousing.extraBenefit) lines.push(i18n.localize(key("extra_benefit")));
	if (carousing.extraMishap) lines.push(i18n.localize(key("extra_mishap")));
	for (const chance of carousing.chances ?? []) {
		lines.push(i18n.format(key("chance"), { n: chance.oneIn, label: chance.label }));
	}
	return lines;
}

/** This module's own limits, from its world settings (null = no limit). */
function localLimits() {
	const out = {};
	for (const [kind, key] of Object.entries(LIMIT_SETTINGS)) {
		try {
			out[kind] = globalThis.game.settings.get(MODULE_ID, key);
		}
		catch{
			out[kind] = null;
		}
	}
	return out;
}

/**
 * The hex under the party token, on the scene the user is viewing, else on
 * the active scene (only hex scenes have hex records): a key naming that hex,
 * and the settlement its record holds.
 * @returns {{key: string, settlement: object|null}|null}
 */
function partyHex() {
	const scenes = new Set([globalThis.canvas?.scene, globalThis.game?.scenes?.active]);
	for (const scene of scenes) {
		if (!scene?.grid?.isHexagonal) continue;
		const token = scene.tokens?.find(
			t => t.actor?.type === "NPC" && t.actor.getFlag?.(MODULE_ID, "isParty") === true
		);
		if (!token) continue;
		const { i, j } = scene.grid.getOffset(token.getCenterPoint());
		const hexKey = `${i}_${j}`;
		return {
			key: `${scene.id}/${hexKey}`,
			settlement: settlementOf(getHexRecordMap(scene.id).get(hexKey)),
		};
	}
	return null;
}

/**
 * The last holiday lookup: {key, holiday, holidaysImported}. The overlay
 * renders on every session change on every client, and Enhancer's lookup
 * reads a compendium, so it is asked again only when the party's hex, its
 * settlement or the world's day changes, or the window is reopened.
 */
let holidayCache = null;

/** Forget the cached holiday lookup (the carousing window calls it on open). */
export function clearCarousingPlaceCache() {
	holidayCache = null;
}

/** Today's holiday at a place, and whether Enhancer has any holidays imported. */
async function lookupHoliday(holidays, place) {
	try {
		const holiday = (await holidays.today({ place }))?.[0] ?? null;
		const holidaysImported = !holiday && typeof holidays.list === "function"
			? (await holidays.list()).length > 0
			: null;
		return { holiday, holidaysImported };
	}
	catch(err) {
		console.warn(`${MODULE_ID} | carousing: could not read Enhancer's holidays`, err);
		return { holiday: null, holidaysImported: null };
	}
}

/**
 * Where the party is carousing and what that means: the settlement kind (the
 * GM's choice, else the party hex's), its limit, and today's holiday there.
 * `holidaysImported` is false only when Enhancer has the holidays API but the
 * GM has not imported the holiday journal, so the window can say so.
 */
export async function resolveCarousingPlace(session) {
	const enhancer = getEnhancer();
	const hex = partyHex();
	const fromMap = hex?.settlement ?? null;
	const chosen = SETTLEMENT_KINDS.includes(session?.settlement) || session?.settlement === "none"
		? session.settlement : null;
	const kind = chosen ?? fromMap?.kind ?? "none";
	const limit = carousingLimit(kind, { enhancer, fallback: localLimits() });

	let holiday = null;
	let holidaysImported = null;
	const holidays = enhancer?.holidays;
	if (fromMap?.place && typeof holidays?.today === "function") {
		const date = globalThis.game?.time?.components;
		const key = `${hex.key}|${fromMap.place}|${date?.year}:${date?.day}`;
		if (holidayCache?.key !== key) {
			holidayCache = { key, ...(await lookupHoliday(holidays, fromMap.place)) };
		}
		({ holiday, holidaysImported } = holidayCache);
	}
	return { kind, chosen: chosen !== null, fromMap, limit, holiday, holidaysImported };
}
