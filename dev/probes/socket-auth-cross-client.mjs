// PROBE: Verify the GM auth gate fires when a non-owner player invokes a handler.
// Two parts:
//   1. GM side (default targetUser): register the probe handler.
//   2. Player side (set targetUser to player name): call the probe.
// Then check GM console for "Unauthorized" warning.
//
// Replace ownedItemUuid / notOwnedItemUuid with real items in your world.

// --- PART 1: run on GM side ---
const SDX = game.modules.get("shadowdark-extras");
if (!SDX?.socket) return { error: "no module.socket" };

const probeName = "__sdxXClientAuthProbe";
SDX.socket.register(probeName, async function(itemUuid) {
  const sender = game.users.get(this.socketdata?.userId);
  if (!sender) return { phase: "REJECTED-no-sender" };
  const item = itemUuid ? await fromUuid(itemUuid) : null;
  if (!sender.isGM && (!item || !item.testUserPermission(sender, "OWNER"))) {
    console.warn(`shadowdark-extras | Unauthorized test from ${sender.name}`);
    return { phase: "REJECTED-unauthorized", senderName: sender.name };
  }
  return { phase: "AUTHORIZED", senderName: sender.name };
});

return { registered: true, probeName, instructions: "Now run from a player client with executeAsGM" };

// --- PART 2: run on Player side (separate evaluate call with targetUser=player) ---
// const ownedItemUuid    = "Actor.<actorId>.Item.<itemId>";   // an item the player owns
// const notOwnedItemUuid = "Actor.<otherId>.Item.<itemId>";   // an item the player does NOT own
// const SDX = game.modules.get("shadowdark-extras");
// const owned = await SDX.socket.executeAsGM("__sdxXClientAuthProbe", ownedItemUuid);
// const notOwned = await SDX.socket.executeAsGM("__sdxXClientAuthProbe", notOwnedItemUuid);
// return { owned, notOwned };
