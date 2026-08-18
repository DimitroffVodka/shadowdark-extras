---
type: engineering guide
title: Validation, Release, and Safe Refactoring
description: The Node test tiers, structural gates, pack build, release checks, and limits of static verification.
tags: [validation, release, tooling]
---
# Validation, Release, and Safe Refactoring

Node 24 is the supported runtime (`>=24 <27`). `npm run test:all` runs the discovered Node tests plus the separately named roller regression. Do not use bare `node --test dev/tests/`; use `npm test` / package scripts.

`verify.sh` syntax-checks shipped `.mjs`, then blocks on import resolution, script paths, named exports, registrations, API/settings/flag snapshots, constant drift, binding checks, entry-state inventory, export-surface comparison, ESLint errors, and removable unused imports. It also scans for known historical regressions. `--strict` promotes warnings.

| Change intent | Narrow checks |
| --- | --- |
| Move/extract module | `npm run gate:imports`, `npm run gate:named-exports`, `npm run gate:bindings`, snapshots |
| Preserve runtime registrations | `npm run snapshot:registrations` plus live Quench |
| Public export/API change | `npm run snapshot:api`, `npm test -- dev/tests/export-surface.test.mjs` |
| Stored setting/flag change | settings/flag snapshots and migration tests |
| Pack/content change | `npm run pack && npm run release:check` |
| Broad source change | `npm run verify && npm run test:all` |

Static gates have limits: registration snapshots are call-site inventory, not Foundry runtime order; API snapshots compare names, not signatures; computed dynamic imports need manual/live review. Quench runs in a real Foundry world and requires rendering its results app before executing the structural batch.

Release checks ensure package/module version parity and that manifest-declared scripts, esmodules, styles, language files, YAML sources, and nonempty compiled packs exist. Close Foundry before packs/release checks to avoid LevelDB lock failures.

See [Overview](../architecture/overview.md) for lifecycle ordering and [Persistence and Migrations](../architecture/persistence-and-migrations.md) for compatibility validation.