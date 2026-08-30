function finite(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function stable(value) {
	return Number(value.toFixed(6));
}

/** Stored sprite controls use CSS-style values: contrast 1 is neutral. */
export function toCssWeaponColorMatrix(colorMatrix = {}) {
	return {
		hue: finite(colorMatrix.hue, 0),
		brightness: finite(colorMatrix.brightness, 1),
		contrast: finite(colorMatrix.contrast, 1),
		saturate: stable(finite(colorMatrix.saturate, 0) + 1),
	};
}

/** Sequencer/PIXI ColorMatrix uses contrast 0 as neutral. */
export function toSequencerWeaponColorMatrix(colorMatrix = {}) {
	return {
		hue: finite(colorMatrix.hue, 0),
		brightness: finite(colorMatrix.brightness, 1),
		contrast: stable(finite(colorMatrix.contrast, 1) - 1),
		saturate: finite(colorMatrix.saturate, 0),
	};
}
