/**
 * Classification and selection logic for the stale Sequencer torch-effect cleanup (issue #106).
 *
 * Pure, importable, testable — no `game` / `canvas` / `Sequencer` dependency.
 * The browser snippet `cleanup-legacy-torch-records.mjs` inlines the same logic
 * for paste-into-console execution; keep the two in sync (the snippet's header
 * references this file).
 *
 * Sequencer citations (dist 4.2.3) are documented on the exported helpers.
 */

export const MODULE_ID = "shadowdark-extras";
export const TORCH_PREFIX = `${MODULE_ID}-torch-`;

/**
 * Derive the token id from a Sequencer persistence UUID.
 * Sequencer persists per `Scene.<sceneId>.Token.<tokenId>` (or Actor) and stores
 * the key dash-joined in the journal; after `flagManager.getDatabaseFlags`
 * (`dist:9323`) it is restored to dot form. This handles both.
 * @param {string} uuid
 * @returns {string|null}
 */
export function tokenIdFromUuid(uuid) {
  if (typeof uuid !== "string" || !uuid) return null;
  // Journal flag keys are stored dash-joined (dist:9580-9590 replaces "-" back to
  // "."). Support both raw dash keys and dot UUIDs.
  const hasDot = uuid.includes(".");
  const normalized = hasDot ? uuid : uuid.replaceAll("-", ".");
  // Split on both separators and take the last alphanumeric segment.
  const parts = normalized.split(/[.-]/).filter(Boolean);
  if (!parts.length) return null;
  // For Scene.<sceneId>.Token.<tokenId> the token id is the last segment;
  // for bare token ids the uuid may already be just the token id.
  // Detect the "Token" marker and prefer the following segment if present.
  const tokenIdx = parts.lastIndexOf("Token");
  if (tokenIdx !== -1 && tokenIdx + 1 < parts.length) return parts[tokenIdx + 1];
  return parts[parts.length - 1] ?? null;
}

/**
 * Derive a scene id from a persisted UUID, if present.
 * @param {string} uuid
 * @returns {string|null}
 */
export function sceneIdFromUuid(uuid) {
  if (typeof uuid !== "string" || !uuid) return null;
  const hasDot = uuid.includes(".");
  const normalized = hasDot ? uuid : uuid.replaceAll("-", ".");
  const parts = normalized.split(".");
  // Scene.<sceneId>.Token.<tokenId>
  const sceneIdx = parts.indexOf("Scene");
  if (sceneIdx !== -1 && sceneIdx + 1 < parts.length) return parts[sceneIdx + 1];
  return null;
}

/**
 * Parse a torch effect name into its kind/identity parts.
 *
 * Convention after #105: classification-only `shadowdark-extras-torch-<itemId>`
 * (new format, no token). Legacy: `shadowdark-extras-torch-<tokenId>-<itemId>`.
 * Both may carry an `_impact` suffix (transient ignition burst).
 *
 * `DocumentIdField` allows any non-null string for document ids, so a hyphenated
 * custom id would break the first-hyphen split; this is documented and not
 * handled (see TorchAnimationSD.mjs:354-362).
 *
 * @param {unknown} rawName
 * @returns {null|{ format:string, tokenId:string|null, itemId:string|null, isImpact:boolean, rawName:string, remainder:string, reason?:string }}
 *   `null` means not a torch effect at all (non-torch, spared unconditionally).
 */
export function parseTorchEffectName(rawName) {
  if (typeof rawName !== "string" || !rawName.startsWith(TORCH_PREFIX)) return null;
  let remainder = rawName.slice(TORCH_PREFIX.length);
  let isImpact = false;
  if (remainder.endsWith("_impact")) {
    isImpact = true;
    remainder = remainder.slice(0, -"_impact".length);
  }
  if (!remainder) {
    return { format: "unparseable", tokenId: null, itemId: null, isImpact, rawName, remainder: "", reason: "empty remainder after prefix" };
  }
  const hyphen = remainder.indexOf("-");
  if (hyphen === -1) {
    // New format: single segment itemId
    return { format: "new", tokenId: null, itemId: remainder, isImpact, rawName, remainder };
  }
  const tokenId = remainder.slice(0, hyphen);
  const itemId = remainder.slice(hyphen + 1);
  if (!tokenId || !itemId) {
    return { format: "unparseable", tokenId: tokenId || null, itemId: itemId || null, isImpact, rawName, remainder, reason: "empty token or item segment" };
  }
  return { format: "legacy", tokenId, itemId, isImpact, rawName, remainder };
}

/**
 * Classify a single persisted record.
 * @param {unknown} effectName
 * @param {string} tokenUuid  the journal-map key the record is stored under
 * @returns {{ classification:string, parsed:ReturnType<typeof parseTorchEffectName>, reason?:string }}
 *   classification ∈ "non-torch" | "unparseable" | "new-format" | "legacy-correct" | "foreign"
 */
export function classifyRecord(effectName, tokenUuid) {
  const parsed = parseTorchEffectName(effectName);
  if (!parsed) return { classification: "non-torch", parsed: null };
  if (parsed.format === "unparseable") return { classification: "unparseable", parsed, reason: parsed.reason };
  if (parsed.format === "new") return { classification: "new-format", parsed };
  // legacy
  const attachedId = tokenIdFromUuid(tokenUuid);
  if (!attachedId) return { classification: "unparseable", parsed, reason: "cannot derive attached token id from uuid" };
  if (parsed.tokenId === attachedId) return { classification: "legacy-correct", parsed };
  return { classification: "foreign", parsed };
}

/**
 * Normalize a raw flag entry to a uniform record.
 * Sequencer stores `effects` as `Array<[id, data]>` where `data._id === id`
 * and `data.name` is the effect name (`dist:12040-12043`). Tests also pass
 * plain `{id, name}`.
 * @param {unknown} entry
 * @returns {{id:string, name:string}|null}
 */
export function effectEntryToRecord(entry) {
  if (Array.isArray(entry) && entry.length >= 2) {
    const [id, data] = entry;
    if (typeof id === "string" && data && typeof data === "object") {
      const name = typeof data.name === "string" ? data.name : (typeof data._id === "string" ? "" : "");
      // data.name may be missing on malformed records — still return id with empty name for warning
      return { id, name: name ?? "" };
    }
    // also handle [id, {data:{name}}] nested?
    return null;
  }
  if (entry && typeof entry === "object") {
    // plain {id, name} or {data:{_id,name}}
    const maybeData = /** @type {any} */ (entry);
    if (typeof maybeData.id === "string" && typeof maybeData.name === "string") return { id: maybeData.id, name: maybeData.name };
    if (maybeData.data && typeof maybeData.data === "object") {
      const d = maybeData.data;
      if (typeof d._id === "string" && typeof d.name === "string") return { id: d._id, name: d.name };
      if (typeof d.id === "string" && typeof d.name === "string") return { id: d.id, name: d.name };
    }
    if (typeof maybeData._id === "string" && typeof maybeData.name === "string") return { id: maybeData._id, name: maybeData.name };
  }
  return null;
}

/**
 * Select exactly the foreign-named records — those whose effect name embeds a
 * token id that is not the token the record is keyed to. Per #106 this is the
 * 18-record subset; 22 legacy-but-correct records are intentionally spared.
 *
 * @param {Record<string, unknown[]>} databaseEffects  map uuid → Array<[id,data]|{id,name}>
 * @returns {{ perUuid: Array<{uuid:string, tokenId:string|null, total:number, legacy:number, foreign:number, newFormat:number, nonTorch:number, unparseable:number, entries:Array<{id:string,name:string,classification:string,parsed:any,uuid:string}>>>, totals:{uuids:number,total:number,legacy:number,foreign:number,newFormat:number,nonTorch:number,unparseable:number}, foreignIds:string[], warnings:string[] }}
 */
export function selectForeignRecords(databaseEffects) {
  const perUuid = [];
  const totals = { uuids: 0, total: 0, legacy: 0, foreign: 0, newFormat: 0, nonTorch: 0, unparseable: 0 };
  const foreignIds = [];
  const warnings = [];

  if (!databaseEffects || typeof databaseEffects !== "object") {
    warnings.push("databaseEffects is missing or not an object");
    return { perUuid, totals, foreignIds, warnings };
  }

  for (const [uuid, rawList] of Object.entries(databaseEffects)) {
    if (!Array.isArray(rawList)) {
      warnings.push(`UUID ${uuid}: expected array but got ${typeof rawList}`);
      continue;
    }
    let legacy = 0;
    let foreign = 0;
    let newFormat = 0;
    let nonTorch = 0;
    let unparseable = 0;
    const entries = [];
    const tokenId = tokenIdFromUuid(uuid);
    if (!tokenId) warnings.push(`UUID ${uuid}: cannot derive token id — foreign detection will report unparseable`);

    for (const rawEntry of rawList) {
      const rec = effectEntryToRecord(rawEntry);
      if (!rec) {
        warnings.push(`UUID ${uuid}: unrecognized entry shape ${JSON.stringify(rawEntry)?.slice(0, 200)}`);
        unparseable += 1;
        totals.unparseable += 1;
        totals.total += 1;
        entries.push({ id: String(rawEntry?.[0] ?? "?"), name: "", classification: "unparseable", parsed: null, uuid, rawEntry });
        continue;
      }
      totals.total += 1;
      const { classification, parsed, reason } = classifyRecord(rec.name, uuid);
      entries.push({ id: rec.id, name: rec.name, classification, parsed, uuid, reason });
      switch (classification) {
        case "foreign":
          foreign += 1;
          legacy += 1;
          totals.foreign += 1;
          totals.legacy += 1;
          foreignIds.push(rec.id);
          break;
        case "legacy-correct":
          legacy += 1;
          totals.legacy += 1;
          break;
        case "new-format":
          newFormat += 1;
          totals.newFormat += 1;
          break;
        case "non-torch":
          nonTorch += 1;
          totals.nonTorch += 1;
          break;
        case "unparseable":
          unparseable += 1;
          totals.unparseable += 1;
          warnings.push(`Unparseable name "${rec.name}" under ${uuid}${reason ? `: ${reason}` : ""}`);
          break;
        default:
          unparseable += 1;
          totals.unparseable += 1;
          warnings.push(`Unknown classification "${classification}" for "${rec.name}" under ${uuid}`);
      }
    }

    totals.uuids += 1;
    perUuid.push({
      uuid,
      tokenId,
      sceneId: sceneIdFromUuid(uuid),
      total: rawList.length,
      legacy,
      foreign,
      newFormat,
      nonTorch,
      unparseable,
      entries,
    });
  }

  return { perUuid, totals, foreignIds, warnings };
}

/**
 * Build a printable inventory (same shape as the table on #106) from a
 * databaseEffects map and an optional token-existence resolver.
 * @param {Record<string, unknown[]>} databaseEffects
 * @param {(uuid:string)=>{exists:boolean, sceneName?:string}|null} [resolveToken]
 * @returns {{ rows:Array<{scene:string, tokenId:string, exists:boolean, total:number, legacy:number, foreign:number}>, totals:{uuids:number,total:number,legacy:number,foreign:number} }}
 */
export function buildInventory(databaseEffects, resolveToken = null) {
  const { perUuid, totals } = selectForeignRecords(databaseEffects);
  const rows = perUuid.map((group) => {
    let scene = group.sceneId ?? "—";
    let exists = true;
    if (resolveToken) {
      const info = resolveToken(group.uuid);
      if (info) {
        if (typeof info.exists === "boolean") exists = info.exists;
        if (info.sceneName) scene = info.sceneName;
      }
    }
    return {
      scene,
      tokenId: group.tokenId ?? group.uuid,
      exists,
      total: group.total,
      legacy: group.legacy,
      foreign: group.foreign,
    };
  });
  return { rows, totals: { uuids: totals.uuids, total: totals.total, legacy: totals.legacy, foreign: totals.foreign } };
}
