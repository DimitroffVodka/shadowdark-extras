#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { scanFlags, scanFlagLiterals } from "./flag-scan.mjs";
import { listJsFiles, toRepoPath, isVendor } from "./project-scan.mjs";

/**
 * Document-flag snapshot gate.
 *
 * The sibling of the settings-key gate, for the persistence channel that had
 * no gate at all. A flag key is stored on a document in the GM's world; rename
 * it and every existing document keeps the old key, unread, while the code
 * reads a new one that is never there. No error, no warning — the scene just
 * comes back blank.
 *
 * Written for the sweep 6 hex/dungeon split, where four files over the size bar
 * carry eight flag keys between them, but the gate is repo-wide because the
 * hazard is.
 *
 * WRITTEN AND READ KEYS ARE TRACKED SEPARATELY. A pure file split moves call
 * sites without changing either set, so both staying still is the signal. A key
 * that loses every write site but keeps its reads is dead persistence; a key
 * that loses every read site is a write nobody consumes. Neither shows up in a
 * combined list.
 */

const SNAPSHOT_PATH = new URL("../snapshots/flag-keys.json", import.meta.url);
const MODULE_ID = "shadowdark-extras";

export function collectFlagKeys() {
  const files = listJsFiles(["scripts", "data"]).filter(
    (file) => !isVendor(toRepoPath(file)),
  );

  const written = new Set();
  const read = new Set();
  const foreign = {};
  const dynamic = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    // Payload literals persist, so they are writes; property access only reads.
    // Both are scoped to our namespace by construction — `scanFlagLiterals`
    // matches nothing else — so they skip the foreign-scope branch below.
    for (const entry of scanFlagLiterals(source)) {
      if (entry.dynamic) {
        dynamic.push(`${toRepoPath(file)}:${entry.line}`);
        continue;
      }
      (entry.api === "payload" ? written : read).add(entry.key);
    }

    for (const entry of scanFlags(source)) {
      if (entry.dynamic) {
        dynamic.push(`${toRepoPath(file)}:${entry.line}`);
        continue;
      }

      // A literal scope naming another package ("core", "tokenmagic",
      // "item-piles") is an integration read, not our stored data, so those are
      // tracked apart to keep our own key list legible. Our own id written as a
      // literal instead of MODULE_ID is still ours — a couple of dozen sites do
      // that, and filing them as foreign would hide real keys from the gate.
      if (!entry.dynamicScope && entry.scope !== MODULE_ID) {
        (foreign[entry.scope] ??= new Set()).add(entry.key);
        continue;
      }

      (entry.api === "getFlag" ? read : written).add(entry.key);
    }
  }

  return {
    writtenKeys: [...written].sort(),
    readKeys: [...read].sort(),
    foreignScopes: Object.fromEntries(
      Object.keys(foreign)
        .sort()
        .map((scope) => [scope, [...foreign[scope]].sort()]),
    ),
    dynamicSites: dynamic.sort(),
  };
}

export function diffFlags(baseline, current) {
  const differences = [];

  for (const field of ["writtenKeys", "readKeys"]) {
    for (const name of baseline[field]) {
      if (!current[field].includes(name)) {
        differences.push(
          `${field}: REMOVED "${name}" — stored document flags would be orphaned`,
        );
      }
    }
    for (const name of current[field]) {
      if (!baseline[field].includes(name)) differences.push(`${field}: added "${name}"`);
    }
  }

  const scopes = new Set([
    ...Object.keys(baseline.foreignScopes),
    ...Object.keys(current.foreignScopes),
  ]);
  for (const scope of [...scopes].sort()) {
    const before = baseline.foreignScopes[scope] ?? [];
    const after = current.foreignScopes[scope] ?? [];
    for (const name of before) {
      if (!after.includes(name)) {
        differences.push(`foreignScopes.${scope}: REMOVED "${name}" — integration read dropped`);
      }
    }
    for (const name of after) {
      if (!before.includes(name)) differences.push(`foreignScopes.${scope}: added "${name}"`);
    }
  }

  if (baseline.dynamicSites.length !== current.dynamicSites.length) {
    differences.push(
      `dynamic (unenumerable) call sites: ${baseline.dynamicSites.length} -> ` +
        `${current.dynamicSites.length} — the gate's blind spot changed size`,
    );
  }

  return differences;
}

function main() {
  const current = collectFlagKeys();

  if (process.argv.includes("--write")) {
    mkdirSync(new URL(".", SNAPSHOT_PATH), { recursive: true });
    writeFileSync(
      SNAPSHOT_PATH,
      `${JSON.stringify(
        {
          $comment:
            "Document flag keys are stored on scenes, journals and actors in user worlds; renaming one " +
            "silently orphans the data every existing document already carries. Reads are listed as well as " +
            "writes because some keys (hexGenJournal) are only ever written inside a document-creation " +
            "payload, which no static scan of method calls can see. Value SHAPES are frozen separately, by " +
            "dev/tests/hex-dungeon-persistence.test.mjs. Regenerate with a reviewed reason: " +
            "npm run snapshot:flags -- --write",
          ...current,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `flag snapshot: wrote ${current.writtenKeys.length} written keys, ` +
        `${current.readKeys.length} read-only keys, ${current.dynamicSites.length} dynamic sites`,
    );
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch {
    console.log("[BLOCK] flag snapshot: no baseline. Generate it with --write.");
    process.exit(1);
  }

  const differences = diffFlags(baseline, current);
  console.log(
    `flag snapshot: ${current.writtenKeys.length} written keys, ${current.readKeys.length} read-only keys ` +
      `(${current.dynamicSites.length} dynamic sites not statically enumerable)`,
  );

  if (differences.length > 0) {
    for (const difference of differences) console.log(`  ${difference}`);
    console.log(`[BLOCK] ${differences.length} flag-identity change(s). Keys are a rename invariant.`);
    process.exit(1);
  }

  console.log("flag snapshot: OK");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
