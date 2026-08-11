import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";

const {
	FEATURE_CATALOG,
	FEATURE_GROUPS,
	FEATURE_IDS,
	anyFeatureEnabled,
	applyFeatureGroupState,
	getFeatureState,
	getVisibleTrayModes,
	normalizeDisabledFeatureIds,
} = await import("../../scripts/settings/feature-gates.mjs");

const ALL_IDS = FEATURE_CATALOG.map(feature => feature.id);

function disabled(...ids) {
	return normalizeDisabledFeatureIds(ids);
}

test("the catalog has stable unique ids and every feature belongs to one group", () => {
	assert.equal(FEATURE_CATALOG.length, 81, "every normalized inventory feature needs one switch");
	assert.equal(new Set(ALL_IDS).size, ALL_IDS.length, "feature ids must be unique");

	const groups = new Set(FEATURE_GROUPS.map(group => group.id));
	for (const feature of FEATURE_CATALOG) {
		assert.match(feature.id, /^[a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/);
		assert.ok(groups.has(feature.group), `${feature.id} points at missing group ${feature.group}`);
		assert.ok(feature.name, `${feature.id} has no display name`);
		assert.ok(feature.description, `${feature.id} has no description`);
	}
});

test("the catalog covers both visible tray features and hidden runtime features", () => {
	for (const id of [
		FEATURE_IDS.TOM_SCENES,
		FEATURE_IDS.PARTY_MANAGEMENT,
		FEATURE_IDS.JOURNAL_PINS,
		FEATURE_IDS.HEX_PAINTER,
		FEATURE_IDS.DUNGEON_PAINTER,
		FEATURE_IDS.DAMAGE_CARDS,
		FEATURE_IDS.WEAPON_BONUSES,
		FEATURE_IDS.ITEM_MACROS,
		FEATURE_IDS.SOURCE_REQUIREMENTS,
	]) {
		assert.ok(ALL_IDS.includes(id), `missing required feature ${id}`);
	}
});

test("all features are enabled when the disabled setting is empty or malformed", () => {
	assert.equal(anyFeatureEnabled(FEATURE_IDS.TRAY), true);
	for (const value of [undefined, null, {}, "bad", []]) {
		for (const id of ALL_IDS) {
			assert.equal(getFeatureState(id, value).enabled, true, `${id} should default on`);
		}
	}
});

test("normalization drops unknown ids and duplicates while preserving catalog order", () => {
	const value = normalizeDisabledFeatureIds([
		FEATURE_IDS.HEX_PAINTER,
		"not.real",
		FEATURE_IDS.DAMAGE_CARDS,
		FEATURE_IDS.HEX_PAINTER,
	]);

	assert.deepEqual(value, ALL_IDS.filter(id => [FEATURE_IDS.HEX_PAINTER, FEATURE_IDS.DAMAGE_CARDS].includes(id)));
});

test("an explicitly disabled feature reports the direct reason", () => {
	const state = getFeatureState(FEATURE_IDS.DAMAGE_CARDS, disabled(FEATURE_IDS.DAMAGE_CARDS));

	assert.deepEqual(state, {
		enabled: false,
		reason: "disabled",
		blockedBy: null,
	});
});

test("dependencies disable children without rewriting the stored selection", () => {
	const stored = disabled(FEATURE_IDS.TOM_SCENES);
	const overlays = getFeatureState(FEATURE_IDS.TOM_VIDEO_OVERLAYS, stored);
	const playerView = getFeatureState(FEATURE_IDS.TOM_PLAYER_VIEW, stored);

	assert.deepEqual(overlays, {
		enabled: false,
		reason: "dependency",
		blockedBy: FEATURE_IDS.TOM_PLAYER_VIEW,
	});
	assert.equal(playerView.enabled, false);
	assert.deepEqual(stored, [FEATURE_IDS.TOM_SCENES], "dependency resolution must not mutate the setting");
});

test("group bulk actions change only features in that group", () => {
	const original = disabled(FEATURE_IDS.DAMAGE_CARDS);
	const off = applyFeatureGroupState(original, "animation", false);
	const animationIds = FEATURE_CATALOG.filter(feature => feature.group === "animation").map(feature => feature.id);

	assert.ok(off.includes(FEATURE_IDS.DAMAGE_CARDS), "unrelated disabled state must survive");
	assert.ok(animationIds.every(id => off.includes(id)), "disable all must disable every group member");

	const on = applyFeatureGroupState(off, "animation", true);
	assert.deepEqual(on, [FEATURE_IDS.DAMAGE_CARDS]);
});

test("tray mode availability follows role, permissions, ordinary settings, and feature gates", () => {
	const gm = getVisibleTrayModes({
		isGM: true,
		canPlayerPaint: false,
		showPartyTab: true,
		disabledFeatureIds: disabled(FEATURE_IDS.JOURNAL_PINS, FEATURE_IDS.HEX_PAINTER),
	});
	assert.ok(gm.includes("scenes"));
	assert.ok(gm.includes("party"));
	assert.ok(!gm.includes("pins"));
	assert.ok(!gm.includes("hexes"));
	assert.ok(gm.includes("dungeons"));

	const player = getVisibleTrayModes({
		isGM: false,
		canPlayerPaint: true,
		showPartyTab: false,
		disabledFeatureIds: disabled(FEATURE_IDS.PLACEABLE_NOTES, FEATURE_IDS.DUNGEON_PAINTER),
	});
	assert.deepEqual(player, ["player"]);
});

test("disabling ToM scenes removes the GM scenes mode but keeps a safe fallback", () => {
	const modes = getVisibleTrayModes({
		isGM: true,
		canPlayerPaint: false,
		showPartyTab: false,
		disabledFeatureIds: disabled(
			FEATURE_IDS.TOM_SCENES,
			FEATURE_IDS.JOURNAL_PINS,
			FEATURE_IDS.PLACEABLE_NOTES,
			FEATURE_IDS.HEX_PAINTER,
			FEATURE_IDS.DUNGEON_PAINTER,
			FEATURE_IDS.DECOR_PAINTER,
		),
	});

	assert.deepEqual(modes, ["player"], "the tray must never be stranded on a disabled mode");
});
