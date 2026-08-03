// Aura membership / dedupe state leaf — extracted from
// scripts/effects/AuraEffectsSD.mjs (Phase 5.3 lane-C split).
// Shared mutable Sets/Maps + the helpers that read/write them, so the
// movement cluster (main) and the application cluster (aura-application)
// both see the SAME state objects (mirrors focus-constants.mjs).
// Leaf: imports only aura-constants.

import { MODULE_ID } from "./aura-constants.mjs";

// Track tokens currently inside each logical aura to avoid repeated enter triggers.
const _auraInsideState = new Set();

// Track aura membership even when a save prevents configured effects from being applied.
const _auraMembership = new Set();

// Suppress duplicate aura trigger bursts from repeated movement/update hooks.
const _recentAuraTriggers = new Map();
const AURA_TRIGGER_DEDUPE_MS = 1000;


export function shouldSuppressDuplicateAuraTrigger(auraEffect, targetToken, trigger) {
	const key = `${auraEffect?.id || "aura"}:${targetToken?.id || "token"}:${trigger}`;
	const now = Date.now();
	const last = _recentAuraTriggers.get(key) || 0;
	if (now - last < AURA_TRIGGER_DEDUPE_MS) return true;

	_recentAuraTriggers.set(key, now);

	for (const [storedKey, storedAt] of _recentAuraTriggers.entries()) {
		if (now - storedAt > AURA_TRIGGER_DEDUPE_MS * 5) _recentAuraTriggers.delete(storedKey);
	}

	return false;
}

export function getAuraInsideStateKey(sourceToken, targetToken, config, auraEffect) {
	const logicalAuraId = config?.spellId || auraEffect?.origin || auraEffect?.id || "aura";
	return `${sourceToken?.id || "source"}:${logicalAuraId}:${targetToken?.id || "target"}`;
}

export function hasAuraAppliedToToken(auraEffect, token, insideStateKey = null) {
	const actor = token?.actor;
	if (!actor) return false;

	if (insideStateKey && _auraMembership.has(insideStateKey)) return true;

	const hasEffectItem = actor.items.some(i =>
		i.type === "Effect"
        && i.flags?.[MODULE_ID]?.auraOrigin === auraEffect.id
	);
	if (hasEffectItem) return true;

	return actor.effects.some(e =>
		e.flags?.[MODULE_ID]?.auraOrigin === auraEffect.id
	);
}

export function clearAuraMembershipForToken(auraEffect, token) {
	const auraConfig = auraEffect?.flags?.[MODULE_ID]?.aura || {};
	const logicalAuraId = auraConfig.spellId || auraEffect?.origin || auraEffect?.id || "aura";
	const suffix = `:${logicalAuraId}:${token?.id || "target"}`;

	for (const key of [..._auraInsideState]) {
		if (key.endsWith(suffix)) _auraInsideState.delete(key);
	}

	for (const key of [..._auraMembership]) {
		if (key.endsWith(suffix)) _auraMembership.delete(key);
	}
}

export { _auraInsideState, _auraMembership, _recentAuraTriggers, AURA_TRIGGER_DEDUPE_MS };
