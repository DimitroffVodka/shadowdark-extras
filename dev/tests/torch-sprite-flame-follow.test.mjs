// Torch Sprite dialog: the flame rides on the prop. Both are stored as
// token-relative offsets, so moving or rescaling the prop must carry the flame.

import assert from "node:assert/strict";
import test from "node:test";

const { flameAnchor, carryFlame } = await import("../../scripts/animation/TorchSpriteConfig.mjs");

// Default torch preset (TorchAnimationSD getAnimationConfig).
const torch = {
	scale: 1.2,
	torchOffsetX: 0.35,
	torchOffsetY: 0.1,
	flameOffsetX: 0.5,
	flameOffsetY: -0.05,
	flameScale: 1,
};

function near(actual, expected) {
	assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("moving the prop moves the flame by the same amount", () => {
	const prop = { ...torch, torchOffsetX: -0.6, torchOffsetY: 0.3 };
	const moved = carryFlame(prop, flameAnchor(torch));
	near(moved.flameOffsetX, torch.flameOffsetX - 0.95);
	near(moved.flameOffsetY, torch.flameOffsetY + 0.2);
	near(moved.flameScale, torch.flameScale);
});

test("rescaling the prop keeps the flame on the same spot of the art and scales it", () => {
	const big = carryFlame({ ...torch, scale: 2.4 }, flameAnchor(torch));
	near(big.flameOffsetX - torch.torchOffsetX, 2 * (torch.flameOffsetX - torch.torchOffsetX));
	near(big.flameOffsetY - torch.torchOffsetY, 2 * (torch.flameOffsetY - torch.torchOffsetY));
	near(big.flameScale, 2 * torch.flameScale);
});
