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
  const sites = [];
  const unresolved = [];

  const parseFailures = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    // Each entry says whether it persists: payload literals do, a property read
    // does not, and a dotted path does when it keys an update. All three are
    // scoped to our namespace by construction — `scanFlagLiterals` matches
    // nothing else — so they skip the foreign-scope branch below.
    const literals = scanFlagLiterals(source);
    if (literals.parseError) {
      // A first-party file the AST pass cannot read contributes no keys, which
      // would otherwise be indistinguishable from a file that genuinely has
      // none. Collect it and block rather than quietly scanning less.
      parseFailures.push(`${toRepoPath(file)}: ${literals.parseError}`);
      continue;
    }
    for (const entry of literals) {
      if (entry.dynamic) {
        dynamic.push(`${toRepoPath(file)}:${entry.line}`);
        continue;
      }
      (entry.writes ? written : read).add(entry.key);
    }

    for (const entry of scanFlags(source)) {
      // Receiver identity is recorded BEFORE the dynamic-key bail. The first
      // version pushed flagSites at the end of the loop, so all 98 dynamic-key
      // sites — including ordinary constant-key calls like
      // `actor.getFlag(MODULE_ID, DURATION_SPELL_FLAG)`, dynamic only because
      // the key is an identifier — carried no receiver at all, and an
      // actor -> scene swap in one of them still diffed to []. The key is
      // recorded as "*" for those; the receiver is what this entry is for.
      sites.push(
        `${toRepoPath(file)} (api=${entry.api} key=${entry.key ?? "*"} receiver=${entry.receiver})`,
      );

      if (entry.dynamic) {
        dynamic.push(`${toRepoPath(file)}:${entry.line}`);
        continue;
      }

      // A scope argument that is not a literal — usually `MODULE_ID`, sometimes
      // a parameter or an import — is treated as ours when it cannot be
      // resolved. Record the unresolved name so the assumption is visible in
      // the snapshot rather than silent (issue #95 finding 3).
      if (entry.unresolvedScope) {
        // api and key are part of the identity, not decoration: the diff below
        // compares these entries with the line stripped, so without them a site
        // REPLACED by a different flag operation in the same file and scope is
        // indistinguishable from the same site drifting down a few lines.
        // receiver closes the #128 gap: flag storage is document-specific, so
        // `actor.getFlag(MODULE_ID, "state")` and `scene.getFlag(MODULE_ID,
        // "state")` read different persisted values. Without it both produce
        // the same tuple and a refactor moving a read between document kinds
        // was invisible to the gate.
        unresolved.push(
          `${toRepoPath(file)}:${entry.line} `
          + `(api=${entry.api} key=${entry.key ?? "*"} scope=${entry.unresolvedScope} `
          + `receiver=${entry.receiver})`,
        );
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

  if (parseFailures.length > 0) {
    console.log("[BLOCK] flag snapshot: first-party files the AST scan could not parse —");
    for (const failure of parseFailures) console.log(`  ${failure}`);
    console.log(
      "  Their flag keys were NOT scanned. Fix the parse or raise the ecmaVersion; "
        + "do not regenerate the snapshot while this is unresolved.",
    );
    process.exit(1);
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
    flagSites: sites.sort(),
    unresolvedScopes: unresolved.sort(),
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

  // Compared by file+scope and COUNT, not by the exact `file:line (scope=…)`
  // string the snapshot stores. A site's line number moves whenever anything
  // above it is edited, so the exact-string compare turned every ordinary edit
  // into a wall of matched removed/added pairs — 50 of them blocked #126, each
  // one the same file and the same scope at a shifted line, none of them a
  // change to what the gate is actually watching. dynamicSites above already
  // takes this approach by comparing length alone.
  //
  // Signal preserved: a scope going unresolved in a file that had none, one
  // disappearing entirely, a changed count, and — because api and key are part
  // of the recorded identity — a site REPLACED by a different flag operation in
  // the same file and scope.
  //
  // THE RECEIVER GAP IS CLOSED (#128). Swapping `actor.getFlag(MODULE_ID,
  // "state")` for `scene.getFlag(MODULE_ID, "state")` used to keep api, key,
  // scope, file and count identical and stay invisible here, even though flag
  // storage is document-specific and the substitution changes where state is
  // read. flag-scan.mjs now records the receiver and it is part of the identity
  // below, so that swap reports as a removed site plus an added one.
  //
  // REMAINING GAP, stated rather than implied: a receiver the scanner cannot
  // read statically is recorded as "«dynamic»" (a call or computed index) or
  // "«unknown»". Two different documents reached through the same dynamic
  // expression still collapse to one identity. That is strictly narrower than
  // before, where every receiver collapsed, and it keeps the fact visible the
  // way dynamicSites does rather than dropping it.
  const byFileAndScope = (sites) => {
    const counts = new Map();
    for (const site of sites ?? []) {
      const key = site.replace(/:\d+\s/, " ");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  // flagSites carries the receiver for EVERY our-scope call, so an actor ->
  // scene swap reports even in a file whose MODULE_ID resolves locally and
  // therefore never appears in unresolvedScopes. Counted, never line-keyed.
  const siteCounts = (sites) => {
    const counts = new Map();
    for (const site of sites ?? []) counts.set(site, (counts.get(site) ?? 0) + 1);
    return counts;
  };
  const sitesBefore = siteCounts(baseline.flagSites);
  const sitesAfter = siteCounts(current.flagSites);
  for (const [site, before] of [...sitesBefore].sort()) {
    const after = sitesAfter.get(site) ?? 0;
    if (after === 0) differences.push(`flagSites: removed "${site}"`);
    else if (after !== before) differences.push(`flagSites: "${site}" ${before} -> ${after} site(s)`);
  }
  for (const [site] of [...sitesAfter].sort()) {
    if (!sitesBefore.has(site)) differences.push(`flagSites: added "${site}"`);
  }

  const unresolvedBefore = byFileAndScope(baseline.unresolvedScopes);
  const unresolvedAfter = byFileAndScope(current.unresolvedScopes);
  for (const [site, before] of [...unresolvedBefore].sort()) {
    const after = unresolvedAfter.get(site) ?? 0;
    if (after === 0) differences.push(`unresolvedScopes: removed "${site}"`);
    else if (after !== before) differences.push(`unresolvedScopes: "${site}" ${before} -> ${after} site(s)`);
  }
  for (const [site] of [...unresolvedAfter].sort()) {
    if (!unresolvedBefore.has(site)) differences.push(`unresolvedScopes: added "${site}"`);
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
