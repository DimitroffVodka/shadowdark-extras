// Torch Sprite dialog: the flame rides on the prop. Both are stored as
// token-relative offsets, so moving or rescaling the prop must carry the flame.

import assert from "node:assert/strict";
import test from "node:test";

const { flameAnchor, carryFlame, fitProp } = await import("../../scripts/animation/TorchSpriteConfig.mjs");

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

// Flame sliders: offsets -1..1, scale 0.1..3 (range-picker clamps to them).
function inBounds(flame) {
	for (const k of ["flameOffsetX", "flameOffsetY"]) {
		assert.ok(flame[k] >= -1 - 1e-9 && flame[k] <= 1 + 1e-9, `${k} ${flame[k]} out of range`);
	}
	assert.ok(flame.flameScale >= 0.1 - 1e-9 && flame.flameScale <= 3 + 1e-9, `flameScale ${flame.flameScale}`);
}

test("a prop edit stops where the flame hits a slider end, keeping the anchor", () => {
	const anchor = flameAnchor(torch);
	// Default torch: prop X 1 would carry the flame to 1.15.
	const c = { ...torch, torchOffsetX: 1 };
	near(fitProp(c, anchor, "torchOffsetX"), 0.85);
	const flame = carryFlame({ ...c, torchOffsetX: fitProp(c, anchor, "torchOffsetX") }, anchor);
	inBounds(flame);
	near(flame.flameOffsetX, 1);
	near(flameAnchor({ ...torch, torchOffsetX: 0.85, ...flame }).x, anchor.x);

	// The flame sits 0.15 above the prop, so prop Y stops at -0.85 going up.
	const up = { ...torch, torchOffsetY: -1 };
	const y = fitProp(up, anchor, "torchOffsetY");
	near(y, -0.85);
	inBounds(carryFlame({ ...up, torchOffsetY: y }, anchor));
});

test("scale stops where the flame would outgrow its slider, snapped inward to the step", () => {
	// Flame twice the prop's size: prop scale above 1.5 would need flameScale > 3.
	const big = { ...torch, flameScale: 2.4 };
	const anchor = flameAnchor(big);
	const s = fitProp({ ...big, scale: 3 }, anchor, "scale");
	near(s, 1.5);
	inBounds(carryFlame({ ...big, scale: s }, anchor));

	// A limit between steps rounds toward the allowed side, never past it.
	// Flame 0.07 right of a prop at X 0.9: the limit is scale 1.714..., which the
	// 0.05 step would round up to 1.7 + 0.05 if it rounded to nearest.
	const off = { ...torch, torchOffsetX: 0.9, flameOffsetX: 0.97 };
	const offAnchor = flameAnchor(off);
	const s2 = fitProp({ ...off, scale: 3 }, offAnchor, "scale");
	near(s2, 1.7);
	inBounds(carryFlame({ ...off, scale: s2 }, offAnchor));
});

test("an edit that keeps the flame in range passes through unchanged", () => {
	const anchor = flameAnchor(torch);
	for (const [field, value] of [["torchOffsetX", -0.6], ["torchOffsetY", 0.3], ["scale", 2]]) {
		assert.equal(fitProp({ ...torch, [field]: value }, anchor, field), value);
	}
});
