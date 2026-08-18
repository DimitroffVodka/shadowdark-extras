---
type: subsystem guide
title: Inventory, Containers, and Item Sheets
description: Inventory persistence, container slot accounting, transfer/privacy boundaries, and item-sheet extension paths.
tags: [inventory, containers, item-sheets]
---
# Inventory, Containers, and Item Sheets

`containers.mjs` owns nested storage hooks, physical-item patching, container UI, and synchronization. The pure calculator is `container-slots.mjs`; keep new slot rules there when they do not need Foundry globals. Current slots are `max(base slots, content slots plus floor coins divided by 100)`, with recursive nested-container accounting and zero-cost cases for gems, stashed/free-carry items, and nonphysical-origin content.

Container flags include `isContainer`, `containerBaseSlots`, `containerPackedItems`, `containerCoins`, `containerId`, `containerOrigIsPhysical`, and `containerUnpackedOnActor`. Creation unpacks snapshots into embedded items with `{sdxInternal: true}`, recalculates, then clears packed data. Per-user locks prevent multi-client duplicate unpack/recompute loops. Item Piles is a distinct boundary: it keeps content packed rather than creating ordinary embedded contents.

## Other inventory workflows

- **Trading and player transfers:** `TradeWindowSD.mjs` and `player-transfers.mjs` coordinate request/accept and actor-to-actor movement through documented socket/permission paths.
- **Ammunition:** selector/bonus patches attach user selection and consumption to actor inventory and combat rolls.
- **Unidentified items:** display and preservation modules hide player-facing identity while retaining underlying document data; do not leak names/descriptions through a new UI.
- **Gems, styling, and bulk actions:** gem enhancements, `inventory-styles.mjs`, multi-select, and default-move-drop patches mutate sheet behavior and must preserve container/item flags.
- **Item sheets:** spell/scroll/wand use system-sheet enhancement paths; `PotionSheetSD` is a registered AppV2 sheet, not a spell enhancement target. Activity configuration becomes the contract consumed by [Effects and Macros](../spells/effects-and-macros.md).

**Validate:** `npm test -- dev/tests/container-slots.test.mjs dev/tests/item-piles-compat.test.mjs dev/tests/unidentified-name.test.mjs dev/tests/unidentified-magic-privacy.test.mjs dev/tests/ammo-bonuses.test.mjs`.