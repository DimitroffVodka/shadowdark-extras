---
type: compatibility guide
title: Persistence and Migrations
description: Persistent state owners, ordered migration behavior, compatibility constraints, and recovery rules across Shadowdark Extras.
tags: [persistence, migrations, compatibility]
---
# Persistence and Migrations

SDX persists data in Foundry world settings, document flags, hidden Journals, Scene flags, and TOM world-setting records. Stable identifiers are compatibility contracts: settings keys, menu IDs, flag namespaces, module ID, socket names, and template paths must not be renamed casually.

## State owners

| Owner | Examples | Canonical page |
| --- | --- | --- |
| World settings | `disabledFeatures`, TOM scenes/folders, feature settings | [Feature Management](feature-management.md), [Theatre of the Mind](../tom/theatre-of-the-mind.md) |
| Actor/Item flags | containers, activities, creature type, macros | [Inventory](../inventory/containers-and-sheets.md), [Effects and Macros](../spells/effects-and-macros.md) |
| Scene flags | journal pins, hex fog, hex dungeon metadata | [Journal Pins](../journal/journal-pins.md), [Hex Exploration](../hex/hex-exploration.md), [Dungeon Generation](../dungeon/dungeon-generation.md) |
| Journal flags | carousing state/tables, hex record store | [Travel and Carousing](../party/travel-and-carousing.md), [Hex Exploration](../hex/hex-exploration.md) |

## Root ready-time chain

The root’s ready migration block is ordered. `migrateWebpAssetPaths()` is awaited inside `try/catch`, so it cannot abort world load. `sweepWorldCompendiums()` is started with its own catch and is non-blocking. `migrateLegacyItemMacros()` is awaited bare when its feature is enabled; a throw remains observable. The macro sweep is GM-only, ungated in its own idempotency sense, and retries on later loads because it migrates only legacy data missing native flags.

Do not combine these error policies without intent: their different containment is documented behavior. Socket handlers are registered before migrations so remote requests cannot race an absent handler.

## Feature-local compatibility

TOM runs `TomMigrationService.migrate()` after its store initializes. Hex records live in `__sdx_hex_data__` under `flags.shadowdark-extras.hexData`; tests characterize its record schema and the fact that low-level `saveHexRecord` writes supplied records verbatim. Carousing retains legacy setting/table import paths. Feature disablement is stored but requires reload to affect runtime composition.

## Change procedure

1. Locate the state owner and narrow regression suite.
2. Preserve existing key identity or write an idempotent migration.
3. Define GM/owner authority and partial-failure behavior.
4. Keep a retry path when safe; never silently discard user data.
5. Run snapshots for settings/flags and feature-specific characterization tests.

## Validation

Use `npm run snapshot:settings`, `npm run snapshot:flags`, `dev/tests/itemacro-migration.test.mjs`, `dev/tests/hex-dungeon-persistence.test.mjs`, `dev/tests/tom-background.test.mjs`, and migration-focused Quench checks where a live world is required.