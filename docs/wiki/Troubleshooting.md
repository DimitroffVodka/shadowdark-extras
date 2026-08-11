# Troubleshooting

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

Symptoms, likely causes, fixes. Feature pages carry more specific advice. This
one covers the problems that cross the whole module.

---

## Start here

### Nothing from Shadowdark Extras appears

1. Confirm **Shadowdark Extras** is enabled for the current world.
2. Confirm Foundry shows every required dependency installed and enabled:
   socketlib, libWrapper, Sequencer, portal-lib, and TokenMagic FX.
3. Open the browser console with `F12`.
4. Reload and hunt for the first error mentioning `shadowdark-extras`. That
   first one usually tells you more than the cascade behind it.
5. Confirm the release is complete. One missing imported `.mjs` file aborts the
   entire module at startup.

### UI appears but is unstyled or uses old controls

Hard-refresh with `Ctrl+Shift+R`. A normal Foundry reload will happily keep
serving cached CSS, templates, or JavaScript after an update.

### A setting changed but nothing happened

Check the
[Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference).
Settings marked **Reload** attach their behavior at startup, so the world needs
a reload after you change them.

### A tray tab, tool, menu, or automation disappeared

Since **6.11.0** most features are gated by
[Feature Manager](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager)
(**Configure Settings → Shadowdark Extras → Feature Manager**, button
**Configure Features**, GM only). Open it and re-check the feature — a single
unchecked box (or its parent) explains most missing tabs.

Quick triage:

1. Open **Feature Manager** as GM.
2. Look for an unchecked row or an *Also blocked because … is disabled.* note —
   for example **Decor** is blocked when **Hexes** is disabled, and
   **Template Effects** and **Auras** are blocked when the
   **Spell Activity System** is disabled; **Spell Configuration Panels** is under
   **Advanced & Hidden Features → Item Automation** with the same dependency.
3. Re-check the row (and its parent if needed), click **Save Feature Settings**,
   and **reload**.
4. If it still doesn't appear, check [Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference) for a world/client
   scope or permission difference, and [Installation & Setup → Permissions](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Installation-and-Setup#permissions) for
   who can run that tool.
5. Stuck? Use **Enable All** at the top of Feature Manager, save, and reload.

---

## Dependencies and animations

### Animation preset has no preview or does nothing

Work down the list. Sequencer active? A JB2A pack installed and active? In
**Configure Animations**, does the preset path actually resolve in the Sequencer
database? Select a token before you press preview. Then confirm both the
category and the item's own override are enabled. If visuals work and sound
doesn't, check the per-client sound toggle and volume.

The `psfx` module is optional. A preset that references psfx will animate
silently when the sound pack is absent.

### An effect plays twice

Automated Animations and SDX are probably both configured for the item. Keep the
SDX AA integration enabled, then look for a second module running its own chat
or workflow animation hook.

### Old chat messages animate or run macros after reload

Current versions guard chat-history re-renders. When it happens anyway, the
client is usually still running an older module version. Confirm the version,
then hard-refresh.

---

## Multiplayer and permissions

### A player button does nothing

Cross-owner changes get sent to an active GM over socketlib. Four things have to
be true: a GM is connected, socketlib is active, the player owns the source
actor or token, and the GM has access to the active scene and the target
documents.

### Player cannot see the Dungeons tab

That's the default. The GM has to enable **Allow Players to Paint Dungeons**,
and painting still needs a connected GM to perform the scene mutation.

### Player can see a tool but cannot alter the scene

Visibility and authority are separate concerns. Map generation, pin management,
scene import, Regions, and destructive cleanup all stay GM actions.

---

## Combat and item automation

### No enhanced damage card appears

Open **Configure Combat Settings** and enable **Show Damage Card**. If only the
GM sees it, enable **Show Damage Card for Players** as well. On a miss, check
**Hide Damage Card on Failed Attack**. Beyond the settings, confirm the item
produced a Shadowdark attack or damage chat workflow that SDX recognizes.

### Damage applies immediately when I expected approval

**Auto-Apply Damage** ships on. Turn it off in Combat Settings. Use **GM Only
Apply Damage** when the card should stay visible but only the GM may commit it.

### Target or range warnings do not appear

Both checks default to **None**. Set each to **Warn** or **Block** in Combat
Settings. For this check SDX treats Close as 5 ft and Near as 30 ft, and Far
isn't blocked by distance at all.

### A spell casts but its configured automation does not run

Confirm **Enhance Spells** is on, and reload if you only just enabled it. Open
the item's **Activity** tab and check the configuration actually saved. On a
Scroll or Wand, confirm its referenced spell UUID still resolves. Run-as-GM
macros want the caster and target tokens on a scene the receiving client can
resolve, since cross-scene token placeables cannot be manufactured. And run
Medkit if the actor is holding an older copy of an SDX-enhanced item.

### Focus damage happens at the wrong time

Current behavior applies the per-turn result only after a successful native
focus check. Confirm the spell is marked as a focus spell in Shadowdark data,
and that old copied items have been through Medkit.

---

## Sheets, inventory, and compendiums

### A sheet crashes while opening an imported weapon or armor item

Update to a current SDX release. The module carries a Foundry v14 compatibility
repair for frozen and corrupted Shadowdark compendium index data.

### Medkit reports no updates

Start with **Show Medkit Icon** being on, and the actor owning a Spell, Scroll,
or Wand that can be matched at all. A Scroll or Wand needs a valid referenced
spell UUID. The source pack has to be registered, though the SDX item pack
always is. Worth remembering: a same-named unrelated item won't necessarily
count as a valid source match.

### Container contents behave unexpectedly

Nested containers can be disabled separately, so check that first. Items have to
belong to the same actor for normal owned-container moves. Hold `Ctrl` wherever
the UI indicates move-versus-copy behavior. And decide what happens to a
container's contents before you delete the container.

### Unidentified information is visible to the GM

Expected. The feature hides the true name and description from players while
preserving GM visibility. Identification runs on Shadowdark 4.x's native
identified state.

---

## Tray and canvas

### The tray is missing

**Enable SDX Tray** is client-scoped, so turn it on for the affected user and
reload. Also check the browser window is wide enough, and that no theme or
module is covering the left edge.

### Party tab is empty

The tray reads the currently controlled and owned tokens plus the configured
party state. Select a token, add world Player actors to a Party actor, or let
the GM tray show NPCs, depending on what you're after.

### Marching mode blocks the wrong token

Confirm the crown tool points at the leader you intended and that every client
has received the current marching state. Toggle Marching Mode off and on after
an update if a stale client held onto old state.

### Drawing hotkey activates while editing text

Keep **Block Drawing While Typing** enabled. Change or disable the hold-to-draw
keybinding under Foundry's Configure Controls when it collides with another
module.

---

## Maps, hexes, and dungeons

### Hex tiles do not align

Run **Format Map** before painting or procedural generation. Choose the hex
orientation and dimensions you want, and leave the scene grid alone afterward
unless you're rebuilding the tile layout too.

### Format Map produced an unexpected cell count

Update to a current release. Older builds added extra fit and buffer space.
Current formatting sizes the scene to the width and height you selected, with
Foundry's normal half-hex edge behavior where it applies.

### Map generator opens but Import Scene fails

Confirm the generator is running the bundled local build that capture requires.
Wait for its canvas to finish rendering. Reopen the generator rather than
importing from a stale window, and check the console for a missing render
transform or geometry warning.

Some generators degrade to an image-only import when structured geometry is
unavailable, which leaves walls, doors, or levels out.

### Generated dungeon changed the wrong floor

Generation acts on the current scene and level context, so activate the correct
scene and elevation level first. Duplicate important scenes before generating.

### Hex Fog does not reveal around movement

Confirm the scene is hexagonal and Hex Fog is active, then check **Hex Fog:
Default Reveal Radius**. Shader effects are optional, and disabling **Enable Fog
Effects** should buy back performance while the underlying fog state keeps
working.

### A journal pin is hard to click

Try **Enable Pixel perfect on Pins** and adjust the alpha threshold. For
hex-sized image pins, use **Fit to hex grid** in the Pin Style Editor.

---

## Carousing

### A result changed coins but not XP/Luck/notes

Original-mode mechanical outcomes go through the GM-only **Apply** action.
Review its preview and confirm. Narrative outcomes get appended to character
notes rather than guessed into unsupported mechanics.

### Percentage loss is larger than carried coins

When **Carousing Wealth Base** includes gear, the loss can be calculated from
total valued wealth while collection still comes out of coins. Whatever remains
unpaid becomes a zero-slot **Carousing Debt** item.

### Imported table columns are wrong

Use the supported labeled or pipe-separated formats and review the editor
afterward. Linking an Original-format table to an Expanded section, or the
reverse, is not a conversion SDX can make for you.

---

## Reporting a bug

Include the Foundry version and build, the Shadowdark system version, the
Shadowdark Extras version, and your active dependency versions. List any other
active modules likely to touch the same sheet, chat, or canvas workflow. Paste
the first relevant console error with its stack trace. Then give exact steps,
the expected result, and what actually happened, and say whether it reproduces
as GM, as player, or both.

Report it through
[GitHub issues](https://github.com/DimitroffVodka/shadowdark-extras/issues) or
the [Discord community](https://discord.gg/ZBtQ9ub7Mn).

---

**Related:** [Installation & Setup](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Installation-and-Setup) ·
[Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference)
