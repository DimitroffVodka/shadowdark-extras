// Unit tests for the foundry-utils test harness — issue #95 finding 5.
//
// The harness mergeObject diverged from Foundry's in two ways no caller had
// hit yet (P3, latent): it did not expand dotted keys at depth 0, and it
// conflated `insertKeys` with the nested `insertValues`. A harness whose whole
// contract is faithfulness cannot wait for a caller to trip over a divergence —
// these tests pin the two behaviours so the stand-in cannot drift again.

import assert from "node:assert/strict";
import test from "node:test";

import { deepClone, expandObject, mergeObject } from "./helpers/foundry-utils.mjs";

// --- dotted-key expansion at depth 0 -----------------------------------------

test("a dotted key in other expands to nested structure before merging", () => {
	const merged = mergeObject({ a: 1 }, { "b.c": 2 });

	assert.deepEqual(merged, { a: 1, b: { c: 2 } });
});

test("a dotted key already present literally in original is NOT expanded", () => {
	// Foundry keeps the literal key in that case — the dotted form names an
	// actual key, not a path to be split apart.
	const merged = mergeObject({ "b.c": "literal" }, { "b.c": "new", d: 1 });

	assert.deepEqual(merged, { "b.c": "new", d: 1 });
});

test("an already-present nested key is merged, not replaced, through an expanded dotted key", () => {
	const merged = mergeObject({ b: { c: 1, keep: true } }, { "b.c": 9 });

	assert.deepEqual(merged, { b: { c: 9, keep: true } });
});

test("expansion is disabled by the expand option, matching Foundry", () => {
	const merged = mergeObject({}, { "a.b": 1 }, { expand: false });

	assert.deepEqual(merged, { "a.b": 1 });
});

// --- insertKeys vs insertValues ----------------------------------------------

test("insertKeys: false blocks inserting whole new keys at this level", () => {
	const merged = mergeObject({ keep: 1 }, { keep: 2, fresh: 3 }, { insertKeys: false });

	assert.deepEqual(merged, { keep: 2 });
});

test("insertValues: false blocks inserting new keys into an existing nested object", () => {
	// `nested.a` exists, so the recursion happens; `nested.b` is a NEW key
	// inside that existing object, governed by insertValues.
	const merged = mergeObject(
		{ nested: { a: 1 } },
		{ nested: { a: 2, b: 3 } },
		{ insertValues: false },
	);

	assert.deepEqual(merged, { nested: { a: 2 } });
});

test("insertValues: false still allows a whole new top-level object", () => {
	// A key absent from original is inserted under insertKeys, even when
	// insertValues is false — the two options govern different depths.
	const merged = mergeObject({}, { fresh: { x: 1 } }, { insertValues: false });

	assert.deepEqual(merged, { fresh: { x: 1 } });
});

// --- regression guards on existing behaviour ---------------------------------

test("recursive merge still keeps sibling keys (the pin-manager guarantee)", () => {
	const merged = mergeObject(
		{ flags: { "shadowdark-extras": { keep: 1, edit: "before" } } },
		{ flags: { "shadowdark-extras": { edit: "after" } } },
	);

	assert.deepEqual(merged.flags["shadowdark-extras"], { keep: 1, edit: "after" });
});

test("an unimplemented option still throws rather than being ignored", () => {
	assert.throws(
		() => mergeObject({}, { a: 1 }, { performDeletions: true }),
		/does not implement performDeletions/,
	);
});

// --- expandObject remains the explicit, recursive path -----------------------

test("expandObject and the merge-time expansion agree on the same input", () => {
	const viaHelper = expandObject({ "a.b": 1 });
	const viaMerge = mergeObject({}, { "a.b": 1 });

	assert.deepEqual(viaMerge, viaHelper);
	assert.deepEqual(viaHelper, { a: { b: 1 } });
	assert.equal(deepClone(viaHelper).constructor, Object);
});
