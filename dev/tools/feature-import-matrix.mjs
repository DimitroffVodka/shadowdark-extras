#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { scanImports, classifyTarget } from "./import-scan.mjs";
import { listJsFiles, toRepoPath, isVendor, REPO_ROOT } from "./project-scan.mjs";
import { featureOf, FEATURE_OWNERS } from "./feature-ownership.mjs";

/**
 * Phase 0 step 5: every static and literal dynamic import that crosses a planned
 * feature boundary, with from-file, to-file, imported names, and a decision.
 *
 * The plan expects "tens of rows, not the seven seeds", and a Phase 2 move that
 * uncovers an unrecorded crossing must stop until this is regenerated. So the
 * matrix is generated rather than hand-maintained — a hand-written list is
 * exactly the artefact that goes stale the first time someone is in a hurry.
 *
 * Two exclusions, both from the plan:
 *  - The composition root's own imports are composition, not crossings.
 *    Imports *into* the root from a feature are crossings and are kept: three
 *    feature files consume root exports today.
 *  - The vendored MapHub tree is an external dependency, not a feature.
 *
 * Output is written to `docs/architecture/`, which is local-only by owner
 * decision and excluded from the repository.
 */

const OUTPUT_PATH = path.join(REPO_ROOT, "docs/architecture/cross-feature-import-matrix.md");

/** Imported names are reported so a reviewer can judge the coupling, not just count it. */
function importedNames(source, entry) {
  if (entry.kind === "dynamic") return "(dynamic)";
  if (entry.kind === "side-effect") return "(side effect)";
  const line = source.split("\n")[entry.line - 1] ?? "";
  const braces = line.match(/\{([^}]*)\}/);
  if (braces) return braces[1].split(",").map((name) => name.trim()).filter(Boolean).join(", ");
  const namespace = line.match(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespace) return `* as ${namespace[1]}`;
  const fallback = line.match(/import\s+([A-Za-z_$][\w$]*)/);
  return fallback ? fallback[1] : "(default)";
}

export function buildMatrix() {
  // Repo-root `data/` also ships runtime ESM — not to be confused with `scripts/data/`.
  const files = listJsFiles(["scripts", "data"]).filter((file) => !isVendor(toRepoPath(file)));
  const rows = [];
  const unassigned = new Set();
  const featureCounts = new Map();

  for (const file of files) {
    const fromBase = path.basename(file);
    const fromFeature = featureOf(fromBase);
    if (fromFeature === "unassigned") unassigned.add(toRepoPath(file));

    const source = readFileSync(file, "utf8");
    for (const entry of scanImports(source)) {
      if (entry.computed || !entry.relative) continue;

      const target = classifyTarget(REPO_ROOT, file, entry.specifier);
      if (target.scope !== "internal") continue;

      const toRepo = toRepoPath(target.resolved);
      if (isVendor(toRepo)) continue;
      if (!/\.(mjs|js)$/.test(toRepo)) continue;

      const toBase = path.basename(target.resolved);
      const toFeature = featureOf(toBase);
      if (toFeature === fromFeature) continue;
      // The root composing its features is not a boundary crossing.
      if (fromFeature === "root") continue;

      rows.push({
        fromFeature,
        from: fromBase,
        toFeature,
        to: toBase,
        names: importedNames(source, entry),
        dynamic: entry.kind === "dynamic",
        line: entry.line,
      });

      const key = `${fromFeature} -> ${toFeature}`;
      featureCounts.set(key, (featureCounts.get(key) ?? 0) + 1);
    }
  }

  rows.sort((a, b) =>
    a.fromFeature.localeCompare(b.fromFeature) ||
    a.from.localeCompare(b.from) ||
    a.toFeature.localeCompare(b.toFeature) ||
    a.to.localeCompare(b.to));

  return { rows, unassigned: [...unassigned].sort(), featureCounts, fileCount: files.length };
}

/**
 * A crossing into `shared/` is allowed by the import rules and needs no
 * per-row decision; everything else is a judgement call for the reviewer.
 */
function defaultDecision(row) {
  if (row.toFeature === "shared") return "Allowed — shared kernel.";
  if (row.toFeature === "macros") return "Allowed — retained collection.";
  if (row.toFeature === "root") return "Re-point at the API facade in Phase 3.";
  if (row.toFeature === "unassigned") return "**Classify before Phase 2.**";
  return "Keep; review during modernization.";
}

function render(matrix) {
  const lines = [];
  lines.push("# Cross-feature import matrix");
  lines.push("");
  lines.push("**Generated — do not hand-edit.** Regenerate with `npm run matrix:imports`.");
  lines.push("Local-only, like the rest of `docs/architecture/`.");
  lines.push("");
  lines.push(
    "Every static and literal dynamic relative import that crosses a planned feature boundary, " +
      "per the ownership table in `feature-map.md`. The composition root's own imports are " +
      "composition, not crossings, and are excluded; imports *into* the root from a feature are kept.",
  );
  lines.push("");
  lines.push(`- Modules classified: ${matrix.fileCount}`);
  lines.push(`- Boundary crossings: ${matrix.rows.length}`);
  lines.push(`- Distinct feature pairs: ${matrix.featureCounts.size}`);
  lines.push(`- Unassigned modules: ${matrix.unassigned.length}`);
  lines.push("");

  if (matrix.unassigned.length > 0) {
    lines.push("## Unassigned modules");
    lines.push("");
    lines.push("These have no owner in `feature-map.md`. Phase 2 cannot move them until they do.");
    lines.push("");
    for (const file of matrix.unassigned) lines.push(`- \`${file}\``);
    lines.push("");
  }

  lines.push("## Crossings by feature pair");
  lines.push("");
  lines.push("| Pair | Count |");
  lines.push("| --- | --- |");
  for (const [pair, count] of [...matrix.featureCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    lines.push(`| ${pair} | ${count} |`);
  }
  lines.push("");

  lines.push("## Crossings");
  lines.push("");
  lines.push("| From | To | Names | Kind | Decision |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of matrix.rows) {
    const names = row.names.length > 70 ? `${row.names.slice(0, 67)}…` : row.names;
    lines.push(
      `| \`${row.from}\` (${row.fromFeature}) | \`${row.to}\` (${row.toFeature}) | ${names} | ` +
        `${row.dynamic ? "dynamic" : "static"} | ${defaultDecision(row)} |`,
    );
  }
  lines.push("");

  lines.push("## Features with no outgoing crossings");
  lines.push("");
  const outgoing = new Set(matrix.rows.map((row) => row.fromFeature));
  const clean = Object.keys(FEATURE_OWNERS).filter((feature) => !outgoing.has(feature) && feature !== "root");
  lines.push(clean.length > 0 ? clean.map((feature) => `\`${feature}\``).join(", ") : "_none_");
  lines.push("");

  return lines.join("\n");
}

function main() {
  const matrix = buildMatrix();
  const markdown = render(matrix);

  if (process.argv.includes("--stdout")) {
    console.log(markdown);
    return;
  }

  writeFileSync(OUTPUT_PATH, `${markdown}\n`);
  console.log(
    `cross-feature import matrix: ${matrix.rows.length} crossings, ` +
      `${matrix.featureCounts.size} feature pairs, ${matrix.unassigned.length} unassigned -> ${toRepoPath(OUTPUT_PATH)}`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
