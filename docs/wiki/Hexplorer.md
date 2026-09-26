# Hexplorer

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home) ·
[Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons)

Hexplorer turns a hex-map cell into a small campaign record. Give it a name,
terrain, travel information, notes, locations, a player-visibility state, and
exploration rules. Players can then hover the parts you have revealed; Hex Fog,
procedural content, and Solo Hex Mode all use the same record.

![Edit Hex — Details has the player-visibility switch, optional hover image, name, zone, zone color, terrain, travel, notes, and features](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/hexplorer-edit-details.webp)

> **The two screenshots on this page are the real Hexplorer editor in Foundry.**
> Start with **Details** to make a usable hex, then open **Exploration** only
> when that cell needs fog, travel-trigger, or discovery rules.

---

## Before you start

1. As a GM, open **Configure Settings → Shadowdark Extras → Configure
   Features → SDX Tray Tools** and enable **Hex Tooltip / Hexplorer**. Reload if
   Foundry requests it.
2. Open a Scene with a **hexagonal grid**. Hexplorer does not run on square or
   gridless Scenes.
3. Expand the SDX Tray and click its **Information** button. This turns the
   hover tool on for the current canvas.

The Information button starts off whenever the canvas reloads, including after
changing Scenes. Turn it back on before you inspect or edit another map.

> **Button missing or disabled?** Check the feature manager first, then make
> sure the active Scene is hexagonal.

---

## The everyday workflow

1. **Turn on Information.** Hovering a cell now outlines it and shows its
   Hexplorer card. An empty cell gets a small **UNEXPLORED** card until you key
   it.
2. **Open the editor.** As a GM, double-click the cell. The **Edit Hex** window
   opens beside the pointer.
3. **Fill in Details.** Give the cell a useful name, terrain, and travel text.
   Add a zone when several cells belong together.
4. **Decide what is public.** Tick **Show to Players** only when players should
   be able to hover this cell. Notes and locations have their own visibility
   controls; see [Sharing a hex with players](#sharing-a-hex-with-players).
5. **Save.** Hover the cell again to check the card. With Hexplorer on, a small
   colored marker also shows what is recorded:
   - white: **Explored** or **Mapped**
   - teal: **Claimed**
   - green: **Show to Players**
6. **Find keyed cells.** Hold **Alt** while Hexplorer is active to highlight all
   records visible to the current user.

Right-click a cell for its content menu. GMs get the generators; players only
get discovered Journal links that they are allowed to open.

---

## Details: what goes on the hover card

The **Details** tab is the normal place to prep a hex.

### Visibility

**Show to Players** is the top-level gate. Without it, a player does not get a
hover card or the cell marker, even if you have filled out every other field.
GMs always see the full card.

### Image

Enter an image path or click the image button to choose one with Foundry's file
picker. When a hex is hovered, Hexplorer displays that image beside its card.
This is optional; leave it blank for a text-only record.

### Information

- **Hex Name** is the card's title. Use the map's printed number in the name if
  it helps the table find the same place, such as `4243. Horse Trainer`.
- **Zone** groups neighboring hexes under a region name, such as `Kyzian
  Steppes`.
- **Zone Color** controls the hover outline and the **Alt** overview highlight.
  It does not change the terrain tile.
- **Terrain** is the text players see on the card. It is also the field that
  Solo Hex Mode and imported hexcrawls use to describe generated terrain.
- **Travel** is free text for the table: `Open Terrain`, `Trackless forest`, a
  travel time, or whatever local rule you use.

### Notes

Click **+ Add** to make a short note. The eye on that row controls that note
alone:

- eye on: a player who can see the hex sees the note in the hover card;
- eye off: only the GM sees it.

This makes it practical to put a public travel clue and a GM-only encounter
prompt on the same hex.

### Features and Journal links

Click **+ Add** for a keyed location. Choose a type such as **Dungeon**,
**Settlement**, **Landmark**, **Ruins**, **Temple**, **Fort**, **Cave**, **Road**,
**Hazard**, **Resource**, or **Other**, then give it a label. It appears as a
feature on the hex card once discovered.

Choose **Journal** instead when the feature should open an existing Journal.
Pick the Journal, then optionally one specific page. Its eye toggle is the
feature's **discovered** switch. A discovered Journal link appears in the
cell's right-click menu for players.

A Journal link also needs ordinary Foundry permission. When a player opens one,
SDX asks the active GM to grant the minimum access needed for that Journal or
page. Do not rely on a feature toggle as a substitute for Journal permissions.

---

## Exploration: status, fog, and travel triggers

The **Exploration** tab stores rules. It is useful even before you enable fog,
but Hex Fog is the feature that acts on its reveal and roll-table settings.

![Edit Hex — Exploration has the status, Cleared and Claimed markers, per-hex fog reveal controls, and travel RollTable controls](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/hexplorer-edit-exploration.webp)

### Status and campaign flags

Set **Status** to **Unexplored**, **Explored**, or **Mapped**.

- On its own, status labels the hover card and adds the white marker for
  Explored or Mapped.
- With **Hex Fog** enabled, Explored and Mapped cells are clear of fog.
- **Cleared** is a checkmark on the card for a hex the party has dealt with.
- **Claimed** is a flag on the card and adds the teal marker.

These are deliberate record fields. They do not apply a rules effect by
themselves; use them to match the campaign's own exploration procedure.

### Per-hex fog reveal

Enable the separate **Hex Fog** tray tool before expecting these fields to do
anything during travel.

- **Reveal Radius** overrides the world default for this one cell. `-1` uses the
  default, `0` reveals only the entered cell, and `1` or more reveals that many
  rings outward.
- **Reveal Cells** adds named cells as well. Type comma-separated `i.j` values,
  such as `3.5, 4.6, 5.7`, or keep the Edit Hex window open and **Alt-click** a
  canvas cell to append it without typing coordinates.

A GM can also paint Hex Fog directly: **Ctrl-drag** reveals cells and
**Shift-drag** hides them. Right-click the Fog button after enabling fog to pick
a configured visual effect.

### Travel RollTables

A cell can roll a table when a token enters or travels through it while Hex Fog
is active:

1. Drag a RollTable into **Roll Table**, paste its UUID, or use the paste button
   after copying the UUID.
2. Set **Chance %** from 1 to 100. At 100, it rolls every time that cell is
   entered; leave the field at its default if that is what you want.
3. Tick **First Time Only** when that cell should record its first successful
   trigger and never roll the table again.

The token's starting cell does not roll just because it is leaving. A broken or
non-RollTable UUID is ignored and logged to the Foundry console, so check the
UUID first when nothing appears in chat.

---

## Generate content from a hex

These are the **GM-only right-click actions on the canvas**, not fields in the
Edit Hex window. With Hexplorer enabled, right-click a hex and choose one of
the four **Generate** actions. The final selection creates real Foundry
documents; it is not a preview or a temporary roll.

| Action | Picker sequence | What it creates | What returns to the source hex |
| --- | --- | --- | --- |
| **Generate Wilderness** | Choose a biome | One generated wilderness Journal page: regional name plus randomized biome encounters, landmarks, weather, and other Hexroll-derived material. | An undiscovered Journal feature. If the hex has no terrain yet, the selected biome also fills its terrain field. |
| **Generate Settlement** | Choose **Village**, **Town**, or **City** | One generated settlement Journal page: ruler, locations, tavern, NPCs, relationships, quest hooks, and a settlement-event roll. | An undiscovered Journal feature plus its Maphub/Watabou map parameters. The eye beside the feature opens the generated settlement-map viewer; it does **not** create a Foundry Scene. |
| **Generate Dungeon** | Choose **Temple**, **Tomb**, or **Dungeon**; then **Small** (4–6 rooms), **Medium** (7–10), or **Large** (11–15) | One keyed dungeon Journal page, including an uploaded schematic SVG where file upload is available, wandering-monster material, and room descriptions. | An undiscovered Journal feature. This is a keyed document, not a playable Scene. |
| **Generate Dungeon Map** | Choose the same type and size | A new playable square-grid dungeon Scene with generated floors, walls, and doors; one Overview Journal page; one page per actual room; and numbered SDX Journal Pins linked to those room pages. | Two undiscovered features: the overview Journal link and a GM-only **(Map)** Scene shortcut. |

### The important distinction: Dungeon vs. Dungeon Map

**Generate Dungeon** makes a single written dungeon key. Its room connections
and schematic are generated for the Journal page only.

**Generate Dungeon Map** first builds actual room geometry on a new Foundry
Scene, then writes the room key from that placed layout. The numbered room pins
therefore match the rooms on the map. Use this option when the party needs to
play on the dungeon in Foundry; use **Generate Dungeon** when a compact
prep/reference page is enough.

### What happens after generation

1. Wilderness, Settlement, and Dungeon create or reuse a Journal named
   `<Scene name> - Hexplorer` and add their generated page there. Dungeon Map
   instead creates its own dungeon Journal as well as its Scene.
2. SDX adds the generated result back to the same hex as an **undiscovered**
   feature. Right-click that hex later to reopen it; the GM sees all generated
   features, while players see only discovered Journal features.
3. Generation does **not** reveal the result to players. Use the feature eye /
   discovered control, **Show to Players**, and normal Journal permission when
   you are ready to share it. The Dungeon Map Scene shortcut remains GM-only.

Running an action again deliberately creates another page and another feature;
it does not replace or reroll the prior result. Keep the result you want, or
delete the unwanted generated page and its matching hex feature during prep.

---

## Solo Hex Mode

**Solo Hex Mode** is a separate SDX Tray tool, shown as a compass. It is for
letting GM token movement expand an otherwise empty hex map.

When it is on and a GM moves a token into an empty hex, SDX:

1. generates a colored terrain tile and a wilderness Journal page for the
   destination; and
2. does the same for each empty adjacent hex, choosing terrain from its
   neighboring biomes.

Existing tiles or Hexplorer records are left alone. Turn Solo Hex Mode **off**
before moving tokens for map prep or repositioning; those moves count as
exploration and can create content.

---

## Sharing a hex with players

A hex has three separate visibility decisions:

1. **Show to Players** — can the player see the cell's basic card at all?
2. **Note eye** — can the player see this particular note?
3. **Feature eye / discovered** — can the player see this particular feature?

Use them together. For example, reveal a hex's name, terrain, and travel now;
leave the ruined tower feature undiscovered; then reveal its Journal link after
the party finds the entrance.

Players can hover only records marked **Show to Players**. They cannot edit
cells or run generators. Their right-click menu contains only discovered
Journal links, and it stays empty if the cell has none.

---

## Troubleshooting

**The Information button is disabled.** The current Scene is square or gridless.
Switch to a hex-grid Scene.

**The editor does not open.** Hexplorer must be on, the cursor must be over the
canvas rather than another interface element, and only a GM can double-click to
edit.

**A player sees the hex but not a secret.** Check all three gates: **Show to
Players**, the note eye or feature discovery eye, and Journal permission for a
Journal feature.

**Fog does not clear when a token moves.** Enable **Hex Fog** for that Scene.
Then check that the token actually entered a new cell and that the record's
status or reveal fields say what you expect.

**A RollTable does not fire.** Check that the UUID resolves to a RollTable, the
chance allows a result, First Time Only has not already recorded that cell, and
the token entered rather than departed the cell.

**Do not edit `__sdx_hex_data__`.** It is the internal Journal where Hexplorer
keeps every Scene's records. Rename, delete, or hand-edit it only as part of a
deliberate world-data migration.

---

<details>
<summary>Technical reference</summary>

- Per-hex data is stored by Scene and hex offset in the internal
  `__sdx_hex_data__` Journal under the `shadowdark-extras.hexData` flag.
- The editor is `templates/sdx-hex-tooltip/hex-edit.hbs`; the data and canvas
  interactions are in `scripts/hex/HexTooltipSD.mjs`.
- Hex Fog reads the same records in `scripts/hex/SDXHexFogSD.mjs`. Its direct
  painting is **Ctrl-drag reveal** and **Shift-drag hide**.
- Solo Hex Mode reads and writes the same record seam in
  `scripts/hex/SoloHexMode.mjs`.
- Imported and generated hexcrawls seed records through
  `scripts/hex/HexcrawlBuilderSD.mjs`.

</details>

**Related:** [Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons) ·
[Feature Manager](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager) ·
[Journal Tools & Pins](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Tools-and-Pins) ·
[Easy Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Easy-Reference)