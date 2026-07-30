import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { normalizeModulePath, planWebpSwap, toUrl } from "../../scripts/shared/WebpMigrationSD.mjs";

const moduleRoot = new URL("../../", import.meta.url);
const MODULE_PREFIX = "modules/shadowdark-extras/";

// ---------------------------------------------------------------------------
// toUrl - the encoding bug that made the migration silently skip files
// ---------------------------------------------------------------------------
// Foundry stores percent-encoded paths for assets whose names contain spaces,
// parentheses or ampersands. Running encodeURI over an already-encoded path
// double-escapes it (%20 -> %2520), the HEAD probe 404s, and the migration
// concludes the .webp does not exist - leaving a dead .png in the world.

test("toUrl encodes a raw path exactly once and keeps separators", () => {
	const url = toUrl(`${MODULE_PREFIX}assets/Hexes/Badlands/Hex - Plains (damp) 1.webp`);
	assert.ok(url.startsWith(`/${MODULE_PREFIX}assets/Hexes/Badlands/`), `separators mangled: ${url}`);
	// Parentheses are unreserved marks; encodeURIComponent leaves them literal,
	// which is valid in a path segment. Spaces must be escaped.
	assert.ok(url.endsWith("Hex%20-%20Plains%20(damp)%201.webp"), url);
});

test("toUrl does not double-encode an already-encoded path", () => {
	const encoded = `${MODULE_PREFIX}assets/Hexes/Badlands/Hex%20-%20Plains%20(damp)%201.webp`;
	const url = toUrl(encoded);
	assert.ok(!url.includes("%2520"), `double-encoded: ${url}`);
	assert.equal(url, toUrl(`${MODULE_PREFIX}assets/Hexes/Badlands/Hex - Plains (damp) 1.webp`));
});

test("toUrl handles encoded ampersands - the Dysonstyle 'B&W-' naming", () => {
	// decodeURI leaves %26 intact (reserved), so encodeURI would emit %2526.
	const encoded = `${MODULE_PREFIX}assets/symbols/Dysonstyle/B%26W-Camp-Feu01.webp`;
	const url = toUrl(encoded);
	assert.ok(!url.includes("%2526"), `double-encoded ampersand: ${url}`);
	assert.ok(url.endsWith("B%26W-Camp-Feu01.webp"), url);
});

test("toUrl is idempotent - encoded and raw forms converge", () => {
	const raw = `${MODULE_PREFIX}assets/symbols/Dysonstyle/B&W-Camp-Feu01.webp`;
	const enc = `${MODULE_PREFIX}assets/symbols/Dysonstyle/B%26W-Camp-Feu01.webp`;
	assert.equal(toUrl(raw), toUrl(enc));
	assert.equal(toUrl(toUrl(raw).slice(1)), toUrl(raw));
});

test("toUrl survives a malformed percent escape instead of throwing", () => {
	// A literal '%' in a filename is not a valid escape; decodeURI would throw.
	assert.doesNotThrow(() => toUrl(`${MODULE_PREFIX}assets/tiles/100%-cover.webp`));
});

test("toUrl never emits a protocol-relative '//' for a slash-prefixed path", () => {
	// Regression: "/" + "/modules/...".split("/") rejoined to "//modules/...",
	// which a browser resolves as host=modules - the HEAD probe then goes
	// off-origin, 404s, and the migration silently skips the file. Slash-prefixed
	// paths are real here: SheetEditorConfig builds `/${basePath}/...`.
	const url = toUrl(`/${MODULE_PREFIX}art/PNG/Default/Border/skulls.webp`);
	assert.ok(!url.startsWith("//"), `protocol-relative URL: ${url}`);
	assert.equal(url, `/${MODULE_PREFIX}art/PNG/Default/Border/skulls.webp`);
});

test("toUrl treats slash-prefixed and bare paths as the same URL", () => {
	const bare = `${MODULE_PREFIX}assets/tiles/skulls.webp`;
	assert.equal(toUrl(`/${bare}`), toUrl(bare));
	assert.equal(toUrl(`///${bare}`), toUrl(bare), "repeated leading slashes");
});

// ---------------------------------------------------------------------------
// normalizeModulePath - ownership must be a prefix test, not a substring test
// ---------------------------------------------------------------------------

test("normalizeModulePath accepts module paths with or without a leading slash", () => {
	assert.equal(
		normalizeModulePath(`${MODULE_PREFIX}assets/tiles/skulls.png`),
		`${MODULE_PREFIX}assets/tiles/skulls.png`
	);
	assert.equal(
		normalizeModulePath(`/${MODULE_PREFIX}assets/tiles/skulls.png`),
		`${MODULE_PREFIX}assets/tiles/skulls.png`,
		"leading slash should be stripped, not rejected"
	);
});

test("normalizeModulePath rejects foreign paths that merely contain the prefix", () => {
	// Regression: a substring test would claim ownership of these and rewrite a
	// working reference to a file that does not exist.
	assert.equal(normalizeModulePath(`worlds/mine/uploads/${MODULE_PREFIX}old.png`), null);
	assert.equal(normalizeModulePath(`backups/2024/${MODULE_PREFIX}art.png`), null);
	assert.equal(normalizeModulePath(`https://cdn.example.com/${MODULE_PREFIX}art.png`), null);
	assert.equal(normalizeModulePath(`modules/other-module/vendor/${MODULE_PREFIX}x.png`), null);
	assert.equal(normalizeModulePath("modules/shadowdark-extras-extended/assets/x.png"), null);
});

// ---------------------------------------------------------------------------
// planWebpSwap - which stored strings are candidates at all
// ---------------------------------------------------------------------------

test("planWebpSwap rewrites module-owned raster paths", () => {
	assert.equal(
		planWebpSwap(`${MODULE_PREFIX}assets/Hexes/Autumn/autumnbog.png`).rewritten,
		`${MODULE_PREFIX}assets/Hexes/Autumn/autumnbog.webp`
	);
	assert.equal(
		planWebpSwap(`${MODULE_PREFIX}assets/Tom/portrait.JPEG`).rewritten,
		`${MODULE_PREFIX}assets/Tom/portrait.webp`
	);
});

test("planWebpSwap preserves a cache-busting query suffix", () => {
	const plan = planWebpSwap(`${MODULE_PREFIX}assets/tiles/skulls.png?1712345`);
	assert.equal(plan.candidate, `${MODULE_PREFIX}assets/tiles/skulls.webp`, "probe target drops the query");
	assert.equal(plan.rewritten, `${MODULE_PREFIX}assets/tiles/skulls.webp?1712345`, "stored value keeps it");
});

test("planWebpSwap preserves the original encoding of the stored path", () => {
	const plan = planWebpSwap(`${MODULE_PREFIX}assets/Hexes/Badlands/Hex%20-%20Plains%20(damp)%201.png`);
	assert.equal(plan.rewritten, `${MODULE_PREFIX}assets/Hexes/Badlands/Hex%20-%20Plains%20(damp)%201.webp`);
});

test("planWebpSwap ignores paths belonging to other packages", () => {
	assert.equal(planWebpSwap("modules/tokenmagic/fx/assets/distortion-1.png"), null);
	assert.equal(planWebpSwap("modules/levels-3d-preview/assets/particles/dust.png"), null);
	assert.equal(planWebpSwap("systems/shadowdark/assets/icon.png"), null);
	assert.equal(planWebpSwap("/ui/parchment.jpg"), null);
	assert.equal(planWebpSwap("worlds/mine/uploads/player-token.png"), null);
});

test("planWebpSwap ignores foreign paths that merely contain the module prefix", () => {
	// Regression: `value.includes(PREFIX)` claimed ownership of these.
	assert.equal(planWebpSwap(`worlds/mine/uploads/${MODULE_PREFIX}old.png`), null);
	assert.equal(planWebpSwap(`https://cdn.example.com/${MODULE_PREFIX}art.png`), null);
	assert.equal(planWebpSwap("modules/shadowdark-extras-extended/assets/x.png"), null);
});

test("planWebpSwap keeps a leading slash on the rewritten value", () => {
	// The stored reference must change extension ONLY - dropping the slash would
	// re-root a path the rest of the module builds as `/${basePath}/...`.
	const plan = planWebpSwap(`/${MODULE_PREFIX}art/PNG/Default/Border/skulls.png`);
	assert.equal(plan.rewritten, `/${MODULE_PREFIX}art/PNG/Default/Border/skulls.webp`);
	// ...and the probe target must still resolve on-origin.
	assert.ok(!toUrl(plan.candidate).startsWith("//"), toUrl(plan.candidate));
});

test("planWebpSwap ignores non-raster and non-string values", () => {
	assert.equal(planWebpSwap(`${MODULE_PREFIX}assets/crown.svg`), null);
	assert.equal(planWebpSwap(`${MODULE_PREFIX}assets/torch.webp`), null, "already converted");
	assert.equal(planWebpSwap(`${MODULE_PREFIX}intro.mp3`), null);
	assert.equal(planWebpSwap(null), null);
	assert.equal(planWebpSwap(42), null);
	assert.equal(planWebpSwap({ src: `${MODULE_PREFIX}a.png` }), null);
});

// ---------------------------------------------------------------------------
// Contract: assets we deliberately kept as PNG/JPG must still be on disk.
// The migration only rewrites a path after confirming the .webp exists, so if
// one of these were ever deleted without a .webp replacement, stored paths
// would dangle with nothing to migrate to.
// ---------------------------------------------------------------------------

const KEPT_AS_IS = [
	"assets/Dungeon/backgrounds/dark-leather.png",
	"assets/Dungeon/backgrounds/dark-wood.png",
	"assets/Dungeon/backgrounds/light-honeycomb-dark.png",
	"assets/Dungeon/backgrounds/lined-paper.png",
	"assets/Dungeon/backgrounds/old_map.png",
	"assets/Tom/banner_tom.png",
	"assets/Tom/femalewarrior/angry.jpg",
	"assets/Tom/femalewarrior/happy.jpg",
	"assets/Tom/femalewarrior/normal.jpg",
	"assets/Tom/femalewarrior/surprised.jpg",
	"assets/Tom/wizardmale/angry.jpg",
	"assets/Tom/wizardmale/happy.jpg",
	"assets/Tom/wizardmale/normal.jpg",
	"assets/Tom/wizardmale/worried.jpg",
];

test("assets intentionally kept as PNG/JPG still exist on disk", () => {
	for (const rel of KEPT_AS_IS) {
		assert.ok(
			existsSync(new URL(rel, moduleRoot)),
			`${rel} was kept as PNG/JPG by the webp conversion but is now missing`
		);
	}
});

test("no shipped .webp shadows a kept PNG/JPG", () => {
	// If both existed the migration would rewrite the stored path to the .webp,
	// silently swapping the artwork the world was pointing at.
	for (const rel of KEPT_AS_IS) {
		const webp = rel.replace(/\.(png|jpe?g)$/i, ".webp");
		assert.ok(
			!existsSync(new URL(webp, moduleRoot)),
			`${webp} exists alongside kept ${rel} - migration would silently swap it`
		);
	}
});
