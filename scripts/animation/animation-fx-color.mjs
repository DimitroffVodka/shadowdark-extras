/** Convert a Sequencer database path segment into a readable label. */
function labelForColor(color) {
	return String(color ?? "")
		.replace(/[_-]+/g, " ")
		.replace(/\b\w/g, letter => letter.toUpperCase());
}

/**
 * Discover native color siblings for a Sequencer database entry.
 *
 * Sequencer resolves a partial path to a concrete file wrapper whose `dbPath`
 * ends in the installed color. Looking one level above that concrete path gives
 * the actual color choices available in the active JB2A database.
 */
export function resolveNativeColorVariants(file, database) {
	if (!file || file.includes("/") || !file.includes(".")) return [];
	if (
		typeof database?.getEntry !== "function"
		|| typeof database?.getPathsUnder !== "function"
	) return [];

	try {
		const resolvedPath = database.getEntry(file)?.dbPath;
		if (!resolvedPath || !resolvedPath.includes(".")) return [];
		const parts = resolvedPath.split(".");
		const parent = parts.slice(0, -1).join(".");
		if (!parent) return [];

		const children = database.getPathsUnder(parent) ?? [];
		return children
			.filter(color => color && color !== "_markers")
			.map(color => ({
				color,
				label: labelForColor(color),
				path: `${parent}.${color}`,
				current: `${parent}.${color}` === resolvedPath,
			}))
			.filter(option => typeof database.entryExists !== "function" || database.entryExists(option.path))
			.sort((a, b) => a.label.localeCompare(b.label));
	}
	catch(e) {
		return [];
	}
}

/** Apply optional attack-FX tinting to a Sequencer effect builder. */
export function applyAttackFxTint(effect, preset) {
	const tint = preset?.tint;
	if (!tint?.enabled || !effect) return effect;
	effect.tint(tint.color || "#ffffff");
	effect.filter("ColorMatrix", {
		contrast: Number(tint.contrast) || 0,
		saturate: Number(tint.saturation) || 0,
	});
	return effect;
}
