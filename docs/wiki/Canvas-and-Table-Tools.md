# Canvas & Table Tools

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

The smaller table-facing utilities live here: a selected-token toolbar, the
light tracker, sketch tools, a group roller, the scene overlay broadcaster,
scene navigation, and portable scene archives.

---

## Token Toolbar

Off by default. Enable it in settings and reload.

For the selected token it can show the actor name and portrait, level, AC, Luck
on Player actors, current and max HP with direct current-HP editing, equipped
items, Active Effects, focus spell icons, duration spell icons with time
remaining, and a **SHEET** shortcut.

World settings pick GM, player, or both for visibility, plus combat-only mode
and whether effect and equipped icons appear at all.

Clicking a supported spell or effect icon opens or ends the associated tracked
entry, subject to ownership. Treat it as an actor HUD. Targeting and token
controls stay where they always were.

## Light Source Tracker

Open the flame tool from the tray. It collects active light-source items and
handles Party actors alongside normal Shadowdark actors.

Use it to review what's still burning and toggle eligible lights. Visual torch
animations are configured elsewhere, in
[Animation FX](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX).

## Drawing Tools

Click the pencil tool. The toolbar remembers per client: sketch or stamp mode,
symbol/stamp style, symbol size, line width and style, color, opacity, timed
erase, and its own position on screen.

The default hold-to-draw key is `L`. Let go to finish the stroke.

World settings control player drawing and the timed-erase delay. Client settings
can disable the hotkey outright, or just block it while you're typing.

## SDX Roller

The dice tool builds a group check:

1. Filter the actor portrait strip.
2. Click to add participants.
3. Right-click an actor to make it a contestant on the opposing side.
4. Choose the ability or roll type.
5. Set a DC.
6. Choose whether to show the DC, hide names, or use the average.
7. Add an optional custom label.
8. Roll.

Participants and contestants get separated visually by **Vs**. The result and
recap views summarize the group outcome, which saves the GM opening eight
sheets.

Party camping activities run through this same roller when you click a task
header or the GM runs **Begin Rest**. The configured activity image becomes the
roll banner. Those tasks stay off the generic roller's list of roll types
because the Party sheet is what supplies the assigned actors, chosen abilities,
DC, campfire disadvantage, and rest context.

![The SDX Roller configured for a Strength check with participants and an opposing contestant](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/sdx-roller.webp)

## ToM scenes and video overlays

The tray's GM **Scenes** tab manages ToM presentation scenes. Create a scene
card with an image or video background, file cards into folders, edit or delete
them, click one to broadcast, stop broadcasting, and manage the active video
overlays.

Players receive the broadcast through the socket-backed player view. The
top-center Scene Navigation Bar moves the GM to the previous or next ToM scene
inside the same folder, wrapping at the ends and using the next scene's entrance
animation.

ToM scenes are presentation records. Foundry canvas Scenes are separate
documents.

## Formation and marching

The formation and marching-order tools are documented alongside the party
workflow in
[The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools).

## Scene export

SDX Scene Exporter builds a ZIP archive holding the Scene data and its embedded
documents, the referenced Actors and Journals, whichever referenced image assets
it can fetch, SDX hex-tooltip data, and a manifest recording Foundry and system
versions plus counts.

Archives land under the `exported-scenes` location in Foundry user data, ready
to move to another world.

## Scene import

Import takes an SDX `.zip`, and the module's supported text-wrapped form:

1. Assets upload under `imported-scenes/<safe-scene-name>/assets`.
2. Referenced world documents are created with unique names.
3. UUID and path references get remapped.
4. The Scene is created with a unique name.
5. SDX hex data is attached under the new Scene ID.

Owned items embedded in imported Actors stay embedded rather than being
duplicated as world Items.

Every import creates new documents. An existing Scene with the same name is left
alone.

## Safety

- Scene archives can contain copyrighted assets. Share only material you're
  allowed to redistribute.
- Import creates documents, so back up the destination world first.
- External or protected asset URLs may be unreachable for the exporter.
- Module-specific flags from absent modules can survive the trip, but they stay
  inert until their module is installed.

---

## Troubleshooting

**Toolbar does not appear.** Enable it, reload, select one token, then check its
visibility and combat-only settings.

**Drawing hotkey conflicts.** Rebind it under Configure Controls, or turn the
SDX drawing hotkey off.

**Roller buttons do not respond.** Update SDX. The current ApplicationV2
template declares explicit actions and non-submitting buttons.

**Players do not receive a ToM broadcast.** Confirm socketlib, an active GM, and
the player's module version.

**Scene export misses an image.** That source is probably cross-origin,
protected, or unreadable. Swap it for a Foundry-hosted user-data asset and
export again.

**Import says JSZip is missing.** Reload. `libs/jszip.min.js` is declared right
in the module manifest.

---

**Related:** [The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools) ·
[Map Generators](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Map-Generators) ·
[Troubleshooting](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Troubleshooting)
