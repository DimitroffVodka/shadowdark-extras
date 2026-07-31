#!/usr/bin/env node
/**
 * Named-export gate: every named import must exist as an export of its target.
 *
 * WHY THIS EXISTS. `gate:imports` proves the target FILE resolves. It never
 * reads the target's export list, so this passes every static gate:
 *
 *     import { doesNotExist } from "./real-file.mjs";
 *
 * `node --check` is a parser — it cannot see across files. The binding gate
 * reads the importing file only. The registration and API snapshots do not look
 * at imports at all. So a wrong import name survives the entire static tier and
 * fails at load time in the browser, taking the whole module graph with it.
 *
 * This was not hypothetical. Extracting `item-sheets/activity-tab-widgets.mjs`
 * moved code that used `openTMFXFilterEditor`, which the composition root
 * obtains through a RENAMED import:
 *
 *     import { filterEditor as openTMFXFilterEditor } from "./animation/TMFXFilterEditor.mjs";
 *
 * Reconstructing that import from the local name alone produced
 * `import { openTMFXFilterEditor }`, which does not exist. Seven gates, 141
 * tests and node --check were all green; the module failed to load in Foundry.
 * Renamed imports are the trap — the name you read at the call site is the
 * LOCAL name, not the exported one.
 *
 * Usage: node dev/tools/named-export-gate.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");

/** Vendored trees that are not ours to police. */
const SKIP = /node_modules|[\\/]maphub[\\/](js|to|fonts)[\\/]/;

const files = [];
(function walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (SKIP.test(p)) continue;
		if (entry.isDirectory()) walk(p);
		else if (entry.name.endsWith(".mjs")) files.push(p);
	}
})(SCRIPTS);

const exportCache = new Map();

/**
 * The export names a module provides. `export * from` is treated as opaque:
 * the presence of any star re-export suppresses reporting for that target,
 * because resolving it needs the same walk one level down and a false BLOCK is
 * worse than a missed one for a pattern this codebase barely uses.
 */
function exportsOf(file) {
	if (exportCache.has(file)) return exportCache.get(file);
	const src = fs.readFileSync(file, "utf8");
	const names = new Set();
	for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
		names.add(m[1]);
	}
	for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
		for (const part of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
			names.add(part.split(/\s+as\s+/).pop().trim());
		}
	}
	if (/^export\s+default/m.test(src)) names.add("default");
	const hasStar = /^export\s+\*\s+from/m.test(src);
	const result = { names, hasStar };
	exportCache.set(file, result);
	return result;
}

let checked = 0;
const problems = [];

for (const file of files) {
	const src = fs.readFileSync(file, "utf8");
	const rel = path.relative(ROOT, file);

	// import Default, { a, b as c } from "./x.mjs"
	for (const m of src.matchAll(/^import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/gm)) {
		const target = path.resolve(path.dirname(file), m[3]);
		if (!fs.existsSync(target)) continue; // gate:imports owns missing files
		const { names, hasStar } = exportsOf(target);
		if (m[1]) {
			checked++;
			if (!names.has("default")) {
				problems.push(`${rel}\n    imports default as \`${m[1]}\` from ${path.relative(ROOT, target)}, which has no default export`);
			}
		}
		for (const raw of m[2].split(",").map((x) => x.trim()).filter(Boolean)) {
			const sourceName = raw.split(/\s+as\s+/)[0].trim();
			checked++;
			if (!names.has(sourceName) && !hasStar) {
				problems.push(`${rel}\n    imports { ${raw} } from ${path.relative(ROOT, target)}, which exports no \`${sourceName}\``);
			}
		}
	}

	// import Default from "./x.mjs"
	for (const m of src.matchAll(/^import\s+([A-Za-z_$][\w$]*)\s+from\s*["'](\.[^"']+)["']/gm)) {
		const target = path.resolve(path.dirname(file), m[2]);
		if (!fs.existsSync(target)) continue;
		checked++;
		const { names, hasStar } = exportsOf(target);
		if (!names.has("default") && !hasStar) {
			problems.push(`${rel}\n    imports \`${m[1]}\` from ${path.relative(ROOT, target)}, which has no default export`);
		}
	}
}

for (const p of problems) console.error(`[BLOCK] ${p}`);
console.log(`named-export gate: ${checked} import bindings checked across ${files.length} modules`);
if (problems.length) {
	console.error(`named-export gate: ${problems.length} import(s) name something the target does not export`);
	process.exit(1);
}
console.log("named-export gate: OK");
