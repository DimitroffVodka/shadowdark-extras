// TokenMagic filter leaf — extracted from
// scripts/effects/AuraEffectsSD.mjs (Phase 5.3 lane-C split).
// Every function PRESERVES the optional-module guard: when the
// tokenmagic module is absent/inactive the helpers no-op (no-module
// behavior unchanged). Imports geometry for the keep-filter decision.

import { MODULE_ID } from "./aura-constants.mjs";
import { getActiveAuras, isTokenInAura, checkDisposition, checkAuraVisibility } from "./aura-geometry.mjs";

/**
 * Apply TokenMagic filter to a token when entering an aura
 * @param {Token} token - The token to apply filter to
 * @param {string} presetName - The TokenMagic preset name
 * @param {string} auraEffectId - The aura effect ID for tracking
 */
export async function applyTokenMagicFilter(token, presetName, auraEffectId) {

	if (!presetName) {
		return;
	}
	if (!game.modules.get("tokenmagic")?.active) {
		return;
	}

	try {
		const preset = getTokenMagicMainPresetParams(presetName);
		if (!(Array.isArray(preset) && preset.length)) {
			console.warn(`shadowdark-extras | TokenMagic preset '${presetName}' not found`);
			return;
		}

		// Create a unique filter ID for this aura so we can remove it later
		const filterId = `sdx-aura-${auraEffectId}`;
		await removeAllSdxAuraTokenMagicFilters(token);

		// Clone the preset and add our custom filter ID
		const params = preset.map((p, index) => {
			const originalFilterId = p.filterId || p.filterType || index;
			return {
				...p,
				filterId: `${filterId}-${originalFilterId}`,
			};
		});

		await TokenMagic.addUpdateFilters(token, params);
	}
	catch(e) {
		console.error("shadowdark-extras | Error applying TokenMagic filter:", e);
	}
}

export function getTokenMagicMainPresetParams(presetName) {
	const name = String(presetName || "");
	if (!name) return null;

	try {
		const presets = game.settings.get("tokenmagic", "presets") || [];
		const match = Array.isArray(presets)
			? presets.find(p => p?.name === name && p?.library === "tmfx-main")
			: null;
		if (Array.isArray(match?.params)) return foundry.utils.deepClone(match.params);
	}
	catch(e) {
		// Fall through to the public list fallback.
	}

	try {
		const presets = TokenMagic.getPresets?.("tmfx-main") || [];
		const match = Array.isArray(presets) ? presets.find(p => p?.name === name) : null;
		if (Array.isArray(match?.params)) return foundry.utils.deepClone(match.params);
	}
	catch(e) {
		// No usable TokenMagic preset source.
	}

	return null;
}

export function getTokenMagicFilterIds(token) {
	const flags = token.document?.getFlag?.("tokenmagic", "filters") || [];
	if (!Array.isArray(flags)) return [];

	return flags
		.flatMap(flag => [
			flag?.tmFilters?.tmFilterId,
			flag?.tmFilterId,
			flag?.filterId,
			flag?.id,
		])
		.filter(id => typeof id === "string");
}

export async function removeAllSdxAuraTokenMagicFilters(token) {
	if (!game.modules.get("tokenmagic")?.active) return;

	const filterIds = getTokenMagicFilterIds(token)
		.filter(id => id.startsWith("sdx-aura-"));

	for (const id of filterIds) {
		await TokenMagic.deleteFilters(token, id);
	}
}

/**
 * Remove TokenMagic filter from a token when leaving an aura
 * @param {Token} token - The token to remove filter from
 * @param {string} auraEffectId - The aura effect ID for tracking
 */
export async function removeTokenMagicFilter(token, auraEffectId) {

	if (!game.modules.get("tokenmagic")?.active) {
		return;
	}

	try {
		const filterId = `sdx-aura-${auraEffectId}`;

		const filterIds = getTokenMagicFilterIds(token)
			.filter(id => id.startsWith(filterId));

		for (const id of filterIds) {
			await TokenMagic.deleteFilters(token, id);
		}
	}
	catch(e) {
		console.error("shadowdark-extras | Error removing TokenMagic filter:", e);
	}
}

export function shouldKeepAnySdxAuraTokenMagicFilter(token, removedAuraEffect) {
	try {
		for (const { effect, token: sourceToken, config } of getActiveAuras()) {
			if (!effect || effect.id === removedAuraEffect?.id) continue;
			if (!config?.tokenFilters?.enabled) continue;
			if (sourceToken.id === token.id && !config.includeSelf) continue;
			if (!checkDisposition(sourceToken, token, config.disposition)) continue;
			if (config.checkVisibility && !checkAuraVisibility(sourceToken, token)) continue;
			if (isTokenInAura(sourceToken, token, config.radius || 30)) return true;
		}
	}
	catch(err) {
		console.warn("shadowdark-extras | Could not check remaining aura filters:", err);
	}
	return false;
}

export async function getCurrentAuraTokenFilters(sourceToken, config, auraEffect) {
	const snapshot = config?.tokenFilters
		|| auraEffect?.flags?.[MODULE_ID]?.aura?.tokenFilters
		|| {};
	const region = getAuraRegionForEffect(auraEffect);
	const regionFilters = region?.flags?.[MODULE_ID]?.tokenFilters || null;
	const usesNativeRegion = (config?.nativeRegion || auraEffect?.flags?.[MODULE_ID]?.aura
		?.nativeRegion)?.enabled !== false;
	const selected = regionFilters?.enabled && regionFilters?.preset
		? regionFilters
		: (usesNativeRegion ? {} : snapshot);

	console.log("shadowdark-extras | aura token filter debug", {
		sourceToken: sourceToken?.name,
		auraEffectId: auraEffect?.id,
		auraEffectName: auraEffect?.name,
		regionId: auraEffect?.flags?.[MODULE_ID]?.aura?.regionId,
		regionName: region?.name,
		regionSdxFlags: region?.flags?.[MODULE_ID],
		usesNativeRegion,
		hasRegion: !!region,
		regionTokenFilters: regionFilters,
		effectTokenFilters: auraEffect?.flags?.[MODULE_ID]?.aura?.tokenFilters,
		runtimeTokenFilters: config?.tokenFilters,
		selectedTokenFilters: selected,
	});

	return selected || {};
}

export function getAuraRegionForEffect(auraEffect) {
	const scene = canvas?.scene;
	const auraConfig = auraEffect?.flags?.[MODULE_ID]?.aura;
	if (!scene || !auraConfig) return null;

	const regions = [...(scene.regions || [])];
	const regionId = auraConfig.regionId;
	const region = (regionId ? regions.find(r => r.id === regionId) : null)
		|| regions.find(r =>
			r.flags?.[MODULE_ID]?.auraRegion
			&& r.flags?.[MODULE_ID]?.auraEffectId === auraEffect.id
		);

	return region || null;
}
