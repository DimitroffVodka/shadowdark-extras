# Developer API

[← Wiki home](Home.md)

Shadowdark Extras exposes a public module API for macros, integrations, and
MCP-driven prep.

```js
const api = game.modules.get("shadowdark-extras")?.api;
```

The main API object is installed during Foundry's `setup` hook. Spell-macro
helpers are added by `ready`. Call it after the appropriate lifecycle hook and
feature-detect every method.

---

## Permission model

Scene/document mutation methods are wrapped with a GM guard. A non-GM call
throws:

```text
SDX | <function>: requires GM permission
```

Read-only helpers and player-safe effect helpers are not GM-only. Public calls
are audited in the console with their caller.

Do not bypass the wrapper by importing internal source modules directly.

## Creature types

| Method | Purpose |
|---|---|
| `getCreatureType(actor)` | Manual actor override, then bundled bestiary mapping |
| `getMappedCreatureType(name)` | Bundled name-map lookup only |

## Break-on-damage and effects

| Method | Purpose |
|---|---|
| `breakEffectOnDamage(...)` | Mark an effect to end on the bearer's next HP loss |
| `clearBreakOnDamage(...)` | Remove that marker |
| `applySpellEffect(...)` | Apply an SDX-aware spell effect |
| `showConditionsModal(...)` | Open the condition picker |
| `getConditionsData(...)` | Read condition choices/data |

These are not universally GM-only because an owning player's effect must be
able to break.

## Medkit

| Method | Permission | Purpose |
|---|---|---|
| `registerMedkitPack(packId)` | Any | Add a source Item compendium, idempotently |
| `unregisterMedkitPack(packId)` | Any | Remove a custom source; the SDX source cannot be removed |
| `getMedkitPacks()` | Any | List source collection IDs |
| `scanWorldForUpdates()` | Read-only | Return actors and available update counts |
| `applyWorldMedkitUpdates(options)` | GM | Apply to all or selected actor IDs |
| `medkitScanWorld()` | GM | Open the world scan/review workflow |

Example:

```js
Hooks.once("ready", () => {
  game.modules.get("shadowdark-extras")?.api
    ?.registerMedkitPack("my-module.spells");
});
```

## Focus and durations

| Method | Permission |
|---|---|
| `startDurationSpell(...)` | GM |
| `endDurationSpell(...)` | GM |
| `registerSpellModification(...)` | GM |
| `getActiveDurationSpells(...)` | Read-only |

## Dungeon generation

| Method | Permission | Purpose |
|---|---|---|
| `generateDungeon(settings)` | GM | Generate on the active Scene/current level |
| `getGeneratorSettings()` | Read-only | Current generator configuration |
| `setGeneratorSettings(settings)` | GM | Replace/update generator configuration |
| `generateRandomSeed()` | Any | Create a seed |
| `buildHexDungeonScene(options)` | GM | Create a playable keyed dungeon for a hex |

`generateDungeon` accepts optional settings such as seed, layout, room count,
density, branching, room-size bias, symmetry, stairs, clutter, texture, wall
color/width, and shadows. Inputs are validated and expansive counts are capped.

The detailed orchestration contract is in
[SDX-MCP-DUNGEON-API.md](https://github.com/DimitroffVodka/shadowdark-extras/blob/main/SDX-MCP-DUNGEON-API.md).

## Biomes

| Method | Permission |
|---|---|
| `getBiomeDefinitions()` | Read-only |
| `getCustomBiomes()` | Read-only |
| `setCustomBiome(key, data)` | GM |
| `removeCustomBiome(key)` | GM |
| `resetCustomBiomes()` | GM |
| `getEnabledBiomeKeys()` | Read-only |
| `getDisabledBiomes()` | Read-only |
| `setBiomeEnabled(key, enabled)` | GM |
| `openBiomeEditor()` | UI |

## Hex maps and hexcrawls

| Method | Permission | Purpose |
|---|---|---|
| `generateHexMap(params)` | GM | Generate terrain on the formatted active Scene |
| `clearGeneratedTiles(options)` | GM | Remove SDX-generated hex tiles |
| `buildHexcrawl(dataset)` | GM | Build a keyed map from in-memory data |
| `buildHexcrawlFromFile(path/options)` | GM | Build from a supported data file |

`clearGeneratedTiles({ force: true })` bypasses its confirmation. Use that only
in an already-confirmed automation workflow.

## Regions and multi-level decor

| Method | Permission |
|---|---|
| `placeChangeLevelRegion(options)` | GM |
| `placeDungeonSurface(options)` | GM |
| `placeDungeonDecor(options)` | GM |

Decor source paths are allowlisted by the implementation. Do not pass arbitrary
remote URLs.

## Spell macro helpers

Available after `ready`:

- unidentified helpers: `isUnidentified`, `getUnidentifiedName`,
  `showIdentifyDialog`, `identifyItem`, `showItemReveal`;
- Holy Weapon helpers;
- Cleansing Weapon helpers;
- Wrath helpers;
- Shapechanger apply/revert helpers.

Feature-detect these because the ready-phase module can change independently of
the setup-phase API.

## Namespaces not promised as stable

`api.internal` contains generator/layout primitives used by SDX:

- level-context and scene-level data helpers;
- cave layout/loop tracing;
- room and mixed-layout algorithms;
- biome assignment and cell-floor mapping.

These can change without a compatibility promise. `api.templates` and `api.dev`
are likewise implementation/development surfaces unless a specific method is
documented elsewhere.

## Safe integration pattern

```js
Hooks.once("ready", async () => {
  const api = game.modules.get("shadowdark-extras")?.api;
  if (!api?.getCreatureType) return;

  const type = api.getCreatureType(canvas.tokens.controlled[0]?.actor);
  console.log("Effective creature type:", type);
});
```

For a mutation:

```js
const api = game.modules.get("shadowdark-extras")?.api;
if (!game.user.isGM || !api?.generateDungeon) return;
await api.generateDungeon({ seed: "my-campaign-floor-1", roomCount: 12 });
```

Always validate the active Scene and current Level before a map mutation.

---

**Related:** [Hexcrawls & Dungeons](Hexcrawls-and-Dungeons.md) ·
[Compendium Packs](Compendium-Packs.md) ·
[Troubleshooting](Troubleshooting.md)
