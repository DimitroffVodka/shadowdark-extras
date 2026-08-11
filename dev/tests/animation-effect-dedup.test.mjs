import assert from "node:assert/strict";
import test from "node:test";

import {
	getDuplicateAnimationEffects,
	removeDuplicateAnimationEffects,
} from "../../scripts/animation/AnimationEffectDedupSD.mjs";

function effect({
	id,
	name = "shadowdark-extras-weapon-itemA",
	source = "Scene.sceneA.Token.tokenA",
	zIndex = 5,
	creationTimestamp,
	file = "weapon.webp",
} = {}) {
	return {
		id,
		data: { _id: id, name, source, zIndex, creationTimestamp, file },
	};
}

test("duplicate animation layers keep the newest effect and discard stale local copies", () => {
	const stale = effect({ id: "stale", creationTimestamp: 100 });
	const current = effect({ id: "current", creationTimestamp: 200 });

	assert.deepEqual(getDuplicateAnimationEffects([stale, current]), [stale]);
});

test("torch prop and flame layers sharing a name/source remain distinct by z-index", () => {
	const prop = effect({
		id: "prop",
		name: "shadowdark-extras-torch-itemA",
		zIndex: 2,
		creationTimestamp: 100,
		file: "torch.webp",
	});
	const flame = effect({
		id: "flame",
		name: "shadowdark-extras-torch-itemA",
		zIndex: 3,
		creationTimestamp: 100,
		file: "flame.webm",
	});

	assert.deepEqual(getDuplicateAnimationEffects([prop, flame]), []);
});

test("unrelated Sequencer effects are ignored", () => {
	const first = effect({ id: "first", name: "other-module-effect", creationTimestamp: 100 });
	const second = effect({ id: "second", name: "other-module-effect", creationTimestamp: 200 });

	assert.deepEqual(getDuplicateAnimationEffects([first, second]), []);
});

test("duplicate cleanup is local-only and does not remove persistent database flags", async () => {
	const stale = effect({ id: "stale", creationTimestamp: 100 });
	const current = effect({ id: "current", creationTimestamp: 200 });
	const removed = [];
	const effectManager = {
		effects: [stale, current],
		_removeEffect: async entry => removed.push(entry),
		endEffects: async () => assert.fail("public endEffects would broadcast and mutate persistence"),
	};

	const removedCount = await removeDuplicateAnimationEffects(effectManager);

	assert.equal(removedCount, 1);
	assert.deepEqual(removed, [stale]);
});
