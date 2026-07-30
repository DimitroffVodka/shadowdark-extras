import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { planWebpSwap, toUrl } from "../../scripts/WebpMigrationSD.mjs";

const moduleRoot = new URL("../../", import.meta.url);
const P = "modules/shadowdark-extras/";

// ---------------------------------------------------------------------------
// toUrl - the encoding bug that made the migration silently skip files
// ---------------------------------------------------------------------------
// Foundry stores percent-encoded paths for assets whose names contain spaces,
// parentheses or ampersands. Running encodeURI over an already-encoded path
// double-escapes it (%20 -> %2520), the HEAD probe 404s, and the migration
// concludes the .webp does not exist - leaving a dead .png in the world.

test("toUrl encodes a raw path exactly once and keeps separators", () => {
	const url = toUrl(`${P}assets/Hexes/Badlands/Hex - Plains (damp) 1.webp`);
	assert.ok(url.startsWith(`/${P}assets/Hexes/Badlands/`), `separators mangled: ${url}`);
	// Parentheses are unreserved marks; encodeURIComponent leaves them literal,
	// which is valid in a path segment. Spaces must be escaped.
	assert.ok(url.endsWith("Hex%20-%20Plains%20(damp)%201.webp"), url);
});

test("toUrl does not double-encode an already-encoded path", () => {
	const encoded = `${P}assets/Hexes/Badlands/Hex%20-%20Plains%20(damp)%201.webp`;
	const url = toUrl(encoded);
	assert.ok(!url.includes("%2520"), `double-encoded: ${url}`);
	assert.equal(url, toUrl(`${P}assets/Hexes/Badlands/Hex - Plains (damp) 1.webp`));
});

test("toUrl handles encoded ampersands - the Dysonstyle 'B&W-' naming", () => {
	// decodeURI leaves %26 intact (reserved), so encodeURI would emit %2526.
	const encoded = `${P}assets/symbols/Dysonstyle/B%26W-Camp-Feu01.webp`;
	const url = toUrl(encoded);
	assert.ok(!url.includes("%2526"), `double-encoded ampersand: ${url}`);
	assert.ok(url.endsWith("B%26W-Camp-Feu01.webp"), url);
});

test("toUrl is idempotent - encoded and raw forms converge", () => {
	const raw = `${P}assets/symbols/Dysonstyle/B&W-Camp-Feu01.webp`;
	const enc = `${P}assets/symbols/Dysonstyle/B%26W-Camp-Feu01.webp`;
	assert.equal(toUrl(raw), toUrl(enc));
	assert.equal(toUrl(toUrl(raw).slice(1)), toUrl(raw));
});

test("toUrl survives a malformed percent escape instead of throwing", () => {
	// A literal '%' in a filename is not a valid escape; decodeURI would throw.
	assert.doesNotThrow(() => toUrl(`${P}assets/tiles/100%-cover.webp`));
});

// ---------------------------------------------------------------------------
// planWebpSwap - which stored strings are candidates at all
// ---------------------------------------------------------------------------

test("planWebpSwap rewrites module-owned raster paths", () => {
	assert.equal(
		planWebpSwap(`${P}assets/Hexes/Autumn/autumnbog.png`).rewritten,
		`${P}assets/Hexes/Autumn/autumnbog.webp`
	);
	assert.equal(
		planWebpSwap(`${P}assets/Tom/portrait.JPEG`).rewritten,
		`${P}assets/Tom/portrait.webp`
	);
});

test("planWebpSwap preserves a cache-busting query suffix", () => {
	const plan = planWebpSwap(`${P}assets/tiles/skulls.png?1712345`);
	assert.equal(plan.candidate, `${P}assets/tiles/skulls.webp`, "probe target drops the query");
	assert.equal(plan.rewritten, `${P}assets/tiles/skulls.webp?1712345`, "stored value keeps it");
});

test("planWebpSwap preserves the original encoding of the stored path", () => {
	const plan = planWebpSwap(`${P}assets/Hexes/Badlands/Hex%20-%20Plains%20(damp)%201.png`);
	assert.equal(plan.rewritten, `${P}assets/Hexes/Badlands/Hex%20-%20Plains%20(damp)%201.webp`);
});

test("planWebpSwap ignores paths belonging to other packages", () => {
	assert.equal(planWebpSwap("modules/tokenmagic/fx/assets/distortion-1.png"), null);
	assert.equal(planWebpSwap("modules/levels-3d-preview/assets/particles/dust.png"), null);
	assert.equal(planWebpSwap("systems/shadowdark/assets/icon.png"), null);
	assert.equal(planWebpSwap("/ui/parchment.jpg"), null);
	assert.equal(planWebpSwap("worlds/mine/uploads/player-token.png"), null);
});

test("planWebpSwap ignores non-raster and non-string values", () => {
	assert.equal(planWebpSwap(`${P}assets/crown.svg`), null);
	assert.equal(planWebpSwap(`${P}assets/torch.webp`), null, "already converted");
	assert.equal(planWebpSwap(`${P}intro.mp3`), null);
	assert.equal(planWebpSwap(null), null);
	assert.equal(planWebpSwap(42), null);
	assert.equal(planWebpSwap({ src: `${P}a.png` }), null);
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
