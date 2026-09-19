# Hexplorer

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home) ·
[Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons)

Hexplorer gives each cell on a hex map its own campaign record: a hover card,
notes and keyed locations, player discovery, generated content, and the
exploration settings used by Hex Fog.

---

## Where to find it

1. As a GM, enable **Hex Tooltip / Hexplorer** in **Configure Settings →
   Shadowdark Extras → Configure Features → SDX Tray Tools**. Reload when
   Foundry asks.
2. Open a Scene with a hexagonal grid.
3. Expand the SDX Tray and press the **Information** button on its handle rail.

The button is unavailable on square and gridless Scenes. Hexplorer starts off
when the canvas reloads, so press the button again after changing Scenes.

## Key a hex

1. Turn Hexplorer on, then hover a cell to inspect its record. The cell receives
   a zone-colored highlight.
2. Double-click a cell as the GM to open **Edit Hex**.
3. On **Details**, set a name, Zone and color, Terrain, Travel, and an optional
   image. Add table notes and keyed features.
4. For a feature, choose its type and label. Choose **Journal** to link a world
   Journal and, if needed, one specific page.
5. On **Exploration**, set the status, campaign flags, and any Hex Fog or
   RollTable exceptions.
6. Save, then hover the cell again to check the player-facing result.

The canvas shows small markers while Hexplorer is on: white for **Explored** or
**Mapped**, teal for **Claimed**, and green for **Show to Players**. Hold
**Alt** to highlight every recorded cell the current user may see.

## What players can see

**Show to Players** makes the cell's hover record available to players. It does
not reveal every child entry automatically:

- Each note has its own eye toggle.
- Each feature has its own discovered toggle.
- A Journal feature opens only after the GM grants the player access to the
  linked Journal or selected page.

That lets a GM show terrain and travel information while keeping a dungeon,
landmark, or prepared note hidden until it is discovered.

## Explore with Hex Fog

**Hex Fog** is a separate tray feature. Enable it if travel should reveal map
cells or trigger entries from the records you set up here.

- **Status:** Explored and Mapped cells are clear of Hex Fog.
- **Reveal Radius:** `-1` uses the world default, `0` reveals only the entered
  cell, and a positive value reveals that many rings around it.
- **Reveal Cells:** add specific extra `i.j` cells, separated by commas. With
  Edit Hex open, **Alt-click** a canvas cell to add it.
- **RollTable:** paste or drag a RollTable UUID. Set a chance and choose
  **First Time Only** when the result should not repeat for that cell.

The GM can also paint fog directly: **Ctrl-drag** reveals cells and
**Shift-drag** hides them. Right-click the Fog button to choose an optional
shader effect after fog is enabled.

## Generate content from a hex

Right-click a cell as the GM to open its context menu:

- **Generate Wilderness** makes a keyed wilderness Journal page for a selected
  biome.
- **Generate Settlement** creates a named settlement page with its generated
  people, locations, factions, quests, and map link.
- **Generate Dungeon** creates a text-only keyed dungeon page.
- **Generate Dungeon Map** creates a playable square-grid Scene, an overview and
  room Journal pages, and numbered SDX pins that match those rooms.

Generated content is attached back to the source hex. Discovered Journal
features appear in the same right-click menu for the players who can see them;
the playable Scene shortcut is GM-only.

## Solo Hex Mode

Solo Hex Mode uses the same records. When its compass button is on, GM token
movement onto an empty cell creates terrain and wilderness content for that
cell and its empty neighbors. Turn it off before moving tokens around for map
prep, or those moves can populate the map.

## Troubleshooting

**The Information button is disabled.** The active Scene does not use a
hexagonal grid.

**Players cannot see a note or location.** Check **Show to Players**, then the
note's eye toggle or the feature's discovered toggle.

**A RollTable never fires.** Check the UUID, chance, first-time-only state, and
that the token entered the cell while Hex Fog is enabled.

**Do not edit `__sdx_hex_data__`.** It is SDX's internal record Journal. Rename,
delete, or hand-edit it only as part of a deliberate world-data migration.

**Related:** [Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons) ·
[Feature Manager](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager) ·
[Journal Tools & Pins](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Tools-and-Pins)