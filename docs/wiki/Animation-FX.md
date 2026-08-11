# Animation FX

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

SDX's native Animation FX engine drives Sequencer to play item and event
effects. The bundled presets cover spells, weapons, common NPC attacks, equipped
weapon sprites, torches, and level-up indicators.

---

> **Animations or previews missing?** Check [**Feature Manager → Advanced & Hidden Features → Animation**](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager#animation) — 7 toggles; **Per-Item Animation Overrides** is *also blocked when Animation FX is disabled*.

## What you need

**Sequencer** is required by the current module manifest, and a **JB2A** pack
supplies the visual database entries behind most bundled presets. **psfx**
provides sound files and is optional, since a missing psfx file should fail
silently and leave the visual alone. **Automated Animations** is optional too.

## Open the master list

Go to **Configure Settings → Shadowdark Extras → Configure Animations**.

The manager sorts presets into five groups. Each one can be enabled on its own.

| Category | Matches |
|---|---|
| **Spells / Scrolls / Wands** | Spell-like item names |
| **Weapons** | Attack effects for weapon names |
| **NPC Attacks** | Natural and named monster attacks |
| **Equipped Weapon Sprites** | Persistent art attached to equipped weapons |
| **Ambient & Events** | Torch/light types and level-up animation |

![The Animation FX master list with spell presets and Sequencer paths](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/animation-fx-master-list.webp)

## How a preset matches

Every master preset carries a name pattern, so one preset can cover the normal,
magic, and suffixed variants of an item name, and when several patterns match
the most specific one takes it.

Resolution runs in three steps: an enabled per-item override first, then the
most-specific master-list name match, then the category default.

The item Activity panel deliberately reports **No preset** when all it found was
a generic category fallback. Read that as "nothing named matched", rather than
as an inherited preset.

## One-time seeding

An active GM seeds the bundled defaults once in a new world, merging in whatever
keys are missing. After that, your edits stick, your deletions stick, and a
later module update won't keep overwriting world choices.

Use **Seed Default Presets** when you deliberately want defaults merged in
again, then review the result if you maintain custom patterns of your own.

## Editing a preset

A typical preset defines a label and name-match pattern, an effect type such as
projectile, cone, on-token, or persistent, a hit file, an optional miss file, a
sound, and whatever scale and geometry that type needs.

The Sequencer Database browser helps you pick registered entries, with a
thumbnail previewing image and video media and a hover that plays video inline.
Select a token first for the canvas preview.

Some database paths are prefixes. Distance-aware projectile paths may resolve a
suitable leaf on purpose, but a prefix holding unrelated shapes should be pinned
down to one specific entry.

## Per-item override

Open a Spell, Scroll, or Wand and expand **Animation FX** on the Activity tab.

Leave the override off and the panel shows inherited master values read-only,
with a badge naming the inherited preset or reading **No preset**. Opening the
sheet copies nothing into the item.

Turn the override on to capture and edit item-specific values, and switching it
back off clears the override and resumes live inheritance.

The panel handles effect and miss files, sound with audition, a media thumbnail,
a canvas preview, and the inherited/override status. Hold `Shift` while
previewing, where supported, to test the miss variant.

## Weapon sprites

Equipped Weapon Sprites paint a weapon or shield image onto the token, and the
bundled art and presets cover the common weapon categories. Offset, scale,
rotation, anchor, and PIXI filters control placement, while idle wobble, bob,
float, and rotation give the sprite some life. An item can also be set to appear
only during an attack.

Per-item weapon animation configuration always beats the master sprite match.

## Torch and level-up effects

The Ambient & Events section owns the animation file for torch, lantern, oil,
candle, light-spell variants, and level-up readiness.

Torch geometry such as per-light offset and scale still belongs to the torch
system. The master manager owns only the chosen animation file.

## Sounds and client controls

Sound enablement, volume, and animation scale are all per-client controls in the
manager. A GM can set a sound path in the world preset while every client keeps
its own volume, or no sound at all.

## Automated Animations coexistence

With AA active and SDX integration enabled, AA gets filtered down to successful
workflows, targetless utility spells can be allowed separately, and AA is
suppressed for any item SDX already animates. One attack or cast should produce
one owned effect.

Prefer AA for a particular item? Remove or disable the SDX match or item
override, then configure AA the normal way.

---

## Troubleshooting

**Every spell preview is blank.** Check whether JB2A registered its Sequencer
database namespace. Current SDX versions repair the common load-order failure,
but JB2A still has to be installed and active.

**Animation shape changes randomly.** The preset is almost certainly pointing at
a database prefix holding several shapes. Pick a concrete leaf in the browser.

Silent visuals are nearly always a client-side sound setting. Enable sound for
this client, raise the volume, and install the source sound pack if the preset
uses psfx.

**Effect plays twice.** Confirm SDX's Automated Animations integration is on,
and that no second workflow module is independently listening to the same chat
message.

**Historical messages replay after refresh.** Hard-refresh after updating.
Current versions ignore messages created before the client load epoch.

**Cleanup logs a Sequencer ticker error.** Update SDX. Current cleanup guards
half-initialized effects, so one bad effect can't strand the rest.

---

**Related:** [Spell Automation](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Spell-Automation) ·
[Combat & Damage](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Combat-and-Damage) ·
[Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference)
