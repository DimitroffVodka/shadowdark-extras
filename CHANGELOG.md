# Changelog

All notable changes to this fork of `shadowdark-extras` are documented here.

Format based loosely on [Keep a Changelog](https://keepachangelog.com/).

## [6.10.0] — 2026-05-16 — Shadowdark 4.x / Foundry v14.361 compat sweep

Multi-day sweep landing SD 4.x compatibility across every spell, weapon,
chat-card, and template flow. 12-commit chain (`0006a89` → `3e65f27`)
with per-phase commits preserved for revertability. Cross-reviewed by
Codex and Gemini through 9 + 2 rounds respectively before execution.

### Added

- **`scripts/sd4Compat.mjs`** — central compatibility helper module
  (`747a0ad`). 201 lines, four exports consumed by every other sweep
  target so the SD 3.x → 4.x shape change is read in exactly one place:
  - `readSdRollOutcome(message)` →
    `{mainRoll, total, isSuccess, isCriticalSuccess, isCriticalFailure, isMasked}`.
    Uses `message.rolls.find(r => r.type === "main")` (NOT `rolls[0]` —
    index is not guaranteed). `isMasked` distinguishes "can't see this
    whispered roll" from "the roll failed" so actor-mutating side
    effects can skip silently on non-recipient clients.
  - `readSdDamageRoll(message)` → `{roll, total}`. Separates the
    damage-typed roll from the main roll; mixing them used to
    silently feed the main attack roll into damage formulas.
  - `resolveCardContext(message, html)` →
    `{actorId, itemUuid, itemId, rollConfig}`. SD 4.x `rollConfig`
    flag takes precedence over the legacy `.chat-card` / `.item-card`
    DOM lookup; tolerates `cast.spellUuid` as well as `itemUuid`.
  - `getActorStats(actor)` → `{hp, hpMax, ac}` reading
    `system.attributes.*` (v4) with `system.hp.*` / `system.ac.*`
    fallback.
- **Active Effect Compendium (`pack-sdxeffects`)** — native Foundry v14
  `ActiveEffect` primary document library. Contains 114 drag-and-drop
  effects:
  - 17 custom SDX advantages/disadvantages mapped to v4 data paths.
  - 97 cloned predefined system effects for unified library access.
  - Manual 404 audit fix for 16 core icon paths (teal potions, red scrolls).
- **Chat-card apply-state persistence** (`3e65f27`) — `damageApplied`
  and `conditionsApplied` flags on the chat message survive re-renders
  so the buttons render as disabled "APPLIED" and the click handler
  hard-blocks a second apply. DOM `data-already-applied` attribute
  provides a parallel guard across tab-switch rebuilds.

### Fixed — SD 4.x roll-shape migration

- **15 main-roll callsites + 3 damage-roll callsites** routed through
  `sd4Compat` helpers:
  - `CombatSettingsSD.mjs` (`ee7d266`) — 12 main + 2 damage spread
    across the wand-success gate, crit-double-duration, item-give,
    template gate, save-DC extraction, aura cast, spell-effects gate,
    crit-damage doubling, damage total, crit-hit bonus dice,
    auto-apply guard, duration-tracker start, and damage breakdown.
    Each callsite now decides explicitly what to do on
    `isMasked === true`; actor-mutating sites skip silently.
  - `shadowdark-extras.mjs` (`25fb915`) — 3 sites in
    `executeWeaponItemMacro`, `executeSpellItemMacro`, and the
    recent-cast lookup.
  - `MysteriousCasting.mjs` (`25fb915`) — content-structure gate
    extended to recognize SD 4.x markers (`.dice-roll` + `rollConfig`)
    instead of failing closed when the legacy `.chat-card` / `.item-card`
    containers aren't present; damage feature-detect uses
    `readSdDamageRoll`.
- **10 `.chat-card` DOM lookups** migrated to `resolveCardContext`:
  - `CombatSettingsSD.mjs` (`ee7d266`) — 5 sites including the
    `hasWeaponCard` feature detect (now also recognizes the new
    `rollConfig` flag) and three visual-hide ops guarded so they
    no-op safely on SD 4.x messages.
  - `shadowdark-extras.mjs` (`25fb915`) — 3 sites.
  - `FocusSpellTrackerSD.mjs` (`a2e0bf7`) — 2 sites including a full
    rewrite of the wand-use tracking lookup at L2847.

### Fixed — SD 4.x data model migration

- **`actor.system.bonuses` removed in SD 4.x** — migrated reads
  (`05ea30e`):
  - `actor.system.bonuses.spellcastingCheckBonus` →
    `actor.system.spellcasting.bonus` at `shadowdark-extras.mjs:15699`
    and `:15854`.
  - Generic `actor.system.bonuses` read at `:14254` updated for
    new sub-bonus paths.
  - `TomSD.mjs:52` HP read switched from `system.hp.value` to
    `system.attributes.hp.value`.
- **`CONFIG.SHADOWDARK.EFFECT_ASK_INPUT` is gone** — the two
  `.push()` calls at `shadowdark-extras.mjs:17941-17942` and
  `:17962-17966` were silent no-ops on v4. Removed (`05ea30e`).
  SD 4.x handles REPLACEME placeholders without external registration.
- **17 predefined Active Effect entries renamed** to v4 paths
  (`d848303`). Disadvantage entries map to the SAME `.advantage.*` path
  as their advantage counterpart but with `value: -1` — SD's
  `applyAdvantage(formula, adv)` takes a signed integer (positive →
  2d20kh, negative → 2d20kl). Mapping table:
  - `abilityAdvantage<Ability>` →
    `system.roll.stat.advantage.<ability>` (value +1)
  - `abilityDisadvantage<Ability>` →
    `system.roll.stat.advantage.<ability>` (value -1)
  - `meleeAdvantage` → `system.roll.melee.advantage.all`
  - `rangedAdvantage` → `system.roll.ranged.advantage.all`
  - `spellAdvantageAll` → `system.roll.spell.advantage.all`
  - `spellDisadvantageAll` →
    `system.roll.spell.advantage.all` (value -1)
  - `spellDisadvantage` →
    `system.roll.spell.advantage.REPLACEME` (value -1)
  - The remaining 7 entries (`meleeDamageDice`, `rangedDamageDice`,
    `freyasOmen`, `macroExecute`, `silenced`, `glassbones`,
    `invisibility`) target SDX module flags — already v4-safe.

### Fixed — Foundry v14 template hardening

- **`MeasuredTemplate` setFlag is silently dropped after creation**
  in v14 (`5185106`). All SDX template flags
  (`templateEffects`, `templateExpiry`, etc.) must be written at
  create time. `SDX.templates.place()` now accepts a `templateFlags`
  option that gets merged into the document data before
  `createEmbeddedDocuments`. Fireball templates now expire as
  configured instead of lingering forever.
- **Template expiry off-by-one** (`5977927`) — a spell cast in
  round 1 with `duration: 1` was being marked to expire at the start
  of round 3 instead of round 2. Calculation switched from
  `currentRound + expiryRounds` to `currentRound + expiryRounds - 1`.

### Fixed — SD 4.x combat regressions

- **Actors not marked defeated on HP→0** (`01a0008`) — SD 4.x's
  `ActorSD._onUpdate` only animates the HP change; it no longer calls
  `_setDefeated()`. Added an `updateActor` hook that watches for
  `system.attributes.hp.value` going to 0 and invokes
  `actor._setDefeated()` explicitly. Player characters get prone +
  unconscious per SD design; NPCs get the dead status.
- **Chat-card "Apply Condition" double-apply** (`3e65f27`, task #7) —
  the auto-apply on first render was firing the button click, then
  any re-render (scroll, tab-switch, settings change) rebuilt the
  button with a fresh `applying` data state, letting a manual click
  fire the handler again. Persistent message-flag guard described in
  the "Added" section blocks the second apply.
- **Chat-card "Apply Damage" silent double-apply** (`3e65f27`,
  task #8) — same root cause, same fix. The `setTimeout` that
  re-enabled the button 2 seconds after success was the actual
  re-entry path; that path now only re-enables when no damage was
  applied (so the user can fix targets and retry).

### Changed

- `SDX.templates.place()` signature extended with optional
  `templateFlags = null` — v14 module flags written at create-time
  only. Internal callers (`placeAndTarget` in `CombatSettingsSD.mjs`)
  now pass a pre-built `sdxTemplateFlags` object so
  `templateEffects` + `templateExpiry` persist on the
  `MeasuredTemplateDocument`.
- Damage-card and effects-card buttons display "APPLIED" with a check
  icon when the message already had its corresponding apply flag set,
  instead of always rendering "APPLY DAMAGE" / "APPLY CONDITION".

### Verified

Five paths exercised programmatically against the live world via the
foundry-vtt MCP bridge after the sweep landed:

- Fireball cast — damage card injected, `autoApplied` flag set, main
  success: true.
- Longsword attack — main + damage rolls both flow through helpers.
- Sleep regression check — old casts inspected via flags only (fresh
  cast required UI interaction).
- HP→0 defeat (Druchor 1→0 HP) — prone + unconscious + combatant
  `defeated` flag applied via the new `updateActor` hook.
- AE rename — `system.roll.stat.advantage.dex` went 0→1 with
  SD-native AE structure.

### Out of scope (tracked separately)

- **Task #14** — `MeasuredTemplate` → `RegionDocument` migration
  (the original "switch templates to regions" goal from before the
  power-outage session loss). Foundry v14.361 ships
  `ApplyActiveEffectRegionBehaviorType`, `RegionDocument#hidden`,
  region-to-token attachment, and `Region#_onAnimationStateChange` —
  enough native machinery to retire most of `TemplateEffectsSD.mjs`.
  Detailed feature-mapping required before any rewrite commits.
- **Task #11** — DialogV2 default-button collision in
  `FocusSpellTrackerSD.mjs` (V2 migration follow-up).
- **Task #15** — repackage SDX advantage/disadvantage AEs as a v14
  compendium pack instead of constructing them inline. Optional
  architectural cleanup.

---

## [6.9.4] — 2026-05-15 — pin style defaults & more deprecation cleanup

Surfaced while exercising journal pins and carousing in v14.

### Fixed — Runtime correctness

- **Pin Style Editor color inputs** — `<input type="color">` requires a
  valid `#rrggbb` value and rejects empty strings with a render-time
  warning. The template references `style.symbolColor`,
  `style.iconColor`, and `style.customIconPath` but those keys weren't
  in `DEFAULT_PIN_STYLE`, so they rendered as `value=""` and broke
  `_renderHTML`. Added defaults: `iconColor: "#ffffff"`,
  `symbolColor: "#ffffff"`, `customIconPath: ""`.

### Fixed — Deprecation warnings

- **`CONST.DICE_ROLL_MODES`** (V16 removal) — `LightTrackerAppSD.mjs`
  used `CONST.DICE_ROLL_MODES.PUBLIC` to set roll mode on its
  "disable all lights" chat card. Switched to the new string value
  `"publicroll"`.
- **Legacy `-=` deletion key syntax** (V16 removal) — three call sites
  in `CarousingSD.mjs` used `flags.shadowdark-extras.-=carousingDrops`
  / `-=carousingSession` to wipe carousing state on journal updates.
  Migrated to the v14+ sentinel
  `foundry.data.operators.ForcedDeletion`:
  ```js
  { [`flags.${MODULE_ID}.carousingDrops`]: foundry.data.operators.ForcedDeletion }
  ```
  Simplified the matching watcher hook — the ForcedDeletion sentinel
  appears under the actual key, not as a `-=`-prefixed entry, so the
  parallel `flagChanges["-=..."]` checks were dropped.

---

## [6.9.3] — 2026-05-15 — more v14 deprecation cleanup

Follow-up to 6.9.2 — cleans up deprecation warnings surfaced when
actually exercising features (POI tile sort, journal pin hover,
marching-mode dialogs, hex painter preview).

### Fixed — v14/v15/v16 deprecation warnings

- **`loadTexture` global** (V15 removal) — 6 call sites in
  `HexPainterSD.mjs` migrated to `foundry.canvas.loadTexture`. Fires on
  every POI tile preview and stamp.
- **`foundry.utils.objectsEqual`** (V16 removal) — renamed to
  `foundry.utils.equals` in `JournalPinsSD.mjs` (hot path: every pin
  click and hover) and `MedkitSD.mjs`.
- **`PoiTileSortApp` migrated to ApplicationV2** — was extending V1
  `Application`. Converted defaults to `DEFAULT_OPTIONS` / `PARTS`,
  `getData` → `_prepareContext`, `activateListeners` → `_onRender`,
  `this.element[0]` → `this.element` (HTMLElement, not jQuery).
- **`MarchingModeSD.mjs` three V1 `Dialog`s migrated to `DialogV2`**:
  - `showLeaderDialog` (set party leader)
  - `showMovementModeDialog` (free/marching toggle with clickable
    option boxes)
  - SDX Pins menu (add pin / pin list)
  Button callbacks now use `(event, button, dialog)` signature; form
  values read via `button.form.elements.<name>.value`; the
  movement-mode option click wiring runs after `dialog.render(...).then(...)`.

### Fixed — Runtime correctness

- **GSAP PixiPlugin now registered** at JournalPinsSD module load.
  Without registration, GSAP warned `Invalid property pixi set to
  {brightness, hue}` on every pin hover/leave and silently no-op'd the
  filter tweens. PixiPlugin was already bundled in 6.9.2 but never
  initialized — pin brightness/hue effects are now actually visible.

### Known remaining

- ~25 more V1 `new Dialog(...)` call sites across the codebase
  (Party sheet, Combat settings, Trade window, etc.). V16 removal —
  not urgent; will migrate opportunistically.
- Third-party warnings unchanged from 6.9.2 (PixiJS, SD system V1
  Apps, TokenMagic 0.8.1, obs-utils manifest).

---

## [6.9.2] — 2026-05-15 — v14 polish & follow-up fixes

Follow-up release that cleans up issues surfaced after 6.9.1.

### Fixed — Runtime correctness

- **Audit cleanup**: removed three dead-code prototype patches targeting
  ActorSD methods that no longer exist in SD 4.x (`buildWeaponDisplay`
  ×2, `getExtraDamageDiceForWeapon`). They were silently no-op'ing
  behind guards; deleted ~190 lines of unreachable code.
- **`applyDamage` socket call fixed**: an old call site invoked
  `executeAsGM("applyDamage", tokenId, damage, actorName)` against a
  handler name that was never registered. Routed through the existing
  `applyTokenDamage` handler with the proper `{ tokenId, damage,
  actorName }` shape so player damage-application actually reaches
  the GM in multiplayer.
- **Freya's Omen reroll button migrated** to v14's
  `renderChatMessageHTML` hook. The previous chat-hook migration
  pass missed this one; vanilla DOM rewrite of the jQuery-based
  handler.
- **jQuery method calls on HTMLElement** fixed in three more chat
  hook handlers that the v14 hook-name migration left half-finished:
  - `shadowdark-extras.mjs` weapon-macro chat trigger — vanilla DOM
    rewrite of `html.find('.chat-card').data()`.
  - `CombatSettingsSD.mjs` `injectDamageCard` — re-wrap with `$()` at
    function entry so the existing 30+ jQuery calls inside keep
    working (pragmatic minimal-change fix vs rewriting them all).
  - `FocusSpellTrackerSD.mjs` `handleWandUsesTracking` — vanilla DOM
    rewrite of chat-card lookup.

### Fixed — Console noise

- **Restored GSAP + PixiPlugin** (`greensock/dist/gsap.min.js` and
  `PixiPlugin.min.js`, version 3.12.5). An earlier "GSAP cleanup"
  commit removed the bundled library but left five `gsap.*` call
  sites in `JournalPinsSD.mjs` (ripple, scale, brightness tweens) —
  every journal pin click threw `ReferenceError: gsap is not
  defined`.
- **Migrated 12 v13-deprecated global namespaces** that fire
  per-boot deprecation warnings and will hard-break in Foundry v15:
  - `Actors` / `Items` (sheet registrations) →
    `foundry.documents.collections.Actors` / `.Items`
  - `WallsLayer` / `Wall` (libWrapper paths in WallContextMenuSD) →
    `foundry.canvas.layers.WallsLayer` / `foundry.canvas.placeables.Wall`
  - `FilePicker` (HexPainter custom tile loading) →
    `foundry.applications.apps.FilePicker.implementation`
- **Three SDX-emitted info-level warnings downgraded** to
  `console.log`: TomSocketHandler init message and HexPainter's
  graceful-fallback messages when FilePicker permission isn't
  available during early boot.
- **HexPainter custom tile loaders now early-return for non-GMs**.
  FilePicker.browse requires GM permission; non-GMs were previously
  hitting a try/catch fallback that produced two warnings each load.

### Cleanup

- Removed stale `// TODO: Update this if ItemSD.prototype.rollItem
  signature changed in 4.x` comment after verifying the signature
  matches SD 4.x's `async rollItem(parts, data, options={})`.

### Known remaining

Boot console will still show ~10 warnings, all third-party:
- PixiJS DisplacementFilter deprecation (library internal)
- Shadowdark system's own V1 Application warnings (LightSourceTrackerSD,
  EffectPanelSD) and ActiveEffect mode-vs-type deprecations
- TokenMagic 0.8.1's `autoTemplateSettings` regression
- obs-utils manifest `manifestPlusVersion` key warning

Zero SDX-attributed warnings on a fresh world load.

---

## [6.9.1] — 2026-05-15 — Foundry v14 / Shadowdark 4.0.x compatibility

This series of changes brings the module forward from its last upstream release
(6.90, verified Foundry 13 / Shadowdark 3.x) to run on Foundry 14.361 and
Shadowdark 4.0.4. Upstream `gmdima/shadowdark-extras` appears unmaintained, so
this fork carries the migration.

### Fixed — Boot & init blockers

- **`canUseMagicItems` patch** — retargeted from removed `ActorSD.prototype`
  method to the `PlayerSD` data-model getter. Replaced libWrapper (which lacks
  clean cross-version getter support) with a direct property-descriptor
  override.
- **`buildNpcAttackDisplays` / `buildNpcSpecialDisplays`** — retargeted from
  `ActorSD.prototype` to the `NpcSD` data model. Inside the wrapped method
  `this` is now the data model; the actor is reached via `this.parent`.
- **`setupWandUsesBlocker`** — retargeted the `castSpell` wrap to both
  `PlayerSD` and `NpcSD` data models; handles UUID-or-id first arg.
- **`buildWeaponDisplay`** — removed in Shadowdark 4.x; the patch now skips
  cleanly behind a presence guard.
- **`TraySD.getPartyTokens` item-piles guard** — Foundry v14 now throws when
  `getFlag` is called against an inactive module's scope. Added an
  `item-piles` module-active check before reading the flag.
- **`CONFIG.SHADOWDARK.EFFECT_ASK_INPUT` guard** — removed in SD 4.x; SDX's
  spell-disadvantage wiring previously crashed init with `Cannot read
  properties of undefined (reading 'includes')`. Guarded with
  `Array.isArray()`.
- **Three silent ESM syntax errors** in a checkpoint commit broke init for
  the whole module without producing any console error (Foundry's ESM loader
  swallows parse failures). Fixed:
  - Duplicate inline import of `getPromptableHitBonuses` / `getPromptableDamageBonuses`.
  - Orphan `});` from a deleted `Hooks.once("ready", () => {` wrapper.
  - `await` inside a non-async arrow function in the itemacro migration hook.
- **`setupRollConfigPatches` timing fix** — `Hooks.once("ready", …)` was
  registered from inside an outer `ready` callback that had already fired, so
  the inner wrap never ran. Switched to direct iteration since the registration
  point is already past `ready`.
- **`generateDungeon` missing `gridSize` local** — function referenced bare
  `gridSize` in 20+ places (configureScene, fitToContent, scene padding,
  renderFloor/Walls/Doors helper calls, stairs, clutter) but never declared
  it. Added `const gridSize = GRID_SIZE;` at function entry plus the missing
  `const GRID_SIZE = 100;` module-level declaration.

### Fixed — Runtime correctness

- **Chat card `_renderChatMessage` monkeypatch** — removed. SD 4.x renamed
  `type` → `style` on chat data; SDX's patch was overriding the new renderer
  with broken legacy code that omitted the field entirely.
- **`ArmorAEPatchSD` simplification** — SD 4.x natively suppresses Active
  Effects for stashed and unequipped items. SDX's patch is no longer needed
  for those cases; trimmed to keep only the unidentified-item suppression
  (still SDX-specific) and delegates the rest to SD's native getter.
- **Rolling logic migration** — `rollAttack`, `rollAbility`, advantage /
  disadvantage prototype patches were dead code in SD 4.x (methods removed or
  relocated). Migrated to wrap each actor's `actor.system.rollConfigGenerators`
  on instance creation (with backfill on `ready` for existing actors), and
  inject promptable bonuses via a `renderRollDialogSD` hook compatible with
  ApplicationV2.
- **Roll-config wrap targets the instance, not the prototype** — `rollConfigGenerators`
  is declared as a class instance field in SD 4.x, so prototype-targeted patches
  early-returned silently. Wrap each actor's generators per-instance.
- **Weapon animation button now injects** — SD 4.x ships a native `tab-bonuses`
  on weapon sheets, which made SDX's `injectWeaponBonusTab` short-circuit
  before reaching `injectWeaponAnimationButton`. When a native bonuses tab is
  detected, still inject the animation button, then bail out of the SDX
  bonus-content injection.
- **Dungeon tile rendering offset** — Foundry v14 changed the default tile
  texture anchor to `(0.5, 0.5)` = center. Tiles created without an explicit
  anchor rendered half a cell up-left of their document position; the wall
  builder placed walls correctly, producing the visible "tiles shifted
  up-left" symptom on every painted/generated dungeon. Painter and generator
  now set `texture.anchorX: 0, texture.anchorY: 0` on every tile (floors,
  stairs, clutter, probes).
- **Tray toggle button chevron** — direction now updates with collapsed /
  expanded state. The panel was sliding off-screen correctly; only the
  visual cue was stuck, which read as "tray won't close."

### Changed — Dependencies

- **`itemacro` decoupled from runtime path.** The module previously hard-
  required `itemacro` for every spell / scroll / wand / potion / class-ability
  trigger macro: gated each execution on `game.modules.get("itemacro")?.active`
  and called `item.executeMacro()` (an itemacro prototype injection). With
  itemacro uninstalled (its v14 status is uncertain), every trigger macro
  silently no-op'd. Native executor `executeItemMacro(item, scope)` now
  handles execution; reads `flags.shadowdark-extras.macroCommand` first with
  a fallback read of legacy `flags.itemacro.macro.command` for unmigrated
  worlds. One-time data migration runs on first `ready` after upgrade.
  `itemacro` removed from `module.json` `requires`.
- **`autoanimations` added to `recommends`** in `module.json`. SDX's
  `AutoAnimationsSD` only filters AA's animations (suppresses on failed
  rolls); it doesn't generate them. Without AA installed, attack/spell
  animations don't fire — and the previous manifest never declared the
  relationship.
- **`module.json` compatibility** — `verified: "14"`, system
  `verified: "4.0.4"`.

### Known remaining work

- The wider feature surface inside `executeSpellItemMacro`-style call sites
  still exposes the rich legacy scope (`target`, `targets`, `isSuccess`,
  etc.) to macro authors. Preserved for back-compat with existing user
  macros. Future macros can use the simpler `(actor, token, item, scope)`
  shape the native executor exposes.
- `WeaponBonusConfig.mjs` still references `game.modules.get("itemacro")?.active`
  for the weapon-macro UI hint. Cosmetic only — runtime works without
  itemacro.
- Pre-existing socket handler `executeSpellItemMacroAsGM` is called but
  never registered (line 18807). Run-as-GM for spell macros has never worked
  on this module; only matters in multiplayer.
