// The five hex-map effect toggles — water, wind, fog, biome tint and black &
// white — and the flags behind them. Extracted verbatim from
// scripts/hex/HexPainterSD.mjs (Phase 5.3 sweep 6 split).
//
// Imports nothing at all, let alone from the painter: the painter imports these
// names back under the same identifiers, and a leaf module is what keeps the
// extraction provable (read-only ESM bindings forbid cross-module assignment).

// State
export let _waterEffect = false;
export let _windEffect = false;
export let _fogAnimation = false;
export let _tintEnabled = false;
export let _bwEffect = false;

export function toggleWaterEffect() {
	_waterEffect = !_waterEffect;
}

export function isWaterEffect() {
	return _waterEffect;
}

export function toggleWindEffect() {
	_windEffect = !_windEffect;
}

export function isWindEffect() {
	return _windEffect;
}

export function toggleFogAnimation() {
	_fogAnimation = !_fogAnimation;
}

export function isFogAnimation() {
	return _fogAnimation;
}

export function toggleTintEnabled() {
	_tintEnabled = !_tintEnabled;
}

export function isTintEnabled() {
	return _tintEnabled;
}

export function toggleBwEffect() {
	_bwEffect = !_bwEffect;
}

export function isBwEffect() {
	return _bwEffect;
}
