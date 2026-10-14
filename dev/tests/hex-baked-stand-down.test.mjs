import assert from "node:assert/strict";
import test from "node:test";

import { installPersistenceGlobals } from "./helpers/persistence-harness.mjs";

// Shadowdark Enhancer 1.31.0 draws a baked map itself, with its sprites clipped to their hexes. Where it
// says it owns "hex.baked" Extras leaves the scene's manager slot and its keyed sprites to it, or the
// scene would be drawn twice; with no such Enhancer Extras draws as it always did.
installPersistenceGlobals();
const handlers = {};
globalThis.Hooks = { on: (name, fn) => (handlers[name] ??= []).push(fn), once() {}, off() {} };
globalThis.PIXI.Graphics = class {};
globalThis.PIXI.LegacyGraphics = class {};
globalThis.foundry.canvas ??= {};
globalThis.foundry.canvas.SceneManager ??= class {};

const { registerBakedScenes } = await import("../../scripts/hex/hex-baked-scene.mjs");

const MODULE_ID = "shadowdark-extras";
const FLAGS = { bakedPyramid: { base: "x", meta: {} }, bakedKeyed: { "1-1": [{ src: "k.webp" }] } };
const baked = { id: "baked", getFlag: (scope, key) => (scope === MODULE_ID ? FLAGS[key] : undefined) };
const enhancer = owns => { globalThis.game.shadowdarkEnhancer = { owns }; };
const absent = () => { globalThis.game.shadowdarkEnhancer = undefined; };
const register = () => {
	globalThis.CONFIG = { Canvas: { managedScenes: {} } };
	globalThis.game.scenes = { forEach: fn => fn(baked) };
	globalThis.canvas = { ready: false };
	registerBakedScenes();
	return globalThis.CONFIG.Canvas.managedScenes;
};

const both = feature => feature === "hex.baked" || feature === "hex.fog";

test("the Enhancer draws the baked map and holds its fog: Extras leaves the slot to it", () => {
	enhancer(both);
	assert.equal(register().baked, undefined);
});

test("an Enhancer that does not say it draws baked maps (before 1.31.0) changes nothing", () => {
	enhancer(feature => feature === "hex.fog");
	assert.equal(typeof register().baked, "function", "Extras still manages the scene");
	absent();
	assert.equal(typeof register().baked, "function");
});

test("without the Enhancer's fog Extras keeps drawing: its own fog flags are what hide a location", () => {
	enhancer(feature => feature === "hex.baked");
	assert.equal(typeof register().baked, "function");
});

test("the Enhancer draws the keyed sprites: Extras loads none, and draws them otherwise", async () => {
	const loaded = [];
	globalThis.foundry.canvas.loadTexture = async src => {
		loaded.push(src);
		throw new Error("stop here");
	};
	globalThis.canvas = { ready: false, scene: baked };
	const draw = handlers.canvasReady.at(-1);
	enhancer(both);
	await draw();
	assert.deepEqual(loaded, [], "no sprite is loaded for a scene the Enhancer draws");
	enhancer(feature => feature === "hex.baked");
	await assert.rejects(draw(), /stop here/, "the Enhancer's renderer would ignore Extras' fog here");
	absent();
	await assert.rejects(draw(), /stop here/);
	assert.deepEqual(loaded, ["k.webp", "k.webp"]);
});
