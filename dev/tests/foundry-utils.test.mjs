// Unit tests for the foundry-utils test harness — issue #95 finding 5.
//
// The harness mergeObject diverged from Foundry v14 in three ways no caller had
// hit yet (P3, latent): it did not expand dotted keys at depth 0, it conflated
// `insertKeys` with the nested `insertValues`, and it threw on options Foundry
// actually supports. A harness whose whole contract is faithfulness cannot wait
// for a caller to trip over a divergence — these tests pin the behaviours so
// the stand-in cannot drift again.

import assert from "node:assert/strict";
import test from "node:test";

import { deepClone, expandObject, mergeObject, ForcedDeletion, ForcedReplacement } from "./helpers/foundry-utils.mjs";

// --- dotted-key expansion at depth 0 -----------------------------------------

test("a dotted key in other expands to nested structure before merging", () => {
	const merged = mergeObject({ a: 1 }, { "b.c": 2 });

	assert.deepEqual(merged, { a: 1, b: { c: 2 } });
});

test("a dotted key also present literally in original is expanded on both sides", () => {
	// Foundry v14 expands `other` whenever it carries any dotted key AND
	// expands `original` when it does too, so a literal "b.c" meets a nested
	// "b.c" — the literal key is not kept alongside the nested one.
	const merged = mergeObject({ "b.c": "literal" }, { "b.c": "new", d: 1 });

	assert.deepEqual(merged, { b: { c: "new" }, d: 1 });
});

test("an already-present nested key is merged, not replaced, through an expanded dotted key", () => {
	const merged = mergeObject({ b: { c: 1, keep: true } }, { "b.c": 9 });

	assert.deepEqual(merged, { b: { c: 9, keep: true } });
});

test("expansion is unconditional — there is no expand option in Foundry v14", () => {
	// `{ expand: false }` is an option Foundry does not know, so it is ignored
	// exactly as Foundry ignores unknown options; the dotted key still expands.
	const merged = mergeObject({}, { "a.b": 1 }, { expand: false });

	assert.deepEqual(merged, { a: { b: 1 } });
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

// --- supported options: enforceTypes, applyOperators, performDeletions --------

test("enforceTypes throws on a mismatched-type overwrite", () => {
	assert.throws(
		() => mergeObject({ k: "string" }, { k: 5 }, { enforceTypes: true }),
		/Mismatched data types encountered during object merge/,
	);
});

test("enforceTypes is quiet when the types agree", () => {
	const merged = mergeObject({ k: "before" }, { k: "after" }, { enforceTypes: true });

	assert.deepEqual(merged, { k: "after" });
});

test("performDeletions (deprecated) deletes a legacy -= key, matching v14", () => {
	const merged = mergeObject({ keep: 1, gone: 2 }, { "-=gone": null }, { performDeletions: true });

	assert.deepEqual(merged, { keep: 1 });
});

test("a Date is 'Unknown' like Foundry — recursion into an existing Date is preserved", () => {
	// Foundry's typePrototypes (foundry.mjs:2298-2304) does not list Date, so
	// getType(Date) is "Unknown" and the recursive merge treats it as
	// object-like: it recurses INTO the existing Date rather than replacing it.
	const original = { d: new Date(0) };
	mergeObject(original, { d: { x: 1 } });

	assert.ok(original.d instanceof Date, "the Date instance is retained");
	assert.equal(original.d.x, 1, "the new key is merged into the Date");
});

test("applyOperators applies a ForcedDeletion value", () => {
	const merged = mergeObject(
		{ keep: 1, gone: 2 },
		{ gone: new ForcedDeletion() },
		{ applyOperators: true },
	);

	assert.deepEqual(merged, { keep: 1 });
});

test("applyOperators unwraps a ForcedReplacement to its payload", () => {
	const merged = mergeObject(
		{ nested: { a: 1, keep: true } },
		{ nested: ForcedReplacement.create({ a: 9 }) },
		{ applyOperators: true },
	);

	assert.deepEqual(merged, { nested: { a: 9 } });
});

test("a legacy ==key is applied as a forced replacement", () => {
	const merged = mergeObject(
		{ nested: { a: 1, keep: true } },
		{ "==nested": { a: 9 } },
		{ applyOperators: true },
	);

	assert.deepEqual(merged, { nested: { a: 9 } });
});

test("unknown options are ignored, exactly as Foundry ignores them", () => {
	// Foundry destructures its known options and never inspects the rest.
	const merged = mergeObject({ a: 1 }, { b: 2 }, { someUnknownOption: true });

	assert.deepEqual(merged, { a: 1, b: 2 });
});

// --- regression guards on existing behaviour ---------------------------------

test("recursive merge still keeps sibling keys (the pin-manager guarantee)", () => {
	const merged = mergeObject(
		{ flags: { "shadowdark-extras": { keep: 1, edit: "before" } } },
		{ flags: { "shadowdark-extras": { edit: "after" } } },
	);

	assert.deepEqual(merged.flags["shadowdark-extras"], { keep: 1, edit: "after" });
});

// --- expandObject remains the explicit, recursive path -----------------------

test("expandObject and the merge-time expansion agree on the same input", () => {
	const viaHelper = expandObject({ "a.b": 1 });
	const viaMerge = mergeObject({}, { "a.b": 1 });

	assert.deepEqual(viaMerge, viaHelper);
	assert.deepEqual(viaHelper, { a: { b: 1 } });
	assert.equal(deepClone(viaHelper).constructor, Object);
});
