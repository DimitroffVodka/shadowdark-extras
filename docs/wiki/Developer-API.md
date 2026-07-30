# Developer API

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

Shadowdark Extras exposes a public module API for macros, integrations, and
MCP-driven prep.

```js
const api = game.modules.get("shadowdark-extras")?.api;
```

The main API object is installed during Foundry's `setup` hook, and the
spell-macro helpers only arrive at `ready`, so call it after the right lifecycle
hook and feature-detect every method you touch.

---

## Permission model

Scene and document mutation methods sit behind a GM guard. A non-GM call throws:

```text
SDX | <function>: requires GM permission
```

Read-only helpers and player-safe effect helpers are open. Public calls get
audited in the console along with their caller.

Importing internal source modules directly to sidestep the wrapper is
unsupported, and it will break on you.

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

These stay open to players because an owning player's effect has to be able to
break.

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

`generateDungeon` takes optional settings covering seed, layout, room count,
density, branching, room-size bias, symmetry, stairs, clutter, texture, wall
color and width, and shadows. Inputs get validated, and expansive counts get
capped.

The full orchestration contract lives in
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

`clearGeneratedTiles({ force: true })` skips its confirmation. Reach for that
only inside an automation workflow that already confirmed with the user.

## Regions and multi-level decor

| Method | Permission |
|---|---|
| `placeChangeLevelRegion(options)` | GM |
| `placeDungeonSurface(options)` | GM |
| `placeDungeonDecor(options)` | GM |

Decor source paths are allowlisted by the implementation. Arbitrary remote URLs
will be rejected.

## Spell macro helpers

Available after `ready`. The unidentified helpers are `isUnidentified`,
`getUnidentifiedName`, `showIdentifyDialog`, `identifyItem`, and
`showItemReveal`, and alongside those sit the Holy Weapon, Cleansing Weapon, and
Wrath helpers, plus Shapechanger apply and revert.

Feature-detect all of them. The ready-phase module can change independently of
the setup-phase API.

## Namespaces not promised as stable

`api.internal` holds generator and layout primitives SDX uses itself:
level-context and scene-level data helpers, cave layout and loop tracing, room
and mixed-layout algorithms, biome assignment, and cell-floor mapping.

Those can change without any compatibility promise. `api.templates` and
`api.dev` are implementation and development surfaces too, unless some specific
method is documented elsewhere.

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

Validate the active Scene and current Level before every map mutation.

---

**Related:** [Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons) ·
[Compendium Packs](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Compendium-Packs) ·
[Troubleshooting](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Troubleshooting)
