---
type: UI architecture
title: Character and NPC Sheet Composition
description: Ordered sheet render dispatchers, custom item sheets, NPC inventory, and creature-type persistence.
tags: [character-sheets, npc, UI]
---
# Character and NPC Sheet Composition

The root owns ordered `renderPlayerSheetSD`, `renderNpcSheetSD`, `renderActorSheet`, and `renderItemSheet` dispatch lists because they coordinate many features. Moving a call changes rendered ordering and can alter DOM ownership. Individual behavior belongs in `scripts/character-sheet/*`, `scripts/npc/*`, or item-sheet owners.

Player rendering first guards actor type, then composes enhanced header/HP controls, enhanced tabs, skills, spells, staff controls, gem/container/inventory UI, trade/coins, journal notes, conditions, and chat icons under their feature gates. NPC rendering rejects Party actors, then can apply NPC styling, inventory/drop behavior, creature type, container/styling, conditions, and custom sheets.

NPC inventory filters physical item types, calculates slots using the common container calculator, separates treasure, sorts collections, and inserts `templates/npc-inventory.hbs`. It manages active tab state explicitly. Creature type persists in `flags.shadowdark-extras.creatureType`; GM users edit it while players see it disabled. Existing unknown configured types remain visible rather than being erased.

Custom AppV2 classes include Potion, Background, NPC Attack, NPC Feature, NPC Special Attack, and Class Ability sheets. Add new render behavior through an owning, gated dispatcher seam and preserve type guards.

**Validate:** `npm test -- dev/tests/condition-hooks.test.mjs dev/tests/creature-type-map-sync.test.mjs dev/tests/npc-displaycard.test.mjs` and live sheet rendering through Quench.