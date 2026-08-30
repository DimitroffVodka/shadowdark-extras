export const ANIMATION_DURATION_DEFAULTS_VERSION = 1;

function clone(value) {
	return JSON.parse(JSON.stringify(value ?? {}));
}

function legacyBundledDuration(preset) {
	const duration = Number(preset?.hit?.duration);
	return Number.isFinite(duration) ? duration : null;
}

/** Apply a positive explicit duration; zero means use the media's natural length. */
export function applyAnimationDuration(effect, duration) {
	const milliseconds = Number(duration);
	if (Number.isFinite(milliseconds) && milliseconds > 0) effect.duration(milliseconds);
	return effect;
}

/** Return a cloned preset library whose shipped entries use Auto duration. */
export function withNaturalDurations(presets) {
	const result = clone(presets);
	for (const preset of Object.values(result)) {
		if (preset?.hit) preset.hit.duration = 0;
		if (preset?.miss) preset.miss.duration = 0;
	}
	return result;
}

/**
 * Upgrade untouched bundled duration values to Auto without replacing custom
 * files or custom positive durations. The version lives inside the existing
 * world setting so the migration is idempotent.
 */
export function migrateLegacyAnimationDurations(storedConfig, bundledConfig) {
	const config = clone(storedConfig);
	if ((config._durationDefaultsVersion ?? 0) >= ANIMATION_DURATION_DEFAULTS_VERSION) {
		return { config, changed: false };
	}

	for (const category of ["spells", "weapons", "npcActions"]) {
		for (const [key, bundled] of Object.entries(bundledConfig?.[category] ?? {})) {
			const stored = config?.[category]?.[key];
			for (const outcome of ["hit", "miss"]) {
				if (!stored?.[outcome] || !bundled?.[outcome]) continue;
				if (stored[outcome].file !== bundled[outcome].file) continue;
				const legacyDuration = legacyBundledDuration({ hit: bundled[outcome] });
				if (Number(stored[outcome].duration) === legacyDuration) {
					stored[outcome].duration = 0;
				}
			}
		}
	}

	config._durationDefaultsVersion = ANIMATION_DURATION_DEFAULTS_VERSION;
	return { config, changed: true };
}
