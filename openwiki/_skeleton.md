---
type: "Reference"
title: "Wiki Skeleton"
openwiki_generated: true
---

# Wiki Skeleton

## Inventory and ranking

1. **Composition root and feature gates** — `module.json`, `scripts/shadowdark-extras.mjs`, `scripts/settings/*`; every runtime subsystem is composed and gated here.
2. **Combat, spell activity, effects, and item macros** — cross-feature gameplay path with chat, sockets, flags, document lifecycle, and dense focused tests.
3. **Party, tray, journal pins, hex, dungeon, and TOM** — major user-facing workflows joined by Foundry documents, canvas state, sockets, and the tray.
4. **Inventory, character/NPC/item sheets, animation** — substantial sheet and token extension surfaces with focused test ownership.
5. **Build, packs, validation, and public automation API** — manifest-backed distribution and safety gates.

## Planned pages

| Planned file | Purpose and source evidence brief |
| --- | --- |
| `architecture/overview.md` | Module runtime model, manifest dependencies, composition-root phases, and feature-gate control plane. Evidence: `module.json`, `scripts/shadowdark-extras.mjs`, `scripts/settings/feature-gates.mjs`, lifecycle/ownership tests. |
| `architecture/feature-management.md` | Disabled-feature persistence, catalog/dependencies, Feature Manager UI, registration/settings ownership, and safe extension rules. Evidence: `scripts/settings/{feature-gates,FeatureManagerApp,module-settings}.mjs`, feature-manager tests. |
| `architecture/public-api.md` | `module.api` setup-time construction, GM/audit wrappers, API ownership removal, legacy esmodule exports, and map/template automation seams. Evidence: `scripts/shadowdark-extras.mjs`, `scripts/api/*`, API/export tests. |
| `architecture/persistence-and-migrations.md` | Canonical state-owner map (settings, flags, journals, scenes, TOM store), ready-time and feature-local migrations, idempotency/retry/partial failures, and compatibility tests. Evidence: root ready migration block, `WebpMigrationSD.mjs`, item-macro/TOM/hex tests. **TODO RQ-06.** |
| `architecture/tray-and-cross-feature-ui.md` | Tray modes, gate context/lazy loading, binding registration/cleanup, panel ownership, SDX Roller lifecycle, party-stat sockets, and its pins/hex/dungeon/party/TOM consumers. Evidence: `scripts/tray/*`, `TraySD.mjs`, tray and feature-manager tests. **TODO RQ-04.** |
| `combat/damage-cards.md` | Chat-message capture, card pipeline, targeting, damage application/socket boundary, weapon-bonus relationship, failure/duplication guards. Evidence: `scripts/combat/*`, `dev/tests/lane-b-*.test.mjs`. |
| `combat/encounter-tools-and-roll-hooks.md` | Marching and formation lifecycle, Medkit world scan/update authority, Crawl Helper, Freya’s Omen, scrolling combat text, and roll/chat patch ordering, gates, mutations, and regression tests. Evidence: `scripts/combat/{MarchingModeSD,FormationSpawnerSD,MedkitSD,roll-patches,freyas-omen}.mjs`, `dev/tests/marching-*.test.mjs`, roll/Medkit tests. **TODO RQ-03.** |
| `spells/effects-and-macros.md` | Spell activity flags, template/aura/focus/duration lifecycle, item macro authority/migration, and optional TokenMagic behavior. Evidence: `scripts/effects/*`, `scripts/item-macros/*`, item sheet config modules, effects/macro tests. |
| `animation/animation-fx.md` | Sequencer/AA coordination, preset and override resolution, token resolver, persistent torch/weapon/level-up effects, and deduplication. Evidence: `scripts/animation/*`, animation tests. |
| `inventory/containers-and-sheets.md` | Container storage/slot calculation; trading/ammunition; gems; transfer permissions/socket paths; Item Piles compatibility/state preservation; unidentified privacy; multi-select/default-drop mutations; styling; and item-sheet/activity boundaries. Evidence: `scripts/inventory/*`, `scripts/item-sheets/*`, container, Item Piles, unidentified, and inventory tests. **TODO RQ-05.** |
| `sheets/character-and-npc.md` | Ordered player/NPC render dispatchers, custom sheets, NPC inventory/creature types, flags and extension placement. Evidence: root dispatchers, `scripts/character-sheet/*`, `scripts/npc/*`, focused tests. |
| `party/travel-and-carousing.md` | Party actor/membership model, travel/camping mutation authority, socket fallback, carousing journals/session/tables/outcomes/logs. Evidence: `scripts/party/*`, carousing modules and tests. |
| `journal/journal-pins.md` | Scene-flag pin schema, GM CRUD/visibility, canvas layer and rebuild lifecycle/concurrency, style editor, interactions, and TokenMagic adapter. Evidence: `scripts/journal/pin-*.mjs`, `JournalPinsSD.mjs`, pin tests. **TODO RQ-02.** |
| `canvas/canvas-tools.md` | Synchronized drawing state/geometry/shapes, tile flatten/restore rendering isolation, light tracker, token toolbar, wall menu, and relevant gates. Evidence: `scripts/canvas/*`, canvas tests. **TODO RQ-02.** |
| `scene/scene-portability.md` | Scene export/import ZIP contract, assets/documents/hex data, native Notes versus SDX pins boundary, and import failure behavior. Evidence: `scripts/scene/*`. **TODO RQ-02.** |
| `maps/maphub.md` | Launcher-to-viewer/parser/cave flow, bundled assets, journal placeholders, map state and Scene boundaries, and HTTPS/local/Blob compatibility behavior. Evidence: `Maphub*.mjs`, `maphub-cave.mjs`, `scripts/maphub/*`. **TODO RQ-02.** |
| `hex/hex-exploration.md` | Hex journal and Scene flags, content/tooltip/fog/solo exploration authority and visibility, coordinate/painter/generator consumers, and persistence invariants. Evidence: `scripts/hex/*`, hex persistence/coordinate tests. **TODO RQ-01.** |
| `dungeon/dungeon-generation.md` | Dungeon painter/generator/cave/biome/level/region workflow, GM authority, scene mutations, and hex-dungeon Scene→Journal→Pin bridge. Evidence: `scripts/dungeon/*`, `HexDungeonBridgeSD.mjs`, dungeon/hex tests. **TODO RQ-01.** |
| `tom/theatre-of-the-mind.md` | TOM world-setting store/version migration, GM/player socket protocol, Player View/HP sync, overlays, tray calls, and focused tests. Evidence: `scripts/tom/*`, TOM and tray tests. **TODO RQ-01.** |
| `content/compendium-packs.md` | Manifest pack registry, YAML source-to-LevelDB build, pack types/content flags, editable data boundary. Evidence: `module.json`, `src/packs/*`, `dev/packs/*`. |
| `engineering/validation-and-release.md` | Node/tool scripts, structural snapshots, tests/Quench, pack/release validation and limitations. Evidence: `package.json`, `verify.sh`, `dev/tools/README.md`, `dev/release-check.mjs`, workflows. |
| `quickstart.md` | Written last: repository map, all major page links, task routing, minimal focused validation, and valid deferrals/backlog. |

## Coverage ledger

- Manifest entrypoints and public surfaces: overview, public API, compendium packs, validation/release.
- Every feature family in `FEATURE_CATALOG`: overview/feature management plus its owning gameplay or UI page above.
- Major workflows: Foundry lifecycle; feature disablement; chat damage; activity effect lifecycle; macro GM execution; containers; travel; carousing; pin rendering; scene portability; Maphub; hex exploration; hex-to-dungeon creation; TOM broadcast; tray cross-feature UI; packaging/release.
- Representative tests and narrow validation are included on every substantive page.

## Critic TODO ledger

- **RQ-01 — RESOLVED.** Replaced the combined maps page with `hex/hex-exploration.md`, `dungeon/dungeon-generation.md`, and `tom/theatre-of-the-mind.md`; each brief names persistence, authority, consumers/entrypoints, and tests.
- **RQ-02 — RESOLVED.** Replaced combined journal/canvas/scenes page with dedicated pins, canvas tools, scene portability, and Maphub pages. The pins and Maphub briefs explicitly include requested concurrency/permissions/TokenMagic and launcher/viewer/parser/cave/assets/boundary/compatibility coverage.
- **RQ-03 — RESOLVED.** Added dedicated encounter-tools and roll-hooks page with all specified combat services, lifecycle/ordering, gates, mutations, and tests.
- **RQ-04 — RESOLVED.** Added dedicated tray and cross-feature UI architecture page including modes, gate context, bindings, roller, party socket, integrations, tests, and extension points.
- **RQ-05 — RESOLVED.** Expanded inventory page brief to enumerate all requested workflows and their authority/state/test boundaries.
- **RQ-06 — RESOLVED.** Added canonical persistence and migrations page with owners, schemas, migration order/recovery, compatibility constraints, and characterization tests.
