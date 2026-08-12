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

/**
 * The #125 Tier 3 triage, recorded here rather than in the snapshot so `--write`
 * cannot silently drop it. Everything backed by a player-editable document field
 * has been escaped; what remains is listed below BY CATEGORY, with the reason.
 *
 * An accepted entry is not a verdict that the site is unreachable. It means the
 * value is module-owned or structurally incapable of carrying a quote, so
 * escaping it would add noise rather than close a hole.
 */
const NOTES = {
  "document ids and slugs":
    "`p.id`, `s.id`, `w.id`, `t.uuid`, `pack.id`, `type.id` and friends. Foundry ids are generated "
    + "alphanumerics and the toolbar slugs are module-defined constants; neither can contain a quote.",
  "numeric and boolean values":
    "`die.faces`, `currentHp`, `xp`, `radius`, `tmOpacity`, the `duration.*` fields on the four "
    + "sheet-enhance modules, and the loop indices. Numbers coerced into an attribute cannot break out.",
  "module-owned label text":
    "`HP_QUICK_ADJUST_TOOLTIP`, `formulaHelp`/`tieredFormulaHelp`/`requirementExamples` in "
    + "SpellDamageConfig, and the literal ternaries such as `levelUp ? \"Ready to Level Up!\" : \"Level\"`. "
    + "These are help strings this module ships, not user data. #125 calls out the SpellDamageConfig "
    + "ones by name as noise rather than fixes.",
  "shapechanger renderIcon":
    "`scripts/macros/shapechanger.mjs` `src=icon` takes `renderIcon(opts.icon)` with internal values. "
    + "#125 names this one explicitly as module-owned.",
  "maphub <base href> injection":
    "`MaphubSD.mjs` and `maphub-cave.mjs` inject a `<base href>` built from a local directory path the "
    + "module computes. Not a document field, and escaping it would corrupt the URL it exists to set.",
  "WITHDRAWN — GM-authored config formulas":
    "This category used to accept `flags.formula`, `damage.formula` and the weapon-bonus inputs as "
    + "\"settings a GM types into their own dialog\". That was wrong, and review caught it. They are "
    + "ITEM FLAGS, so a player who owns the item controls them, and they render when the GM opens "
    + "that item's sheet — the payload arrives from the player and executes in the GM's session. "
    + "The lesson generalises: \"who types it\" is not a trust boundary, \"where it is stored\" is. "
    + "Anything reachable from a document a player can edit is player-controlled no matter which "
    + "dialog authored it. EVERY member is now escaped rather than accepted: weapon-bonus-ui's "
    + "formula and label, SpellDamageConfig's formula/tieredFormula/requirement/perTurnDamage/"
    + "numDice/scalingDice/bonus, AuraConfig and TemplateTargetingConfig's damage.formula, the "
    + "damage-card reroll formula and effects-requirement data attributes, and effect-config's "
    + "sourceRequirement. Withdrawing the note while leaving its members baselined — which is what "
    + "the first attempt did — left the snapshot asserting something the notes contradicted.",
};

/** `file: attr=expr` — the identity the gate compares, without the line. */
function identity(file, finding) {
  return `${file}: ${finding.attr}=${finding.expr}`;
}

export function collectUnescaped() {
  const files = listJsFiles(["scripts"]).filter((file) => !isVendor(toRepoPath(file)));

  const byFile = {};
  const parseErrors = [];
  let total = 0;
  for (const file of files) {
    let findings;
    try {
      findings = scanUnescapedAttrs(readFileSync(file, "utf8"));
    }
    catch (err) {
      // The scanner parses now, so a file it cannot read contributes NOTHING —
      // indistinguishable from a clean file. Block rather than scan less.
      parseErrors.push(`${toRepoPath(file)}: ${err.message}`);
      continue;
    }
    if (findings.length === 0) continue;
    byFile[toRepoPath(file)] = findings
      .map((f) => `${f.attr}=${f.expr} (line ${f.line})`)
      .sort();
    total += findings.length;
  }

  return {
    total,
    parseErrors,
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

  if (current.parseErrors.length > 0) {
    for (const error of current.parseErrors) console.log(`  ${error}`);
    console.log(
      `[BLOCK] ${current.parseErrors.length} file(s) failed to parse and were NOT scanned. `
        + "Fix the syntax, or raise acorn's ecmaVersion if the file uses newer syntax.",
    );
    process.exit(1);
  }

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
            + "unescaped interpolation into markup that renders on every connected client. See $notes for "
            + "why the remaining entries were triaged as module-owned rather than fixed.",
          $notes: NOTES,
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
