import assert from "node:assert/strict";
import test from "node:test";

// Shadowdark 4.1.0 deleted map-light-sources.json and keeps each light's
// bright/dim/color/animation on the item. The party token must read those
// fields; fetching the deleted file used to leave it dark.

let fetches = 0;
globalThis.foundry = {
	applications: {
		api: { HandlebarsApplicationMixin: Base => class extends Base {}, ApplicationV2: class {} },
	},
	utils: {
		fetchJsonWithTimeout: async () => {
			fetches++;
			throw new Error("404");
		},
	},
};
globalThis.game = {
	settings: { get: () => [{ key: "candle", bright: 1, dim: 4, animationType: "flame" }] },
};
console.warn = () => {};

const { resolveItemLight } = await import("../../scripts/party/party-token-light.mjs");

const lightItem = light => ({ system: { light: { isSource: true, active: true, ...light } } });

test("an SD 4.1.0 item's own light settings become the token light", async () => {
	fetches = 0;
	const light = await resolveItemLight(lightItem({
		template: "", bright: 15, dim: 60, color: "#d1c846", animation: "torch",
	}));
	assert.equal(light.bright, 15);
	assert.equal(light.dim, 60);
	assert.equal(light.color, "#d1c846");
	assert.deepEqual(light.animation, { intensity: 1, reverse: false, speed: 1, type: "torch" });
	assert.equal(fetches, 0);
});

test("no animation on the item means no token animation", async () => {
	const light = await resolveItemLight(lightItem({ template: "", bright: 30, dim: 0, animation: "" }));
	assert.equal(light.animation.type, null);
});

test("an SDX custom template still wins over the item's fields", async () => {
	const light = await resolveItemLight(lightItem({ template: "candle", bright: 5, dim: 30 }));
	assert.equal(light.bright, 1);
	assert.equal(light.dim, 4);
	assert.equal(light.animation.type, "flame");
});

test("an SD 4.0.x item falls back to the mapping file, and null when it is missing", async () => {
	fetches = 0;
	assert.equal(await resolveItemLight(lightItem({ template: "lantern" })), null);
	assert.equal(fetches, 1);
});
