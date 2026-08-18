---
type: workflow guide
title: Damage Cards and Weapon Bonuses
description: The chat-card pipeline that captures roll context, resolves targets, and applies configured combat outcomes.
tags: [combat, damage-cards, weapons]
---
# Damage Cards and Weapon Bonuses

`registerChatCardHooks()` in `scripts/combat/chat-card-hooks.mjs` owns the Shadowdark chat boundary. `preCreateChatMessage` snapshots selected target IDs and consumable item configuration into `flags.shadowdark-extras.targetIds` and `itemConfig`; this happens before consumption can remove the source item. `renderChatMessageHTML` calls `injectDamageCard()` and weapon-bonus processing.

`injectDamageCard()` is implemented as a split pipeline: `damage-card-pipeline.mjs` orchestrates builders, target resolution, actions, and finalization. Context resolution prefers a speaker token’s synthetic actor, then world actor, then canvas token. If an item was consumed, saved message config reconstructs enough context for the card.

```mermaid
sequenceDiagram
    participant Roll as Shadowdark roll
    participant Hook as chat-card-hooks
    participant Message as ChatMessage flags
    participant Pipeline as damage-card pipeline
    participant Targets
    participant Actor
    Roll->>Hook: preCreateChatMessage
    Hook->>Message: save targetIds and itemConfig
    Roll->>Hook: renderChatMessageHTML
    Hook->>Pipeline: injectDamageCard
    Pipeline->>Targets: resolve targets
    Pipeline->>Actor: apply configured result
```

The card rejects deleted/closed cards, duplicate `.sdx-damage-card` DOM, and ineligible messages. `_sdx_calculatingMessages` prevents duplicate calculations. Failed weapon attacks can return early and hide base damage rolls under `combatSettings`; this order is important.

Non-GM damage application uses the shared combat socket; card modules must not register socketlib directly. Spell activity, auras, templates, duration, summons, and item grants are consumers of this handoff—see [Effects and Macros](../spells/effects-and-macros.md). Weapon configuration and roll patches feed the same chat path rather than creating a second card system.

**Validate:** `npm test -- dev/tests/lane-b-damage-card-routing.test.mjs dev/tests/lane-b-weapon-bonus-damage.test.mjs dev/tests/lane-b-combat-socket.test.mjs dev/tests/weapon-bonus-display.test.mjs`.