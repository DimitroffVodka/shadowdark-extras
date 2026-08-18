---
type: canvas subsystem
title: Canvas Tools and Tile Utilities
description: Synchronized drawing, tile flattening, light/token/wall controls, and their canvas lifecycle boundaries.
tags: [canvas, drawing, tiles]
---
# Canvas Tools and Tile Utilities

`SDXDrawingTool` is a singleton assembled from drawing shapes, entries, sync, geometry, and constants mixins. When enabled, the root exposes drawing tool/toolbar references and initializes it. Initialization restores toolbar state, builds a PIXI interface container, loads Scene drawings, registers sockets, rebuilds on `canvasReady`, and cleans up on teardown. Modes include sketch, line, box, ellipse, and stamp with temporary/permanent behavior.

`TileFlattenSD.mjs` adds Tile HUD flatten/restore actions. Flattening selected tiles computes rotation-aware bounds, temporarily hides unrelated canvas layers/controls/grid content, renders a WebP into `flattened-tiles`, records restoration metadata, and restores display state. `nextFrame()` has an animation-frame plus timer fallback so a background tab cannot stall rendering.

Other canvas services are separately gated: Light Tracker, Token Toolbar, Wall Context Menu, and carousel drag. Use their owner modules and guards rather than assuming a canvas or optional dependency exists.

**Validate:** `npm test -- dev/tests/canvas-drawing-geometry.test.mjs dev/tests/canvas-drawing-tool.test.mjs dev/tests/wall-tile-override.test.mjs`.