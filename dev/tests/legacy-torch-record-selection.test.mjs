import assert from "node:assert/strict";
import test from "node:test";

import {
  MODULE_ID,
  TORCH_PREFIX,
  classifyRecord,
  effectEntryToRecord,
  parseTorchEffectName,
  sceneIdFromUuid,
  selectForeignRecords,
  tokenIdFromUuid,
} from "../tools/legacy-torch-record-selection.mjs";

const FOREIGN_TOKEN = "TxKpfy58G7xu3hQr";
const TOKEN_A = "04bAh5wb50DAaLVD";
const TOKEN_B = "Y4jqHVluru9NEp3O";
const ITEM_X = "abc123";
const ITEM_Y = "def456";

function uuid(tokenId, scene = "ThraxisArena") {
  return `Scene.${scene}.Token.${tokenId}`;
}

function tuple(id, name) {
  return [id, { _id: id, name }];
}

test("tokenIdFromUuid handles dot and dash forms", () => {
  assert.equal(tokenIdFromUuid("Scene.abc.Token.04bAh5wb50DAaLVD"), "04bAh5wb50DAaLVD");
  assert.equal(tokenIdFromUuid("Scene-abc-Token-04bAh5wb50DAaLVD"), "04bAh5wb50DAaLVD");
  assert.equal(tokenIdFromUuid("04bAh5wb50DAaLVD"), "04bAh5wb50DAaLVD");
  assert.equal(sceneIdFromUuid("Scene.ThraxisArena.Token.04bAh5wb50DAaLVD"), "ThraxisArena");
});

test("parseTorchEffectName distinguishes new, legacy, impact, non-torch, unparseable", () => {
  assert.equal(parseTorchEffectName(`other-prefix-torch-${TOKEN_A}-${ITEM_X}`), null);
  assert.deepEqual(parseTorchEffectName(`${TORCH_PREFIX}${ITEM_X}`), { format: "new", tokenId: null, itemId: ITEM_X, isImpact: false, rawName: `${TORCH_PREFIX}${ITEM_X}`, remainder: ITEM_X });
  assert.deepEqual(parseTorchEffectName(`${TORCH_PREFIX}${ITEM_X}_impact`), { format: "new", tokenId: null, itemId: ITEM_X, isImpact: true, rawName: `${TORCH_PREFIX}${ITEM_X}_impact`, remainder: ITEM_X });
  assert.deepEqual(parseTorchEffectName(`${TORCH_PREFIX}${TOKEN_A}-${ITEM_X}`), { format: "legacy", tokenId: TOKEN_A, itemId: ITEM_X, isImpact: false, rawName: `${TORCH_PREFIX}${TOKEN_A}-${ITEM_X}`, remainder: `${TOKEN_A}-${ITEM_X}` });
  assert.deepEqual(parseTorchEffectName(`${TORCH_PREFIX}${TOKEN_A}-${ITEM_X}_impact`), { format: "legacy", tokenId: TOKEN_A, itemId: ITEM_X, isImpact: true, rawName: `${TORCH_PREFIX}${TOKEN_A}-${ITEM_X}_impact`, remainder: `${TOKEN_A}-${ITEM_X}` });
  const empty = parseTorchEffectName(TORCH_PREFIX);
  assert.equal(empty.format, "unparseable");
  const emptyItem = parseTorchEffectName(`${TORCH_PREFIX}${TOKEN_A}-`);
  assert.equal(emptyItem.format, "unparseable");
});

test("classifyRecord: foreign vs legacy-correct vs new-format vs non-torch", () => {
  const attached = uuid(TOKEN_A);
  // foreign: name embeds FOREIGN_TOKEN but attached is TOKEN_A
  assert.equal(classifyRecord(`${TORCH_PREFIX}${FOREIGN_TOKEN}-${ITEM_X}`, attached).classification, "foreign");
  // legacy-correct: name embeds attached token
  assert.equal(classifyRecord(`${TORCH_PREFIX}${TOKEN_A}-${ITEM_X}`, attached).classification, "legacy-correct");
  // new-format spared
  assert.equal(classifyRecord(`${TORCH_PREFIX}${ITEM_X}`, attached).classification, "new-format");
  assert.equal(classifyRecord(`${TORCH_PREFIX}${ITEM_X}_impact`, attached).classification, "new-format");
  // non-torch
  assert.equal(classifyRecord("some-other-effect", attached).classification, "non-torch");
  // foreign with _impact suffix also foreign
  assert.equal(classifyRecord(`${TORCH_PREFIX}${FOREIGN_TOKEN}-${ITEM_X}_impact`, attached).classification, "foreign");
});

test("classifyRecord: unparseable name is loud and never foreign", () => {
  const attached = uuid(TOKEN_A);
  assert.equal(classifyRecord(TORCH_PREFIX, attached).classification, "unparseable");
  assert.equal(classifyRecord(`${TORCH_PREFIX}${TOKEN_A}-`, attached).classification, "unparseable");
});

test("classifyRecord: missing/undeterminable token reports unparseable, not foreign", () => {
  // Empty uuid cannot derive attached id -> unparseable
  assert.equal(classifyRecord(`${TORCH_PREFIX}${TOKEN_A}-${ITEM_X}`, "").classification, "unparseable");
  assert.equal(classifyRecord(`${TORCH_PREFIX}${TOKEN_A}-${ITEM_X}`, null).classification, "unparseable");
});

test("effectEntryToRecord handles both tuple and plain shapes", () => {
  const id = "eff1";
  assert.deepEqual(effectEntryToRecord([id, { _id: id, name: `${TORCH_PREFIX}${ITEM_X}` }]), { id, name: `${TORCH_PREFIX}${ITEM_X}` });
  assert.deepEqual(effectEntryToRecord({ id, name: `${TORCH_PREFIX}${ITEM_X}` }), { id, name: `${TORCH_PREFIX}${ITEM_X}` });
  assert.equal(effectEntryToRecord(null), null);
  assert.equal(effectEntryToRecord("bad"), null);
});

test("selectForeignRecords: selects exactly foreign, spares others", () => {
  const effects = {
    [uuid(TOKEN_A)]: [
      tuple("id-a-foreign", `${TORCH_PREFIX}${FOREIGN_TOKEN}-${ITEM_X}`),
      tuple("id-a-correct", `${TORCH_PREFIX}${TOKEN_A}-${ITEM_X}`),
      tuple("id-a-new", `${TORCH_PREFIX}${ITEM_Y}`),
      tuple("id-a-other", "some-other-module-effect"),
    ],
    [uuid(TOKEN_B)]: [
      tuple("id-b-foreign", `${TORCH_PREFIX}${FOREIGN_TOKEN}-${ITEM_X}`),
      tuple("id-b-new", `${TORCH_PREFIX}${ITEM_X}`),
    ],
    [uuid(FOREIGN_TOKEN)]: [
      tuple("id-foreign-correct", `${TORCH_PREFIX}${FOREIGN_TOKEN}-${ITEM_X}`),
      tuple("id-foreign-foreign", `${TORCH_PREFIX}${TOKEN_A}-${ITEM_X}`),
    ],
  };

  const { perUuid, totals, foreignIds, warnings } = selectForeignRecords(effects);

  // Exactly the foreign ones
  assert.deepEqual(new Set(foreignIds), new Set(["id-a-foreign", "id-b-foreign", "id-foreign-foreign"]));
  assert.equal(totals.foreign, 3);
  assert.equal(totals.legacy, 5); // 3 foreign + 2 correct
  assert.equal(totals.newFormat, 2);
  assert.equal(totals.nonTorch, 1);
  assert.equal(totals.total, 8);

  // Legacy-but-correct spared (not in foreignIds)
  assert.ok(!foreignIds.includes("id-a-correct"));
  assert.ok(!foreignIds.includes("id-foreign-correct"));
  // New-format spared
  assert.ok(!foreignIds.includes("id-a-new"));
  assert.ok(!foreignIds.includes("id-b-new"));
  // Non-torch spared
  assert.ok(!foreignIds.includes("id-a-other"));

  // Per-uuid breakdown
  const byToken = Object.fromEntries(perUuid.map((g) => [g.tokenId, g]));
  assert.equal(byToken[TOKEN_A].foreign, 1);
  assert.equal(byToken[TOKEN_A].legacy, 2);
  assert.equal(byToken[TOKEN_B].foreign, 1);
  assert.equal(byToken[FOREIGN_TOKEN].foreign, 1);

  assert.equal(warnings.length, 0);
});

test("selectForeignRecords: reproduces the issue inventory shape (18 foreign over 9 keys)", () => {
  // Build the exact inventory from #106: 9 tokens in Thraxis Arena each carry 2 foreign
  // records named for FOREIGN_TOKEN, plus their 2 correctly-attached legacy records.
  // Plus 5 keys with no foreign (The Lost Citadel 4 keys + foreign holder itself).
  const thraxisForeignHolders = [
    "04bAh5wb50DAaLVD", "Y4jqHVluru9NEp3O", "btBoZVm8vR7iwFRJ",
    "JrwJDS1ePiQR2wz0", "iKIVrIbxY53mRwq6", "7luPICUAJCOTdVZU",
    "dGnJyeQFP7XThDpN", "OMR5G1k86Zfiu9wL", "urbXkHINYH3iSi4W",
  ];
  const map = {};
  for (const tid of thraxisForeignHolders) {
    map[uuid(tid, "ThraxisArena")] = [
      tuple(`f-${tid}-1`, `${TORCH_PREFIX}${FOREIGN_TOKEN}-${ITEM_X}`),
      tuple(`f-${tid}-2`, `${TORCH_PREFIX}${FOREIGN_TOKEN}-${ITEM_Y}`),
      tuple(`c-${tid}-1`, `${TORCH_PREFIX}${tid}-${ITEM_X}`),
      tuple(`c-${tid}-2`, `${TORCH_PREFIX}${tid}-${ITEM_Y}`),
    ];
  }
  // The foreign holder itself has correctly-attached records only
  map[uuid(FOREIGN_TOKEN, "ThraxisArena")] = [
    tuple("c-Tx-1", `${TORCH_PREFIX}${FOREIGN_TOKEN}-${ITEM_X}`),
    tuple("c-Tx-2", `${TORCH_PREFIX}${FOREIGN_TOKEN}-${ITEM_Y}`),
  ];
  // Lost Citadel (non-foreign) — new-format ids must not contain hyphens or they parse as legacy
  map[uuid("5U7SqTq7HBloXxo6", "LostCitadel")] = Array.from({ length: 8 }, (_, i) => tuple(`lc1-${i}`, `${TORCH_PREFIX}item${i}`));
  map[uuid("CqIraAeavWGWwHlK", "LostCitadel")] = [
    tuple("lc2-1", `${TORCH_PREFIX}CqIraAeavWGWwHlK-${ITEM_X}`),
    tuple("lc2-2", `${TORCH_PREFIX}CqIraAeavWGWwHlK-${ITEM_Y}`),
  ];

  const { totals, perUuid, foreignIds } = selectForeignRecords(map);
  assert.equal(totals.uuids, 12);
  assert.equal(totals.foreign, 18);
  assert.equal(foreignIds.length, 18);
  // Every foreign id embeds FOREIGN_TOKEN
  for (const g of perUuid) {
    for (const e of g.entries) {
      if (e.classification === "foreign") assert.equal(e.parsed.tokenId, FOREIGN_TOKEN);
    }
  }
});

test("selectForeignRecords: unparseable name is warned and never selected", () => {
  const map = {
    [uuid(TOKEN_A)]: [
      tuple("id-good", `${TORCH_PREFIX}${TOKEN_A}-${ITEM_X}`),
      tuple("id-bad", TORCH_PREFIX), // empty remainder -> unparseable
      tuple("id-bad2", `${TORCH_PREFIX}${TOKEN_A}-`), // empty item -> unparseable
    ],
  };
  const { totals, foreignIds, warnings } = selectForeignRecords(map);
  assert.equal(totals.unparseable, 2);
  assert.equal(totals.foreign, 0);
  assert.deepEqual(foreignIds, []);
  assert.ok(warnings.some((w) => w.includes("Unparseable")));
});

test("selectForeignRecords: missing token / dash-key warning", () => {
  const map = {
    // dash-joined key as stored raw (flagManager stores dash-joined)
    ["Scene-ThraxisArena-Token-04bAh5wb50DAaLVD"]: [
      tuple("id-1", `${TORCH_PREFIX}${FOREIGN_TOKEN}-${ITEM_X}`),
    ],
    [""]: [tuple("id-2", `${TORCH_PREFIX}${TOKEN_A}-${ITEM_X}`)],
  };
  const { totals, foreignIds, warnings } = selectForeignRecords(map);
  // dash-joined key still resolves via tokenIdFromUuid -> 04bAh -> foreign
  assert.equal(totals.foreign, 1);
  assert.deepEqual(foreignIds, ["id-1"]);
  assert.ok(warnings.some((w) => w.includes("cannot derive token id")) || warnings.length === 1);
});

test("selectForeignRecords: idempotent — no false positives on second run", () => {
  const map = {
    [uuid(TOKEN_A)]: [tuple("a1", `${TORCH_PREFIX}${FOREIGN_TOKEN}-${ITEM_X}`)],
  };
  const first = selectForeignRecords(map);
  assert.equal(first.foreignIds.length, 1);
  // Simulate after-removal map (foreign removed, only correct remains)
  const after = {
    [uuid(TOKEN_A)]: [tuple("a-correct", `${TORCH_PREFIX}${TOKEN_A}-${ITEM_X}`)],
  };
  const second = selectForeignRecords(after);
  assert.equal(second.foreignIds.length, 0);
  assert.equal(second.totals.foreign, 0);
});
