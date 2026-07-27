import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
	DEFAULT_TRAVEL_ACTIVITIES,
	normalizeTravelActivities
} from "../../scripts/CampingRulesData.mjs";
import {
	calculateCookBonusHp,
	getCampingAbility,
	planStackConsumption,
	qualifiesForRest,
	TORCH_NAME_PATTERN
} from "../../scripts/CampingRestData.mjs";
import {
	buildTravelTaskRollData,
	getSdxActorAbility,
	isSdxRollAuthority
} from "../../scripts/SDXRollerData.mjs";
import {
	isPartyTravelMutationAuthorized,
	planPartyTravelMutation,
	planWeatherPredictionMutation
} from "../../scripts/PartyTravelMutationsSD.mjs";

const moduleRoot = new URL("../../", import.meta.url);

test("Party travel payload preserves each actor's selected ability and banner", () => {
	const task = {
		key: "treat",
		name: "Treat",
		abilities: ["STR", "DEX"],
		description: "Success: Apply the camping task benefit.",
		bannerImage: "modules/shadowdark-extras/assets/travel/hunt.png"
	};
	const actors = [
		{ id: "world-actor", uuid: "Actor.world-actor" },
		{ id: "compendium-actor", uuid: "Compendium.test.actors.Actor.compendium-actor" }
	];
	const selections = {
		"world-actor": 1,
		"Compendium.test.actors.Actor.compendium-actor": 0
	};

	const rollData = buildTravelTaskRollData(task, actors, selections, 15);

	assert.deepEqual(rollData.actors, [
		"Actor.world-actor",
		"Compendium.test.actors.Actor.compendium-actor"
	]);
	assert.deepEqual(rollData.actorAbilities, {
		"Actor.world-actor": "dex",
		"Compendium.test.actors.Actor.compendium-actor": "str"
	});
	assert.equal(rollData.dc, 15);
	assert.equal(rollData.customLabel, "Treat");
	assert.equal(rollData.activityDescription, task.description);
	assert.equal(rollData.bannerImage, task.bannerImage);
});

test("default camping tasks match the supplied Shadowdark rules", () => {
	const expectedTasks = [
		["Bed Down", ["WIS", "CON"], true],
		["Cook", ["INT", "WIS"], true],
		["Craft", ["DEX"], true],
		["Entertain", ["CHA"], true],
		["Firewood", ["STR", "CON"], false],
		["Hunt", ["STR", "DEX"], false],
		["Keep Watch", ["WIS"], true],
		["Predict", ["INT", "WIS"], false]
	];

	assert.deepEqual(
		DEFAULT_TRAVEL_ACTIVITIES.map(task => [
			task.name,
			task.abilities,
			task.campfire
		]),
		expectedTasks
	);
	assert.equal(
		DEFAULT_TRAVEL_ACTIVITIES.every(task => task.description.startsWith("Success:")),
		true
	);
});

test("legacy Batten Down settings are corrected without overwriting custom activities", () => {
	const normalized = normalizeTravelActivities([
		{
			key: "battenDown",
			name: "Batten Down",
			abilities: ["INT", "CON"],
			campfire: true
		},
		{
			key: "cook",
			name: "Chef Duty",
			abilities: ["CHA"],
			campfire: false,
			description: ""
		}
	]);

	assert.equal(normalized[0].name, "Bed Down");
	assert.deepEqual(normalized[0].abilities, ["WIS", "CON"]);
	assert.match(normalized[0].description, /^Success:/);
	assert.equal(normalized[1].name, "Chef Duty");
	assert.deepEqual(normalized[1].abilities, ["CHA"]);
	assert.equal(normalized[1].description, "");
});

test("legacy Cook copy migrates to the max-plus-two HP rule", () => {
	const [normalized] = normalizeTravelActivities([{
		key: "cook",
		name: "Cook",
		abilities: ["INT", "WIS"],
		campfire: true,
		description: "Success: Each character who consumes a ration gains +2 temporary HP for 1 day."
	}]);

	assert.equal(normalized.description, DEFAULT_TRAVEL_ACTIVITIES[1].description);
});

test("camping supply plans consume ordered pooled stacks without overdraw", () => {
	const plan = planStackConsumption([
		{ ownerId: "camper", itemId: "a", quantity: 1 },
		{ ownerId: "party", itemId: "b", quantity: 4 }
	], 3);

	assert.equal(plan.complete, true);
	assert.equal(plan.consumed, 3);
	assert.equal(plan.remaining, 0);
	assert.deepEqual(plan.entries.map(entry => [entry.itemId, entry.amount, entry.after]), [
		["a", 1, 0],
		["b", 2, 2]
	]);

	const shortPlan = planStackConsumption([
		{ ownerId: "camper", itemId: "a", quantity: 1 }
	], 3);
	assert.equal(shortPlan.complete, false);
	assert.equal(shortPlan.consumed, 1);
	assert.equal(shortPlan.remaining, 2);
});

test("camping torch detection accepts singular and plural item names", () => {
	assert.equal(TORCH_NAME_PATTERN.test("Torch"), true);
	assert.equal(TORCH_NAME_PATTERN.test("Torches"), true);
	assert.equal(TORCH_NAME_PATTERN.test("Crossbow Bolts"), false);
});

test("rest recovery requires a ration and handles interruptions with Bed Down", () => {
	assert.equal(qualifiesForRest({ hasRation: true }), true);
	assert.equal(qualifiesForRest({ hasRation: false }), false);
	assert.equal(qualifiesForRest({ hasRation: true, interrupted: true }), false);
	assert.equal(qualifiesForRest({
		hasRation: true,
		interrupted: true,
		bedDownSucceeded: true
	}), true);
	assert.equal(qualifiesForRest({
		hasRation: true,
		interrupted: true,
		interruptionCheckSucceeded: true
	}), true);
});

test("Cook raises ordinary HP up to two points above maximum without stacking", () => {
	assert.equal(calculateCookBonusHp(7, 7, 2), 9);
	assert.equal(calculateCookBonusHp(5, 7, 2), 7);
	assert.equal(calculateCookBonusHp(8, 7, 2), 9);
	assert.equal(calculateCookBonusHp(9, 7, 2), 9);
	assert.equal(calculateCookBonusHp(11, 7, 2), 11);
});

test("camping ability selection safely falls back to the first task ability", () => {
	const task = { abilities: ["INT", "WIS"] };
	assert.equal(getCampingAbility(task, 1), "WIS");
	assert.equal(getCampingAbility(task, 99), "INT");
	assert.equal(getCampingAbility({}, 0), "none");
});

test("SDX Roller resolves per-actor abilities with shared-roll compatibility", () => {
	const rollData = {
		ability: "wis",
		actorAbilities: {
			"Actor.one": "INT",
			"Actor.invalid": "not-an-ability"
		}
	};

	assert.equal(getSdxActorAbility(rollData, "Actor.one"), "int");
	assert.equal(getSdxActorAbility(rollData, "Actor.two"), "wis");
	assert.equal(getSdxActorAbility(rollData, "Actor.invalid"), "wis");
	assert.equal(getSdxActorAbility({ ability: "CHA" }, "Actor.one"), "cha");
});

test("only the originating browser client has authority to finish an SDX roll", () => {
	const rollData = {
		rollId: "roll-one",
		authorityClientId: "originating-tab"
	};
	const connectedClients = ["originating-tab", "second-gm-tab", "bridge-tab"];

	assert.deepEqual(
		connectedClients.map(clientId => isSdxRollAuthority(rollData, clientId)),
		[true, false, false]
	);
	assert.equal(isSdxRollAuthority({}, "originating-tab"), false);
	assert.equal(isSdxRollAuthority(rollData, ""), false);
});

test("player task changes replace prior assignments and stale ability choices", () => {
	const state = {
		assignments: {
			cook: ["hero", "friend"],
			hunt: []
		},
		selections: {
			cook: { hero: 1, friend: 0 },
			hunt: { hero: 1 }
		}
	};
	const tasks = [
		{ key: "cook", abilities: ["INT", "WIS"] },
		{ key: "hunt", abilities: ["STR", "DEX"] }
	];

	const moved = planPartyTravelMutation(state, {
		operation: "selectTask",
		memberId: "hero",
		taskKey: "hunt"
	}, tasks);

	assert.deepEqual(moved.assignments, {
		cook: ["friend"],
		hunt: ["hero"]
	});
	assert.deepEqual(moved.selections, {
		cook: { friend: 0 },
		hunt: { hero: 0 }
	});

	const ability = planPartyTravelMutation(moved, {
		operation: "selectAbility",
		memberId: "hero",
		taskKey: "hunt",
		abilityIndex: 1
	}, tasks);
	assert.equal(ability.selections.hunt.hero, 1);
});

test("Party travel authorization is tied to the requested member", () => {
	const base = {
		memberKeys: ["hero", "friend"],
		ownedMemberKeys: ["hero"]
	};
	assert.equal(isPartyTravelMutationAuthorized({
		...base,
		operation: "selectTask",
		memberId: "hero"
	}), true);
	assert.equal(isPartyTravelMutationAuthorized({
		...base,
		operation: "selectTask",
		memberId: "friend"
	}), false);
	assert.equal(isPartyTravelMutationAuthorized({
		...base,
		operation: "selectTask",
		memberId: "outsider"
	}), false);
	assert.equal(isPartyTravelMutationAuthorized({
		...base,
		operation: "weatherPrediction"
	}), true);
	assert.equal(isPartyTravelMutationAuthorized({
		...base,
		ownedMemberKeys: [],
		operation: "weatherPrediction"
	}), false);
	assert.equal(isPartyTravelMutationAuthorized({
		...base,
		isGM: true,
		operation: "selectAbility",
		memberId: "friend"
	}), true);
});

test("player travel mutations reject unknown tasks and invalid abilities", () => {
	const state = {
		assignments: { cook: ["hero"] },
		selections: { cook: { hero: 0 } }
	};
	const tasks = [{ key: "cook", abilities: ["INT", "WIS"] }];

	assert.throws(() => planPartyTravelMutation(state, {
		operation: "selectTask",
		memberId: "hero",
		taskKey: "secretTask"
	}, tasks), /Unknown travel task/);
	assert.throws(() => planPartyTravelMutation(state, {
		operation: "selectAbility",
		memberId: "hero",
		taskKey: "cook",
		abilityIndex: 9
	}, tasks), /Invalid travel ability/);
});

test("weather prediction consumption is bounded and clearable", () => {
	const consumed = planWeatherPredictionMutation({
		uses: 2,
		actorIds: ["hero"]
	}, "consume");
	assert.deepEqual(consumed, {
		uses: 1,
		value: { uses: 1, actorIds: ["hero"] }
	});
	assert.deepEqual(
		planWeatherPredictionMutation(consumed.value, "consume"),
		{ uses: 0, value: null }
	);
	assert.deepEqual(
		planWeatherPredictionMutation({ uses: 2 }, "clear"),
		{ uses: 0, value: null }
	);
	assert.throws(
		() => planWeatherPredictionMutation(null, "consume"),
		/No weather prediction rerolls remain/
	);
});

test("every default camping task ships its configured banner", () => {
	for (const task of DEFAULT_TRAVEL_ACTIVITIES) {
		const relativePath = task.bannerImage.replace(
			"modules/shadowdark-extras/",
			""
		);
		assert.equal(
			existsSync(new URL(relativePath, moduleRoot)),
			true,
			`${task.name} banner is missing: ${relativePath}`
		);
	}
});

test("Party sheet routes player travel writes through its GM socket", () => {
	const source = readFileSync(
		new URL("scripts/PartySheetSD.mjs", moduleRoot),
		"utf8"
	);
	const mainSource = readFileSync(
		new URL("scripts/shadowdark-extras.mjs", moduleRoot),
		"utf8"
	);

	assert.match(source, /buildTravelTaskRollData\(/);
	assert.match(source, /SDXRollerApp\.dispatchGroupRoll\(rollData\)/);
	assert.match(source, /executeAsGM\(\s*"sdxMutatePartyTravel"/);
	assert.match(mainSource, /register\(\s*"sdxMutatePartyTravel"/);
});

test("camping procedure applies supplies, recovery, and tangible task outcomes", () => {
	const source = readFileSync(
		new URL("scripts/CampingRestSD.mjs", moduleRoot),
		"utf8"
	);
	const template = readFileSync(
		new URL("templates/camping-rest.hbs", moduleRoot),
		"utf8"
	);

	assert.match(source, /applyConsumption\(plan\.torchPlan\.entries/);
	assert.match(source, /applyConsumption\(finalRationPlan\.entries/);
	assert.match(source, /"system\.attributes\.hp\.value": hpMax/);
	assert.match(source, /refreshRestResources\(actor\)/);
	assert.match(source, /actorRollModes/);
	assert.match(source, /case "craft"/);
	assert.match(source, /case "entertain"/);
	assert.match(source, /case "hunt"/);
	assert.match(source, /case "predict"/);
	assert.match(template, /name="campfireMode"/);
	assert.match(template, /sdx-rest-task-select/);
});

test("SDX overlay applies configured banner art and labels actor-specific abilities", () => {
	const source = readFileSync(
		new URL("scripts/SDXRollerApp.mjs", moduleRoot),
		"utf8"
	);
	const overlay = readFileSync(
		new URL("templates/sdx-roller-overlay.hbs", moduleRoot),
		"utf8"
	);

	assert.match(source, /getSdxActorAbility\(this\.rollData, uuid\)/);
	assert.match(source, /allDone && this\._isAuthorityClient\(\)/);
	assert.match(source, /if \(!this\._isAuthorityClient\(\)\) return/);
	assert.match(source, /this\.rollData\.bannerImage/);
	assert.match(source, /activityDescription: this\.rollData\.activityDescription/);
	assert.match(source, /stripe\.style\.backgroundImage/);
	assert.match(overlay, /class="sdx-tile-ability"/);
});

test("Party weather configuration registers a world setting and RollTable selector", () => {
	const source = readFileSync(
		new URL("scripts/PartyWeatherSettingsSD.mjs", moduleRoot),
		"utf8"
	);
	const template = readFileSync(
		new URL("templates/party-weather-settings.hbs", moduleRoot),
		"utf8"
	);

	assert.match(source, /game\.settings\.register\(MODULE_ID, SETTING_KEY/);
	assert.match(source, /game\.settings\.registerMenu\(MODULE_ID, "partyWeatherTableMenu"/);
	assert.match(source, /pack\.metadata\.type === "RollTable"/);
	assert.match(template, /select[^>]*name="tableUuid"/);
	assert.match(template, /party_weather\.default_option/);
});
