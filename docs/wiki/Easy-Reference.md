# Easy Reference

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

Easy Reference adds an SDX dropdown to Foundry's ProseMirror editor, so
journals, descriptions, and other rich-text fields can insert live game
references without anyone at the table memorizing enricher syntax.

---

> **Cards or reference menus missing?** They live under [**Feature Manager → Advanced & Hidden Features → Journal & Reference**](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager#journal-reference) — **Display Cards** and **Easy Reference Menu**.

## Enable categories

Five world settings, all on by default: NPC cards, item cards, RollTables,
checks and requests, and dice rolls. Disable one and it leaves the editor menu
for everybody.

No SDX menu at all? Check the editor first. That field is probably not
ProseMirror, which is a faster thing to rule out than working through the
settings list.

## NPC cards

Choose an NPC document, then insert:

```text
@DisplayNpcCard[Actor.uuid]{Name}
```

The detailed variant:

```text
@DisplayNpcCardDetailed[Actor.uuid]{Name}
```

Reach for the compact card in inline encounters and rumors, and save the
detailed one for a full keyed-area stat reference where you genuinely want the
whole block sitting on screen.

## Item cards

Insert an interactive item reference:

```text
@DisplayItemCard[Item.uuid]{Name}
```

That UUID can point at a world item, an owned item, or a compendium item. Move
or delete the source and it goes dead.

## RollTable cards

Insert:

```text
@DisplayTable[RollTable.uuid]{Name}
```

The rendered card rolls the table. Permissions still apply, so a player who
can't roll it needs observer access on the RollTable or its pack. Failing that,
the GM rolls it.

Deleted source, dead card. Insert the current document again.

## Ability checks and requests

The custom dialog asks for a DC, an ability, and whether you want a check or a
request. Out comes Shadowdark's enriched syntax:

```text
[[check 12 str]]
[[request 15 wis]]
```

Quick entries cover STR, DEX, CON, INT, WIS, and CHA. A check that renders as
plain text instead of an enriched button has picked up a capitalized ability key
or a non-numeric DC somewhere along the way. Lowercase the key. Check the
number.

## Dice rolls

Enter a custom Roll formula:

```text
[[/r 2d6+3]]
```

Quick buttons handle d4, d6, d8, d10, d12, and d20.

## Working with UUIDs

Four rules will save you a pile of broken references later on. Renaming is safe.
Moving a world document between folders is safe too, and neither one disturbs
the UUID. Delete and recreate that same document, though, and it comes back with
a new UUID that nothing points at. Copying does the same thing, leaving your
existing journal syntax aimed at the original. Compendium UUIDs from a module
hold only as long as that source document keeps shipping under the same pack and
document id, which is worth knowing before you build a campaign on top of one.
[Compendium Packs](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Compendium-Packs)
lists what SDX ships and how to copy a document into the world so your edits
survive an update.

## Narration

Journal blockquotes get a narration control when **Enable Journal Narration** is
on. Blockquote the read-aloud text, render, present.

The rest of the journal tooling lives in
[Journal Tools & Pins](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Tools-and-Pins),
which covers pins, folders, placeable notes, and the multi-page character
journal that replaces the plain Notes tab.
