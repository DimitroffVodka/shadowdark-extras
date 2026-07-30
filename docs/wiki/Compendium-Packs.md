# Compendium Packs

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

Shadowdark Extras ships four module compendiums. They live inside the
**Shadowdark Extras** pack folder and behave like any other read-only module
pack.

---

## Pack reference

| Collection | Foundry label | Document type | Player access | Purpose |
|---|---|---|---|---|
| `shadowdark-extras.pack-sdxitems` | `sdxitems` | Item | Observer | SDX-enhanced items, including spell sources used by Medkit |
| `shadowdark-extras.pack-sdxactors` | `sdxactors` | Actor | Observer | Actors supplied by the module |
| `shadowdark-extras.pack-sdxrollables` | `sdxrollables` | RollTable | Observer | Rollable tables used as ready-made SDX content |
| `shadowdark-extras.pack-sdxeffects` | `SDX Effects Library` | ActiveEffect | Observer | Reusable effects and conditions |

Assistant users get owner access per the manifest. Normal players get observer.

## Use content safely

Module compendiums get replaced wholesale every time the module updates. So to
customize a shipped document:

1. Import or copy it into the world, or into a world compendium.
2. Rename the copy if you want it clearly independent.
3. Edit the copy. Leave the module pack source alone.

Never hand-edit files under `packs/` in a live installation. The LevelDB pack
format and Foundry's pack indexes should go through Foundry itself or the
repository's pack tooling.

## Medkit and the item pack

The actor-sheet **Medkit** compares owned Spells against configured source
packs. It also resolves the source spell referenced by owned Scrolls and Wands,
then compares their SDX enhancement flags.

The SDX item pack is always a Medkit source. Other modules can register their
own through the public API:

```js
const api = game.modules.get("shadowdark-extras")?.api;
api?.registerMedkitPack("my-module.my-spells");
```

The GM-only **Medkit: Scan All Actors** settings button runs that same
comparison over every world actor, shows a summary, and waits for confirmation
before applying anything.

## Effects library

The effects pack works anywhere SDX accepts an effect drop: a spell, potion, NPC
feature, or other Activity configuration, a weapon's on-hit effects, an aura or
template effect, or an ordinary actor Active Effect workflow.

Anywhere a feature stores a UUID, moving or replacing the source document breaks
the reference. Copying a configured item into the world copies the item, and
leaves every referenced effect where it was.

## RollTables and carousing

SDX works with ordinary Foundry RollTables. The carousing editors additionally
import compatible table text, pipe-separated rows included. Linking a table
doesn't make every arbitrary table valid for every carousing section, so review
the imported preview before you take it to the table.

## Pack troubleshooting

**A pack is missing.** Reinstall or update the module and relaunch the world.
Release archives are checked for all four declared packs.

**A document is read-only.** It's still sitting in a module compendium. Import
it to the world before editing.

**An actor has stale spell automation.** Open its Medkit, or run the world scan.
The tool previews available updates first.

**An effect drop later resolves as missing.** The stored source UUID is gone.
Re-drop the effect from wherever it lives now.

---

**Related:** [Character Sheets](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets) ·
[NPCs & Effects](https://github.com/DimitroffVodka/shadowdark-extras/wiki/NPCs-and-Effects) · [Developer API](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Developer-API)
