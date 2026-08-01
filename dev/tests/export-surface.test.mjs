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
  const target = "scripts/shared/module-id.mjs";
  const original = fs.readFileSync(target, "utf8");
  const scratch = path.join(os.tmpdir(), `sdx-surface-${process.pid}.mjs`);
  try {
    // Simulate a split deleting the export: move the file's content to a
    // scratch copy (so git still has the original at origin/main), then
    // replace the tracked file with a version missing the export.
    fs.writeFileSync(scratch, original);
    fs.writeFileSync(
      target,
      original.replace(/^export const MODULE_ID/m, "const MODULE_ID"),
    );
    let failed = false;
    let out = "";
    try {
      out = execSync("node dev/tools/export-surface-compare.mjs", {
        cwd: process.cwd(),
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
    fs.writeFileSync(target, original);
    fs.rmSync(scratch, { force: true });
  }
});
