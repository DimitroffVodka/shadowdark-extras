#!/usr/bin/env node
import { readFileSync } from "node:fs";

import * as acorn from "acorn";

import { listJsFiles, toRepoPath, isVendor } from "./project-scan.mjs";

/**
 * Duplicated-constant drift gate.
 *
 * The Phase 5.3 splits duplicate small constants into each extracted module —
 * `MODULE_ID`, `GRID_SIZE`, `WALL_THICKNESS`, `LEVEL_HEIGHT` — rather than
 * importing them, deliberately, so the extracted modules stay import-free
 * leaves with no cycle back into their origin.
 *
 * That trade has a cost nothing else can see. `prove-move` compares declaration
 * ASTs WITHOUT resolving what the identifiers inside them refer to, so a moved
 * function can keep a byte-identical body while the constant it reads changes
 * value in one copy and not the other. The gate passes; the geometry is wrong.
 *
 * This is the missing half: same name, different value, in more than one
 * first-party module, is a drift and blocks.
 *
 * Literal initialisers only. A computed constant is not comparable across
 * files without resolving it, and guessing would produce exactly the confident
 * wrong answer this repository keeps having to correct.
 */

/**
 * Names that are duplicated ON PURPOSE with different values per module.
 *
 * `SETTING_KEY` is the module-local name of a world setting — `contentRegistry`
 * in one file, `decorDungeondraftPacks` in another. Divergence is the point.
 *
 * `TABLE_NAME` is the same shape one level out: three standalone table-builder
 * macros under `scripts/macros/`, each naming the table it creates.
 *
 * Measured, not guessed: of the 12 literal constants declared in more than one
 * first-party module, these two are the only ones whose copies legitimately
 * differ. Keep that true — add a name here only with a reason, because every
 * addition is a place drift stops being visible.
 */
const INTENTIONALLY_PER_MODULE = new Set(["SETTING_KEY", "TABLE_NAME"]);

export function collectConstants() {
  const files = listJsFiles(["scripts"]).filter(file => !isVendor(toRepoPath(file)));
  const byName = new Map();

  for (const file of files) {
    let ast;
    try {
      ast = acorn.parse(readFileSync(file, "utf8"), { ecmaVersion: 2023, sourceType: "module" });
    }
    catch {
      // Left to the other gates. A parse failure here would only hide drift in
      // one file, not fabricate agreement, so it does not need to block.
      continue;
    }

    for (const node of ast.body) {
      const target = node.type === "ExportNamedDeclaration" && node.declaration
        ? node.declaration
        : node;
      if (target.type !== "VariableDeclaration" || target.kind !== "const") continue;

      for (const declarator of target.declarations) {
        if (declarator.id.type !== "Identifier") continue;
        if (declarator.init?.type !== "Literal") continue;

        const name = declarator.id.name;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push({ file: toRepoPath(file), value: declarator.init.value });
      }
    }
  }

  return byName;
}

export function findDrift(byName) {
  const drifted = [];

  for (const [name, copies] of byName) {
    if (copies.length < 2) continue;
    if (INTENTIONALLY_PER_MODULE.has(name)) continue;

    const values = new Set(copies.map(copy => JSON.stringify(copy.value)));
    if (values.size > 1) drifted.push({ name, copies });
  }

  return drifted.sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const byName = collectConstants();
  const duplicated = [...byName.values()].filter(copies => copies.length > 1).length;
  const drifted = findDrift(byName);

  console.log(
    `const drift: ${duplicated} literal constants declared in more than one module `
      + `(${INTENTIONALLY_PER_MODULE.size} exempt as intentionally per-module)`,
  );

  if (drifted.length > 0) {
    for (const { name, copies } of drifted) {
      console.log(`  DRIFT ${name}`);
      for (const copy of copies) console.log(`    ${JSON.stringify(copy.value)}  ${copy.file}`);
    }
    console.log(
      `[BLOCK] ${drifted.length} duplicated constant(s) disagree. The splits duplicate these on `
        + "purpose to keep extracted modules import-free; prove-move cannot see the difference, "
        + "because it compares declaration trees without resolving what they read.",
    );
    process.exit(1);
  }

  console.log("const drift: OK");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
