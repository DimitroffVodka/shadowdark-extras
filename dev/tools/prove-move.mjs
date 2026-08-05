#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import * as acorn from "acorn";

/**
 * Prove that declarations moved between files are ESTree-identical.
 *
 * An extraction is only safe if the code that moved is the SAME code. Reading
 * two diffs side by side does not establish that — a dropped `await`, a flipped
 * default, a lost `?.` all survive a careful eye. This parses the declaration
 * out of both revisions, strips position data, and compares the trees.
 *
 * Usage:
 *   node dev/tools/prove-move.mjs <baseRef> <fromPath> <toPath> [name…]
 *
 * With no names, every top-level declaration of `toPath` is checked against
 * `fromPath` at `baseRef`. Exit 0 means every named declaration exists in both
 * and their trees match exactly.
 */

const POSITION_KEYS = new Set(["start", "end", "loc", "range", "raw"]);

function parse(source, label) {
  try {
    return acorn.parse(source, { ecmaVersion: 2023, sourceType: "module" });
  }
  catch (err) {
    console.error(`[prove-move] cannot parse ${label}: ${err.message}`);
    process.exit(2);
  }
}

/**
 * Strip everything that legitimately differs between two copies of the same
 * declaration. Positions shift because the surrounding file differs; `raw` is
 * dropped with them because it is only ever the source text of a literal, and
 * `value` — which is compared — already carries its meaning.
 */
function normalize(node) {
  if (Array.isArray(node)) return node.map(normalize);
  if (!node || typeof node !== "object") return node;

  const out = {};
  for (const key of Object.keys(node).sort()) {
    if (POSITION_KEYS.has(key)) continue;
    out[key] = normalize(node[key]);
  }
  return out;
}

/** Map every top-level declaration of a module to its normalized tree. */
function declarations(ast) {
  const found = new Map();

  for (const node of ast.body) {
    const target = node.type === "ExportNamedDeclaration" && node.declaration
      ? node.declaration
      : node;

    if (target.type === "FunctionDeclaration" || target.type === "ClassDeclaration") {
      found.set(target.id.name, normalize(target));
    }
    else if (target.type === "VariableDeclaration") {
      for (const declarator of target.declarations) {
        if (declarator.id.type === "Identifier") {
          found.set(declarator.id.name, normalize(declarator));
        }
      }
    }
  }

  return found;
}

function readAtRef(ref, path) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" });
  }
  catch {
    console.error(`[prove-move] cannot read ${path} at ${ref}`);
    process.exit(2);
  }
}

function main() {
  const [baseRef, fromPath, toPath, ...names] = process.argv.slice(2);
  if (!baseRef || !fromPath || !toPath) {
    console.error("usage: prove-move.mjs <baseRef> <fromPath> <toPath> [name…]");
    process.exit(2);
  }

  const before = declarations(parse(readAtRef(baseRef, fromPath), `${fromPath}@${baseRef}`));
  const after = declarations(parse(readFileSync(toPath, "utf8"), toPath));

  const wanted = names.length > 0 ? names : [...after.keys()];
  const mismatched = [];
  const missing = [];

  for (const name of wanted) {
    if (!before.has(name)) { missing.push(`${name} — absent from ${fromPath}@${baseRef}`); continue; }
    if (!after.has(name)) { missing.push(`${name} — absent from ${toPath}`); continue; }

    if (JSON.stringify(before.get(name)) !== JSON.stringify(after.get(name))) {
      mismatched.push(name);
    }
  }

  for (const problem of missing) console.log(`  MISSING   ${problem}`);
  for (const name of mismatched) console.log(`  CHANGED   ${name} — tree differs, this is not a pure move`);

  const proven = wanted.length - missing.length - mismatched.length;
  console.log(
    `prove-move: ${proven}/${wanted.length} declarations ESTree-identical ` +
      `(${fromPath}@${baseRef} -> ${toPath})`,
  );

  if (missing.length > 0 || mismatched.length > 0) process.exit(1);
}

main();
