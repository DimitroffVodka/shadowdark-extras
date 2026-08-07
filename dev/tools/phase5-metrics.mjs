/**
 * Phase 5.3 metrics for first-party `scripts/`.
 *
 * Scope note: this measured only `scripts/effects`, `scripts/combat` and
 * `scripts/animation` (the sweep-4 roots) until 2026-08-06. That made it report
 * clean on territory it had never looked at — 3 files over the review threshold
 * when the repository actually had 10 — so it could not be used to judge sweeps
 * 5-7 or the strict closeout. Widened to all of `scripts`; `scripts/maphub/**`
 * stays excluded as vendored via `includeVendor: false`.
 *
 * This is intentionally a small, dependency-free inventory. It reports newline
 * counts (the same physical-line convention as `wc -l`), classifies console calls
 * after masking comments and literals, and records the Git SHA that was measured.
 * Vendored code is excluded from the first-party denominator.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { maskSource } from "./import-scan.mjs";
import { isVendor, listJsFiles, REPO_ROOT, toRepoPath } from "./project-scan.mjs";

export const OWNED_ROOTS = ["scripts"];
export const LINE_THRESHOLDS = { review: 1200, split: 2000 };
const CONSOLE_CALL = /console\.[A-Za-z_$][\w$]*\s*\(/;

function countNewlines(source) {
  return source.match(/\n/g)?.length ?? (source.length > 0 ? 1 : 0);
}

export function classifyConsoleLines(source) {
  const masked = maskSource(source).masked;
  const sourceLines = source.split("\n");
  const maskedLines = masked.split("\n");
  let active = 0;
  let commented = 0;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const sourceLine = sourceLines[index];
    const maskedLine = maskedLines[index] ?? "";
    const call = sourceLine.match(CONSOLE_CALL);
    if (!call) continue;
    if (CONSOLE_CALL.test(maskedLine)) {
      active += 1;
    } else if (/\/\*|(^|\s)\/\//.test(sourceLine.slice(0, call.index))) {
      commented += 1;
    }
  }
  return { active, commented, total: active + commented };
}

export function analyzeSource(source, file = "fixture.mjs") {
  return {
    file,
    physicalLines: countNewlines(source),
    sourceLines: source.split("\n").length,
    console: classifyConsoleLines(source),
  };
}

export function collectPhase5Metrics(root = REPO_ROOT) {
  const files = listJsFiles(OWNED_ROOTS.map((entry) => path.resolve(root, entry)), { includeVendor: false })
    .filter((file) => !isVendor(path.relative(root, file).split(path.sep).join("/")));
  const entries = files.map((file) => analyzeSource(readFileSync(file, "utf8"), path.relative(root, file).split(path.sep).join("/")));
  const totals = entries.reduce(
    (summary, entry) => ({
      files: summary.files + 1,
      physicalLines: summary.physicalLines + entry.physicalLines,
      sourceLines: summary.sourceLines + entry.sourceLines,
      activeConsole: summary.activeConsole + entry.console.active,
      commentedConsole: summary.commentedConsole + entry.console.commented,
    }),
    { files: 0, physicalLines: 0, sourceLines: 0, activeConsole: 0, commentedConsole: 0 },
  );
  const over = (threshold) => entries
    .filter((entry) => entry.physicalLines > threshold)
    .map(({ file, physicalLines }) => ({ file, physicalLines }));

  return {
    schema: "phase5-metrics-v1",
    gitSha: gitSha(root),
    roots: [...OWNED_ROOTS],
    firstParty: totals,
    thresholds: { ...LINE_THRESHOLDS },
    over1200: over(LINE_THRESHOLDS.review),
    over2000: over(LINE_THRESHOLDS.split),
    files: entries,
  };
}

function gitSha(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function main() {
  const result = collectPhase5Metrics();
  if (process.argv.includes("--json") || process.argv.length === 2) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write([
    `Git SHA: ${result.gitSha ?? "unknown"}`,
    `First-party files: ${result.firstParty.files}`,
    `Physical lines: ${result.firstParty.physicalLines}`,
    `Console lines: ${result.firstParty.activeConsole} active / ${result.firstParty.commentedConsole} commented`,
    `Over 1200 lines: ${result.over1200.map((entry) => `${entry.file} (${entry.physicalLines})`).join(", ") || "none"}`,
    `Over 2000 lines: ${result.over2000.map((entry) => `${entry.file} (${entry.physicalLines})`).join(", ") || "none"}`,
  ].join("\n") + "\n");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();

export const _private = { countNewlines, gitSha, toRepoPath };
