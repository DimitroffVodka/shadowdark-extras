# Settings Reference

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

Every visible setting and GM configuration menu the current module registers.
**World** settings apply to everyone. **Client** settings belong to one
browser and user. Where a row says "Reload", the setting itself asks for one.

---

## Configuration menus

Each of these opens a dedicated editor instead of flipping one checkbox.

| Menu | Access | What it configures |
|---|---|---|
| **Configure Combat Settings** | GM | Damage cards, auto-application, targets, multipliers, range, untargeting |
| **Configure Effects** | GM | Condition behavior; currently the Silenced rules for spells, scrolls, and wands |
| **Configure HP Waves** | GM | Enable the portrait wave, default color, ancestry color overrides |
| **Configure Travel Activities** | GM | Party travel/camp tasks, allowed abilities, campfire requirement, art |
| **Configure Travel Speeds** | GM | Named party travel speeds |
| **Configure Weather Table** | GM | World or compendium RollTable drawn by the Party sheet's Weather button |
| **Configure Inventory Styles** | GM | Styling priorities and colors for magical, unidentified, container, and item-type rows |
| **Sheet Style Editor** | GM | Sheet borders, panels, colors, gradients, and preview |
| **Configure Animations** | GM | Animation FX master presets, categories, sound, scale, ambient effects |
| **Manage Dungeondraft Decor Packs** | GM | Import, enable, preview, or hide object packs in the Decor tray |
| **Light Templates** | GM | Custom light-source templates attached to items |
| **Medkit: Scan All Actors** | GM | Preview and apply current source-pack spell enhancements world-wide |
| **Manage Carousing Tables** | GM | Original or Expanded tables, based on the active carousing mode |
| **Manage Creature Types** | GM | Add and maintain custom creature-type choices |
| **Pin Style Editor** | GM | World defaults for journal pins |
| **Configure Coordinates** | GM | Coordinate mode, placement, labels, and appearance |
| **Configure Sheet Locks** | GM | Which fields and item operations a locked character sheet protects |

The pin editor also opens for a single selected pin, and several map and dungeon
editors launch from the tray instead of Configure Settings.

![The Automatic Combat Settings menu, one of SDX's dedicated configuration editors](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/combat-settings.png)

## Combat settings menu defaults

| Option | Default |
|---|---|
| Show Damage Card | on |
| Show Damage Card for Players | on |
| Scrolling Combat Text | on |
| Hide Item Description | off |
| Hide Damage Card on Failed Attack | off |
| Require Target for Attack | none |
| Check Weapon Range | none |
| Untarget at End of Turn | dead targets |
| Show Targets / Multipliers / Apply button | on / on / on |
| Auto-Apply Damage | on |
| Auto-Apply Conditions | on |
| GM Only Apply Damage | off |
| Enabled multiplier buttons | clear, 0, ¼, ½, 1, 2 |

That "clear" control uses an internal zero-valued entry, which is a different
thing from applying zero damage.

## Combat, spells, and animation

| Setting | Scope | Default | Reload | What it does |
|---|---|---:|---:|---|
| **Enable Fog Effects** | World | off | no | Enables optional shaders selected from the Hex Fog button's context menu |
| **Enable Focus Spell Tracker** | World | on | yes | Tracks focus spells and removes linked effects when focus ends |
| **Auto-Roll Focus on Turn** | World | off | no | Fast-forwards active focus checks at the caster's turn |
| **Enhance Spells** | World | on | yes | Adds Activity automation to supported spell/item sheets |
| **Enable Wand Uses** | World | on | yes | Enables SDX wand-use tracking |
| **Automated Animations Integration** | World | on | yes | Appears only when Automated Animations is active; prevents conflicting playback |
| **Animate Spells Without Target** | World | on | no | Lets AA handle eligible targetless utility spells |
| **Mysterious Casting Message** | World | `The creature casts a mysterious spell...` | no | Public replacement text while an NPC's Mysterious Mode is active |

Animation FX's category toggles, master data, client scale, sound toggle, and
volume all live inside **Configure Animations** rather than the normal settings
list.

## Character sheets

| Setting | Scope | Default | Reload | What it does |
|---|---|---:|---:|---|
| **Show Medkit Icon** | World | on | no | Shows the owned-actor update tool |
| **Enable Enhanced Header** | World | on | yes | Replaces the player header with HP, AC, abilities, Luck, XP, and level |
| **Match NPC Sheet Theme to Player Sheets** | World | on | no | Applies SDX frame/header/panel styling without replacing NPC layout |
| **Enable Default Header Background** | World | off | no | Uses one image/video when a sheet has no per-actor background |
| **Default Header Background Image** | World | blank | no | Image/video path for the previous option |
| **Enable Journal Notes** | World | on | yes | Replaces simple character notes with the multi-page editor |
| **Enable Add Coins Button** | World | on | yes | Adds the quick coin adjustment button |
| **Conditions theme** | World | Shadowdark | no | Shadowdark, 5e, Parchment, Stone, Leather, Iron, Moss, or Blood |
| **Dark Mode** | Client | on | no | Applies the client's dark theme |

The many border, panel, and color values belong to the **Sheet Style Editor** as
hidden settings, so they never appear as separate supported controls.

## Inventory and carousing

| Setting | Scope | Default | Reload | What it does |
|---|---|---:|---:|---|
| **Enable Container System** | World | on | yes | Lets owned items store contents and coins |
| **Allow Nested Containers** | World | on | no | Allows containers inside containers |
| **Enable Trading System** | World | on | yes | Adds transfer/trade actions for players |
| **Enable Multi-Select & Bulk Delete** | World | on | yes | Adds Shift/Ctrl selection and bulk deletion |
| **Enable Carousing** | World | on | yes | Adds the carousing UI |
| **Carousing Mode** | World | Original | no | Selects Original or Expanded rules/data |
| **Show Benefits to Players** | World | on | no | Controls benefit-description visibility |
| **Show Mishaps to Players** | World | on | no | Controls mishap-description visibility |
| **Carousing Wealth Base** | World | Coins only | no | Calculates percentage losses from coins only or coins plus valued gear |

## NPCs, journals, pins, and visuals

| Setting | Scope | Default | Reload | What it does |
|---|---|---:|---:|---|
| **Enable NPC Inventory Tab** | World | on | yes | Adds items, coins, and slot totals to NPC sheets |
| **Enable NPC Creature Type** | World | on | no | Adds the creature-type selector |
| **Enable Torch Animations** | World | on | yes | Plays configured token flames for active lights |
| **Enable Level Up Animation** | World | on | yes | Shows the configured ready-to-level effect |
| **Enable Notes on placeables and Notes tab in tray** | World | on | yes | Adds notes to Token/Tile/Wall/Light/Sound configuration and the tray |
| **Enable Journal Narration** | World | on | no | Adds narration controls to journal blockquotes |
| **Enable Pixel perfect on Pins** | World | off | no | Uses image alpha for more exact pin hit testing |
| **Pin Pixel Perfect Alpha Threshold** | World | 100 | no | Alpha cutoff from 0–255 |

## Tray, hexes, and maps

| Setting | Scope | Default | Reload | What it does |
|---|---|---:|---:|---|
| **Enable SDX Tray** | Client | on | yes | Shows the left-side tray |
| **Show Party Tab** | Client | on | no | Shows/hides Party for this client |
| **Party Name** | World | `Party` | no | Heading used by the tray |
| **Show Health Bars** | Client | on | no | Shows HP bars in the tray |
| **Show NPCs** | Client | on | no | Lets a GM's tray include NPC tokens |
| **Allow Players to Paint Dungeons** | World | off | no | Shows the player Dungeons tab; a GM must be online to commit |
| **Hex Fog: Default Reveal Radius** | World | 1 | no | Rings revealed around a moving token, 0–5 |
| **Settlement Maps: Use Local Maphub** | World | off | no | Uses bundled/local generator assets instead of an external visual source |

Hex tile dimensions, POI scale, dungeon level sliders, marching state, formation
state, the content registry, and pin folders are all internal, UI-managed
settings.

## Token toolbar

| Setting | Scope | Default | Reload | What it does |
|---|---|---:|---:|---|
| **Enable Token Toolbar** | World | off | yes | Enables the selected-token HUD |
| **Token Toolbar Visibility** | World | Both | no | Both, GM only, or players only |
| **Combat Only** | World | off | no | Hides it outside combat |
| **Show Active Effects** | World | on | no | Displays effect icons |
| **Show Equipped Items** | World | on | no | Displays equipped item icons |

## Drawing tools

| Setting | Scope | Default | What it does |
|---|---|---:|---|
| **Allow Player Drawing** | World | on | Grants players SDX drawing tools |
| **Timed Erase Timeout** | World | 30 seconds | Fade delay, 5–120 seconds |
| **Enable Drawing Hotkey** | Client | on | Enables the hold-to-draw keybinding |
| **Block Drawing While Typing** | Client | on | Prevents the hotkey from activating in an editor/input |

The default hold-to-draw key is `L`. Drawing mode, stamp, size, width, line
style, color, opacity, timed-erase state, and toolbar position are saved per
client by the toolbar itself.

## Easy Reference

All five Easy Reference categories are world-scoped and on by default: NPC
cards, item cards, RollTables, ability checks and requests, and dice rolls.

## Notes about scope

World settings still answer to the relevant document permissions at the moment
of use. Client settings are why two users in the same world can be looking at
different themes and different tray contents.

Reload-required settings attach or remove hooks and templates at startup, so
reload after touching one. Hidden settings belong to their owning UI, and
`game.settings.set` is the wrong way in unless you're developing an integration.

---

**Related:** [Installation & Setup](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Installation-and-Setup) ·
[Troubleshooting](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Troubleshooting)
