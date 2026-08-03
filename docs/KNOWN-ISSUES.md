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




## Recently fixed

Kept briefly so the same findings are not re-reported.

| # | Issue | Fixed in |
| --- | --- | --- |
| 1 | The itemacro migration was one-shot — items imported after the first run (compendium imports, drag-in, future packs) kept only the legacy `flags.itemacro` namespace forever; the migration is now idempotent and re-runnable on every ready, with per-item idempotence (`migrateItem` writes only when a legacy command exists and the SDX flag does not) | issue #49, Phase 5.2.7 |
| 2 | `getUnidentifiedName` existed in multiple copies that diverged on SD 3.x worlds — sd4Compat returned `item.name` unconditionally (revealing the real name); the richer copy (4.x schema, else legacy `unidentifiedName` flag, else i18n label) is now the single implementation in sd4Compat, with identify.mjs (the api publisher) importing and re-exporting it, the party helpers (`isItemUnidentified`/`getMaskedItemName`) re-exporting it under their local names, and the data-shaped path (`getUnidentifiedNameFromData`) mirroring the same logic | issue #50, Phase 5.2.9 |
| 3 | `requireEquipped`-only effects arrived active on newly created items — the createItem hook's requirement filter tested `sourceRequirement` only, while the createActiveEffect hook bails for Item parents; the filter now catches the `requireEquipped` flag too | issue #51, Phase 5.2.6 |
| 4 | `renderRollDialogSD` bailed on a never-set `config.actorId`, making every SDX weapon bonus in the dialog unreachable | #16 (`f4e4b2a`) |
| 5 | The wand-charges UI never rendered — anchored to `select[name="system.range"]`, which SD 4.x does not emit | #16 (`64e7b78`) |
| 6 | The weapon hit-bonus chat display was dead — jQuery `html.find` against a v14 `HTMLLIElement`, failing silently because the caller was async and unawaited | #16 (`111080a`) |
| 7 | The three ActiveEffect condition hooks were a permanent no-op — they looked for `.sdx-condition-toggle` inside the actor sheet, but the toggles live in the BODY modal; the modal self-updates on click and closes on its own, so the hooks (and their `updateConditionToggles` helper) were deleted | issue #56, Phase 5.2.5 |
| 8 | The roll-config generator wrapper died on every actor update (marker on the Document, wrapped generators on the rebuilt `actor.system`), silently killing SDX talent advantage; the wrapper, marker, `createActor` hook, and `_sdxSystem*` baseline fields were retired and the dialog hook now owns advantage for all roll types | issue #52, Phase 5.2.1 |
| 9 | Ammunition hit/damage bonuses never reached SD 4.x attack rolls — the wrapper monkeypatched `item.rollItem`/`availableAmmunition`, which the 4.x flow never calls; the bonuses now ride the roll config (`applyAmmoBonuses` in the rollFromConfig patch, the seam that sees the final `selectedAmmunition`) | issue #53, Phase 5.2.3 |
| 10 | The weapon damage-bonus chat display was unreachable in SD 4.x — its only caller sat behind a `flags.itemId` gate 4.x messages never carry, and the function used jQuery against the v14 DOM; the live CombatSettingsSD pipeline already renders the breakdown from `weaponBonusResults` (with `bonusInFormula` de-dup), so `injectWeaponBonusDisplay` and its dead branch in hit-bonus.mjs were deleted | issue #55, Phase 5.2.8 |
| 12 | The NPC item-chat icon was dead — `item.displayCard` does not exist in SD 4.x (unhandled rejection, nothing posted); all eight call sites (NPC sheet, token toolbar ×3, shapechanger ×3, party inventory) now use `shadowdark.chat.showItemCard(uuid)` inside try/catch so the next system change is loud instead of silent | issue #54, Phase 5.2.4 |
| 13 | Unidentified magical item sheets exposed `system.magicItem` to non-GM players because SDX wrapped the generic ItemSheet before Shadowdark's ItemSheetSD added the `system` context; the generic SDX privacy sheet now covers Armor, Basic, Gem, Scroll, Wand, and Weapon, while Potion remains on SDX's AppV2 PotionSheetSD and masks only a cloned rendered context there, preserving its default identity, PARTS/actions, GM/identified behavior, and the Item document | issue #62, Phase 5.3 |
| 14 | Alignment-based spell filtering targeted the removed SD 3.x method location, so Shadowdark 4.x spellbooks bypassed the patch; the fix targets `PlayerSD.openSpellBook`, resolves classes through `shadowdark.utils.resolveSpellClasses`, and filters flagged spells by exact alignment while preserving unflagged entries and source documents | issue #63, Phase 5.3 |
| 15 | ToM's default scene background pointed at `assets/default-scene.jpg`, which was never shipped (404 from both model entry points); the promised asset now ships and both `TomSceneModel` implementations were deduplicated onto one shared default | issue #57, Phase 5.2.2 |

