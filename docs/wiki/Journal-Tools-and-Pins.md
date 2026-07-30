# Journal Tools & Pins

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

SDX wires campaign text to the canvas through character journals, notes on
placeable objects, styled journal pins, folders, map-note conversion, and
read-aloud narration.

---

## Character Journal Notes

With **Enable Journal Notes** on, a Player's Notes tab becomes a small
multi-page journal.

Use the page sidebar to create and navigate entries. The editor gives you normal
ProseMirror formatting plus quick blocks for information, warning, quest, loot,
and NPC.

The content stays actor data throughout. Disabling the enhanced UI won't
deliberately delete saved notes, but back up important actor data before you
switch note systems.

## Notes on placeables

With **Enable Notes on placeables and Notes tab in tray** on, the configuration
windows for Tokens, Tiles, Walls, Ambient Lights, and Ambient Sounds all gain a
Notes control.

Write rich text and save. The tray's **Notes** tab lists every annotated object
on the current scene, where you can expand or collapse the note, pan to the
object, rename the note label, toggle player visibility, and delete it.

These notes are metadata attached to the placeable. Delete the placeable and its
note goes with it.

## Journal pins

The pin tool creates an SDX canvas marker. Link it to a Journal, to a specific
Journal page, or leave it unlinked as a tooltip or label.

From the Pins tab you can search, pan or ping, bring players to the location,
open and edit the pin, copy and paste style, duplicate it, flip it between
GM-only and player-visible, require line of sight, and remove or delete it.

## Pin Style Editor

Edit one pin, or the world defaults. The marker itself can be a Font Awesome
icon, an image, or custom text, and it takes its own color and tint, a
background and border, and a shape drawn from circle, square, pointy hex, or
flat hex. Size and scale are adjustable, while **Fit to hex grid** snaps the
whole thing to the grid. The rest covers content and behavior: label and tooltip
text, title and body font sizes, player visibility, line-of-sight behavior, and
where the display name comes from.

![The Pin Style Editor preview and its tooltip, shape, size, and ring controls](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/pin-style-editor.webp)

### Pin name source

| Choice | Display name |
|---|---|
| **Auto** | Journal/page → tooltip title → canvas label |
| **Journal/Page** | Linked document name |
| **Tooltip** | Tooltip title |
| **Canvas Label** | Marker label |

Auto skips placeholder names like "New Pin" when it can find a better source.

### Pixel-perfect hit testing

Irregular transparent images do better with **Pixel perfect on Pins** enabled.
The alpha threshold decides which pixels count as clickable: lower values accept
more translucent pixels, higher values demand more opaque ones.

Experimental, and it costs real CPU. Plain shape hit testing stays the cheap
default.

## Pin folders

The GM can build nested folders in the Pins tab. Drag pins in and out, drag
folders to reorder or nest them, collapse and expand, and give each one a color
and a Font Awesome or image icon.

Folder scope can be:

| Scope | Definition appears |
|---|---|
| **Scene** | Only on the current scene |
| **World** | On every scene, marked with a globe |

Pins stay scene-owned even inside a world folder. A world folder is a shared
organizational definition that shows up everywhere, while each pin keeps living
on its own scene.

Search reaches matches inside collapsed folders.

## Convert Foundry Map Notes

Use **Notes→Pins** for every Map Note on the current scene, or the convert
control on a single note.

The new pin carries over position, the Journal or page link, the text label, and
the icon path, tint, and size.

Choose a target folder and decide whether the original Note gets deleted.
Deletion is optional so you can compare the converted result first.

## Generated room pins

The playable hex-dungeon builder creates one pin per generated room, linked to
the matching room Journal page. Use that path whenever the room number on the
map and the room key have to stay synchronized.

## Journal narration

With **Enable Journal Narration** on, rendered Journal blockquotes get a
narration toolbar. Put read-aloud text in a blockquote, render the page, and
present it from the added control.

## Easy Reference

The ProseMirror Easy Reference menu inserts live NPC, Item, RollTable, check,
and dice syntax. See
[Easy Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Easy-Reference).

---

## Troubleshooting

**Placeable Notes button is absent.** Enable the setting and reload. Foundry v14
uses the DocumentSheetV2 header-controls hook.

**A note saved blank.** Reopen after updating SDX. Current builds read the real
ProseMirror field path.

**Pin has an unhelpful name.** Set Pin Name to Auto or Tooltip, and give it a
real title.

**World folder is empty on another scene.** Expected. The folder definition is
world-wide, and the pins stay on their source scene.

**Map Note conversion duplicated markers.** You kept the originals. Delete them
once you've verified the converted pins, or use the conversion dialog's
delete-originals option next time.

**Image pin is hard to select.** Try pixel-perfect mode, or a lower alpha
threshold. For map-sized hex art, use Fit to hex grid.

---

**Related:** [Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons) ·
[Easy Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Easy-Reference) ·
[Character Sheets](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets)
