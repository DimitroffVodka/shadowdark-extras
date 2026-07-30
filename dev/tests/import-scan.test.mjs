import assert from "node:assert/strict";
import test from "node:test";

import { scanImports, resolveSpecifier, classifyTarget } from "../tools/import-scan.mjs";

/**
 * The refactor's structural track renames script paths and nothing else, so a
 * broken relative import is the single most likely way a move commit ships a
 * runtime failure. These tests pin the scanner's contract: what counts as an
 * import specifier, and what it refuses to guess at.
 *
 * The scanner masks comments, strings, and regex literals before looking for
 * imports. Every "ignores ..." case below is a false positive that a
 * line-by-line grep would have reported.
 */

const specifiers = (source) => scanImports(source).map((entry) => entry.specifier);

test("finds static imports in both quote styles", () => {
  const found = scanImports(
    [
      'import { a } from "./Alpha.mjs";',
      "import b from '../Beta.mjs';",
      'import * as c from "./nested/Gamma.mjs";',
    ].join("\n"),
  );

  assert.deepEqual(found.map((entry) => entry.specifier), [
    "./Alpha.mjs",
    "../Beta.mjs",
    "./nested/Gamma.mjs",
  ]);
  assert.deepEqual(new Set(found.map((entry) => entry.kind)), new Set(["static"]));
});

test("finds side-effect imports", () => {
  const found = scanImports('import "./register-everything.mjs";');

  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "side-effect");
  assert.equal(found[0].specifier, "./register-everything.mjs");
});

test("finds re-exports, which resolve exactly like imports", () => {
  const found = scanImports(
    [
      'export { thing } from "./Thing.mjs";',
      'export * from "./All.mjs";',
    ].join("\n"),
  );

  assert.deepEqual(found.map((entry) => entry.kind), ["export-from", "export-from"]);
  assert.deepEqual(found.map((entry) => entry.specifier), ["./Thing.mjs", "./All.mjs"]);
});

/**
 * The tree has 17 backtick dynamic imports today. A scanner that only handled
 * quotes would pass the templates move and fail at runtime, so the
 * no-substitution template literal is a first-class literal import.
 */
test("finds literal dynamic imports in all three quote styles", () => {
  const found = scanImports(
    [
      'const a = await import("./A.mjs");',
      "const b = await import('../B.mjs');",
      "const c = await import(`./C.mjs`);",
    ].join("\n"),
  );

  assert.deepEqual(found.map((entry) => entry.kind), ["dynamic", "dynamic", "dynamic"]);
  assert.deepEqual(found.map((entry) => entry.specifier), ["./A.mjs", "../B.mjs", "./C.mjs"]);
  assert.deepEqual(found.map((entry) => entry.computed), [false, false, false]);
});

test("finds dynamic imports split across lines", () => {
  const found = scanImports(
    ["const mod = await import(", '  "./Wrapped.mjs"', ");"].join("\n"),
  );

  assert.equal(found.length, 1);
  assert.equal(found[0].specifier, "./Wrapped.mjs");
  assert.equal(found[0].kind, "dynamic");
});

/**
 * A template literal with a substitution cannot be resolved statically. It must
 * be reported as a manual smoke-test obligation rather than silently dropped or
 * falsely failed. The tree has zero of these today.
 */
test("reports computed dynamic imports without guessing a path", () => {
  const found = scanImports("await import(`./presets/${name}.mjs`);");

  assert.equal(found.length, 1);
  assert.equal(found[0].computed, true);
  assert.equal(found[0].specifier, null);
  assert.equal(found[0].raw, "./presets/${name}.mjs");
});

test("records 1-based line numbers", () => {
  const found = scanImports(
    ["// header", "", 'import { x } from "./X.mjs";', "", 'await import("./Y.mjs");'].join("\n"),
  );

  assert.deepEqual(found.map((entry) => entry.line), [3, 5]);
});

test("ignores imports inside line comments", () => {
  assert.deepEqual(specifiers('// import { a } from "./Ghost.mjs";'), []);
  assert.deepEqual(specifiers('const x = 1; // await import("./Ghost.mjs")'), []);
});

test("ignores imports inside block comments", () => {
  const source = ['/*', ' * import { a } from "./Ghost.mjs";', ' * await import("./Ghost2.mjs");', ' */'].join("\n");

  assert.deepEqual(specifiers(source), []);
});

test("ignores import-looking text inside string literals", () => {
  const source = [
    'const help = "import { a } from \'./Ghost.mjs\'";',
    "const other = 'await import(\"./Ghost2.mjs\")';",
    "const tpl = `import { c } from \"./Ghost3.mjs\"`;",
  ].join("\n");

  assert.deepEqual(specifiers(source), []);
});

/**
 * Regex literals routinely contain quote characters. Without regex awareness the
 * masker treats that quote as the start of a string and every subsequent import
 * in the file is mis-parsed — a silent under-report, the worst failure mode for
 * a gate.
 */
test("ignores quote characters inside regex literals", () => {
  const source = [
    'const pattern = /src="\\$\\{/g;',
    'import { real } from "./Real.mjs";',
  ].join("\n");

  assert.deepEqual(specifiers(source), ["./Real.mjs"]);
});

test("does not mistake division for a regex literal", () => {
  const source = ["const ratio = width / 2;", 'import { real } from "./Real.mjs";'].join("\n");

  assert.deepEqual(specifiers(source), ["./Real.mjs"]);
});

test("ignores import.meta and identifiers containing 'import'", () => {
  const source = [
    "const base = import.meta.url;",
    'const importantThing = "./NotAnImport.mjs";',
    "obj.import = 1;",
  ].join("\n");

  assert.deepEqual(specifiers(source), []);
});

test("reports bare and absolute specifiers but marks them non-relative", () => {
  const found = scanImports(
    ['import a from "rot-js";', 'import b from "/absolute/path.mjs";', 'import c from "./Rel.mjs";'].join("\n"),
  );

  assert.deepEqual(found.map((entry) => entry.relative), [false, false, true]);
});

test("resolves relative specifiers against the importing file", () => {
  const from = "/repo/scripts/effects/AuraEffectsSD.mjs";

  assert.equal(resolveSpecifier(from, "./AuraConfig.mjs"), "/repo/scripts/effects/AuraConfig.mjs");
  assert.equal(resolveSpecifier(from, "../shared/sd4Compat.mjs"), "/repo/scripts/shared/sd4Compat.mjs");
});

test("strips query and hash before resolving", () => {
  const from = "/repo/scripts/A.mjs";

  assert.equal(resolveSpecifier(from, "./B.mjs?v=2"), "/repo/scripts/B.mjs");
  assert.equal(resolveSpecifier(from, "./B.mjs#frag"), "/repo/scripts/B.mjs");
});

/**
 * Foundry serves module scripts as static files and the browser's ESM resolver
 * performs no extension search. An extensionless specifier must resolve to a
 * file of that exact name or it is a genuine 404 — never silently upgraded
 * to the .mjs sibling.
 */
test("does not invent an extension when resolving", () => {
  assert.equal(resolveSpecifier("/repo/scripts/A.mjs", "./B"), "/repo/scripts/B");
});

/**
 * `TMFXFilterEditor` reaches sideways into the TokenMagic module with
 * `../../tokenmagic/…`, behind a try/catch that falls back to an older
 * TokenMagic layout. Whether either path exists depends on which optional
 * modules the developer happens to have installed, so existence there can never
 * be a blocking gate — that would make the check machine-dependent.
 *
 * The escape *depth* is a genuine move hazard though: moving that file one
 * directory deeper silently retargets `../../tokenmagic` at this module's own
 * folder. Classification is what catches that, and it needs no filesystem.
 */
test("classifies imports that stay inside the repository", () => {
  const target = classifyTarget("/foundry/modules/sdx", "/foundry/modules/sdx/scripts/A.mjs", "./B.mjs");

  assert.equal(target.scope, "internal");
  assert.equal(target.resolved, "/foundry/modules/sdx/scripts/B.mjs");
});

test("classifies sideways imports into a sibling Foundry module", () => {
  const target = classifyTarget(
    "/foundry/modules/sdx",
    "/foundry/modules/sdx/scripts/TMFXFilterEditor.mjs",
    "../../tokenmagic/gui/apps/PresetSearch.js",
  );

  assert.equal(target.scope, "sibling-module");
  assert.equal(target.siblingModule, "tokenmagic");
});

test("a deeper home turns a sibling-module import into a broken internal one", () => {
  const target = classifyTarget(
    "/foundry/modules/sdx",
    "/foundry/modules/sdx/scripts/animation/TMFXFilterEditor.mjs",
    "../../tokenmagic/gui/apps/PresetSearch.js",
  );

  // Now points at <module>/tokenmagic, which does not exist — the internal
  // existence rule reports it, which is exactly the move regression wanted.
  assert.equal(target.scope, "internal");
  assert.equal(target.resolved, "/foundry/modules/sdx/tokenmagic/gui/apps/PresetSearch.js");
});

test("flags imports that escape above the Foundry modules directory", () => {
  const target = classifyTarget(
    "/foundry/modules/sdx",
    "/foundry/modules/sdx/scripts/A.mjs",
    "../../../../elsewhere/B.mjs",
  );

  assert.equal(target.scope, "escaped");
});
