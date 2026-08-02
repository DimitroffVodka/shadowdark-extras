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

## 9. Ammunition hit and damage bonuses never reach Shadowdark 4.x attack rolls

**Found:** static analysis during the combat fixes, then confirmed live during
the 6.10.52 archive smoke. **Status:** confirmed, unfixed. **Pre-existing** —
the Phase 3 move carried this implementation unchanged.

The ranged-attack wrapper selects and consumes ammunition correctly, but tries
to inject `ammoHitBonus` and `ammoDamageBonus` by temporarily replacing
`item.rollItem` (`scripts/combat/roll-patches.mjs:178-230`). Shadowdark 4.0.6's
Player attack path never calls that method: it creates a roll configuration,
opens the roll dialog, and finishes through `rollFromConfig`.

Measured against the installed 6.10.52 candidate archive in a disposable world,
Foundry 14.365 / Shadowdark 4.0.6:

| | |
| --- | --- |
| ammunition | `Phase 4 Silver Arrows`, `ammoHitBonus: +2`, `ammoDamageBonus: +3` |
| selector | listed and selected the configured ammunition |
| quantity | **2 → 1** after one Longbow attack |
| attack formula | **`1d20 + 2`**, with no additional `+2` |
| damage formula | **`1d8`**, with no additional `+3` |
| chat card | named `Phase 4 Silver Arrows (1/20)` |

So the sheet controls, selector, consumption, and chat annotation all work;
only the advertised bonuses are absent. This is the live confirmation that the
local architecture notes previously lacked.

**Fix direction:** carry both values through Shadowdark's roll configuration,
as the repaired weapon hit-bonus path already does. That is a combat behaviour
change and is deliberately outside the verification-only Phase 4 release.

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

## 13. The unidentified `magicItem` wrap is a permanent no-op: it guards on a
return value that has no `system`

**Found:** while splitting the shared `ready` hook in Phase 3. **Status:**
confirmed, unfixed. **Pre-existing** — the body moved with a whitespace-only
reindent (verified by stripping leading whitespace from both sides and
requiring an exact match), so the move cannot have caused it.

SDX wraps `ItemSheet.prototype.getData` to hide `system.magicItem` from
non-GM players on unidentified items:

```js
const data = await originalGetData.call(this, options);
const item = this?.item;
if (item && isUnidentified(item) && !game.user?.isGM && data?.system) {
    data.system = foundry.utils.duplicate(data.system);
    data.system.magicItem = false;
}
```

**`data.system` is never there.** The v1 `ItemSheet.getData()` return has no
`system` key at all — Shadowdark's `ItemSheetSD` adds it AFTER
`super.getData()` comes back. The guard's last clause is therefore always
false and the body never runs. Measured in world `0100`, Foundry 14.365 /
Shadowdark 4.0.6:

| | |
| --- | --- |
| base `ItemSheet.getData()` keys | `cssClass, editable, document, data, limited, options, owner, title, item` |
| `"system" in baseReturn` | **`false`** |
| `"system" in ItemSheetSD.getData()` return | `true` |
| `systemAddedBySubclassAfterSuper` | **`true`** |

The other three clauses are all satisfied on a probe item —
`isUnidentified(item)` returns `true` for `identification.identified ===
false` — so the wrap installs, runs, and does nothing. An unidentified magic
item still reports `magicItem === true` to a player: `docMagicItem: true`,
`playerSees: true`, `gmSees: true`.

**Not fixed here because the fix is a behaviour change, not a refactor.** It
would have to patch `ItemSheetSD`'s chain rather than the base class, and that
settles a product question a structural commit should not: whether an
unidentified item may reveal that it is magical at all. `magicItem` may also
reach the template by another path, which needs checking before anything is
rewired.

**Third member of the same family** as items 7 and 12 — SDX code that installs
cleanly, guards on something that is never true under 4.x, and fails by doing
nothing at all. Worth a sweep for other wraps whose guards were written
against a 3.x return shape.

---

## 14. Alignment-based spell filtering is dead: SDX patches the 3.x method
location, and SD 4.x moved it to the data model

**Found:** while extracting the alignment section into
`character-sheet/spellbook-filter.mjs` (Phase 3, step 39). **Status:**
confirmed, unfixed. **Pre-existing** — the 145 lines moved byte-identically,
and the cause is where SD 4.0.6 keeps the method, not where SDX keeps the code.

The feature is three linked pieces, and the first one never runs:

1. a patched `openSpellBook` computes the actor's alignment and stores it in a
   `WeakMap` keyed by the spell-book app;
2. a `renderSpellBookSD` hook reads that map back onto `app.alignment`;
3. a patched `SpellBookSD.prototype.getData` filters the spell list **if**
   `this.alignment` is set.

**SDX patches `CONFIG.Actor.documentClass.prototype.openSpellBook`. Nothing
calls it.** SD 4.x moved the method onto the `PlayerSD` data model, and the
sheet calls the data-model copy:

```js
async _onOpenSpellBook(event) { event.preventDefault(); this.actor.system.openSpellBook(); }
```

Measured in world `0100`, Foundry 14.365 / Shadowdark 4.0.6:

| | |
| --- | --- |
| `ActorSD.prototype.openSpellBook` is SDX-patched | **`true`** |
| `PlayerSD` data-model `openSpellBook` is SDX-patched | **`false`** |
| what `PlayerSheetSD._onOpenSpellBook` calls | `this.actor.system.openSpellBook()` |
| `typeof actor.getSpellcasterClasses` | **`"undefined"`** (instance, prototype, and data model) |

**And it would throw if anything did reach it.** The patched version's first
line is `await this.getSpellcasterClasses()`, and that method does not exist
anywhere in 4.0.6. Called directly on three Player actors — Aran, Bazogo,
Brenna — every one raised `TypeError: this.getSpellcasterClasses is not a
function`.

**User-visible impact: none.** The spell-book button goes through the
data-model method, which SDX never touched, so the book opens normally — it
just is not filtered by alignment. The WeakMap stays empty, so the hook never
sets `app.alignment`, so `getData`'s filter never engages. The code's own
comment names the broken link: *"The alignment should already be stored via
our custom openSpellBook."*

**A distinct mechanism from items 7, 12 and 13**, which fail on guards that
are never true. This one fails on *location*: the patch is applied where the
method used to live. The module already knows about this migration —
`npc/npc-display-patches.mjs` opens by explaining that "SD 4.x: NPC display
builders moved from ActorSD.prototype to the NPC data model" — so the same
3.x-to-4.x move was handled in one place and missed in another.

**Fix is small but not free:** repoint the patch at
`CONFIG.Actor.dataModels.Player.prototype.openSpellBook` and replace
`getSpellcasterClasses()` with whatever 4.x offers (`system.isSpellCaster`,
`getClass`, and `_generateSpellConfig` are the candidates on the data model).
That is a behaviour change — it turns a dormant feature back on — so it wants
its own commit and a decision about whether alignment filtering is still
wanted.

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
| 8 | The roll-config generator wrapper died on every actor update (marker on the Document, wrapped generators on the rebuilt `actor.system`), silently killing SDX talent advantage; the wrapper, marker, `createActor` hook, and `_sdxSystem*` baseline fields were retired and the dialog hook now owns advantage for all roll types | issue #52, Phase 5.2.1 |
| 15 | ToM's default scene background pointed at `assets/default-scene.jpg`, which was never shipped (404 from both model entry points); the promised asset now ships and both `TomSceneModel` implementations were deduplicated onto one shared default | issue #57, Phase 5.2.2 |

Row 7 (condition hooks) is still open — issue #56.
