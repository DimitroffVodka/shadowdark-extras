#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { scanImports, classifyTarget } from "./import-scan.mjs";
import { listJsFiles, toRepoPath, REPO_ROOT } from "./project-scan.mjs";

/**
 * Pre-move reference finder.
 *
 * The remaining risk in the structural track is references the automated gates
 * cannot see: paths built at runtime. Two are already known —
 * `dev/regen-creature-type-map.mjs` writes its output via
 * `path.join(__dirname, "..", "data", …)`, and the roller regression test used
 * to import through `new URL(…)`. Neither is an import specifier, so the
 * resolver is blind to both, and the string-path guard only matches the
 * `modules/<id>/scripts/` form.
 *
 * Rather than rely on remembering to grep before each move, this does the grep
 * and sorts the hits into "the resolver already covers this" and "you must
 * update this by hand".
 *
 * Advisory, not a gate: it runs before a move, on a path that has not moved yet.
 *
 *   npm run premove -- scripts/AuraEffectsSD.mjs
 *
 * The example names a file that has not moved yet, because a worked example is
 * only useful before the move. This comment previously named
 * `scripts/CompendiumIndexSD.mjs` and went stale the moment Phase 1 moved it —
 * running the old example afterwards reported that file's real imports as
 * ungated, which is precisely the wrong answer. Point it at an unmoved file, or
 * at nothing.
 */

/** Text files worth searching. Vendor trees and binaries are skipped. */
const SEARCH_ROOTS = ["scripts", "data", "dev", "docs", "templates", "styles", "i18n", ".github"];
const SEARCH_FILES = ["module.json", "package.json", "verify.sh", "README.md", "CHANGELOG.md"];
const TEXT_EXTENSIONS = /\.(mjs|js|json|md|hbs|css|sh|ya?ml|txt)$/;
const SKIP = ["scripts/maphub/", "libs/", "greensock/", "node_modules/", "packs/", "dev/backups/"];

function listTextFiles() {
  const found = new Set(listJsFiles(SEARCH_ROOTS));

  const walk = (absolute) => {
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(absolute, entry.name);
      const repoPath = toRepoPath(child);
      if (SKIP.some((prefix) => repoPath.startsWith(prefix))) continue;
      if (entry.isDirectory()) walk(child);
      else if (TEXT_EXTENSIONS.test(entry.name)) found.add(child);
    }
  };

  for (const root of SEARCH_ROOTS) walk(path.join(REPO_ROOT, root));
  for (const file of SEARCH_FILES) {
    const absolute = path.join(REPO_ROOT, file);
    try {
      if (statSync(absolute).isFile()) found.add(absolute);
    } catch {
      // Optional file.
    }
  }

  return [...found].filter((file) => !SKIP.some((prefix) => toRepoPath(file).startsWith(prefix))).sort();
}

/** Lines in `file` whose import resolves to `targetAbsolute`. */
function gatedImportLines(file, source, targetAbsolute) {
  const lines = new Set();
  if (!/\.(mjs|js)$/.test(file)) return lines;

  for (const entry of scanImports(source)) {
    if (entry.computed || !entry.relative) continue;
    const target = classifyTarget(REPO_ROOT, file, entry.specifier);
    if (target.resolved === targetAbsolute) lines.add(entry.line);
  }
  return lines;
}

function classifyLine(text, file) {
  if (/new\s+URL\s*\(|path\.(join|resolve)\s*\(|__dirname/.test(text)) return "constructed path";
  if (file.endsWith(".md")) return "documentation";
  if (file.endsWith(".json")) return "manifest/config";
  return "string reference";
}

export function findPathRefs(targetRepoPath) {
  const targetAbsolute = path.resolve(REPO_ROOT, targetRepoPath);
  const basename = path.basename(targetAbsolute);

  /**
   * Require a boundary before the basename, so looking for
   * `creature-type-map.mjs` does not also match every mention of
   * `regen-creature-type-map.mjs`, which is a different file.
   */
  const mention = new RegExp(`(^|[^\\w-])${basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

  const gated = [];
  const ungated = [];

  for (const file of listTextFiles()) {
    if (path.resolve(file) === targetAbsolute) continue;

    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!mention.test(source)) continue;

    const importLines = gatedImportLines(file, source, targetAbsolute);

    source.split("\n").forEach((text, index) => {
      if (!mention.test(text)) return;
      const line = index + 1;
      const record = { file: toRepoPath(file), line, text: text.trim().slice(0, 140) };
      if (importLines.has(line)) gated.push({ ...record, kind: "relative import" });
      else ungated.push({ ...record, kind: classifyLine(text, file) });
    });
  }

  return { target: toRepoPath(targetAbsolute), basename, gated, ungated };
}

function main() {
  const targets = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (targets.length === 0) {
    console.log("usage: npm run premove -- <path-to-file-you-are-about-to-move> [more...]");
    process.exit(2);
  }

  for (const target of targets) {
    const result = findPathRefs(target);
    console.log(`\n=== references to ${result.target} ===`);
    console.log(`covered by the import resolver: ${result.gated.length}`);
    for (const hit of result.gated) console.log(`  ok   ${hit.file}:${hit.line}  ${hit.text}`);

    console.log(`NOT covered — update by hand: ${result.ungated.length}`);
    for (const hit of result.ungated) {
      console.log(`  !!   [${hit.kind}] ${hit.file}:${hit.line}  ${hit.text}`);
    }

    if (result.ungated.some((hit) => hit.kind === "constructed path")) {
      console.log(
        "\n  A constructed path builds this location at runtime. No gate can follow it —\n" +
          "  update it in the SAME commit as the move, or it will silently point at the old location.",
      );
    }
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
