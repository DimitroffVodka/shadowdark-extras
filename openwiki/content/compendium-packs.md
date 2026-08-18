---
type: content pipeline
title: Compendium Packs and Content Build
description: Manifest-declared packs, YAML source data, LevelDB compilation, and content flags consumed by module features.
tags: [compendia, packs, build]
---
# Compendium Packs and Content Build

`module.json` registers four packs: `pack-sdxitems` Item, `pack-sdxactors` Actor, `pack-sdxrollables` RollTable, and `pack-sdxeffects` ActiveEffect. Authoritative editable data is YAML under `src/packs/<pack>`; runtime LevelDB output is `packs/<pack>`.

`npm run pack` invokes `dev/packs/pack.mjs`, reads manifest pack declarations, compiles each present source directory with Foundry CLI YAML support, and fails on compilation errors. `npm run unpack` reverses the workflow. Close Foundry first: LevelDB locks are a real failed validation, not a waived pass.

Pack content is feature data as well as static content. Items can carry SDX spell/activity flags; effects are reusable effect library records; RollTables can feed carousing import workflows; Party membership supports compendium Actor UUIDs. Adding a pack means updating the manifest, source folder, and release validation expectations.

**Validate:** `npm run pack && npm run release:check`. See [Validation and Release](../engineering/validation-and-release.md).