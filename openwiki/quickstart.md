---
type: wiki entrypoint
title: Shadowdark Extras Code Wiki
description: A source-grounded guide to the Foundry module architecture, feature owners, workflows, persistent state, and safe validation.
tags: [shadowdark-extras, navigation, foundry]
---
# Shadowdark Extras Code Wiki

Shadowdark Extras is a Foundry VTT module for Shadowdark RPG. Its manifest declares the runtime assets and esmodule entrypoints; `scripts/shadowdark-extras.mjs` is an intentionally ordered composition root that gates feature-owned modules and builds the setup-time module API. Start with [Architecture Overview](architecture/overview.md) before changing initialization, registrations, or cross-feature behavior.

## Map of the repository

| System | Canonical wiki page | Source entrypoints / symbols | Focused tests | Minimal validation |
| --- | --- | --- | --- | --- |
| Lifecycle, gates, API | [Overview](architecture/overview.md), [Feature Management](architecture/feature-management.md), [Public API](architecture/public-api.md) | `module.json`, `shadowdark-extras.mjs`, `FEATURE_IDS`, `FeatureManagerApp` | `feature-gates.test.mjs`, ownership tests | `npm run verify` |
| Stored-state compatibility | [Persistence and Migrations](architecture/persistence-and-migrations.md) | root ready migrations, `TomMigrationService`, journal flags | `itemacro-migration.test.mjs`, `hex-dungeon-persistence.test.mjs` | relevant migration test + `npm run verify` |
| Cross-feature tray UI | [Tray and Cross-Feature UI](architecture/tray-and-cross-feature-ui.md) | `initTray`, `TrayApp`, `SDXRollerApp` | tray/roller tests | `npm test -- dev/tests/tray-app-bindings.test.mjs` |
| Damage and combat extensions | [Damage Cards](combat/damage-cards.md), [Encounter Tools](combat/encounter-tools-and-roll-hooks.md) | `injectDamageCard`, chat/roll patches, marching | `lane-b-*`, marching tests | focused Node tests |
| Spells and macros | [Effects and Macros](spells/effects-and-macros.md) | `enhanceSpellSheet`, aura/template/focus, macro engine | `phase53-lane-c-effects`, itemacro migration | focused Node tests |
| Animation | [Animation FX](animation/animation-fx.md) | `AnimationFxSD`, AA integration, token resolver | animation/token tests | focused Node tests |
| Inventory and item configuration | [Inventory, Containers, and Item Sheets](inventory/containers-and-sheets.md) | `containers.mjs`, trade/ammo, item sheets | container/privacy/ammo tests | focused Node tests |
| Character and NPC sheets | [Character and NPC Sheet Composition](sheets/character-and-npc.md) | root render dispatchers, NPC inventory | conditions/creature tests | live Quench when UI changes |
| Party and carousing | [Party Travel, Camping, and Carousing](party/travel-and-carousing.md) | `PartySheetSD`, mutation planner, carousing journals | travel/carousing tests | focused Node tests |
| Pins, canvas, and Scene portability | [Journal Pins](journal/journal-pins.md), [Canvas Tools](canvas/canvas-tools.md), [Scene Import and Export](scene/scene-portability.md) | pin manager, drawing tool, importer/exporter | pin/drawing tests | focused tests + disposable-world smoke |
| Maphub and maps | [Maphub](maps/maphub.md), [Hex Exploration](hex/hex-exploration.md), [Dungeon Generation](dungeon/dungeon-generation.md) | Maphub apps, hex record store, bridge | hex/dungeon tests | focused tests + Foundry smoke |
| Theatre of the Mind | [Theatre of the Mind](tom/theatre-of-the-mind.md) | `TomStore`, socket handler, player view | TOM/tray tests | multi-client smoke |
| Content and delivery | [Compendium Packs](content/compendium-packs.md), [Validation and Release](engineering/validation-and-release.md) | `src/packs`, pack scripts, `release-check` | release/tool tests | `npm run pack && npm run release:check` |

## How to route a change

1. **Adding or disabling a feature:** read [Feature Management](architecture/feature-management.md), then its owning system page. Add the catalog/gate and every owned registration/UI/runtime seam; preserve shared owners.
2. **Changing a flag, Journal schema, Scene data, or world setting:** read [Persistence and Migrations](architecture/persistence-and-migrations.md) first. Stored names are compatibility contracts, not ordinary refactors.
3. **Changing a Foundry hook or root import:** read [Overview](architecture/overview.md). Registration order is behavior; use snapshot and live validation.
4. **Adding gameplay activity:** activity flags are authored from item sheets and consumed by [Effects and Macros](spells/effects-and-macros.md) and [Damage Cards](combat/damage-cards.md); avoid parallel chat paths.
5. **Changing tray-visible tools:** start at [Tray and Cross-Feature UI](architecture/tray-and-cross-feature-ui.md), then the feature owner. Do not place owner logic directly in `TrayApp`.

## Validation baseline

Use the narrow test named on the owning page while iterating. Before integration or release work, run:

```bash
npm run verify
npm run test:all
```

For content releases, close Foundry and run:

```bash
npm run pack && npm run release:check
```

For runtime-only Foundry behavior (sheet rendering, registration ordering, multi-client sockets), run the documented Quench/live-world tier after static checks.

## Backlog

No evidence-blocked or explicitly out-of-scope substantial subsystem was found in the repository inventory.