#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { scanExports } from "./export-scan.mjs";
import { REPO_ROOT } from "./project-scan.mjs";

/**
 * API-export snapshot gate.
 *
 * `module.json` declares four esmodules. Their exported names, plus the live
 * `module.api` key set, are the module's public surface — the one thing Phase 3
 * must not disturb while it cuts registration groups out of the composition
 * root and re-homes them behind re-exports.
 *
 * TWO PARTS, TWO CADENCES:
 *  - `esmodules` is parsed statically and compared on EVERY structural commit.
 *  - `moduleApi` can only be read from a running world, so it is a recorded
 *    baseline re-checked at each phase end, not a per-commit gate.
 *
 * NECESSARY, NOT SUFFICIENT: this compares names. A changed parameter or return
 * shape breaks a consumer with the whole file still green. Never report a green
 * snapshot as proof the API contract held.
 *
 * Keyed by basename, like the registration snapshot, so a Phase 2 move that
 * updates the manifest path in the same commit does not churn the baseline.
 */

const SNAPSHOT_PATH = new URL("../snapshots/api-exports.json", import.meta.url);
const MANIFEST_PATH = new URL("../../module.json", import.meta.url);

export function collectEsmoduleExports() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const declared = manifest.esmodules ?? [];
  const esmodules = {};
  const missing = [];

  for (const relativePath of declared) {
    const absolute = path.join(REPO_ROOT, relativePath);
    let source;
    try {
      source = readFileSync(absolute, "utf8");
    } catch {
      missing.push(relativePath);
      continue;
    }
    const { names, starExports } = scanExports(source);
    const entry = { names };
    if (starExports.length > 0) entry.starExports = starExports;
    esmodules[path.basename(relativePath)] = entry;
  }

  return { declaredCount: declared.length, esmodules: sortKeys(esmodules), missing };
}

function sortKeys(object) {
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
}

export function diffExports(baseline, current) {
  const differences = [];

  if (baseline.declaredCount !== current.declaredCount) {
    differences.push(`module.json declares ${current.declaredCount} esmodules, baseline had ${baseline.declaredCount}`);
  }

  for (const key of Object.keys(current.esmodules)) {
    if (!(key in baseline.esmodules)) differences.push(`new declared esmodule: ${key}`);
  }

  for (const [key, before] of Object.entries(baseline.esmodules)) {
    const after = current.esmodules[key];
    if (!after) {
      differences.push(`declared esmodule no longer present: ${key}`);
      continue;
    }
    for (const name of before.names) {
      if (!after.names.includes(name)) differences.push(`${key}: export removed: ${name}`);
    }
    for (const name of after.names) {
      if (!before.names.includes(name)) differences.push(`${key}: export added: ${name}`);
    }
    const beforeStars = (before.starExports ?? []).join(",");
    const afterStars = (after.starExports ?? []).join(",");
    if (beforeStars !== afterStars) differences.push(`${key}: star re-exports changed: [${beforeStars}] -> [${afterStars}]`);
  }

  return differences;
}

function main() {
  const write = process.argv.includes("--write");
  const current = collectEsmoduleExports();

  if (current.missing.length > 0) {
    for (const relativePath of current.missing) {
      console.log(`[BLOCK] module.json declares a missing esmodule: ${relativePath}`);
    }
    process.exit(1);
  }

  let baseline = null;
  try {
    baseline = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch {
    baseline = null;
  }

  if (write) {
    const next = {
      $comment:
        "Public surface baseline. `esmodules` is static and gated on every structural commit; `moduleApi` is " +
        "read from a live world and re-checked at phase ends. Name stability only — a changed signature breaks " +
        "consumers with this file still green. Regenerate with: npm run snapshot:api -- --write",
      declaredCount: current.declaredCount,
      esmodules: current.esmodules,
      // A live capture is preserved across regenerations; it cannot be produced headlessly.
      moduleApi: baseline?.moduleApi ?? { recordedAt: null, foundry: null, keys: [] },
    };
    mkdirSync(new URL(".", SNAPSHOT_PATH), { recursive: true });
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(next, null, 2)}\n`);
    const total = Object.values(current.esmodules).reduce((sum, entry) => sum + entry.names.length, 0);
    console.log(`api-export snapshot: wrote ${total} export names across ${current.declaredCount} declared esmodules`);
    return;
  }

  if (!baseline) {
    console.log("[BLOCK] api-export snapshot: no baseline. Generate it with --write.");
    process.exit(1);
  }

  const differences = diffExports(baseline, current);
  const total = Object.values(current.esmodules).reduce((sum, entry) => sum + entry.names.length, 0);
  console.log(`api-export snapshot: ${total} export names across ${current.declaredCount} declared esmodules`);

  if (differences.length > 0) {
    for (const difference of differences) console.log(`  ${difference}`);
    console.log(`[BLOCK] ${differences.length} public-surface difference(s).`);
    process.exit(1);
  }

  if ((baseline.moduleApi?.keys?.length ?? 0) === 0) {
    console.log("[NOTE]  module.api key set not yet captured from a live world (required at each phase end).");
  }

  console.log("api-export snapshot: OK");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
