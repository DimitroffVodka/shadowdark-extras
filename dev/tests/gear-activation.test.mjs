import assert from "node:assert/strict";
import test from "node:test";

import { getGearActivation } from "../../scripts/items/gear-activation.mjs";

const MODULE_ID = "shadowdark-extras";

function makeGear(gearActivation) {
	return {
		type: "Basic",
		getFlag(scope, key) {
			if (scope !== MODULE_ID || key !== "gearActivation") return undefined;
			return gearActivation;
		},
	};
}

test("unconfigured and disabled gear is not usable", () => {
	assert.equal(getGearActivation(makeGear(undefined)), null);
	assert.equal(getGearActivation(makeGear({ enabled: false, maxUses: 3 })), null);
	assert.equal(getGearActivation(undefined), null);
});

test("maxUses 0 means unlimited, not depleted", () => {
	// The bug this guards: treating a blank Max Uses as 0 remaining would make
	// every unlimited item permanently unusable the moment it is enabled.
	const activation = getGearActivation(makeGear({ enabled: true, maxUses: 0 }));
	assert.equal(activation.max, 0);
	assert.equal(activation.remaining, Infinity);
});

test("a freshly configured item starts full rather than empty", () => {
	// `uses` is unset until the first use or the first manual edit.
	const activation = getGearActivation(makeGear({ enabled: true, maxUses: 3 }));
	assert.deepEqual(activation, { max: 3, remaining: 3 });
});

test("remaining is read back and clamped at zero", () => {
	assert.equal(getGearActivation(makeGear({ enabled: true, maxUses: 3, uses: 1 })).remaining, 1);
	assert.equal(getGearActivation(makeGear({ enabled: true, maxUses: 3, uses: 0 })).remaining, 0);
	assert.equal(getGearActivation(makeGear({ enabled: true, maxUses: 3, uses: -2 })).remaining, 0);
});

test("string values from the sheet's number inputs are coerced", () => {
	const activation = getGearActivation(makeGear({ enabled: true, maxUses: "3", uses: "2" }));
	assert.deepEqual(activation, { max: 3, remaining: 2 });
});
