# Hexcrawls & Dungeons

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

The SDX Tray holds a complete prep workflow. Format a hex scene, paint or
generate terrain, place POIs, key the exploration data, add fog and coordinates,
then generate linked settlements or playable dungeons off any hex. A separate
Dungeons tab handles square-grid interiors, either painted by hand or generated.

---

> **Hexes, Dungeons, or Decor not showing?** They are gated by [**Feature Manager → SDX Tray Tabs**](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager#sdx-tray-tabs) — **Hexes**, **Dungeons**, and **Decor**. Decor also needs Hexes — the app shows *Also blocked because Hexes is disabled*.

## Hex workflow

### 1. Format the map

Open **Hexes → Format Map** before you place any terrain.

Choose the orientation and the width and height you want. Current formatting
sizes the scene to those grid dimensions with whole far-edge hexes. Foundry's
usual staggered half-hex behavior still shows up at the appropriate top or
bottom edge.

Formatting rewrites scene dimensions and grid. Duplicate an existing keyed scene
before you reformat it.

### 2. Choose a tile source

The Hexes tab keeps four sources apart: bundled default tiles, bundled colored
tiles, custom tiles, and symbol/POI assets.

Custom tile dimensions and placement save per client through the tray. Settle on
one consistent source and dimension set before any bulk generation.

### 3. Paint or generate

Click a terrain tile and paint hex cells by hand, or expand the procedural
generator, which takes a seed, map dimensions or the current formatted scene,
and biome, elevation, and vegetation parameters. Then Generate, or clear the
generated tiles.

A seed makes the layout repeatable given the same inputs. Clear touches only
tiles marked as SDX-generated, and it's still destructive enough to ask for
confirmation unless an authorized API caller forces it through.

<!-- Hex-crawl example image intentionally hidden pending replacement. -->

### 4. Place POIs

Switch to Symbols and place point-of-interest art. The tray tool rail adds
undo/redo, scale down and up, rotate left and right, and a horizontal mirror.

POI scale is remembered per client. Decor painting uses the same quick transform
controls.

### 5. Flatten

**Flatten Hexagons** consolidates the painted result into a lighter finished
scene. Treat it as a commit step and keep a duplicate around if you expect to
repaint individual tiles later.

---

## Hexplorer and hex exploration

[**Hexplorer**](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexplorer)
holds each cell's name, terrain, travel, notes, keyed locations, discovery, and
exploration state. It also covers player visibility, Hex Fog exceptions,
RollTables, generated wilderness and settlements, text dungeons, and playable
dungeon maps with room-matched pins.

Hex Fog and Solo Hex Mode are separate tray features that read these records.
The Hexplorer page has the full GM workflow and the player-visibility rules.

## Coordinates

The globe tool cycles four coordinate display states: hidden, margin and axis
labels, labels in cells, and Shadowdark zine mode.

**Configure Coordinates** controls fonts, colors, outline, opacity, label size,
numeric or letter axes, the modifier key, and click-label duration.

Zine mode uses staggered `000/100/200` column headings with two-digit rows, and
skips the cropped edge column on hex-column maps. That's built to match printed
zine keys.

## Solo Hex Mode

The compass tool switches on the module's solo exploration flow for supported
hex scenes. It reads Hexplorer and fog data. Turn it off before broad GM map
edits, or movement will advance exploration when you didn't want it to.

---

## Dungeon Painter

The Dungeons tab is square-grid territory, and it assumes a **100px grid** —
that figure is baked into generation and painting alike. Format or create the
Scene at 100px before you paint.

Three mode tabs sit at the top, and they change what a click and a drag do:

| Mode | Paints | GM only |
|---|---|---|
| **Rooms** | Floor tiles on grid cells; walls follow automatically | No |
| **Int. Walls** | Free-angle wall segments inside a room | Yes |
| **Doors** | Doors on the outer wall of a painted room | No |

Players only see this tab when **Allow Players to Paint Dungeons** is on, and
their changes commit through the connected GM.

### Rooms

This is the primary mode, and the only one that creates floor. Two tile grids
are shown: **Floor Tiles** and **Wall Tiles**. Pick one of each first.

| Gesture | Result |
|---|---|
| Drag | Fills the dragged rectangle with the selected floor tile, snapped to grid cells |
| Shift+Drag | Deletes floor tiles in the rectangle, and any doors inside it |

You never draw the outer wall yourself. **Walls auto-rebuild on release**: SDX
takes the complete set of painted floor cells on the current elevation Level,
walks its perimeter, and regenerates the wall visuals and the Foundry Wall
documents from scratch. Paint a second room touching the first and the shared
edge stops being a wall on its own.

The wall tile grid deliberately hides any tile whose filename contains
`vertical`. SDX picks the vertical variant itself for vertical wall runs, so
custom wall art should be added as a matched pair —
`mywall_horizontal.webp` and `mywall_vertical.webp` — and only the horizontal
one will appear in the tray.

The **background** dropdown sets what sits under the floor tiles: `None`, a flat
Black / White / Gray, or any image in `assets/Dungeon/backgrounds/`. It is not
available in Int. Walls mode.

### Interior walls

Interior walls are the free-angle tool, and they are the one part of the tab
that is **GM-only**. They are not tied to the grid: drag in any direction, at any
angle, and SDX creates a rotated wall-textured Drawing along the drag, plus a
single Foundry Wall on the same line unless **No Foundry Walls** is on.

Because they're independent of the floor cells, the auto-rebuild does not touch
them. They survive a repaint of the room around them, and equally they are not
removed when you erase the floor underneath.

They survive **generation** too. Generating over a level clears SDX's own output
and reports how many hand-drawn walls it kept — it will not silently destroy work
you drew by hand. That can leave walls positioned for an old layout floating over
a new one; **Clear SDX Dungeon** is the way to remove them deliberately.

Doors work differently here than in Doors mode. This mode shows two grids,
**Interior Wall Tiles** and **Doors**, and you need a selection in both before a
door will go in:

| Gesture | Result |
|---|---|
| Drag | Draws an interior wall segment at the dragged angle |
| Click on an interior wall | Cuts the wall in two and inserts a door at that point |
| Shift+Click on an interior door | Removes the door and restores the unbroken wall |

> **A click that does nothing means no door tile is selected.** Inserting a door
> requires a tile chosen from the **Doors** grid further down the panel; without
> one, clicking an interior wall is silently ignored. Scroll down and pick a door
> before you start cutting.

Interior wall segments and the doors cut into them are Drawings, so they respond
to **Wall Shadows** like the outer walls do.

### Doors

Doors mode places doors on the **outer** wall generated by Rooms mode, so it
needs painted floor to work against. Pick a door tile, then:

| Gesture | Result |
|---|---|
| Click on a cell edge | Places a door on that wall segment |
| Shift+Click on a door | Removes it |
| Shift+Drag | Removes every door inside the rectangle |

A door becomes a real Foundry door Wall, so it opens, closes, and blocks sight
the way any door does. SDX applies the door tile as its texture and swaps in the
horizontal or vertical art to match the segment's orientation. Doors also
register as entrances for the wall rebuild, so re-painting the room keeps its
doorways rather than sealing them.

### Reskin With SDX Assets

**Reskin With SDX Assets** rebuilds a map you already have — a purchased
battlemap, a Dungeondraft export, anything with walls — using SDX floor and wall
tiles instead of its original art.

It does not duplicate anything. Foundry's own right-click → **Duplicate Scene**
already carries walls, doors, lights and journal notes across, and so does SDX's
own scene export. Duplicating first is still worth it — the reskin doesn't delete
walls, but it does clear the background image and add a lot of documents.

Pick a floor tile, a wall tile and a door tile, then press the button. It works
on the whole scene — you do not click anything on the map.

**It floors rooms, not rock.** On a map with a walled outer boundary, the solid
rock between the rooms is technically enclosed too — flooring it would fill the
whole footprint into one slab. SDX tells them apart by doors: a space a door
opens into is a room. Everything else is left as it is.

That means a walled-off area with no door into it is skipped. If you have one,
**Paint Room Floor** adds it in a click. Erring this way is deliberate — a
missing room is one click to fix, a floored map is a Clear and a restart.

The confirmation says how many squares and how many separate areas it found, so
you can check the numbers look right before anything happens.

What it changes, all of it listed in a confirmation prompt before anything
happens:

| | |
|---|---|
| Floor | One SDX-textured polygon per room, traced to the wall line exactly |
| Walls | SDX wall art drawn **along each existing wall**, at that wall's own angle |
| Doors | Re-skinned with the selected door tile |
| Background | The scene's background image is cleared, its path saved to a scene flag |
| Lights, notes, journals | Untouched — they need no conversion |

**No walls are deleted.** The map keeps the collision it already had, and the SDX
art is drawn on top of those exact lines. That means the art and the collision
can never disagree, and it means a reskin costs you none of the wall work already
in the scene.

### Diagonal walls and floor edges

Nothing is snapped to the grid. Both halves follow the map's real geometry.

**Walls.** Each wall gets its own rotated, textured Drawing running end to end
along the original segment — the same primitive the **Int. Walls** tool uses. Wall
art is never rebuilt from the painted cell perimeter, because a perimeter can only
produce axis-aligned segments and would turn every angled wall into a staircase.

**Floor.** The floor is traced from the walls themselves, as one filled polygon
per room, so its edge is the wall line exactly. It is not a grid of square tiles.
That matters most on angled walls, where a square-tile floor overhangs the wall
by up to half a cell in places and falls short in others.

**You do not need to tidy the walls first.** Maps are rarely drawn to a
tolerance, and walls that look joined often are not. SDX closes three kinds of
imperfection itself: endpoints within 4px are treated as one point, a wall ending
part-way along another becomes a proper junction, and loose ends up to half a
cell apart are bridged. None of that creates or moves a Wall — it only decides
where floor goes, and the result is still checked against the flood fill before
anything is painted.

Any room it still cannot close gets square floor tiles instead, and the
notification says how many. So a stubborn corner comes out with stepped edges
rather than with no floor at all.

If nothing traces, the whole floor falls back to tiles and the notification says
so — the old behaviour, kept rather than painting a shape SDX could not verify.

> **A leak aborts the whole thing.** If the walls around your click don't fully
> enclose it, the flood escapes and SDX stops without changing anything rather
> than repainting the entire canvas. Close the gap, or click inside a smaller
> sealed room. Commercial maps very often have small gaps where a wall meets a
> door frame.

Walls shorter than 5px are skipped — stray slivers left by map editors would
otherwise become invisible specks of wall art.

Leave **Wall Shadows** off for a first pass on a large map. The shadow filter is
applied one Drawing at a time, and on a map with hundreds of walls it is by far
the slowest part of the run.

### Paint Room Floor

Fill one room at a time, with a different tile in each.

Pick a floor tile, press **Paint Floor**, then click inside a room: it gets the
tile, fitted to its walls. Pick another tile, do another room.

**Erase Floor** is its own button, no modifier key:

| Gesture | Result |
|---|---|
| **Click** inside a walled area | Its SDX floor is removed, stopping at the walls |
| **Drag** | The squares the cursor passes over are cleared |

**Undo Last Change** reverses any of these. Either tool stays on until you press
it again, so you can work through a whole map without returning to the tray
between rooms; pressing the other button switches tools.

**You cannot paint past a wall.** SDX works out the room's shape from the walls
and fills exactly that — there is no brush to keep inside the lines and no way to
spill into the next room. This is the same shape-fitting the reskin does, so the
result matches whether you reskin a map wholesale or fill it a room at a time.

The room comes from the walls every time, never from whatever floor happens to be
there already. That matters after a bad fill: a leftover shape covering half the
map does not become "the room", the walls around your click do.

You do not need to reskin first. Clicking a room that has no SDX floor yet gives
it one; clicking a room that already has one changes its tile.

If a room's walls have a gap wider than half a square, SDX will say it could not
work out that room's shape. Close the gap on the Walls layer and click again.

### Clear SDX Dungeon

**Clear SDX Dungeon** removes everything SDX put on the scene at the current
elevation Level — floor, stair and clutter tiles, generated walls and doors, wall
art and the backdrop, and generated decor lights. It counts them first and lists
the totals by type before it deletes anything.

It is deliberately narrower than an undo: it removes what SDX created and nothing
else. On a reskinned map the SDX floor tiles and wall art go, while the map's own
walls, doors, lights and journal notes stay, because SDX never created those. If
the reskin cleared a background image, clearing restores it.

Walls you drew yourself on the Walls layer are never touched.

**This is the only action that removes interior and reskinned walls.** Generating
over a level no longer deletes them — it reports how many it kept. Painting never
did. If you want hand-drawn walls gone, this button is the way, and its dialog
counts them before anything happens.

### Collapsing the tile lists

Every tile heading — **Floor Tiles**, **Wall Tiles**, **Interior Wall Tiles**,
**Doors**, **Door Tiles** — is a toggle. Click one to roll that grid up and get
it out of the way; the caret turns to show which are closed.

Sections stay closed while you work. The tray redraws constantly, and the
collapsed state survives that, so rolling up the floor list to reach the walls
is a one-time click rather than something you redo after every action.

### Deleting walls

Every SDX wall is two documents on two layers — a **Drawing** carrying the art
and a **Wall** carrying the collision. Deleting one now deletes the other, from
whichever layer you started on and by whatever means: the Delete key, the context
menu, a select-all. You no longer have to find and remove both halves by hand.

This applies to the walls you author — interior walls and reskinned walls. Walls
around painted **Rooms** are not paired, because they have no identity to pair:
they're regenerated wholesale from the floor cells every time you paint, so
deleting one is already undone by the next rebuild. Erase the floor instead.

Walls drawn before this existed carry no pairing and still need both halves
removing. Re-draw them if you want the linked behaviour.

### Options

These three apply across all modes.

| Option | Effect |
|---|---|
| **No Foundry Walls** | Draw the wall art but create no Wall documents. Visual-only maps, or maps where you intend to wall by hand |
| **Wall Shadows** | Applies a TokenMagic `dropshadow2` filter to wall Drawings. Needs `tokenmagic` active |
| **Curved Walls** | Rounds the generated wall loops instead of stepping them squarely, mainly for cave-shaped floor sets |

**Flatten Level** / **Unflatten Level** consolidate the painted result at one
elevation Level into a single image, and reverse it. They're hidden in Int.
Walls mode.

## Procedural dungeon generator

Expand **Procedural Dungeon** and choose:

| Control | Examples |
|---|---|
| Layout | Rooms & Corridors, Caves, Mixed, Classic/rot.js |
| Biomes | Random/selected room themes |
| Rooms / density / branching | Layout scale and connectivity |
| Room size | Small-to-large bias |
| Stairs Up / Down | Generated transition markers |
| Clutter / decor lights | Dressing density |
| Walls | Texture, color, width, shadows, curved cave boundaries |
| Seed | Repeatable layout |

Generation runs against the active Scene at the current elevation Level. It
clears only SDX-generated documents at that level before rebuilding, then lays
down floors, walls, doors, biome props, stairs, decor, lights, and Regions
according to the options you picked.

![A generated dungeon Scene with a complete room-and-corridor layout](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/dungeon-generator-result.webp)

The public API hard-caps the especially expansive values, rooms and stairs and
clutter among them. See
[Developer API](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Developer-API).

## Biomes and decor

The Biome Editor enables and disables built-in biomes, adds custom biome
definitions, overrides built-in keys, and resets custom data.

The Decor tray accepts individual files, whole folders, URLs the UI allows, and
imported Dungeondraft object packs. **Manage Dungeondraft Decor Packs** is where
you preview, enable, hide, and maintain those.

## Multi-level dungeons

On Foundry v14 elevation Levels, generation and flattening respect the current
Level. SDX can create per-level generated documents, `defineSurface` Regions,
`changeLevel` stair Regions, level-aware decor, and template and effect
elevation metadata.

Switch to the Level you intend before every generation call. A stair graphic
becomes a working transition once its Region links the correct two Level IDs.

---

## Troubleshooting

**5×5 became a larger map.** Update SDX and format again on a duplicate scene.
Older format logic added buffer cells.

**Generated tiles use the wrong dimensions.** Reformat the scene, then confirm
the active tile set before generating.

**Hex tooltip button is disabled.** The active scene isn't on a supported hex
grid.

**A hex entry RollTable does not fire.** Check its UUID, chance, and first-only
state, then confirm the token actually entered or traveled through that grid
cell.

**Dungeon content and map room counts differ.** Use the playable hex-dungeon
flow, which derives text from placed geometry, instead of generating text and
map independently.

**Generation changed the wrong elevation.** Activate the Level you meant first,
and restore from your duplicate if the damage is done.

**Clicking an interior wall doesn't insert a door.** Nothing is selected in the
**Doors** grid below the wall tiles. Interior doors need both a wall tile and a
door tile chosen.

**Interior walls stayed behind after erasing the room.** They're independent
Drawings, not part of the floor cell set, so the auto-rebuild never removes
them. Delete them as Drawings.

**Painted tiles don't line up with the grid.** The painter assumes a 100px grid.
Re-create the Scene at 100px rather than rescaling a painted one.

**Reskin says the fill reached the edge of the canvas.** The walls around the
point you clicked have a gap. Find it with the Walls layer — the usual culprit is
a door frame or a corridor mouth — close it, and try again.

**Reskin painted a room but not the one next door.** They're separated by a solid
wall rather than a door, so the flood stopped there. Click again inside the other
room.

**Clear SDX Dungeon says it found nothing.** It only looks at the current
elevation Level. Switch to the Level the content is on and try again.

**Clear left walls behind on a reskinned map.** Those are the map's own walls,
which SDX drew art along but never created. Delete them on the Walls layer.

**Generating said it kept some hand-drawn walls.** It did, on purpose — interior
and reskinned walls survive generation so hand work is never silently destroyed.
Use Clear SDX Dungeon if you want them gone.

**Painting after a reskin didn't wall the reskinned rooms.** Correct: reskinned
floor is not a wall source, because the map it came from already has walls. Only
floor you paint by hand generates a perimeter.

**Reskin floor has stepped edges in one room.** That room's outline could not be
closed, so it fell back to square tiles; the notification counts those cells. SDX
already merges near-miss endpoints, splits T-junctions and bridges gaps up to
half a cell, so a room that still fails has a larger break. Find it on the Walls
layer, then Clear SDX Dungeon and reskin again.

**The whole floor came out as grid cells.** Nothing traced at all — usually the
walls form no closed rooms. The notification says so explicitly.

**Reskin says it found no enclosed areas.** Nothing on the scene is closed in by
walls, so there is no floor to lay. Check the Walls layer.

**Part of the map was left untouched.** Either that part isn't enclosed — its
walls have a gap — or no door opens into it, so SDX didn't read it as a room.
Use **Paint Room Floor** to add it, or close the gap and reskin again.

**The whole map filled in solid, rooms and rock alike.** Reskin an older SDX
version did this by flooring every enclosed space. Clear SDX Dungeon, update, and
reskin again; the current version only floors spaces a door opens into.

---

**Related:** [Map Generators](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Map-Generators) ·
[Journal Tools & Pins](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Tools-and-Pins) ·
[Developer API](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Developer-API)
