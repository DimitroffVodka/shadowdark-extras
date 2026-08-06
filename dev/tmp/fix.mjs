import { readFileSync } from "node:fs";
import * as acorn from "acorn";
const FILE = "scripts/hex/HexPainterSD.mjs";
const ast = acorn.parse(readFileSync(FILE, "utf8"), { ecmaVersion: 2023, sourceType: "module" });
const funcs = new Map(), letB = new Set(), constB = new Set(), imported = new Set();
for (const node of ast.body) {
  const t = (node.type === "ExportNamedDeclaration" && node.declaration) ? node.declaration : node;
  if (t.type === "FunctionDeclaration") { funcs.set(t.id.name, t); continue; }
  if (t.type === "VariableDeclaration") {
    for (const d of t.declarations) if (d.id.type === "Identifier") (t.kind === "const" ? constB : letB).add(d.id.name);
    continue;
  }
  if (t.type === "ImportDeclaration") for (const s of t.specifiers) imported.add(s.local.name);
}
const topLevel = new Set([...funcs.keys(), ...letB, ...constB, ...imported]);
function each(n, fn) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { for (const x of n) each(x, fn); return; }
  if (typeof n.type !== "string") return;
  fn(n);
  for (const k of Object.keys(n)) { if (["type","start","end","loc","range"].includes(k)) continue; each(n[k], fn); }
}
const refs = new Map(), writes = new Map();
for (const [name, node] of funcs) {
  const local = new Set([name]);
  for (const p of node.params) each(p, i => { if (i.type === "Identifier") local.add(i.name); });
  each(node.body, n => {
    if (n.type === "VariableDeclarator") each(n.id, i => { if (i.type === "Identifier") local.add(i.name); });
    if (n.type === "FunctionDeclaration" && n.id) local.add(n.id.name);
    if (["FunctionExpression","ArrowFunctionExpression","FunctionDeclaration"].includes(n.type))
      for (const p of n.params) each(p, i => { if (i.type === "Identifier") local.add(i.name); });
    if (n.type === "CatchClause" && n.param) each(n.param, i => { if (i.type === "Identifier") local.add(i.name); });
  });
  const r = new Set(), w = new Set();
  const props = new Set();
  each(node.body, n => {
    if (n.type === "MemberExpression" && !n.computed && n.property.type === "Identifier") props.add(n.property.name);
    if (n.type === "Property" && !n.computed && n.key.type === "Identifier") props.add(n.key.name);
  });
  const standalone = new Set();
  each(node.body, n => {
    if (n.type === "CallExpression" && n.callee.type === "Identifier") standalone.add(n.callee.name);
    if (n.type === "MemberExpression" && n.object.type === "Identifier") standalone.add(n.object.name);
    if (n.type === "VariableDeclarator" && n.init?.type === "Identifier") standalone.add(n.init.name);
    if (n.type === "SpreadElement" && n.argument.type === "Identifier") standalone.add(n.argument.name);
    if (n.type === "BinaryExpression") { for (const s of [n.left, n.right]) if (s.type === "Identifier") standalone.add(s.name); }
    if (n.type === "ConditionalExpression") for (const s of [n.test, n.consequent, n.alternate]) if (s?.type === "Identifier") standalone.add(s.name);
    if (n.type === "UnaryExpression" && n.argument.type === "Identifier") standalone.add(n.argument.name);
    if (n.type === "LogicalExpression") { for (const s of [n.left, n.right]) if (s.type === "Identifier") standalone.add(s.name); }
    if (n.type === "ReturnStatement" && n.argument?.type === "Identifier") standalone.add(n.argument.name);
    if (n.type === "IfStatement" && n.test.type === "Identifier") standalone.add(n.test.name);
    if (n.type === "TemplateLiteral") for (const e of n.expressions) if (e.type === "Identifier") standalone.add(e.name);
    if (n.type === "Property" && n.value?.type === "Identifier") standalone.add(n.value.name);
    if (n.type === "AssignmentExpression" && n.right.type === "Identifier") standalone.add(n.right.name);
    if (n.type === "ArrayExpression") for (const e of n.elements) if (e?.type === "Identifier") standalone.add(e.name);
    if (n.type === "CallExpression") for (const a of n.arguments) if (a.type === "Identifier") standalone.add(a.name);
    if (n.type === "AwaitExpression" && n.argument.type === "Identifier") standalone.add(n.argument.name);
  });
  each(node.body, n => {
    if (n.type === "Identifier" && topLevel.has(n.name) && !local.has(n.name)) {
      if (props.has(n.name) && !standalone.has(n.name)) return;
      r.add(n.name);
    }
    if (n.type === "AssignmentExpression" && n.left.type === "Identifier" && letB.has(n.left.name) && !local.has(n.left.name)) w.add(n.left.name);
    if (n.type === "UpdateExpression" && n.argument.type === "Identifier" && letB.has(n.argument.name) && !local.has(n.argument.name)) w.add(n.argument.name);
  });
  refs.set(name, r); writes.set(name, w);
}
const writersOf = new Map([...letB].map(b => [b, []]));
for (const [f, w] of writes) for (const b of w) writersOf.get(b).push(f);
const seed = process.argv.slice(2);
const mb = new Set(seed.filter(x => letB.has(x))), mf = new Set(seed.filter(x => funcs.has(x)));
let changed = true;
while (changed) {
  changed = false;
  for (const b of [...mb]) for (const f of writersOf.get(b) || []) if (!mf.has(f)) { mf.add(f); changed = true; }
  for (const f of [...mf]) for (const n of refs.get(f) || []) {
    if (letB.has(n) && !mb.has(n)) { mb.add(n); changed = true; }
    if (funcs.has(n) && !mf.has(n)) { mf.add(n); changed = true; }
  }
}
console.log(`bindings (${mb.size}): ${[...mb].sort().join(" ")}`);
console.log(`functions (${mf.size}): ${[...mf].sort().join(" ")}`);
const cs = new Set(), im = new Set();
for (const f of mf) for (const n of refs.get(f)) { if (constB.has(n)) cs.add(n); if (imported.has(n)) im.add(n); }
console.log(`consts: ${[...cs].sort().join(" ")}`);
console.log(`imports: ${[...im].sort().join(" ")}`);
console.log("\nwriters of each moved binding:");
for (const b of [...mb].sort()) console.log(`  ${b}: ${(writersOf.get(b)||[]).join(" ") || "(none — never reassigned)"}`);
console.log("\nstayers referencing the moved set:");
for (const f of funcs.keys()) if (!mf.has(f)) {
  const hit = [...refs.get(f)].filter(n => mb.has(n) || mf.has(n));
  if (hit.length) console.log(`  ${f}: ${hit.sort().join(" ")}`);
}
