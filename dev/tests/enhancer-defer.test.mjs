import assert from "node:assert/strict";
import test from "node:test";

import { installPersistenceGlobals } from "./helpers/persistence-harness.mjs";

const MODULE_ID = "shadowdark-extras";
const world = installPersistenceGlobals();
const scene = world.scene;
globalThis.Hooks = { on() {}, once() {}, off() {} };
globalThis.game.user = { id: "gm", isGM: true };
globalThis.game.users = { activeGM: globalThis.game.user };
globalThis.game.modules = { get: () => undefined };
globalThis.PIXI.Graphics = class {};
globalThis.PIXI.LegacyGraphics = class {};

const { enhancerActive, enhancerOwns } = await import("../../scripts/settings/enhancer-defer.mjs");
const { FEATURE_IDS, getFeatureState } = await import("../../scripts/settings/feature-gates.mjs");
const { isHexFogEnabled, isPointRevealed } = await import("../../scripts/hex/SDXHexFogSD.mjs");

const withEnhancer = ({ active = true, owns } = {}) => {
	globalThis.game.modules = { get: id => (id === "shadowdark-enhancer" ? { active } : undefined) };
	globalThis.game.shadowdarkEnhancer = owns ? { owns } : undefined;
};
const absent = () => {
	globalThis.game.modules = { get: () => undefined };
	globalThis.game.shadowdarkEnhancer = undefined;
};

test("with the Enhancer absent or inactive nothing defers", () => {
	absent();
	assert.equal(enhancerActive(), false);
	assert.equal(enhancerOwns("hex.fog", scene), false);
	withEnhancer({ active: false });
	assert.equal(enhancerActive(), false);
});

test("enhancerOwns asks the Enhancer per feature and per scene, and a throwing answer is no", () => {
	const asked = [];
	withEnhancer({ owns: (feature, target) => { asked.push([feature, target]); return feature === "hex.fog"; } });
	assert.equal(enhancerOwns("hex.fog", scene), true);
	assert.equal(enhancerOwns("hex.tooltip", scene), false);
	assert.deepEqual(asked, [["hex.fog", scene], ["hex.tooltip", scene]]);
	withEnhancer({ owns: () => { throw new Error("boom"); } });
	assert.equal(enhancerOwns("hex.fog", scene), false);
	withEnhancer({ owns: () => "yes" });
	assert.equal(enhancerOwns("hex.fog", scene), false, "only a literal true counts");
});

test("Carousing is off while the Enhancer is active, and only Carousing", () => {
	absent();
	assert.equal(getFeatureState(FEATURE_IDS.CAROUSING, []).enabled, true);
	withEnhancer({ active: true });
	assert.deepEqual(getFeatureState(FEATURE_IDS.CAROUSING, []), { enabled: false, reason: "enhancer", blockedBy: null });
	assert.equal(getFeatureState(FEATURE_IDS.HEX_TOOLTIP, []).enabled, true);
	assert.equal(getFeatureState(FEATURE_IDS.HEX_FOG, []).enabled, true);
	assert.equal(getFeatureState(FEATURE_IDS.COORDINATES, []).enabled, true);
	withEnhancer({ active: false });
	assert.equal(getFeatureState(FEATURE_IDS.CAROUSING, []).enabled, true);
});

test("Extras' fog reads as off and reveals everything on a scene the Enhancer owns", async () => {
	await scene.setFlag(MODULE_ID, "hexFogEnabled", true);
	await scene.setFlag(MODULE_ID, "hexFogRevealed", {});
	const hexScene = Object.assign(scene, { grid: { isHexagonal: true, getOffset: () => ({ i: 0, j: 0 }) } });
	globalThis.canvas = { scene: hexScene, grid: hexScene.grid };

	absent();
	assert.equal(isHexFogEnabled(scene.id), true);
	assert.equal(isPointRevealed(hexScene, { x: 1, y: 1 }), false, "an unrevealed hex is hidden when nothing defers");

	withEnhancer({ owns: (feature, target) => feature === "hex.fog" && target === scene });
	assert.equal(isHexFogEnabled(scene.id), false);
	assert.equal(isPointRevealed(hexScene, { x: 1, y: 1 }), true, "nothing is hidden by Extras there");

	withEnhancer({ owns: () => false });
	assert.equal(isHexFogEnabled(scene.id), true, "a scene the Enhancer has not adopted keeps Extras' fog");
});
