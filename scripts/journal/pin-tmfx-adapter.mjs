// Foundry-document impersonation for journal pins — extracted from the
// JournalPinGraphics class in scripts/journal/pin-rendering.mjs
// (Phase 5.3.5 split).
//
// A journal pin is a bare PIXI container, but TokenMagic FX expects a Foundry
// placeable: something with a `document` exposing flag accessors, a stable id,
// and a set of _TMFX* hooks. Everything here exists to satisfy that third-party
// contract, which is why it is worth keeping apart from the drawing code — it
// changes for TokenMagic's reasons, not the pin's.
//
// TokenMagic is an optional dependency; the filter calls are inert without it.

import { JournalPinManager } from "./pin-manager.mjs";

export const PIN_PLACEABLE_TYPE = "JournalPin";

/**
 * Build the document wrapper TMFX reads.
 *
 * A getter rather than a stored object because PIXI already owns `parent` and
 * `name` on the container itself; wrapping avoids the collision.
 */
export function buildPinDocument(pin) {
	return {
		id: pin.pinData.id,
		documentName: PIN_PLACEABLE_TYPE,
		name: pin.pinData.label || "Journal Pin",
		parent: canvas.scene,
		getFlag: (s, k) => pin.getFlag(s, k),
		setFlag: (s, k, v) => pin.setFlag(s, k, v),
		unsetFlag: (s, k) => pin.unsetFlag(s, k),
		_TMFXsetFlag: f => pin._TMFXsetFlag(f),
		_TMFXunsetFlag: () => pin._TMFXunsetFlag(),
		_TMFXsetAnimeFlag: f => pin._TMFXsetAnimeFlag(f),
		_TMFXunsetAnimeFlag: () => pin._TMFXunsetAnimeFlag(),
		_TMFXgetPlaceableType: () => pin._TMFXgetPlaceableType(),
		_TMFXgetMaxFilterRank: () => pin._TMFXgetMaxFilterRank(),
		get object() {
			return this;
		},
	};
}

/** scope+key reads one flag, scope alone reads a whole namespace, neither reads all. */
export function getPinFlag(pin, scope, key) {
	const flags = pin.pinData.flags || {};
	if (scope && key) return foundry.utils.getProperty(flags, `${scope}.${key}`);
	if (scope) return flags[scope];
	return flags;
}

export async function setPinFlag(pin, scope, key, value) {
	const updateData = {};
	updateData[`flags.${scope}.${key}`] = value;
	return await JournalPinManager.update(pin.pinData.id, updateData);
}

export async function unsetPinFlag(pin, scope, key) {
	const updateData = {};
	// v14+: use ForcedDeletion sentinel instead of legacy "-=" deletion key syntax.
	updateData[`flags.${scope}.${key}`] = new foundry.data.operators.ForcedDeletion();
	return await JournalPinManager.update(pin.pinData.id, updateData);
}

/** Rank above every applied filter, or a high floor when none are applied. */
export function tmfxMaxFilterRank(pin) {
	const filters = pin.filters || [];
	if (filters.length === 0) return 10000;
	return Math.max(...filters.map(f => f.rank || 0)) + 1;
}

/** Mimics PlaceableObjectProto._TMFXsetRawFilters. */
export function tmfxSetRawFilters(pin, filters) {
	if (!pin.filters) pin.filters = [];
	// Simple append for now as TMFX usually manages the array
	if (filters === null) {
		pin.filters = null;
	}
	else if (Array.isArray(filters)) pin.filters = filters;
	else pin.filters.push(filters);
}

export async function tmfxAddFilters(pin, paramsArray, replace = false) {
	if (window.TokenMagic) await window.TokenMagic.addFilters(pin, paramsArray, replace);
}

export async function tmfxUpdateFilters(pin, paramsArray) {
	if (window.TokenMagic) await window.TokenMagic.updateFiltersByPlaceable(pin, paramsArray);
}

export async function tmfxDeleteFilters(pin, filterId = null) {
	if (window.TokenMagic) await window.TokenMagic.deleteFilters(pin, filterId);
}
