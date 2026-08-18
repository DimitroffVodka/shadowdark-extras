---
type: integration guide
title: Maphub Map Generators
description: Maphub launcher, viewer, parser, cave generation, iframe compatibility handling, and scene/document boundaries.
tags: [maps, maphub, integration]
---
# Maphub Map Generators

Maphub has two surfaces. `registerMaphubHooks()` recognizes journal HTML placeholders such as `.sdx-maphub-map[data-maphub-type]`; `MaphubLauncherApp` and `MaphubViewerApp` provide the interactive generator/viewer path. This is not part of the generic Scene ZIP pipeline.

The placeholder flow validates generator type as a safe slug, prefers a bundled local generator, and permits external fallback only to HTTPS `watabou.github.io` URLs. Foundry v14 can serve local HTML as `text/plain`; the code fetches it, injects a base/query shim, creates a Blob URL for iframe embedding, and revokes the URL on load/removal. This validation is a security and compatibility boundary: journal markup must not select arbitrary URLs or module paths.

`MaphubViewerApp` is ApplicationV2 and injects iframe DOM directly to preserve sandbox behavior. It can save map state, export to chat, show a player view, import into a Scene, set background, or add a tile. `maphub-cave.mjs`, parser modules under `scripts/maphub/`, constants, and bundled generator assets support launcher-to-viewer/cave data flow.

**Validate:** test local generator, external fallback, malformed type rejection, and v14 text/plain wrapper behavior in Foundry. The Map Generators feature gate must suppress both hooks and launchers when disabled.