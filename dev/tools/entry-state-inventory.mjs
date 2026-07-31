#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { maskSource } from "./import-scan.mjs";
import { buildLineIndex, lineAt } from "./call-scan.mjs";
import { scanTopLevelState } from "./entry-state-scan.mjs";
import { REPO_ROOT } from "./project-scan.mjs";

/**
 * Phase 3 gate: the module-scope state inventory of the composition root.
 *
 * The plan requires this BEFORE the first extraction, and treats it as a gate:
 * an extraction that touches a variable absent from the inventory stops until
 * the inventory is corrected.
 *
 * What it answers, for each `Hooks.on/once/off` registration in the root:
 * which module-scope MUTABLE variables does this registration's callback
 * touch? A registration touching none is a leaf — safe to lift into its own
 * module, because it shares nothing that extraction could accidentally split
 * into two separate copies. Registrations sharing a variable must move
 * together or not at all.
 *
 * Mutability is per variable, not per keyword: `const` freezes the binding, not
 * the value, so a `const` holding a Set is mutable state.
 *
 * LIMIT OF THIS ANALYSIS — read before trusting the leaf count. It detects
 * DIRECT references only: a variable named inside the registration's own
 * callback body. A registration that calls a top-level helper which then
 * mutates shared state is reported as a leaf, because the coupling is one hop
 * away. So "touches no module state" means "no direct reference", which makes
 * the leaf list a set of CANDIDATES to inspect, never a list of proven-safe
 * extractions. Each candidate still needs its call graph read before it moves.
 */

const ENTRY = "scripts/shadowdark-extras.mjs";
const SNAPSHOT_PATH = new URL("../snapshots/entry-state.json", import.meta.url);

/** Find each Hooks registration and the source span of its callback. */
function registrationSpans(masked, maskedChars, lineStarts) {
  const spans = [];
  for (const match of masked.matchAll(/\bHooks\s*\.\s*(on|once|off)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let end = open;
    while (end < maskedChars.length) {
      const c = maskedChars[end];
      if ("{([".includes(c)) depth += 1;
      else if ("})]".includes(c)) {
        depth -= 1;
        if (depth === 0) break;
      }
      end += 1;
    }
    // First literal argument is the hook name; read it from the masked text's
    // neighbourhood in the ORIGINAL source.
    const nameMatch = masked.slice(open, Math.min(open + 200, masked.length)).match(/["'`]/);
    spans.push({ api: `Hooks.${match[1]}`, start: open, end, line: lineAt(lineStarts, open), hasName: Boolean(nameMatch) });
  }
  return spans;
}

export function buildInventory() {
  const absolute = path.join(REPO_ROOT, ENTRY);
  const source = readFileSync(absolute, "utf8");
  const { masked, maskedChars } = maskSource(source);
  const lineStarts = buildLineIndex(source);

  const declarations = scanTopLevelState(source);
  const mutable = declarations.filter((d) => d.mutable);

  // Reference positions for each mutable variable, in code only (masked).
  const references = new Map();
  for (const variable of mutable) {
    const pattern = new RegExp(String.raw`(^|[^\w$.])${variable.name}\b`, "g");
    const positions = [];
    for (const hit of masked.matchAll(pattern)) {
      const at = hit.index + hit[1].length;
      if (at === variable.declaredAt) continue;
      positions.push(at);
    }
    references.set(variable.name, positions);
  }

  const spans = registrationSpans(masked, maskedChars, lineStarts);
  const perRegistration = spans.map((span) => {
    const touches = mutable
      .filter((v) => references.get(v.name).some((at) => at > span.start && at < span.end))
      .map((v) => v.name);
    return { api: span.api, line: span.line, touches };
  });

  const leaves = perRegistration.filter((r) => r.touches.length === 0);

  // Which variables bind registrations together.
  const sharedBy = {};
  for (const variable of mutable) {
    const users = perRegistration.filter((r) => r.touches.includes(variable.name)).map((r) => r.line);
    if (users.length > 0) sharedBy[variable.name] = users;
  }

  return {
    file: ENTRY,
    lines: source.split("\n").length,
    totals: {
      declarations: declarations.length,
      const: declarations.filter((d) => d.kind === "const").length,
      let: declarations.filter((d) => d.kind === "let").length,
      mutable: mutable.length,
      immutable: declarations.length - mutable.length,
      hookRegistrations: perRegistration.length,
      leafRegistrations: leaves.length,
    },
    declarations: declarations.map(({ name, kind, line, shape, mutable: m, exported }) => ({
      name, kind, line, shape, mutable: m, exported,
    })),
    sharedBy,
  };
}

function main() {
  const inventory = buildInventory();

  if (process.argv.includes("--write")) {
    mkdirSync(new URL(".", SNAPSHOT_PATH), { recursive: true });
    writeFileSync(
      SNAPSHOT_PATH,
      `${JSON.stringify(
        {
          $comment:
            "Phase 3 gate. Module-scope state of the composition root, with mutability judged per variable " +
            "(const freezes the binding, not the value). An extraction that touches a variable absent from this " +
            "inventory stops until the inventory is corrected. Regenerate: npm run inventory:entry -- --write",
          ...inventory,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`entry-state inventory: wrote ${inventory.totals.declarations} declarations`);
    return;
  }

  const t = inventory.totals;
  console.log(`entry-state inventory: ${ENTRY} (${inventory.lines} lines)`);
  console.log(`  declarations: ${t.declarations}  (${t.const} const, ${t.let} let)`);
  console.log(`  mutable:      ${t.mutable}   <- these constrain extraction`);
  console.log(`  immutable:    ${t.immutable}`);
  console.log(`  Hooks registrations: ${t.hookRegistrations}, of which ${t.leafRegistrations} have NO DIRECT module-state reference`);
  console.log("  (direct references only — a registration calling a helper that mutates state still reads as a leaf)");
  console.log("\n  shared mutable state (variable -> registration lines):");
  for (const [name, lines] of Object.entries(inventory.sharedBy)) {
    console.log(`    ${name.padEnd(34)} ${lines.length} registration(s): ${lines.slice(0, 8).join(", ")}${lines.length > 8 ? " …" : ""}`);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
