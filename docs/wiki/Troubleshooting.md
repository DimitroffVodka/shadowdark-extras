# Troubleshooting

[← Wiki home](Home.md)

Symptoms, likely causes, and fixes. Feature pages include more specific advice;
this page covers problems that cross the module.

---

## Start here

### Nothing from Shadowdark Extras appears

1. Confirm **Shadowdark Extras** is enabled for the current world.
2. Confirm Foundry shows every required dependency as installed and enabled:
   socketlib, libWrapper, Sequencer, portal-lib, and TokenMagic FX.
3. Open the browser console with `F12`.
4. Reload and find the first error mentioning `shadowdark-extras`. The first
   error is normally more useful than later cascading errors.
5. Confirm the release is complete. A missing imported `.mjs` file aborts the
   entire module at startup.

### UI appears but is unstyled or uses old controls

Hard-refresh with `Ctrl+Shift+R`. A normal Foundry reload can retain cached CSS,
templates, or JavaScript after an update.

### A setting changed but nothing happened

Check [Settings Reference](Settings-Reference.md). Settings marked **Reload**
attach their behavior at startup. Reload the world after changing them.

---

## Dependencies and animations

### Animation preset has no preview or does nothing

- Confirm Sequencer is active.
- Confirm a JB2A pack is installed and active.
- In **Configure Animations**, verify the preset path resolves in the Sequencer
  database.
- Select a token before pressing preview.
- Confirm the category and the item's own override are enabled.
- Check the per-client sound toggle/volume if visuals work but sound does not.

The `psfx` module is optional. A preset that references psfx can animate
silently when the sound pack is absent.

### An effect plays twice

Automated Animations and SDX may both be configured for the item. Keep the SDX
AA integration enabled, then check whether a second module has its own chat or
workflow animation hook.

### Old chat messages animate or run macros after reload

Current versions guard chat-history re-renders. If this still happens, confirm
the client actually updated to the latest module version and hard-refresh.

---

## Multiplayer and permissions

### A player button does nothing

Many cross-owner changes are sent to an active GM over socketlib. Confirm:

- a GM is connected;
- socketlib is active;
- the player owns the source actor/token;
- the GM has access to the active scene and target documents.

### Player cannot see the Dungeons tab

This is the default. The GM must enable **Allow Players to Paint Dungeons**.
Painting still requires a connected GM to perform the scene mutation.

### Player can see a tool but cannot alter the scene

Visibility and authority are separate. Map generation, pin management, scene
import, Regions, and destructive cleanup remain GM actions.

---

## Combat and item automation

### No enhanced damage card appears

- Open **Configure Combat Settings** and enable **Show Damage Card**.
- If only the GM sees it, enable **Show Damage Card for Players**.
- If it was a miss, check **Hide Damage Card on Failed Attack**.
- Confirm the item produced a Shadowdark attack/damage chat workflow that SDX
  recognizes.

### Damage applies immediately when I expected approval

**Auto-Apply Damage** is on by default. Turn it off in Combat Settings. Use
**GM Only Apply Damage** if the card should remain visible but only the GM may
commit it.

### Target or range warnings do not appear

Both checks default to **None**. Set each to **Warn** or **Block** in Combat
Settings. SDX treats Close as 5 ft and Near as 30 ft for this check; Far is not
blocked by distance.

### A spell casts but its configured automation does not run

- Confirm **Enhance Spells** is on and reload if you just enabled it.
- Open the item's **Activity** tab and verify its configuration was saved.
- For a Scroll or Wand, confirm its referenced spell UUID still resolves.
- For a Run-as-GM macro, keep caster and target tokens on a scene the receiving
  client can resolve. Cross-scene token placeables cannot be manufactured.
- Use Medkit if the actor holds an older copy of an SDX-enhanced item.

### Focus damage happens at the wrong time

Current behavior applies the per-turn result only after a successful native
focus check. Confirm the spell is marked as a focus spell in Shadowdark data and
that old copied items have been refreshed through Medkit.

---

## Sheets, inventory, and compendiums

### A sheet crashes while opening an imported weapon or armor item

Update to a current SDX release. The module includes a Foundry v14 compatibility
repair for frozen/corrupted Shadowdark compendium index data.

### Medkit reports no updates

- Confirm **Show Medkit Icon** is on.
- Confirm the actor owns a Spell, Scroll, or Wand that can be matched.
- A Scroll/Wand must have a valid referenced spell UUID.
- The source pack must be registered; the SDX item pack is always registered.
- A same-named unrelated item is not necessarily a valid source match.

### Container contents behave unexpectedly

- Nested containers can be disabled separately.
- Items must belong to the same actor for normal owned-container moves.
- Hold `Ctrl` where the UI indicates move-versus-copy behavior.
- Do not delete a container without first deciding what should happen to its
  contents.

### Unidentified information is visible to the GM

Expected. The feature hides the true name/description from players while
preserving GM visibility. Identification uses Shadowdark 4.x's native identified
state.

---

## Tray and canvas

### The tray is missing

**Enable SDX Tray** is client-scoped. Turn it on for the affected user and
reload. Also check that the browser is wide enough and no theme/module is
covering the left edge.

### Party tab is empty

The tray reads the current controlled/owned tokens and configured party state.
Select a token, add world Player actors to a Party actor, or allow the GM tray
to show NPCs as appropriate.

### Marching mode blocks the wrong token

Confirm the crown tool points to the intended leader and every client has
received the current marching state. Toggle Marching Mode off and on after an
update if a stale client retained old state.

### Drawing hotkey activates while editing text

Keep **Block Drawing While Typing** enabled. Change or disable the hold-to-draw
keybinding under Foundry's Configure Controls if it conflicts with another
module.

---

## Maps, hexes, and dungeons

### Hex tiles do not align

Use **Format Map** before painting or procedural generation. Choose the intended
hex orientation and dimensions, and do not change the scene grid afterward
without rebuilding the tile layout.

### Format Map produced an unexpected cell count

Update to a current release. Older builds added extra fit/buffer space. Current
formatting sizes the scene to the selected width and height, with Foundry's
normal half-hex edge behavior where applicable.

### Map generator opens but Import Scene fails

- Confirm the generator is using the bundled local build required for capture.
- Wait for the generator canvas to finish rendering.
- Try reopening the generator rather than importing from a stale window.
- Check the console for a missing render transform or geometry warning.

Some generators can degrade to an image-only import if structured geometry is
unavailable; walls, doors, or levels may then be absent.

### Generated dungeon changed the wrong floor

Generation acts on the current scene and level context. Activate the correct
scene and elevation level first. Duplicate important scenes before generation.

### Hex Fog does not reveal around movement

- Confirm the scene is hexagonal and Hex Fog is active.
- Check **Hex Fog: Default Reveal Radius**.
- Shader effects are optional; disabling **Enable Fog Effects** should improve
  performance without disabling the underlying fog state.

### A journal pin is hard to click

Try **Enable Pixel perfect on Pins** and adjust the alpha threshold. For
hex-sized image pins, use **Fit to hex grid** in the Pin Style Editor.

---

## Carousing

### A result changed coins but not XP/Luck/notes

Original-mode mechanical outcomes use the GM-only **Apply** action. Review its
preview and confirm it. Narrative outcomes are appended to character notes
rather than guessed into unsupported mechanics.

### Percentage loss is larger than carried coins

If **Carousing Wealth Base** includes gear, the loss can be based on total
valued wealth while collection still comes from coins. Any unpaid balance
becomes a zero-slot **Carousing Debt** item.

### Imported table columns are wrong

Use the supported labeled or pipe-separated formats and review the editor.
Linking an Original-format table to an Expanded section, or vice versa, is not a
valid conversion.

---

## Reporting a bug

Include:

- Foundry version and build;
- Shadowdark system version;
- Shadowdark Extras version;
- active dependency versions;
- other active modules likely to touch the same sheet/chat/canvas workflow;
- the first relevant console error and stack trace;
- exact steps, expected result, and actual result;
- whether the problem reproduces as GM, player, or both.

Report it through [GitHub issues](https://github.com/DimitroffVodka/shadowdark-extras/issues)
or the [Discord community](https://discord.gg/ZBtQ9ub7Mn).

---

**Related:** [Installation & Setup](Installation-and-Setup.md) ·
[Settings Reference](Settings-Reference.md)
