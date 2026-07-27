# Animation FX

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

SDX's native Animation FX engine uses Sequencer to play item and event effects.
Bundled presets cover spells, weapons, common NPC attacks, equipped weapon
sprites, torches, and level-up indicators.

---

## What you need

- **Sequencer** is required by the current module manifest.
- A **JB2A** pack supplies the visual database entries used by most bundled
  presets.
- **psfx** is optional and supplies sound files. Missing psfx audio should fail
  silent, not stop the visual.
- **Automated Animations** is optional.

## Open the master list

Go to **Configure Settings → Shadowdark Extras → Configure Animations**.

The manager groups presets into:

| Category | Matches |
|---|---|
| **Spells / Scrolls / Wands** | Spell-like item names |
| **Weapons** | Attack effects for weapon names |
| **NPC Attacks** | Natural and named monster attacks |
| **Equipped Weapon Sprites** | Persistent art attached to equipped weapons |
| **Ambient & Events** | Torch/light types and level-up animation |

Each category can be enabled independently.

![The Animation FX master list with spell presets and Sequencer paths](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/animation-fx-master-list.png)

## How a preset matches

A master preset contains a name pattern. One preset can therefore cover normal,
magic, or suffixed variants of an item name. When more than one pattern matches,
the most specific match wins.

Resolution order:

1. enabled per-item override;
2. most-specific master-list name match;
3. category default.

The item Activity panel deliberately reports **No preset** when only a generic
category fallback exists; it does not imply that a named preset was inherited.

## One-time seeding

An active GM seeds the bundled defaults once in a new world. Seeding merges
missing keys. After that:

- editing a preset preserves the edit;
- deleting a preset preserves the deletion;
- a later module update does not continuously overwrite world choices.

Use **Seed Default Presets** when you explicitly want to merge defaults again.
Review the result if you maintain custom patterns.

## Editing a preset

A typical preset defines:

- label and name-match pattern;
- effect type, such as projectile, cone, on-token, or persistent;
- hit file;
- optional miss file;
- sound;
- scale/geometry appropriate to the type.

The Sequencer Database browser helps select registered entries. A thumbnail
previews image/video media; hovering a video can play it inline. Select a token
before using the canvas preview.

Some database paths are prefixes. Distance-aware projectile paths may
intentionally resolve a suitable leaf, while a prefix containing unrelated
shapes should be pinned to a specific entry.

## Per-item override

Open a Spell, Scroll, or Wand and expand **Animation FX** on the Activity tab.

With the override off:

- the panel shows inherited master values read-only;
- its badge names the inherited preset or says **No preset**;
- opening the sheet does not copy world values into the item.

Turn the override on to capture/edit item-specific values. Turn it off to clear
the override and resume live inheritance.

The panel supports:

- effect and miss files;
- sound with audition;
- media thumbnail;
- canvas preview;
- inherited/override status.

Hold `Shift` while previewing where supported to test the miss variant.

## Weapon sprites

Equipped Weapon Sprites display a weapon or shield image on the token:

- bundled art/presets cover common weapon categories;
- per-item configuration can override the master match;
- offset, scale, rotation, anchor, and PIXI filters control placement;
- idle wobble/bob/float/rotation can animate the sprite;
- an item can be configured to appear only during an attack.

The per-item weapon animation configuration takes precedence over the master
sprite match.

## Torch and level-up effects

The Ambient & Events section controls the animation file for:

- torch;
- lantern;
- oil;
- candle;
- light-spell variants;
- level-up readiness.

Torch geometry such as per-light offset/scale remains part of the torch system;
the master manager owns the chosen animation file.

## Sounds and client controls

Sound enablement, volume, and animation scale are per-client controls in the
manager. A GM can define a sound path in the world preset without forcing every
client to hear it at the same volume.

## Automated Animations coexistence

When AA is active and SDX integration is enabled:

- AA is filtered to successful workflows;
- targetless utility spells can be allowed separately;
- AA is suppressed for an item already animated by SDX;
- one attack/cast should produce one owned effect, not two.

If you prefer AA for a particular item, remove/disable the SDX match or item
override and configure AA normally.

---

## Troubleshooting

**Every spell preview is blank.** Check whether JB2A registered its Sequencer
database namespace. Current SDX versions repair the common load-order failure,
but JB2A must still be installed and active.

**Animation shape changes randomly.** The preset probably points to a database
prefix with multiple shapes. Select a concrete leaf in the browser.

**Visual plays but no audio.** Enable sound for this client, raise volume, and
install the source sound pack if the preset uses psfx.

**Effect plays twice.** Confirm SDX's Automated Animations integration is on and
that another workflow module is not independently listening to the same chat
message.

**Historical messages replay after refresh.** Hard-refresh after updating;
current versions ignore messages created before the client load epoch.

**Cleanup logs a Sequencer ticker error.** Update SDX. Current cleanup guards
half-initialized effects so one bad effect cannot strand the rest.

---

**Related:** [Spell Automation](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Spell-Automation) ·
[Combat & Damage](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Combat-and-Damage) ·
[Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference)
