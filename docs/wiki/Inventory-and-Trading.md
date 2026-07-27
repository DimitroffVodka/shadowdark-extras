# Inventory & Trading

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

SDX extends the Shadowdark inventory with containers, identification, visual
rules, multi-selection, player transfers, party storage, and quick coin tools.

![An enhanced Player inventory showing equipped gear, carried gear, slots, coins, and trading](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/inventory-sheet.png)

---

## Containers

An owned item can be marked **Is Container**. It can then hold other items from
the same actor and its own coins.

### Put an item in a container

1. Open the container or expand its inventory row.
2. Drag an owned item into the contents area.
3. Use the remove control to return it to the actor's top-level inventory.

The container shows its contents and total. The actor's slot calculation
accounts for the configured container behavior.

### Nested containers

**Allow Nested Containers** is on by default. Turn it off if bags should not go
inside other bags. SDX rejects a nested drop rather than leaving a half-moved
item.

Avoid circular structures. The UI is designed to prevent invalid nesting, but
flags edited by hand can still produce data the normal workflow would never
create.

### Unowned containers

An item not currently owned by an actor can keep a packed contents list for
distribution. Once owned, normal same-actor container rules apply. Follow the
UI's `Ctrl` hint when choosing copy versus move.

## Identification

Items use Shadowdark 4.x's native identified state. A GM can set:

- identified/unidentified;
- the name players see while unidentified;
- an unidentified description.

Players see the safe name/description until the item is identified. GMs retain
the true item display. The Identify spell and related API use the same native
state, avoiding a second conflicting identification flag.

## Multi-select and bulk delete

With the feature enabled:

- `Shift+Click` and `Ctrl+Click` select inventory rows;
- the bulk bar shows the count;
- delete asks for confirmation;
- clear selection exits without altering items.

Review container contents before bulk-deleting a container. Bulk deletion is a
real embedded-document delete, not an archive.

## Inventory Styles

Open **Configure Inventory Styles** to set row appearance by category. Shipped
categories include:

- magical;
- unidentified;
- container;
- Weapon;
- Armor;
- Scroll;
- other item types.

Each category has a priority so a row matching several rules has a deterministic
winner. Configure backgrounds/gradients, text and description colors, and
shadows. The editor applies a live preview to open Player, NPC, and Party
sheets.

## Item and coin transfer

SDX adds transfer/trade actions to owned character inventories.

### Direct transfer

Choose **Transfer to Player**, select a recipient actor, and confirm. The item is
removed from the source and added to the recipient when the authoritative
operation succeeds.

Coin transfer lets the sender choose GP, SP, and CP. SDX validates that the
source has the requested denomination before committing.

### Trade request

**Trade with Player** opens a two-party exchange:

- items;
- coins;
- accept/decline confirmation;
- socket-backed updates across clients.

An active GM may be required when ownership or document permissions prevent a
direct client update.

### Party transfers

Flagged Party actors are valid item/coin destinations:

- transfer from a Player to the Party treasury/inventory;
- transfer a Party item to a chosen member;
- divide Party coins evenly among eligible players.

Party treasury coins are stored as Party data rather than the NPC's normal
`system.coins`, so use the Party sheet or transfer workflow instead of editing
the underlying NPC fields.

## Add/remove coins

The Player sheet's **+** coin button accepts positive or negative adjustments.
It is intended for GM awards and quick corrections, not a transactional trade
audit.

## Native item drops

The module cooperates with Shadowdark's normal inventory and light-source
behavior. Use the scene/tray map tools for decorative props; do not substitute
an inventory transfer with a decorative Tile if the player needs to own the
actual Item.

---

## Troubleshooting

**Transfer target list is empty.** The source actor is excluded, Player targets
need an owner, and only valid Party actors are added as group destinations.

**Transfer waits forever.** Confirm socketlib and an active GM are present.

**Player can see the true item.** Verify the native identified state and test as
the player, not through the GM's sheet.

**Item disappeared inside a bag.** Open the container and use its remove
control. Check parent containers if nesting is enabled.

**Style is wrong for a magical container.** Compare category priorities in the
Inventory Styles editor.

---

**Related:** [Character Sheets](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets) ·
[The SDX Tray & Party Tools](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Tray-and-Party-Tools) ·
[Compendium Packs](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Compendium-Packs)
