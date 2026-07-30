#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";

import { scanImports, classifyTarget } from "./import-scan.mjs";
import { listJsFiles, toRepoPath, REPO_ROOT } from "./project-scan.mjs";

/**
 * Blocking gate for the feature-reorganization structural track: every static
 * and literal dynamic relative import must resolve to a file that exists.
 *
 * `dev/tests` and `dev/tools` are in scope deliberately. Test files import
 * scripts by relative path, so a stale test specifier blocks the same commit
 * that must repair it; and the gates themselves would be worthless if their own
 * imports could rot unnoticed.
 *
 * Computed dynamic imports (template literals with substitutions) cannot be
 * resolved statically. They are reported as manual smoke-test obligations, not
 * failures. There are zero in the tree today.
 */

/**
 * `data` here is the REPO-ROOT `data/` directory — a different thing from
 * `scripts/data/`, and easy to confuse. It holds one shipped runtime module
 * (`creature-type-map.mjs`) that the feature map does not yet inventory.
 */
export const SCAN_ROOTS = ["scripts", "data", "dev/tests", "dev/tools"];

/**
 * `repoRoot` is injectable alongside `roots` so the gate can be proved against
 * a fixture tree: target classification is relative to the module root, and a
 * fixture outside it would otherwise be reported as escaping the modules
 * directory rather than as a plain missing file.
 *
 * @returns {{missing: Array, computed: Array, external: Array, checked: number, files: number}}
 */
export function resolveProjectImports(roots = SCAN_ROOTS, repoRoot = REPO_ROOT) {
  const missing = [];
  const computed = [];
  const external = [];
  let checked = 0;

  const files = listJsFiles(roots);
  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const entry of scanImports(source)) {
      if (entry.computed) {
        if (entry.relative) {
          computed.push({ file: toRepoPath(file), line: entry.line, raw: entry.raw, kind: entry.kind });
        }
        continue;
      }
      if (!entry.relative) continue;

      checked += 1;
      const target = classifyTarget(repoRoot, file, entry.specifier);
      const where = { file: toRepoPath(file), line: entry.line, kind: entry.kind, specifier: entry.specifier };

      if (target.scope === "sibling-module") {
        let installed = false;
        try {
          installed = statSync(target.resolved).isFile();
        } catch {
          installed = false;
        }
        external.push({ ...where, module: target.siblingModule, installed });
        continue;
      }

      if (target.scope === "escaped") {
        missing.push({ ...where, expected: target.resolved, reason: "escapes the Foundry modules directory" });
        continue;
      }

      let exists = false;
      try {
        exists = statSync(target.resolved).isFile();
      } catch {
        exists = false;
      }
      if (!exists) {
        missing.push({ ...where, expected: toRepoPath(target.resolved), reason: "file does not exist" });
      }
    }
  }

  return { missing, computed, external, checked, files: files.length };
}

function main() {
  const asJson = process.argv.includes("--json");
  const result = resolveProjectImports();

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.missing.length === 0 ? 0 : 1);
  }

  console.log(
    `relative-import resolver: ${result.checked} relative imports across ${result.files} modules`,
  );

  for (const entry of result.computed) {
    console.log(
      `[NOTE]  computed dynamic import (manual smoke test): ${entry.file}:${entry.line} -> \`${entry.raw}\``,
    );
  }

  for (const entry of result.external) {
    console.log(
      `[NOTE]  optional sibling module "${entry.module}" (${entry.installed ? "installed here" : "not installed here"}): ` +
        `${entry.file}:${entry.line} -> ${entry.specifier}`,
    );
  }

  for (const entry of result.missing) {
    console.log(
      `${entry.file}:${entry.line}: ${entry.kind} import "${entry.specifier}" -> ${entry.reason}: ${entry.expected}`,
    );
  }

  if (result.missing.length > 0) {
    console.log(`[BLOCK] ${result.missing.length} unresolved relative import(s)`);
    process.exit(1);
  }

  console.log("relative-import resolver: OK");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
