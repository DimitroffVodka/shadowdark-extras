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

function readDuration(data) {
	if (!data) return null;
	const value = data.value === null || data.value === undefined || data.value === ""
		? null
		: Number(data.value);
	const units = data.units ?? data.type;
	if (
		value !== null && Number.isFinite(value) && value >= 0
		&& ["seconds", "minutes", "hours", "days", "weeks", "years", "turns", "rounds"].includes(units)
	) {
		return { value, units };
	}
	for (const units of ["seconds", "turns", "rounds"]) {
		if (data[units] === null || data[units] === undefined || data[units] === "") continue;
		const legacyValue = Number(data[units]);
		if (Number.isFinite(legacyValue) && legacyValue >= 0) return { value: legacyValue, units };
	}
	return null;
}

/**
 * Convert SD's legacy duration override into one Foundry v14 duration and start.
 * Combat durations expire at turn start, matching SDX auras. Outside combat,
 * rounds/turns become seconds because Shadowdark sets both core time scales to 0.
 */
export function buildActiveEffectTiming(overrides = {}, source = {}, {
	combat = null, worldTime = 0,
} = {}) {
	const overrideDuration = readDuration(overrides);
	const selected = overrideDuration ?? readDuration(source);
	if (!selected) return null;

	const originalUnits = selected.units;
	let { value, units } = selected;
	const inCombat = !!combat;
	if (!inCombat && units === "rounds") {
		value *= secondsPerRound();
		units = "seconds";
	}
	else if (!inCombat && units === "turns") {
		value = Math.ceil(value / 10) * secondsPerRound();
		units = "seconds";
	}

	const expirySource = overrideDuration ? overrides : source;
	const expiry = expirySource.expiry
		?? (["rounds", "turns"].includes(originalUnits) ? "turnStart" : null);
	const hasStartTime = overrides.startTime !== null && overrides.startTime !== undefined
		&& overrides.startTime !== "" && Number.isFinite(Number(overrides.startTime));
	const time = hasStartTime ? Number(overrides.startTime) : worldTime;
	const start = inCombat
		? {
			time,
			combat: combat.id,
			combatant: combat.combatant?.id ?? null,
			initiative: combat.combatant?.initiative ?? null,
			round: overrides.startRound !== null && overrides.startRound !== undefined
				&& overrides.startRound !== "" && Number.isFinite(Number(overrides.startRound))
				? Number(overrides.startRound) : combat.round,
			turn: overrides.startTurn !== null && overrides.startTurn !== undefined
				&& overrides.startTurn !== "" && Number.isFinite(Number(overrides.startTurn))
				? Number(overrides.startTurn) : combat.turn,
		}
		: { time };

	return { duration: { value, units, expiry, expired: false }, start };
}

function resolveLinkedEffects(targetEffect) {
	const tokenActor = globalThis.canvas?.tokens?.get?.(targetEffect.targetTokenId)?.actor;
	const actor = tokenActor ?? globalThis.game?.actors?.get?.(targetEffect.targetActorId);
	if (!actor) return { effects: [], item: null };
	const directEffect = actor.effects?.get?.(targetEffect.effectItemId);
	if (directEffect) return { effects: [directEffect], item: null };
	const item = actor.items?.get?.(targetEffect.effectItemId);
	return { effects: [...(item?.effects?.contents ?? item?.effects ?? [])], item };
}

/** Resolve the first live Active Effect linked to a tracked duration spell. */
export function getLinkedDurationEffect(entry) {
	for (const targetEffect of entry?.targetEffects ?? []) {
		const { effects } = resolveLinkedEffects(targetEffect);
		const effect = effects.find(candidate => candidate.transfer) ?? effects[0];
		if (effect) return effect;
	}
	return null;
}

/** Whether a linked Effect Item has a registry-trackable core expiry clock. */
export function hasLinkedDurationClock(entry) {
	return (entry?.targetEffects ?? []).some(targetEffect => {
		const { effects, item } = resolveLinkedEffects(targetEffect);
		if (!item) return false; // Auras keep their existing lifecycle.
		return effects.some(effect => effect.duration?.expired === true
			|| (effect.active !== false && effect.isExpiryTrackable !== false
				&& effect.start?.time != null && Number.isFinite(effect.duration?.remaining)));
	});
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
	const activeEffect = getLinkedDurationEffect(entry);
	activeEffect?.updateDuration?.();
	const activeEffectDuration = activeEffect?.duration;
	if (Number.isFinite(activeEffectDuration?.remaining)
		&& typeof activeEffectDuration.label === "string" && activeEffectDuration.label) {
		return activeEffectDuration.label;
	}
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
