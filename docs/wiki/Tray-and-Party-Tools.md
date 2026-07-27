# The SDX Tray & Party Tools

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

The SDX Tray is the module's persistent control surface. It sits on the left
edge of the canvas and combines a scene/party browser with the launch buttons
for most map and session tools.

---

## Opening and changing the view

Use the chevron on the tray handle to expand or collapse it. The adjacent view
button cycles the primary token/party view.

Which tabs appear depends on role, settings, scene grid, and feature access:

| Tab | Who sees it | Purpose |
|---|---|---|
| **Token** | Players | The selected or owned character, HP, and sheet shortcut |
| **Scenes** | GM | ToM scene/overlay cards, folders, editing, and broadcast |
| **Party** | Configurable | Player/NPC token cards, HP, selection, sheet access |
| **Pins** | GM | Search, organize, edit, ping, and reveal journal pins |
| **Notes** | Everyone with access | Notes attached to Tokens, Tiles, Walls, Lights, and Sounds |
| **Hexes** | GM | Format and paint hex maps, POIs, and procedural terrain |
| **Dungeons** | GM; opted-in players | Paint/generate dungeon floors, walls, doors, biomes, and decor |
| **Decor** | GM | Place and manage decorative assets |

The tray is client-scoped: one user may hide the tray or Party tab without
changing another user's screen.

![The expanded SDX Tray in Party view with player and NPC cards](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/sdx-tray-party-view.png)

## Tool rail

The narrow button rail changes with your role and the active tab.

| Tool | Purpose |
|---|---|
| **Choose Party Leader** | Select the token that drives Marching Mode |
| **Marching Mode** | Restrict movement to the leader/following workflow |
| **Formation Spawner** | Place selected tokens in a chosen formation |
| **Add Pin / Pin List** | Create and manage journal pins |
| **Light Source Tracker** | Inspect and control active light sources |
| **Video Overlays** | Manage ToM scene broadcasts when enabled |
| **Carousing** | Open the shared carousing overlay |
| **Drawing Tools** | Open the SDX sketch/symbol toolbar |
| **Map Generators** | Open the six-generator Maphub launcher |
| **Coordinates** | Toggle the scene coordinate overlay |
| **Hex Tooltip / Hexplorer** | Inspect keyed hex data on hex scenes |
| **Hex Fog** | Toggle exploration fog; right-click for effects/options |
| **Solo Hex Mode** | Run solo-oriented hex exploration controls |
| **SDX Roller** | Build a multi-participant dice check |
| **POI transform controls** | Undo/redo, resize, rotate, or mirror POIs while painting |

Map tools are covered in [Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons);
general utilities are covered in
[Canvas & Table Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Canvas-and-Table-Tools).

---

## Party view

Party view is a live canvas roster, not the same thing as a Party actor. It
lists eligible tokens on the current scene:

- player cards show portrait, name, level, HP, and a sheet shortcut;
- the GM can include NPCs with the per-client **Show NPCs** setting;
- the GM can hide or reveal the NPC section to players;
- clicking a portrait selects/pans to the token;
- HP bars can be hidden per client.

The world **Party Name** setting controls the heading.

## Party actors

SDX also adds **Party** to the Create Actor type list. Internally this is a
flagged NPC using the dedicated Party sheet, so it remains compatible with the
Shadowdark actor model while gaining group-specific behavior.

Create it from the Actors sidebar:

1. Click **Create Actor**.
2. Choose **Party**.
3. Open the new Party sheet.
4. Drag world Player actors into the Members tab.

To return to Party Management later, open the **Actors** sidebar and
double-click that Party actor. The tray's **Party** view is a live scene roster;
it is not the Party Management sheet.

Only world Player actors can become player members. Compendium actors must be
imported first. NPC entries can be managed with their spawn counts for encounter
placement.

### Party sheet tabs

| Tab | What it does |
|---|---|
| **Members** | Roster, HP/AC/level/slots/abilities/effects, place tokens, award XP/coins, sync light |
| **Inventory** | Shared items and treasury, slot maximum, transfers, even coin division |
| **Travel** | Assign camping tasks, resolve a complete rest, roll weather, and choose a travel speed |
| **Description** | Shared party notes |

### Group actions

The Members tab can:

- place all, player-only, or NPC-only member tokens;
- award the same XP to each eligible member;
- award coins to every member;
- synchronize a placed Party token with the brightest active member light.

The Inventory tab can:

- hold shared items and treasury coins;
- set the party's maximum inventory slots;
- transfer an item to a selected member;
- divide treasury coins evenly among eligible player members, leaving the
  remainder in the treasury.

### Travel assignments and task rolls

The Party sheet's **Travel** tab is the entry point for travel speed, weather,
camping tasks, and full rests. The default speeds are **Slow**, **Normal**, and
**Fast**.

Assign a character with either the task/ability dropdowns or by dragging their
portrait onto a task. Players can only assign characters they own, and only
Party members are accepted. A player's selection is validated against character
ownership and sent to the active GM for the write, so the Party actor itself
does not need player ownership. This requires an active GM and SocketLib.
Multiple characters can perform the same task. The GM can set a separate DC
for each task; the default is 12.

Click a task header to make an isolated task roll. This opens the cinematic SDX
Roller for the assigned characters but does not apply camping supplies, rest
recovery, or task rewards. The activity's configured banner image appears in
that roll overlay and recap. Camping tasks are launched from the Party sheet;
they are not additional choices in the generic SDX Roller.

Edit task names, allowed abilities, descriptions, campfire requirements, and
banner art with **Configure Travel Activities**. Edit the speed list with
**Configure Travel Speeds**.

### Complete camping and rest

The GM can click **Begin Rest** on the Travel tab to resolve the complete
procedure:

1. Choose the participating campers, task and ability for each, and any
   task-specific choice.
2. Light a campfire with three pooled unused torches, assign someone to gather
   Firewood, or proceed without a fire.
3. Resolve each occupied task as one grouped SDX roll. Firewood resolves first
   when it is needed for the campfire.
4. Resolve the additional checks for an interrupted rest when selected.
5. Apply successful Hunt results before checking the party's food, then consume
   one ration per eligible camper.
6. Optionally advance world time eight hours, apply rest recovery and task
   rewards, and post one summary card.

Torch spending is deterministic: unused torches in Party inventory are used
first, followed by camper inventories in the order shown in the planner.
Active/burning torches are ignored. Rations are taken from each camper's own
inventory first, then Party inventory, then another camper's pooled supply.

Without a campfire, tasks marked with the flame icon roll with disadvantage
during the complete procedure. A successful Firewood check establishes the
campfire before the remaining tasks. The temporary Campfire item and Party-token
light are cleaned up when the rest finishes.

A successful full rest restores HP to maximum, refreshes lost spells, expended
class abilities, and lost wand spells, and clears Unconscious. A ration is
required. If the rest was interrupted, a camper also needs a successful
interruption check unless their Bed Down task succeeded.

| Task | Automated result on success |
|---|---|
| **Bed Down** | Bypasses the camper's check when this rest is interrupted |
| **Cook** | Every participating camper who eats a ration gains +2 ordinary HP, capped at two above maximum |
| **Craft** | Creates one torch or `2d4` chosen ammunition, or repairs selected broken mundane gear |
| **Entertain** | Grants Luck to the selected other camper |
| **Firewood** | Establishes the campfire without spending torches |
| **Hunt** | Adds `1d4` rations; unavailable after pushing during that day's travel |
| **Keep Watch** | Records the chosen protected half and reports that the party cannot be surprised; the GM enforces surprise during encounters |
| **Predict** | Banks a prompt to reroll the next Party weather result after it is revealed |

### Party weather

The **Weather** button draws the Party's configured RollTable. The adjacent
gear button (GM only), or **Configure Weather Table** in module settings, selects
any available world or compendium RollTable. With no selection—or if the
selected table is unavailable—SDX uses its built-in Shadowdark `1d6` weather
check.

The selector chooses a table; edit its entries through Foundry's normal
RollTable sheet. To customize a read-only compendium table, import/copy it into
the world, edit the world copy, and select that copy. A successful Predict task
offers its reroll immediately after the next weather result appears.

Player-triggered Predict consumption is likewise validated and written by the
active GM.

---

## Marching Mode

Marching Mode is GM-controlled and world-synchronized:

1. Use the crown tool to choose the party leader.
2. Enable the walking-person tool.
3. Move the leader to drive the marching workflow.
4. Turn the mode off for free movement.

The leader's owner is allowed to move the leader. Other movement is restricted
while marching. If ownership or order changes, reselect the leader so every
client receives an unambiguous state.

## Formation Spawner

Select the tokens to place, open **Formation Spawner**, choose the formation and
grid size, and place it on the canvas. The current formation is shared as world
state so the GM controls the authoritative placement.

Use it for marching order, doorway stacks, ranks, rings, or encounter setup. It
creates/moves token positions; it does not change initiative or party
membership.

## Light tracking

The flame tool opens SDX's light-source tracker, with a fallback to the
Shadowdark system tracker if needed. Party actors are included:

- active member lights can be inspected;
- the Party sheet can sync its Party token to the brightest member source;
- updates to member light items resynchronize relevant Party tokens.

Torch visuals are separate from light emission. See
[Animation FX](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Animation-FX).

---

## Troubleshooting

**Tray is missing.** Enable the client setting **Enable SDX Tray** and reload.

**Party option is not in Create Actor.** Reload the world; the type is injected
during module initialization.

**A character cannot be dropped into a Party.** Import compendium actors into
the world first and use a Player actor.

**An NPC is visible to players in the tray.** Use the eye control in the NPC
section to hide it. The GM's own **Show NPCs** client setting only controls
whether the GM includes NPCs in their tray.

**Marching Mode blocks an unexpected player.** Re-select the crown leader and
toggle Marching Mode after every client has loaded the current module version.

**Player dungeon painting does not commit.** The world setting must be enabled
and an active GM must be connected.

---

**Related:** [Canvas & Table Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Canvas-and-Table-Tools) ·
[Hexcrawls & Dungeons](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Hexcrawls-and-Dungeons) ·
[Character Sheets](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets)
