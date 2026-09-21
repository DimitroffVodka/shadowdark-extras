#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./project-scan.mjs";

/**
 * Undo Foundry's in-place rewrite of module.json.
 *
 * WHY THIS EXISTS. `~/FoundryV14/Data/modules/shadowdark-extras` is a symlink
 * to this checkout, so loading a world makes Foundry normalise the manifest and
 * write it straight back into the working tree. Nobody edited it; the running
 * application did. Observed 2026-09-21:
 *
 *   - `compatibility.minimum` "14.361" -> "14"
 *   - `"folders": []` added to the pack-list entry
 *   - `"flags": {}` added to each `packs` entry
 *   - the trailing newline stripped
 *
 * The first of those fails dev/tests/module-compatibility.test.mjs, which pins
 * 14.361 because issue #140 needs the v14.361 Active Effect duration fixes. So
 * `npm test` reports a manifest regression on any tree the live world has
 * loaded, and the failure looks like an authoring mistake rather than a side
 * effect of playing the game. It recurs on every world load.
 *
 * WHAT IT DOES. Restores module.json from HEAD, but ONLY when every difference
 * matches that signature. A real manifest edit — a version bump, a new pack, a
 * changed dependency — is left alone and reported, because this must never eat
 * intentional work. Never blocks: a real edit is legitimate, and the gates
 * downstream are the ones entitled to an opinion about it.
 *
 * Wired as npm `pretest` so the repair happens before the test that would
 * otherwise fail. Safe to run by hand: `npm run fix:manifest`.
 */

const MANIFEST = path.join(REPO_ROOT, "module.json");

/** Empty `folders: []` / `flags: {}` containers are Foundry's additions. */
function stripEmptyContainers(value) {
	if (Array.isArray(value)) return value.map(stripEmptyContainers);
	if (value === null || typeof value !== "object") return value;
	const out = {};
	for (const [k, v] of Object.entries(value)) {
		const isEmpty = (Array.isArray(v) && v.length === 0)
			|| (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
		if ((k === "folders" || k === "flags") && isEmpty) continue;
		out[k] = stripEmptyContainers(v);
	}
	return out;
}

/**
 * True when `working` differs from `committed` only the way Foundry rewrites it.
 * The minimum check accepts a truncation ("14.361" -> "14") and nothing else,
 * so a deliberate bump to a different version is not silently reverted.
 */
function isFoundryRewriteOnly(working, committed) {
	const a = stripEmptyContainers(structuredClone(working));
	const b = stripEmptyContainers(structuredClone(committed));

	const liveMin = a.compatibility?.minimum;
	const headMin = b.compatibility?.minimum;
	if (liveMin !== headMin) {
		if (typeof liveMin !== "string" || typeof headMin !== "string") return false;
		if (!headMin.startsWith(liveMin)) return false;
		a.compatibility.minimum = headMin;
	}

	return JSON.stringify(a) === JSON.stringify(b);
}

const live = readFileSync(MANIFEST, "utf8");
const head = execFileSync("git", ["show", "HEAD:module.json"], {
	cwd: REPO_ROOT,
	encoding: "utf8",
	maxBuffer: 8 * 1024 * 1024,
});

if (live === head) process.exit(0);

let parsed;
try {
	parsed = { working: JSON.parse(live), committed: JSON.parse(head) };
} catch (e) {
	console.log(`manifest: module.json is not valid JSON (${e.message}) — left alone.`);
	process.exit(0);
}

if (isFoundryRewriteOnly(parsed.working, parsed.committed)) {
	writeFileSync(MANIFEST, head);
	console.log("manifest: reverted Foundry's rewrite of module.json (it writes through the module symlink on world load).");
} else {
	console.log("manifest: module.json has real edits beyond Foundry's rewrite — left alone.");
}
