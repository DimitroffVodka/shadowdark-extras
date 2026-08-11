import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

installAppGlobals({ dom: makeSelectorDom() });

const warnings = [];
const errors = [];
globalThis.ui = {
	notifications: {
		info() {},
		warn: message => warnings.push(message),
		error: message => errors.push(message),
	},
};
globalThis.game = {
	i18n: {
		localize: key => key,
		format: (key, data) => `${key}:${JSON.stringify(data)}`,
	},
	settings: { get: () => "Party" },
	user: { id: "gm", isGM: true },
	users: [],
};
globalThis.canvas = { scene: { id: "scene" }, tokens: { controlled: [] } };

const {
	buildPartyActorData,
	createPartyFromSelectedTokens,
	getSelectedPartyMembers,
} = await import("../../scripts/party/party-from-selection.mjs");
const { wrapActorCreate } = await import("../../scripts/party/party-creation.mjs");

function makeMember(id, ownerIds = []) {
	return {
		id,
		name: id,
		type: "Player",
		testUserPermission: user => ownerIds.includes(user.id),
	};
}

const token = actor => ({ actor });

test("selected party members are unique Player actors", () => {
	const alice = makeMember("alice");
	const npc = { id: "goblin", type: "NPC" };

	assert.deepEqual(
		getSelectedPartyMembers([token(alice), token(alice), token(npc), { actor: null }]),
		[alice],
	);
});

test("party actor data stores selected members and grants every owning player OWNER", () => {
	const alice = makeMember("alice", ["u-alice", "u-shared"]);
	const bob = makeMember("bob", ["u-bob", "u-shared"]);
	const users = [
		{ id: "gm", isGM: true },
		{ id: "u-alice", isGM: false },
		{ id: "u-bob", isGM: false },
		{ id: "u-shared", isGM: false },
		{ id: "u-spectator", isGM: false },
	];

	assert.deepEqual(buildPartyActorData([alice, bob], users, "The Lanterns"), {
		name: "The Lanterns",
		type: "Party",
		ownership: {
			default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
			"u-alice": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
			"u-bob": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
			"u-shared": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
		},
		flags: {
			"shadowdark-extras": {
				members: ["alice", "bob"],
			},
		},
	});
});

test("the Actor.create wrapper converts Party data into the final linked NPC document", async () => {
	const previousCreate = CONFIG.Actor.documentClass.create;
	const previousSetProperty = foundry.utils.setProperty;
	foundry.utils.setProperty = (object, path, value) => {
		const parts = path.split(".");
		const key = parts.pop();
		let target = object;
		for (const part of parts) target = target[part] ??= {};
		target[key] = value;
	};
	CONFIG.Actor.documentClass.create = async data => data;

	try {
		wrapActorCreate();
		const result = await CONFIG.Actor.documentClass.create(
			buildPartyActorData([makeMember("alice")], [], "The Lanterns")
		);

		assert.equal(result.type, "NPC");
		assert.equal(result.flags["shadowdark-extras"].isParty, true);
		assert.equal(result.prototypeToken.actorLink, true);
		assert.deepEqual(result.flags["shadowdark-extras"].members, ["alice"]);
	}
	finally {
		CONFIG.Actor.documentClass.create = previousCreate;
		foundry.utils.setProperty = previousSetProperty;
	}
});

test("one click creates the Party actor before entering token placement", async () => {
	const alice = makeMember("alice", ["u-alice"]);
	const bob = makeMember("bob", ["u-bob"]);
	const users = [
		{ id: "u-alice", isGM: false },
		{ id: "u-bob", isGM: false },
	];
	const calls = [];
	const createdActor = { id: "party-1", name: "The Lanterns" };

	const result = await createPartyFromSelectedTokens({
		tokens: [token(alice), token(bob)],
		users,
		partyName: "The Lanterns",
		createActor: async data => {
			calls.push({ action: "create", data });
			return createdActor;
		},
		placeToken: async actor => {
			calls.push({ action: "place", actor });
			return true;
		},
	});

	assert.equal(result, createdActor);
	assert.deepEqual(calls.map(call => call.action), ["create", "place"]);
	assert.equal(calls[0].data.flags["shadowdark-extras"].members.length, 2);
	assert.equal(calls[1].actor, createdActor);
});

test("no selected Player tokens warns without creating an actor", async () => {
	warnings.length = 0;
	let created = false;

	const result = await createPartyFromSelectedTokens({
		tokens: [],
		users: [],
		createActor: async () => { created = true; },
		placeToken: async () => true,
	});

	assert.equal(result, null);
	assert.equal(created, false);
	assert.deepEqual(warnings, ["SHADOWDARK_EXTRAS.party.create_from_selection_warn"]);
});

test("non-GM and no-scene creation attempts stop before Actor.create", async () => {
	const previousUser = globalThis.game.user;
	const previousScene = globalThis.canvas.scene;
	let createCount = 0;
	const createActor = async () => { createCount++; };
	warnings.length = 0;

	try {
		globalThis.game.user = { id: "player", isGM: false };
		assert.equal(await createPartyFromSelectedTokens({ createActor }), null);

		globalThis.game.user = { id: "gm", isGM: true };
		globalThis.canvas.scene = null;
		assert.equal(await createPartyFromSelectedTokens({ createActor }), null);

		assert.equal(createCount, 0);
		assert.deepEqual(warnings, [
			"SHADOWDARK_EXTRAS.party.create_from_selection_gm_only",
			"SHADOWDARK_EXTRAS.party.warn.no_scene",
		]);
	}
	finally {
		globalThis.game.user = previousUser;
		globalThis.canvas.scene = previousScene;
	}
});

test("creation and placement failures are surfaced without losing a created Party", async () => {
	const alice = makeMember("alice");
	const createdActor = { id: "party-1", name: "Party" };
	errors.length = 0;

	const failedCreate = await createPartyFromSelectedTokens({
		tokens: [token(alice)],
		users: [],
		createActor: async () => { throw new Error("create failed"); },
	});
	const failedPlace = await createPartyFromSelectedTokens({
		tokens: [token(alice)],
		users: [],
		createActor: async () => createdActor,
		placeToken: async () => { throw new Error("place failed"); },
	});

	assert.equal(failedCreate, null);
	assert.equal(failedPlace, createdActor);
	assert.deepEqual(errors, [
		'SHADOWDARK_EXTRAS.party.create_from_selection_failed:{"message":"create failed"}',
		'SHADOWDARK_EXTRAS.party.create_from_selection_place_failed:{"message":"place failed"}',
	]);
});
