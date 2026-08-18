---
type: UI architecture
title: Tray and Cross-Feature UI
description: The gate-aware SDX Tray, its mode/binding lifecycle, roller, party-stat socket state, and integration boundaries.
tags: [tray, UI, integration]
---
# Tray and Cross-Feature UI

`TraySD.mjs` is the cross-feature UI hub. The root registers Tray app hooks during initialization and calls `initTray()` at ready. Initialization validates the Tray gate/setting, renders `TrayApp`, synchronizes party stats, loads Hex Painter assets, initializes the Dungeon socket before dungeon assets, initializes Solo Hex Mode, and attaches canvas/document lifecycle hooks.

`getVisibleTrayModes()` combines role, permission, user settings, and feature state. It preserves a `player` fallback so a disabled mode set cannot strand the UI. Binding modules split `TrayApp` behavior by concern: handle, party, hex painter, dungeon, pins, TOM panels/scenes, decor, and scroll state. Add a UI behavior in the owner binding rather than growing a monolithic render handler.

Party stats are a `Map<sceneId, Map<tokenId, stats>>` snapshot. The GM broadcasts safe renderable data; players request snapshots at start and `canvasReady`, avoiding a connection-time race and avoiding reliance on full Actor read permission. `SDXRollerApp`/`SDXRollerData` own cinematic-roll lifecycle.

The tray consumes Journal Pins, hex/dungeon painters, Party Management, and TOM, but must conditionally avoid their controls and expensive loaders when corresponding gates are off. TOM refreshes the tray through a dynamic import rather than owning the tray lifecycle.

**Validate:** `npm test -- dev/tests/tray-app-bindings.test.mjs dev/tests/tray-party-data.test.mjs dev/tests/sdx-roller-lifecycle.test.mjs dev/tests/feature-manager-integration.test.mjs`.