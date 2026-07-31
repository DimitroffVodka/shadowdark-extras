#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { maskSource } from "./import-scan.mjs";
import { listJsFiles, toRepoPath, isVendor, REPO_ROOT } from "./project-scan.mjs";

/**
 * Imported-but-never-used binding scanner.
 *
 * THE GAP THIS FILLS. The named-export gate proves every imported name EXISTS
 * at the other end. Nothing proves it is USED at this end. So when Phase 3
 * moves a section out of a module, the import clause that fed it stays behind
 * intact and rots silently — `transferCoinsToPlayer` and `showCoinTransferDialog`
 * sat unused in the composition root from PR #18 until unit 14 happened to
 * narrow the same line by hand. Every gate was green the whole time.
 *
 * WHY IT IS NOT DANGEROUS TO BE WRONG IN ONE DIRECTION. A missed use would
 * delete a live import and break at runtime, so every ambiguity here resolves
 * toward KEEPING the import:
 *
 *   - Side-effect imports (`import "./x.mjs"`) bind no name and are never
 *     reported. They are exactly the imports whose whole purpose is invisible.
 *   - A name used anywhere outside its own import statement counts as used,
 *     including inside a nested scope that shadows it. Shadowing would make
 *     the import genuinely unused, but proving that needs real scope analysis
 *     and the failure mode is deletion, so it is not attempted.
 *   - Re-exports (`export { X }`) read as a use, because they are one.
 *   - A name appearing ONLY inside a comment or a string is reported
 *     separately as `docOnly` rather than as a clean removal. Removing those
 *     is safe for the runtime but breaks a JSDoc `@param {Type}` reference or
 *     a doc pointer, which is a judgement call for a human, not a sweep.
 *
 * Detection runs against MASKED source, so an identifier that only appears in
 * a string literal is not mistaken for a use. Reporting then re-checks the raw
 * source to distinguish "genuinely absent" from "mentioned only in prose".
 */

/** Static import statements only. A clause-less `import "x"` never matches. */
const IMPORT_RE = new RegExp(
	String.raw`(?:^|\n)\s*import\s+` +
	String.raw`(?:([A-Za-z_$][\w$]*)\s*,\s*)?` +          // default, in a mixed clause
	String.raw`(?:\{([^}]*)\}` +                           // named
	String.raw`|\*\s*as\s+([A-Za-z_$][\w$]*)` +            // namespace
	String.raw`|([A-Za-z_$][\w$]*))` +                     // default, alone
	String.raw`\s+from\s*['"]`,
	"g",
);

/** `a`, `a as b`, `default as b` -> the LOCAL binding name. */
function localNames(clause) {
	return clause
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => (part.includes(" as ") ? part.split(/\s+as\s+/).pop() : part).trim())
		.filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/**
 * @returns {{bindings: Array<{name: string, line: number}>, blanked: string}}
 *   every statically imported local name, and the masked source with the
 *   import statements themselves blanked out so they cannot self-satisfy.
 */
function collectImports(masked) {
	const bindings = [];
	const spans = [];
	for (const m of masked.matchAll(IMPORT_RE)) {
		const [, mixedDefault, named, namespace, soleDefault] = m;
		const names = [];
		if (mixedDefault) names.push(mixedDefault);
		if (named) names.push(...localNames(named));
		if (namespace) names.push(namespace);
		if (soleDefault) names.push(soleDefault);
		// The statement runs to the end of the line holding its specifier.
		const from = m.index;
		const eol = masked.indexOf("\n", m.index + m[0].length);
		const to = eol === -1 ? masked.length : eol;
		spans.push([from, to]);
		const line = masked.slice(0, from + 1).split("\n").length;
		for (const name of names) bindings.push({ name, line });
	}
	const chars = [...masked];
	for (const [from, to] of spans) for (let i = from; i < to; i++) if (chars[i] !== "\n") chars[i] = " ";
	return { bindings, blanked: chars.join("") };
}

function scanFile(file) {
	const source = readFileSync(file, "utf8");
	const { masked } = maskSource(source);
	const { bindings, blanked } = collectImports(masked);
	const rawNoImports = collectImports(source).blanked;   // raw, imports removed
	const out = [];
	for (const { name, line } of bindings) {
		const word = new RegExp(String.raw`\b${name.replace(/\$/g, "\\$")}\b`);
		if (word.test(blanked)) continue;                  // used in real code
		out.push({ name, line, docOnly: word.test(rawNoImports) });
	}
	return out;
}

function main() {
	const files = listJsFiles(["scripts", "data"]).filter((f) => !isVendor(toRepoPath(f)));
	let unused = 0, docOnly = 0, dirty = 0;
	const rows = [];
	for (const file of files) {
		const hits = scanFile(file);
		if (!hits.length) continue;
		dirty += 1;
		for (const h of hits) {
			if (h.docOnly) docOnly += 1; else unused += 1;
			rows.push(`${toRepoPath(file)}:${h.line}  ${h.name}${h.docOnly ? "   [docOnly — referenced in a comment or string]" : ""}`);
		}
	}
	console.log(`unused imports: ${unused} removable, ${docOnly} doc-only, across ${dirty} of ${files.length} modules`);
	for (const r of rows) console.log(`  ${r}`);
	if (process.argv.includes("--strict") && unused) process.exit(1);
}

main();
