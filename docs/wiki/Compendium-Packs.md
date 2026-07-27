# Compendium Packs

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

Shadowdark Extras ships four module compendiums. They appear inside the
**Shadowdark Extras** pack folder and are ordinary read-only module packs.

---

## Pack reference

| Collection | Foundry label | Document type | Player access | Purpose |
|---|---|---|---|---|
| `shadowdark-extras.pack-sdxitems` | `sdxitems` | Item | Observer | SDX-enhanced items, including spell sources used by Medkit |
| `shadowdark-extras.pack-sdxactors` | `sdxactors` | Actor | Observer | Actors supplied by the module |
| `shadowdark-extras.pack-sdxrollables` | `sdxrollables` | RollTable | Observer | Rollable tables used as ready-made SDX content |
| `shadowdark-extras.pack-sdxeffects` | `SDX Effects Library` | ActiveEffect | Observer | Reusable effects and conditions |

Assistant users have owner access according to the manifest. Normal players
have observer access.

## Use content safely

Module compendiums are replaced when the module updates. To customize a shipped
document:

1. Import or copy it into the world or a world compendium.
2. Rename the copy if you want it to be clearly independent.
3. Edit the copy, not the module pack source.

Do not edit files under `packs/` by hand in a live installation. The LevelDB
pack format and Foundry's pack indexes should be managed through Foundry or the
repository's pack tooling.

## Medkit and the item pack

The actor-sheet **Medkit** compares owned Spells with configured source packs.
It also resolves the source spell referenced by owned Scrolls and Wands and
compares their SDX enhancement flags.

The SDX item pack is always a Medkit source. Other modules can register their
own source pack through the public API:

```js
const api = game.modules.get("shadowdark-extras")?.api;
api?.registerMedkitPack("my-module.my-spells");
```

The GM-only **Medkit: Scan All Actors** settings button runs the same comparison
over every world actor, presents a summary, and applies updates only after
confirmation.

## Effects library

The effects pack can be used anywhere SDX accepts an effect drop:

- a spell, potion, NPC feature, or other Activity configuration;
- a weapon's on-hit effects;
- an aura or template effect;
- a normal actor Active Effect workflow.

When a feature stores a UUID, moving or replacing the source document can break
the reference. Copying a configured item into the world does not automatically
copy every referenced effect.

## RollTables and carousing

SDX can work with ordinary Foundry RollTables. The carousing editors can also
import compatible table text, including pipe-separated rows. Linking a table
does not make every arbitrary table valid for every carousing section; review
the imported preview before using it in play.

## Pack troubleshooting

**A pack is missing.** Reinstall/update the module and relaunch the world.
Release archives are checked for all four declared packs.

**A document is read-only.** It is still in a module compendium. Import it to
the world before editing.

**An actor has stale spell automation.** Open its Medkit or run the world scan.
The tool previews available updates before applying them.

**An effect drop later resolves as missing.** The stored source UUID no longer
exists. Re-drop the effect from its current pack or world location.

---

**Related:** [Character Sheets](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets) ·
[NPCs & Effects](https://github.com/DimitroffVodka/shadowdark-extras/wiki/NPCs-and-Effects) · [Developer API](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Developer-API)
