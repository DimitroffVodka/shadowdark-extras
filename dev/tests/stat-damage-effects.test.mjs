import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// The six stat-damage entries in the Effects library are a contract with
// Shadowdark Enhancer (#148): its rests, Grinder Mode and CON check read exactly
// this shape (docs/API.md, statDamage). A text match on the YAML source, so no
// YAML parser is needed.
const dir = new URL("../../src/packs/pack-sdxeffects/", import.meta.url);
const sources = readdirSync(dir).map(f => readFileSync(new URL(f, dir), "utf8"));

test("one one-point stat-damage effect per ability, in Enhancer's shape", () => {
	for (const a of ["str", "dex", "con", "int", "wis", "cha"]) {
		const flag = new RegExp(`^flags:\\n  shadowdark-enhancer:\\n    statDamage:\\n      ability: ${a}$`, "m");
		const matches = sources.filter(s => flag.test(s));
		assert.equal(matches.length, 1, `${a}: exactly one entry`);
		const [yml] = matches;
		assert.match(yml, new RegExp(`^name: ${a.toUpperCase()} damage$`, "m"));
		assert.match(yml, new RegExp(
			`^system:\\n  changes:\\n    - key: system\\.abilities\\.${a}\\.value\\n      value: -1\\n`
			+ "      priority: 20\\n      type: add\\n      phase: initial\\n_id:", "m"), `${a}: one ADD of -1`);
		assert.match(yml, /^duration:\n {2}value: null$/m, `${a}: lasts until healed`);
	}
});
