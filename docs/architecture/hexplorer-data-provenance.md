# Hexplorer generator-data provenance

_Status: source audit, 2026-09-19. This is not a license determination._

## Decision

Do **not** automatically sync data from Hexroll. SDX's Hexplorer content is an
adapted JSON port of a historical Hexroll 3 corpus, while current Hexroll 3 has
materially diverged and uses a different `.scroll` data model. Any direct reuse
needs a source-specific licensing decision first.

## What establishes the lineage

- SDX credits its hexcrawl data as material from Hexroll, “adapted and
  supplemented for SDX” (`README.md:251`).
- Commit `011803be` introduced `hexroll-data.json`, `settlement-data.json`, and
  `dungeon-data.json` together with a vendored Hexroll 3 source snapshot at
  `.libs/hexroll3-master/`.
- The historical snapshot's `names/regions.scroll` has 71 names. All 71 occur
  verbatim in SDX's 145 `regionNames` entries in
  `scripts/data/hexroll-data.json`, including `Hell Pit`, `Stargazer`, and
  `Dark Storm`. This proves direct derivation for that table; it does not prove
  every row in every SDX JSON file came from Hexroll.
- SDX's loaders consume its own JSON data, not upstream `.scroll` files:
  wilderness (`scripts/hex/HexContentGenerator.mjs:9-96`), settlement
  (`scripts/hex/SettlementGenerator.mjs:17-101`), and dungeon
  (`scripts/dungeon/DungeonGenerator.mjs:11-60`). No in-tree Hexroll 3
  converter/importer exists.

## Upstream roles

| Source | What it is | Use here |
|---|---|---|
| [`hexroll/hexroll3`](https://github.com/hexroll/hexroll3) | The generator and content corpus behind the historical snapshot. Local checkout: `/home/patricks/AI/hexroll3`, revision `827d8d6295ff75ce908cf82ea1b1e44994cdf6b3`. | Research/reference only until licensing is resolved. |
| [`hexroll/hexroll-backpack`](https://github.com/hexroll/hexroll-backpack) | Electron viewer for a user-selected Hexroll 2 `.hbf` SQLite snapshot. It reads `Entities` and `Refs`; it ships no generator tables or sample snapshot (`src/index.js:34-45`, `:68-112`). | Not a content source. Consider only if a user later needs to inspect their own export. |

The current Hexroll 3 checkout has 91 scroll-data files. The historical SDX
snapshot has 90 matching-path files; 69 of the 90 changed, and current Hexroll
adds `osr/spell_components.scroll`. This is not a safe drop-in update even
apart from licensing.

## Licensing boundary

Current Hexroll 3 states a dual-licensing scheme: a described
“Non-Commercial” AGPL option and a separate commercial license, and says it
contains Open Game Content (`/home/patricks/AI/hexroll3/README.md:42-68`). SDX
itself has unresolved root-license scope (`README.md:243`). Treat copied,
adapted, and independently authored rows as different provenance classes; do
not infer permission from an attribution line or from Backpack's AGPL viewer.

## Smallest useful improvements

1. **Fix generated-page identity first.** Wilderness, settlement, and dungeon
   creation make a Page, then find the first Page with the generated display
   name (`scripts/hex/HexTooltipSD.mjs:869-905`, `:1002-1039`, `:1182-1216`).
   Use the Page returned by `JournalEntryPage.create()` instead. This prevents a
   duplicate random name from linking a hex to an older page. If same-name
   reruns are meant to remain distinct, include `pageId` in
   `ContentRegistry`'s duplicate key (`scripts/hex/ContentRegistry.mjs:58-75`).
2. **Add independently authored rows only to loaded tables.** The existing
   loaders make data-only additions the low-risk quality path. Do not spend time
   on `scripts/data/dungeon-gems.json`: no script currently loads it.
3. **Add a short provenance manifest before any imported content.** Record file
   or subsection, upstream revision/URL, license or permission status, and
   whether rows are copied, adapted, or SDX-original. This closes the current
   audit gap without changing generator behavior.
4. **Reuse existing IDs for settlement quest links.** The registry already
   stores `journalId` and `pageId`; quest references can use Foundry `@UUID`
   links rather than plain generated names.

Do not build a `.hbf` importer now. It would be a separate feature for a
specific user-owned snapshot, not a way to refresh Hexplorer's generator data.
