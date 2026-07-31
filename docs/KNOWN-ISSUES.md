# Known issues

Maintainer-facing record of confirmed defects and open decisions that are **not
yet fixed**. Each entry is something measured in a running world, not suspected.

This file exists because GitHub Issues are disabled on this repository, and the
detailed analysis for these findings lives in local-only notes that are excluded
from version control — so without a committed record they are invisible to
anyone who does not have the original working copy.

**Adding an entry.** Only add something you have *measured*. Record what was
observed, on which Foundry and Shadowdark versions, and what the decision is —
not just that something looks wrong. Remove the entry in the same commit that
fixes it.

Entries are numbered to match `pending-decisions.md` in the local architecture
notes, where the fuller reasoning and the raw measurements live.

---

## 7. The three ActiveEffect condition hooks are a permanent no-op

**Found:** PR #17 (`ab9897a`), extracting `character-sheet/conditions.mjs`.
**Status:** confirmed, unfixed. **Pre-existing** — the code moved
byte-identically (735 + 35 lines, 0 differing), so the extraction cannot have
caused it.

`registerConditionEffectHooks()` in `scripts/character-sheet/conditions.mjs`
registers `createActiveEffect`, `deleteActiveEffect` and `updateActiveEffect`.
Each one does:

```js
if (actor.sheet?.rendered) {
    const html = actor.sheet.element;
    updateConditionToggles(actor, html);
}
```

and `updateConditionToggles` opens with:

```js
const $toggles = html.find('.sdx-condition-toggle');
if (!$toggles.length) return;
```

**`.sdx-condition-toggle` never exists inside the sheet.**
`injectConditionsToggles` adds only a container, a "Quick Conditions" header and
an "Add Condition" button. The per-condition toggles are built by
`showConditionsModal`, which appends to `BODY`.

Measured on a throwaway Player in world `0100`, Foundry 14.365 / Shadowdark
4.0.6:

| | |
| --- | --- |
| `.sdx-condition-toggle` inside the sheet, modal closed | **0** |
| inside the sheet, modal **open** | **0** |
| in the whole document, modal open | **114** |
| modal's `parentElement` | `BODY`; `sheet.element.contains(modal)` is `false` |

So the guard returns on its first line every time, for all three hooks.

**It does not throw.** Unlike the `injectHitBonusDisplay` case fixed in #16,
this is a silent no-op rather than a swallowed `TypeError` —
`PlayerSheetSD.element` really is jQuery in v14 (`constructor.name` `"ce"`,
`typeof element.find === "function"`), so `find` succeeds and returns an empty
set.

**Not user-visible today**, because the modal updates its own toggle state as
you click and closes on its own. The sheet has nothing to refresh.

**Decision needed** — both are cheap, and they differ in intent:

1. **Delete the three hooks**, if they are vestigial from a design where the
   toggles lived on the sheet.
2. **Point them at the open modal**, if live refresh is wanted. Today, with the
   modal open, an effect applied by another client or an effect expiring will
   not update the toggle state in front of you.

---

## 12. The NPC item-chat icon is dead: `item.displayCard` does not exist in SD 4.x

**Found:** while extracting `inventory/containers.mjs` (Phase 3). **Status:**
confirmed, unfixed. **Pre-existing** — the function moved byte-identically (681
lines, 0 unexplained differences), so the extraction cannot have caused it.

`enableItemChatIcon` binds a click handler on `.item-image` in an NPC sheet and
finishes with:

```js
// Show item in chat - Shadowdark uses displayCard()
await item.displayCard();
```

**`displayCard` does not exist.** Measured on a scratch NPC in world `0100`,
Foundry 14.365 / Shadowdark 4.0.6:

| | |
| --- | --- |
| `typeof item.displayCard` | `"undefined"` |
| on the prototype | `"undefined"` |
| prototype chain searched | `ItemSD → ItemSD → Item → ClientDocumentMixin → BaseItem` |

Clicking the icon on a real rendered `NpcSheetSD` produces:

```
item.displayCard is not a function
```

as an **unhandled promise rejection** — the handler is `async` and nothing
awaits it, so the failure never reaches a try/catch and no notification is
shown. The user clicks the chat icon and nothing happens, silently. Chat message
count before and after the click: **386 → 386.**

The handler itself is fine — `handlerBound: true`, the `.fa-comment` guard
passes, the row and item resolve. Only the last line is wrong.

**Player sheets are unaffected**, and deliberately so: the function returns early
for `actor.type === "Player"` because Shadowdark handles those natively. This is
NPC-only, which is likely why it has gone unreported.

**Same family as the `rollItem` finding** — SDX calling a Shadowdark method that
3.x had and 4.x does not, with an async swallow hiding it. Worth checking for
other callers of system methods that were never re-verified against 4.x.

**Fix is one line** once someone confirms the 4.x equivalent; the surrounding
guard logic does not change. Whatever replaces it should be `await`ed inside a
try/catch so the next system change is loud instead of silent.

---

## 1. The itemacro migration is one-shot; items added later never migrate

**Status:** confirmed, unfixed, currently harmless.

`Hooks.once("ready")` runs the itemacro data migration once per world, gated on
the `itemacroMigrationDone` setting. It iterates `game.items` and every actor's
items **at that moment**. Anything arriving later — imported from a compendium,
dragged in from another world, or shipped in a future SDX pack — keeps only the
legacy `flags.itemacro` namespace. The gate never reopens.

Measured in world `0100`: of 744 items, **20 carry a legacy
`flags.itemacro.macro.command` with no SDX `macroCommand`** despite
`itemacroMigrationDone` being `true` — 18 Spells and 2 Potions, all bundled SDX
pack content that landed after the migration ran.

**Harmless today** because every execution path and the config editor read the
SDX flag with a legacy fallback. The cost is that `flags.itemacro` must be
supported forever, in every new reader.

**Cheapest fix** is to make the migration idempotent and re-runnable — drop the
one-shot gate for a "any item with a legacy flag and no SDX flag" sweep, or
expose it on `module.api` as a GM repair.

---

## 2. `getUnidentifiedName` is duplicated, and the two copies have diverged

**Status:** confirmed, unfixed. Blocks a tidy-up, not a feature.

The composition root carries private wrappers to SD 4.x identification;
`macros/identify.mjs` carries the canonical implementations that `module.api`
publishes.

- **`isUnidentified`** — byte-equivalent, no behaviour difference.
- **`getUnidentifiedName`** — genuinely diverged. The root's returns
  `item?.name ?? ""` unconditionally. The `identify.mjs` one returns the item
  name only when `system.identification` exists, and otherwise falls back to the
  legacy `unidentifiedName` SDX flag. **On a legacy (SD 3.x) world these
  disagree.**

So the root block cannot simply be deleted and re-pointed at `identify.mjs` —
that would change behaviour at the root's call sites. Deciding which copy is
correct is a Shadowdark-compatibility question.

---

## 3. `requireEquipped` alone is not enforced until something else runs

**Status:** confirmed, unfixed, self-healing in practice.

The `createItem` hook filters for effects to check by testing `sourceRequirement`
only. An effect carrying **just** `requireEquipped`, with no expression, is
skipped. The `createActiveEffect` hook does check `requireEquipped`, but bails
when the effect's parent is an Item rather than an Actor — which is exactly
where item effects live.

So an unequipped item's `requireEquipped` effect arrives **active**. Confirmed
live: an item created unequipped with a `requireEquipped` transferred effect had
`disabled: false` immediately after creation, and `disabled: true` after the
`renderActorSheet` handler ran.

Self-healing — `renderActorSheet`, `updateActor` and any equip/unequip toggle
all call `checkEffectRequirements`, which does honour `requireEquipped`. The
window is "between adding the item and looking at the sheet", which is probably
why it has never been reported.

The fix is one clause in the `createItem` filter, but it changes *when* effects
switch off, so it is a behaviour decision.

---

## Recently fixed

Kept briefly so the same findings are not re-reported.

| # | Issue | Fixed in |
| --- | --- | --- |
| 4 | `renderRollDialogSD` bailed on a never-set `config.actorId`, making every SDX weapon bonus in the dialog unreachable | #16 (`f4e4b2a`) |
| 5 | The wand-charges UI never rendered — anchored to `select[name="system.range"]`, which SD 4.x does not emit | #16 (`64e7b78`) |
| 6 | The weapon hit-bonus chat display was dead — jQuery `html.find` against a v14 `HTMLLIElement`, failing silently because the caller was async and unawaited | #16 (`111080a`) |
