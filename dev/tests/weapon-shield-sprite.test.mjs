// Shield armor resolver — #111 Option A
// Drives real production via await import("../../scripts/animation/AnimationFxSD.mjs")
// Fixtures use actual armour names from compendium sweep.

import assert from "node:assert/strict";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";

let weaponSpritesConfig = {};

function installWorld() {
	globalThis.foundry = {
		applications: { apps: {} },
		utils: {
			hasProperty: (obj, path) => {
				const parts = path.split(".");
				let cur = obj;
				for (const p of parts) { if (cur == null || !(p in cur)) return false; cur = cur[p]; }
				return true;
			},
			deepClone: obj => JSON.parse(JSON.stringify(obj)),
			mergeObject: (a,b) => Object.assign(JSON.parse(JSON.stringify(a)), b),
			getRoute: p => p,
			randomID: () => Math.random().toString(36).slice(2,10),
		},
	};
	globalThis.game = {
		modules: { get: () => ({ active: false }) },
		settings: {
			get: (mod, key) => {
				if (mod !== MODULE_ID) return true;
				if (key === "animationFxConfig") {
					return { weaponSprites: weaponSpritesConfig, spells:{}, weapons:{}, npcActions:{} };
				}
				if (key === "animationFxCategory_weaponSprites") return true;
				return true;
			},
		},
		user: { id: "testUser" },
	};
	globalThis.canvas = { tokens: { placeables: [] }, scene: { id: "sceneA" }, grid: { size: 100 } };
	globalThis.Hooks = { on: () => {}, once: () => {} };
	globalThis.ui = { notifications: { warn: () => {}, error: () => {} } };
	globalThis.Sequencer = { Database: { entryExists: () => false } };
}

installWorld();

const { AnimationFxSD } = await import("../../scripts/animation/AnimationFxSD.mjs");
const { DEFAULT_WEAPON_SPRITE_PRESETS } = await import("../../scripts/animation/presets/weapon-sprite-presets.mjs");

function reset(config = null) {
	weaponSpritesConfig = config ? JSON.parse(JSON.stringify(config)) : {};
	installWorld();
}

function makeItem(name, type, flag = undefined) {
	return {
		name,
		type,
		getFlag: () => flag,
	};
}

test("equipped Armor matching \\bshield\\b resolves to shield sprite", () => {
	reset(DEFAULT_WEAPON_SPRITE_PRESETS);
	const shield = makeItem("Shield", "Armor");
	const roundShield = makeItem("Round Shield", "Armor");
	const r1 = AnimationFxSD.resolveWeaponSprite(shield);
	assert.ok(r1, "Shield (Armor) must resolve");
	assert.equal(r1.imagePath, DEFAULT_WEAPON_SPRITE_PRESETS.shield.imagePath);
	assert.equal(r1.enabled, true);
	const r2 = AnimationFxSD.resolveWeaponSprite(roundShield);
	assert.ok(r2, "Round Shield (Armor) must resolve");
	assert.equal(r2.imagePath, DEFAULT_WEAPON_SPRITE_PRESETS.shield.imagePath);
});

test("Armor with no matching pattern resolves null — full-compendium sweep vocabulary", () => {
	reset(DEFAULT_WEAPON_SPRITE_PRESETS);
	// From full compendium sweep: 37 armour names, 7 shields matched, zero false positives.
	// These 6 are the non-shield samples that guard future pattern additions.
	const names = [
		"Nightcloak Armor",
		"Ophidian Armor",
		"Wraith Chain",
		"Memnon's Entropic Armor",
		"Mithral Chainmail",
		"Armor of Saint Terragnis",
	];
	for (const n of names) {
		const item = makeItem(n, "Armor");
		const r = AnimationFxSD.resolveWeaponSprite(item);
		assert.equal(r, null, `${n} (Armor) must resolve null — no weapon-sprite pattern should match`);
	}
});

test("Weapon resolution unchanged — dagger still resolves, non-matching weapon still null", () => {
	reset(DEFAULT_WEAPON_SPRITE_PRESETS);
	const dagger = makeItem("Dagger", "Weapon");
	const rapier = makeItem("Rapier", "Weapon");
	const r1 = AnimationFxSD.resolveWeaponSprite(dagger);
	assert.ok(r1, "Dagger (Weapon) must still resolve");
	assert.equal(r1.imagePath, DEFAULT_WEAPON_SPRITE_PRESETS.dagger.imagePath);
	const r2 = AnimationFxSD.resolveWeaponSprite(rapier);
	assert.equal(r2, null, "Rapier (Weapon) with no matching pattern must still be null");
});

test("per-item enabled:false still terminal for Armor (same as Weapon, #107 guard)", () => {
	reset(DEFAULT_WEAPON_SPRITE_PRESETS);
	const disabledPreset = JSON.parse(JSON.stringify(DEFAULT_WEAPON_SPRITE_PRESETS));
	disabledPreset.shield.enabled = false;
	reset(disabledPreset);
	const shieldDisabled = makeItem("Shield", "Armor");
	const r = AnimationFxSD.resolveWeaponSprite(shieldDisabled);
	assert.equal(r, null, "Shield with disabled preset must resolve null");
});

test("null / missing item and non-Weapon/Armor types still resolve null", () => {
	reset(DEFAULT_WEAPON_SPRITE_PRESETS);
	assert.equal(AnimationFxSD.resolveWeaponSprite(null), null);
	assert.equal(AnimationFxSD.resolveWeaponSprite(undefined), null);
	assert.equal(AnimationFxSD.resolveWeaponSprite({ name: "Shield", type: "Spell" }), null);
	assert.equal(AnimationFxSD.resolveWeaponSprite({ name: "Shield of Faith", type: "Spell" }), null);
	assert.equal(AnimationFxSD.resolveWeaponSprite({ name: "Something", type: "Gear" }), null);
});

test("shield preset offset is distinct from every 1x1 one-hander hip anchor", () => {
	// The shield must not collide with one-handers at 0.35/0.1 (mace, dagger, battleaxe
	// etc) or with bow/crossbow at -0.25/0.15/315°. Mirrored to off-hand -0.35/0.1/0°.
	const shield = DEFAULT_WEAPON_SPRITE_PRESETS.shield;
	assert.equal(shield.offsetX, -0.35, "shield must be mirrored to off-hand (offsetX -0.35)");
	assert.equal(shield.offsetY, 0.1);
	assert.equal(shield.rotation, 0);

	// Must not share anchor with any 1x1 one-hander (hip position 0.35/0.1/0°).
	for (const [key, preset] of Object.entries(DEFAULT_WEAPON_SPRITE_PRESETS)) {
		if (key === "shield") continue;
		const isHipAnchor = preset.offsetX === 0.35 && preset.offsetY === 0.1 && preset.rotation === 0;
		if (isHipAnchor) {
			assert.notEqual(
				`${shield.offsetX},${shield.offsetY},${shield.rotation}`,
				`${preset.offsetX},${preset.offsetY},${preset.rotation}`,
				`shield anchor must not collide with one-hander "${key}" at ${preset.offsetX},${preset.offsetY},${preset.rotation}`
			);
		}
	}
});
