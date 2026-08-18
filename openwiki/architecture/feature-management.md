---
type: configuration architecture
title: Feature Management and Settings Ownership
description: The reload-required feature gate, dependency semantics, Feature Manager UI, and safe ownership rules for settings and registrations.
tags: [configuration, feature-gates, foundry]
---
# Feature Management and Settings Ownership

`scripts/settings/feature-gates.mjs` is the control plane for optional SDX capabilities. `FEATURE_IDS` provides stable identifiers; `FEATURE_CATALOG` assigns each feature to a group, name, description, optional dependencies, and visibility. The root consults `isFeatureEnabled()` before feature-owned registration and startup work.

## Persisted state and dependency rules

The hidden world setting `shadowdark-extras.disabledFeatures` is an `Array`, defaults to `[]`, and has `requiresReload: true`. `normalizeDisabledFeatureIds()` rejects malformed values, drops unknown IDs, removes duplicates, and returns catalog order. `getFeatureState()` reports direct disablement or dependency blocking; it does not mutate the stored selection. Circular dependencies throw.

A dependency-disabled child is unavailable even if the child itself is checked. `applyFeatureGroupState()` changes only catalog entries in its named group. `getFeatureFlagContext()` creates template-safe camel-cased keys used by Handlebars templates.

## Feature Manager UI

`FeatureManagerApp` is a Foundry `HandlebarsApplicationMixin(ApplicationV2)` using `templates/feature-manager.hbs`. It shows aggregate visible choices plus advanced per-feature groups, marks dependency-blocked items, supports group/all controls, normalizes the submitted disabled list, saves only a changed value, and informs the user that reload is required. `registerFeatureManagerSettings()` must run before the main gated init callback.

## Ownership rules

`scripts/settings/module-settings.mjs` has `SETTING_OWNERS`. A setting/menu registration remains when any of its listed feature owners is enabled. Use every genuine owner for shared configuration; only compatibility/migration registrations use `null`. Feature-owned sockets, hooks, templates, controls, and APIs also need gates—not only their menu item.

When adding a feature:

1. Add a stable ID and catalog entry, group, and declared dependency if real.
2. Gate all owned setup, ready, UI, sockets, templates, and assets.
3. Add shared setting owners rather than attributing a shared key to one consumer.
4. Update public API ownership in [Public API](public-api.md) if externally exposed.
5. Run focused ownership tests and snapshots.

## Validation

- `npm test -- dev/tests/feature-gates.test.mjs`
- `npm test -- dev/tests/feature-manager-integration.test.mjs`
- `npm test -- dev/tests/feature-manager-registration-ownership.test.mjs`
- `npm test -- dev/tests/feature-manager-ui-ownership.test.mjs`
- `npm run snapshot:settings`

Persistent-state compatibility and reload/migration implications are canonicalized in [Persistence and Migrations](persistence-and-migrations.md).