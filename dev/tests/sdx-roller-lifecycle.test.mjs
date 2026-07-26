import assert from "node:assert/strict";
import test from "node:test";

class TestApplication {
	constructor(options = {}) {
		this.options = options;
		this.closeCount = 0;
		this.renderCount = 0;
	}

	render() {
		this.renderCount++;
		return this;
	}

	async close() {
		this.closeCount++;
		return this;
	}
}

globalThis.foundry = {
	applications: {
		api: {
			ApplicationV2: TestApplication,
			HandlebarsApplicationMixin: Base => class extends Base {}
		}
	},
	utils: {
		randomID: () => "test-roll-id"
	}
};
globalThis.fromUuidSync = () => null;

const {
	SDXRollerApp,
	SDXRollerOverlay
} = await import("../../scripts/SDXRollerApp.mjs");

function makeRollData(rollId) {
	return {
		rollId,
		actors: [],
		contestants: [],
		ability: "none",
		dc: 12
	};
}

test("replacing an SDX overlay resolves the previous roll as canceled", async () => {
	const first = SDXRollerApp._launchOverlay(makeRollData("first"));
	const second = SDXRollerApp._launchOverlay(makeRollData("second"));

	assert.deepEqual(await first.promise, {
		canceled: true,
		results: []
	});
	assert.equal(first.closeCount, 1);
	assert.equal(SDXRollerApp._activeOverlay, second);

	await second.cancelRoll();
});

test("closing an awaited overlay directly resolves it as canceled", async () => {
	const overlay = SDXRollerApp._launchOverlay(makeRollData("direct-close"));

	await overlay.close();

	assert.deepEqual(await overlay.promise, {
		canceled: true,
		results: []
	});
	assert.equal(SDXRollerApp._activeOverlay, null);
});

test("a stale overlay closing cannot clear the current overlay", async () => {
	const stale = new SDXRollerOverlay(makeRollData("stale"));
	const current = new SDXRollerOverlay(makeRollData("current"));
	SDXRollerApp._activeOverlay = current;

	await stale.close();

	assert.equal(SDXRollerApp._activeOverlay, current);
	await current.cancelRoll();
});
