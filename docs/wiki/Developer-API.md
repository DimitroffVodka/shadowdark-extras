# Developer API

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

Shadowdark Extras exposes a public module API for macros, integrations, and
MCP-driven prep.

```js
const api = game.modules.get("shadowdark-extras")?.api;
```

The main API object is installed during Foundry's `setup` hook, and the
spell-macro helpers only arrive at `ready`, so call it after the right lifecycle
hook and feature-detect every method you touch.

---

## Permission model

Scene and document mutation methods sit behind a GM guard. A non-GM call throws:

```text
SDX | <function>: requires GM permission
```

Read-only helpers and player-safe effect helpers are open. Public calls get
audited in the console along with their caller.

Importing internal source modules directly to sidestep the wrapper is
unsupported, and it will break on you.

## Creature types

| Method | Purpose |
|---|---|
| `getCreatureType(actor)` | Manual actor override, then bundled bestiary mapping |
| `getMappedCreatureType(name)` | Bundled name-map lookup only |

## Break-on-damage and effects

| Method | Purpose |
|---|---|
| `breakEffectOnDamage(...)` | Mark an effect to end on the bearer's next HP loss |
| `clearBreakOnDamage(...)` | Remove that marker |
| `applySpellEffect(...)` | Apply an SDX-aware spell effect |
| `showConditionsModal(...)` | Open the condition picker |
| `getConditionsData(...)` | Read condition choices/data |

These stay open to players because an owning player's effect has to be able to
break.

## Medkit

| Method | Permission | Purpose |
|---|---|---|
| `registerMedkitPack(packId)` | Any | Add a source Item compendium, idempotently |
| `unregisterMedkitPack(packId)` | Any | Remove a custom source; the SDX source cannot be removed |
| `getMedkitPacks()` | Any | List source collection IDs |
| `scanWorldForUpdates()` | Read-only | Return actors and available update counts |
| `applyWorldMedkitUpdates(options)` | GM | Apply to all or selected actor IDs |
| `medkitScanWorld()` | GM | Open the world scan/review workflow |

Example:

```js
Hooks.once("ready", () => {
  game.modules.get("shadowdark-extras")?.api
    ?.registerMedkitPack("my-module.spells");
});
```

## Focus and durations

| Method | Permission |
|---|---|
| `startDurationSpell(...)` | GM |
| `endDurationSpell(...)` | GM |
| `registerSpellModification(...)` | GM |
| `getActiveDurationSpells(...)` | Read-only |

## Dungeon generation

| Method | Permission | Purpose |
|---|---|---|
| `generateDungeon(settings)` | GM | Generate on the active Scene/current level |
| `getGeneratorSettings()` | Read-only | Current generator configuration |
| `setGeneratorSettings(settings)` | GM | Replace/update generator configuration |
| `generateRandomSeed()` | Any | Create a seed |
| `buildHexDungeonScene(options)` | GM | Create a playable keyed dungeon for a hex |

`generateDungeon` takes optional settings covering seed, layout, room count,
density, branching, room-size bias, symmetry, stairs, clutter, texture, wall
color and width, and shadows. Inputs get validated, and expansive counts get
capped.

The full orchestration contract lives in
[SDX-MCP-DUNGEON-API.md](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/SDX-MCP-DUNGEON-API.md).

## Biomes

| Method | Permission |
|---|---|
| `getBiomeDefinitions()` | Read-only |
| `getCustomBiomes()` | Read-only |
| `setCustomBiome(key, data)` | GM |
| `removeCustomBiome(key)` | GM |
| `resetCustomBiomes()` | GM |
| `getEnabledBiomeKeys()` | Read-only |
| `getDisabledBiomes()` | Read-only |
| `setBiomeEnabled(key, enabled)` | GM |
| `openBiomeEditor()` | UI |

## Hex maps and hexcrawls

| Method | Permission | Purpose |
|---|---|---|
| `generateHexMap(params)` | GM | Generate terrain on the formatted active Scene |
| `clearGeneratedTiles(options)` | GM | Remove SDX-generated hex tiles |
| `hex.buildHexcrawl(dataset, options?)` | GM | Stable published-number dataset → painted Scene |
| `hex.upsertHexRecords(sceneId, records)` | GM | Merge records without rebuilding or repainting |
| `hex.getSpecialTiles()` | GM | Catalogue Specials for explicit, unique hex assignments |
| `buildHexcrawl(dataset, options?)` | GM | Legacy layout; retained for existing macros |
| `buildHexcrawlFromFile(relPath, options?)` | GM | Legacy dataset JSON, relative to the SDX module directory |

`clearGeneratedTiles({ force: true })` skips its confirmation. Reach for that
only inside an automation workflow that already confirmed with the user.

### Stable hexcrawl dataset

After `setup`, `game.shadowdarkExtras.hex` and
`game.modules.get("shadowdark-extras").api.hex` are the **same namespace**.
It is absent when Hex Painter is disabled. Feature-detect it; an importer can
export this same dataset as JSON when SDX is unavailable. No book content is
bundled or fetched by the builder.

```js
const hex = game.modules.get("shadowdark-extras")?.api?.hex;
if (!game.user.isGM || !hex?.buildHexcrawl) return;

const result = await hex.buildHexcrawl({
  name: "Example frontier",
  grid: {
    cols: 14, rows: 4,
    distance: 6, units: "mi",
    landscape: false, flipX: false, flipY: false
  },
  terrain: {
    default: "grassland",
    regions: [{ biome: "forest", hexes: [1402, 1403] }]
  },
  hexes: [
    { num: 1402, name: "Landing" },
    { num: "1403", name: "Old tower", terrain: "forest",
      icon: "icons/svg/castle.svg", desc: "An invented landmark.", zone: "North" },
    { num: 1404, name: "Dunes", terrain: "desert" }
  ],
  networks: {
    river: [1402, 1403, 1404],
    road: [1402, 1403],
    blockedEdges: { river: [[1403, 1404]] }
  }
}, { view: false });
// { sceneId, sceneName, terrainTiles, featureTiles, records }
```

`grid` and `hexes` are required; `hexes: []` builds terrain only. All other
dataset fields are optional. `cols` and `rows` are integer counts from 1–99.
`rowsLowered` (optional, `rows` or `rows - 1`) is the row count of the columns
Foundry shifts half a hex down: those columns end one row short on a print whose
frame cuts the raised columns' first row in half, and the builder paints,
records and accepts no number past it there. Which published columns they are
follows `origin` and the flips. Send it only when it differs from `rows`.
Distance defaults to 6, units to `"mi"`, terrain to `"forest"`, and all
transforms to false. The scene uses SDX's native HEXODDQ grid at size 256.
`terrainTile: { w, h }` overrides the ordinary terrain tile render size
(default 296 × 256); `featureIconSize` defaults to 150. Sizes must be positive.
Icons accept a Foundry asset URL/path; `assets/...` is shorthand for an SDX
module-relative asset.

**Numbering:** leading digits are the published column; the final two digits
are the row. Both start at 1. `1403` and `"1403"` mean column 14, row 3,
Foundry offset `{ i: 2, j: 13 }` with no transforms. `"0102"` is also valid.
`grid.origin: 0` is for maps that number their own first column and row 0: then
columns run 0…`cols`-1 and rows 0…`rows`-1, `0000` is offset `{ i: 0, j: 0 }`, and
every number is stored exactly as supplied. `origin` is `0` or `1` and defaults
to `1`; a scene remembers it, so `upsertHexRecords` takes the same numbers.
No per-hex `col`, `row`, `i`, `j` or coordinate-pair inputs are accepted.
Numeric inputs must be integers; strings must contain exactly 3–4 digits,
without whitespace. Out-of-bounds cells and duplicate keyed hexes are rejected.
`landscape: true` transposes the axes; then `flipX` and `flipY` mirror the
resulting scene axes. Transposing does not import a pointy-top grid.

Options are `{ sceneName?, overwrite?: false, view?: true }`. By default the
builder creates a new scene and views it on the calling client, **not** activates
it for players. `view: false` leaves the current canvas untouched and needs no
active canvas. `overwrite: true` deletes same-name scenes only after the new
map has finished building; use it only after the GM has approved replacement.
Validation errors reject before world writes. Foundry/storage failures reject
and may leave a partial new scene; the old map is retained if building fails.

### Terrain labels versus painted biomes

The record retains the terrain text exactly as supplied. Painting chooses a
biome case-insensitively: keyed `terrain` overrides the last matching region,
which overrides the default. Unknown labels use the default biome, or forest
if that is unknown too. An omitted keyed terrain does not erase its region's
terrain record.

| Imported terrain | Painted biome |
|---|---|
| forest, jungle | forest |
| plains, grassland, path | plains |
| hills, canyon | hills |
| water, arctic sea, coast, lake, ocean, river | water |
| mountains, mountain, deep tunnels, lava | mountains |
| desert, salt flat | desert |
| swamp | swamp |

These are visual fallbacks, not an assertion that lava looks like mountains.
They reuse existing SDX assets. Travel costs and hexes per day are not computed.

### Roads and rivers

`networks.road` and `networks.river` are published hex-number lists. List order
does not determine connections: adjacent designated cells join, including
forks and loops; duplicates are harmless and isolated cells draw no segment.
Importers map the book's `path` overlay to `road`.

`networks.blockedEdges` optionally supplies `{ road: [[num, num]], river: [...] }`.
Both endpoints must belong to that kind's list. The pair suppresses only that
connection; a non-adjacent pair has no effect. This reuses the same blocked-edge
geometry as Shift-click in Roads & Rivers, rather than adding another network
implementation. Without overrides, neighbouring rivers will join.

Networks are saved as SDX permanent `mapNetwork` drawings and use the existing
renderer, just like Create in Roads & Rivers. Their appearance requires Drawing
Tools to be enabled. They are not native Foundry Drawing documents, and the
saved result is geometry—not an editable copy of the pending designation dots.
The summary's terrain/feature counts exclude networks and reference tiles.

### Specials catalogue and unique locations

```js
const specials = await hex.getSpecialTiles();
// [{ id, path, label, tags }, ...] — sorted by id
const keep = specials.find(tile => tile.tags.includes("keep"));
if (!keep) throw new Error("Required special is unavailable");

const map = await hex.buildHexcrawl({
  grid: { cols: 14, rows: 4 },
  hexes: [{ num: 1403, special: keep.id, name: "Border keep" }]
});
```

The catalogue includes every shipped tile in `assets/Hexes/Specials`, including
variants. IDs are the exact asset paths returned by Foundry; pass them back
unchanged. Labels and search tags are derived from filenames, not a visual
classification or a claim about a book location.

A `hexes[].special` assignment replaces that cell's ordinary terrain tile,
using the same centered 572 × 500 render footprint as the colored-tile painter
on the builder's 256 grid. It counts as terrain, not a small feature icon.
The tile stores its published `hexNum`; the hex record uses the supplied name,
or the catalogue label if omitted. Descriptions and terrain stay independent.

Each catalogue ID may be assigned **once per dataset**, and each keyed number
may occur once. Unknown specials or duplicate assignments fail before scene
creation. Specials remain excluded from random biome selection; the importer
or GM chooses their exact locations. `upsertHexRecords` does not move or replace
special tiles. There is no new placement UI or automatic landmark allocation.

### Updating records

```js
await hex.upsertHexRecords(result.sceneId, [
  { num: 1403, desc: "Revised description.", terrain: "deep tunnels" },
  { num: 1404, exploration: "mapped", rollTable: "RollTable.TABLE_ID",
    rollTableChance: 25, rollTableFirstOnly: true }
]);
// { sceneId, records: 2 }
```

Omitted fields survive, including GM notes, discovery state and encounter
links. The whole input batch is validated before its single journal write;
await each mutation before sending the next. Accepted fields (also available
in the build's `hexes` entries) are:

- Text: `name`, `zone`, `terrain`, `travel`, `revealCells`, `rollTable`, `desc`.
  Names are stored as `"num. name"`; an empty name becomes just the number.
- Booleans: `cleared`, `claimed`, `rollTableFirstOnly`, `showToPlayers`.
- `exploration`: `"unexplored"`, `"explored"`, or `"mapped"`.
- `revealRadius`: integer ≥ −1; `rollTableChance`: number from 0–100.
- `notes`: array of `{ id, text, visible }`.
- `features`: array of `{ id, type, name, discovered, ... }`, using the Hex
  Editor's existing feature shape; feature-specific fields are retained.

Explicit `notes`/`features` arrays replace those arrays. `desc` updates a single
importer-owned, hidden note without deleting other notes; repeating it does not
duplicate the note, and `desc: ""` removes it. Updating terrain changes the
record only, not the painted tile. New records start unexplored and not shown
to players. Unmentioned cells and other scenes are unchanged.

Upsert uses the scene's saved version-1 layout, so flips and transpose survive
reloads and updates to an unviewed scene. It rejects legacy/manual scenes with
no saved published layout rather than guessing where their records belong.
The root-level builders preserve the old convention: `cols` counts the final
digits starting at 1, `rows` counts the leading digits starting at 0, and
`landscape` transposes those axes. Rebuild with `hex.buildHexcrawl` to adopt the
new contract; existing flags and scene keys are never silently migrated.

### Optional reference image — hidden is not private

The map is painted SDX tiles on a blank scene. A publisher map is **never** set
as its background. For manual corrections, add:

```js
reference: { src: "worlds/my-world/cropped-reference.webp" }
```

The builder creates a native Tile with `hidden: true`, `locked: true`, alpha
0.5, above the painted map, stretched to the scene's N × M cell box. Supply
an already-cropped/aligned image; non-regular print proportions are stretched
to the regular grid. An importer that knows the crop geometry may instead
pass explicit scene-pixel `x`, `y`, `width`, `height` for the **whole image's**
precomputed placement. The builder does not detect a crop, rotate the image,
or infer alignment. Unlock it to adjust it using native Tile controls.

**Player clients receive hidden Tile documents, including the image URL.**
Delete the reference Tile when corrections are complete. Likewise, SDX's
existing `hexData` journal is observer-visible: `showToPlayers: false` and
hidden notes control presentation, not confidentiality. Do not treat those
flags as private storage for licensed text or GM secrets; keep truly private
source data outside player-readable documents.

## Hexer JSON imports

GMs can use **Hexes → Import Hexer JSON** in the tray. The native file picker
previews scene counts and conversion warnings before any world writes. It accepts
schema-version-6 exports up to 20 MiB. No external service or dependency is needed.

```js
const hex = game.modules.get("shadowdark-extras").api.hex;
const result = await hex.importHexerMap(parsedHexerJSON, {
  sceneName: "Imported map", // optional; defaults to the export name
  view: false               // default true; view first scene on this client only
});
// { scenes: [{ layer, sceneId, sceneName, terrainTiles, featureTiles, records }],
//   warnings: ["..."] }
// Or launch the same interactive file picker:
await hex.openHexerImportDialog();
```

These GM-only methods require Hex Painter and reuse `hex.buildHexcrawl`.
Every import creates new scenes; replacement/overwrite is intentionally not an
option. All supported source data is validated before creating the first scene.
A storage failure can leave partial scenes; completed scene IDs are included in
the error. The interactive method returns `null` on cancellation/error.

- **Coordinates:** Hexer's `q,r` are zero-based offset column/row. SDX mints
  `num = (q + 1) * 100 + (r + 1)`. Width and height are limited to 1–99 by the
  published-number API. Pointy odd-row maps use `landscape: true`: axes transpose
  into flat-top odd columns, preserving adjacency. This is a **diagonal
  reflection**, not strictly a quarter-turn rotation. Flat maps are not transposed.
- **Layers:** each populated base layer (`surface`, `level_1`, `level_2`,
  `level_3`) becomes a separate scene. Source "Underdark" is a UI label, not a
  layer identifier. Detail-scale cells/entities are skipped with a warning.
- **Terrain:** forest/dense-forest/jungle → forest; grassland/plains → plains;
  hill → hills; mountain → mountains; marsh/bog → swamp; sea/lake/coast → water.
  Other known equivalents use the same biome families. Unknown/custom types
  retain their name as free-text terrain with the builder's fallback artwork.
  Custom art/colors are not imported. Missing cells are filled with plains with
  a warning. `hexSize` does not change SDX's fixed tile size or imply travel costs.
- **POIs and regions:** POIs become names, typed features, and a shipped icon;
  co-located POIs retain all labels/features but share one representative icon.
  Region membership becomes `zone`; overlapping names are joined with ` / `.
  Top-level Hexer notes are joined by hex and layer, retaining title/content as
  HTML-escaped note text, not rendered Markdown. `dmOnly` notes stay hidden;
  conditional discovery notes start hidden with a warning. When fog is enabled,
  notes and POIs in hidden/partial cells also start hidden; reveal them in the
  Hex Editor when appropriate. **Hidden is not confidential:**
  the shared journal is observer-visible, as explained above.
- **Networks:** normalized path x/y are already in units of `hexSize`, not raw
  pixels to divide again. Straight control-point segments are clipped against
  hex polygons, including intermediate cells and closed paths. Primary/secondary
  (and road/trail) map to roads; water/river map to rivers. Explicit non-joins
  prevent adjacent but unconnected routes merging. Off-map portions are clipped
  with a warning; singleton paths produce no segment. Styling and smoothing are
  not reproduced. Drawing Tools must be enabled to render saved networks.
- **Fog:** visible/explored become `hexFogRevealed`; partial/hidden remain covered.
  Intermediate source states are retained in hidden notes. `fogEnabled` is copied.
- **Loss reporting:** per-edge restrictions and cell connections are retained in
  hidden notes, not enforced for movement. Tokens, point-crawl data, unsupported
  path types, and detail scales produce explicit warnings instead of disappearing
  silently. Keep the original JSON; this is not a lossless round-trip editor.

## Regions and multi-level decor

| Method | Permission |
|---|---|
| `placeChangeLevelRegion(options)` | GM |
| `placeDungeonSurface(options)` | GM |
| `placeDungeonDecor(options)` | GM |

Decor source paths are allowlisted by the implementation. Arbitrary remote URLs
will be rejected.

## Spell macro helpers

Available after `ready`. The unidentified helpers are `isUnidentified`,
`getUnidentifiedName`, `showIdentifyDialog`, `identifyItem`, and
`showItemReveal`, and alongside those sit the Holy Weapon, Cleansing Weapon, and
Wrath helpers, plus Shapechanger apply and revert.

Feature-detect all of them. The ready-phase module can change independently of
the setup-phase API.

## Namespaces not promised as stable

`api.internal` holds generator and layout primitives SDX uses itself:
level-context and scene-level data helpers, cave layout and loop tracing, room
and mixed-layout algorithms, biome assignment, and cell-floor mapping.

Those can change without any compatibility promise. `api.templates` and
`api.dev` are implementation and development surfaces too, unless some specific
method is documented elsewhere.

## Safe integration pattern

```js
Hooks.once("ready", async () => {
  const api = game.modules.get("shadowdark-extras")?.api;
  if (!api?.getCreatureType) return;

  const type = api.getCreatureType(canvas.tokens.controlled[0]?.actor);
  console.log("Effective creature type:", type);
});
```

For a mutation:

```js
const api = game.modules.get("shadowdark-extras")?.api;
if (!game.user.isGM || !api?.generateDungeon) return;
await api.generateDungeon({ seed: "my-campaign-floor-1", roomCount: 12 });
```

Validate the active Scene and current Level before every map mutation.

---

**Related:** [Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons) ·
[Compendium Packs](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Compendium-Packs) ·
[Troubleshooting](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Troubleshooting)
