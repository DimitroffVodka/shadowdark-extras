// Which clock a spell duration is measured against.
//
// Durations are written in rounds, but rounds are only counted while an
// encounter is running. Held against rounds alone, anything cast outside combat
// either never expires or expires against a round number that means nothing —
// and anything still running when the encounter ends waits on a counter that
// will never advance again.
//
// So a duration answers to whichever clock is actually running: rounds during an
// encounter, world time otherwise, at this world's own seconds-per-round. World
// time is the basis focus spells, auras and camping already use.
//
// This lives in shared/ because both the summon-expiry path (scripts/combat) and
// the duration-spell tracker (scripts/effects) need it, and combat already
// imports from effects — putting it either side would close a cycle.

/** Seconds in one combat round, as this world defines it. */
export function secondsPerRound() {
	return CONFIG?.time?.roundTime || 6;
}

function finiteNumber(value) {
	if (value === null || value === undefined || value === "") return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

/**
 * Translate Shadowdark's legacy effect duration fields to Foundry v14 data.
 * Combat durations expire at the casting combatant's turn start. Capturing
 * the current combatant gives every target in one application the same clock.
 * Outside an encounter, rounds/turns become seconds because Shadowdark sets
 * both core combat time constants to zero.
 */
export function buildActiveEffectTiming(duration = {}, {
	combat = null, worldTime = 0, castTiming = null,
} = {}) {
	let value = null;
	let units = null;

	for (const [legacyField, legacyUnits] of [
		["seconds", "seconds"],
		["turns", "turns"],
		["rounds", "rounds"],
	]) {
		const legacyValue = finiteNumber(duration?.[legacyField]);
		if (legacyValue === null) continue;
		value = legacyValue;
		units = legacyUnits;
		break;
	}

	if (value === null) {
		value = finiteNumber(duration?.value);
		units = typeof duration?.units === "string" ? duration.units : null;
	}
	if (value === null || !units) return null;

	// Late targets inherit the cast's clock, never the encounter they enter in.
	const inCombat = castTiming ? !!castTiming.start?.combat
		: !!combat && (combat.started ?? (Number(combat.round) > 0));
	if (!inCombat && (units === "rounds" || units === "turns")) {
		const unitSeconds = units === "turns"
			? (CONFIG?.time?.turnTime || secondsPerRound())
			: secondsPerRound();
		value *= unitSeconds;
		units = "seconds";
	}

	const startTime = finiteNumber(duration?.startTime) ?? finiteNumber(worldTime) ?? 0;
	const start = castTiming ? { ...castTiming.start } : { time: startTime };
	if (inCombat && !castTiming) {
		start.combat = combat.id;
		start.combatant = combat.combatant?.id ?? null;
		start.initiative = finiteNumber(combat.combatant?.initiative);
		start.round = finiteNumber(duration?.startRound) ?? combat.round;
		start.turn = finiteNumber(duration?.startTurn) ?? combat.turn;
	}

	const combatUnits = units === "rounds" || units === "turns";
	return {
		duration: {
			value,
			units,
			expiry: combatUnits ? (duration?.expiry || "turnStart") : null,
		},
		start,
	};
}

/**
 * Apply timing to each nested effect. castTiming pins the start without changing
 * the effect's length; explicit null means a legacy cast has no recoverable start.
 */
export function applyEffectItemTiming(effectItemData, durationOverride = {}, context = {}) {
	for (const effect of effectItemData?.effects ?? []) {
		if (context.castTiming === null) {
			effect.start = null; // Keep registry expiry authoritative; never restart a legacy cast.
			continue;
		}
		const timing = buildActiveEffectTiming({
			...(effect.duration ?? {}),
			...durationOverride,
		}, context) ?? context.castTiming;
		if (timing) Object.assign(effect, {
			duration: { ...timing.duration },
			start: { ...timing.start },
		});
	}
	return effectItemData;
}

/** Prefer the cast snapshot; recover legacy anchors from an already-linked effect. */
export function getDurationSpellCastTiming(entry) {
	if (entry?.effectTiming) return entry.effectTiming;
	const effect = getDurationSpellActiveEffect(entry);
	if (!effect) return null; // No recorded start: leave the legacy expiry fallback in charge.
	return buildActiveEffectTiming({
		value: entry.durationValue ?? effect.duration.value,
		units: entry.durationType ?? effect.duration.units,
	}, { castTiming: effect.toObject?.() ?? effect });
}

/** Resolve token documents off-canvas; a known scene must never fall back to another. */
export function getDurationToken(tokenId, sceneId) {
	return sceneId ? globalThis.game?.scenes?.get(sceneId)?.tokens?.get(tokenId)
		: globalThis.canvas?.tokens?.get(tokenId);
}

/** Prefer a running linked effect; an elapsed sibling must not hide it. */
export function getDurationSpellActiveEffect(durationEntry) {
	function isCoreTracked(effect) {
		if (!effect?.start || !Number.isFinite(effect?.duration?.remaining)) return false;
		const combatUnits = effect.duration.units === "rounds" || effect.duration.units === "turns";
		if (!combatUnits) return Number.isFinite(effect.start.time);
		// Core accepts a missing expiry event and checks it at every combat event.
		// An explicit turn event, however, needs both documents to identify that turn.
		return !effect.duration.expiry || (!!effect.start.combat && !!effect.start.combatant);
	}

	let elapsed = null;
	for (const link of durationEntry?.targetEffects ?? []) {
		const tokenActor = link.targetTokenId
			? getDurationToken(link.targetTokenId, durationEntry.sceneId)?.actor
			: null;
		const actor = tokenActor || globalThis.game?.actors?.get(link.targetActorId);
		if (!actor) continue;

		const directEffect = actor.effects?.get?.(link.effectItemId);
		const effectItem = actor.items?.get?.(link.effectItemId);
		const effects = effectItem?.effects?.contents ?? effectItem?.effects ?? [];
		for (const effect of [directEffect, ...effects]) {
			if (!isCoreTracked(effect)) continue;
			if (!effect.duration.expired && effect.duration.remaining > 0) return effect;
			elapsed ??= effect;
		}
	}
	return elapsed;
}

/**
 * When something should end, expressed in whichever clock is running.
 *
 * Combat is preferred when available because a round is the unit the duration is
 * written in; world time is the fallback, not the other way round.
 *
 * An unstarted encounter has no running round clock, just like no encounter.
 *
 * @param {number} durationValue - duration in rounds
 * @param {{combat?: object|null, worldTime?: number}} context
 * @returns {{expiryRound: number}|{expiryWorldTime: number}}
 */
export function buildDurationExpiry(durationValue, { combat = null, worldTime = 0 } = {}) {
	if (combat && (combat.started ?? (Number(combat.round) > 0))) {
		return { expiryRound: combat.round + durationValue };
	}
	return { expiryWorldTime: worldTime + (durationValue * secondsPerRound()) };
}

/**
 * Whether an entry is due, judged against whichever clock just moved.
 *
 * An entry answers to one basis only: a round-based entry ignores world time
 * ticking past, and a world-time entry ignores rounds. Anything else would let
 * one clock end something the other has not reached.
 *
 * @param {object} entry - carries `expiryRound` or `expiryWorldTime`
 * @param {{round?: number|null, worldTime?: number|null}} now
 * @returns {boolean}
 */
export function isDurationExpired(entry, { round = null, worldTime = null } = {}) {
	if (!entry) return false;
	if (Number.isFinite(entry.expiryRound)) {
		return Number.isFinite(round) && round >= entry.expiryRound;
	}
	if (Number.isFinite(entry.expiryWorldTime)) {
		return Number.isFinite(worldTime) && worldTime >= entry.expiryWorldTime;
	}
	return false;
}

/** Split a list into what is due now and what still stands. */
export function partitionExpiredDurations(entries, now) {
	const expired = [];
	const remaining = [];
	for (const entry of entries ?? []) {
		(isDurationExpired(entry, now) ? expired : remaining).push(entry);
	}
	return { expired, remaining };
}

/**
 * Re-base round entries onto world time, for when the encounter they were
 * counting goes away.
 *
 * The rounds still owed are converted at this world's seconds-per-round, so
 * something with two rounds left keeps two rounds' worth of time rather than
 * expiring instantly or never.
 *
 * @param {Array} entries
 * @param {{round?: number, worldTime?: number}} context
 * @returns {Array} entries with any round basis replaced by a world-time one
 */
export function convertRoundExpiryToWorldTime(entries, { round = 0, worldTime = 0 } = {}) {
	return (entries ?? []).map(entry => {
		if (!Number.isFinite(entry?.expiryRound)) return entry;
		const roundsLeft = Math.max(0, entry.expiryRound - round);
		const rest = { ...entry };
		delete rest.expiryRound;
		return { ...rest, expiryWorldTime: worldTime + (roundsLeft * secondsPerRound()) };
	});
}

/**
 * How much is left, phrased for a reader, in whichever unit applies.
 * @param {object} entry
 * @param {{round?: number|null, worldTime?: number|null}} now
 * @returns {string}
 */
export function describeDurationRemaining(entry, { round = null, worldTime = null } = {}) {
	const coreDuration = entry?.duration;
	if (coreDuration?.label && coreDuration.label !== "None") return coreDuration.label;

	if (Number.isFinite(entry?.expiryRound) && Number.isFinite(round)) {
		const rounds = Math.max(0, entry.expiryRound - round);
		return `${rounds} round${rounds !== 1 ? "s" : ""}`;
	}
	if (Number.isFinite(entry?.expiryWorldTime) && Number.isFinite(worldTime)) {
		const seconds = Math.max(0, entry.expiryWorldTime - worldTime);
		return `${seconds} second${seconds !== 1 ? "s" : ""}`;
	}
	return "unknown";
}
