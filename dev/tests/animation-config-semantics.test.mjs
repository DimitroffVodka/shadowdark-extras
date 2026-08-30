import assert from "node:assert/strict";
import test from "node:test";

import {
	applyAnimationDuration,
	getLegacyGenericWeaponPreset,
	migrateLegacyAnimationDurations,
} from "../../scripts/animation/animation-fx-duration.mjs";
import { resolveAnimationPreviewTargets } from "../../scripts/animation/animation-fx-preview.mjs";
import {
	toCssWeaponColorMatrix,
	toSequencerWeaponColorMatrix,
} from "../../scripts/animation/weapon-sprite-color.mjs";
import { DEFAULT_NPC_ATTACK_PRESETS } from "../../scripts/animation/presets/npc-attack-presets.mjs";
import { DEFAULT_SPELL_PRESETS } from "../../scripts/animation/presets/spell-animation-presets.mjs";
import { DEFAULT_WEAPON_PRESETS } from "../../scripts/animation/presets/weapon-animation-presets.mjs";

const source = { id: "caster", x: 100, y: 200, w: 100, h: 100 };
const target = { id: "target", x: 500, y: 200, w: 100, h: 100 };

test("on-token preview anchor chooses the caster or target", () => {
	assert.deepEqual(
		resolveAnimationPreviewTargets({ type: "onToken", target: "self" }, source, [source], target),
		[source],
	);
	assert.deepEqual(
		resolveAnimationPreviewTargets({ type: "onToken", target: "target" }, source, [source], target),
		[target],
	);
});

test("target-anchored preview uses another controlled token before a user target", () => {
	const second = { id: "second", x: 300, y: 200, w: 100, h: 100 };
	assert.deepEqual(
		resolveAnimationPreviewTargets({ type: "onToken", target: "target" }, source, [source, second], target),
		[second],
	);
});

test("target-anchored on-token preview falls back to the caster without another token", () => {
	assert.deepEqual(resolveAnimationPreviewTargets(
		{ type: "onToken", target: "target" }, source, [source], null,
	), [source]);
});

test("projectile preview still creates a distinct fallback point", () => {
	const [fallback] = resolveAnimationPreviewTargets(
		{ type: "projectile", target: "target" }, source, [source], null,
	);
	assert.equal(fallback.id, "_preview_offset");
	assert.notEqual(fallback.x, source.x);
});

test("Auto duration leaves Sequencer at the media's natural length", () => {
	const calls = [];
	const effect = { duration: value => calls.push(value) };
	applyAnimationDuration(effect, 0);
	assert.deepEqual(calls, []);
	applyAnimationDuration(effect, 2450);
	assert.deepEqual(calls, [2450]);
});

test("legacy bundled durations migrate to Auto without replacing custom values", () => {
	const bundled = {
		spells: {
			fireball: {
				type: "projectile",
				hit: { file: "jb2a.fireball", duration: 1800 },
			},
			customized: {
				type: "projectile",
				hit: { file: "jb2a.customized", duration: 1500 },
			},
		},
		weapons: {
			longsword: {
				type: "onToken",
				hit: { file: "weapons/longsword.webm", duration: 1000 },
			},
		},
		npcActions: {},
	};
	const stored = {
		spells: {
			fireball: {
				type: "projectile",
				hit: { file: "jb2a.fireball", duration: 1800 },
			},
			customized: {
				type: "projectile",
				hit: { file: "jb2a.customized", duration: 2222 },
			},
		},
		weapons: {
			longsword: {
				type: "onToken",
				hit: { file: "weapons/longsword.webm", duration: 1000 },
			},
		},
		npcActions: {},
	};

	const result = migrateLegacyAnimationDurations(stored, bundled);
	assert.equal(result.changed, true);
	assert.equal(result.config.spells.fireball.hit.duration, 0);
	assert.equal(result.config.weapons.longsword.hit.duration, 0);
	assert.equal(result.config.spells.customized.hit.duration, 2222);
	assert.equal(stored.spells.fireball.hit.duration, 1800, "does not mutate stored settings");
});

test("the shipped generic melee duration migrates from 1000ms to Auto", () => {
	const bundled = {
		spells: {},
		weapons: {
			_default: getLegacyGenericWeaponPreset({
				type: "onToken",
				hit: { file: "generic-melee.webm", duration: 0 },
			}),
		},
		npcActions: {},
	};
	const stored = {
		_durationDefaultsVersion: 1,
		weapons: {
			_default: {
				type: "onToken",
				hit: { file: "generic-melee.webm", duration: 1000 },
			},
		},
	};

	assert.equal(bundled.weapons._default.hit.duration, 1000);
	const result = migrateLegacyAnimationDurations(stored, bundled);
	assert.equal(result.config.weapons._default.hit.duration, 0);
	assert.equal(result.config._durationDefaultsVersion, 2);
});

test("all bundled transient animation defaults use natural media duration", () => {
	for (const presets of [DEFAULT_SPELL_PRESETS, DEFAULT_WEAPON_PRESETS, DEFAULT_NPC_ATTACK_PRESETS]) {
		for (const [key, preset] of Object.entries(presets)) {
			assert.equal(preset.hit.duration, 0, `${key} must default to Auto duration`);
		}
	}
});

test("equipped-sprite neutral contrast means the same thing in CSS and Sequencer", () => {
	const stored = { hue: 0, brightness: 1, contrast: 1, saturate: 0 };
	assert.deepEqual(toSequencerWeaponColorMatrix(stored), {
		hue: 0,
		brightness: 1,
		contrast: 0,
		saturate: 0,
	});
	assert.deepEqual(toCssWeaponColorMatrix(stored), {
		hue: 0,
		brightness: 1,
		contrast: 1,
		saturate: 1,
	});
});

test("equipped-sprite custom contrast translates without changing its intent", () => {
	assert.equal(toSequencerWeaponColorMatrix({ contrast: 1.4 }).contrast, 0.4);
	assert.equal(toCssWeaponColorMatrix({ contrast: 1.4 }).contrast, 1.4);
});
