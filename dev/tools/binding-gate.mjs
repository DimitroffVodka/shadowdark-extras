#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { findUnboundCalls } from "./binding-scan.mjs";
import { listJsFiles, toRepoPath, isVendor } from "./project-scan.mjs";

/**
 * Blocking gate: no NEW unbound call identifiers.
 *
 * WHY IT EXISTS. Three Phase 3 extractions shipped code that called helpers left
 * behind in the composition root, and two used MODULE_ID without importing it.
 * Every one of the five existing gates passed: the resolver checks import PATHS,
 * not whether names are bound; `node --check` accepts a free identifier as valid
 * syntax; the snapshots compare names, not scopes; and the tests never execute a
 * Foundry hook callback. The defect surfaces only when a user triggers the hook
 * and it throws ReferenceError. Review caught it, not tooling.
 *
 * WHY IT GATES THE DELTA, NOT THE ABSOLUTE. Resolving every identifier without a
 * real scope-accurate parser leaves a residue of false positives — nested
 * declarations and globals not on the list. Sixty-one exist today. Demanding
 * zero would mean either an unreliable parser or a pile of suppressions, so the
 * baseline records what is here and the gate blocks anything NEW. That is enough
 * to catch an extraction that leaves a dangling reference, which is the whole
 * point. The same shape as the settings gate's dynamicSites count.
 */

const SNAPSHOT_PATH = new URL("../snapshots/unbound-calls.json", import.meta.url);
const VENDOR_TREE_EXCEPTIONS = ["scripts/maphub/OnePageParserSD.mjs"];

export function collectUnbound() {
  const files = listJsFiles(["scripts"]).filter((file) => {
    const repoPath = toRepoPath(file);
    return !isVendor(repoPath) || VENDOR_TREE_EXCEPTIONS.includes(repoPath);
  });

  const byFile = {};
  let total = 0;
  for (const file of files) {
    const hits = findUnboundCalls(readFileSync(file, "utf8"));
    if (hits.length === 0) continue;
    byFile[toRepoPath(file)] = hits.map((h) => h.name).sort();
    total += hits.length;
  }
  return { total, byFile: Object.fromEntries(Object.keys(byFile).sort().map((k) => [k, byFile[k]])) };
}

export function diffUnbound(baseline, current) {
  const differences = [];
  for (const [file, names] of Object.entries(current.byFile)) {
    const before = new Set(baseline.byFile[file] ?? []);
    for (const name of names) {
      if (!before.has(name)) differences.push(`${file}: NEW unbound call "${name}" — nothing binds it in this module`);
    }
  }
  return differences;
}

function main() {
  const current = collectUnbound();

  if (process.argv.includes("--write")) {
    mkdirSync(new URL(".", SNAPSHOT_PATH), { recursive: true });
    writeFileSync(
      SNAPSHOT_PATH,
      `${JSON.stringify(
        {
          $comment:
            "Accepted unbound call identifiers. The gate blocks anything NEW, not the absolute count — resolving " +
            "every identifier without a scope-accurate parser leaves a residue of nested declarations and " +
            "unlisted globals. New entries almost always mean an extraction left a dangling reference. " +
            "Regenerate only with a reviewed reason: npm run gate:bindings -- --write",
          ...current,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`binding gate: baselined ${current.total} accepted unbound identifiers`);
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch {
    console.log("[BLOCK] binding gate: no baseline. Generate it with --write.");
    process.exit(1);
  }

  const differences = diffUnbound(baseline, current);
  console.log(`binding gate: ${current.total} unbound call identifiers (${baseline.total} accepted)`);

  if (differences.length > 0) {
    for (const d of differences) console.log(`  ${d}`);
    console.log(
      `[BLOCK] ${differences.length} new unbound identifier(s). An extracted module that calls a helper left ` +
        "behind, or reads a constant it never imported, throws ReferenceError only when the hook fires.",
    );
    process.exit(1);
  }

  console.log("binding gate: OK");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
