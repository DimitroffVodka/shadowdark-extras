import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveProjectImports } from "../tools/resolve-imports.mjs";
import { findScriptPathStrings, FORBIDDEN } from "../tools/script-path-guard.mjs";
import { collectRegistrations, readSnapshot, diffSnapshot } from "../tools/registration-snapshot.mjs";
import { collectEsmoduleExports, diffExports } from "../tools/api-export-snapshot.mjs";
import { REPO_ROOT } from "../tools/project-scan.mjs";

/**
 * Phase 0 step 7 — prove the safeguards.
 *
 * A gate nobody has seen fail is not a gate. Each check below is exercised
 * twice: once against the real tree (it must be green, which is the standing
 * regression fixture), and once against a deliberately broken input (it must
 * block). The breakage always lives in a temp directory or a synthetic object,
 * so no broken path is ever written into the repository.
 */

function withFixture(files, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "sdx-gate-"));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const absolute = path.join(dir, relativePath);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, contents);
    }
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- resolver

test("resolver: the real tree has no unresolved relative imports", () => {
  const result = resolveProjectImports();

  assert.deepEqual(result.missing, []);
  assert.ok(result.checked > 400, `expected the scan to be non-trivial, got ${result.checked}`);
});

/**
 * The tree has zero computed dynamic imports today. If one appears it becomes a
 * documented manual smoke-test obligation, so this asserts the count is known
 * rather than asserting it stays zero forever.
 */
test("resolver: computed dynamic imports are enumerated, not silently dropped", () => {
  const result = resolveProjectImports();

  assert.equal(result.computed.length, 0);
});

test("resolver: catches a missing relative import", () => {
  const missing = withFixture(
    {
      "scripts/Feature.mjs": 'import { thing } from "./Helper.mjs";\n',
    },
    (dir) => resolveProjectImports([path.join(dir, "scripts")], dir).missing,
  );

  assert.equal(missing.length, 1);
  assert.equal(missing[0].specifier, "./Helper.mjs");
  assert.equal(missing[0].reason, "file does not exist");
});

test("resolver: catches a literal dynamic import broken by a move", () => {
  const missing = withFixture(
    {
      // Simulates the exact Phase 2 hazard: `scripts/Feature.mjs` moved into
      // `scripts/animation/` while its backtick import kept the old `./presets/`
      // spelling, which now points one directory too deep.
      "scripts/animation/Feature.mjs": "await import(`./presets/gone.mjs`);\n",
      "scripts/presets/gone.mjs": "export const a = 1;\n",
    },
    (dir) => resolveProjectImports([path.join(dir, "scripts")], dir).missing,
  );

  assert.equal(missing.length, 1);
  assert.equal(missing[0].kind, "dynamic");
});

test("resolver: passes when every relative import resolves", () => {
  const missing = withFixture(
    {
      "scripts/Feature.mjs": 'import { thing } from "./Helper.mjs";\n',
      "scripts/Helper.mjs": "export const thing = 1;\n",
    },
    (dir) => resolveProjectImports([path.join(dir, "scripts")], dir).missing,
  );

  assert.deepEqual(missing, []);
});

// ------------------------------------------------------------ path guard

test("string-path guard: the real tree contains no absolute script paths", () => {
  const { hits, files } = findScriptPathStrings();

  assert.deepEqual(hits, []);
  assert.ok(files > 100, `expected the guard to cover the shipped tree, got ${files}`);
});

test("string-path guard: catches an absolute script path", () => {
  const hits = withFixture(
    {
      "scripts/Feature.mjs": `const url = "${FORBIDDEN}AuraEffectsSD.mjs";\n`,
    },
    (dir) => findScriptPathStrings([path.join(dir, "scripts")]).hits,
  );

  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
});

// ------------------------------------------------- registration snapshot

test("registration snapshot: the real tree matches the committed baseline", () => {
  const differences = diffSnapshot(readSnapshot(), collectRegistrations());

  assert.deepEqual(differences, []);
});

test("registration snapshot: catches an added registration", () => {
  const baseline = { totals: { "Hooks.on": 1, all: 1 }, modules: { "A.mjs": ["Hooks.on:ready"] } };
  const current = {
    totals: { "Hooks.on": 2, all: 2 },
    modules: { "A.mjs": ["Hooks.on:ready", "Hooks.on:canvasReady"] },
  };

  const differences = diffSnapshot(baseline, current);
  assert.ok(differences.some((line) => line.includes("1 -> 2")), differences.join("; "));
});

/**
 * Reordering is the failure this gate exists for: same file, same count, same
 * names — only the sequence changed. A count-only check would pass it.
 */
test("registration snapshot: catches a reordering that preserves the count", () => {
  const baseline = { totals: { "Hooks.on": 2, all: 2 }, modules: { "A.mjs": ["Hooks.on:init", "Hooks.on:ready"] } };
  const current = { totals: { "Hooks.on": 2, all: 2 }, modules: { "A.mjs": ["Hooks.on:ready", "Hooks.on:init"] } };

  const differences = diffSnapshot(baseline, current);
  assert.ok(differences.some((line) => line.startsWith("A.mjs[0]")), differences.join("; "));
});

test("registration snapshot: catches a module that lost its registrations", () => {
  const baseline = { totals: { "Hooks.on": 1, all: 1 }, modules: { "A.mjs": ["Hooks.on:ready"] } };
  const current = { totals: {}, modules: {} };

  assert.ok(diffSnapshot(baseline, current).some((line) => line.includes("lost all registrations")));
});

/**
 * Phase 2 moves every one of these files. Keying by basename is what lets the
 * baseline survive that, so it is worth pinning as behaviour.
 */
test("registration snapshot: keys are basenames, so a feature-folder move cannot disturb it", () => {
  const { modules, detail } = collectRegistrations();

  for (const key of Object.keys(modules)) {
    assert.ok(!key.includes("/"), `snapshot key "${key}" contains a path; a move would churn the baseline`);
  }
  // The same module is currently reachable at a path that Phase 2 will change.
  const moved = detail.find((entry) => entry.file.includes("/"));
  assert.ok(moved, "expected at least one registration-bearing module below scripts/");
  assert.equal(moved.key, moved.file.split("/").pop());
});

// -------------------------------------------------- API export snapshot

test("api-export snapshot: the real tree matches the committed baseline", () => {
  const baseline = JSON.parse(readFileSync(path.join(REPO_ROOT, "dev/snapshots/api-exports.json"), "utf8"));

  assert.deepEqual(diffExports(baseline, collectEsmoduleExports()), []);
});

test("api-export snapshot: catches a removed public export", () => {
  const baseline = { declaredCount: 1, esmodules: { "a.mjs": { names: ["run", "stop"] } } };
  const current = { declaredCount: 1, esmodules: { "a.mjs": { names: ["run"] } } };

  assert.deepEqual(diffExports(baseline, current), ["a.mjs: export removed: stop"]);
});

test("api-export snapshot: catches a newly added public export", () => {
  const baseline = { declaredCount: 1, esmodules: { "a.mjs": { names: ["run"] } } };
  const current = { declaredCount: 1, esmodules: { "a.mjs": { names: ["run", "sprint"] } } };

  assert.deepEqual(diffExports(baseline, current), ["a.mjs: export added: sprint"]);
});

test("api-export snapshot: catches a dropped manifest declaration", () => {
  const baseline = { declaredCount: 2, esmodules: { "a.mjs": { names: [] }, "b.mjs": { names: [] } } };
  const current = { declaredCount: 1, esmodules: { "a.mjs": { names: [] } } };

  const differences = diffExports(baseline, current);
  assert.ok(differences.some((line) => line.includes("declares 1 esmodules")));
  assert.ok(differences.some((line) => line.includes("no longer present: b.mjs")));
});

/**
 * The composition root exports exactly the three names that feature files
 * consume today. Phase 3 re-homes them behind an API facade; if this count
 * changes before then, something has been extracted without a re-export.
 */
test("api-export snapshot: the composition root still exports its three consumed names", () => {
  const { esmodules } = collectEsmoduleExports();

  assert.deepEqual(esmodules["shadowdark-extras.mjs"].names, [
    "executeItemMacro",
    "getCustomLightSources",
    "hasItemMacro",
  ]);
});
