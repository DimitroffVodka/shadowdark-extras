// Torch Sprite: the per-item `torchSprite` flag and the dialog's unsaved
// preview override both land on top of the name/template preset in
// getAnimationConfig, in that order.

import assert from "node:assert/strict";
import test from "node:test";

globalThis.game = {
	modules: { get: () => ({ active: true }) },
	settings: { get: (_mid, key) => (key === "animationFxAmbient" ? {} : true) },
	user: { id: "testUser" },
	users: { activeGM: { id: "testUser" } },
	scenes: { get: () => null },
};
globalThis.canvas = { tokens: { placeables: [], get: () => null }, scene: { id: "sceneA" }, grid: { size: 100 } };
globalThis.foundry = {
	applications: { apps: {} },
	abstract: { Document: class {} },
	canvas: { placeables: { PlaceableObject: class {} } },
	utils: { hasProperty: () => false, mergeObject: (a, b) => Object.assign(a ?? {}, b ?? {}), deepClone: o => JSON.parse(JSON.stringify(o ?? {})) },
};
globalThis.Hooks = { on: () => {}, once: () => {}, callAll: () => {} };
globalThis.ui = { notifications: { warn: () => {}, error: () => {} } };

const { getAnimationConfig } = await import("../../scripts/animation/TorchAnimationSD.mjs");

const torch = flag => ({
	name: "Torch",
	system: { light: { template: "torch" } },
	getFlag: (_mid, key) => (key === "torchSprite" ? flag : undefined),
});

test("no flag keeps the torch preset", () => {
	const config = getAnimationConfig(torch(undefined));
	assert.equal(config.torchFile, "modules/shadowdark-extras/assets/torch.webp");
	assert.equal(config.scale, 1.2);
});

test("flag replaces preset fields and leaves the rest", () => {
	const config = getAnimationConfig(torch({ torchFile: "my/torch.webp", flameOffsetY: -0.3 }));
	assert.equal(config.torchFile, "my/torch.webp");
	assert.equal(config.flameOffsetY, -0.3);
	assert.equal(config.flameFile, "jb2a.flames.01.orange");
	assert.equal(config.scale, 1.2);
});

test("preview override wins over the saved flag", () => {
	const config = getAnimationConfig(torch({ scale: 2 }), { scale: 0.5 });
	assert.equal(config.scale, 0.5);
});
