# Party View

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

Party View is the live roster in the SDX Tray — every eligible token on the current scene, with health, armor, and luck at a glance. Click a card to jump to that character.

> The Tray lives on the left edge of the canvas. The chevron expands it.

![Party cards as players see them — HP bar + AC + luck, monsters bar-only](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/sdx-tray-party-view-player.webp)
*What players see — their party's numbers plus each monster's health bar.*

![Party cards as the GM sees them — full AC and HP on every card](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/sdx-tray-party-view-gm.webp)
*What the GM sees — full AC and HP on every card, player or monster.*

---

## Use it

1. Put your party (and any monsters/NPCs) on the current scene.
2. Open the Tray → **Party** tab. The heading comes from the world **Party Name**.
3. **Click** a card to select that token.
4. **Double-click** a card to center the canvas on it — works even for tokens you don't own.
5. Click the **feather** on a card to open its sheet.
6. Read **player cards** by their HP bar, **AC**, and **luck chips** — all three sync to every client.
7. Read **monster/NPC cards**: players see only the **HP bar** (percent), never exact HP or AC — even when the GM has revealed them. The GM sees full numbers.
8. GM: use the **eye** in the NPC header to hide the whole monster section from players. Hidden tokens never appear for players at all. Each player's own **Show NPCs** and **Show Health Bars** remain client-side.

---

## What each card shows

- **Portrait** with a wounded overlay that grows as HP drops and a skull when the actor is down.
- **Name + level**, plus the feather shortcut to the sheet.
- **Player cards:** HP as `current / max` with bar, AC chip, and luck chips.
- **Monster/NPC cards:** HP bar only for players; GM sees `current / max`, percent, and AC.

---

## Settings

| Setting | Scope | What it does |
|---|---|---|
| **Party Name** | World | Heading text in the Party tab |
| **Show Party Tab** | Client | Show or hide the Party tab for you |
| **Show Health Bars** | Client | Show or hide the HP bars for you |
| **Show NPCs** | Client | Show monsters/NPCs in your own Party view |
| **Hide NPCs from Players** | World (hidden) | GM eye-toggle — hides the entire monster section from every player and survives reloads |

<details>
<summary>How it stays in sync</summary>

The GM broadcasts `sdxTrayPartyStats` on every tray render (deduped) and answers a joiner's `sdxTrayRequestPartyStats` so late joins don't miss the first snapshot. Player cards keep full `hp {value,max,percent} + ac + luck`; monster cards are trimmed to `hp {percent}` only on the wire. That's why the bar and wounded overlay still work without leaking numbers. Hidden tokens (`token.document.hidden`) are excluded from the player roster even though `canvas.tokens.placeables` still contains them.

</details>

<details>
<summary>Files</summary>

`scripts/tray/TraySD.mjs` (snapshot + merge, `centerOnToken`, visibility setting) · `scripts/tray/party-bindings.mjs` (card click/dblclick/open-sheet) · `scripts/tray/TrayApp.mjs` (mixin) · `templates/sdx-tray/tray.hbs` · `styles/sdx-tray.css`

</details>

---

**Related:** [The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools) · [Character Sheets](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets) · [Canvas & Table Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Canvas-and-Table-Tools)
