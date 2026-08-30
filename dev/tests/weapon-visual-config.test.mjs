import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyAttackFxTint, resolveNativeColorVariants } from "../../scripts/animation/animation-fx-color.mjs";
import { resolveWeaponSpriteFormState } from "../../scripts/animation/weapon-sprite-form-state.mjs";

const inherited = {
	label: "Dagger Sprite",
	enabled: true,
	imagePath: "modules/shadowdark-extras/assets/Weapons/dagger.webp",
	offsetX: 0.4,
	offsetY: -0.1,
	rotation: 15,
	scale: 1.2,
	animationType: "bobbing",
};

test("an inherited equipped sprite is presented as enabled with its effective settings", () => {
	const state = resolveWeaponSpriteFormState(null, inherited);

	assert.equal(state.mode, "inherited");
	assert.equal(state.config.enabled, true);
	assert.equal(state.config.imagePath, inherited.imagePath);
	assert.equal(state.config.offsetX, 0.4);
	assert.equal(state.config.offsetY, -0.1);
	assert.equal(state.config.rotation, 15);
	assert.equal(state.config.scale, 1.2);
	assert.equal(state.config.animationType, "bobbing");
	assert.equal(state.hasInherited, true);
});

test("an explicitly disabled equipped sprite still displays the inherited image and settings", () => {
	const state = resolveWeaponSpriteFormState({ enabled: false }, inherited);

	assert.equal(state.mode, "disabled");
	assert.equal(state.config.enabled, false);
	assert.equal(state.config.imagePath, inherited.imagePath);
	assert.equal(state.config.offsetX, inherited.offsetX);
	assert.equal(state.hasInherited, true);
});

test("a custom equipped sprite wins over the inherited master preset", () => {
	const state = resolveWeaponSpriteFormState({
		enabled: true,
		imagePath: "custom/sword.webp",
		offsetX: -0.25,
		filters: { colorMatrix: { hue: 90 } },
	}, inherited);

	assert.equal(state.mode, "custom");
	assert.equal(state.config.enabled, true);
	assert.equal(state.config.imagePath, "custom/sword.webp");
	assert.equal(state.config.offsetX, -0.25);
	assert.equal(state.config.filters.colorMatrix.hue, 90);
	assert.equal(state.config.filters.colorMatrix.brightness, 1);
});

test("native color discovery uses the resolved Sequencer path and returns installed siblings", () => {
	const entries = new Set([
		"jb2a.greatsword.melee.standard.blue",
		"jb2a.greatsword.melee.standard.green",
		"jb2a.greatsword.melee.standard.white",
	]);
	const database = {
		getEntry: () => ({ dbPath: "jb2a.greatsword.melee.standard.white" }),
		getPathsUnder: path => path === "jb2a.greatsword.melee.standard"
			? ["white", "green", "blue", "_markers"]
			: [],
		entryExists: path => entries.has(path),
	};

	assert.deepEqual(resolveNativeColorVariants("jb2a.greatsword.melee.standard", database), [
		{ color: "blue", label: "Blue", path: "jb2a.greatsword.melee.standard.blue", current: false },
		{ color: "green", label: "Green", path: "jb2a.greatsword.melee.standard.green", current: false },
		{ color: "white", label: "White", path: "jb2a.greatsword.melee.standard.white", current: true },
	]);
});

test("native color discovery ignores raw file paths and unavailable databases", () => {
	assert.deepEqual(resolveNativeColorVariants("modules/example/red.webm", {}), []);
	assert.deepEqual(resolveNativeColorVariants("jb2a.fire_bolt.orange", null), []);
});

test("attack FX tint is opt-in and forwards color adjustments to Sequencer", () => {
	const calls = [];
	const effect = {
		tint: value => calls.push(["tint", value]),
		filter: (name, value) => calls.push(["filter", name, value]),
	};

	applyAttackFxTint(effect, { tint: { enabled: false, color: "#ff0000" } });
	assert.deepEqual(calls, []);

	applyAttackFxTint(effect, {
		tint: { enabled: true, color: "#12abef", contrast: 0.2, saturation: -0.35 },
	});
	assert.deepEqual(calls, [
		["tint", "#12abef"],
		["filter", "ColorMatrix", { contrast: 0.2, saturate: -0.35 }],
	]);
});

test("weapon sheets expose separate Attack FX and Equipped Sprite controls", () => {
	const source = readFileSync(new URL("../../scripts/combat/weapon-bonus-ui.mjs", import.meta.url), "utf8");
	assert.match(source, /sdx-weapon-attack-fx-btn/);
	assert.match(source, /sdx-weapon-animation-btn/);
	assert.match(source, /data-item-uuid/);
	assert.match(source, /itemButtonSelector/);
	assert.match(source, /FEATURE_IDS\.ANIMATION_ITEM_OVERRIDES/);
	assert.match(source, /FEATURE_IDS\.WEAPON_SPRITES/);
	assert.match(source, /openWeaponAttackFxConfig/);
	assert.match(source, /openWeaponAnimationConfig/);
});

test("spell sheets expose the same direct per-item animation editor as weapons", () => {
	const source = readFileSync(new URL("../../scripts/combat/weapon-bonus-ui.mjs", import.meta.url), "utf8");
	const root = readFileSync(new URL("../../scripts/shadowdark-extras.mjs", import.meta.url), "utf8");
	const dialog = readFileSync(new URL("../../scripts/animation/WeaponAttackFxConfig.mjs", import.meta.url), "utf8");

	assert.match(source, /item\.type === "Spell"/);
	assert.match(source, /sdx-spell-attack-fx-btn/);
	assert.match(source, /weaponAnimation\.spellFxButton/);
	assert.match(root, /item\?\.type === "Spell"/);
	assert.match(dialog, /item\?\.type === "Spell"/);
});

test("equipped-sprite editor resolves inheritance and offers reset to master", () => {
	const source = readFileSync(new URL("../../scripts/animation/WeaponAnimationConfig.mjs", import.meta.url), "utf8");
	const template = readFileSync(new URL("../../templates/weapon-animation-config.hbs", import.meta.url), "utf8");
	assert.match(source, /resolveWeaponSpriteFormState\(storedConfig, inheritedConfig\)/);
	assert.match(source, /unsetFlag\(MODULE_ID, "weaponAnimation"\)/);
	assert.match(template, /data-action="useMaster"/);
	assert.match(template, /spriteState\.mode/);
});

test("equipped-sprite previews stay local and have room outside the token bounds", () => {
	const runtime = readFileSync(new URL("../../scripts/animation/WeaponAnimationSD.mjs", import.meta.url), "utf8");
	const config = readFileSync(new URL("../../scripts/animation/WeaponAnimationConfig.mjs", import.meta.url), "utf8");
	const template = readFileSync(new URL("../../templates/weapon-animation-config.hbs", import.meta.url), "utf8");
	const styles = readFileSync(new URL("../../styles/shadowdark-extras.css", import.meta.url), "utf8");

	assert.match(runtime, /getPreviewEffectName/);
	assert.match(runtime, /\.aboveLighting\(true\)/);
	assert.match(runtime, /\.temporary\(\)/);
	assert.match(runtime, /\.locally\(\)/);
	assert.match(config, /LIVE_PREVIEW_DEBOUNCE_MS\s*=\s*75/);
	assert.match(template, /class="weapon-preview-token"/);
	assert.match(styles, /\.weapon-preview-box\s*\{[^}]*width:\s*200px;[^}]*height:\s*200px;/s);
});

test("weapon Attack FX editor exposes native colors, tint controls, and canvas preview", () => {
	const config = readFileSync(new URL("../../scripts/animation/AnimationFxConfig.mjs", import.meta.url), "utf8");
	const dialog = readFileSync(new URL("../../scripts/animation/WeaponAttackFxConfig.mjs", import.meta.url), "utf8");
	assert.match(config, /Native JB2A Color/);
	assert.match(config, /sdx-animfx-tint-enabled/);
	assert.match(config, /sdx-animfx-tint-contrast/);
	assert.match(config, /sdx-animfx-tint-saturation/);
	assert.match(config, /sdx-animfx-preview/);
	assert.match(dialog, /activateAnimationFxListeners/);
});
