#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { listJsFiles, toRepoPath, isVendor } from "./project-scan.mjs";

/**
 * Blocking gate for the feature-reorganization structural track.
 *
 * The track's whole premise is that script file paths are *not* a stable
 * contract — moving them is the point. That only holds while nothing in the
 * shipped tree addresses a MOVABLE script by absolute path. Such a string is
 * invisible to the import resolver and breaks silently on the move that
 * renames it.
 *
 * CORRECTED DURING PHASE 2. The first version searched only for the fully
 * literal `modules/shadowdark-extras/scripts/…` and reported a clean tree.
 * There are indeed zero of those — but seventeen INTERPOLATED ones,
 * `modules/${MODULE_ID}/scripts/…`, which it could never have matched. Since
 * MODULE_ID is a local constant in 99 files, the interpolated spelling is the
 * normal one here: the guard was blind to the majority case while reporting
 * success. Found while assessing the MapHub adapter move, not by the guard.
 *
 * All seventeen point at targets that genuinely never move — the vendored
 * MapHub tree and the retained scripts/data/ JSON — so the fix was to match
 * both spellings and allowlist those targets, rather than to ban the shape.
 *
 * Out of scope by design: Handlebars template paths, style, pack, and language
 * paths (those are rename invariants and do not move), documentation, and dev
 * tooling — the planning documents necessarily contain the string.
 */

const MODULE_ID = JSON.parse(readFileSync(new URL("../../module.json", import.meta.url), "utf8")).id;

export const FORBIDDEN = `modules/${MODULE_ID}/scripts/`;

/**
 * Absolute script paths appear in TWO spellings, and the second is the common
 * one in this codebase:
 *
 *   "modules/shadowdark-extras/scripts/X"     fully literal — zero of these
 *   `modules/${MODULE_ID}/scripts/X`          interpolated  — seventeen
 *
 * MODULE_ID is a local constant in 99 files, so a guard that only searched for
 * the literal spelling reported "clean" while being blind to the majority form.
 */
const ABSOLUTE_PATH = new RegExp(
  String.raw`modules/(?:${MODULE_ID}|\$\{[A-Za-z_$][\w$]*\})/scripts/([A-Za-z0-9_./-]*)`,
  "g",
);

/**
 * Targets that are addressed absolutely on purpose and never move:
 *   maphub/ — the vendored generator tree, served as static assets by URL
 *   data/   — the retained shared JSON collection
 * Anything else under scripts/ is a movable module, and addressing it by
 * absolute path is what this guard exists to prevent.
 */
const IMMOVABLE_TARGETS = [/^maphub(\/|$)/, /^data\//];

/**
 * @param {string} source
 * @param {string} repoPath for reporting
 * @returns {Array<{line: number, target: string, text: string}>}
 */
export function findAbsoluteScriptPaths(source, repoPath) {
  const hits = [];
  source.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(ABSOLUTE_PATH)) {
      const target = match[1];
      if (IMMOVABLE_TARGETS.some((allowed) => allowed.test(target))) continue;
      hits.push({ file: repoPath, line: index + 1, target, text: text.trim() });
    }
  });
  return hits;
}

/**
 * SDX-authored files that live inside a vendored tree. The plan classifies
 * `OnePageParserSD` with the MapHub adapter rather than with vendor code, so it
 * is held to SDX authoring rules even though its neighbours are not.
 */
const VENDOR_TREE_EXCEPTIONS = ["scripts/maphub/OnePageParserSD.mjs"];

/**
 * `roots` is injectable so the safeguard can be proved against a fixture tree
 * without committing a deliberately broken path into the real one.
 *
 * Repo-root `data/` also ships runtime ESM — not to be confused with `scripts/data/`.
 */
export function findScriptPathStrings(roots = ["scripts", "data"]) {
  const files = listJsFiles(roots).filter((file) => {
    const repoPath = toRepoPath(file);
    return !isVendor(repoPath) || VENDOR_TREE_EXCEPTIONS.includes(repoPath);
  });

  const hits = [];
  for (const file of files) {
    hits.push(...findAbsoluteScriptPaths(readFileSync(file, "utf8"), toRepoPath(file)));
  }

  return { hits, files: files.length };
}

function main() {
  const { hits, files } = findScriptPathStrings();
  console.log(`script-path guard: ${files} shipped modules checked for absolute script paths (literal and interpolated)`);

  for (const hit of hits) {
    console.log(`${hit.file}:${hit.line}: -> scripts/${hit.target}  |  ${hit.text}`);
  }

  if (hits.length > 0) {
    console.log(
      `[BLOCK] ${hits.length} absolute script path(s). Script paths move during the structural track; ` +
        "import relatively or route through the module API instead.",
    );
    process.exit(1);
  }

  console.log("script-path guard: OK");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
