import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// #190: the Reward Coins dialog painted its text in fixed near-black inline
// colours, unreadable on the dark theme. Its text must take the theme's colours.
const src = readFileSync(new URL("../../scripts/party/partyxp.mjs", import.meta.url), "utf8");
const start = src.indexOf("async _onRewardCoins(");
const dialog = src.slice(start, src.indexOf("DialogV2.prompt", start));

test("Reward Coins dialog text colours come from the theme, not fixed values", () => {
	const colours = [...dialog.matchAll(/[^-]color:\s*([^;"]+)/g)].map(m => m[1].trim());
	assert.ok(colours.length >= 2, "the warning and the member count each set a colour");
	for (const c of colours) assert.match(c, /^var\(--color-text-/, `fixed colour ${c}`);
});
