#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { scanUnescapedAttrs } from "./attr-escape-scan.mjs";
import { listJsFiles, toRepoPath, isVendor } from "./project-scan.mjs";

/**
 * Blocking gate: no NEW unescaped attribute interpolations.
 *
 * WHY IT GATES THE DELTA, NOT THE ABSOLUTE. #125 counted ~90 unescaped sites
 * across 26 files. Demanding zero would mean either blocking every commit until
 * all of them are fixed, or fixing them in one unreviewable sweep. The baseline
 * records what exists and the gate blocks anything NEW, so the cleanup can
 * proceed file by file while the class stays closed to regressions. Same shape
 * as the binding gate and the settings gate's dynamicSites count.
 *
 * WHY IDENTITY EXCLUDES THE LINE NUMBER. #127 learned this the expensive way:
 * an exact `file:line` identity turned every line shift in a touched file into a
 * blocking finding — 50 spurious findings in one diff, which is how a gate
 * trains people to regenerate baselines without reading them. Identity here is
 * `file + attribute + expression text`, counted. A site that moves is silent; a
 * site that appears, or an existing expression that gains an occurrence, is not.
 *
 * Line numbers are still RECORDED, because the first thing anyone does with a
 * finding is go look at it. They are simply not part of the comparison.
 *
 * FIXING A SITE IS NOT A FAILURE. Removing an entry never blocks. Regenerate
 * with `npm run gate:attr-escape -- --write` after a cleanup commit, and the
 * baseline shrinks. It should only ever shrink.
 */

const SNAPSHOT_PATH = new URL("../snapshots/unescaped-attrs.json", import.meta.url);

/** `file: attr=expr` — the identity the gate compares, without the line. */
function identity(file, finding) {
  return `${file}: ${finding.attr}=${finding.expr}`;
}

export function collectUnescaped() {
  const files = listJsFiles(["scripts"]).filter((file) => !isVendor(toRepoPath(file)));

  const byFile = {};
  let total = 0;
  for (const file of files) {
    const findings = scanUnescapedAttrs(readFileSync(file, "utf8"));
    if (findings.length === 0) continue;
    byFile[toRepoPath(file)] = findings
      .map((f) => `${f.attr}=${f.expr} (line ${f.line})`)
      .sort();
    total += findings.length;
  }

  return {
    total,
    files: Object.keys(byFile).length,
    byFile: Object.fromEntries(Object.keys(byFile).sort().map((k) => [k, byFile[k]])),
  };
}

/** Strip the recorded line so identity survives unrelated edits above a site. */
function countByIdentity(snapshot) {
  const counts = new Map();
  for (const [file, entries] of Object.entries(snapshot.byFile ?? {})) {
    for (const entry of entries) {
      const key = `${file}: ${entry.replace(/ \(line \d+\)$/, "")}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

export function diffUnescaped(baseline, current) {
  const differences = [];
  const before = countByIdentity(baseline);
  const after = countByIdentity(current);

  for (const [site, count] of [...after].sort()) {
    const previous = before.get(site) ?? 0;
    if (previous === 0) {
      differences.push(`NEW unescaped attribute interpolation — ${site}`);
    }
    else if (count > previous) {
      differences.push(`unescaped attribute interpolation ${site} ${previous} -> ${count} site(s)`);
    }
  }

  return differences;
}

function main() {
  const current = collectUnescaped();

  if (process.argv.includes("--write")) {
    mkdirSync(new URL(".", SNAPSHOT_PATH), { recursive: true });
    writeFileSync(
      SNAPSHOT_PATH,
      `${JSON.stringify(
        {
          $comment:
            "Attribute interpolations that reach HTML without escaping. The gate blocks anything NEW, not the "
            + "absolute count — see #125 for the ~90 pre-existing sites and their triage tiers. Entries are "
            + "compared by file + attribute + expression, so a site that merely moves lines is silent. Line "
            + "numbers are recorded for navigation only. This file should only ever SHRINK: regenerate after a "
            + "cleanup commit with `npm run gate:attr-escape -- --write`. If it grows, something shipped an "
            + "unescaped interpolation into markup that renders on every connected client.",
          ...current,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `attr-escape gate: baselined ${current.total} unescaped interpolation(s) across ${current.files} file(s)`,
    );
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  }
  catch {
    console.log("[BLOCK] attr-escape gate: no baseline. Generate it with --write.");
    process.exit(1);
  }

  const differences = diffUnescaped(baseline, current);
  console.log(
    `attr-escape gate: ${current.total} unescaped interpolation(s) (${baseline.total} accepted)`,
  );

  if (differences.length > 0) {
    for (const d of differences) console.log(`  ${d}`);
    console.log(
      `[BLOCK] ${differences.length} new unescaped attribute interpolation(s). Chat cards and sheets render on `
        + "every connected client, so a document field a player can edit becomes script execution in the GM's "
        + "session. Wrap the value in foundry.utils.escapeHTML at assignment.",
    );
    process.exit(1);
  }

  console.log("attr-escape gate: OK");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
