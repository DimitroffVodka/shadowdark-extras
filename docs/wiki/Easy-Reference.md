# Easy Reference

[← Wiki home](Home.md)

Easy Reference adds an SDX dropdown to Foundry's ProseMirror editor so journals,
descriptions, and other rich-text fields can insert live game references without
memorizing enricher syntax.

---

## Enable categories

Five world settings are on by default:

- NPC cards;
- item cards;
- RollTables;
- checks/requests;
- dice rolls.

Disable a category to remove it from the editor menu for everyone.

## NPC cards

Choose an NPC document, then insert:

```text
@DisplayNpcCard[Actor.uuid]{Name}
```

The detailed variant is:

```text
@DisplayNpcCardDetailed[Actor.uuid]{Name}
```

The compact card is best for inline encounters and rumors; the detailed card is
better for a full keyed-area stat reference.

## Item cards

Insert an interactive item reference:

```text
@DisplayItemCard[Item.uuid]{Name}
```

The stored UUID can point to a world item, owned item, or compendium item. If the
source is deleted or moved, the reference no longer resolves.

## RollTable cards

Insert:

```text
@DisplayTable[RollTable.uuid]{Name}
```

The rendered card can roll the referenced table subject to the user's
permissions.

## Ability checks and requests

The custom dialog asks for:

- DC;
- ability;
- check or request.

It inserts Shadowdark's enriched syntax:

```text
[[check 12 str]]
[[request 15 wis]]
```

Quick entries are available for STR, DEX, CON, INT, WIS, and CHA.

## Dice rolls

Enter a custom Roll formula:

```text
[[/r 2d6+3]]
```

Quick buttons cover d4, d6, d8, d10, d12, and d20.

## Working with UUIDs

- References remain stable when a document is renamed.
- Moving a world document between folders is safe.
- Deleting/recreating a document changes its UUID.
- Copying a document creates a new UUID; existing journal syntax still points
  at the original.
- A module-compendium UUID remains stable only while that source document
  continues to ship under the same pack/document id.

## Narration

Journal blockquotes receive a narration control when **Enable Journal
Narration** is on. Use blockquotes for read-aloud text, then trigger the
narration presentation from the rendered Journal page.

---

## Troubleshooting

**Menu is missing.** Confirm you are editing with ProseMirror and the desired
Easy Reference category is enabled.

**Card displays a missing document.** The saved UUID no longer resolves. Insert
the current source document again.

**Player cannot roll the table.** Give the player observer permission to the
RollTable/pack or have the GM roll it.

**Check does not enrich.** Use a valid Shadowdark ability key in lowercase and a
numeric DC.

---

**Related:** [Journal Tools & Pins](Journal-Tools-and-Pins.md) ·
[Compendium Packs](Compendium-Packs.md)
