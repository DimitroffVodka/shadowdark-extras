import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scanExports } from "../tools/export-scan.mjs";

/**
 * Export-surface comparison (Phase 5.0.8) — the tool must catch the removal
 * of an exported name even when nothing imports it. The named-export gate
 * only proves imported names exist; this proves the whole surface survives
 * a split.
 */

test("scanExports baseline: captures the module-id export", () => {
  const src = fs.readFileSync("scripts/shared/module-id.mjs", "utf8");
  const { names } = scanExports(src);
  assert.ok(names.includes("MODULE_ID"), "MODULE_ID must be exported");
});

test("tool reports 0 regressions against origin/main (current surface intact)", () => {
  const out = execSync("node dev/tools/export-surface-compare.mjs", {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.match(out, /0 surface regressions/);
});

test("tool catches a removed export name (the acceptance case)", () => {
  // This deletes an export to prove the tool notices. It MUST NOT do that in
  // the real working tree: `node --test` runs test files concurrently in
  // separate processes, and while the export is missing, any other file whose
  // module graph reaches scripts/shared/module-id.mjs fails to link with
  // "does not provide an export named 'MODULE_ID'". That raced on CI and its
  // victim varied by timing (run 30955085877 lost webp-migration-paths).
  //
  // A throwaway worktree gives private files over the same git history, so the
  // tool still resolves its origin/main base surface. It reads REPO_ROOT from
  // its own location, so invoking the copy inside the worktree scans the
  // worktree.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdx-export-surface-"));
  const tree = path.join(dir, "tree");
  execSync(`git worktree add --detach --quiet "${tree}" HEAD`, { stdio: "pipe" });
  try {
    const target = path.join(tree, "scripts/shared/module-id.mjs");
    const original = fs.readFileSync(target, "utf8");
    fs.writeFileSync(
      target,
      original.replace(/^export const MODULE_ID/m, "const MODULE_ID"),
    );

    let failed = false;
    let out = "";
    try {
      out = execSync("node dev/tools/export-surface-compare.mjs", {
        cwd: tree,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      failed = true;
      out = e.stdout ? e.stdout.toString() : "";
    }
    assert.ok(failed, "tool must exit nonzero when an export is removed");
    assert.match(out, /MISSING\s+scripts\/shared\/module-id\.mjs\s+MODULE_ID/);
  } finally {
    execSync(`git worktree remove --force "${tree}"`, { stdio: "pipe" });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the acceptance case leaves the real working tree untouched", () => {
  // Regression guard for the race above: if someone reintroduces an in-place
  // mutation, this catches it in the same file rather than as a mystery
  // link error in an unrelated test.
  const src = fs.readFileSync("scripts/shared/module-id.mjs", "utf8");
  assert.match(src, /^export const MODULE_ID/m);
});
