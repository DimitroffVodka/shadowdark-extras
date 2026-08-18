---
type: workflow guide
title: Scene Import and Export
description: ZIP-based Scene portability, asset remapping, related document collection, and the native-Notes boundary.
tags: [scenes, import-export, assets]
---
# Scene Import and Export

`SceneExporter.exportScene(scene)` uses JSZip to serialize `scene.toObject()`, token-linked Actors/Items, Journals referenced by native Scene Notes, scene-specific hex records, image dependencies, and a manifest, then downloads a ZIP. Hex data comes from `__sdx_hex_data__` under `flags.shadowdark-extras.hexData[scene.id]`.

`SceneImporter.promptImport()` selects a file; `importScene(file)` validates `scene.json` and `manifest.json`, assigns a unique name, uploads assets under `Data/imported-scenes/<safeSceneName>/`, recreates Actors/Items/Journals, remaps paths from `image-paths.json`, and creates the Scene. Query strings are stripped from legacy paths before upload/remap.

The exporter scans `scene.notes`; SDX [Journal Pins](../journal/journal-pins.md) are stored in Scene flags and are not native Notes. Treat this as a documented portability boundary when extending either system.

**Validation:** exercise import/export in a disposable Foundry world and verify image and document references. Run `npm run verify` after source changes.