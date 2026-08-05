/**
 * Feature ownership map, transcribed from `docs/architecture/feature-map.md`.
 *
 * The feature map is the authority for classification; this file is a machine
 * readable copy of its inventory table, keyed by module basename. Basenames are
 * unique across everything the matrix classifies — the only duplicates in the
 * tree sit inside the vendored `scripts/maphub/js/` subtree, which `isVendor`
 * excludes. When the map's ownership changes, change it there first and mirror
 * it here.
 *
 * Any module missing from this table is reported as `unassigned` rather than
 * silently bucketed, because "every maintained script is mapped to one feature"
 * is an acceptance criterion of the structural track.
 *
 * KEEP THIS IN THE SAME COMMIT AS THE MOVE. Nothing in `verify.sh` enforces it —
 * the cross-feature matrix is a plan stop-condition, not one of the eight
 * blocking gates — so a stale entry here is green everywhere and only surfaces
 * when someone regenerates the matrix. PRs #17 and #18 extracted 17 modules and
 * added none of them; that is why the Phase 3 block below arrived in one late
 * batch rather than alongside each move.
 */

export const FEATURE_OWNERS = {
  inventory: [
    "AmmunitionSelector.mjs",
    "TradeWindowSD.mjs",
    "UnidentifiedDisplaySD.mjs",
    "ItemPilesCompatSD.mjs",
    // Extracted from the composition root in Phase 3.
    "containers.mjs",
    "container-slots.mjs",
    "default-move-drops.mjs",
    "gem-enhancements.mjs",
    "inventory-multi-select.mjs",
    "inventory-styles.mjs",
    "player-transfers.mjs",
    "ammunition-bonuses.mjs",
  ],
  "character-sheet": [
    "SheetEditorConfig.mjs",
    "SheetLockManager.mjs",
    "SheetLockConfig.mjs",
    "HpWavesSettingsSD.mjs",
    "AppearanceSettingsSD.mjs",
    "BackgroundSheetSD.mjs",
    // Extracted from the composition root in Phase 3.
    "background-advancement.mjs",
    "conditions.mjs",
    "enhanced-header.mjs",
    "enhanced-inventory-tab.mjs",
    "enhanced-spells-tab.mjs",
    "sheet-decoration.mjs",
    "skills-box.mjs",
    // Per-actor journal notes. Owned here, not by `journal`, because these are
    // notes ON an actor sheet stored in a module flag — not JournalEntry
    // documents. The feature map lists "journal notes" under Character sheets.
    "journal-notes.mjs",
    "enhanced-tabs.mjs",
    // Patches the system's CharacterGeneratorSD to broadcast generation rolls.
    // PC-facing creation behaviour, which is the closest bucket the map has.
    "character-generator.mjs",
    "player-sheet-patches.mjs",
    "spellbook-filter.mjs",
  ],
  "item-sheets": [
    "PotionSheetSD.mjs",
    "StaffSpellManager.mjs",
    "staff-spells.mjs",
    "activity-tab-widgets.mjs",
    "spell-sheet-enhance.mjs",
    "potion-sheet-enhance.mjs",
    "scroll-sheet-enhance.mjs",
    "wand-sheet-enhance.mjs",
    "ClassAbilitySheetSD.mjs",
    "ItemTypeConfigs.mjs",
    "TemplateTargetingConfig.mjs",
    "SpellDamageConfig.mjs",
    "SummoningConfig.mjs",
    "ItemGiveConfig.mjs",
  ],
  "item-macros": [
    "ItemMacroConfig.mjs",
    "SpellMacrosSD.mjs",
    "macro-socket.mjs",
    "item-macro-engine.mjs",
    "class-ability-macros.mjs",
    "spell-item-macros.mjs",
    "weapon-item-macros.mjs",
    "npc-feature-macros.mjs",
    "chat-dispatch.mjs",
    "effect-trigger-macros.mjs",
  ],
  combat: [
    "CombatSettingsSD.mjs",
    "WeaponBonusConfig.mjs",
    "combat-settings-app.mjs",
    "damage-card-builders.mjs",
    "damage-card.mjs",
    "damage-card-pipeline.mjs",
    "damage-card-finalization.mjs",
    "weapon-bonus-ui.mjs",
    "roll-patches.mjs",
    "hit-bonus.mjs",
    "FormationSpawnerSD.mjs",
    "MarchingModeSD.mjs",
    "MedkitSD.mjs",
    // Extracted from the composition root in Phase 3.
    "chat-card-hooks.mjs",
    "freyas-omen.mjs",
    // Step 39: crawl-helper death-timer override, gated on that module.
    "crawl-helper-death-timer.mjs",
  ],
  effects: [
    "AuraEffectsSD.mjs",
    "TemplateEffectsSD.mjs",
    "FocusSpellTrackerSD.mjs",
    "BreakOnDamageSD.mjs",
    "ArmorAEPatchSD.mjs",
    "EffectsSettingsSD.mjs",
    "AuraConfig.mjs",
    "TemplateElevationBadgeSD.mjs",
    // Extracted from the composition root in Phase 3.
    "effect-config.mjs",
    "invisibility.mjs",
    "source-requirements.mjs",
    "predefined-effects.mjs",
    "casting-blockers.mjs",
    "aura-constants.mjs",
    "aura-regions.mjs",
    "duration-spell.mjs",
    "focus-constants.mjs",
    "focus-spell.mjs",
  ],
  animation: [
    "AnimationFxSD.mjs",
    "AnimationFxListApp.mjs",
    "AutoAnimationsSD.mjs",
    "TorchAnimationSD.mjs",
    "WeaponAnimationSD.mjs",
    "WeaponAnimationConfig.mjs",
    "LevelUpAnimationSD.mjs",
    "TMFXFilterEditor.mjs",
    "AnimationFxConfig.mjs",
    "spell-animation-presets.mjs",
    "npc-attack-presets.mjs",
    "weapon-animation-presets.mjs",
    "weapon-sprite-presets.mjs",
  ],
  party: [
    "PartySheetSD.mjs",
    "PartyTravelMutationsSD.mjs",
    "CampingRestSD.mjs",
    "CampingRestData.mjs",
    "CampingRulesData.mjs",
    "CarousingSD.mjs",
    "CarousingOverlaySD.mjs",
    "CarousingTablesApp.mjs",
    "ExpandedCarousingTablesApp.mjs",
    "CarousingFoundryImport.mjs",
    "TravelActivitiesSettingsSD.mjs",
    "TravelSpeedsSettingsSD.mjs",
    "PartyWeatherSettingsSD.mjs",
    // Extracted from the composition root in Phase 3. Carries four Hooks.on
    // registrations, one of them a contended hook name — see its docblock.
    "party-creation.mjs",
    "party-light-tracker.mjs",
    // Prototype mixins and helpers split out of PartySheetSD. Phase 5.1 took
    // the travel, XP and inventory handlers plus the unidentified-item
    // helpers; Phase 5.3 took roster preparation, drag/drop transfer, token
    // placement and the token light search. carousing-core.mjs is the same
    // shape one level down, split out of CarousingSD.
    "partytravel.mjs",
    "partyxp.mjs",
    "partyinventory.mjs",
    "party-unidentified.mjs",
    "party-roster.mjs",
    "party-drop-transfer.mjs",
    "party-token-placement.mjs",
    "party-token-light.mjs",
    // Carousing, split the same way one level down: carousing-core.mjs holds
    // the journal-backed session state, and Phase 5.3 took the coin maths,
    // renown, actor notes, the session log and the UI out of CarousingSD.
    // CarousingSD stays the public face and re-exports all of them.
    "carousing-core.mjs",
    "carousing-wealth.mjs",
    "carousing-renown.mjs",
    "carousing-notes.mjs",
    "carousing-log.mjs",
    "carousing-ui.mjs",
  ],
  npc: [
    "CreatureTypesApp.mjs",
    "NPCAttackSheetSD.mjs",
    "NPCFeatureSheetSD.mjs",
    "NPCSpecialAttackSheetSD.mjs",
    // Extracted from the composition root in Phase 3: the ready-hook that
    // wraps the NPC data model’s two display builders.
    "npc-display-patches.mjs",
    "MysteriousCasting.mjs",
    /**
     * PHASE 0 FINDING — owner confirmed 2026-07-30. Moves to `scripts/npc/`.
     *
     * `data/creature-type-map.mjs` lives in the REPO-ROOT `data/` directory,
     * not `scripts/data/`, and was absent from both the feature map's inventory
     * and the plan's target layout. It is shipped runtime ESM with exactly one
     * consumer, `CreatureTypesApp` (npc).
     *
     * MOVING IT REQUIRES AN EDIT NO GATE HERE CAN SEE. The file is generated by
     * `dev/regen-creature-type-map.mjs`, which hardcodes its destination as a
     * constructed path (`path.join(__dirname, "..", "data", …)`) — invisible to
     * the import resolver, which only follows imports, and to the string-path
     * guard, which only matches `modules/<id>/scripts/`. Update the generator
     * in the same commit as the move, or the next regeneration recreates the
     * old copy and the `npc/` one goes stale with every gate still green.
     */
    "creature-type-map.mjs",
    // Extracted from the composition root in Phase 3.
    "npc-sheet-inventory.mjs",
  ],
  journal: [
    "JournalPinsSD.mjs",
    "PinStyleEditorSD.mjs",
    "PinListApp.mjs",
    "IconPickerSD.mjs",
    "PlaceableNotesSD.mjs",
    "JournalNarrationSD.mjs",
    "DisplayItem.mjs",
    "DisplayNpc.mjs",
    "DisplayTable.mjs",
    "EasyReferenceMenu.mjs",
    // Extracted from the composition root in Phase 3.
    "journal-ui.mjs",
    // Split out of JournalPinsSD.mjs in Phase 5.1.
    "pin-manager.mjs",
    "pin-rendering.mjs",
    "pin-style.mjs",
    // Ring stroke geometry, context menu, pointer interactions and the hover
    // tooltip lifted out of pin-rendering.mjs in Phase 5.3.5.
    "pin-draw.mjs",
    "pin-context-menu.mjs",
    "pin-interactions.mjs",
    "pin-tooltip.mjs",
    "pin-tmfx-adapter.mjs",
    "pin-icons.mjs",
    // Form reading and saving, preview rendering and the TokenMagic panel
    // lifted out of PinStyleEditorSD.mjs in Phase 5.3.5.
    "pin-style-form.mjs",
    "pin-style-preview.mjs",
    "pin-style-tmfx.mjs",
  ],
  hex: [
    "HexPainterSD.mjs",
    "HexGeneratorSD.mjs",
    "HexTooltipSD.mjs",
    "HexContentGenerator.mjs",
    "SDXHexFogSD.mjs",
    "SDXCoordsSD.mjs",
    "SDXCoordsSettingsSD.mjs",
    "SoloHexMode.mjs",
    "HexcrawlBuilderSD.mjs",
    "HexDungeonBridgeSD.mjs",
    "SettlementGenerator.mjs",
    "ContentRegistry.mjs",
    // Extracted from the composition root in Phase 3.
    "hex-tile-clamp.mjs",
    // Decor assets + decor-tab state lifted out of HexPainterSD.mjs in Phase 5.3.
    "hex-decor.mjs",
    // Colored-hex tile assets, lifted out of HexPainterSD.mjs in Phase 5.3.
    "hex-colored-tiles.mjs",
    // Custom-tile scan, sizing and nav state lifted out of HexPainterSD.mjs
    // (Phase 5.3 sweep 6).
    "hex-custom-tiles.mjs",
    // The five map-effect toggles, lifted out of HexPainterSD.mjs in Phase 5.3.
    "hex-map-effects.mjs",
  ],
  dungeon: [
    "DungeonGeneratorSD.mjs",
    "DungeonGenerator.mjs",
    "DungeonPainterSD.mjs",
    // Level-context / Foundry-levels adapter lifted out of DungeonPainterSD.mjs
    // (Phase 5.3 sweep 6).
    "dungeon-level-context.mjs",
    // Selection-rectangle overlay lifted out of DungeonPainterSD.mjs
    // (Phase 5.3 sweep 6).
    "dungeon-selection-overlay.mjs",
    // Tool-state (tile selection, dungeon mode, display toggles) lifted out of
    // DungeonPainterSD.mjs (Phase 5.3 sweep 6).
    "dungeon-tool-state.mjs",
    // Tile catalogue (floor/wall/door/background arrays) lifted out of
    // DungeonPainterSD.mjs (Phase 5.3 sweep 6).
    "dungeon-tile-catalog.mjs",
    // Interior-wall painting lifted out of DungeonPainterSD.mjs
    // (Phase 5.3 sweep 6).
    "dungeon-interior-walls.mjs",
    "DungeonCaveSD.mjs",
    "DungeonBiomesSD.mjs",
    "DungeonDecorSD.mjs",
    "DungeonRegionsSD.mjs",
    "DungeonMultiLevelSD.mjs",
    "DDPackManagerSD.mjs",
    "DDPackSettingsAppSD.mjs",
    "DDPackPreviewAppSD.mjs",
    "BiomeEditorSD.mjs",
  ],
  canvas: [
    "TokenToolbarSD.mjs",
    "TokenToolbarApp.mjs",
    "SDXDrawingTool.mjs",
    "SDXDrawingToolbar.mjs",
    "WallContextMenuSD.mjs",
    "TileFlattenSD.mjs",
    "PoiTileSortSD.mjs",
    "LightTrackerAppSD.mjs",
    // Extracted from the composition root in Phase 3. `PartySheetSD` (party)
    // imports `getCustomLightSources` from it — the crossing that used to run
    // party -> root -> party, now a plain party -> canvas row in the matrix.
    "light-templates.mjs",
    // Lifted out of SDXDrawingTool.mjs in Phase 5.3.5: the geometry first,
    // then the shape lifecycle, remote synchronisation and entry bookkeeping.
    // drawing-constants.mjs holds the palette and stamp sizes, which the tool,
    // all three mixins and the toolbar read — it exists so none of them has to
    // import back into another.
    "drawing-geometry.mjs",
    "drawing-constants.mjs",
    "drawing-shapes.mjs",
    "drawing-sync.mjs",
    "drawing-entries.mjs",
    // Third-party compatibility: makes shadowdark-crawl-helper's lights-out
    // carousel draggable. Here rather than shared/ because shared takes a helper
    // at its SECOND consumer and this has one.
    "carousel-drag.mjs",
  ],
  scene: ["SceneImporter.mjs", "SceneExporter.mjs", "SceneNavBar.mjs"],
  tray: [
    "TraySD.mjs",
    "TrayApp.mjs",
    "SDXRollerApp.mjs",
    "SDXRollerData.mjs",
    // Prototype mixins and helpers split out of TrayApp. Phase 5.1 took the
    // TOM panels, the hex-painter controls, the decor importer and the scroll
    // state; Phase 5.3 took the four _onRender sections. All are tray UI —
    // they reach into other features the way TrayApp always did, from the
    // tray side, so ownership does not move with the code they call.
    "tom-panels.mjs",
    "hex-painter-bindings.mjs",
    "decor-import.mjs",
    "tray-scroll-state.mjs",
    "tray-handle-bindings.mjs",
    "dungeon-bindings.mjs",
    "tom-scene-bindings.mjs",
    "pin-list-bindings.mjs",
  ],
  tom: [
    "TomSD.mjs",
    "TomConfig.mjs",
    "TomPlayerView.mjs",
    "TomEditors.mjs",
    "TomStore.mjs",
    "TomSocketHandler.mjs",
    "TomSceneModel.mjs",
    "TomMigrationService.mjs",
  ],
  maphub: ["MaphubSD.mjs", "MaphubLauncherApp.mjs", "MaphubViewerApp.mjs", "OnePageParserSD.mjs"],
  /**
   * Cross-cutting world configuration. Opened in Phase 3 for the last and
   * largest extraction: the 108 `settings.register` and 17 `registerMenu`
   * calls that had grown to a third of the composition root.
   *
   * A new bucket rather than an existing one, which every other Phase 3 move
   * avoided. The keys registered here span inventory, combat, character
   * sheets, carousing, NPCs, hex, dungeon, tray and canvas, so no feature owns
   * them, and `shared` is for compatibility helpers that earn their place at a
   * second consumer — not for a registration surface.
   *
   * Its many imports of `registerXSettings` from feature modules are
   * composition, the same shape as the root's own imports, so the crossings
   * the matrix records for it are expected rather than a coupling smell.
   */
  settings: [
    "module-settings.mjs",
    // Prior extractions out of the settings root, named by plan section 8.2
    // item 7 and missed when the rest of that item was closed.
    "drawing-settings.mjs",
    "settings-organization.mjs",
  ],
  /**
   * Item DOCUMENT LIFECYCLE — not item sheets, and not inventory. Opened in
   * Phase 3 for the flag-preservation wraps: Foundry and Shadowdark both build
   * new Items by copying a chosen subset of fields, and neither copies module
   * flags, so every SDX configuration on an item is lost unless something puts
   * it back.
   *
   * A new bucket because the eight flag families are configured across FOUR
   * features — `item-sheets` 4, `effects` 2, `item-macros` 1, `inventory` 1.
   * A plurality is not ownership, and `item-sheets` is named for sheets while
   * `preCreateItem` has nothing to do with one. Owner decision, 2026-07-31.
   */
  items: ["item-flag-preservation.mjs"],
  /**
   * The stable module API and the developer/templates surface. Opened in Phase
   * 3; step 13 landed `SDX.templates` here, which is what `api/` was opened for.
   */
  api: ["template-target-sync.mjs", "templates.mjs"],
  shared: [
    "sd4Compat.mjs",
    "SDXCache.mjs",
    "CompendiumIndexSD.mjs",
    "WebpMigrationSD.mjs",
    // Added in Phase 3. It lives in scripts/shared/ and was the matrix's only
    // "Classify before Phase 2" row, left unassigned by oversight rather than
    // by any open question about where it belongs.
    "module-id.mjs",
    "combat-socket.mjs",
    // Extracted from combat/CombatSettingsSD.mjs in Phase 5.1; here rather
    // than combat/ because the combat socket handlers are its second consumer.
    "scrolling-text.mjs",
    /**
     * Extracted from the composition root in Phase 3 (`851c3c1`).
     *
     * The one entry here that was a judgement call rather than a directory
     * lookup. It bridges V1 and V2 item-sheet headers, so `item-sheets` has a
     * claim on it — but its only importer is the composition root, so it fails
     * the map's second-consumer test for feature ownership, and the shared
     * bucket's definition opens with "compatibility", which is exactly what a
     * V1/V2 bridge is. Assigned to `shared`, matching both its home and its
     * purpose. If a feature module ever imports it directly, that crossing
     * earns a row in the matrix and the question can be reopened on evidence.
     */
    "appv2-header-bridge.mjs",
  ],
  /** The composition root. Its own imports are composition, not crossings. */
  root: ["shadowdark-extras.mjs"],
  /**
   * Retained collections, not features. `macros/` holds bundled macro sources
   * plus one-shot table builders; neither moves during the structural track.
   */
  macros: [
    "cleansing-weapon.mjs",
    "holy-weapon.mjs",
    "identify.mjs",
    "list-monsters.mjs",
    "shapechanger.mjs",
    "wrath.mjs",
    "create-clerical-punishments-table.js",
    "create-ship-events-table.js",
    "create-wilderness-inn-hooks-table.js",
  ],
};

const BY_MODULE = new Map();
for (const [feature, modules] of Object.entries(FEATURE_OWNERS)) {
  for (const module of modules) BY_MODULE.set(module, feature);
}

/**
 * @param {string} basename e.g. "AuraEffectsSD.mjs"
 * @returns {string} the owning feature, or "unassigned"
 */
export function featureOf(basename) {
  return BY_MODULE.get(basename) ?? "unassigned";
}

export function allOwnedModules() {
  return [...BY_MODULE.keys()];
}
