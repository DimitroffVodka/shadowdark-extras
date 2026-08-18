// Reading the configured summon profiles, whatever shape they were stored in.
//
// The item-sheet config persists them as a JSON string — a hidden input holding
// `JSON.stringify(profiles)`. Every consumer then guarded with
//
//     Array.isArray(config.profiles) ? … : (typeof config.profiles === "object" ? … : [])
//
// which is false for a string, so the guard yielded an empty list and the whole
// summoning block was skipped. Casting a correctly configured summon spell did
// nothing at all, silently: no error, no card, no creature. The spawn function
// downstream even parsed the string itself, so the intent was there — the gate
// in front of it just never let anything through.
//
// One reader, used by every consumer, so a fourth caller cannot reintroduce the
// same guard.

/**
 * The configured summon profiles as an array.
 *
 * Accepts the three shapes this config has been stored in: a JSON string (what
 * the item sheet writes), a plain array, or an object keyed by index (what
 * Foundry's form expansion can produce).
 *
 * @param {object|null} config - the `summoning` flag value
 * @returns {Array} profiles, empty when absent or unreadable
 */
export function readSummonProfiles(config) {
	const raw = config?.profiles;
	if (Array.isArray(raw)) return raw;

	if (typeof raw === "string") {
		const text = raw.trim();
		if (!text) return [];
		try {
			const parsed = JSON.parse(text);
			return Array.isArray(parsed) ? parsed : [];
		}
		catch(err) {
			// A corrupt string is not a reason to throw out of a chat-card render.
			console.warn("shadowdark-extras | Could not parse summon profiles:", err);
			return [];
		}
	}

	if (raw && typeof raw === "object") return Object.values(raw);
	return [];
}
