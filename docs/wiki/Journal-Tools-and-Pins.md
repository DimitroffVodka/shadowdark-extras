# Journal Tools & Pins

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

SDX wires campaign text to the canvas through character journals, notes on
placeable objects, styled journal pins, folders, map-note conversion, and
read-aloud narration.

---

> **Pins, Notes, or journal menus missing?** Pins and Notes tabs are under [**Feature Manager → SDX Tray Tabs**](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager#sdx-tray-tabs); narration, display cards, and icon picker are under [**Advanced & Hidden Features → Journal & Reference**](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager#journal-reference).

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

With **Enable Notes on placeables and Notes tab in tray** on, six kinds of
document gain a Notes control in their sheet header: **Tokens, Actors, Tiles,
Walls, Ambient Lights, and Ambient Sounds**. Those six are the whole list —
Drawings and Regions have no Notes control and never appear in the tray.

![A token configuration window's header bar — the SDX Notes button, a highlighted sticky-note icon, sits between Sheet and Medkit](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/placeable-notes-token-header.webp)

Write rich text and save. The tray's **Notes** tab lists every annotated object
on the current scene, where you can expand or collapse the note, pan to the
object, open it for editing, rename the note label, toggle player visibility,
and delete it. Right-clicking a row is a shortcut for the edit control.

![The tray's Notes tab — an expanded note on the token "Bazogo" reading "Bazogo Backstory", with collapse, hide-from-players, rename, delete, and pan-to-object controls on the row](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/placeable-notes-tray-tab.webp)

### Type groups

The tab is grouped into folders, one per type, always in the same order:
**Tokens, Actors, Tiles, Walls, Lights, Sounds**. The headers are fixed — you
cannot add, rename, reorder, or nest them, and a type with no notes on the
scene is left out rather than shown empty. Click a header to fold it; each
group's number is how many rows it is showing you.

Within a group, rows are sorted by name the way you would count them, so
*Room 2* comes before *Room 10*.

### A Token note and its Actor note are two different notes

A note lives on the document you opened, so a Token and the Actor behind it can
each carry their own — a note about *this* goblin on *this* map, and a note
about the goblin in general. Both show up, in their own groups, and the group
tells you which is which even when they share a name. Renaming, hiding, or
deleting one never touches the other.

An Actor with several linked tokens on the scene still gets a single Actor row.
Panning from it centres on one of its tokens.

Notes are metadata on the document. Delete a placeable and its note goes with
it; an Actor's note stays with the Actor, and its row leaves the tab when the
last token representing it is off the scene.

### Sharing a note with players

Every note is GM-only until you say otherwise. The visibility control on a row
shares that one note; a player then sees it in their own Notes tab, whether or
not they own the underlying document.

What a player gets is deliberately narrow:

- only the rows explicitly shared with them, and group counts that reflect only
  those rows, so a count cannot hint at a note they were not shown;
- the note without its GM secret blocks;
- read and pan only. Editing, renaming, sharing, and deleting stay with the GM,
  and that is enforced by the command rather than by hiding the buttons.

Sharing a Token's note does not share the Actor's note behind it. Notes made
before Actor-level sharing existed are the one exception: an Actor note that was
being shared through its token stays shared until you toggle it, and toggling it
records the decision on the Actor from then on.

## Journal pins

The pin tool creates an SDX canvas marker. Link it to a Journal, to a specific
Journal page, or leave it unlinked as a tooltip or label.

From the Pins tab you can search, pan or ping, bring players to the location,
open and edit the pin, copy and paste style, duplicate it, flip it between
GM-only and player-visible, require line of sight, and remove or delete it.

For the full walkthrough — every setting in the editor, folders, conversion, and
a live browser demo — see **[Journal Pins](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Pins)**. The rest of this section is a short pointer; the detail lives there and the demo is at **[Journal Pins demo](https://dimitroffvodka.github.io/shadowdark-extras/docs/demo/journal-pins.html)**.

> **Try it right now, no Foundry needed**
>
> Open the **[Journal Pins demo](https://dimitroffvodka.github.io/shadowdark-extras/docs/demo/journal-pins.html)**. Drag pins on the parchment, hover for tooltips, right-click for Pan / Ping / Bring, and open any pin's **Pin Style Editor** — the same fifty-setting editor you use in Foundry.

![The Pin Style Editor preview with shape, ring, and color controls](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/pin-style-editor.webp)

## Pin Style Editor

Edit one pin, or the world defaults. The marker takes a shape (circle, square, diamond, pointy hex, flat hex, or image), a content type (page number, symbol, custom icon, text, or none), its own colors and ring, a label with its own font and background, tooltip title and body text with independent font sizes, and visibility rules (GM-only, requires vision, above fog, hide tooltip).

The full field-by-field guide is on the **[Journal Pins](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Pins)** page. Open the **[Pin Style Editor in the demo](https://dimitroffvodka.github.io/shadowdark-extras/docs/demo/journal-pins.html)** and click any pin's palette button to see every section live.

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

Search reaches matches inside collapsed folders. See **[Journal Pins → Folders](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Pins#folders)** and try dragging pins between folders in the **[demo](https://dimitroffvodka.github.io/shadowdark-extras/docs/demo/journal-pins.html)**.

## Convert Foundry Map Notes

Use **Notes→Pins** for every Map Note on the current scene, or the convert
control on a single note.

The new pin carries over position, the Journal or page link, the text label, and
the icon path, tint, and size.

Choose a target folder and decide whether the original Note gets deleted.
Deletion is optional so you can compare the converted result first.

Converted pins start **GM-only**, whatever the source Note allowed — Map Notes
are prep material, so nothing you convert reaches players until you reveal it
with the pin row's visibility control. The
**[demo's Notes→Pins button](https://dimitroffvodka.github.io/shadowdark-extras/docs/demo/journal-pins.html)** simulates this — pick a count and a target folder.

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
uses the DocumentSheetV2 header-controls hook. Drawings and Regions are not
supported and will not show the control.

**A note is missing from the Notes tab.** The tab only ever lists the active
scene. An Actor's note needs a token representing it on that scene; a note on a
document belonging to another scene is not listed, and a row left over from a
scene you have since left does nothing but refresh the list.

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

**Related:** [Journal Pins](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Pins) · [Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons) ·
[Easy Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Easy-Reference) ·
[Character Sheets](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets)
