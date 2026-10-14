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

const { enhancerActive, enhancerOwns, layKeyedGround } = await import("../../scripts/settings/enhancer-defer.mjs");
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

// The Enhancer's plain ground under keyed hexes (hexMaps.fillKeyedGround), laid for a bake and taken away after.
const groundScene = tiles => ({ tiles: { size: tiles } });
const groundApi = (target, { created = 0, unfilled = [], landed = created, fails = false, removeFails = false } = {}) => {
	const calls = [];
	globalThis.game.shadowdarkEnhancer = {
		hexMaps: {
			fillKeyedGround: async scene => {
				calls.push("fill");
				scene.tiles.size += landed;
				if (fails) throw new Error("not a GM");
				return { created, unfilled };
			},
			removeKeyedGround: async scene => {
				calls.push("remove");
				if (removeFails) throw new Error("locked");
				return { removed: scene.tiles.size - target };
			},
		},
	};
	return calls;
};

test("ground is laid before the bake and removed after it, because this call made it", async () => {
	const scene = groundScene(100);
	const calls = groundApi(100, { created: 3 });
	const laid = await layKeyedGround(scene, 3);
	assert.equal(laid.created, 3);
	assert.deepEqual(calls, ["fill"]);
	assert.equal(await laid.remove(), null);
	assert.deepEqual(calls, ["fill", "remove"]);
});

test("ground the Enhancer's own Bake map already laid is left for it to remove", async () => {
	const calls = groundApi(100, { created: 0 });
	const laid = await layKeyedGround(groundScene(100), 3);
	assert.equal(laid.created, 0);
	await laid.remove();
	assert.deepEqual(calls, ["fill"], "made nothing here, so removes nothing");
});

test("nothing is laid with no keyed art, no Enhancer, or an Enhancer without the call", async () => {
	const calls = groundApi(0, { created: 5 });
	assert.equal((await layKeyedGround(groundScene(0), 0)).created, 0);
	assert.deepEqual(calls, []);
	absent();
	const none = await layKeyedGround(groundScene(0), 3);
	assert.deepEqual([none.created, none.unfilled, none.error], [0, [], null]);
	assert.equal(await none.remove(), null);
	globalThis.game.shadowdarkEnhancer = { hexMaps: { fog: {} } };
	assert.equal((await layKeyedGround(groundScene(0), 3)).created, 0);
});

test("keyed hexes the Enhancer could not fill are reported, not guessed", async () => {
	const unfilled = [{ num: 12, reason: "no ground known", terrain: null }];
	groundApi(10, { created: 2, unfilled });
	const laid = await layKeyedGround(groundScene(10), 3);
	assert.deepEqual(laid.unfilled, unfilled);
});

test("a fill that fails after some tiles landed still removes them, and says why", async () => {
	const calls = groundApi(10, { landed: 4, fails: true });
	const laid = await layKeyedGround(groundScene(10), 3);
	assert.equal(laid.error.message, "not a GM");
	assert.equal(laid.created, 4, "counted from the scene, since the report never came");
	await laid.remove();
	assert.deepEqual(calls, ["fill", "remove"]);
});

test("a fill that fails with nothing landed removes nothing", async () => {
	const calls = groundApi(10, { landed: 0, fails: true });
	const laid = await layKeyedGround(groundScene(10), 3);
	assert.equal(laid.error.message, "not a GM");
	await laid.remove();
	assert.deepEqual(calls, ["fill"]);
});

test("a removal that fails is returned, never thrown, so the bake's result is not lost", async () => {
	groundApi(10, { created: 2, removeFails: true });
	const laid = await layKeyedGround(groundScene(10), 3);
	const stuck = await laid.remove();
	assert.equal(stuck.message, "locked");
	absent();
});
