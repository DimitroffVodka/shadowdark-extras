#!/usr/bin/env node
/**
 * Export-surface comparison (Phase 5.0.8).
 *
 * WHAT IT PROVES. The named-export gate proves every imported name exists at
 * the other end of its import. It cannot see a name that NOTHING imports: a
 * split can delete an exported name, every static gate stays green (no import
 * references it), and the module's public surface silently shrinks. The
 * manifest-declared esmodules are the module's public API — the split passes
 * must preserve that surface exactly.
 *
 * HOW IT WORKS. For each first-party .mjs file:
 *   - base surface: the export names at a base ref (default origin/main),
 *     read via `git show <ref>:<path>`.
 *   - head surface: the export names at HEAD, PLUS the names forwarded by
 *     re-export chains (`export * from`, `export { x } from`), resolved
 *     transitively with cycle protection.
 * A name in the base surface that is missing from the head surface is a
 * surface regression: report it and exit 1.
 *
 * USAGE
 *   node dev/tools/export-surface-compare.mjs [base-ref]
 *   base-ref defaults to origin/main. Run against the whole scripts/ tree.
 *
 * LIMITS (documented, same class as the named-export gate):
 *   - `export * from` targets are resolved transitively; a cycle is cut at
 *     the first repeated module.
 *   - Dynamic re-export construction (`export { [k]: v }`) is not modeled;
 *     this codebase does not use it.
 *   - The comparison is name-only, like the export-scan test: a changed
 *     signature with the same name is not caught here (that is the binding
 *     gate's and reviewers' job).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { scanExports } from "./export-scan.mjs";
import { listJsFiles, toRepoPath, isVendor, REPO_ROOT } from "./project-scan.mjs";

const BASE_REF = process.argv[2] ?? "origin/main";

// The base ref must resolve, or the comparison is meaningless. A missing ref
// (e.g. shallow CI checkout without origin/main) must fail loudly rather than
// report "0 surface regressions" against nothing.
try {
  execSync(`git rev-parse --verify "${BASE_REF}^{commit}"`, {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
} catch {
  console.error(
    `export-surface compare: base ref "${BASE_REF}" does not resolve. ` +
      "In CI, checkout must use fetch-depth: 0 so origin/main exists. " +
      "Locally, fetch origin first.",
  );
  process.exit(1);
}

/** Resolve a repo-relative path to the absolute path under REPO_ROOT. */
function absPath(repoPath) {
  return path.join(REPO_ROOT, repoPath);
}

/** Read a file's source from git at BASE_REF. Throws if not tracked there. */
function baseSource(repoPath) {
  try {
    return execSync(`git show "${BASE_REF}:${repoPath}"`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null; // not present at base ref (new file) — nothing to compare
  }
}

/** Scan a file's raw export surface (declarations + lists, star targets). */
function surfaceOf(source) {
  const { names, starExports } = scanExports(source);
  return { names: new Set(names), starTargets: starExports };
}

/**
 * The FULL surface of a file at HEAD: its own export names plus everything
 * its `export * from` / `export { x } from` chains forward, resolved
 * transitively. Cycle-protected.
 */
function headSurface(repoPath, _seen = new Set()) {
  if (_seen.has(repoPath)) return new Set();
  _seen.add(repoPath);
  const abs = absPath(repoPath);
  if (!fs.existsSync(abs)) return new Set();
  const { names, starTargets } = surfaceOf(fs.readFileSync(abs, "utf8"));
  const all = new Set(names);
  for (const target of starTargets) {
    // starTargets entries are raw literal contents; strip quotes.
    const clean = target.replace(/^["']|["']$/g, "");
    if (!clean.endsWith(".mjs")) continue;
    const targetRepo = path.posix.normalize(path.posix.join(path.posix.dirname(repoPath), clean));
    const forwarded = headSurface(targetRepo, _seen);
    for (const n of forwarded) all.add(n);
  }
  // `export { x } from "./y"` — named re-exports forward x too.
  const absSrc = fs.readFileSync(abs, "utf8");
  for (const m of absSrc.matchAll(/^export\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/gm)) {
    for (const part of m[1].split(",").map((p) => p.trim()).filter(Boolean)) {
      all.add(part.split(/\s+as\s+/).pop().trim());
    }
  }
  return all;
}

const files = listJsFiles(["scripts"])
  .map(toRepoPath)
  .filter((p) => p.endsWith(".mjs") && !isVendor(p));
const regressions = [];
let compared = 0;

for (const repoPath of files) {
  const baseSrc = baseSource(repoPath);
  if (baseSrc === null) continue; // new file since base
  const baseSurface = surfaceOf(baseSrc);
  if (baseSurface.names.size === 0) continue; // nothing exported at base
  compared++;
  const headNames = headSurface(repoPath);
  for (const name of baseSurface.names) {
    if (!headNames.has(name)) {
      regressions.push(`${repoPath}  ${name}`);
    }
  }
}

console.log(
  `export-surface compare (${BASE_REF} -> HEAD): ${compared} files with exports compared, ${regressions.length} surface regressions`,
);
for (const r of regressions) console.log(`  MISSING  ${r}`);
if (regressions.length) process.exit(1);
