/**
 * BROWSER SNIPPET — paste into the GM's browser console in a live Foundry world.
 *
 * Not a Node tool. It needs `game`, `canvas`, and `Sequencer` (the live
 * `sequencer` module). Run with `dev/tools/` serving the main checkout; this
 * worktree's module symlink points at the main checkout so the snippet is
 * reviewable here and executable there.
 *
 * What it does (issue #106):
 *   Reports the Sequencer `sequencerDatabase` inventory before and after, in the
 *   same shape as the table on #106 (per UUID: scene, token id, exists, total,
 *   legacy-named, foreign-named — plus totals), and optionally removes the 18
 *   **foreign-named** stale records (legacy name whose embedded token id != the
 *   token the record is keyed to). The 22 legacy-but-correct records are spared;
 *   they are live animations and will age out via #105's dual-name stop paths.
 *
 * Safety:
 *   - Dry-run by default. Set `APPLY` to `true` at the top to mutate.
 *   - Prefers `Sequencer.EffectManager.endEffects({ effects: [...] })` (id-based,
 *     `dist:14843-14844` `CanvasEffect.id === data._id`, filtered via
 *     `effects.includes(effect.id)` `dist:11694-11703`, persisted removal in
 *     `_endManyEffects` `dist:12062-12114` via `flagManager.removeFlags`). This
 *     keeps the visible canvas and the persisted journal in sync.
 *   - For records whose effect is not currently in the manager (e.g. off-scene
 *     tokens when the viewed scene is different), `endEffects` has nothing to
 *     filter and cannot reach the persisted flag. Those are removed by direct
 *     `sequencerDatabase` journal mutation as a justified fallback — the manager
 *     is scene-partitioned by its own `sceneId` handling and `shouldPlay`
 *     (`dist:15145`), so an API-only pass would leave off-scene foreign records
 *     behind. The fallback edits only the selected foreign ids and is verified
 *     by the after-inventory.
 *   - Idempotent: re-running with no foreign records matches zero ids and is a
 *     no-op. Loud about anything unexpected (missing token, unparseable name).
 *
 * Twin of `dev/tools/legacy-torch-record-selection.mjs` — the classification
 * functions are duplicated here so the snippet is self-contained for pasting.
 * Keep the two in sync.
 *
 * Sequencer dist citations (4.2.3, `~/FoundryV14/Data/modules/sequencer/dist/sequencer.js`):
 *   - `CanvasEffect.id` getter → `data._id` :14768-74 / 14843-14844
 *   - `_filterEffects` `effects` branch         :11694-11703 (`effects.includes(effect.id)`)
 *   - `_validateFilters` effects→id map         :11779-11791
 *   - `_endManyEffects` persisted removal       :12062-12114 (groups by
 *     `context.uuid`, calls `flagManager.removeFlags` at 12081-12114; visible
 *     plus flag removal)
 *   - `flagManager._getDatabaseData` key restore: 9580-9590 (dash→dot)
 *   - `flagManager.removeFlags` → `_removeFlags` → `updateFlags` debounced
 *     journal write: 9541-9680; database journal `sequencerDatabase` 589-595
 */

/* eslint-disable no-console */

// ── edit this to apply ──────────────────────────────────────────────────────
const APPLY = false;
// ───────────────────────────────────────────────────────────────────────────

const MODULE_ID = "shadowdark-extras";
const TORCH_PREFIX = `${MODULE_ID}-torch-`;
const DATABASE_NAME = "sequencerDatabase";

function tokenIdFromUuid(uuid) {
  if (typeof uuid !== "string" || !uuid) return null;
  const hasDot = uuid.includes(".");
  const normalized = hasDot ? uuid : uuid.replaceAll("-", ".");
  const parts = normalized.split(/[.-]/).filter(Boolean);
  if (!parts.length) return null;
  const tokenIdx = parts.lastIndexOf("Token");
  if (tokenIdx !== -1 && tokenIdx + 1 < parts.length) return parts[tokenIdx + 1];
  return parts[parts.length - 1] ?? null;
}

function sceneIdFromUuid(uuid) {
  if (typeof uuid !== "string" || !uuid) return null;
  const normalized = uuid.includes(".") ? uuid : uuid.replaceAll("-", ".");
  const parts = normalized.split(".");
  const idx = parts.indexOf("Scene");
  if (idx !== -1 && idx + 1 < parts.length) return parts[idx + 1];
  return null;
}

function parseTorchEffectName(rawName) {
  if (typeof rawName !== "string" || !rawName.startsWith(TORCH_PREFIX)) return null;
  let remainder = rawName.slice(TORCH_PREFIX.length);
  let isImpact = false;
  if (remainder.endsWith("_impact")) {
    isImpact = true;
    remainder = remainder.slice(0, -"_impact".length);
  }
  if (!remainder) return { format: "unparseable", tokenId: null, itemId: null, isImpact, rawName, remainder: "", reason: "empty remainder" };
  const hyphen = remainder.indexOf("-");
  if (hyphen === -1) return { format: "new", tokenId: null, itemId: remainder, isImpact, rawName, remainder };
  const tokenId = remainder.slice(0, hyphen);
  const itemId = remainder.slice(hyphen + 1);
  if (!tokenId || !itemId) return { format: "unparseable", tokenId: tokenId || null, itemId: itemId || null, isImpact, rawName, remainder, reason: "empty token or item segment" };
  return { format: "legacy", tokenId, itemId, isImpact, rawName, remainder };
}

function classifyRecord(effectName, tokenUuid) {
  const parsed = parseTorchEffectName(effectName);
  if (!parsed) return { classification: "non-torch", parsed: null };
  if (parsed.format === "unparseable") return { classification: "unparseable", parsed, reason: parsed.reason };
  if (parsed.format === "new") return { classification: "new-format", parsed };
  const attachedId = tokenIdFromUuid(tokenUuid);
  if (!attachedId) return { classification: "unparseable", parsed, reason: "cannot derive attached token id" };
  if (parsed.tokenId === attachedId) return { classification: "legacy-correct", parsed };
  return { classification: "foreign", parsed };
}

function effectEntryToRecord(entry) {
  if (Array.isArray(entry) && entry.length >= 2) {
    const [id, data] = entry;
    if (typeof id === "string" && data && typeof data === "object") {
      const name = typeof data.name === "string" ? data.name : "";
      return { id, name };
    }
    return null;
  }
  if (entry && typeof entry === "object") {
    const o = entry;
    if (typeof o.id === "string" && typeof o.name === "string") return { id: o.id, name: o.name };
    if (o.data && typeof o.data === "object") {
      const d = o.data;
      if (typeof d._id === "string" && typeof d.name === "string") return { id: d._id, name: d.name };
    }
    if (typeof o._id === "string" && typeof o.name === "string") return { id: o._id, name: o.name };
  }
  return null;
}

function selectForeignRecords(databaseEffects) {
  const perUuid = [];
  const totals = { uuids: 0, total: 0, legacy: 0, foreign: 0, newFormat: 0, nonTorch: 0, unparseable: 0 };
  const foreignIds = [];
  const warnings = [];
  if (!databaseEffects || typeof databaseEffects !== "object") {
    warnings.push("databaseEffects missing or not an object");
    return { perUuid, totals, foreignIds, warnings };
  }
  for (const [uuid, rawList] of Object.entries(databaseEffects)) {
    if (!Array.isArray(rawList)) {
      warnings.push(`UUID ${uuid}: expected array, got ${typeof rawList}`);
      continue;
    }
    let legacy = 0, foreign = 0, newFormat = 0, nonTorch = 0, unparseable = 0;
    const entries = [];
    const tokenId = tokenIdFromUuid(uuid);
    if (!tokenId) warnings.push(`UUID ${uuid}: cannot derive token id`);
    for (const rawEntry of rawList) {
      const rec = effectEntryToRecord(rawEntry);
      if (!rec) {
        warnings.push(`UUID ${uuid}: unrecognized entry ${String(JSON.stringify(rawEntry)).slice(0, 200)}`);
        unparseable += 1;
        totals.unparseable += 1;
        totals.total += 1;
        entries.push({ id: String(rawEntry?.[0] ?? "?"), name: "", classification: "unparseable", parsed: null, uuid });
        continue;
      }
      totals.total += 1;
      const { classification, parsed, reason } = classifyRecord(rec.name, uuid);
      entries.push({ id: rec.id, name: rec.name, classification, parsed, uuid, reason });
      if (classification === "foreign") { foreign += 1; legacy += 1; totals.foreign += 1; totals.legacy += 1; foreignIds.push(rec.id); }
      else if (classification === "legacy-correct") { legacy += 1; totals.legacy += 1; }
      else if (classification === "new-format") { newFormat += 1; totals.newFormat += 1; }
      else if (classification === "non-torch") { nonTorch += 1; totals.nonTorch += 1; }
      else if (classification === "unparseable") { unparseable += 1; totals.unparseable += 1; warnings.push(`Unparseable "${rec.name}" under ${uuid}${reason ? `: ${reason}` : ""}`); }
    }
    totals.uuids += 1;
    perUuid.push({ uuid, tokenId, sceneId: sceneIdFromUuid(uuid), total: rawList.length, legacy, foreign, newFormat, nonTorch, unparseable, entries });
  }
  return { perUuid, totals, foreignIds, warnings };
}

function getDatabaseEffectsMap() {
  // Prefer the Sequencer flagManager's view (it restores dash→dot, deep clones).
  // Fall back to reading the journal doc directly.
  const journal = game.journal.getName(DATABASE_NAME) ?? (typeof game.journal.get === "function" ? [...game.journal].find((j) => j.name === DATABASE_NAME) : null);
  if (!journal) {
    console.warn(`[${MODULE_ID}] sequencerDatabase journal not found — no persisted effects?`);
    return { map: {}, journal: null };
  }
  // Try Sequencer's own accessor if available (handles migration clones).
  try {
    if (globalThis.Sequencer?.EffectManager?._flagManager ?? globalThis.Sequencer?.flagManager) {
      // No stable public accessor; try flagManager if exposed via EffectManager internals —
      // but keep the direct journal path as authoritative.
    }
  } catch {}
  const raw = foundry.utils.getProperty(journal, `flags.sequencer.effects`) ?? foundry.utils.getProperty(journal, "flags.sequencer.effects") ?? {};
  // Keys are stored dash-joined (dist: flagManager._getDatabaseData re-adds dots).
  // Convert any dash-only keys to dot form so classification's tokenIdFromUuid works.
  const map = {};
  for (const [k, v] of Object.entries(raw)) {
    const dotKey = k.includes(".") ? k : k.replaceAll("-", ".");
    map[dotKey] = v;
  }
  // Also support the already-restored shape if game.journal path differs by version:
  // Some Foundry builds expose flags as journal.flags — above covers it.
  return { map, journal };
}

function resolveTokenInfo(uuid) {
  try {
    const doc = foundry.utils.fromUuidSync(uuid);
    if (!doc) return { exists: false, sceneName: sceneIdFromUuid(uuid) ? (game.scenes.get(sceneIdFromUuid(uuid))?.name ?? sceneIdFromUuid(uuid)) : "—" };
    // TokenDocument or Actor — resolve scene name
    const sceneId = doc.parent?.id ?? doc.scene?.id ?? sceneIdFromUuid(uuid);
    const sceneName = sceneId ? (game.scenes.get(sceneId)?.name ?? sceneId) : (doc.parent?.name ?? "—");
    return { exists: true, sceneName };
  } catch {
    const sid = sceneIdFromUuid(uuid);
    return { exists: false, sceneName: sid ? (game.scenes.get(sid)?.name ?? sid) : "—" };
  }
}

function printInventory(label, databaseEffects) {
  const { perUuid, totals, warnings } = selectForeignRecords(databaseEffects);
  console.log(`\n%c[${MODULE_ID}] ${label} — inventory`, "font-weight:bold");
  console.table(perUuid.map((g) => {
    const info = resolveTokenInfo(g.uuid);
    return {
      scene: info.sceneName ?? g.sceneId ?? "—",
      tokenId: g.tokenId ?? g.uuid,
      exists: info.exists ? "yes" : "NO",
      total: g.total,
      legacy: g.legacy,
      foreign: g.foreign,
    };
  }));
  console.log(`Totals: ${totals.uuids} UUID keys | ${totals.total} total | ${totals.legacy} legacy | ${totals.foreign} foreign | ${totals.newFormat} new-format | ${totals.nonTorch} non-torch | ${totals.unparseable} unparseable`);
  if (warnings.length) {
    console.warn(`[${MODULE_ID}] warnings (${warnings.length}):`);
    for (const w of warnings) console.warn("  -", w);
  }
  return { perUuid, totals, warnings };
}

async function removeForeignRecords(journal, foreignIds) {
  if (!foreignIds.length) {
    console.log(`[${MODULE_ID}] no foreign records to remove — nothing to do`);
    return { viaApi: 0, viaJournal: 0, leftover: [] };
  }
  console.log(`[${MODULE_ID}] foreign ids (${foreignIds.length}):`, foreignIds);

  // 1) Prefer the Sequencer API — id-based filter so only the selected records
  // are ended, and the visible effect plus its persisted flag are removed
  // together (_endManyEffects dist:12062-12114). This is the proven path from
  // #105's live verification; it is scene-aware and keeps canvas+journal in sync.
  let apiEnded = [];
  if (globalThis.Sequencer?.EffectManager?.endEffects) {
    try {
      // endEffects with {effects: [...] } matches effect.id (CanvasEffect.id is
      // data._id dist:14843-14844, filtered via effects.includes(effect.id)
      // dist:11694-11703, mapped in _validateFilters dist:11779-11791).
      const before = globalThis.Sequencer.EffectManager.effects?.length ?? 0;
      await globalThis.Sequencer.EffectManager.endEffects({ effects: foreignIds });
      // Give the debounced flagManager.updateFlags a tick to flush (dist: 96xx)
      await new Promise((r) => setTimeout(r, 400));
      const after = globalThis.Sequencer.EffectManager.effects?.length ?? before;
      apiEnded = foreignIds; // _endManyEffects is all-or-nothing per id; if the effect
      // was not in the manager (off-scene) it simply wasn't matched — handled below.
      console.log(`[${MODULE_ID}] endEffects({effects:[...${foreignIds.length}]}) done (manager ${before}→${after})`);
    } catch (e) {
      console.error(`[${MODULE_ID}] endEffects failed — will fall back to journal mutation`, e);
    }
  } else {
    console.warn(`[${MODULE_ID}] Sequencer.EffectManager.endEffects not found — skipping API path`);
  }

  // 2) Verify what is still persisted; direct journal mutation is the justified
  // fallback for off-scene records that the manager could not see. This is the
  // same journal path initializePersistentEffects uses to purge orphans
  // (dist:11919-11951 flagManager.removeFlags), and objectDeleted uses to drain
  // deleted objects (dist:12126-12134).
  const { map: afterMap } = getDatabaseEffectsMap();
  const stillPresent = [];
  const remainingByUuid = {};
  for (const [uuid, list] of Object.entries(afterMap)) {
    for (const entry of list) {
      const rec = effectEntryToRecord(entry);
      if (rec && foreignIds.includes(rec.id)) {
        stillPresent.push(rec.id);
        (remainingByUuid[uuid] ??= []).push(rec.id);
      }
    }
  }

  if (!stillPresent.length) {
    console.log(`[${MODULE_ID}] all foreign records cleared via API path — no journal fallback needed`);
    return { viaApi: foreignIds.length, viaJournal: 0, leftover: [] };
  }

  console.warn(`[${MODULE_ID}] ${stillPresent.length} foreign record(s) still persisted after endEffects (expected for off-scene tokens) — removing via sequencerDatabase journal mutation (justified fallback)`);
  console.warn(`[${MODULE_ID}] remaining:`, remainingByUuid);

  // Journal mutation: rebuild each UUID's effect array without the foreign ids.
  // Use journal.update with the flag path, mirroring flagManager.updateFlags'
  // batch semantics (dist:9620-9660) but scoped to the selected ids only.
  if (!journal) {
    console.error(`[${MODULE_ID}] cannot mutate journal — sequencerDatabase not found`);
    return { viaApi: foreignIds.length - stillPresent.length, viaJournal: 0, leftover: stillPresent };
  }

  // Read the raw (dash-keyed) effect flags to mutate in place
  const rawEffects = foundry.utils.getProperty(journal, "flags.sequencer.effects") ?? {};
  const updates = {};
  let removed = 0;
  for (const [rawKey, list] of Object.entries(rawEffects)) {
    const dotKey = rawKey.includes(".") ? rawKey : rawKey.replaceAll("-", ".");
    // Collect ids for this uuid that are in the still-present set
    const toRemove = new Set(stillPresent);
    const filtered = Array.isArray(list) ? list.filter(([id]) => !toRemove.has(id)) : list;
    if (Array.isArray(list) && filtered.length !== list.length) {
      removed += list.length - filtered.length;
      // Foundry flag deletion uses "-=key" sentinel; for sequencer we rewrite the
      // entire effects object per flagManager.updateFlags, so we set the new array.
      // Keep rawKey form (dash-joined) to match the stored shape.
      updates[`flags.sequencer.effects.${rawKey}`] = filtered;
    }
  }

  if (!removed) {
    console.warn(`[${MODULE_ID}] journal fallback: computed 0 removals — keys may be dot-joined already, retrying`);
    // Retry with dot keys
    for (const [uuid, list] of Object.entries(afterMap)) {
      if (!Array.isArray(list)) continue;
      const toRemove = new Set(stillPresent);
      const filtered = list.filter(([id]) => !toRemove.has(id));
      if (filtered.length !== list.length) {
        const dashKey = uuid.replaceAll(".", "-");
        updates[`flags.sequencer.effects.${dashKey}`] = filtered;
        removed += list.length - filtered.length;
      }
    }
  }

  if (!Object.keys(updates).length) {
    console.error(`[${MODULE_ID}] journal fallback: no update keys produced — manual inspection needed`);
    return { viaApi: foreignIds.length - stillPresent.length, viaJournal: 0, leftover: stillPresent };
  }

  console.log(`[${MODULE_ID}] journal fallback: updating sequencerDatabase with ${removed} removal(s) across ${Object.keys(updates).length} key(s)`);
  try {
    await journal.update(updates);
    console.log(`[${MODULE_ID}] journal fallback: update applied`);
  } catch (e) {
    console.error(`[${MODULE_ID}] journal fallback: update failed`, e);
    return { viaApi: foreignIds.length - stillPresent.length, viaJournal: 0, leftover: stillPresent };
  }

  // Re-check
  const { map: finalMap } = getDatabaseEffectsMap();
  const leftover = [];
  for (const list of Object.values(finalMap)) {
    for (const entry of list) {
      const rec = effectEntryToRecord(entry);
      if (rec && foreignIds.includes(rec.id)) leftover.push(rec.id);
    }
  }
  if (leftover.length) console.error(`[${MODULE_ID}] still leftover after journal fallback:`, leftover);
  else console.log(`[${MODULE_ID}] journal fallback: all foreign records now removed`);

  return { viaApi: foreignIds.length - stillPresent.length, viaJournal: removed, leftover };
}

async function main() {
  console.log(`%c[${MODULE_ID}] legacy-torch cleanup — ${APPLY ? "APPLY mode" : "DRY-RUN (set APPLY=true to mutate)"}`, `font-weight:bold; color:${APPLY ? "red" : "green"}`);
  console.log(`[${MODULE_ID}] bias to under-removal — a stale record is clutter, a wrong removal kills a torch animation`);

  const { map: beforeMap, journal } = getDatabaseEffectsMap();
  const before = printInventory("BEFORE", beforeMap);
  const { foreignIds, warnings } = selectForeignRecords(beforeMap);

  if (!foreignIds.length) {
    console.log(`[${MODULE_ID}] no foreign-named records — already clean (idempotent)`);
    if (warnings.length) console.warn(`[${MODULE_ID}] ${warnings.length} warning(s) — see above`);
    return;
  }

  console.log(`\n[${MODULE_ID}] would remove ${foreignIds.length} foreign record(s):`, foreignIds);
  const foreignDetails = before.perUuid.flatMap((g) => g.entries.filter((e) => e.classification === "foreign").map((e) => ({ uuid: e.uuid, id: e.id, name: e.name })));
  console.table(foreignDetails);

  if (!APPLY) {
    console.log(`\n%c[${MODULE_ID}] DRY-RUN — no changes made. Set const APPLY = true at the top and re-run to apply.`, "font-weight:bold; color:green");
    console.log(`[${MODULE_ID}] on apply, this will call Sequencer.EffectManager.endEffects({effects:[...ids]}) for the ${foreignIds.length} foreign id(s), with a direct journal fallback for off-scene survivors`);
    return;
  }

  if (!journal) {
    console.error(`[${MODULE_ID}] APPLY requested but sequencerDatabase journal not found — aborting`);
    return;
  }

  const result = await removeForeignRecords(journal, foreignIds);

  // After inventory (same shape as before)
  await new Promise((r) => setTimeout(r, 300));
  const { map: afterMap } = getDatabaseEffectsMap();
  const after = printInventory("AFTER", afterMap);

  console.log(`\n[${MODULE_ID}] result: via API ${result.viaApi} | via journal ${result.viaJournal} | leftover ${result.leftover.length}`);
  if (result.leftover.length) console.error(`[${MODULE_ID}] LEFTOVER — manual inspection needed:`, result.leftover);

  // Prove untouched: legacy-correct + new-format counts must be unchanged
  const beforeKept = before.totals.legacy - before.totals.foreign + before.totals.newFormat;
  const afterKept = after.totals.legacy - after.totals.foreign + after.totals.newFormat;
  if (beforeKept !== afterKept) {
    console.error(`[${MODULE_ID}] UNEXPECTED: kept-record count changed ${beforeKept}→${afterKept} — review before/after tables`);
  } else {
    console.log(`[${MODULE_ID}] kept records unchanged (${beforeKept}) — legacy-correct + new-format untouched ✓`);
  }

  // Foreign should now be zero
  if (after.totals.foreign !== 0) {
    console.error(`[${MODULE_ID}] UNEXPECTED: ${after.totals.foreign} foreign record(s) remain after apply — re-run is safe (idempotent)`);
  } else {
    console.log(`[${MODULE_ID}] foreign records now 0 — cleanup complete ✓ (re-run is a no-op)`);
  }
}

// Top-level await is available in the console; also support manual call.
if (typeof window !== "undefined") {
  // Fire immediately when pasted; also expose for re-run.
  globalThis.__sdxCleanupLegacyTorchRecords = main;
  main().catch((e) => console.error(`[${MODULE_ID}] cleanup failed`, e));
}
