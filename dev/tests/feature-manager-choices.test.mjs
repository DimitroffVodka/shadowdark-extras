import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import "./helpers/foundry-loader.mjs";

const {
	FEATURE_CATALOG,
	FEATURE_IDS,
} = await import("../../scripts/settings/feature-gates.mjs");
const {
	VISIBLE_FEATURE_CHOICES,
	VISIBLE_FEATURE_GROUPS,
	applyVisibleFeatureChoiceState,
	applyVisibleFeatureGroupState,
	getAdvancedFeatureGroups,
	getVisibleFeatureChoiceState,
	getVisibleFeatureMemberIds,
} = await import("../../scripts/settings/feature-manager-choices.mjs");

const ROOT = new URL("../../", import.meta.url);
const choice = id => VISIBLE_FEATURE_CHOICES.find(entry => entry.id === id);

test("the visible manager exposes one master plus 18 recognizable SDX Tray features", () => {
	assert.equal(VISIBLE_FEATURE_CHOICES.length, 19);
	assert.deepEqual(VISIBLE_FEATURE_GROUPS.map(group => group.name), ["SDX Tray Tabs", "SDX Tray Tools"]);
	assert.deepEqual(VISIBLE_FEATURE_CHOICES.map(entry => entry.name), [
		"SDX Tray",
		"Scenes",
		"Party",
		"Pins",
		"Notes",
		"Hexes",
		"Dungeons",
		"Decor",
		"Marching Mode",
		"Formation Spawner",
		"Light Source Tracker",
		"Carousing",
		"Drawing Tools",
		"Map Generators",
		"Toggle Coordinates",
		"Hex Tooltip / Hexplorer",
		"Hex Fog",
		"Solo Hex Mode",
		"SDX Roller",
	]);
});

test("Scenes is one visible choice controlling the complete Theatre of the Mind runtime", () => {
	assert.deepEqual(choice("scenes").members, [
		FEATURE_IDS.TOM_SCENES,
		FEATURE_IDS.TOM_VIDEO_OVERLAYS,
		FEATURE_IDS.TOM_SCENE_EDITOR,
		FEATURE_IDS.TOM_PLAYER_VIEW,
		FEATURE_IDS.TOM_SCENE_NAVIGATION,
	]);

	const unrelated = FEATURE_IDS.DAMAGE_CARDS;
	const disabled = applyVisibleFeatureChoiceState([unrelated], "scenes", false);
	assert.ok(choice("scenes").members.every(id => disabled.includes(id)));
	assert.ok(disabled.includes(unrelated), "bundling Scenes must preserve unrelated state");

	const enabled = applyVisibleFeatureChoiceState(disabled, "scenes", true);
	assert.deepEqual(enabled, [unrelated]);
});

test("visible choices partition their runtime members without duplicate ownership", () => {
	const members = VISIBLE_FEATURE_CHOICES.flatMap(entry => entry.members);
	assert.equal(new Set(members).size, members.length, "one runtime gate cannot belong to two visible cards");
	assert.deepEqual(getVisibleFeatureMemberIds(), members);
	assert.deepEqual(choice("dungeons").members, [FEATURE_IDS.DUNGEON_PAINTER, FEATURE_IDS.TILE_FLATTEN]);
});

test("visible and advanced controls still cover the complete runtime catalog", () => {
	const visible = new Set(getVisibleFeatureMemberIds());
	const advanced = getAdvancedFeatureGroups().flatMap(group => group.features.map(feature => feature.id));
	const allManaged = [...visible, ...advanced];

	assert.equal(new Set(allManaged).size, FEATURE_CATALOG.length);
	assert.deepEqual(new Set(allManaged), new Set(FEATURE_CATALOG.map(feature => feature.id)));
});

test("a partially stored bundle is surfaced without flattening its state", () => {
	const state = getVisibleFeatureChoiceState("scenes", [FEATURE_IDS.TOM_VIDEO_OVERLAYS]);
	assert.deepEqual(state, {
		checked: false,
		partial: true,
		blocked: false,
		blockedBy: null,
	});
});

test("dependency-blocked visible choices remain directly selected", () => {
	const state = getVisibleFeatureChoiceState("decor", [FEATURE_IDS.HEX_PAINTER]);
	assert.deepEqual(state, {
		checked: true,
		partial: false,
		blocked: true,
		blockedBy: FEATURE_IDS.HEX_PAINTER,
	});
});

test("visible group bulk actions affect only that visual group", () => {
	const original = [FEATURE_IDS.DAMAGE_CARDS];
	const disabled = applyVisibleFeatureGroupState(original, "tabs", false);
	const tabMembers = VISIBLE_FEATURE_CHOICES.filter(entry => entry.group === "tabs").flatMap(entry => entry.members);
	const toolMembers = VISIBLE_FEATURE_CHOICES.filter(entry => entry.group === "tools").flatMap(entry => entry.members);

	assert.ok(tabMembers.every(id => disabled.includes(id)));
	assert.ok(toolMembers.every(id => !disabled.includes(id)));
	assert.ok(disabled.includes(FEATURE_IDS.DAMAGE_CARDS));
});

test("every visible choice has a shipped WebP preview", async () => {
	for (const entry of VISIBLE_FEATURE_CHOICES) {
		assert.match(entry.preview, /^modules\/shadowdark-extras\/assets\/feature-manager\/[a-z0-9-]+\.webp$/);
		const relative = entry.preview.replace("modules/shadowdark-extras/", "");
		await access(new URL(relative, ROOT));
	}
});
