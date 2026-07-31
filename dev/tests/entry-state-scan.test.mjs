import assert from "node:assert/strict";
import test from "node:test";

import { scanTopLevelState } from "../tools/entry-state-scan.mjs";

/**
 * Phase 3 cuts registration groups out of a 21k-line composition root. The
 * thing that makes that dangerous is shared module-scope state: two groups that
 * look independent can both mutate the same Set, and extracting one of them
 * into its own module silently gives it a second, separate Set.
 *
 * The plan makes an inventory of that state a gate, and is explicit that
 * mutability must be judged per variable rather than per keyword — `const`
 * only freezes the binding, so a `const` holding a Set is mutable state.
 */

const byName = (source) => Object.fromEntries(scanTopLevelState(source).map((d) => [d.name, d]));

test("finds top-level let and const declarations", () => {
  const found = scanTopLevelState(["let active = null;", "const LIMIT = 5;"].join("\n"));

  assert.deepEqual(found.map((d) => d.name), ["active", "LIMIT"]);
  assert.deepEqual(found.map((d) => d.kind), ["let", "const"]);
});

/**
 * The distinction the whole gate rests on.
 */
test("treats a const holding a mutable container as mutable state", () => {
  const found = byName(
    [
      "const seen = new Set();",
      "const cache = new Map();",
      "const queue = [];",
      "const config = {};",
      'const MODULE_ID = "shadowdark-extras";',
      "const MAX = 12;",
    ].join("\n"),
  );

  assert.equal(found.seen.mutable, true);
  assert.equal(found.seen.shape, "Set");
  assert.equal(found.cache.mutable, true);
  assert.equal(found.cache.shape, "Map");
  assert.equal(found.queue.mutable, true);
  assert.equal(found.config.mutable, true);
  assert.equal(found.MODULE_ID.mutable, false);
  assert.equal(found.MAX.mutable, false);
});

test("a let is always mutable, whatever it holds", () => {
  const found = byName('let name = "fixed";');

  assert.equal(found.name.mutable, true);
});

/**
 * Only module scope counts. A `const` inside a function is that function's
 * business and does not constrain extraction.
 */
test("ignores declarations nested inside functions, blocks and classes", () => {
  const source = [
    "const topLevel = new Set();",
    "function register() {",
    "  const inner = new Set();",
    "  if (x) { let deeper = 1; }",
    "}",
    "class Thing {",
    "  method() { const alsoInner = 2; }",
    "}",
    'Hooks.on("ready", () => { const hookLocal = 3; });',
  ].join("\n");

  assert.deepEqual(scanTopLevelState(source).map((d) => d.name), ["topLevel"]);
});

test("ignores declarations written in comments and strings", () => {
  const source = [
    "// const ghost = new Set();",
    "/* let ghost2 = 1; */",
    'const doc = "const ghost3 = new Map();";',
    "const real = 1;",
  ].join("\n");

  assert.deepEqual(scanTopLevelState(source).map((d) => d.name), ["doc", "real"]);
});

test("records exported declarations, which are public surface as well as state", () => {
  const found = byName(["export const shared = new Map();", "const private_ = new Map();"].join("\n"));

  assert.equal(found.shared.exported, true);
  assert.equal(found.private_.exported, false);
});

test("captures multiple declarators in one statement", () => {
  const found = scanTopLevelState("let a = null, b = new Set();");

  assert.deepEqual(found.map((d) => d.name), ["a", "b"]);
  assert.equal(found[1].shape, "Set");
});

test("records 1-based line numbers", () => {
  const found = scanTopLevelState(["", "", "const late = 1;"].join("\n"));

  assert.equal(found[0].line, 3);
});
