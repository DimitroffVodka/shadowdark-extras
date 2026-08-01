import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveProjectImports } from "../tools/resolve-imports.mjs";
import { findScriptPathStrings, FORBIDDEN } from "../tools/script-path-guard.mjs";
import {
  collectRegistrations,
  readSnapshot,
  diffSnapshot,
  scanRootCompositionCalls,
} from "../tools/registration-snapshot.mjs";
import { collectEsmoduleExports, diffExports } from "../tools/api-export-snapshot.mjs";
import { collectSettingsKeys, diffSettings } from "../tools/settings-snapshot.mjs";
import { findUnboundCalls } from "../tools/binding-scan.mjs";
import { scanImports } from "../tools/import-scan.mjs";
import { REPO_ROOT, listJsFiles, toRepoPath, isVendor } from "../tools/project-scan.mjs";

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

test("registration snapshot: catches reordered root composition calls", () => {
  const baseline = {
    totals: {},
    modules: {},
    rootCompositionCalls: ["registerAlpha", "initBeta"],
  };
  const current = {
    totals: {},
    modules: {},
    rootCompositionCalls: ["initBeta", "registerAlpha"],
  };

  const differences = diffSnapshot(baseline, current);
  assert.ok(
    differences.some((line) => line === "root composition[0]: registerAlpha -> initBeta"),
    differences.join("; "),
  );
});

test("registration snapshot: root call scanner ignores declarations and masked text", () => {
  const source = `
    function registerDeclared() {}
    const help = "registerQuoted()";
    // initCommented();
    registerActual();
    await initActual();
  `;

  assert.deepEqual(scanRootCompositionCalls(source), ["registerActual", "initActual"]);
});

test("registration snapshot: FAILING FIXTURE — scanner is blind to reference-passed class seams", () => {
  // Phase 5.0.8 part 3. The root registers sheets by passing the CLASS BY
  // REFERENCE: foundry.documents.collections.Actors.registerSheet(MODULE_ID,
  // PartySheetSD, {...}). The `.`-prefixed call is excluded from the
  // register/init scan by design (method calls are not root seams), so the
  // scanner sees nothing — and a split that swaps PartySheetSD for another
  // class changes runtime behaviour with a green snapshot.
  const source = `
    foundry.documents.collections.Actors.registerSheet(MODULE_ID, PartySheetSD, { types: ["Player"] });
    foundry.documents.collections.Items.registerSheet(MODULE_ID, PotionSheetSD, {});
  `;

  const calls = scanRootCompositionCalls(source);
  assert.ok(
    calls.some((c) => c.includes("PartySheetSD")),
    "expected the scanner to surface the reference-passed PartySheetSD seam; got: " + JSON.stringify(calls),
  );
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
// ---------------------------------------------------- settings snapshot

test("settings snapshot: the real tree matches the committed baseline", () => {
  const baseline = JSON.parse(readFileSync(path.join(REPO_ROOT, "dev/snapshots/settings-keys.json"), "utf8"));

  assert.deepEqual(diffSettings(baseline, collectSettingsKeys()), []);
});

/**
 * The failure that matters: a key that vanishes takes every GM's stored value
 * with it, silently. The message has to name that consequence, because a bare
 * "key removed" reads like a tidy-up rather than data loss.
 */
test("settings snapshot: catches a removed key and says why it matters", () => {
  const baseline = { keys: ["enableAuras", "hexFog"], menus: [], dynamicSites: [] };
  const current = { keys: ["enableAuras"], menus: [], dynamicSites: [] };

  const differences = diffSettings(baseline, current);
  assert.equal(differences.length, 1);
  assert.match(differences[0], /REMOVED "hexFog"/);
  assert.match(differences[0], /orphaned/);
});

test("settings snapshot: catches a renamed key as a remove plus an add", () => {
  const baseline = { keys: ["enableAuras"], menus: [], dynamicSites: [] };
  const current = { keys: ["enableAurasV2"], menus: [], dynamicSites: [] };

  const differences = diffSettings(baseline, current);
  assert.equal(differences.length, 2);
  assert.ok(differences.some((line) => line.includes('REMOVED "enableAuras"')));
  assert.ok(differences.some((line) => line.includes('added "enableAurasV2"')));
});

test("settings snapshot: catches a removed settings menu", () => {
  const baseline = { keys: [], menus: ["combatSettingsMenu"], dynamicSites: [] };
  const current = { keys: [], menus: [], dynamicSites: [] };

  assert.match(diffSettings(baseline, current)[0], /menus: REMOVED "combatSettingsMenu"/);
});

/**
 * The scanner is blind to keys built in loops. If that blind spot changes size,
 * the gate's coverage changed and nobody would otherwise notice.
 */
test("settings snapshot: catches the unenumerable blind spot changing size", () => {
  const baseline = { keys: [], menus: [], dynamicSites: ["a.mjs:1"] };
  const current = { keys: [], menus: [], dynamicSites: ["a.mjs:1", "b.mjs:2"] };

  assert.match(diffSettings(baseline, current)[0], /blind spot changed size/);
});

/**
 * The Quench batch reconstructs the exact live key set from this baseline, so
 * the pieces it needs must be present and disjoint. A count would not be
 * enough: swapping one loop-built key for another preserves the count while
 * losing a setting.
 */
test("settings snapshot: records what the Quench batch needs to rebuild the live set", () => {
  const baseline = JSON.parse(readFileSync(path.join(REPO_ROOT, "dev/snapshots/settings-keys.json"), "utf8"));

  assert.ok(Array.isArray(baseline.dynamicKeys), "dynamicKeys must be recorded from a live world");
  assert.ok(baseline.dynamicKeys.length > 0, "dynamicKeys is empty — recapture it");

  // The two sets describe different things and must not overlap: `keys` is what
  // the scanner can read, `dynamicKeys` is what only a running world reveals.
  const overlap = baseline.dynamicKeys.filter((key) => baseline.keys.includes(key));
  assert.deepEqual(overlap, [], `dynamicKeys duplicates statically-found keys: ${overlap.join(", ")}`);

  const gated = Object.values(baseline.optionalModuleGated ?? {}).flat();
  for (const key of gated) {
    assert.ok(baseline.keys.includes(key), `gated key "${key}" should also appear in the static key list`);
  }
});

/**
 * The declared esmodule's original export names are a compatibility contract.
 * Feature modules no longer import the root — that is the dependency property
 * the track needed — but external consumers may still import these names from
 * the manifest entry point. Keep the forwarding surface exact.
 */
test("api-export snapshot: the composition root preserves its compatibility exports", () => {
  const { esmodules } = collectEsmoduleExports();

  assert.deepEqual(esmodules["shadowdark-extras.mjs"].names, [
    "executeItemMacro",
    "getCustomLightSources",
    "hasItemMacro",
  ]);
});

/**
 * Detect any import of the composition root, by any spelling.
 *
 * USES `scanImports`, NOT A REGEX. The first version of this guard matched
 * `["']` only, so `await import(\`../shadowdark-extras.mjs\`)` slipped straight
 * through — and a backtick dynamic import is not hypothetical here: the
 * resolver test above uses exactly that shape as its broken-move fixture.
 * A guard advertised as making an inversion impossible must not be weaker than
 * the parser the rest of the tooling already shares.
 */
function rootImporters(sources) {
  const offenders = [];
  for (const [repoPath, source] of sources) {
    for (const imported of scanImports(source)) {
      if (imported.raw?.includes("shadowdark-extras.mjs")) {
        offenders.push(repoPath);
        break;
      }
    }
  }
  return offenders;
}

test("no module reaches the composition root, statically or dynamically", () => {
  const sources = [];
  for (const file of listJsFiles(["scripts", "data"])) {
    const repoPath = toRepoPath(file);
    if (repoPath === "scripts/shadowdark-extras.mjs" || isVendor(repoPath)) continue;
    sources.push([repoPath, readFileSync(file, "utf8")]);
  }

  assert.deepEqual(rootImporters(sources), [],
    "a feature module importing the composition root is the dependency inversion this track removed");
});

test("the root-import guard catches every import spelling, including backticks", () => {
  const shapes = {
    "static.mjs": 'import { x } from "../shadowdark-extras.mjs";\n',
    "static-single.mjs": "import { x } from '../shadowdark-extras.mjs';\n",
    "dynamic.mjs": 'const m = await import("../shadowdark-extras.mjs");\n',
    // The shape the first version of this guard missed entirely.
    "dynamic-backtick.mjs": "const m = await import(`../shadowdark-extras.mjs`);\n",
    "reexport.mjs": 'export { x } from "../shadowdark-extras.mjs";\n',
  };
  for (const [name, source] of Object.entries(shapes)) {
    assert.deepEqual(rootImporters([[name, source]]), [name], `missed the ${name} shape`);
  }

  // And it must not fire on a mere mention — every surviving reference to the
  // root in the tree today is a doc comment, and those must stay legal.
  const innocent = [
    ["comment.mjs", " * Called from shadowdark-extras.mjs ready hook\n"],
    ["string.mjs", 'const label = "shadowdark-extras.mjs";\n'],
  ];
  assert.deepEqual(rootImporters(innocent), [], "a comment or string is not an import");
});

/**
 * `getCustomLightSources` used to be the root's third export, and this test
 * pinned it because party/PartySheetSD.mjs imported it FROM the composition
 * root — the feature→root direction the structural track exists to remove.
 *
 * It now lives in canvas/light-templates.mjs. Loosening the assertion to "two
 * names" alone would have dropped the guard entirely, so the guard follows the
 * name to its new home: the module must export it, and the consumer must reach
 * it there rather than through the root.
 */
test("light templates own getCustomLightSources, and PartySheetSD imports it from there", () => {
  const modulePath = path.join(REPO_ROOT, "scripts/canvas/light-templates.mjs");
  const moduleSource = readFileSync(modulePath, "utf8");
  assert.match(
    moduleSource,
    /^export function getCustomLightSources\(/m,
    "canvas/light-templates.mjs must export getCustomLightSources",
  );

  const consumerSource = readFileSync(path.join(REPO_ROOT, "scripts/party/PartySheetSD.mjs"), "utf8");
  assert.match(
    consumerSource,
    /import \{ getCustomLightSources \} from "\.\.\/canvas\/light-templates\.mjs";/,
    "PartySheetSD.mjs must import getCustomLightSources from canvas/light-templates.mjs",
  );
  assert.doesNotMatch(
    consumerSource,
    /from "\.\.\/shadowdark-extras\.mjs"/,
    "no feature module may import from the composition root",
  );
});

/**
 * Regression tests for the binding gate's class-field rule (21ce0c4).
 *
 * The rule exists so `static DEFAULT_OPTIONS = {…}` in an extracted AppV2 class
 * does not read as an unbound call. Its first version matched a bare
 * `name = …` on any indented line, which bound every assignment inside every
 * function body — so a genuinely undefined call went UNREPORTED. Review caught
 * it. A gate that quietly stops reporting is worse than the blind spot it was
 * written to close, so both directions are pinned here.
 */
test("binding gate: an assignment inside a function does NOT bind the name away", () => {
  const source = [
    "function f() {",
    "\tmissingHelper = 1;",
    "\treturn missingHelper();",
    "}",
  ].join("\n");

  const names = findUnboundCalls(source).map((u) => u.name);
  assert.deepEqual(names, ["missingHelper"],
    "assigning to a name must not stop the gate reporting a call to it");
});

test("binding gate: a plain undefined call is still reported", () => {
  const names = findUnboundCalls("function g() {\n\treturn genuinelyMissing();\n}").map((u) => u.name);
  assert.deepEqual(names, ["genuinelyMissing"]);
});

test("binding gate: static class fields do not read as unbound calls", () => {
  const source = [
    "class X extends Y {",
    "\tstatic DEFAULT_OPTIONS = { a: 1 };",
    "\tstatic PARTS = { b: 2 };",
    "\trender() { return DEFAULT_OPTIONS; }",
    "}",
  ].join("\n");

  assert.deepEqual(findUnboundCalls(source), [],
    "the ApplicationV2 static-field idiom must not be reported");
});

/**
 * Regression tests for the binding gate's call-detection lookbehind.
 *
 * The call regex used to open with a CONSUMING group, `(^|[^\w$.?])`. In
 * `if (isPartyActor(actor))` the `if (` match ate the `(` that `isPartyActor(`
 * needed, so the inner call was never seen — every call written as the first
 * thing inside `if (`, `while (`, `switch (` or `return (` was invisible.
 *
 * That is not hypothetical: the Phase 3 move of `applyNpcPlayerTheme` into
 * `npc/npc-sheet-inventory.mjs` shipped `isPartyActor is not defined` past a
 * green gate, and a live NPC sheet render caught it, not the gate.
 */
test("binding gate: an undefined call directly inside if(...) is reported", () => {
  const source = "function f(actor) {\n\tif (isPartyActor(actor)) return;\n}";
  assert.deepEqual(findUnboundCalls(source).map((u) => u.name), ["isPartyActor"],
    "a consuming preceding-char group hides this shape entirely");
});

test("binding gate: undefined calls inside while/return parens are reported", () => {
  for (const source of [
    "function f(a) {\n\twhile (missingFn(a)) { a--; }\n}",
    "function f(a) {\n\treturn (missingFn(a));\n}",
    "function f(a) {\n\tif (missingFn(a)) { return 1; }\n}",
  ]) {
    assert.deepEqual(findUnboundCalls(source).map((u) => u.name), ["missingFn"], source);
  }
});

test("binding gate: the lookbehind did not start flagging method definitions", () => {
  const source = "class C {\n\tfoo(a) { return a; }\n\tbar() { return this.foo(1); }\n}";
  assert.deepEqual(findUnboundCalls(source), [],
    "a definition is `name(…) {` and must still be skipped");
});

test("binding gate: a locally declared function called inside if(...) is not reported", () => {
  const source = "function ok(a) { return a; }\nfunction f() {\n\tif (ok(1)) return;\n}";
  assert.deepEqual(findUnboundCalls(source), [],
    "the fix must not turn every guarded call into a false positive");
});

test("binding gate: an undefined call inside a template-literal interpolation is reported", () => {
  // The real site of the `unescape` finding in 13f92f0 — DungeonGenerator.mjs:752
  // is `${btoa(unescape(encodeURIComponent(s)))}`, where btoa's match consumed
  // the paren unescape needed. Interpolations are CODE, not string content, so
  // the masker keeps them and the scanner must see through to the inner call.
  const source = "function f(s) {\n\treturn `data:${btoa(missingFn(s))}`;\n}";
  assert.deepEqual(findUnboundCalls(source).map((u) => u.name), ["missingFn"],
    "a call nested inside an interpolation must not be hidden by its outer call");
});

test("binding gate: a call to a name that is never imported is reported", () => {
  // The plainest extraction failure: lifted code calls a helper left behind.
  const source = [
    'import { MODULE_ID } from "../shared/module-id.mjs";',
    "export function moved(actor) {",
    "\tconsole.log(MODULE_ID);",
    "\treturn helperLeftBehind(actor);",
    "}",
  ].join("\n");
  assert.deepEqual(findUnboundCalls(source).map((u) => u.name), ["helperLeftBehind"],
    "the imported name is bound; the un-imported one is the whole point of this gate");
});

test("binding gate: CONST is a known global, not an unbound reference", () => {
  // `CONST` is Foundry's global constants namespace and matches the
  // SCREAMING_SNAKE reference scan, so before it was listed every module that
  // read one of its members produced a baseline entry. Verified live in world
  // `0100` on Foundry 14.365: `CONST === foundry.CONST`.
  const source = "function f() {\n\treturn CONST.KEYBINDING_PRECEDENCE.NORMAL;\n}";
  assert.deepEqual(findUnboundCalls(source), [],
    "a real global must not read as an extraction leftover");
});
