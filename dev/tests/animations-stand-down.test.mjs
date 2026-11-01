import assert from "node:assert/strict";
import test from "node:test";

globalThis.game = { modules: { get: () => undefined } };

const { FEATURE_IDS, getFeatureState, isFeatureEnabled } = await import("../../scripts/settings/feature-gates.mjs");

const MOVED = [
	FEATURE_IDS.ANIMATION_FX,
	FEATURE_IDS.ANIMATION_ITEM_OVERRIDES,
	FEATURE_IDS.TORCH_ANIMATIONS,
	FEATURE_IDS.LEVEL_UP_ANIMATIONS,
	FEATURE_IDS.WEAPON_SPRITES,
	FEATURE_IDS.AUTOMATED_ANIMATIONS,
];
const KEPT = [FEATURE_IDS.TMFX_EDITOR, FEATURE_IDS.SCROLLING_COMBAT_TEXT, FEATURE_IDS.HP_WAVES];

const withAnimations = active => {
	globalThis.game.modules = { get: id => (id === "shadowdark-animations" ? { active } : undefined) };
};

test("without Shadowdark Animations every feature stays on", () => {
	for (const present of [undefined, false]) {
		if (present === undefined) globalThis.game.modules = { get: () => undefined };
		else withAnimations(present);
		for (const id of [...MOVED, ...KEPT]) assert.equal(isFeatureEnabled(id, []), true, id);
	}
});

test("with it active the six moved features step aside and the other three stay", () => {
	withAnimations(true);
	for (const id of MOVED) {
		assert.deepEqual(getFeatureState(id, []), { enabled: false, reason: "animations", blockedBy: null }, id);
	}
	for (const id of KEPT) assert.equal(isFeatureEnabled(id, []), true, id);
});

test("a feature the GM disabled still reports as disabled", () => {
	withAnimations(true);
	assert.equal(getFeatureState(FEATURE_IDS.TORCH_ANIMATIONS, [FEATURE_IDS.TORCH_ANIMATIONS]).reason, "disabled");
});
