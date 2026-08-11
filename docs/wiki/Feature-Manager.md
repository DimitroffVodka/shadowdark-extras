# Feature Manager

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

Feature Manager is the module's master on/off switch — one place to disable whole SDX features without editing world data.

---

## Where to find it

**Configure Settings** (gear) → **Shadowdark Extras** → **Feature Manager** — button label **Configure Features** (GM only, reload required).

The window title is **Feature Manager** (`featureManagerMenu` · `FeatureManagerApp`).

> If a tray tab, settings menu, or automation you expect is missing, open Feature Manager first — the feature is likely disabled there, not broken.

---

## How to use it

1. Open **Configure Settings** and scroll to **Shadowdark Extras**.
2. Click **Feature Manager** (**Configure Features**).
3. Leave the defaults enabled, or uncheck a tray tab or tool your table doesn't use.
4. Leave **Advanced & Hidden Features** enabled unless you mean to turn off underlying automation — it has no tray button of its own.
5. Click **Save Feature Settings**.
6. Reload when the banner asks you to — Foundry shows **Reload required** after you save.
7. Verify the tray tab, menu, or sheet control is gone (re-check it and reload to restore).

---

## What it controls

The top line is a master card:

| Card | What it hides when off |
|---|---|
| **SDX Tray** — *Left side of the Foundry canvas* | The entire tray, its tabs, and all handle tools |

Below that, two visible groups map directly to tray controls you can see:

### SDX Tray Tabs

| Choice | Location | What it hides when off |
|---|---|---|
| **Scenes** | SDX Tray → Scenes tab | ToM scenes, player view, navigation, arena editor, and video overlays |
| **Party** | SDX Tray → Party tab | Roster, health cards, travel, camping, weather, and stat sync |
| **Pins** | SDX Tray → Pins tab, Add Pin, and Pin List | Pin list, placement, canvas rendering, folders, and styles |
| **Notes** | SDX Tray → Notes tab | Notes on tiles, walls, lights, sounds, and tokens |
| **Hexes** | SDX Tray → Hexes tab | Hex tile, symbol, custom tile, POI, and terrain painting |
| **Dungeons** | SDX Tray → Dungeons tab | Dungeon painting, generation, biomes, levels, and tile flatten |
| **Decor** | SDX Tray → Decor tab | Decor assets and POI transforms (needs Hexes) |

### SDX Tray Tools

| Choice | Location | What it hides when off |
|---|---|---|
| **Marching Mode** | Tray handle → Crown and walking buttons | Party leader and marching movement |
| **Formation Spawner** | Tray handle → Formation button | Grid placement and canvas spawn |
| **Light Source Tracker** | Tray handle → Fire button | Active lights, durations, and controls |
| **Carousing** | Tray handle → Carousing button | Downtime rolls, outcomes, renown, wealth, and log |
| **Drawing Tools** | Tray handle → Pencil button | Shapes, stamps, and timed erase |
| **Map Generators** | Tray handle → Map button | Watabou generators and scene import |
| **Toggle Coordinates** | Tray handle → Globe button | Hex coordinate overlay |
| **Hex Tooltip / Hexplorer** | Tray handle → Information button | Hover terrain, settlements, and dungeons |
| **Hex Fog** | Tray handle → Fog button | Per-hex fog and fog effects |
| **Solo Hex Mode** | Tray handle → Compass button | Wilderness hex generation while exploring |
| **SDX Roller** | Tray handle → Dice button | Cinematic rolls, group checks, and recap cards |

Each choice shows a preview image, a short description, and where it lives on the tray.

### Advanced & Hidden Features

A collapsed section at the bottom. It groups automation that has no tray tab of its own — combat cards, spell activity, auras, inventory containers, sheet enhancements, and similar hooks. Leave it enabled unless you intend to turn off that underlying behavior. See [Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference) for what each hidden key stores.

---

## Options that change the path

- **Enable All / Disable All** — global buttons at the top, and per-group **Enable all / Disable all** next to each heading, set every checkbox in that scope in one click.
- **Partial / indeterminate** — a tray choice can be partially disabled (for example Dungeons bundles two features; Scenes bundles five). The checkbox shows an indeterminate state and the card reads *Some parts are currently disabled.*
- **Blocked by dependency** — some features need a parent. Decor needs Hexes; per-item animation overrides need Animation FX; template effects, auras, and spell config panels need the Spell Activity System. Disabling the parent disables the child and the card shows *Also blocked because … is disabled.* — the child checkbox stays off until the parent is back.
- **Collapsed automation** — Advanced rows have no preview image and no tray location; they hide sheets, hooks, libWrapper patches, and sockets rather than a button.

---

## GM and player differences

Only a GM sees **Feature Manager** (`restricted: true`). Disabling a feature removes it for everyone in the world — a player can't work around it by flipping a client setting.

---

## If something disappears

- **A tray tab or tool is missing** — open Feature Manager and re-check it. A single unchecked box (or its parent) explains most missing tabs.
- **A settings menu is gone** — the menu is gated by its feature. Re-enable the feature group it belongs to and reload.
- **Nothing changed after saving** — reload. `disabledFeatures` has `requiresReload: true`; hooks, sheets, and tray modes attach at startup.
- **Decor disappeared but Hexes still works** — expected. Decor depends on Hex Painter; re-enable Hexes and Decor together.
- **I want everything back** — click **Enable All** at the top, save, and reload. The stored value is `disabledFeatures` (`Array`, default `[]`); `[]` means nothing disabled.

---

## Technical detail

<details>
<summary>Storage, scope, and reload</summary>

- Setting key `disabledFeatures` — **World**, `config: false` (hidden), `type: Array`, default `[]`, `requiresReload: true`. No direct toggle lives in Configure Settings — only this editor writes it.
- Menu key `featureManagerMenu` — `name: Feature Manager`, `label: Configure Features`, `icon: fas fa-toggle-on`, hint *Completely disable Shadowdark Extras features, including hidden hooks and background behavior.*
- Disabling prevents initialization of that feature's menu registrations, settings, `Hooks.on`/`libWrapper.register`, sockets, templates, and tray mode. Stored world data (container flags, journal pages, pin pages, aura Regions, carousing sessions, style values, granted advancements, etc.) is preserved — re-enable and reload to restore.
- App id `sdx-feature-manager`, classes `shadowdark-extras sdx-feature-manager-app`, size 920×820, template `templates/feature-manager.hbs`. Previews are `assets/feature-manager/*.webp` (one per visible choice).

</details>

---

**Related:** [Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference) · [The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools) · [Troubleshooting](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Troubleshooting)
