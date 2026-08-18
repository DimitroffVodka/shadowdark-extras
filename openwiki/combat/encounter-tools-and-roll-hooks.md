---
type: subsystem guide
title: Encounter Tools and Roll Hooks
description: Combat-adjacent movement, formation, roll/chat patches, text, and world-maintenance services.
tags: [combat, hooks, encounters]
---
# Encounter Tools and Roll Hooks

This page covers combat services outside the damage-card pipeline. Their registrations remain ordered in `scripts/shadowdark-extras.mjs`; gate them with their `FEATURE_IDS` and do not alter their hook position without snapshot review.

- **Marching Mode** (`MarchingModeSD.mjs`) coordinates leader/party movement and combat state, including resume and cleanup behavior. It exposes sidebar/tray affordances and must reject conga-style invalid movement; zero-like positions are valid state, not absent state.
- **Formation Spawner** (`FormationSpawnerSD.mjs`) places arranged token formations and owns its dialog/template workflow.
- **Medkit** (`MedkitSD.mjs`) registers source packs and scans/applies world spell-enhancement updates. Its world writes are a GM-maintenance boundary.
- **Freya’s Omen** (`freyas-omen.mjs`) hooks spell cards for reroll handling.
- **Crawl Helper Death Timer** (`crawl-helper-death-timer.mjs`) is an optional interoperability hook.
- **Scrolling combat text** uses `setupScrollingCombatText()` and shared `scrolling-text.mjs` to present token feedback.
- **Roll patches** (`roll-patches.mjs`) and chat hooks modify Shadowdark roll/config lifecycle. Their ordering relative to card rendering and feature gates is observable.

Treat actor/token/document updates as authority-sensitive: prefer GM/socket routes already supplied by the service. For item roll outcomes and card application, use [Damage Cards](damage-cards.md).

**Focused tests:** `dev/tests/marching-combat-resume.test.mjs`, `marching-conga-rejection.test.mjs`, `marching-falsy-zero.test.mjs`, `roll-config-advantage.test.mjs`, `require-equipped.test.mjs`, plus Medkit tests. Run `npm test` for the complete discovered suite.