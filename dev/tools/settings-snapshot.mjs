#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { scanSettings } from "./settings-scan.mjs";
import { listJsFiles, toRepoPath, isVendor } from "./project-scan.mjs";

/**
 * Settings-key snapshot gate.
 *
 * Settings keys and settings-menu ids are stored in every GM's world. A rename
 * does not throw — the stored value is orphaned and the setting silently
 * reverts to its default, which is the kind of regression that surfaces weeks
 * later as "my config keeps resetting".
 *
 * COVERAGE IS PARTIAL BY CONSTRUCTION, AND THE GAP IS REPORTED. A dozen-odd
 * call sites build their key from a variable or a loop; those cannot be
 * enumerated statically. The live world currently registers 156 keys while this
 * gate can see ~140, so the count of dynamic sites is part of the baseline —
 * if it moves, the blind spot moved. The Quench batch
 * (`shadowdark-extras.structural`) is what covers all 156 at runtime; this gate
 * is the cheap per-commit tier that catches a removal before Foundry is opened.
 */

const SNAPSHOT_PATH = new URL("../snapshots/settings-keys.json", import.meta.url);
const VENDOR_TREE_EXCEPTIONS = ["scripts/maphub/OnePageParserSD.mjs"];

/**
 * Keys whose registration sits behind an optional-module check, so they are
 * absent from a world where that module is disabled. `AutoAnimationsSD`'s
 * `registerSettings()` returns early unless `autoanimations` is active.
 *
 * This exists so the runtime half of the check (the
 * `shadowdark-extras.structural` Quench batch) does not demand a key that
 * legitimately cannot be there. Verified empirically: with `autoanimations`
 * installed but disabled, these three are the ONLY statically-found keys
 * missing from the live registry — every other static key was present.
 *
 * Hand-maintained, and deliberately fails closed: a new gated key shows up as
 * a batch failure until it is listed here, which is the safe direction.
 */
const OPTIONAL_MODULE_GATED = {
  autoanimations: ["aaAnimateOnSuccess", "aaAnimateSpellsWithoutTarget", "aaIntegration"],
};

export function collectSettingsKeys() {
  const files = listJsFiles(["scripts", "data"]).filter((file) => {
    const repoPath = toRepoPath(file);
    return !isVendor(repoPath) || VENDOR_TREE_EXCEPTIONS.includes(repoPath);
  });

  const keys = new Set();
  const menus = new Set();
  const dynamic = [];

  for (const file of files) {
    for (const entry of scanSettings(readFileSync(file, "utf8"))) {
      if (entry.dynamic) {
        dynamic.push(`${toRepoPath(file)}:${entry.line}`);
        continue;
      }
      (entry.api === "registerMenu" ? menus : keys).add(entry.key);
    }
  }

  return {
    keys: [...keys].sort(),
    menus: [...menus].sort(),
    optionalModuleGated: OPTIONAL_MODULE_GATED,
    dynamicSites: dynamic.sort(),
  };
}

export function diffSettings(baseline, current) {
  const differences = [];

  for (const field of ["keys", "menus"]) {
    for (const name of baseline[field]) {
      if (!current[field].includes(name)) {
        differences.push(`${field}: REMOVED "${name}" — stored world values would be orphaned`);
      }
    }
    for (const name of current[field]) {
      if (!baseline[field].includes(name)) differences.push(`${field}: added "${name}"`);
    }
  }

  if (baseline.dynamicSites.length !== current.dynamicSites.length) {
    differences.push(
      `dynamic (unenumerable) call sites: ${baseline.dynamicSites.length} -> ${current.dynamicSites.length} — ` +
        "the gate's blind spot changed size",
    );
  }

  return differences;
}

function main() {
  const current = collectSettingsKeys();

  if (process.argv.includes("--write")) {
    let previous = null;
    try {
      previous = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    } catch {
      previous = null;
    }

    mkdirSync(new URL(".", SNAPSHOT_PATH), { recursive: true });
    writeFileSync(
      SNAPSHOT_PATH,
      `${JSON.stringify(
        {
          $comment:
            "Settings keys and menu ids are stored in user worlds; renaming one silently orphans every GM's " +
            "configured value. Statically enumerable keys only — dynamicSites records the call sites this scan " +
            "cannot read, and the live total is verified by the shadowdark-extras.structural Quench batch. " +
            "Regenerate with a reviewed reason: npm run snapshot:settings -- --write",
          ...current,
          /**
           * Live registry size at capture time, EXCLUDING any optional-module-gated
           * key that happened to be active then. Cannot be produced headlessly, so
           * it is preserved across regeneration like api-exports.json's moduleApi.
           * The Quench batch adds back the gated keys whose module is active in the
           * world under test, which makes the expectation world-independent.
           */
          liveKeyTotalExcludingGated: previous?.liveKeyTotalExcludingGated ?? null,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `settings snapshot: wrote ${current.keys.length} keys, ${current.menus.length} menus, ` +
        `${current.dynamicSites.length} dynamic sites`,
    );
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch {
    console.log("[BLOCK] settings snapshot: no baseline. Generate it with --write.");
    process.exit(1);
  }

  const differences = diffSettings(baseline, current);
  console.log(
    `settings snapshot: ${current.keys.length} keys, ${current.menus.length} menus ` +
      `(${current.dynamicSites.length} dynamic sites not statically enumerable)`,
  );

  if (differences.length > 0) {
    for (const difference of differences) console.log(`  ${difference}`);
    console.log(`[BLOCK] ${differences.length} settings-identity change(s). Keys are a rename invariant.`);
    process.exit(1);
  }

  console.log("settings snapshot: OK");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
