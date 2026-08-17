# Shadowdark Extras

[![Foundry VTT: v14+](https://img.shields.io/badge/Foundry-v14%2B-informational)](https://foundryvtt.com/)
[![Shadowdark: v3.0.0+](https://img.shields.io/badge/System-Shadowdark-purple)](https://www.thearcanelibrary.com/pages/shadowdark)
[![Latest release: 6.11.0](https://img.shields.io/badge/Release-6.11.0-blue)](https://github.com/DimitroffVodka/shadowdark-extras/releases/latest)

Shadowdark Extras is a toolkit and automation suite for running **Shadowdark RPG** in [Foundry Virtual Tabletop](https://foundryvtt.com/). It adds table-facing tools, combat and spell automation, richer sheets and inventories, campaign-prep utilities, visual effects, and a large collection of optional enhancements.

The README is the short version. The **[Shadowdark Extras Wiki](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)** is the user manual, with step-by-step workflows, settings, permissions, troubleshooting, and API details.

If you enjoy the module, you can [support development on Ko-fi](https://ko-fi.com/kaleth). For questions, feature requests, and bug reports, join the [Shadowdark Extras Discord](https://discord.gg/ZBtQ9ub7Mn) or open a [GitHub issue](https://github.com/DimitroffVodka/shadowdark-extras/issues).

<img width="3584" height="1184" alt="Shadowdark Extras banner" src="https://github.com/user-attachments/assets/173d6548-314e-42a6-9e8c-cbd2ca2a4150" />

[![Ask for feature / report bug](https://img.shields.io/badge/Ask_for_feature_/_report_bug-Join_Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/ZBtQ9ub7Mn)

## Current compatibility

Current module release: **6.11.0**

| Component | Minimum | Verified |
| --- | --- | --- |
| Foundry VTT | v14 | v14 |
| Shadowdark system | v3.0.0 | v4.0.6 |

The module id is `shadowdark-extras`.

## [Installation](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Installation-and-Setup)

### Foundry package installer

In Foundry, open **Add-on Modules → Install Module**, paste the manifest URL, and click **Install**:

```text
https://github.com/DimitroffVodka/shadowdark-extras/releases/latest/download/module.json
```

Then enable **Shadowdark Extras** in **Game Settings → Manage Modules** for your Shadowdark world.

### Required dependencies

These modules are declared as manifest requirements:

| Module | Purpose |
| --- | --- |
| **socketlib** (`socketlib`) | Player-to-GM actions, transfers, and authoritative multiplayer updates |
| **libWrapper** (`lib-wrapper`) | Compatibility-safe wrappers around Foundry and Shadowdark behavior |
| **Sequencer** (`sequencer`) | SDX animation playback and persistent visual effects |
| **portal-lib** (`portal-lib`) | Interactive placement workflows, including summons |
| **TokenMagic FX** (`tokenmagic`) 0.7.5.1+ | Template and token filter effects |

### Recommended integrations

| Module | Purpose |
| --- | --- |
| **JB2A** (`JB2A_DnD5e`) | Visual files used by the bundled Animation FX presets |
| **psfx** | Sound files referenced by bundled weapon and spell presets |

**Automated Animations is optional.** Shadowdark Extras has its own Sequencer-based Animation FX engine. When Automated Animations is also enabled, SDX coordinates with it and suppresses duplicate effects for workflows SDX already owns.

## First steps in a new world

1. Enable the module and its required dependencies.
2. Open **Configure Settings → Shadowdark Extras → [Configure Features](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager)**. Feature Manager is GM-only; save changes and reload when Foundry asks you to.
3. Expand the **[SDX Tray](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools)** at the left edge of a scene. Its tabs and tool rail provide the main entry points for the module.
4. Review **[Configure Combat Settings](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference)**, then test one attack before enabling more automation.
5. Open a spell, scroll, wand, potion, or NPC ability and review its **[Activity](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Spell-Automation)** tab before relying on automatic damage, effects, templates, or summons.
6. Open **[Configure Animations](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX)** and preview an effect with a selected token. JB2A is needed for most visual presets, while psfx is only needed for their sounds.
7. Duplicate important scenes before formatting maps, generating dungeons, importing scenes, flattening levels, or running cleanup tools. These workflows can create or delete Foundry documents.

See **[Installation & Setup](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Installation-and-Setup)** for the complete requirements, permissions, update, and first-world checklist.

## Highlights in 6.11.0

- **[Feature Manager](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager)** provides a GM-only master switchboard for SDX Tray tabs, tray tools, and hidden automation. Disabling a feature prevents its owned menus, settings, hooks, wrappers, sockets, templates, and UI from initializing; stored world data is preserved. Changes require a reload.
- **[Party tokens](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools)** can be created from the current selection and recalled later, carrying the party roster with them.
- **[Journal Pins](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Tools-and-Pins)** support composable icon styles and a default Highlight-on-Hover treatment with tint and border.
- **[Theater of the Mind](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Theater-of-the-Mind)** adds arena grids, inline video overlays, stacked multi-select overlays, scene navigation, and a live browser demo.
- **[Combat](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Combat-and-Damage) and [animation](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX) fixes** include v14 marching-mode repairs, terminal animation disable behavior, safer chat-card interpolation, duplicate-effect cleanup, and improved torch/weapon animation cleanup.

The full release history is in **[CHANGELOG.md](CHANGELOG.md)**.

## What the module adds

### [Table and party tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools)

- **SDX Tray:** client-scoped scene, token, party, pin, note, hex, dungeon, and decor views.
- **[Party actors and Party View](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools):** Members, shared Inventory, Travel, camping/rest, weather, party tokens, XP/coin awards, light synchronization, and formation placement.
- **[Marching Mode and Formation Spawner](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools):** coordinate party movement and place selected tokens in formations.
- **[Light Source Tracker](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Canvas-and-Table-Tools):** inspect and control active light sources for characters and party actors.
- **[SDX Roller](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Canvas-and-Table-Tools):** cinematic group checks with participants, opposing contestants, configurable DCs, banners, and recap cards.
- **[Drawing Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Canvas-and-Table-Tools):** sketch and stamp tools with per-client styling, timed erase, and a configurable hold-to-draw key.

Read **[The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools)** and **[Canvas & Table Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Canvas-and-Table-Tools)**.

### [Combat and spell automation](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Combat-and-Damage)

- **[Enhanced damage cards](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Combat-and-Damage)** with target selection, typed damage breakdowns, multipliers for immunity/resistance/vulnerability, Apply controls, auto-apply options, and scrolling combat text.
- **[Configurable target requirements and range checks](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Combat-and-Damage)** with end-of-workflow untargeting.
- **[Weapon Bonuses](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Combat-and-Damage)** for conditional hit and damage bonuses, critical bonuses, damage types, on-hit effects, and item macro triggers.
- **[Spell, scroll, wand, potion, and NPC Activity configuration](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Spell-Automation)** for targeted effects, measured templates, target-defense saves, damage/healing, conditions, durations, auras, summons, item-giving, alignment, and macros.
- **[Native focus tracking](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Spell-Automation)** with linked effect cleanup, per-turn damage/healing, duration tracking, and optional auto-roll focus checks.
- **[Damage types and effects](https://github.com/DimitroffVodka/shadowdark-extras/wiki/NPCs-and-Effects)** with resistances, immunities, vulnerabilities, source requirements, casting blockers, and break-on-damage effects.

Read **[Combat & Damage](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Combat-and-Damage)** and **[Spell Automation](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Spell-Automation)**.

### [Animation FX](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX)

SDX includes a native Sequencer-driven Animation FX engine with:

- A GM **[Configure Animations](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX)** master list for spells/scrolls/wands, weapons, NPC attacks, equipped weapon sprites, torches, and level-up effects.
- **[Regex name matching](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX)** with most-specific-match resolution and one-time default preset seeding for new worlds.
- **[Per-item overrides](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX)** on Spell, Scroll, and Wand Activity tabs, with inherited preset previews, media thumbnails, sound audition, and canvas preview.
- **[Equipped weapon and shield sprites](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX)** with positioning, scale, rotation, idle animation, and PIXI filter controls.
- Optional **[Automated Animations coordination](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX)** without duplicate SDX-owned effects.

Read **[Animation FX](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX)**.

### [Sheets, NPCs, and inventory](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets)

- **[Enhanced Player headers](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets)** with HP, AC, abilities, Luck, XP, level, portrait waves, and custom image/video backgrounds.
- **[Interactive HP adjustment and sheet enhancements](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets)** including quick conditions, renown, multi-page character journal notes, sheet locking, sheet themes, and optional NPC theme matching.
- **[Medkit](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets)** updates owned Spells, Scrolls, and Wands from registered source packs; GMs can scan every actor in the world.
- **[Custom item sheets](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets)** for Potion, Background, Class Ability, NPC Attack, NPC Feature, NPC Spell, and NPC Special Attack items.
- **[NPC inventories and effects](https://github.com/DimitroffVodka/shadowdark-extras/wiki/NPCs-and-Effects)** including coins, creature types, mysterious casting, typed attacks, and reusable ActiveEffect content.
- **[Containers and trading](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Inventory-and-Trading)** with nested storage and coins, native item identification, multi-select/bulk delete, inventory styling, transfers, player trading, party inventory, and quick coin adjustments.
- **[Per-user ammunition and staff spell management](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets)**.

Read **[Character Sheets](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets)**, **[NPCs & Effects](https://github.com/DimitroffVodka/shadowdark-extras/wiki/NPCs-and-Effects)**, and **[Inventory & Trading](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Inventory-and-Trading)**.

### [Carousing](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Carousing)

The shared Carousing workflow supports **Original** and **Expanded** modes, editable tables, linked Foundry RollTables, pipe-separated imports, copper-precise wealth calculations, configurable coins-plus-gear wealth, applied XP/Luck/Renown effects, narrative notes, player visibility controls, and a persistent GM-only Carousing Log.

Read **[Carousing](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Carousing)**.

### [Maps, hexcrawls, and dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Map-Generators)

- **[Six bundled, GM-only Watabou generators](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Map-Generators):** **Realm, City, Village, Cave/Glade, Dungeon, and Dwelling**.
- **[Structured map imports](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Map-Generators)** for Cave/Glade and Dungeon maps, including aligned grids, walls, doors, and room notes where geometry is available.
- **[Dwelling imports](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Map-Generators)** as a Foundry v14 multi-level Scene with per-floor backgrounds, walls, doors, and change-level Regions when structured data is available.
- **[Hex map tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons):** formatting, terrain painting, seeded procedural generation, POIs, flattening, Hexplorer records, settlement and dungeon generation, keyed room pins, exploration fog, coordinate overlays, and solo hex mode.
- **[Square-grid dungeon tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons):** painting and procedural generation with rooms, caves, mixed layouts, rot.js styles, biomes, decor, lights, stairs, Regions, multi-level support, and flatten/unflatten tools.

These tools operate on the active Scene and elevation Level. Read **[Map Generators](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Map-Generators)** and **[Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons)** before generating or importing content.

### [Theater of the Mind and journal tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Theater-of-the-Mind)

- **[Theater of the Mind](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Theater-of-the-Mind):** broadcast fullscreen image/video scenes, arena grids, 20 built-in video overlays, stacked overlays, folder-based scene navigation, and player token placement on arena scenes.
- **[Journal Pins](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Pins):** styled canvas markers, folders, labels, tooltips, visibility rules, pixel-perfect selection, map-note conversion, and live pan/ping/bring actions.
- **[Placeable Notes](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Tools-and-Pins):** rich-text notes on Tokens, Actors, Tiles, Drawings, Walls, Lights, Sounds, and user-managed Regions, collected into fixed type groups in the tray. Token and Actor notes remain separate exact sources; transient or rebuild-owned Drawing/Region sources stay excluded by exact ownership evidence.
- **[Easy Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Easy-Reference):** ProseMirror inserts for NPC cards, item cards, RollTable cards, ability checks/requests, and dice rolls.
- **[Scene Export/Import](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Canvas-and-Table-Tools):** portable ZIP archives containing scene data, embedded documents, referenced assets, journals, actors, and SDX hex data where available.

Try the **[Theater of the Mind demo](https://dimitroffvodka.github.io/shadowdark-extras/docs/demo/theater-of-the-mind.html)** or **[Journal Pins demo](https://dimitroffvodka.github.io/shadowdark-extras/docs/demo/journal-pins.html)**. The full workflows are in **[Theater of the Mind](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Theater-of-the-Mind)**, **[Journal Tools & Pins](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Journal-Tools-and-Pins)**, and **[Easy Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Easy-Reference)**.

## [Feature Manager](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager)

Feature Manager is the safest way to tailor SDX to a table that does not need every subsystem:

1. Open **Configure Settings → Shadowdark Extras → Configure Features** as a GM.
2. Leave the defaults enabled, or disable individual Tray tabs, Tray tools, or entries under **Advanced & Hidden Features**.
3. Save **Feature Settings** and reload when Foundry prompts you.
4. Re-enable a feature and reload to restore its runtime behavior; stored data is not deleted.

Some features have dependencies. For example, **Decor** depends on **Hexes**, while **Template Effects**, **Auras**, and **Spell Configuration Panels** depend on the **Spell Activity System**. The manager shows when a child feature is blocked by a disabled parent.

See the complete **[Feature Manager reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager)** and **[Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference)**.

## [Included compendiums](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Compendium-Packs)

The module ships four packs under a **Shadowdark Extras** Compendium folder:

| Collection | Type | Contents |
| --- | --- | --- |
| `pack-sdxitems` | Item | SDX-enhanced items and spell sources used by Medkit |
| `pack-sdxactors` | Actor | Actors supplied by the module |
| `pack-sdxrollables` | RollTable | Ready-made SDX rollable content |
| `pack-sdxeffects` | ActiveEffect | Reusable effects and conditions |

Module packs are read-only and are replaced on update. Import or copy a document into the world before customizing it. See **[Compendium Packs](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Compendium-Packs)**.

## [Public API](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Developer-API)

The public API is available through the module object after Foundry setup:

```js
const api = game.modules.get("shadowdark-extras")?.api;
```

The API includes creature-type lookup, Medkit source registration and scans, effect and duration helpers, hex and dungeon generation, biome management, multi-level Regions and decor, and ready-phase spell macro helpers. Feature-detect methods before calling them. Scene and document mutations require a GM; validate the active Scene and elevation Level before map mutations.

See the **[Developer API](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Developer-API)** and the **[SDX MCP Dungeon API](SDX-MCP-DUNGEON-API.md)**.

## For developers

The repository contains the module source plus development and release tooling. Use Node **24** for local development and release tooling. Although `package.json` accepts Node 24 through 26, [`dev/tools/README.md`](dev/tools/README.md) records Node 26 test-discovery and `classic-level` caveats that must not be treated as successful validation:

```bash
npm install
npm run verify
npm run test:all
npm run lint
```

For a local Foundry test world, symlink the repository into your Foundry data directory:

```bash
ln -s "$PWD" "$FOUNDRY_DATA/Data/modules/shadowdark-extras"
```

Before creating a release, close Foundry so its pack databases are not locked, then run:

```bash
npm run pack
npm run release:check
```

The repository's `dev/tools/README.md` documents the static gates, test discovery, pack checks, and live Foundry validation expectations. The public integration surface is documented in the Wiki's **[Developer API](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Developer-API)** page.

## Permissions and data safety

- Configuration menus, map generation/import, pin management, scene structure changes, Regions, and destructive cleanup are GM-controlled.
- Player actions that change documents may require an active GM and socketlib.
- Players can paint dungeons only when the GM enables **Allow Players to Paint Dungeons**; a connected GM is still required to commit the scene changes.
- Disabling or uninstalling SDX does not remove data it already created or modified. Actor/item flags, world actors, journals, RollTables, Scenes, Regions, tiles, walls, drawings, imported images, and chat messages remain until removed separately.
- Map formatting, generation, flattening, importing, and cleanup can create or delete documents. Back up or duplicate important content first.

## [Troubleshooting and support](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Troubleshooting)

Start with **[Troubleshooting](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Troubleshooting)**. The most common checks are:

- Confirm all five required dependencies are installed and active.
- Check Feature Manager when a tab, menu, sheet control, or automation is missing; reload after changing a feature.
- Hard-refresh with `Ctrl+Shift+R` when updated CSS, templates, or JavaScript appear stale.
- Confirm an active GM is connected for socket-backed player actions.
- Include the Foundry version/build, Shadowdark system version, SDX version, dependency versions, exact reproduction steps, and the first relevant console error when reporting a bug.

Report problems through [GitHub Issues](https://github.com/DimitroffVodka/shadowdark-extras/issues) or the [Discord community](https://discord.gg/ZBtQ9ub7Mn). Confirmed, measured maintainer issues are tracked in [`docs/KNOWN-ISSUES.md`](docs/KNOWN-ISSUES.md).

## Credits and licensing

The repository does not currently state one unambiguous repository-wide license: [`LICENSE`](LICENSE) contains an MIT notice, while [`LICENSE.txt`](LICENSE.txt) contains the AGPL-3.0 text, and neither file scopes their relationship. Bundled artwork, fonts, and third-party libraries may have additional terms. Review both root license files and asset-specific notices before redistributing the repository or extracting its contents.

- [Shadowdark RPG](https://www.thearcanelibrary.com/pages/shadowdark) by The Arcane Library.
- [Foundry VTT Shadowdark System](https://github.com/Muttley/foundryvtt-shadowdark).
- Icons from [Font Awesome](https://fontawesome.com/).
- Theater of the Mind is inspired by Exalted Scenes by Wands and Widgets.
- Overlay artwork by Pixelbay.
- Dungeon Mapper and Hexmapper are inspired by Hexlands and Instant Dungeons by [The Augur](https://www.patreon.com/cw/TheAugur).
- Hexcrawl data uses material from [Hexroll](https://hexroll.app/), adapted and supplemented for SDX.
- Realm, City, Village, Cave/Glade, Dungeon, and Dwelling generators are created by **Watabou**. The Medieval Fantasy City Generator is open source through [TownGeneratorOS](https://github.com/watabou/TownGeneratorOS) under GPL-3.0.
- Some hex tiles and points of interest are from [2-Minute Tabletop](https://2minutetabletop.com/product/world-map-hex-tiles/) under CC BY-NC 4.0.
- Some black-and-white points of interest are from [Cartography Assets](https://cartographyassets.com/assets/6626/gogotsmaps-black-and-white-assets/) under a CC BY-NC license.
- Dyson-style dungeon assets are by Thomas Seliger; see [neovatar/dungeondraft-dysonesque](https://github.com/neovatar/dungeondraft-dysonesque).
