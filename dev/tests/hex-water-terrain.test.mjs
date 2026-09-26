// What counts as a body of water, across all three writers of the `terrain`
// field. Three modules used to each keep their own guess at the label set and
// two of them went stale; this pins the vocabulary in one place instead.

import assert from "node:assert/strict";
import test from "node:test";

import { isWaterTerrain } from "../../scripts/hex/hex-water-terrain.mjs";

test("every shape the three terrain writers produce reads as water", () => {
	for (const label of [
		// The painter, from the assets/Hexes folder names.
		"Water", "Water-arctic", "Water-lake", "Water-river",
		// HexGeneratorSD and SoloHexMode.
		"Ocean",
		// Shadowdark Enhancer's hand-off, via its terrainWord(): lowercased,
		// underscores turned into spaces. "arctic sea" is the one an anchored
		// match missed.
		"arctic sea", "ocean", "lake", "river",
	]) {
		assert.equal(isWaterTerrain(label), true, `${label} should be water`);
	}
});

test("land terrain is not water, and a shore is not the thing it is beside", () => {
	for (const label of [
		"Vegetation", "Mountains", "Mountain", "Desert", "Swamp", "Swamps",
		"Badlands", "Snow", "Specials", "Plains", "Forest", "Jungle",
		"volcano", "lava", "salt flat",
		// A coast hex is land on a shore, so a river reaching one has not yet
		// reached the sea. Enhancer's COASTAL_WATER excludes it for the same
		// reason.
		"coast",
		// Substrings must not count: only whole words do.
		"Riverbank Forest", "Lakeside Hills", "Seashell Downs",
		"", null, undefined,
	]) {
		assert.equal(isWaterTerrain(label), false, `${label} should not be water`);
	}
});

test("isArcticTerrain: the painter's folder word and the hand-off's two words, whole-word only", async () => {
	const { isArcticTerrain } = await import("../../scripts/hex/hex-water-terrain.mjs");
	for (const label of ["Water-arctic", "arctic sea", "Arctic Sea", "ARCTIC"]) assert.equal(isArcticTerrain(label), true, label);
	for (const label of ["ocean", "Water-lake", "antarctica", "", undefined]) assert.equal(isArcticTerrain(label), false, String(label));
});
