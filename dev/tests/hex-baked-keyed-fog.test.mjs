import assert from "node:assert/strict";
import test from "node:test";

import { installPersistenceGlobals } from "./helpers/persistence-harness.mjs";

// Which fog answers for a baked map's keyed sprites (#490): the Enhancer's when it owns the scene's
// fog, Extras' own otherwise. Extras writes no fog on an Enhancer scene, so its flags go stale there.
installPersistenceGlobals();
const hooks = [];
globalThis.Hooks = { on: name => hooks.push(name), once() {}, off() {} };
globalThis.PIXI.Graphics = class {};
globalThis.PIXI.LegacyGraphics = class {};
globalThis.foundry.canvas ??= {};
globalThis.foundry.canvas.SceneManager ??= class {};

const { keyedFog, registerBakedScenes } = await import("../../scripts/hex/hex-baked-scene.mjs");

const sceneWith = flags => ({ id: "baked", flags: { "shadowdark-extras": flags } });
const enhancer = (fog, { owns = feature => feature === "hex.fog" } = {}) => {
	globalThis.game.shadowdarkEnhancer = { owns, hexMaps: { fog } };
};
const absent = () => { globalThis.game.shadowdarkEnhancer = undefined; };
const exploredRecords = records => {
	globalThis.game.journal = { find: () => ({ getFlag: (_scope, key) => (key === "hexData" ? { baked: records } : undefined) }) };
};

test("the Enhancer owns the scene: art follows its location disclosure, not Extras' stale flags", () => {
	const asked = [];
	enhancer({ disclosed: (scene, offset, kind) => { asked.push([scene, offset, kind]); return offset.i === 3 && offset.j === 4; } });
	const scene = sceneWith({ hexFogEnabled: true, hexFogRevealed: { "5-5": true }, hexFogDiscovery: { "3-4": "terrain" } });
	const fog = keyedFog(scene);
	assert.equal(fog.on, true);
	assert.equal(fog.shown("3-4"), true);
	assert.equal(fog.shown("5-5"), false, "a reveal only Extras' old flags know does not show the art");
	assert.equal(fog.discovery("3-4"), undefined, "the location kind already says what a terrain-only sighting does");
	assert.deepEqual(asked[0], [scene, { i: 3, j: 4 }, "location"]);
});

test("the Enhancer owns the scene: negative offsets are read back from their key", () => {
	const asked = [];
	enhancer({ disclosed: (_scene, offset) => { asked.push(offset); return true; } });
	keyedFog(sceneWith({})).shown("-2-7");
	assert.deepEqual(asked, [{ i: -2, j: 7 }]);
});

test("the Enhancer owns the scene but cannot answer: the art stays hidden", () => {
	enhancer({ disclosed: () => { throw new Error("records not loaded"); } });
	const fog = keyedFog(sceneWith({}));
	assert.equal(fog.on, true);
	assert.equal(fog.shown("3-4"), false, "a throw is no");
	enhancer({});
	assert.equal(keyedFog(sceneWith({})).shown("3-4"), false, "a module without the read is no");
	enhancer({ disclosed: () => "yes" });
	assert.equal(keyedFog(sceneWith({})).shown("3-4"), false, "only a literal true counts");
});

test("the Enhancer does not own this scene: Extras' own fog decides, as before", () => {
	enhancer({ disclosed: () => assert.fail("must not ask the Enhancer") }, { owns: () => false });
	exploredRecords({ "7_8": { exploration: "mapped" } });
	const fog = keyedFog(sceneWith({ hexFogEnabled: true, hexFogRevealed: { "5-5": true }, hexFogDiscovery: { "5-5": "terrain" } }));
	assert.equal(fog.on, true);
	assert.equal(fog.shown("5-5"), true);
	assert.equal(fog.discovery("5-5"), "terrain");
	assert.equal(fog.shown("7-8"), true, "a mapped record shows the hex");
	assert.equal(fog.shown("1-1"), false);
});

test("no Enhancer and fog off: every sprite shows, as with Extras' fog off today", () => {
	absent();
	const fog = keyedFog(sceneWith({}));
	assert.equal(fog.on, false);
});

test("the renderer listens for the Enhancer's fog hook", () => {
	globalThis.game.scenes = { forEach() {} };
	globalThis.canvas = { ready: false };
	registerBakedScenes();
	assert.ok(hooks.includes("shadowdark-enhancer.hexFogChanged"));
});
