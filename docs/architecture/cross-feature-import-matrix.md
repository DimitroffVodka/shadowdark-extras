# Cross-feature import matrix

**Generated — do not hand-edit.** Regenerate with `npm run matrix:imports`.
Local-only, like the rest of `docs/architecture/`.

Every static and literal dynamic relative import that crosses a planned feature boundary, per the ownership table in `feature-map.md`. The composition root's own imports are composition, not crossings, and are excluded; imports *into* the root from a feature are kept.

- Modules classified: 266
- Boundary crossings: 262
- Distinct feature pairs: 80
- Unassigned modules: 15

## Unassigned modules

These have no owner in `feature-map.md`. Phase 2 cannot move them until they do.

- `scripts/animation/tmfx-filter-parser.mjs`
- `scripts/combat/damage-card-actions.mjs`
- `scripts/combat/damage-card-targeting.mjs`
- `scripts/effects/aura-application.mjs`
- `scripts/effects/aura-geometry.mjs`
- `scripts/effects/aura-state.mjs`
- `scripts/effects/aura-tokenmagic.mjs`
- `scripts/effects/duration-ui.mjs`
- `scripts/effects/focus-ui.mjs`
- `scripts/effects/template-application.mjs`
- `scripts/effects/template-conditions.mjs`
- `scripts/effects/template-geometry.mjs`
- `scripts/maphub-cave.mjs`
- `scripts/maphub-constants.mjs`
- `scripts/tom/tom-defaults.mjs`

## Crossings by feature pair

| Pair | Count |
| --- | --- |
| tray -> tom | 24 |
| combat -> shared | 11 |
| inventory -> shared | 11 |
| tray -> hex | 11 |
| character-sheet -> shared | 10 |
| effects -> unassigned | 9 |
| item-macros -> shared | 9 |
| tray -> dungeon | 9 |
| shared -> effects | 8 |
| unassigned -> effects | 8 |
| effects -> shared | 7 |
| hex -> dungeon | 6 |
| item-macros -> macros | 6 |
| item-sheets -> shared | 6 |
| party -> shared | 5 |
| settings -> party | 5 |
| tray -> journal | 5 |
| combat -> effects | 4 |
| item-macros -> combat | 4 |
| party -> tray | 4 |
| canvas -> shared | 3 |
| character-sheet -> inventory | 3 |
| effects -> combat | 3 |
| item-sheets -> animation | 3 |
| scene -> tom | 3 |
| settings -> character-sheet | 3 |
| settings -> shared | 3 |
| shared -> inventory | 3 |
| tray -> canvas | 3 |
| unassigned -> combat | 3 |
| unassigned -> shared | 3 |
| api -> shared | 2 |
| combat -> journal | 2 |
| combat -> npc | 2 |
| combat -> unassigned | 2 |
| dungeon -> hex | 2 |
| hex -> journal | 2 |
| hex -> shared | 2 |
| inventory -> combat | 2 |
| maphub -> unassigned | 2 |
| npc -> shared | 2 |
| settings -> canvas | 2 |
| settings -> combat | 2 |
| settings -> hex | 2 |
| settings -> journal | 2 |
| tom -> scene | 2 |
| tom -> tray | 2 |
| tray -> combat | 2 |
| unassigned -> item-macros | 2 |
| animation -> inventory | 1 |
| animation -> unassigned | 1 |
| canvas -> effects | 1 |
| canvas -> journal | 1 |
| combat -> animation | 1 |
| combat -> inventory | 1 |
| dungeon -> shared | 1 |
| hex -> maphub | 1 |
| inventory -> party | 1 |
| item-macros -> animation | 1 |
| item-macros -> effects | 1 |
| item-sheets -> effects | 1 |
| item-sheets -> inventory | 1 |
| item-sheets -> item-macros | 1 |
| items -> shared | 1 |
| journal -> animation | 1 |
| journal -> hex | 1 |
| journal -> npc | 1 |
| macros -> effects | 1 |
| macros -> shared | 1 |
| npc -> inventory | 1 |
| npc -> party | 1 |
| party -> canvas | 1 |
| party -> character-sheet | 1 |
| settings -> dungeon | 1 |
| settings -> effects | 1 |
| settings -> inventory | 1 |
| settings -> npc | 1 |
| settings -> tray | 1 |
| tom -> unassigned | 1 |
| tray -> maphub | 1 |

## Crossings

| From | To | Names | Kind | Decision |
| --- | --- | --- | --- | --- |
| `TMFXFilterEditor.mjs` (animation) | `tmfx-filter-parser.mjs` (unassigned) | parseTMFXFilterParams | static | **Classify before Phase 2.** |
| `WeaponAnimationSD.mjs` (animation) | `ItemPilesCompatSD.mjs` (inventory) | isItemPilesActor | static | Keep; review during modernization. |
| `template-target-sync.mjs` (api) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `templates.mjs` (api) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `carousel-drag.mjs` (canvas) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `drawing-entries.mjs` (canvas) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `light-templates.mjs` (canvas) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `TokenToolbarSD.mjs` (canvas) | `FocusSpellTrackerSD.mjs` (effects) | getActiveFocusSpells, getActiveDurationSpells, endFocusSpell, endDu… | static | Keep; review during modernization. |
| `WallContextMenuSD.mjs` (canvas) | `PlaceableNotesSD.mjs` (journal) | (dynamic) | dynamic | Keep; review during modernization. |
| `background-advancement.mjs` (character-sheet) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `character-generator.mjs` (character-sheet) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `conditions.mjs` (character-sheet) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `enhanced-header.mjs` (character-sheet) | `player-transfers.mjs` (inventory) | showCoinTransferDialog, transferCoinsToPlayer | static | Keep; review during modernization. |
| `enhanced-header.mjs` (character-sheet) | `TradeWindowSD.mjs` (inventory) | showTradeDialog | static | Keep; review during modernization. |
| `enhanced-header.mjs` (character-sheet) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `enhanced-spells-tab.mjs` (character-sheet) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `enhanced-tabs.mjs` (character-sheet) | `player-transfers.mjs` (inventory) | showTransferDialog, transferItemToPlayer | static | Keep; review during modernization. |
| `journal-notes.mjs` (character-sheet) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `player-sheet-patches.mjs` (character-sheet) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `sheet-decoration.mjs` (character-sheet) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `skills-box.mjs` (character-sheet) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `spellbook-filter.mjs` (character-sheet) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `chat-card-hooks.mjs` (combat) | `FocusSpellTrackerSD.mjs` (effects) | endDurationSpell, getActiveDurationSpells | static | Keep; review during modernization. |
| `chat-card-hooks.mjs` (combat) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `combat-settings-app.mjs` (combat) | `combat-socket.mjs` (shared) | getSocket | static | Allowed — shared kernel. |
| `combat-settings-app.mjs` (combat) | `scrolling-text.mjs` (shared) | showScrollingText | static | Allowed — shared kernel. |
| `CombatSettingsSD.mjs` (combat) | `combat-socket.mjs` (shared) | setupCombatSocket, getSocket | static | Allowed — shared kernel. |
| `crawl-helper-death-timer.mjs` (combat) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `damage-card-builders.mjs` (combat) | `CreatureTypesApp.mjs` (npc) | getEffectiveCreatureType | static | Keep; review during modernization. |
| `damage-card-builders.mjs` (combat) | `sd4Compat.mjs` (shared) | readSdDamageRoll | static | Allowed — shared kernel. |
| `damage-card-finalization.mjs` (combat) | `FocusSpellTrackerSD.mjs` (effects) | linkTargetToFocusSpell, startDurationSpell | static | Keep; review during modernization. |
| `damage-card-finalization.mjs` (combat) | `sd4Compat.mjs` (shared) | readSdRollOutcome | static | Allowed — shared kernel. |
| `damage-card-pipeline.mjs` (combat) | `AuraEffectsSD.mjs` (effects) | createAuraOnActor | static | Keep; review during modernization. |
| `damage-card-pipeline.mjs` (combat) | `FocusSpellTrackerSD.mjs` (effects) | startDurationSpell, linkEffectToDurationSpell, linkEffectToFocusSpe… | static | Keep; review during modernization. |
| `damage-card-pipeline.mjs` (combat) | `sd4Compat.mjs` (shared) | readSdRollOutcome, readSdDamageRoll, resolveCardContext | static | Allowed — shared kernel. |
| `damage-card-pipeline.mjs` (combat) | `damage-card-targeting.mjs` (unassigned) | resolveDamageCardTargets | static | **Classify before Phase 2.** |
| `damage-card.mjs` (combat) | `combat-socket.mjs` (shared) | getSocket | static | Allowed — shared kernel. |
| `damage-card.mjs` (combat) | `damage-card-actions.mjs` (unassigned) | (default) | static | **Classify before Phase 2.** |
| `freyas-omen.mjs` (combat) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `MarchingModeSD.mjs` (combat) | `JournalPinsSD.mjs` (journal) | PinPlacer | static | Keep; review during modernization. |
| `MarchingModeSD.mjs` (combat) | `PinListApp.mjs` (journal) | PinListApp | static | Keep; review during modernization. |
| `roll-patches.mjs` (combat) | `AmmunitionSelector.mjs` (inventory) | AmmunitionSelector | static | Keep; review during modernization. |
| `roll-patches.mjs` (combat) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `weapon-bonus-ui.mjs` (combat) | `WeaponAnimationConfig.mjs` (animation) | (dynamic) | dynamic | Keep; review during modernization. |
| `WeaponBonusConfig.mjs` (combat) | `CreatureTypesApp.mjs` (npc) | getEffectiveCreatureType | static | Keep; review during modernization. |
| `DDPackPreviewAppSD.mjs` (dungeon) | `HexPainterSD.mjs` (hex) | reloadDecorAssets | static | Keep; review during modernization. |
| `DDPackSettingsAppSD.mjs` (dungeon) | `HexPainterSD.mjs` (hex) | reloadDecorAssets | static | Keep; review during modernization. |
| `DungeonPainterSD.mjs` (dungeon) | `SDXCache.mjs` (shared) | cache | static | Allowed — shared kernel. |
| `AuraEffectsSD.mjs` (effects) | `CombatSettingsSD.mjs` (combat) | getSocket | static | Keep; review during modernization. |
| `AuraEffectsSD.mjs` (effects) | `aura-application.mjs` (unassigned) | (default) | static | **Classify before Phase 2.** |
| `AuraEffectsSD.mjs` (effects) | `aura-geometry.mjs` (unassigned) | (default) | static | **Classify before Phase 2.** |
| `AuraEffectsSD.mjs` (effects) | `aura-state.mjs` (unassigned) | (default) | static | **Classify before Phase 2.** |
| `AuraEffectsSD.mjs` (effects) | `aura-tokenmagic.mjs` (unassigned) | removeTokenMagicFilter | static | **Classify before Phase 2.** |
| `BreakOnDamageSD.mjs` (effects) | `CombatSettingsSD.mjs` (combat) | getSocket | static | Keep; review during modernization. |
| `casting-blockers.mjs` (effects) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `duration-spell.mjs` (effects) | `combat-socket.mjs` (shared) | getSocket | static | Allowed — shared kernel. |
| `duration-spell.mjs` (effects) | `duration-ui.mjs` (unassigned) | buildDurationSpellsHtml, onDurationDamageApplyClick | static | **Classify before Phase 2.** |
| `effect-config.mjs` (effects) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `focus-spell.mjs` (effects) | `focus-ui.mjs` (unassigned) | renderFocusEndedChat, buildFocusSpellsHtml | static | **Classify before Phase 2.** |
| `FocusSpellTrackerSD.mjs` (effects) | `CombatSettingsSD.mjs` (combat) | getSocket | static | Keep; review during modernization. |
| `FocusSpellTrackerSD.mjs` (effects) | `sd4Compat.mjs` (shared) | resolveCardContext | static | Allowed — shared kernel. |
| `invisibility.mjs` (effects) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `predefined-effects.mjs` (effects) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `source-requirements.mjs` (effects) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `TemplateEffectsSD.mjs` (effects) | `template-application.mjs` (unassigned) | rollTemplateSave, applyTemplateEffect | static | **Classify before Phase 2.** |
| `TemplateEffectsSD.mjs` (effects) | `template-conditions.mjs` (unassigned) | removeTemplateEffects | static | **Classify before Phase 2.** |
| `TemplateEffectsSD.mjs` (effects) | `template-geometry.mjs` (unassigned) | getTokensInTemplate, getTemplatesContainingToken, getTemplatesConta… | static | **Classify before Phase 2.** |
| `hex-tile-clamp.mjs` (hex) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `HexContentGenerator.mjs` (hex) | `DungeonGenerator.mjs` (dungeon) | loadDungeonData, generateDungeonName | static | Keep; review during modernization. |
| `HexDungeonBridgeSD.mjs` (hex) | `DungeonGenerator.mjs` (dungeon) | generateDungeonRooms, getDungeonSizes | static | Keep; review during modernization. |
| `HexDungeonBridgeSD.mjs` (hex) | `DungeonGeneratorSD.mjs` (dungeon) | generateDungeon | static | Keep; review during modernization. |
| `HexDungeonBridgeSD.mjs` (hex) | `JournalPinsSD.mjs` (journal) | JournalPinManager | static | Keep; review during modernization. |
| `HexPainterSD.mjs` (hex) | `DDPackManagerSD.mjs` (dungeon) | loadDDPackDecorTiles | static | Keep; review during modernization. |
| `HexPainterSD.mjs` (hex) | `DungeonPainterSD.mjs` (dungeon) | getDoorTiles | static | Keep; review during modernization. |
| `HexPainterSD.mjs` (hex) | `SDXCache.mjs` (shared) | cache | static | Allowed — shared kernel. |
| `HexTooltipSD.mjs` (hex) | `DungeonGenerator.mjs` (dungeon) | getDungeonTypes, getDungeonSizes, generateDungeonHtml | static | Keep; review during modernization. |
| `HexTooltipSD.mjs` (hex) | `MaphubViewerApp.mjs` (maphub) | MaphubViewerApp | static | Keep; review during modernization. |
| `SDXHexFogSD.mjs` (hex) | `JournalPinsSD.mjs` (journal) | JournalPinRenderer | static | Keep; review during modernization. |
| `ammunition-bonuses.mjs` (inventory) | `CompendiumIndexSD.mjs` (shared) | ensureMutableItemCompendiumIndexes | static | Allowed — shared kernel. |
| `ammunition-bonuses.mjs` (inventory) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `container-slots.mjs` (inventory) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `containers.mjs` (inventory) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `containers.mjs` (inventory) | `sd4Compat.mjs` (shared) | isUnidentified, getUnidentifiedName, getUnidentifiedNameFromData | static | Allowed — shared kernel. |
| `default-move-drops.mjs` (inventory) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `inventory-multi-select.mjs` (inventory) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `inventory-styles.mjs` (inventory) | `PartySheetSD.mjs` (party) | isPartyActor | static | Keep; review during modernization. |
| `inventory-styles.mjs` (inventory) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `player-transfers.mjs` (inventory) | `CombatSettingsSD.mjs` (combat) | getSocket | static | Keep; review during modernization. |
| `player-transfers.mjs` (inventory) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `player-transfers.mjs` (inventory) | `sd4Compat.mjs` (shared) | isUnidentified, getUnidentifiedName | static | Allowed — shared kernel. |
| `TradeWindowSD.mjs` (inventory) | `CombatSettingsSD.mjs` (combat) | getSocket | static | Keep; review during modernization. |
| `UnidentifiedDisplaySD.mjs` (inventory) | `sd4Compat.mjs` (shared) | isUnidentified | static | Allowed — shared kernel. |
| `chat-dispatch.mjs` (item-macros) | `AnimationFxSD.mjs` (animation) | AnimationFxSD | static | Keep; review during modernization. |
| `chat-dispatch.mjs` (item-macros) | `WeaponBonusConfig.mjs` (combat) | getWeaponItemMacroConfig | static | Keep; review during modernization. |
| `chat-dispatch.mjs` (item-macros) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `chat-dispatch.mjs` (item-macros) | `sd4Compat.mjs` (shared) | readSdRollOutcome, resolveCardContext | static | Allowed — shared kernel. |
| `class-ability-macros.mjs` (item-macros) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `class-ability-macros.mjs` (item-macros) | `sd4Compat.mjs` (shared) | readSdRollOutcome | static | Allowed — shared kernel. |
| `effect-trigger-macros.mjs` (item-macros) | `WeaponBonusConfig.mjs` (combat) | getWeaponItemMacroConfig | static | Keep; review during modernization. |
| `effect-trigger-macros.mjs` (item-macros) | `source-requirements.mjs` (effects) | checkEffectRequirements | static | Keep; review during modernization. |
| `effect-trigger-macros.mjs` (item-macros) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `item-macro-engine.mjs` (item-macros) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `macro-socket.mjs` (item-macros) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `npc-feature-macros.mjs` (item-macros) | `CombatSettingsSD.mjs` (combat) | spawnSummonedCreatures | static | Keep; review during modernization. |
| `npc-feature-macros.mjs` (item-macros) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `spell-item-macros.mjs` (item-macros) | `identify.mjs` (macros) | isUnidentified | static | Allowed — retained collection. |
| `spell-item-macros.mjs` (item-macros) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `SpellMacrosSD.mjs` (item-macros) | `cleansing-weapon.mjs` (macros) | (default) | static | Allowed — retained collection. |
| `SpellMacrosSD.mjs` (item-macros) | `holy-weapon.mjs` (macros) | (default) | static | Allowed — retained collection. |
| `SpellMacrosSD.mjs` (item-macros) | `identify.mjs` (macros) | (default) | static | Allowed — retained collection. |
| `SpellMacrosSD.mjs` (item-macros) | `shapechanger.mjs` (macros) | (default) | static | Allowed — retained collection. |
| `SpellMacrosSD.mjs` (item-macros) | `wrath.mjs` (macros) | (default) | static | Allowed — retained collection. |
| `weapon-item-macros.mjs` (item-macros) | `WeaponBonusConfig.mjs` (combat) | getWeaponItemMacroConfig | static | Keep; review during modernization. |
| `activity-tab-widgets.mjs` (item-sheets) | `AnimationFxSD.mjs` (animation) | AnimationFxSD | static | Keep; review during modernization. |
| `activity-tab-widgets.mjs` (item-sheets) | `TMFXFilterEditor.mjs` (animation) | filterEditor as openTMFXFilterEditor | static | Keep; review during modernization. |
| `activity-tab-widgets.mjs` (item-sheets) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `ItemTypeConfigs.mjs` (item-sheets) | `AnimationFxConfig.mjs` (animation) | generateAnimationFxConfigHTML | static | Keep; review during modernization. |
| `ItemTypeConfigs.mjs` (item-sheets) | `ItemMacroConfig.mjs` (item-macros) | generateItemMacroConfigHTML | static | Keep; review during modernization. |
| `potion-sheet-enhance.mjs` (item-sheets) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `PotionSheetSD.mjs` (item-sheets) | `UnidentifiedDisplaySD.mjs` (inventory) | applyUnidentifiedMagicPrivacy | static | Keep; review during modernization. |
| `scroll-sheet-enhance.mjs` (item-sheets) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `spell-sheet-enhance.mjs` (item-sheets) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `staff-spells.mjs` (item-sheets) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `TemplateTargetingConfig.mjs` (item-sheets) | `AuraConfig.mjs` (effects) | generateAuraConfigHTML, setupAuraConfigHandlers | static | Keep; review during modernization. |
| `wand-sheet-enhance.mjs` (item-sheets) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `item-flag-preservation.mjs` (items) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `DisplayNpc.mjs` (journal) | `CreatureTypesApp.mjs` (npc) | getEffectiveCreatureType | static | Keep; review during modernization. |
| `journal-ui.mjs` (journal) | `HexTooltipSD.mjs` (hex) | HEX_JOURNAL_NAME | static | Keep; review during modernization. |
| `pin-style-tmfx.mjs` (journal) | `TMFXFilterEditor.mjs` (animation) | FilterEditor, getCloneFilterParams | static | Keep; review during modernization. |
| `identify.mjs` (macros) | `sd4Compat.mjs` (shared) | isUnidentified, getUnidentifiedName | static | Allowed — shared kernel. |
| `shapechanger.mjs` (macros) | `FocusSpellTrackerSD.mjs` (effects) | (dynamic) | dynamic | Keep; review during modernization. |
| `MaphubViewerApp.mjs` (maphub) | `maphub-cave.mjs` (unassigned) | caveMixin | static | **Classify before Phase 2.** |
| `MaphubViewerApp.mjs` (maphub) | `maphub-constants.mjs` (unassigned) | MODULE_ID, FilePicker | static | **Classify before Phase 2.** |
| `MysteriousCasting.mjs` (npc) | `sd4Compat.mjs` (shared) | readSdDamageRoll | static | Allowed — shared kernel. |
| `npc-sheet-inventory.mjs` (npc) | `containers.mjs` (inventory) | calculateSlotsCostForItemData | static | Keep; review during modernization. |
| `npc-sheet-inventory.mjs` (npc) | `PartySheetSD.mjs` (party) | isPartyActor | static | Keep; review during modernization. |
| `npc-sheet-inventory.mjs` (npc) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `CampingRestSD.mjs` (party) | `SDXRollerApp.mjs` (tray) | SDXRollerApp | static | Keep; review during modernization. |
| `CampingRestSD.mjs` (party) | `SDXRollerData.mjs` (tray) | buildTravelTaskRollData | static | Keep; review during modernization. |
| `party-drop-transfer.mjs` (party) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `party-light-tracker.mjs` (party) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `party-roster.mjs` (party) | `HpWavesSettingsSD.mjs` (character-sheet) | getHpWaveColor, isHpWavesEnabled | static | Keep; review during modernization. |
| `party-token-light.mjs` (party) | `light-templates.mjs` (canvas) | getCustomLightSources | static | Keep; review during modernization. |
| `party-token-light.mjs` (party) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `party-token-placement.mjs` (party) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `party-unidentified.mjs` (party) | `sd4Compat.mjs` (shared) | (default) | static | Allowed — shared kernel. |
| `partytravel.mjs` (party) | `SDXRollerApp.mjs` (tray) | SDXRollerApp | static | Keep; review during modernization. |
| `partytravel.mjs` (party) | `SDXRollerData.mjs` (tray) | buildTravelTaskRollData | static | Keep; review during modernization. |
| `SceneNavBar.mjs` (scene) | `TomSocketHandler.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `SceneNavBar.mjs` (scene) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `SceneNavBar.mjs` (scene) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `drawing-settings.mjs` (settings) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `module-settings.mjs` (settings) | `light-templates.mjs` (canvas) | DEFAULT_LIGHT_TEMPLATES, LightTemplateEditor | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `TokenToolbarSD.mjs` (canvas) | registerTokenToolbarSettings | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `HpWavesSettingsSD.mjs` (character-sheet) | registerHpWavesSettings | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `sheet-decoration.mjs` (character-sheet) | applySheetDecorationStyles | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `SheetEditorConfig.mjs` (character-sheet) | SheetEditorConfig | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `CombatSettingsSD.mjs` (combat) | registerCombatSettings | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `MedkitSD.mjs` (combat) | MedkitWorldScanMenu | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `DDPackSettingsAppSD.mjs` (dungeon) | (dynamic) | dynamic | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `EffectsSettingsSD.mjs` (effects) | registerEffectsSettings | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `SDXCoordsSD.mjs` (hex) | registerSDXCoordsSettings, registerSDXCoordsMenu | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `SDXCoordsSettingsSD.mjs` (hex) | SDXCoordsSettingsApp | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `inventory-styles.mjs` (inventory) | DEFAULT_INVENTORY_STYLES, InventoryStylesApp | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `EasyReferenceMenu.mjs` (journal) | registerEasyReferenceSettings | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `PinStyleEditorSD.mjs` (journal) | registerPinStyleSettings | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `CreatureTypesApp.mjs` (npc) | CreatureTypesApp | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `CarousingTablesApp.mjs` (party) | openCarousingTablesEditor | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `ExpandedCarousingTablesApp.mjs` (party) | openExpandedCarousingTablesEditor | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `PartyWeatherSettingsSD.mjs` (party) | registerPartyWeatherSettings | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `TravelActivitiesSettingsSD.mjs` (party) | registerTravelActivitiesSettings | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `TravelSpeedsSettingsSD.mjs` (party) | registerTravelSpeedsSettings | static | Keep; review during modernization. |
| `module-settings.mjs` (settings) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `module-settings.mjs` (settings) | `TraySD.mjs` (tray) | registerTraySettings | static | Keep; review during modernization. |
| `settings-organization.mjs` (settings) | `module-id.mjs` (shared) | MODULE_ID | static | Allowed — shared kernel. |
| `combat-socket.mjs` (shared) | `AuraEffectsSD.mjs` (effects) | (dynamic) | dynamic | Keep; review during modernization. |
| `combat-socket.mjs` (shared) | `AuraEffectsSD.mjs` (effects) | (dynamic) | dynamic | Keep; review during modernization. |
| `combat-socket.mjs` (shared) | `AuraEffectsSD.mjs` (effects) | (dynamic) | dynamic | Keep; review during modernization. |
| `combat-socket.mjs` (shared) | `AuraEffectsSD.mjs` (effects) | (dynamic) | dynamic | Keep; review during modernization. |
| `combat-socket.mjs` (shared) | `AuraEffectsSD.mjs` (effects) | (dynamic) | dynamic | Keep; review during modernization. |
| `combat-socket.mjs` (shared) | `FocusSpellTrackerSD.mjs` (effects) | endFocusSpell | static | Keep; review during modernization. |
| `combat-socket.mjs` (shared) | `FocusSpellTrackerSD.mjs` (effects) | (dynamic) | dynamic | Keep; review during modernization. |
| `combat-socket.mjs` (shared) | `FocusSpellTrackerSD.mjs` (effects) | (dynamic) | dynamic | Keep; review during modernization. |
| `combat-socket.mjs` (shared) | `TradeWindowSD.mjs` (inventory) | (dynamic) | dynamic | Keep; review during modernization. |
| `combat-socket.mjs` (shared) | `TradeWindowSD.mjs` (inventory) | (dynamic) | dynamic | Keep; review during modernization. |
| `combat-socket.mjs` (shared) | `TradeWindowSD.mjs` (inventory) | (dynamic) | dynamic | Keep; review during modernization. |
| `TomSceneModel.mjs` (tom) | `tom-defaults.mjs` (unassigned) | DEFAULT_SCENE_BACKGROUND | static | **Classify before Phase 2.** |
| `TomSocketHandler.mjs` (tom) | `SceneNavBar.mjs` (scene) | (dynamic) | dynamic | Keep; review during modernization. |
| `TomSocketHandler.mjs` (tom) | `SceneNavBar.mjs` (scene) | (dynamic) | dynamic | Keep; review during modernization. |
| `TomSocketHandler.mjs` (tom) | `TrayApp.mjs` (tray) | (dynamic) | dynamic | Keep; review during modernization. |
| `TomSocketHandler.mjs` (tom) | `TrayApp.mjs` (tray) | (dynamic) | dynamic | Keep; review during modernization. |
| `decor-import.mjs` (tray) | `HexPainterSD.mjs` (hex) | reloadDecorAssets, registerDecorAsset | static | Keep; review during modernization. |
| `dungeon-bindings.mjs` (tray) | `TileFlattenSD.mjs` (canvas) | flattenDungeonLevel, getDungeonFloorLevels, getFlattendDungeonLevel… | static | Keep; review during modernization. |
| `dungeon-bindings.mjs` (tray) | `DungeonGeneratorSD.mjs` (dungeon) | generateDungeon, generateRandomSeed, getGeneratorSeed, getGenerator… | static | Keep; review during modernization. |
| `dungeon-bindings.mjs` (tray) | `DungeonMultiLevelSD.mjs` (dungeon) | (dynamic) | dynamic | Keep; review during modernization. |
| `dungeon-bindings.mjs` (tray) | `DungeonPainterSD.mjs` (dungeon) | selectDoorTile, selectFloorTile, selectIntDoorTile, selectIntWallTi… | static | Keep; review during modernization. |
| `hex-painter-bindings.mjs` (tray) | `TileFlattenSD.mjs` (canvas) | flattenTiles | static | Keep; review during modernization. |
| `hex-painter-bindings.mjs` (tray) | `DDPackSettingsAppSD.mjs` (dungeon) | (dynamic) | dynamic | Keep; review during modernization. |
| `hex-painter-bindings.mjs` (tray) | `HexGeneratorSD.mjs` (hex) | generateHexMap, clearGeneratedTiles | static | Keep; review during modernization. |
| `hex-painter-bindings.mjs` (tray) | `HexPainterSD.mjs` (hex) | setMapDimension, formatActiveScene, toggleTileSelection, clearTileS… | static | Keep; review during modernization. |
| `pin-list-bindings.mjs` (tray) | `JournalPinsSD.mjs` (journal) | JournalPinManager, JournalPinRenderer | static | Keep; review during modernization. |
| `pin-list-bindings.mjs` (tray) | `PinStyleEditorSD.mjs` (journal) | PinStyleEditorApp | static | Keep; review during modernization. |
| `pin-list-bindings.mjs` (tray) | `PlaceableNotesSD.mjs` (journal) | PlaceableNotesSD | static | Keep; review during modernization. |
| `tom-panels.mjs` (tray) | `TomEditors.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-panels.mjs` (tray) | `TomEditors.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-panels.mjs` (tray) | `TomSocketHandler.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-panels.mjs` (tray) | `TomSocketHandler.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-panels.mjs` (tray) | `TomSocketHandler.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-panels.mjs` (tray) | `TomSocketHandler.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-panels.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-panels.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-panels.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-scene-bindings.mjs` (tray) | `TomEditors.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-scene-bindings.mjs` (tray) | `TomEditors.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-scene-bindings.mjs` (tray) | `TomSocketHandler.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-scene-bindings.mjs` (tray) | `TomSocketHandler.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-scene-bindings.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-scene-bindings.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-scene-bindings.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-scene-bindings.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-scene-bindings.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-scene-bindings.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-scene-bindings.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tom-scene-bindings.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `tray-handle-bindings.mjs` (tray) | `FormationSpawnerSD.mjs` (combat) | FormationSpawnerSD | static | Keep; review during modernization. |
| `tray-handle-bindings.mjs` (tray) | `MarchingModeSD.mjs` (combat) | showLeaderDialog, showMovementModeDialog | static | Keep; review during modernization. |
| `tray-handle-bindings.mjs` (tray) | `DungeonPainterSD.mjs` (dungeon) | disableDungeonPainting, enableDungeonPainting | static | Keep; review during modernization. |
| `tray-handle-bindings.mjs` (tray) | `HexPainterSD.mjs` (hex) | adjustPoiScale, canRedoPoi, canUndoPoi, disablePainting, disablePre… | static | Keep; review during modernization. |
| `tray-handle-bindings.mjs` (tray) | `SDXHexFogSD.mjs` (hex) | getActiveHexFogEffect, getAvailableHexFogEffects, isFogEffectsEnabl… | static | Keep; review during modernization. |
| `tray-handle-bindings.mjs` (tray) | `SoloHexMode.mjs` (hex) | toggleSoloMode | static | Keep; review during modernization. |
| `tray-handle-bindings.mjs` (tray) | `JournalPinsSD.mjs` (journal) | PinPlacer | static | Keep; review during modernization. |
| `tray-handle-bindings.mjs` (tray) | `MaphubLauncherApp.mjs` (maphub) | (dynamic) | dynamic | Keep; review during modernization. |
| `TrayApp.mjs` (tray) | `PoiTileSortSD.mjs` (canvas) | (dynamic) | dynamic | Keep; review during modernization. |
| `TrayApp.mjs` (tray) | `DungeonGeneratorSD.mjs` (dungeon) | isGeneratorExpanded, getGeneratorSeed, getGeneratorSettings | static | Keep; review during modernization. |
| `TrayApp.mjs` (tray) | `DungeonMultiLevelSD.mjs` (dungeon) | (side effect) | static | Keep; review during modernization. |
| `TrayApp.mjs` (tray) | `DungeonPainterSD.mjs` (dungeon) | enableDungeonPainting, disableDungeonPainting | static | Keep; review during modernization. |
| `TrayApp.mjs` (tray) | `HexPainterSD.mjs` (hex) | enablePainting, disablePainting, isTintEnabled, getPoiScale, enable… | static | Keep; review during modernization. |
| `TrayApp.mjs` (tray) | `SDXHexFogSD.mjs` (hex) | isHexFogEnabled | static | Keep; review during modernization. |
| `TrayApp.mjs` (tray) | `SoloHexMode.mjs` (hex) | isSoloMode | static | Keep; review during modernization. |
| `TrayApp.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `TrayApp.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `TrayApp.mjs` (tray) | `TomStore.mjs` (tom) | (dynamic) | dynamic | Keep; review during modernization. |
| `TraySD.mjs` (tray) | `DungeonPainterSD.mjs` (dungeon) | (default) | static | Keep; review during modernization. |
| `TraySD.mjs` (tray) | `HexPainterSD.mjs` (hex) | getHexPainterData, loadTileAssets, bindCanvasEvents, enablePainting… | static | Keep; review during modernization. |
| `TraySD.mjs` (tray) | `SoloHexMode.mjs` (hex) | initSoloHexMode | static | Keep; review during modernization. |
| `TraySD.mjs` (tray) | `JournalPinsSD.mjs` (journal) | JournalPinManager, normalizeImageTint | static | Keep; review during modernization. |
| `aura-application.mjs` (unassigned) | `CombatSettingsSD.mjs` (combat) | getSocket | static | Keep; review during modernization. |
| `aura-application.mjs` (unassigned) | `aura-constants.mjs` (effects) | MODULE_ID | static | Keep; review during modernization. |
| `aura-application.mjs` (unassigned) | `FocusSpellTrackerSD.mjs` (effects) | (dynamic) | dynamic | Keep; review during modernization. |
| `aura-application.mjs` (unassigned) | `item-macro-engine.mjs` (item-macros) | (dynamic) | dynamic | Keep; review during modernization. |
| `aura-geometry.mjs` (unassigned) | `aura-constants.mjs` (effects) | MODULE_ID | static | Keep; review during modernization. |
| `aura-state.mjs` (unassigned) | `aura-constants.mjs` (effects) | MODULE_ID | static | Keep; review during modernization. |
| `aura-tokenmagic.mjs` (unassigned) | `aura-constants.mjs` (effects) | MODULE_ID | static | Keep; review during modernization. |
| `damage-card-actions.mjs` (unassigned) | `damage-card-builders.mjs` (combat) | (default) | static | Keep; review during modernization. |
| `damage-card-actions.mjs` (unassigned) | `FocusSpellTrackerSD.mjs` (effects) | startDurationSpell | static | Keep; review during modernization. |
| `damage-card-actions.mjs` (unassigned) | `combat-socket.mjs` (shared) | getSocket | static | Allowed — shared kernel. |
| `damage-card-targeting.mjs` (unassigned) | `combat-settings-app.mjs` (combat) | _templatePlacedMessages | static | Keep; review during modernization. |
| `damage-card-targeting.mjs` (unassigned) | `TemplateEffectsSD.mjs` (effects) | buildTemplateEffectsFlag, processTemplateCreationEffects | static | Keep; review during modernization. |
| `damage-card-targeting.mjs` (unassigned) | `sd4Compat.mjs` (shared) | readSdRollOutcome | static | Allowed — shared kernel. |
| `duration-ui.mjs` (unassigned) | `focus-constants.mjs` (effects) | MODULE_ID | static | Keep; review during modernization. |
| `duration-ui.mjs` (unassigned) | `combat-socket.mjs` (shared) | getSocket | static | Allowed — shared kernel. |
| `template-application.mjs` (unassigned) | `item-macro-engine.mjs` (item-macros) | (dynamic) | dynamic | Keep; review during modernization. |

## Features with no outgoing crossings

_none_

