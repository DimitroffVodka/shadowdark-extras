import assert from "node:assert/strict";
import test from "node:test";

import {
	hexDiscoveryPatch,
	hexMovementPath,
	hexNearRadius,
	hasHexSight,
	mountainCells,
	playerHexRecord,
	readHexVisibility,
	visibleHexes,
} from "../../scripts/hex/hex-visibility.mjs";

const VALID_RULES = {
	darkness: -1,
	stormy: -1,
	excellent: 1,
	slight: 1,
	high: 3,
	elevation: { mountain: "high", bad_lands: "slight" },
};

function makeWorld({ rules = VALID_RULES, weather = { kind: "fair", until: 10 },
	isNight = () => false } = {}) {
	return {
		modules: { get: id => id === "shadowdark-enhancer" ? { active: true } : undefined },
		shadowdarkEnhancer: {
			rules: { visibility: () => rules },
			time: { isNight: (_time, { region }) => isNight(region) },
			overland: { state: () => ({ weather }) },
		},
		time: { worldTime: 9 },
	};
}

function partyNpc() {
	return {
		actor: {
			type: "NPC",
			getFlag: (scope, key) => scope === "shadowdark-extras" && key === "isParty",
		},
	};
}

test("readHexVisibility accepts only a live Enhancer party-NPC boundary", () => {
	const world = makeWorld({ isNight: region => region === "night" });
	const conditions = readHexVisibility(world, partyNpc(), { "0_0": { terrain: "Forest" } });

	assert.deepEqual(conditions.rules, VALID_RULES);
	assert.equal(conditions.weather, "fair");
	assert.equal(conditions.isNight("night"), true);
	assert.equal(conditions.isNight("day"), false);
});

test("readHexVisibility falls back instead of inventing incomplete live inputs", () => {
	const cases = [
		["no scene terrain", world => world, {}, partyNpc()],
		["inactive Enhancer", world => { world.modules.get = () => ({ active: false }); }, { "0_0": { terrain: "Forest" } }, partyNpc()],
		["non-party actor", world => world, { "0_0": { terrain: "Forest" } }, {
			actor: { type: "NPC", getFlag: () => false },
		}],
		["player actor", world => world, { "0_0": { terrain: "Forest" } }, {
			actor: { type: "Character", getFlag: () => true },
		}],
		["missing visibility rule", world => { delete world.shadowdarkEnhancer.rules.visibility; }, { "0_0": { terrain: "Forest" } }, partyNpc()],
		["missing night provider", world => { delete world.shadowdarkEnhancer.time.isNight; }, { "0_0": { terrain: "Forest" } }, partyNpc()],
		["missing weather provider", world => { delete world.shadowdarkEnhancer.overland.state; }, { "0_0": { terrain: "Forest" } }, partyNpc()],
		["non-finite rule", world => {
			world.shadowdarkEnhancer.rules.visibility = () => ({ ...VALID_RULES, high: Infinity });
		}, { "0_0": { terrain: "Forest" } }, partyNpc()],
		["unknown weather", world => {
			world.shadowdarkEnhancer.overland.state = () => ({ weather: { kind: "windy", until: 10 } });
		}, { "0_0": { terrain: "Forest" } }, partyNpc()],
		["expired weather", world => {
			world.shadowdarkEnhancer.overland.state = () => ({ weather: { kind: "fair", until: 9 } });
		}, { "0_0": { terrain: "Forest" } }, partyNpc()],
		["non-finite weather expiry", world => {
			world.shadowdarkEnhancer.overland.state = () => ({ weather: { kind: "fair", until: NaN } });
		}, { "0_0": { terrain: "Forest" } }, partyNpc()],
	];

	for (const [label, change, records, token] of cases) {
		const world = makeWorld();
		change(world);
		assert.equal(readHexVisibility(world, token, records), null, label);
	}
});

test("hexMovementPath uses the v14 movement origin and waypoints, not _source", () => {
	const calls = [];
	const path = [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 2 }];
	const grid = {
		sizeX: 100,
		sizeY: 80,
		getDirectPath(points) {
			calls.push(points);
			return path;
		},
	};
	const token = {
		id: "party-token",
		x: 200,
		y: 0,
		width: 1,
		height: 1,
		_source: { x: 200, y: 0 },
	};
	const options = {
		_movement: {
			[token.id]: {
				origin: { x: 0, y: 0 },
				passed: { waypoints: [{ x: 100, y: 0 }] },
			},
		},
	};

	assert.deepEqual(hexMovementPath(token, options, grid), path);
	assert.deepEqual(calls, [[
		{ x: 50, y: 40 },
		{ x: 150, y: 40 },
		{ x: 250, y: 40 },
	]]);
});

test("hexNearRadius applies only finite Enhancer modifiers and clamps at zero", () => {
	const rows = [
		["day fair forest", "Forest", false, "fair", 1],
		["night fair forest", "Forest", true, "fair", 0],
		["day stormy forest", "Forest", false, "stormy", 0],
		["day excellent forest", "Forest", false, "excellent", 2],
		["day fair slight elevation", "Bad Lands", false, "fair", 2],
		["day fair mountain elevation", "Mountain", false, "fair", 4],
		["night excellent mountain", "Mountain", true, "excellent", 4],
		["unknown terrain has no elevation modifier", "Unknown", false, "fair", 1],
	];

	for (const [label, terrain, night, weather, expected] of rows) {
		assert.equal(hexNearRadius(VALID_RULES, terrain, night, weather), expected, label);
	}
});

function lineGrid() {
	return {
		getAdjacentOffsets({ i, j }) {
			return [{ i, j: j - 1 }, { i, j: j + 1 }];
		},
		getDirectPath(points) {
			const start = points[0];
			const end = points.at(-1);
			const step = Math.sign(end.j - start.j);
			return Array.from({ length: Math.abs(end.j - start.j) + 1 }, (_, n) => ({
				i: start.i,
				j: start.j + n * step,
			}));
		},
	};
}

function dayConditions(weather = "fair") {
	return { rules: VALID_RULES, weather, isNight: () => false };
}

test("mountain line of sight treats endpoints as visible and only mountain intermediates as blockers", () => {
	const grid = lineGrid();
	const records = {
		"0_0": { terrain: "Forest" },
		"0_2": { terrain: "Mountain" },
		"0_4": { terrain: "Mountain" },
	};
	const mountains = mountainCells(records);
	const visibility = visibleHexes(grid, { i: 0, j: 0 }, records, dayConditions(), mountains);

	assert.deepEqual(mountains, [{ i: 0, j: 2 }, { i: 0, j: 4 }]);
	assert.equal(visibility.near.has("0-0"), true);
	assert.equal(visibility.distant.has("0-2"), true, "the first mountain is visible at its endpoint");
	assert.equal(visibility.distant.has("0-4"), false, "a mountain behind a mountain is blocked");
	assert.equal(hasHexSight(grid, { i: 0, j: 0 }, { i: 0, j: 4 }, new Set(["0-9"])), true,
		"non-mountain terrain does not block sight");
});

test("daylight reveals distant mountains through non-mountain terrain, but night and storms do not", () => {
	const grid = lineGrid();
	const records = {
		"0_0": { terrain: "Forest" },
		"0_2": { terrain: "Forest" },
		"0_4": { terrain: "Mountain" },
	};
	const mountains = mountainCells(records);

	const day = visibleHexes(grid, { i: 0, j: 0 }, records, dayConditions(), mountains);
	assert.equal(day.distant.has("0-4"), true);

	for (const conditions of [
		{ rules: VALID_RULES, weather: "fair", isNight: () => true },
		{ rules: VALID_RULES, weather: "stormy", isNight: () => false },
	]) {
		const visibility = visibleHexes(grid, { i: 0, j: 0 }, records, conditions, mountains);
		assert.equal(visibility.distant.size, 0);
	}
});

test("an origin mountain does not block its own first visible mountain target", () => {
	const records = {
		"0_0": { terrain: "Mountain" },
		"0_6": { terrain: "Mountain" },
	};
	const visibility = visibleHexes(lineGrid(), { i: 0, j: 0 }, records, dayConditions(), mountainCells(records));

	assert.equal(visibility.distant.has("0-6"), true);
});

test("hexDiscoveryPatch upgrades terrain discovery without demoting known or explored hexes", () => {
	// Near promotion is still expected for known/explored cells so their full
	// tooltip can become player-visible; the no-demotion rule applies to the
	// distant terrain-only state.
	const patch = hexDiscoveryPatch(
		new Set(["0-0", "0-1", "0-2", "0-3"]),
		new Set(["0-4", "0-5"]),
		{ "0-0": true },
		{ "0-1": "terrain", "0-2": "near" },
		{
			"0_3": { exploration: "explored" },
			"0_4": { exploration: "mapped" },
		},
	);

	assert.deepEqual(patch, {
		"0-0": "near",
		"0-1": "near",
		"0-3": "near",
		"0-5": "terrain",
	});
	assert.notEqual(patch["0-4"], "terrain", "mapped hexes are never demoted to terrain-only");
});

test("playerHexRecord keeps GM data intact, hides terrain-only details, and preserves near visibility rules", () => {
	const record = {
		name: "Hidden Keep",
		zone: "red",
		terrain: "Mountain",
		travel: "hard",
		image: "keep.webp",
		showToPlayers: false,
		features: [{ name: "Shrine", discovered: false }],
		notes: [{ text: "GM note", visible: false }],
	};

	assert.equal(playerHexRecord(record, "terrain", true), record);
	assert.deepEqual(playerHexRecord(record, "terrain", false), {
		terrain: "Mountain",
		showToPlayers: true,
		terrainOnly: true,
	});

	const near = playerHexRecord(record, "near", false);
	assert.deepEqual(near, { ...record, showToPlayers: true });
	assert.equal(playerHexRecord(record, undefined, false), record);
});
