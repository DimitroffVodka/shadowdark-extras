#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { scanRegistrations } from "./registration-scan.mjs";
import { listJsFiles, toRepoPath, isVendor } from "./project-scan.mjs";
import { sortKeys } from "./snapshot-util.mjs";

/**
 * Registration-order snapshot gate.
 *
 * WHAT THIS PROVES: the set and per-module source order of `Hooks.on/once/off`,
 * `libWrapper.register`, and socketlib registration call sites is unchanged.
 *
 * WHAT IT DOES NOT PROVE: runtime firing order. Registrations made inside
 * `init`/`ready` callbacks, conditionals, or nested functions appear here in
 * call-site order, which is not the order Foundry executes them. Proving
 * runtime behaviour is the smoke matrix's job, and a green snapshot must never
 * be reported as more than name-and-order stability.
 *
 * KEYED BY BASENAME, NOT PATH. Phase 2 moves every one of these files into a
 * feature folder; keying by path would make the baseline mismatch on every move
 * commit and train everyone to regenerate it, which is precisely how a real
 * reordering gets waved through. Basenames are unique across all 139 modules
 * and the track does not rename files, so the key survives the moves that the
 * order must survive.
 *
 * Line numbers are excluded for the same reason: an unrelated bug fix on main
 * shifts every line below it without changing a single registration.
 */

const SNAPSHOT_PATH = new URL("../snapshots/registrations.json", import.meta.url);

/** SDX-authored code inside the vendored MapHub tree is held to SDX rules. */
const VENDOR_TREE_EXCEPTIONS = ["scripts/maphub/OnePageParserSD.mjs"];

export function collectRegistrations() {
  // Repo-root `data/` also ships runtime ESM — not to be confused with `scripts/data/`.
  const files = listJsFiles(["scripts", "data"]).filter((file) => {
    const repoPath = toRepoPath(file);
    return !isVendor(repoPath) || VENDOR_TREE_EXCEPTIONS.includes(repoPath);
  });

  const modules = {};
  const totals = {};
  const detail = [];

  for (const file of files) {
    const registrations = scanRegistrations(readFileSync(file, "utf8"));
    if (registrations.length === 0) continue;

    const key = path.basename(file);
    modules[key] = registrations.map((entry) => `${entry.api}:${entry.dynamic ? "<dynamic>" : entry.name}`);
    detail.push({ file: toRepoPath(file), key, registrations });

    for (const entry of registrations) {
      totals[entry.api] = (totals[entry.api] ?? 0) + 1;
    }
  }

  totals.all = Object.values(totals).reduce((sum, count) => sum + count, 0);
  return { totals, modules: sortKeys(modules), detail };
}


function buildSnapshot() {
  const { totals, modules } = collectRegistrations();
  return {
    $comment:
      "Static registration call-site inventory. Keyed by module basename so it survives feature-folder " +
      "moves. Order within each module is the contract; runtime firing order is proved by the smoke matrix, " +
      "not by this file. Regenerate only with a reviewed reason: npm run snapshot:registrations -- --write",
    totals,
    modules,
  };
}

export function readSnapshot() {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
}

/**
 * @returns {string[]} human-readable differences; empty when the gate passes
 */
export function diffSnapshot(baseline, current) {
  const differences = [];

  for (const [api, count] of Object.entries(current.totals)) {
    const before = baseline.totals[api] ?? 0;
    if (before !== count) differences.push(`total ${api}: ${before} -> ${count}`);
  }
  for (const api of Object.keys(baseline.totals)) {
    if (!(api in current.totals)) differences.push(`total ${api}: ${baseline.totals[api]} -> 0`);
  }

  for (const key of Object.keys(current.modules)) {
    if (!(key in baseline.modules)) {
      differences.push(`new module with registrations: ${key} (${current.modules[key].length})`);
    }
  }

  for (const [key, before] of Object.entries(baseline.modules)) {
    const after = current.modules[key];
    if (!after) {
      differences.push(`module lost all registrations: ${key} (had ${before.length})`);
      continue;
    }
    if (before.length !== after.length) {
      differences.push(`${key}: ${before.length} -> ${after.length} registrations`);
    }
    const limit = Math.min(before.length, after.length);
    for (let i = 0; i < limit; i += 1) {
      if (before[i] !== after[i]) {
        differences.push(`${key}[${i}]: ${before[i]} -> ${after[i]}`);
        break;
      }
    }
  }

  return differences;
}

function main() {
  const write = process.argv.includes("--write");
  const current = buildSnapshot();

  if (write) {
    mkdirSync(new URL(".", SNAPSHOT_PATH), { recursive: true });
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`registration snapshot: wrote ${current.totals.all} call sites across ${Object.keys(current.modules).length} modules`);
    return;
  }

  let baseline;
  try {
    baseline = readSnapshot();
  } catch {
    console.log("[BLOCK] registration snapshot: no baseline. Generate it with --write.");
    process.exit(1);
  }

  const differences = diffSnapshot(baseline, current);
  console.log(
    `registration snapshot: ${current.totals.all} call sites across ${Object.keys(current.modules).length} modules`,
  );

  if (differences.length > 0) {
    for (const difference of differences) console.log(`  ${difference}`);
    console.log(
      `[BLOCK] ${differences.length} registration difference(s). ` +
        "Registration order is observable behaviour — explain the change before regenerating the baseline.",
    );
    process.exit(1);
  }

  console.log("registration snapshot: OK");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
