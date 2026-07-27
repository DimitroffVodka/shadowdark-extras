# Installation & Setup

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

---

## Requirements

The current module manifest declares:

| Component | Minimum | Verified |
|---|---:|---:|
| Foundry VTT | v13 | v14 |
| Shadowdark RPG system | v3.0.0 | v4.0.6 |

The current module version is shown in `module.json`; this manual documents the
6.10.49-era interface and the current working tree.

## Install

In Foundry's **Add-on Modules → Install Module** dialog, paste:

```text
https://github.com/DimitroffVodka/shadowdark-extras/releases/latest/download/module.json
```

Install the module and its required dependencies, then enable **Shadowdark
Extras** in **Game Settings → Manage Modules** for your Shadowdark world.

## Dependencies

Foundry treats these as required because they are in the module manifest:

| Module | Why SDX uses it |
|---|---|
| **socketlib** | Player-to-GM actions such as transfers and GM-authoritative automation |
| **libWrapper** | Compatibility-safe wrapping of Foundry and Shadowdark behavior |
| **Sequencer** | Native SDX animations and persistent visual effects |
| **portal-lib** | Interactive placement workflows |
| **TokenMagic FX** 0.7.5.1+ | Template and token filter effects |

Recommended, but not required by the manifest:

| Module | What changes when present |
|---|---|
| **JB2A** | Supplies the visual files used by the bundled animation presets |
| **psfx** | Supplies sound files used by bundled weapon and spell presets |

**Automated Animations is optional.** SDX has its own Sequencer-driven Animation
FX engine. If Automated Animations is also active, SDX filters it to avoid
double-playing effects it already owns.

## First load

On the first world load:

- The **SDX Tray** appears at the left edge for each client whose tray setting is
  enabled.
- The four bundled compendium packs are available under the **Shadowdark
  Extras** pack folder.
- An active GM seeds the bundled Animation FX presets once per world. Seeding
  merges missing defaults and does not continually restore presets the GM later
  deletes.
- Socket-backed systems initialize. Features that require a GM connection need
  an active GM when a player uses them.
- Sheet, item, editor, chat, canvas, and ProseMirror integrations attach
  according to the enabled settings.

Most feature toggles are world-scoped. Appearance, tray visibility, and a few
drawing/animation controls are per-client. See
[Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference).

## First-world checklist

### 1. Confirm the tray

Open a scene and look for the narrow SDX handle on the left edge of the canvas.
Expand it and confirm the tabs render. If it does not appear, check the
per-client **Enable SDX Tray** setting and reload.

![The expanded SDX Tray showing the Party roster and tool rail](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/sdx-tray-party-view.png)

### 2. Decide how automatic combat should be

Open **Configure Settings → Shadowdark Extras → Configure Combat Settings**.
The important defaults are:

| Behavior | Default |
|---|---|
| Show enhanced damage card | on |
| Show it to players | on |
| Auto-apply damage | on |
| Auto-apply conditions | on |
| Require a target | no check |
| Check weapon range | no check |
| Untarget after use | dead targets |

If you want the GM to approve every HP change, turn off auto-apply damage or
enable **GM Only Apply Damage**.

### 3. Choose your sheet presentation

The enhanced player header and NPC player-sheet theme are on by default. Dark
mode is a per-client setting. Use:

- **Sheet Style Editor** for borders, panels, colors, and live preview.
- **Configure HP Waves** for the portrait HP overlay.
- **Configure Sheet Locks** to define what a locked character sheet protects.

### 4. Review spell automation

**Enhance Spells** and the **Focus Spell Tracker** are on by default. Open a
spell item and inspect its **Activity** tab before relying on automatic damage,
templates, auras, or effects. SDX follows the data saved on the item; it cannot
infer every homebrew spell safely.

### 5. Check animation assets

Open **Configure Animations**. A preset can be configured without a usable
preview if its JB2A or psfx source is missing. Select a token and use the preview
control to test the current client.

### 6. Back up before map generation

Map formatting, dungeon generation, scene import, flattening, and some cleanup
actions create or delete scene documents. Duplicate an important scene before
experimenting, and verify the active scene and current elevation level.

## Permissions

| Action | Typical access |
|---|---|
| Change world settings and configuration menus | GM |
| Generate/import maps or modify scene structure | GM |
| Paint dungeons | GM; players only when explicitly enabled and a GM is online |
| Use the player tray, owned character sheets, conditions, and configured item actions | Owning player or GM |
| Trade or transfer to another user | Player, processed through socketlib/GM authority when needed |
| Add and organize journal pins | GM |
| Use drawing tools | Players when **Allow Player Drawing** is on |
| Edit client settings such as dark mode or drawing hotkeys | Each client |

Some player actions are deliberately GM-authoritative. If no GM is connected,
the UI may be visible but the requested world change cannot be completed.

## Updating

Update from Foundry's Add-on Modules screen. After an update:

1. Relaunch the world if the manifest, required files, sheets, or
   reload-required settings changed.
2. Hard-refresh with `Ctrl+Shift+R` if styles or templates look stale.
3. Open the browser console (`F12`) if the module does not load.
4. Use the **Medkit** to compare owned spells, scrolls, and wands with current
   source-pack enhancements. GMs can run **Medkit: Scan All Actors** from
   settings.

## Disabling or uninstalling

Disabling SDX stops its hooks and UI. It does not remove:

- actor and item flags already written by the module;
- world actors, items, journals, RollTables, scenes, Regions, tiles, walls, or
  drawings created through its tools;
- imported/generated scene images;
- existing chat messages.

Make a world backup before manually removing generated content or flags.

---

**Next:** [The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools) ·
[Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference)
