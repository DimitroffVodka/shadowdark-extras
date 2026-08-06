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
  const argv = process.argv.slice(2);

  // `--origin-at <ref>` pins the origin's POST-move state. It defaults to the
  // working tree, which is right while verifying a fresh extraction. It is
  // wrong for re-proving an older one: the origin has been shrunk by every
  // extraction since, so everything those moved reads as departed-and-lost.
  let originAt = null;
  const flagIndex = argv.indexOf("--origin-at");
  if (flagIndex !== -1) {
    originAt = argv[flagIndex + 1];
    argv.splice(flagIndex, 2);
  }

  // `--derive` prints what left the origin and stops. It is a helper for
  // writing the name list, NOT a way to run without one: a derived list proves
  // everything that left arrived, but it cannot prove the RIGHT things left.
  // An accidentally-moved extra function is identical in both files and would
  // sail through. Naming them is the assertion of intent; the derived set is
  // the completeness check. The gate wants both.
  const deriveOnly = argv.includes("--derive");
  if (deriveOnly) argv.splice(argv.indexOf("--derive"), 1);

  const [baseRef, fromPath, toPath, ...names] = argv;
  if (!baseRef || !fromPath || !toPath) {
    console.error(
      "usage: prove-move.mjs [--origin-at <ref>] [--derive] "
        + "<baseRef> <fromPath> <toPath>[,<toPath>…] <name…>",
    );
    process.exit(2);
  }

  const before = declarations(parse(readAtRef(baseRef, fromPath), `${fromPath}@${baseRef}`));

  // Several destinations may be given, comma-separated. A base range can span
  // more than one extraction — the interior-walls move and the tile-catalogue
  // move share a base — and a declaration that left the origin for a SIBLING
  // destination is accounted for, not lost. Without this the completeness
  // check reports false positives the moment two seams share a base.
  const toPaths = toPath.split(",").map(p => p.trim()).filter(Boolean);
  const after = new Map();
  const homeOf = new Map();
  for (const path of toPaths) {
    for (const [name, tree] of declarations(parse(readFileSync(path, "utf8"), path))) {
      if (!after.has(name)) { after.set(name, tree); homeOf.set(name, path); }
    }
  }

  // What actually LEFT the origin. This is the completeness question, and the
  // reason the tool no longer derives its work list from the destination.
  //
  // Deriving from the destination only ever asked "is what arrived identical?",
  // which is unfalsifiable in the direction that matters: an empty destination
  // reported 0/0 and exited 0, and naming two of four moved functions reported
  // 2/2 and said nothing about the other two. A dropped declaration was
  // invisible. Comparing the origin against itself is what makes a missing
  // declaration a failure rather than a smaller number.
  const originSource = originAt
    ? readAtRef(originAt, fromPath)
    : readFileSync(fromPath, "utf8");
  const originLabel = originAt ? `${fromPath}@${originAt}` : fromPath;
  const nowAtOrigin = declarations(parse(originSource, originLabel));
  const departed = [...before.keys()].filter(name => !nowAtOrigin.has(name));

  if (departed.length === 0) {
    console.log(
      `[BLOCK] prove-move: nothing to prove — no declaration left ${fromPath} since ${baseRef}. `
        + "A move that moved nothing is a mistake, not a pass.",
    );
    process.exit(1);
  }

  if (deriveOnly) {
    console.log(`${departed.length} declarations left ${fromPath} since ${baseRef}:`);
    console.log(`  ${departed.join(" ")}`);
    return;
  }

  if (names.length === 0) {
    console.log(
      "[BLOCK] prove-move: name the declarations you moved. Deriving the list from the tree "
        + "proves everything that left arrived, but not that the right things left — an "
        + "accidentally-moved function is identical in both files and passes silently.",
    );
    console.log(`  ${departed.length} left the origin; run with --derive to list them.`);
    process.exit(1);
  }

  const wanted = names;
  const mismatched = [];
  const missing = [];

  // Named but still in the origin: the claim is wrong in the other direction.
  const notDeparted = wanted.filter(name => !departed.includes(name));

  for (const name of wanted) {
    if (!before.has(name)) { missing.push(`${name} — absent from ${fromPath}@${baseRef}`); continue; }
    if (!after.has(name)) { missing.push(`${name} — absent from ${toPaths.join(", ")}`); continue; }

    if (JSON.stringify(before.get(name)) !== JSON.stringify(after.get(name))) {
      mismatched.push(name);
    }
  }

  // Anything that left the origin and was not named. The list is only as
  // complete as whoever wrote it, so this is what catches an omission — whether
  // the declaration vanished entirely or was quietly moved without being
  // declared. Both are failures: the first loses code, the second means the
  // change is larger than the author claimed.
  const undeclared = departed.filter(name => !wanted.includes(name));

  for (const problem of missing) console.log(`  MISSING     ${problem}`);
  for (const name of mismatched) console.log(`  CHANGED     ${name} — tree differs, this is not a pure move`);
  for (const name of notDeparted) {
    console.log(`  NOT MOVED   ${name} — named as moved, but it is still in ${fromPath}`);
  }
  for (const name of undeclared) {
    const where = after.has(name) ? `it is in ${homeOf.get(name)}` : "it is in no destination given";
    console.log(`  UNDECLARED  ${name} — left ${fromPath} without being named; ${where}`);
  }

  const proven = wanted.length - missing.length - mismatched.length;
  console.log(
    `prove-move: ${proven}/${wanted.length} named declarations ESTree-identical, `
      + `${departed.length} left the origin, ${undeclared.length} undeclared `
      + `(${fromPath}@${baseRef} -> ${toPaths.join(", ")})`,
  );

  const failed = missing.length + mismatched.length + notDeparted.length + undeclared.length;
  if (failed > 0) process.exit(1);
}

main();
