# Shadowdark Extras Wiki

A game-master toolkit and automation suite for
[Shadowdark RPG](https://www.thearcanelibrary.com/pages/shadowdark) on Foundry
VTT.

The [README](https://github.com/DimitroffVodka/shadowdark-extras#readme) is the
short version. This wiki is the manual: where each tool lives, what it touches,
and the buttons that rewrite documents you care about.

---

## Start here

Fresh install? Read these three, in order.

1. **[Installation & Setup](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Installation-and-Setup)**
   covers requirements, the five manifest dependencies, and a checklist for your
   first world.
2. **[The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools)**
   documents the launcher on the left edge of the canvas. You will use it
   constantly.
3. **[Combat & Damage](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Combat-and-Damage)**
   explains damage cards, targeting, weapon bonuses, and what the
   automation-forward defaults will commit on your behalf.

The module is broad. Almost every feature stands on its own, though, so keep the
defaults, switch off whatever your table doesn't use, and pick the rest up when
a session actually calls for it.

---

## At the table

| Page | What it covers |
|---|---|
| [The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools) | Party display, party actors, marching order, formations, lights, and tray navigation |
| [Combat & Damage](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Combat-and-Damage) | Enhanced damage cards, target/range rules, typed damage, weapon bonuses, and attack macros |
| [Spell Automation](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Spell-Automation) | Spell Activity configuration, templates, auras, saves, damage, effects, focus, durations, summons, and item macros |
| [Animation FX](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX) | Sequencer/JB2A presets, sounds, per-item overrides, torch and level-up effects |
| [Inventory & Trading](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Inventory-and-Trading) | Containers, identification, bulk selection, inventory styles, coins, and player transfers |
| [Carousing](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Carousing) | Original and Expanded modes, custom tables, costs, outcome application, and the log |
| [Canvas & Table Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Canvas-and-Table-Tools) | Token toolbar, light tracker, drawing tools, SDX Roller, scene navigation, overlays, and scene transfer |
| [Theater of the Mind](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Theater-of-the-Mind) | ToM presentation scenes, arena grids, video overlays, the nav bar, and the stage — with [live demo](https://dimitroffvodka.github.io/shadowdark-extras/docs/demo/theater-of-the-mind.html) |

## Characters and creatures

| Page | What it covers |
|---|---|
| [Character Sheets](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets) | Enhanced headers, HP waves, themes, journal notes, sheet locks, Medkit, party actors, and custom item sheets |
| [NPCs & Effects](https://github.com/DimitroffVodka/shadowdark-extras/wiki/NPCs-and-Effects) | NPC inventory and creature types, custom NPC item sheets, conditions, mysterious casting, and the effects library |

## Maps and campaign prep

| Page | What it covers |
|---|---|
| [Map Generators](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Map-Generators) | Realm, city, village, cave/glade, dungeon, and dwelling generators with Foundry scene import |
| [Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons) | Hex formatting and painting, procedural terrain, POIs, fog, coordinates, dungeon painting, biomes, decor, and multi-level tools |
| [Journal Tools & Pins](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Tools-and-Pins) | Multi-page character notes, placeable notes, journal pins and folders, map-note conversion, and narration |
| [Easy Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Easy-Reference) | ProseMirror inserts for NPC cards, item cards, roll tables, checks, and dice |

## Reference

| Page | What it covers |
|---|---|
| [Installation & Setup](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Installation-and-Setup) | Supported versions, dependencies, permissions, updates, and disabling |
| [Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference) | Visible settings, configuration menus, defaults, scopes, and reload requirements |
| [Compendium Packs](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Compendium-Packs) | The four bundled SDX packs and safe customization practices |
| [Troubleshooting](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Troubleshooting) | Common symptoms, causes, fixes, and bug-report information |
| [Developer API](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Developer-API) | `game.modules.get("shadowdark-extras").api` and the stable automation surface |

---

## Three things worth knowing up front

Expand the tab on the left edge of the canvas. That is the SDX Tray, and it
swaps between Scenes, Party, Pins, Notes, Hexes, Dungeons, and Decor depending
on your role and the scene grid. A vertical tool rail sits beside it and
launches most of the remaining session utilities.

Automation is stored on the item itself. A spell's **Activity** tab and a
weapon's **Bonuses** tab describe what happens when that item gets used, so you
set the table-wide behavior in world settings and then override whichever
individual items break the pattern.

Map tools write to whatever scene and elevation level the GM currently has open.
Formatting, painting, procedural generation, imports, fog, Regions, multi-level
work: all of it lands on the active canvas. Check the scene first. Several of
those operations delete documents.

---

## Getting help

- **Bugs and feature requests:** [GitHub issues](https://github.com/DimitroffVodka/shadowdark-extras/issues)
- **Community help:** [Shadowdark Extras Discord](https://discord.gg/ZBtQ9ub7Mn)
- **Release history:** [CHANGELOG.md](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/CHANGELOG.md)
- **License:** [LICENSE](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/LICENSE)
