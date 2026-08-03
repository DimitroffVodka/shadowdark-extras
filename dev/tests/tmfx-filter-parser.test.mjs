import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { parseTMFXFilterParams } from "../../scripts/animation/tmfx-filter-parser.mjs";

// ---------------------------------------------------------------------------
// Real TokenMagic 0.8.4 corpus (GPL module — read-only probe, not vendored).
// The shipped default-preset library is the compatibility authority: 76 params
// arrays, 79 hexadecimal color literals, 93 filter entries, trailing commas
// throughout, and one expression-bearing array (-0.6 * Math.PI) that a safe
// parser MUST reject. The path resolves from TMFX_PRESETS_PATH, else the known
// installed Foundry data directories; the corpus tests skip cleanly when the
// module is not installed so the suite stays portable.
// ---------------------------------------------------------------------------
const CORPUS_CANDIDATES = [
	process.env.TMFX_PRESETS_PATH,
	"/home/patricks/FoundryV14/Data/modules/tokenmagic/fx/presets/defaultpresets.js",
	"/home/patricks/.cache/sdx63-r1-proof/Data/modules/tokenmagic/fx/presets/defaultpresets.js",
	"/home/patricks/.cache/sdx63-r2-proof/Data/modules/tokenmagic/fx/presets/defaultpresets.js",
	"/tmp/sdx-phase53-r2-live/proof-root/Data/modules/tokenmagic/fx/presets/defaultpresets.js",
	"/tmp/sdx-phase5-sweep2-r1/proof-root/Data/modules/tokenmagic/fx/presets/defaultpresets.js",
].filter(Boolean).find((candidate) => candidate && existsSync(candidate));

/** Extract every `params = [...]` array literal from the corpus source. */
function extractParamsArrays(source) {
	const arrays = [];
	const pattern = /params\s*=\s*\[/g;
	let match;
	while ((match = pattern.exec(source)) !== null) {
		let depth = 0;
		let quote = null;
		let escaped = false;
		let end = -1;
		for (let index = pattern.lastIndex - 1; index < source.length; index += 1) {
			const char = source[index];
			if (quote) {
				if (escaped) escaped = false;
				else if (char === "\\") escaped = true;
				else if (char === quote) quote = null;
				continue;
			}
			if (char === '"' || char === "'") {
				quote = char;
				continue;
			}
			if (char === "[") depth += 1;
			else if (char === "]") {
				depth -= 1;
				if (depth === 0) {
					end = index + 1;
					break;
				}
			}
		}
		if (end < 0) throw new Error("unclosed params array in corpus");
		arrays.push(source.slice(pattern.lastIndex - 1, end));
		pattern.lastIndex = end;
	}
	return arrays;
}

test("parses TokenMagic JSON-like filter objects", () => {
	assert.deepEqual(
		parseTMFXFilterParams('new Macro([{ "filterId": "glow", filterType: "glow", enabled: true, values: [1, 2] }]);'),
		[{ filterId: "glow", filterType: "glow", enabled: true, values: [1, 2] }],
	);
});

test("accepts single-quoted strings but does not resolve identifiers", () => {
	assert.deepEqual(parseTMFXFilterParams("([{filterId: 'blur', filterType: 'blur', amount: null}])"), [
		{ filterId: "blur", filterType: "blur", amount: null },
	]);
	assert.throws(() => parseTMFXFilterParams("([{filterId: getSecret(), filterType: 'blur'}])"), /unsupported identifier/);
});

test("rejects malformed and prototype-polluting input", () => {
	assert.throws(() => parseTMFXFilterParams("([{filterId: 'blur', filterType: 'blur'})"), /not closed/);
	assert.throws(() => parseTMFXFilterParams("([{__proto__: {polluted: true}, filterType: 'blur'}])"), /invalid object key/);
	assert.throws(() => parseTMFXFilterParams("([{prototype: {polluted: true}, filterType: 'blur'}])"), /invalid object key/);
	assert.throws(() => parseTMFXFilterParams("([{constructor: {polluted: true}, filterType: 'blur'}])"), /invalid object key/);
	assert.deepEqual(parseTMFXFilterParams("([{filterId: 'blur', filterType: 'blur'}]); globalThis.process.exit()"), [
		{ filterId: "blur", filterType: "blur" },
	]);
});

test("rejects executable or non-object filter payloads", () => {
	assert.throws(() => parseTMFXFilterParams("([globalThis.process, {filterType: 'blur'}])"), /unsupported identifier/);
	assert.throws(() => parseTMFXFilterParams("(['not-a-filter'])"), /must contain objects/);
});

// ---------------------------------------------------------------------------
// c3 fixes: hexadecimal color literals (0xRRGGBB)
// ---------------------------------------------------------------------------
test("parses hexadecimal color integers used by shipped TokenMagic presets", () => {
	assert.deepEqual(parseTMFXFilterParams("([{filterId: 'glow', filterType: 'glow', lightColor: 0xff0000}])"), [
		{ filterId: "glow", filterType: "glow", lightColor: 0xff0000 },
	]);
	assert.equal(parseTMFXFilterParams("([{c: 0x000000}])")[0].c, 0);
	assert.equal(parseTMFXFilterParams("([{c: 0XABCDEF}])")[0].c, 0xabcdef);
	assert.equal(parseTMFXFilterParams("([{c: 0x0020bb}])")[0].c, 0x0020bb);
	assert.equal(parseTMFXFilterParams("([{c: -0xff}])")[0].c, -0xff);
	assert.equal(parseTMFXFilterParams("([{c: 0xff0000, nested: {inner: 0x00ff00}}])")[0].nested.inner, 0x00ff00);
});

test("rejects malformed hexadecimal tokens", () => {
	assert.throws(() => parseTMFXFilterParams("([{c: 0x}])"), /Invalid TokenMagic/);
	assert.throws(() => parseTMFXFilterParams("([{c: 0xGG}])"), /Invalid TokenMagic/);
	assert.throws(() => parseTMFXFilterParams("([{c: 0xffzz}])"), /Invalid TokenMagic/);
	assert.throws(() => parseTMFXFilterParams(`([{c: 0x${"f".repeat(1000)}}])`), /number is not finite/);
	assert.throws(() => parseTMFXFilterParams("([{c: 1e999}])"), /number is not finite/);
});

// ---------------------------------------------------------------------------
// c4 fixes: signed decimals/integers/exponents must never decode as base-16.
// The c3 signed-hex fix routed EVERY negative token through parseInt(..., 16):
// -0.0016 -> -0, -12 -> -18, -1.5 -> -1, -2e3 -> -739, -100 -> -256. Shipped
// TokenMagic 0.8.4 presets (speed: -0.0016 etc.) parsed "successfully" with
// corrupted values — worse than a no-op, so exact values are asserted here.
// ---------------------------------------------------------------------------
test("parses signed decimals, integers, and exponents as decimal values", () => {
	assert.equal(parseTMFXFilterParams("([{speed: -0.0016}])")[0].speed, -0.0016);
	assert.equal(parseTMFXFilterParams("([{speed: -0.0024}])")[0].speed, -0.0024);
	assert.equal(parseTMFXFilterParams("([{rotation: -12}])")[0].rotation, -12);
	assert.equal(parseTMFXFilterParams("([{scale: -1.5}])")[0].scale, -1.5);
	assert.equal(parseTMFXFilterParams("([{v: -2e3}])")[0].v, -2e3);
	assert.equal(parseTMFXFilterParams("([{v: -2.5e-3}])")[0].v, -2.5e-3);
	assert.equal(parseTMFXFilterParams("([{v: -100}])")[0].v, -100);
	assert.equal(parseTMFXFilterParams("([{v: -0}])")[0].v, -0);
	assert.ok(Object.is(parseTMFXFilterParams("([{v: -0}])")[0].v, -0), "-0 must keep its sign");
});

test("signed hexadecimal literals still decode in base-16", () => {
	assert.equal(parseTMFXFilterParams("([{c: -0xff}])")[0].c, -0xff);
	assert.equal(parseTMFXFilterParams("([{c: -0XABCDEF}])")[0].c, -0xabcdef);
	assert.equal(parseTMFXFilterParams("([{c: 0xff0000}])")[0].c, 0xff0000);
	assert.equal(parseTMFXFilterParams("([{c: -0x0}])")[0].c, -0);
	assert.ok(Object.is(parseTMFXFilterParams("([{c: -0x0}])")[0].c, -0), "-0x0 must decode to -0");
});

test("signed non-finite exponents are still rejected", () => {
	assert.throws(() => parseTMFXFilterParams("([{v: -1e999}])"), /number is not finite/);
	assert.throws(() => parseTMFXFilterParams("([{v: -0.5e999}])"), /number is not finite/);
});

// ---------------------------------------------------------------------------
// c3 fixes: trailing commas in arrays and objects (82+ in shipped presets)
// ---------------------------------------------------------------------------
test("accepts trailing commas in arrays and objects", () => {
	assert.deepEqual(parseTMFXFilterParams("([{filterId: 'glow', filterType: 'glow', values: [1, 2,],},])"), [
		{ filterId: "glow", filterType: "glow", values: [1, 2] },
	]);
	assert.deepEqual(
		parseTMFXFilterParams("([{filterId: 'glow', filterType: 'glow', animated: { loopDuration: 1600, animType: 'syncRotation', },}])"),
		[{ filterId: "glow", filterType: "glow", animated: { loopDuration: 1600, animType: "syncRotation" } }],
	);
	assert.deepEqual(
		parseTMFXFilterParams("([{filterId: 'a', filterType: 'a', values: [1, 2,],}, {filterId: 'b', filterType: 'b', values: [3,],},])"),
		[
			{ filterId: "a", filterType: "a", values: [1, 2] },
			{ filterId: "b", filterType: "b", values: [3] },
		],
	);
});

test("still rejects holes, elisions, and repeated commas", () => {
	assert.throws(() => parseTMFXFilterParams("([{values: [1,,2]}])"), /Invalid TokenMagic/);
	assert.throws(() => parseTMFXFilterParams("([{values: [1, 2,,]}])"), /Invalid TokenMagic/);
	assert.throws(() => parseTMFXFilterParams("([{a: 1,, b: 2}])"), /Invalid TokenMagic/);
	assert.throws(() => parseTMFXFilterParams("([,])"), /Invalid TokenMagic/);
});

// ---------------------------------------------------------------------------
// c3 fixes: Infinity / -Infinity (documented loops: Infinity)
// ---------------------------------------------------------------------------
test("accepts Infinity and -Infinity", () => {
	assert.deepEqual(parseTMFXFilterParams("([{filterId: 'glow', filterType: 'glow', loops: Infinity}])"), [
		{ filterId: "glow", filterType: "glow", loops: Infinity },
	]);
	assert.equal(parseTMFXFilterParams("([{alpha: -Infinity}])")[0].alpha, -Infinity);
});

// ---------------------------------------------------------------------------
// Security invariants preserved
// ---------------------------------------------------------------------------
test("parser source never evaluates or constructs functions", () => {
	const source = readFileSync(new URL("../../scripts/animation/tmfx-filter-parser.mjs", import.meta.url), "utf8");
	assert.ok(!/\beval\s*\(/.test(source), "parser must not call eval");
	assert.ok(!/\bnew\s+Function\b/.test(source), "parser must not construct Function");
	assert.ok(!/\bFunction\s*\(/.test(source), "parser must not reference Function constructor");
});

// ---------------------------------------------------------------------------
// Adversarial: deep nesting is contained by a deterministic throw (the editor
// call site wraps parseTMFXFilterParams in try/catch at TMFXFilterEditor.mjs
// 440-442, so a thrown Error becomes a warning, never a crash).
// ---------------------------------------------------------------------------
test("deep nesting throws deterministically instead of overflowing", () => {
	const deep = "[".repeat(2000) + "]".repeat(2000);
	assert.throws(() => parseTMFXFilterParams(deep), /nesting exceeds/);
	let caught = null;
	try {
		parseTMFXFilterParams(deep);
	} catch (error) {
		caught = error;
	}
	assert.ok(caught instanceof Error, "editor catch can contain the failure");
	assert.match(caught.message, /nesting exceeds/);
});

test("moderately nested object literals still parse within the depth budget", () => {
	const nested = '[{"a": ' + '{"a": '.repeat(100) + "1" + "}".repeat(100) + "}]";
	let expected = 1;
	for (let i = 0; i < 100; i += 1) expected = { a: expected };
	assert.deepEqual(parseTMFXFilterParams(nested)[0], { a: expected });
});

// ---------------------------------------------------------------------------
// REAL-CORPUS acceptance (shipped tokenmagic/fx/presets/defaultpresets.js)
// ---------------------------------------------------------------------------
test("shipped TokenMagic 0.8.4 params corpus parses (79 hex, 93 preset entries)", { skip: CORPUS_CANDIDATES ? false : "TokenMagic corpus not installed" }, async () => {
	const source = readFileSync(CORPUS_CANDIDATES, "utf8");
	const arrays = extractParamsArrays(source);
	assert.equal(arrays.length, 76, "shipped defaultpresets.js contains 76 params arrays");

	const hexLiterals = source.match(/\b0[xX][0-9a-fA-F]+\b/g) ?? [];
	assert.equal(hexLiterals.length, 79, "shipped corpus has 79 hexadecimal literals");

	const filterEntries = source.match(/filterType:/g) ?? [];
	assert.equal(filterEntries.length, 93, "shipped corpus has 93 preset entries");

	// Ground truth: evaluate the pure-data corpus module with Node's own engine
	// (a data: URL forces ESM regardless of the Foundry data directory's package
	// type), so every expected value below is the engine's own interpretation.
	const { allPresets } = await import(
		`data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`
	);
	assert.equal(allPresets.length, 76, "every params array maps 1:1 to a shipped preset");

	// c4: the shipped corpus carries seven negative-speed presets (defaultpresets.js
	// lines 503, 1633, 1737, 1819, 2094, 2293, 2409); the c3 parser corrupted each
	// to 0 while "succeeding", so the count is pinned to prove they are exercised.
	const negativeSpeeds = source.match(/speed:\s*-/g) ?? [];
	assert.equal(negativeSpeeds.length, 7, "shipped corpus has 7 negative-speed presets");

	let parsedArrays = 0;
	let rejectedArrays = 0;
	let parsedEntries = 0;
	let rejectedEntries = 0;
	for (let index = 0; index < arrays.length; index += 1) {
		const literal = arrays[index];
		const groundTruth = allPresets[index].params;
		try {
			const value = parseTMFXFilterParams(literal);
			parsedArrays += 1;
			parsedEntries += value.length;
			// VALUE-LEVEL equality for EVERY parsed entry of the shipped-preset
			// arrays — speed:-0.0016 must equal -0.0016 (never -0), hex colors must
			// equal their base-16 values, and so on for every key of every entry,
			// not just counts or arrays[0].
			assert.deepEqual(value, groundTruth, `params array ${index} value mismatch`);
		} catch (error) {
			rejectedArrays += 1;
			rejectedEntries += (literal.match(/filterType:/g) ?? []).length;
			// Exactly one shipped array is expression-bearing (-0.6 * Math.PI);
			// a safe parser must reject it rather than evaluate it.
			assert.match(literal, /Math\.PI/, `unexpectedly rejected array: ${error.message}`);
		}
	}
	assert.equal(parsedArrays, 75, "75 of 76 shipped params arrays are pure literals and must parse");
	assert.equal(rejectedArrays, 1, "exactly the expression-bearing Math.PI array must be rejected");
	assert.equal(parsedEntries + rejectedEntries, 93, "parsed + rejected filter entries match the 93 shipped preset entries");
	assert.equal(rejectedEntries, 1, "the rejected expression array holds the single unparseable preset entry");

	// c4 acceptance proof: every shipped negative-speed preset parses with a
	// strictly negative speed (the per-entry deepEqual above already proves the
	// exact values; this documents the seven locations the c3 regression hit).
	const collectSpeeds = (node) => {
		const out = [];
		const walk = (value) => {
			if (Array.isArray(value)) {
				for (const item of value) walk(item);
				return;
			}
			if (value && typeof value === "object") {
				for (const [key, child] of Object.entries(value)) {
					if (key === "speed") out.push(child);
					else walk(child);
				}
			}
		};
		walk(node);
		return out;
	};
	const negativeSpeedArrays = arrays.filter((literal) => /speed:\s*-/.test(literal));
	assert.equal(negativeSpeedArrays.length, 7, "exactly the seven negative-speed presets");
	for (const literal of negativeSpeedArrays) {
		const speeds = collectSpeeds(parseTMFXFilterParams(literal));
		assert.ok(speeds.length >= 1, "negative-speed preset must carry a speed entry");
		for (const speed of speeds) {
			assert.equal(typeof speed, "number");
		}
		// The negative literal must survive as a strictly negative number
		// (the per-entry deepEqual already proves the exact value; this makes
		// the c3 regression class — -0.0016 collapsing to -0 — explicit).
		assert.ok(
			speeds.some((speed) => speed < 0),
			`shipped negative speed must parse negative, got ${JSON.stringify(speeds)}`,
		);
	}
});

test("corpus identity is the installed Token Magic FX 0.8.4 file", { skip: CORPUS_CANDIDATES ? false : "TokenMagic corpus not installed" }, () => {
	const moduleJson = CORPUS_CANDIDATES.replace("/fx/presets/defaultpresets.js", "/module.json");
	if (!existsSync(moduleJson)) return;
	const manifest = JSON.parse(readFileSync(moduleJson, "utf8"));
	assert.equal(manifest.version, "0.8.4", "corpus fixture must stay pinned to TokenMagic 0.8.4");
});
