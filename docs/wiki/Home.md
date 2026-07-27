# Shadowdark Extras — Wiki

A game-master toolkit and automation suite for
[Shadowdark RPG](https://www.thearcanelibrary.com/pages/shadowdark) on Foundry
VTT.

This wiki is the full manual. The [README](https://github.com/DimitroffVodka/shadowdark-extras#readme) is the feature
overview; the pages below explain where each tool lives and how to use it.

---

## Start here

If you have just installed Shadowdark Extras, read these in order:

1. **[Installation & Setup](Installation-and-Setup.md)** — requirements,
   dependencies, and a practical first-world checklist.
2. **[The SDX Tray & Party Tools](Tray-and-Party-Tools.md)** — the persistent
   left-side launcher for most of the module.
3. **[Combat & Damage](Combat-and-Damage.md)** — damage cards, targeting,
   weapon bonuses, and combat defaults.

The module is broad, but almost every feature is independent. You can keep the
defaults, disable the parts you do not use, and learn the rest as you need it.

---

## At the table

| Page | What it covers |
|---|---|
| [The SDX Tray & Party Tools](Tray-and-Party-Tools.md) | Party display, party actors, marching order, formations, lights, and tray navigation |
| [Combat & Damage](Combat-and-Damage.md) | Enhanced damage cards, target/range rules, typed damage, weapon bonuses, and attack macros |
| [Spell Automation](Spell-Automation.md) | Spell Activity configuration, templates, auras, saves, damage, effects, focus, durations, summons, and item macros |
| [Animation FX](Animation-FX.md) | Sequencer/JB2A presets, sounds, per-item overrides, torch and level-up effects |
| [Inventory & Trading](Inventory-and-Trading.md) | Containers, identification, bulk selection, inventory styles, coins, and player transfers |
| [Carousing](Carousing.md) | Original and Expanded modes, custom tables, costs, outcome application, and the log |
| [Canvas & Table Tools](Canvas-and-Table-Tools.md) | Token toolbar, light tracker, drawing tools, SDX Roller, scene navigation, overlays, and scene transfer |

## Characters and creatures

| Page | What it covers |
|---|---|
| [Character Sheets](Character-Sheets.md) | Enhanced headers, HP waves, themes, journal notes, sheet locks, Medkit, party actors, and custom item sheets |
| [NPCs & Effects](NPCs-and-Effects.md) | NPC inventory and creature types, custom NPC item sheets, conditions, mysterious casting, and the effects library |

## Maps and campaign prep

| Page | What it covers |
|---|---|
| [Map Generators](Map-Generators.md) | Realm, city, village, cave/glade, dungeon, and dwelling generators with Foundry scene import |
| [Hexcrawls & Dungeons](Hexcrawls-and-Dungeons.md) | Hex formatting and painting, procedural terrain, POIs, fog, coordinates, dungeon painting, biomes, decor, and multi-level tools |
| [Journal Tools & Pins](Journal-Tools-and-Pins.md) | Multi-page character notes, placeable notes, journal pins and folders, map-note conversion, and narration |
| [Easy Reference](Easy-Reference.md) | ProseMirror inserts for NPC cards, item cards, roll tables, checks, and dice |

## Reference

| Page | What it covers |
|---|---|
| [Installation & Setup](Installation-and-Setup.md) | Supported versions, dependencies, permissions, updates, and disabling |
| [Settings Reference](Settings-Reference.md) | Visible settings, configuration menus, defaults, scopes, and reload requirements |
| [Compendium Packs](Compendium-Packs.md) | The four bundled SDX packs and safe customization practices |
| [Troubleshooting](Troubleshooting.md) | Common symptoms, causes, fixes, and bug-report information |
| [Developer API](Developer-API.md) | `game.modules.get("shadowdark-extras").api` and the stable automation surface |

---

## The three systems to understand first

**The SDX Tray is the front door.** Expand the tab on the left side of the
canvas. It changes between Scenes, Party, Pins, Notes, Hexes, Dungeons, and
Decor, and its vertical tool rail opens most session utilities.

**Automation lives on the item.** A spell's **Activity** tab and a weapon's
**Bonuses** tab define what should happen when that item is used. World settings
control the shared behavior; item configuration controls the exception.

**Map tools modify the active scene.** Formatting, painting, procedural
generation, imports, fog, Regions, and multi-level work all act on the scene and
level currently open on the GM's canvas. Confirm the active scene before
committing a map operation.

---

## Getting help

- **Bugs and feature requests:** [GitHub issues](https://github.com/DimitroffVodka/shadowdark-extras/issues)
- **Community help:** [Shadowdark Extras Discord](https://discord.gg/ZBtQ9ub7Mn)
- **Release history:** [CHANGELOG.md](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/CHANGELOG.md)
- **License:** [LICENSE](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/LICENSE)
