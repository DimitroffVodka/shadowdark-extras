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

/**
 * When something should end, expressed in whichever clock is running.
 *
 * Combat is preferred when available because a round is the unit the duration is
 * written in; world time is the fallback, not the other way round.
 *
 * `combat.round` is `0` for an encounter that exists but has not begun, and
 * something cast then should last through round 1, so it reads as 1.
 *
 * @param {number} durationValue - duration in rounds
 * @param {{combat?: object|null, worldTime?: number}} context
 * @returns {{expiryRound: number}|{expiryWorldTime: number}}
 */
export function buildDurationExpiry(durationValue, { combat = null, worldTime = 0 } = {}) {
	if (combat) return { expiryRound: (combat.round || 1) + durationValue };
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
