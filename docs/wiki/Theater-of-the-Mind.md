# Theater of the Mind

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

Theater of the Mind (ToM) presentation scenes — fullscreen image or video backdrops you broadcast to the whole table, with optional arena grids, video overlays, and a scene-to-scene nav bar. They are presentation records; Foundry canvas Scenes are separate documents.

![Fighting Pit broadcast — fullscreen arena with isometric grid and stacked overlays](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/tom-player-view-arena.webp)

---

## Where it lives

- **SDX Tray → Scenes tab** — the `Images` tab on the left-edge tray (GM only, `fa-images`). While a scene is broadcasting the Scenes header expands an inline **Overlays** strip directly inside `tray.hbs#scenes-view` (`tom-overlays-inline`, `TomStore.activeSceneId`-gated — same list the old rail `fa-film` button showed, but no extra click). The strip header `tom-overlays-inline-header` is a toggle (`tom-overlays-toggle`, `aria-expanded` + `fa-chevron-down/right` → `collapsed`, `hidden` list) and its `Clear all` button never collapses the section (`stopPropagation`). Rapid audition is scroll-preserving: `TrayApp._saveScrollPositions` / `_restoreScrollPositions` (`tray-scroll-state.mjs`) snapshots the `tom-overlays-inline-list` scroll and the overlay hook `sdx.tomOverlayChanged → TraySD.renderTray` restores it after the re-render — clicking overlays does not jump you back to the top.
- **Top-center Scene Navigation Bar** — appears during a broadcast for GM folder-local navigation.
- **Fullscreen player view** — the `TomPlayerView` overlay every connected client sees when a scene is broadcasting.

---

## Workflow

1. **Create.** Click `Create New Scene` in the Scenes tab header. Fill in the editor, then `Save Changes`. The preview updates the arena grid live as you adjust `Overlay Scale`.
2. **File.** Drag scene cards between folders to file them (drag-over highlights), or leave them in `Uncategorized`. Collapse folders with the chevron; rename or delete them with the header actions.
3. **Broadcast.** Click the card's thumbnail or name (`Click to Broadcast`). The `Play` overlay marks the active card. In Foundry this fans out via `game.socket` on `module.shadowdark-extras` — the live player view appears for every client.
4. **Overlays (multi-select).** While broadcasting, the inline **Overlays** strip is in the Scenes header. Click any pill to toggle it — multiple overlays can be active at once (they stack over the backdrop, under arena/cast; header shows `(n)` count). Clicking an already-active pill removes just that overlay; `Clear all` wipes the stack. The strip's header chevron collapses/expands the list, and auditioning never scrolls the list to the top. Players see the same stacked videos in the player view (`div.tom-video-overlay[data-overlay-path]` per overlay).
5. **Navigate.** Use the top-center `◀ / ▶` bar to step to the previous or next ToM scene in the same folder (wraps at the ends, uses the next scene's `In Animation`).
6. **Stop.** Click `Stop Broadcasting` in the Scenes tab header. The player view closes with the active scene's `Out Animation` and all overlays are cleared.

---

## Scene record

Every ToM scene is a `TomSceneModel`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | `randomID()` | Immutable. |
| `name` | string | `New Scene` | Shown on the card, in the nav bar, and as the player-view title. |
| `background` | string | `modules/shadowdark-extras/assets/default-scene.jpg` | Image or video path; see `bgType`. |
| `bgType` | `image` \| `video` | inferred | Inferred from extension: `.webm` / `.mp4` / `.m4v` → `video`, else `image` (`TomEditors._updateBackground`). |
| `isArena` | boolean | `false` | `It's an Arena?` toggle. When on, players with spawn permission can place tokens. |
| `arenaType` | enum | `isometric` | Only shown when `isArena` is true. See Arena grids. |
| `arenaScale` | number | `1` | Grid fit: `0.25`–`5` clamped step `0.05` (`--arena-scale` CSS var); `1` = 100%. Shared by editor preview + live player, so the chosen fit survives broadcast. |
| `inAnimation` | enum | `fade` | Entrance animation on broadcast / nav. |
| `outAnimation` | enum | `fade` | Exit animation on stop or when switching away to another scene. |
| `folderId` | string \| null | `null` | Folder assignment; `null` → `Uncategorized`. |

Source: [`scripts/tom/TomSceneModel.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tom/TomSceneModel.mjs) · [`scripts/tom/TomEditors.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tom/TomEditors.mjs#L81) · [`scripts/tom/tom-defaults.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tom/tom-defaults.mjs)

---

## Scene editor

![Edit Scene — live preview with arena grid and Overlay Scale](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/tom-scene-editor.webp)

`TomSceneEditor` (`templates/tom-scene-editor.hbs`) — a simple `ApplicationV2` form:

- **Name** — `input[name="name"]`, placeholder `New Scene`, required.
- **Preview** — centered media preview: `<video muted loop autoplay>` for video, `<img>` for image, placeholder `fa-image / No image selected` when empty. The arena SVG is overlaid same-size via `TomArenaSvg.arenaSvgForType(arenaType)` + `TomEditors._getLiveAspect()` (measured from the live `tom-player-view`), so `width: 92%` + `--arena-scale` transform matches the broadcast size.
- **Background Media** — `input[name="background"]` + `FilePicker` button (`data-type="imagevideo"`, `data-target="background"`). Changing the path re-infers `bgType`.
- **It's an Arena?** — `input[type=checkbox][name="isArena"]` with hint `Allows players with spawn permission to place tokens on this scene`. Toggling it re-renders the form to show or hide the grid selector.
- **Arena Grid Style** — `select[name="arenaType"]` (conditional, only when `isArena`): `Isometric (Ellipse)` / `Top Down (Circle)` / `Expanded (Radial Grid)` / `Ladder (Linear Track)` / `No Grid (None)`.
- **Overlay Scale** — slider + number `range/number[name="arenaScale"] 0.25–5 step 0.05` (label `Overlay Scale — X× (Y%)`), hint `Fit the grid to your image` — clamped `Math.min(5, Math.max(0.25, ...))`, default `1`. Live-patches `--arena-scale` on the preview without re-render; saved to `TomStore` so it broadcasts.
- **Animations** — two `select`s: `In Animation` (`fa-sign-in-alt`) and `Out Animation` (`fa-sign-out-alt`), each with 10 options (see below).

Footer: `Cancel` (`data-action="close"`) and `Save Changes` (`data-action="save"`, shows `fa-spinner fa-spin / Saving…` while persisting).

Animations (shared list for both selects):

`fade` · `slide-left` · `slide-right` · `slide-top` · `slide-bottom` · `zoom-in` · `zoom-out` · `rotate` · `blur` · `none (Instant)`

Source: [`templates/tom-scene-editor.hbs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/templates/tom-scene-editor.hbs) · [`scripts/tom/TomEditors.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tom/TomEditors.mjs)

---

## Library (Scenes tab)

![Scenes tab — inline Overlays strip with 20 pills, 2 active](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/tom-scenes-tray.webp)

Rendered from `templates/sdx-tray/tray.hbs` (`scenes-view`) via `TrayApp._getTomScenes()` / `_getTomFolders()` and bound in `scripts/tray/tom-scene-bindings.mjs`.

**Header**

- `Create New Scene` (`data-action="create-scene"`, `fa-plus`).
- `Create New Folder` (`data-action="create-folder"`, `fa-folder-plus`, prompts for a name via `_promptFolderName`).
- `Stop Broadcasting` (`data-action="stop-broadcast"`, `fa-stop`, `danger`, only when `tomActiveSceneId`).

**Folders** — each `scene-folder[data-folder-id]`:

- Header (`data-action="toggle-folder"`): chevron `fa-caret-down` / `fa-caret-right` when collapsed, folder icon `fa-folder-open` / `fa-folder`, name, count `(<n>)`, actions `Rename` (`fa-pen`, `data-action="rename-folder"`) / `Delete` (`fa-trash`, `data-action="delete-folder"`). Header click toggles `TomStore.toggleFolderCollapsed`.
- Content (`scene-folder-content`, `hidden` when collapsed): the folder's `scene-card`s, or `Drag scenes here` when empty. Supports `dragover` / `dragleave` / `drop` filing: dropping a card into a new folder calls `TomStore.moveSceneToFolder`; dropping within the same folder reorders via `TomStore.reorderScenes`.
- `scene-uncat-container[data-folder-id=""]` for `Uncategorized` scenes (those with `folderId === null`), with the `Uncategorized` header when any folder exists.

**Scene cards** — each `scene-card[data-scene-id][draggable=true][active]`:

- `scene-card-activate` (`Click to Broadcast`): thumb `scene-card-thumb` (`<video muted loop>` with `scene-thumb-video` or `div.scene-thumb-image` via `background-image`), `scene-playing-overlay[fa-play]` when active, info `scene-name` + `scene-tag arena` badge when `isArena`.
- `scene-card-actions`: `Edit Scene` (`fa-pen`, `data-action="edit-scene"` → `TomSceneEditor`) and `Delete Scene` (`fa-trash`, `data-action="delete-scene"`).
- Uncategorized rendering uses `tomScenes` iteration with `{{#unless folderId}}`; folder rendering uses `tomFolders[].scenes`.
- Empty state: `No Scenes Created` when both `tomScenes` and `tomFolders` are empty.

Source: [`templates/sdx-tray/tray.hbs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/templates/sdx-tray/tray.hbs) · [`scripts/tray/TrayApp.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tray/TrayApp.mjs) · [`scripts/tray/tom-scene-bindings.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tray/tom-scene-bindings.mjs)

---

## Broadcasting

Socket name `module.shadowdark-extras` (`TOM_CONFIG.SOCKET_NAME`). Both `TomSocketHandler` handlers run locally before the emit returns, so the GM's view updates immediately.

| Direction | Method | Payload | Effect |
|---|---|---|---|
| GM → all | `emitBroadcastScene(sceneId, inAnimation, outAnimation)` | `{sceneId, inAnimation, outAnimation}` | If switching, plays the current scene's `outAnimation` (`playOutAnimation`) before `Store.setActiveScene` → `TomPlayerView.activate(sceneId, inAnimation)` → tray + nav-bar refresh. `outAnimation` is inferred from the current scene when `null`. |
| GM → all | `emitStopBroadcast(outAnimation)` | `{outAnimation}` | `TomPlayerView.deactivate(outAnimation)` → `Store.clearActiveScene` → remove overlay → hide tray switcher + nav bar. |

Player view is `TomPlayerView` (`templates/tom-player-view.hbs`), a frameless full-bleed `ApplicationV2` (`#tom-player-view`, `div.tom-player-view[data-scene-id]`). Background is `<video muted loop autoplay playsinline disablepictureinpicture>` or `<img class="tom-pv-bg-media">`. Entrance/exit animations apply as `anim-in-*` / `anim-out-*` classes and are removed on `animationend` (or immediately when `none`).

Source: [`scripts/tom/TomSocketHandler.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tom/TomSocketHandler.mjs) · [`scripts/tom/TomPlayerView.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tom/TomPlayerView.mjs)

---

## Player view and arena

`TomPlayerView` template layers (top to bottom in the DOM, with Foundry-owned CSS in `styles/tom.css` and `styles/tom-theme.css`):

1. `tom-pv-background` — fullscreen media.
2. `tom-pv-overlay` — dimming overlay.
3. `tom-video-overlay` — active video overlay (`tom-panels` → `TomSocketHandler`), inserted before arena/cast layer; `.blend-mode` variant for `.mp4`.
4. `tom-arena-assets` — GM-placed images (`tom-arena-asset[data-asset-id]`, `left/top %` + `translate(-50%,-50%) scale(n)`, GM drag + wheel resize + right-click remove; socket `arena-asset-*`).
5. `tom-arena-tokens` — placed actor tokens (`tom-arena-token[data-token-id][data-owner-id][data-actor-id]`, `npc` vs PC, `draggable` when owned/GM, `compact` toggle; ports portrait `tom-arena-token-portrait`, info `ac / name / hp`, conditions strip, sheet/conditions/compact buttons; drag clamped to `5–95%`, right-click remove, socket `arena-token-*`).
6. `tom-arena-rings` — SVG arena grid (filter `arenaGlow` + `ringGradient`).
7. `tom-pv-cast` — character strip (`data-preset` + CSS vars `--cast-size/--cast-spacing/--cast-offset-x/--cast-offset-y`).

An interactive **demo** of the full broadcast plus overlay and arena layering is at [Theater of the Mind demo](https://dimitroffvodka.github.io/shadowdark-extras/docs/demo/theater-of-the-mind.html) (browser simulation — see banner on the page for what is simulated).

### Arena grids

Four grid styles plus `none` (chosen in the editor's `Arena Grid Style`):

- **Isometric (Ellipse)** — outer ellipse `FAR` (420×210), inner ellipse `NEAR` (180×90), center ellipse `CLOSE` with shared radii, glow + gradient stroke.
- **Top Down (Circle)** — concentric circles `FAR` (r 280), `NEAR` (r 140), center `CLOSE` (filled, r 140).
- **Expanded (Radial Grid)** — five color-zoned circles `ENGAGED` red r55 → `SHORT` orange r125 → `MEDIUM` yellow r190 → `LONG` green r255 → `EXTREME` blue r320, plus 12 radial sector lines at 30° increments.
- **Ladder (Linear Track)** — horizontal 5-zone bar `ENGAGED` red → `CLOSE` orange → `NEAR` yellow → `FAR` green → `OUT OF RANGE` blue, with divider lines and end arrows, labels inside each zone.

Source: [`templates/tom-player-view.hbs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/templates/tom-player-view.hbs) · [`scripts/tom/TomPlayerView.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tom/TomPlayerView.mjs)

---

## Video overlays

The inline strip is driven by `scripts/tom/TomOverlays.mjs` (`TOM_OVERLAY_BASE` + `TOM_OVERLAYS`, single import consumed by `TrayApp.mjs` → `tomOverlayOptions`/`tomOverlayCount`/`tomCurrentOverlays` and mirrored by the compat floating panel `tom-panels.mjs#_toggleTomOverlayPanel`, which imports/keeps the same list in sync). Assets live under `assets/Tom/overlays/`:

| Label | File | Type |
|---|---|---|
| Fire | `fire.webm` | webm |
| Snow | `snow.webm` | webm |
| Wind | `wind.webm` | webm |
| Rain | `rain.webm` | webm |
| Dust | `dust.webm` | webm |
| Campfire | `campfire.webm` | webm |
| Burning | `burning.webm` | webm |
| Purple | `purple.webm` | webm |
| Light | `light.webm` | webm |
| Storm | `storm.webm` | webm |
| Fog | `fog.webm` | webm |
| Gente Snow | `gentlesnow.mp4` | mp4 |
| Light Rain | `lightrain.mp4` | mp4 |
| Slow Snow | `slowsnow.mp4` | mp4 |
| Light Snow | `lightsnow.mp4` | mp4 |
| Blue Rays | `bluerays.mp4` | mp4 |
| Embers | `embers.mp4` | mp4 |
| Sparks | `sparks.mp4` | mp4 |
| Glow | `aurora.mp4` | mp4 |
| Aurora-green | `aurora2.mp4` | mp4 | *(added — was on disk but unlisted)* |

### Inline strip (today)

The strip lives at `templates/sdx-tray/tray.hbs#tom-overlays-inline` (inside `scenes-view`, gated on `tomActiveSceneId`). Shape per `TomOverlays.mjs`:

- Header `tom-overlays-inline-header[data-action="tom-overlays-toggle"]` — label + count `tom-overlays-count` (`(n)`) + `Clear all` button (`tom-overlay-clear`). The header toggles the strip (`collapsed` / `hidden` + `fa-chevron-down/right`, `aria-expanded`); `Clear all` uses `stopPropagation` so it never collapses the section.
- List `tom-overlays-inline-list` → `button.tom-overlay-inline-item[data-overlay-path][data-action="tom-overlay-toggle"]` (preview `fa-play`, name, `tom-overlay-inline-check`). Up to 20 pills in a two-column grid; each click toggles that overlay in place. The list's scroll is snapshot-preserved (`tray-scroll-state.mjs` + `sdx.tomOverlayChanged`) so rapid audition does not jump to the top.
- Compat floating panel `tom-panels.mjs#_toggleTomOverlayPanel` keeps the same set in sync for any lingering callers; the old `tray-handle-button-tool[data-action="tom-overlay-manager"]` is removed from `tray.hbs` and `TrayHandleBindings`.

### Stacking + multi-select

- Store `TomStore.currentOverlays: string[]` (ephemeral, next to `activeSceneId`). A `currentOverlay` getter/setter shim remains on the prototype (get = `[0]`, set = single/clear) so old callers keep working. Tray exposes `tomOverlayOptions.active = Set.has(path)`, `tomOverlayCount`, and `tomCurrentOverlays` (array) alongside legacy `tomCurrentOverlay` (`[0]`).
- Sockets are additive: `overlay-set {overlayPath}` adds idempotently, `overlay-toggle {overlayPath}` flips, `overlay-clear {}` clears all, `overlay-clear {overlayPath}` clears one; legacy `overlay-add` aliases `overlay-set`. GM-only emits (`Hooks.callAll("sdx.tomOverlayChanged", [...currentOverlays])` → `TraySD` re-render).
- In `tom-player-view` each active overlay is its own `div.tom-video-overlay[data-overlay-path]` (`<video loop autoplay muted playsinline>` with MIME from extension; `.mp4` adds `blend-mode: screen`). Insertion is just before `tom-arena-tokens`/`tom-arena-assets`/`tom-arena-rings`/`tom-pv-cast` in set order, so multiple overlays stack without cloning.

Panel UI (inline): header `fa-film / Overlays (n)`, `Clear all` button (disabled when none), list `tom-overlays-inline-list` → active items carry `active` + `fa-check`. Clicking an active pill clears just that one via `emitOverlayToggle`/`_onOverlayToggle`; `Clear all` calls `emitOverlayClear({})`/`_onOverlayClear({})`.

Socket events: `overlay-set {overlayPath}` / `overlay-toggle {overlayPath}` / `overlay-clear {overlayPath?}` (GM-only emits, broadcast to all, local handler runs immediately; the store array + DOM are updated before the socket hop). The overlay source MIME is inferred from the file extension.

Try them live in the [Theater of the Mind demo](https://dimitroffvodka.github.io/shadowdark-extras/docs/demo/theater-of-the-mind.html) — the overlay strip on the stage lets you switch loops and clear them without a Foundry session.

Source: [`scripts/tray/tom-panels.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tray/tom-panels.mjs) · [`scripts/tom/TomSocketHandler.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tom/TomSocketHandler.mjs) · [`assets/Tom/overlays/`](https://github.com/DimitroffVodka/shadowdark-extras/tree/main/assets/Tom/overlays)

---

## Scene Navigation Bar

`sdx-scene-nav-bar` — a fixed top-center row inserted directly on `document.body` by `scripts/scene/SceneNavBar.mjs` via `SceneNavBar.show(sceneId)` / `hide()`.

Markup: `button.scene-nav-prev[data-action="prev-scene"]` (`fa-caret-left`) + `div.scene-nav-name` (`scene.name`) + `button.scene-nav-next[data-action="next-scene"]` (`fa-caret-right`). Styles in `styles/scene-nav-bar.css` (uses `assets/Tom/arrow-left.webp` for both arrows, right arrow flipped `scaleX(-1)`). Shown by `TomSocketHandler._onBroadcastScene` / `_showSceneNavBar` and hidden on `stop-broadcast`.

Navigation: `SceneNavBar._navigateScene(direction)` looks up `currentScene.folderId`, gets `TomStore.getScenesInFolder(folderId)`, finds the current index, wraps (`-1 → last`, `>= length → 0`), then `emitBroadcastScene(nextScene.id, nextScene.inAnimation)`. So nav is **folder-local** and uses the destination scene's `In Animation`.

Source: [`templates/scene-nav-bar.hbs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/templates/scene-nav-bar.hbs) · [`scripts/scene/SceneNavBar.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/scene/SceneNavBar.mjs)

---

## Storage and settings

| Setting key | Scope | Type | Default | Purpose |
|---|---|---|---|---|
| `tom-scenes` | world | Array | `[]` | The `TomSceneModel.toJSON()` array. Drive via `TomStore.saveData()` / `_loadScenes()`. |
| `tom-folders` | world | Array | `[]` | Folder records `{id, name, collapsed}`. Drive via `TomStore.saveFolders()`. |
| `tom-dataVersion` | world | Number | `0` | Migration flag. `TomMigrationService.migrate()` runs on `ready` (GM only): if `data-v3`/`data-v2` exists and no `tom-scenes`, copies legacy scenes into the new store. |

Store also tracks `activeSceneId`, `currentOverlays: string[]` (active overlay paths; legacy `currentOverlay` shim = `[0]` on `TomStoreClass.prototype`), and per-broadcast arena collections (`arenaTokens` Map, `arenaAssets` Map, `ruler` state) — the latter three are ephemeral and not persisted in settings. Tray context mirrors the store as `tomOverlayOptions[].active` (`Set.has`), `tomOverlayCount`, `tomCurrentOverlays[]`, and compat `tomCurrentOverlay`.

`Store.initialize()` is called from `TomSD._onReady()` (which also registers the `Data Version`/`Scenes`/`Folders` settings and sets the `Hooks.on("updateSetting")` listener that reloads scenes/folders live).

Source: [`scripts/tom/TomStore.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tom/TomStore.mjs) · [`scripts/tom/TomSD.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tom/TomSD.mjs) · [`scripts/tom/TomMigrationService.mjs`](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/scripts/tom/TomMigrationService.mjs)

---

## GM versus player

| Capability | GM | Player |
|---|---|---|
| See and use the **Scenes tab** | yes | no |
| Create / edit / delete scenes and folders | yes | no |
| **Broadcast / stop** a scene | yes | no — receives via socket |
| **Video overlays (multi-select stack)** (`tom-overlays-inline` strip, `overlay-set/toggle/clear`) | yes — strip appears only while broadcasting; pick multiple, `Clear all` | receives the stacked `tom-video-overlay[data-overlay-path]` videos in the player view |
| **Scene Navigation Bar** prev/next (folder-local, wraps) | yes — rendered in GM's DOM by `SceneNavBar` | receives the broadcast change |
| **Arena assets/tokens** drag, scale (wheel), right-click remove | yes | tokens they own are `draggable` and right-click-removable; others are static |
| Ruler / HP / conditions on arena tokens | GM controls all tokens | sees HP on owned tokens; conditions/sheet buttons are owner-gated |

---

## Troubleshooting

**Players do not receive a ToM broadcast.** Confirm `socketlib` is installed and enabled, a GM is connected, and the player's module version matches the GM's.

**Scene Navigation Bar does not appear.** It only renders while a ToM scene is broadcasting. Confirm the broadcast indicator (`fa-play` on the card) and try stopping and re-broadcasting.

**Video overlay does not appear or one stays stuck.** The strip is now multi-select: an active pill has a check — clicking it again removes just that overlay. `Clear all` at the top removes the whole stack. Re-broadcasting still refreshes the layer, and with the strip collapsed the overlays keep running (chevron still toggles visibility of the list, not the overlays).

**Images or videos fail to display.** Paths are literal Foundry asset paths. Confirm the file exists under `Data/` (e.g. `assets/Tom/...` inside the module or a user-data path) and that the hosting Scene or video URL is reachable from the client.

**Drag into a folder does nothing or order is wrong.** Dropping a scene onto a different folder moves its `folderId`; dropping onto a card reorders within the folder via `TomStore.reorderScenes`. The header's rename/delete buttons are inside the folder header — clicking them does not toggle the folder.

---

**Related:** [Canvas & Table Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Canvas-and-Table-Tools) · [Map Generators](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Map-Generators) · [Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference) · [Troubleshooting](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Troubleshooting) · [Theater of the Mind demo](https://dimitroffvodka.github.io/shadowdark-extras/docs/demo/theater-of-the-mind.html)
