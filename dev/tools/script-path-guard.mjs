#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { listJsFiles, toRepoPath, isVendor } from "./project-scan.mjs";

/**
 * Blocking gate for the feature-reorganization structural track.
 *
 * The track's whole premise is that script file paths are *not* a stable
 * contract — moving them is the point. That only holds while nothing in the
 * shipped tree addresses a script by absolute path. A string like
 * `modules/shadowdark-extras/scripts/AuraEffectsSD.mjs` is invisible to the
 * import resolver and would break silently on the move that renames it.
 *
 * The count is zero today. This guard exists so it stays zero.
 *
 * Out of scope by design: Handlebars template paths, style, pack, and language
 * paths (those are rename invariants and do not move), documentation, and dev
 * tooling — the planning documents necessarily contain the string.
 */

const MODULE_ID = JSON.parse(readFileSync(new URL("../../module.json", import.meta.url), "utf8")).id;

export const FORBIDDEN = `modules/${MODULE_ID}/scripts/`;

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
    const source = readFileSync(file, "utf8");
    if (!source.includes(FORBIDDEN)) continue;
    source.split("\n").forEach((text, index) => {
      if (text.includes(FORBIDDEN)) {
        hits.push({ file: toRepoPath(file), line: index + 1, text: text.trim() });
      }
    });
  }

  return { hits, files: files.length };
}

function main() {
  const { hits, files } = findScriptPathStrings();
  console.log(`script-path guard: ${files} shipped modules checked for "${FORBIDDEN}"`);

  for (const hit of hits) {
    console.log(`${hit.file}:${hit.line}: ${hit.text}`);
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
