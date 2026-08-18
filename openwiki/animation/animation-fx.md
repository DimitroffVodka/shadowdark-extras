---
type: subsystem guide
title: Animation FX Architecture
description: Sequencer playback, Automated Animations coordination, config precedence, and token-safe persistent effects.
tags: [animation, sequencer, tokens]
---
# Animation FX Architecture

Animation registration is feature-gated in the root. `AnimationFxSD.mjs` owns native Sequencer/JB2A playback and settings; `AutoAnimationsSD.mjs` coordinates with Automated Animations; torch, weapon, and level-up modules own persistent/event visuals.

Resolution precedence is per-item `flags.shadowdark-extras.animationFx`, then longest matching master regex in `animationFxConfig`, then category `_default`. World seeding is GM-only and merge-not-overwrite, so a preset deleted by a GM stays deleted. Optional JB2A/Sequencer paths must check availability and degrade without throwing.

AA hooks mark pre-roll cards, suppress misses and critical failures, allow critical success, and may permit configured no-target spells. Native and AA paths must not double-play the same effect.

`token-resolution.mjs` provides `getTokensForActor`: synthetic/unlinked actors target only their own token, base actors target linked tokens, and stale/no-scene contexts yield none. Every persistent effect system imports this shared resolver. `AnimationEffectDedupSD.mjs` retains the newest matching SDX effect and treats z-index as identity, preserving separate torch prop/flame layers.

**Validate:** `npm test -- dev/tests/animation-token-resolution.test.mjs dev/tests/animation-effect-dedup.test.mjs dev/tests/torch-animation-stop.test.mjs dev/tests/weapon-animation-stop.test.mjs`.