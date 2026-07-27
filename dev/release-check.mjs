// Release-integrity gate. Run AFTER `npm run pack`, BEFORE building/uploading
// module.zip. Exits non-zero if the working tree would produce a broken release.
//
//   npm run release:check
//
// Guards the exact failure classes that have shipped before:
//   - empty / missing compendium packs        (v6.10.40 — empty compendiums)
//   - a `scripts` entry missing from disk      (e.g. greensock/dist/gsap.min.js,
//                                               silently dropped from the archive)
//   - an `esmodules` entry missing from disk   (v6.10.36 — failed to load)
//   - module.json / package.json version drift (package.json lagged for releases)
//   - a declared style / language file missing
//
// CI runs this too (.github/workflows/main.yml), so the same gate protects both
// the automated and the manual release paths.

import { ClassicLevel } from "classic-level";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const ok = [];

const exists = async (rel) => {
  try { await stat(resolve(root, rel)); return true; } catch { return false; }
};

const manifest = JSON.parse(await readFile(resolve(root, "module.json"), "utf8"));

// 1. version alignment (module.json is source of truth; package.json must match)
try {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  if (pkg.version !== manifest.version) {
    fail.push(`version drift: module.json=${manifest.version} but package.json=${pkg.version}`);
  } else {
    ok.push(`version aligned (${manifest.version})`);
  }
} catch (e) {
  fail.push(`cannot read package.json: ${e.message}`);
}

// 2. compendium packs — every declared pack must hold at least one document
for (const pack of manifest.packs ?? []) {
  if (!(await exists(`src/${pack.path}`))) {
    fail.push(`pack ${pack.name}: no YAML source at src/${pack.path}`);
    continue;
  }
  if (!(await exists(pack.path))) {
    fail.push(`pack ${pack.name}: not built — ${pack.path} is missing (run \`npm run pack\`)`);
    continue;
  }
  let db;
  try {
    db = new ClassicLevel(resolve(root, pack.path), {
      keyEncoding: "utf8",
      valueEncoding: "json"
    });
    await db.open();
    const keys = await db.keys().all();
    let docs = 0;
    for (const key of keys) {
      if (!key.startsWith("!folders!")) docs++;
    }
    if (docs === 0) fail.push(`pack ${pack.name}: built but EMPTY (0 documents) — ${pack.path}`);
    else ok.push(`pack ${pack.name}: ${docs} documents`);
  } catch (e) {
    const reason = e.cause?.message || e.message;
    fail.push(`pack ${pack.name}: unreadable LevelDB at ${pack.path} — ${reason}`);
  } finally {
    if (db?.status === "open") {
      try {
        await db.close();
      } catch (e) {
        fail.push(`pack ${pack.name}: could not close LevelDB at ${pack.path} — ${e.message}`);
      }
    }
  }
}

// 3. every declared file the manifest loads must exist on disk
const fileChecks = [
  ...(manifest.scripts ?? []).map((s) => ["script", s]),
  ...(manifest.esmodules ?? []).map((s) => ["esmodule", s]),
  ...(manifest.styles ?? []).map((s) => ["style", s.src]),
  ...(manifest.languages ?? []).map((l) => ["language", l.path]),
];
for (const [kind, rel] of fileChecks) {
  if (await exists(rel)) ok.push(`${kind}: ${rel}`);
  else fail.push(`${kind} declared in module.json but missing from disk: ${rel}`);
}

// report
console.log(`release-check: ${ok.length} ok, ${fail.length} failed\n`);
if (fail.length) {
  for (const f of fail) console.error(`  ✗ ${f}`);
  console.error(`\nrelease-check: FAILED — do not publish this build.`);
  process.exit(1);
}
console.log(`release-check: OK — ${manifest.id}@${manifest.version} is safe to package.`);
