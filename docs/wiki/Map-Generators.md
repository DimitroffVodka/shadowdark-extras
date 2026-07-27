# Map Generators

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

The GM-only Map Generators launcher embeds six Watabou generators and can
capture their current output into a Foundry Scene.

---

## Open the launcher

Click the map-location icon on the SDX Tray. Choose:

| Generator | Best for | Structured import |
|---|---|---|
| **Realm** | Regional coastlines, terrain, and settlements | Scene background |
| **City** | Walled cities, districts, roads, and rivers | Scene background |
| **Village** | Small settlements and farmland | Scene background |
| **Cave / Glade** | Caverns or natural clearings | Aligned square grid and walls when geometry is available |
| **Dungeon** | One-page room-and-corridor maps | Aligned grid, walls/doors, and map notes |
| **Dwelling** | Houses, taverns, manors, and towers | Multi-level v14 Scene, per-floor background/walls, stair Regions |

![The Maphub launcher with all six bundled map generators](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/map-generator-launcher.png)

The generators and credits remain Watabou's; SDX supplies the Foundry wrapper,
local bundled builds, capture, alignment, and document creation.

## Generate before importing

Use the embedded generator normally:

1. Randomize or adjust its settings.
2. Wait for the map to finish drawing.
3. Close any open generator context menu.
4. Click **Import Scene** in the generator window header.

Import captures the state currently visible in the generator. It does not later
remain linked to that generator window.

## Why the bundled local build matters

Foundry cannot read or capture an external cross-origin iframe's canvas and
geometry. For the six import-capable types, SDX therefore serves the bundled
generator from the Foundry origin.

The **Settlement Maps: Use Local Maphub** setting remains for other/view-only
source choices, but these six import workflows are local regardless: without
the bundled files, SDX refuses a misleading external fallback that it could not
capture.

## Generic image import

Realm, City, and Village normally import as a new Scene whose background is the
captured map. Add Foundry walls, lights, notes, and tokens afterward.

The new Scene receives a unique timestamped name. The original generator remains
unchanged.

## Cave / Glade import

When live geometry and its render transform are available, SDX:

- captures the current map;
- rescales/crops it so a generator cell equals an integer Foundry grid size;
- anchors cell zero to the Foundry grid origin;
- transforms the cave wall coordinates through the same mapping;
- creates the Scene and walls.

If the generator geometry is unavailable, SDX warns and may fall back to the
image-only path.

## Dungeon import

Before capture, SDX asks the bundled One Page Dungeon generator for its current
JSON. That keeps the wall/note data synchronized with the displayed map.

Import then:

- temporarily forces an axis-aligned render;
- captures and normalizes the image/grid;
- parses walls, doors, and room notes from that current JSON;
- maps every coordinate through the same scale/crop;
- creates the new Scene.

Wait until the dungeon is fully loaded. If JSON export or the render transform
cannot be read, reopen the generator rather than importing a partially
initialized window.

![A one-page dungeon imported as a Foundry Scene with its grid, walls, doors, and room notes](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/dungeon-generator-result.png)

## Dwelling import

The Dwelling generator has the richest import. When its live controller is
available, one Foundry v14 Scene is created with:

- Basement, Ground Floor, and numbered upper-floor Levels as applicable;
- a background per Level;
- per-floor room walls;
- regular doors at room connections;
- open passages left as gaps;
- change-level Regions based on the generator's actual stair connectivity;
- an Up/Down chooser for spiral stairs;
- the round tower enclosed correctly.

The importer normalizes every floor to the same building coordinate system.
If structured dwelling data cannot be read, it can degrade to a generic
image-scene import and warns that walls/levels are missing.

## After import

Review the Scene before activating it for players:

1. Grid type, size, and scene dimensions.
2. Background visibility on every elevation Level.
3. Wall/door alignment at 200–400% zoom.
4. Stair Region destinations.
5. Token size and movement.
6. Notes and journal links.
7. Lighting and player vision.

Duplicating the imported Scene before manual cleanup gives you a clean recovery
point.

## Generator images and permissions

Capture uploads an image into Foundry's user-data storage. The GM client needs
file upload permission and a writable data source. Browser download settings do
not replace Foundry upload permissions.

---

## Troubleshooting

**Generator is blank.** Confirm the bundled files exist, hard-refresh, and
reopen it. City/Village/Dwelling use the bundled raw builds.

**Import Scene is disabled or absent.** Only the GM can import. Wait for the
window to finish rendering.

**Dungeon says JSON could not be exported.** Reopen the generator and wait
until the dungeon canvas is interactive.

**Walls drift from the background.** Update SDX; current Cave/Dungeon imports
normalize the cell size and origin together. Do not change the imported grid
size afterward.

**Dwelling has one image but no Levels.** Structured dwelling geometry was not
available and import fell back. Check the console, then reopen and regenerate.

**Foundry cannot save the captured image.** Check the GM's file-upload
permission and the server data directory.

---

**Related:** [Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons) ·
[Canvas & Table Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Canvas-and-Table-Tools)
