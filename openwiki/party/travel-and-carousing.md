---
type: gameplay workflow
title: Party Travel, Camping, and Carousing
description: Party Actor state, authorization-aware travel mutations, camping rules, and journal-backed carousing sessions.
tags: [party, travel, carousing]
---
# Party Travel, Camping, and Carousing

A Party is a Shadowdark NPC with `flags.shadowdark-extras.isParty` and member IDs/UUIDs in `members`. `PartySheetSD` composes roster, inventory, XP, travel, drop-transfer, and token-placement mixins. Members can be world IDs or compendium UUIDs.

Travel state persists on the Party Actor: `travelAssignments`, `travelSelections`, and `campingWeatherReroll`. `PartyTravelMutationsSD.mjs` keeps planning/authorization pure. The authoritative path validates member ownership for the requesting user, then applies document writes. GM clients apply locally; players use the GM socket; an owner fallback applies only where allowed. UUIDs with dots require full-object replacement for `travelSelections`, not dotted update paths.

`CampingRulesData.mjs` is Foundry-global-free and defines task defaults/legacy normalization. `CampingRestApp` and roller data consume it. Marching behavior is documented in [Encounter Tools](../combat/encounter-tools-and-roll-hooks.md).

Carousing uses Journals as durable stores: `__sdx_carousing_sync__` holds participants/drops/session; `__sdx_carousing_tables__` holds editable original/expanded tables; logs use a marked Journal. Session state includes selected table/tier, confirmations, phase, results, and modifiers. Foundry forced deletion is required for removing nested flag keys because ordinary flag updates merge objects. Overlay actions resolve rolls, persist outcomes, apply wealth/renown/notes, and log results. Marching and Tray call the overlay through global callbacks to avoid direct import cycles.

**Validate:** `npm test -- dev/tests/party-travel-rolls.test.mjs dev/tests/party-sheet.test.mjs dev/tests/carousing-log.test.mjs dev/tests/carousing-wealth-renown.test.mjs dev/tests/carousing-pipe-import.test.mjs`.