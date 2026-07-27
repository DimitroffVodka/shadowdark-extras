# Character Sheets

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

Shadowdark Extras extends player and NPC sheets without changing the underlying
Shadowdark actor types. Most enhancements are world-controlled; Dark Mode is
per client.

---

## Enhanced player header

With **Enable Enhanced Header** on, a Player sheet shows an interactive summary
of:

- current/max HP with a health bar;
- AC;
- ability modifiers;
- Luck;
- XP progress and level;
- actor portrait and header background.

Actors can use their own image/video background. The GM can also enable one
world default for every actor that has no custom header.

Clicking supported values opens the normal SDX/Shadowdark adjustment workflow;
the header is not merely decorative.

![An enhanced Player sheet with portrait HP wave, summary header, and themed tabs](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/enhanced-character-sheet.png)

## HP quick adjustment

Current HP controls accept direct edits and quick relative changes. NPC sheets
also receive the compatible quick-control behavior. Changes still require actor
permission, and combat automation may update the same value through damage
cards.

## HP Waves

The HP wave is a portrait overlay whose height follows the actor's remaining
health. Open **Configure HP Waves** to:

- enable or disable the effect;
- choose the default color;
- add ancestry-specific colors.

The shipped default is enabled with a red wave. Use a solid, high-contrast color
if the portrait art is visually busy.

## Sheet Style Editor

The GM-only editor controls the shared visual system:

- outer sheet frame;
- panels and stat boxes;
- border slices/width/repeat;
- header, title bar, tabs, navigation, labels, and value colors;
- actor-name shadow and weight;
- tab gradients;
- a live preview.

These values are stored as hidden settings because the editor owns them as one
coherent theme. Dark Mode loads a client theme without erasing the GM's saved
custom settings.

**Match NPC Sheet Theme to Player Sheets** applies the same frame/header/panel
language to NPC sheets while retaining the system's NPC layout.

## Quick conditions

Player and NPC sheets receive condition toggles. The **Conditions theme**
setting chooses:

- Shadowdark;
- 5e;
- Parchment;
- Stone Tablet;
- Leather Bound;
- Iron & Rust;
- Moss & Decay;
- Blood & Shadow.

Changing the theme re-renders open Player sheets. The condition documents remain
the same; only the control presentation changes.

## Renown

Player sheets include a Renown value for faction reputation, fame, or another
campaign-scale standing. Current carousing outcomes can also apply a configured
Renown delta. Decide at the table what the number means; SDX stores and displays
it but does not impose a faction model.

## Journal Notes

With **Enable Journal Notes** on, the simple Notes tab becomes a multi-page
journal:

- page sidebar;
- create, select, rename, and remove pages;
- rich-text editing;
- quick inserts for information, warnings, quests, loot, and NPC notes.

See [Journal Tools & Pins](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Tools-and-Pins).

## Sheet locks

The sheet padlock protects configured fields from player edits. **Configure
Sheet Locks** chooses what the locked state covers:

- XP, coins, gems, HP, abilities, and Luck;
- equipped state;
- inventory add/remove;
- spells and talents;
- class, ancestry, background, deity, alignment, and languages;
- Active Effects.

The configuration is global; the lock state is per sheet/actor. GMs retain
authority. A locked field gives a warning instead of silently discarding the
player's edit.

## Medkit

The Medkit icon is available to actor owners when **Show Medkit Icon** is on.
It checks owned Spells, Scrolls, and Wands against registered source packs.

| Item | Update behavior |
|---|---|
| Spell | Compared to and replaced from the matching source document |
| Scroll | Keeps the physical item; refreshes SDX enhancement flags from its referenced spell |
| Wand | Keeps the physical item/use data; refreshes enhancement flags from referenced spells |

Review the preview before applying. The GM can run the same logic over the
entire world with **Medkit: Scan All Actors**.

## Add Coins

With **Enable Add Coins Button** on, the Coins area receives a quick adjustment
control. Positive values add and negative values subtract. Transfers are a
separate workflow covered in [Inventory & Trading](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Inventory-and-Trading).

## Spellbook pack filter

The Shadowdark Spell Book dialog receives a compendium selector. It scans
installed Item packs containing Spells and lets the user show one source or all
sources. This changes the browser list, not the actor's existing spellbook.

## Custom SDX item sheets

SDX registers default sheets for several Shadowdark item types:

| Item type | Tabs/features |
|---|---|
| **Potion** | Details, Activity, Description, Macro; damage/healing/effects |
| **Background** | Description and Advancement; grant configured items immediately or at a level |
| **Class Ability** | Details, Description, Macro |
| **NPC Attack** | Attack details, typed damage, ranges, Description, Source |
| **NPC Feature / NPC Spell** | Activity, Description, Macro |
| **NPC Special Attack** | Activity, Description, Macro |

These are data editors as well as presentation sheets. See
[Spell Automation](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Spell-Automation) for Activity configuration.

## Ammunition and staves

When a ranged weapon can use more than one owned ammunition item, SDX can prompt
for the ammunition to consume and remember the preferred choice.

Staff weapons can open **Staff Spells Configuration** to manage attached spells
and restore their uses. The stored spell UUIDs must remain valid.

## Party sheet

SDX's Party actor has its own Members, Inventory, Travel, and Description tabs.
It is documented with the tray because it coordinates the same roster:
[The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools).

---

## Troubleshooting

**Header or layout did not change.** Reload after changing the enhanced-header
setting. Hard-refresh if art or CSS still looks stale.

**Player cannot edit a field.** Check the sheet's padlock state and the global
Sheet Lock configuration.

**Medkit cannot match a Scroll/Wand.** Repair its referenced Spell UUID.

**An ancestry color is ignored.** Confirm the stored ancestry name matches the
override and that HP Waves are enabled.

**Potion/NPC item opens the system sheet instead.** Check the sheet selection in
the item window and reload after enabling/updating SDX.

---

**Related:** [Inventory & Trading](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Inventory-and-Trading) ·
[Spell Automation](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Spell-Automation) ·
[The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools)
