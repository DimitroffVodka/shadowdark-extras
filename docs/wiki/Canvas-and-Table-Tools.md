# Canvas & Table Tools

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

SDX includes several smaller table-facing utilities: a selected-token toolbar,
light tracker, sketch tools, group roller, scene overlay broadcaster, scene
navigation, and portable scene archives.

---

## Token Toolbar

The toolbar is off by default. Enable it in settings and reload.

For the selected token it can show:

- actor name and portrait;
- level;
- AC;
- Luck for Player actors;
- current/max HP with direct current-HP editing;
- equipped items;
- Active Effects;
- focus spell icons;
- duration spell icons and remaining duration;
- a **SHEET** shortcut.

World settings choose GM/player/both visibility, combat-only mode, and whether
effect/equipped icons appear.

Clicking supported spell/effect icons opens or ends the associated tracked
entry according to ownership. This is an actor HUD, not a substitute for
targeting or token controls.

## Light Source Tracker

Open the flame tool from the tray. It gathers active light-source items and
supports Party actors in addition to normal Shadowdark actors.

Use it to review remaining sources and toggle eligible lights. Visual torch
animations are configured separately in [Animation FX](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX).

## Drawing Tools

Click the pencil tool. The toolbar remembers per-client:

- sketch or stamp mode;
- symbol/stamp style;
- symbol size;
- line width and style;
- color;
- opacity;
- timed erase;
- toolbar position.

The default hold-to-draw key is `L`. Release it to finish the stroke.

World settings control player drawing and timed-erase delay. Client settings can
disable the hotkey or block it while typing.

## SDX Roller

The dice tool builds a group check:

1. Filter the actor portrait strip.
2. Click to add participants.
3. Right-click an actor to make it a contestant on the opposing side.
4. Choose the ability/roll type.
5. Set a DC.
6. Choose whether to show the DC, hide names, or use the average.
7. Add an optional custom label.
8. Roll.

Participants and contestants are visually separated by **Vs**. The result and
recap views summarize the group outcome without requiring the GM to open every
sheet.

Party camping activities also use this roller when a task header is clicked or
the GM runs **Begin Rest**. Their configured activity image becomes the roll
banner. They do not appear as standalone roll types in the generic roller
because the Party sheet supplies the assigned actors, selected abilities, DC,
campfire disadvantage, and rest context.

![The SDX Roller configured for a Strength check with participants and an opposing contestant](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/sdx-roller.png)

## ToM scenes and video overlays

The tray's GM **Scenes** tab manages ToM presentation scenes:

- create a scene card with image/video background;
- organize cards in folders;
- edit or delete;
- click a card to broadcast it;
- stop broadcasting;
- manage active video overlays.

Players receive the broadcast through the socket-backed player view. The
top-center Scene Navigation Bar lets the GM move to the previous/next ToM scene
inside the same folder, wrapping at the ends and using the next scene's entrance
animation.

ToM scenes are presentation records, distinct from Foundry canvas Scenes.

## Formation and marching

The formation and marching-order tools are documented with the party workflow:
[The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools).

## Scene export

SDX Scene Exporter creates a ZIP archive containing:

- Scene data and embedded documents;
- referenced Actors and Journals;
- referenced image assets it can fetch;
- SDX hex-tooltip data;
- a manifest with Foundry/system versions and counts.

The exported archive is saved under Foundry user data's `exported-scenes`
location and can be moved to another world.

## Scene import

Import accepts an SDX `.zip` (and the module's supported text-wrapped form):

1. assets upload under `imported-scenes/<safe-scene-name>/assets`;
2. referenced world documents are created with unique names;
3. UUID/path references are remapped;
4. the Scene is created with a unique name;
5. SDX hex data is attached under the new Scene ID.

Owned items embedded in imported Actors are not separately imported as world
Items, avoiding redundant duplicates.

Import creates new documents; it does not merge into an existing same-named
Scene.

## Safety

- Scene archives can contain copyrighted assets. Share only material you are
  allowed to redistribute.
- Import is a document-creating operation; back up the destination world first.
- External or protected asset URLs may not be fetchable by the exporter.
- Module-specific flags from absent modules can be preserved but remain inert
  until their module is installed.

---

## Troubleshooting

**Toolbar does not appear.** Enable it, reload, select one token, and check its
visibility/combat-only settings.

**Drawing hotkey conflicts.** Change the key under Configure Controls or disable
the SDX drawing hotkey.

**Roller buttons do not respond.** Update SDX; the current ApplicationV2
template includes explicit actions and non-submitting buttons.

**Players do not receive a ToM broadcast.** Confirm socketlib, an active GM,
and the player's module version.

**Scene export misses an image.** The source may be cross-origin, protected, or
unreadable. Replace it with a Foundry-hosted user-data asset and export again.

**Import says JSZip is missing.** Reload; `libs/jszip.min.js` is declared by the
module manifest.

---

**Related:** [The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools) ·
[Map Generators](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Map-Generators) ·
[Troubleshooting](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Troubleshooting)
