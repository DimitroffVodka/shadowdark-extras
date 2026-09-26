import assert from "node:assert/strict";
import test from "node:test";

// party-quests.mjs defines its tracker window at load, so ApplicationV2 has to
// exist before the import. Its render only counts.
const renders = [];
globalThis.foundry = { applications: { api: { ApplicationV2: class {
	render(options) {
		renders.push(options);
		this.rendered = true;
	}
} } }, utils: {} };
const hooks = [];
globalThis.Hooks = {
	on: (event, fn) => hooks.push({ event, fn, once: false }),
	once: (event, fn) => hooks.push({ event, fn, once: true }),
};
const pq = await import("../../scripts/party/party-quests.mjs");

const MODULE_ID = "shadowdark-extras";
const actor = (id, { type = "Player", flags = {} } = {}) => ({
	id, uuid: `Actor.${id}`, name: id, type,
	getFlag: (scope, key) => (scope === MODULE_ID ? flags[key] : undefined),
});
const party = (id, members) => actor(id, { type: "NPC", flags: { isParty: true, members } });

function world(actors, { isGM = false, sde } = {}) {
	globalThis.game = {
		user: { isGM },
		actors: { contents: actors, get: id => actors.find(a => a.id === id) },
		i18n: { localize: key => key },
		shadowdarkEnhancer: sde,
	};
}

const quest = (id, status, created, extra = {}) => ({ id, uuid: `JournalEntry.${id}`, name: id, status, created, objectives: [], ...extra });

// Enhancer's list({party}) / list({character}) over a fixed set.
function fakeQuests(all) {
	const calls = [];
	return {
		calls,
		list(filter) {
			calls.push(filter);
			if (filter.party) return all.filter(q => q.party === filter.party);
			if (filter.character) return all.filter(q => q.characters?.includes(filter.character));
			return all;
		},
	};
}

test("a party's members resolve to actor UUIDs; compendium UUIDs pass through; anything else is no party", () => {
	const ash = actor("ash");
	const band = party("band", ["ash", "Compendium.world.pcs.Actor.bo", "gone"]);
	world([ash, band, actor("npc", { type: "NPC" })]);
	assert.deepEqual(pq.partyMemberUuids(band), ["Actor.ash", "Compendium.world.pcs.Actor.bo"], "a stale world id is dropped");
	assert.deepEqual(pq.partyMemberUuids("band"), pq.partyMemberUuids(band), "by world id");
	assert.deepEqual(pq.partyMemberUuids("Actor.band"), pq.partyMemberUuids(band), "by UUID");
	assert.deepEqual(pq.partyMemberUuids("npc"), []);
	assert.deepEqual(pq.partyMemberUuids(null), []);
	assert.deepEqual(pq.listParties(), [band]);
});

test("the party's quests: assigned plus members' personal ones, once each, newest first, Hidden for the GM only", () => {
	const all = [
		quest("assigned", "active", 3, { party: "Actor.band" }),
		quest("both", "available", 5, { party: "Actor.band", characters: ["Actor.ash"] }),
		quest("personal", "available", 4, { characters: ["Actor.ash"] }),
		quest("secret", "hidden", 6, { party: "Actor.band" }),
		quest("elsewhere", "active", 9, { party: "Actor.other" }),
	];
	const quests = fakeQuests(all);
	const gm = pq.collectPartyQuests(quests, "Actor.band", ["Actor.ash", "Actor.bo"], true);
	assert.deepEqual(gm.map(q => q.id), ["secret", "both", "personal", "assigned"]);
	assert.deepEqual(quests.calls, [{ party: "Actor.band" }, { character: "Actor.ash" }, { character: "Actor.bo" }]);
	const player = pq.collectPartyQuests(fakeQuests(all), "Actor.band", ["Actor.ash"], false);
	assert.ok(!player.some(q => q.status === "hidden"), "a player never sees a Hidden quest, whatever Enhancer returns");

	assert.deepEqual(pq.groupByStatus([...gm, quest("lost", "failed", 1), quest("done", "completed", 2)]).map(g => [g.status, g.quests.map(q => q.id)]), [
		["available", ["both", "personal"]],
		["active", ["assigned"]],
		["completed", ["done"]],
		["failed", ["lost"]],
		["hidden", ["secret"]],
	], "the log's order, empty groups left out");
});

test("rumors come newest first and skip entries without text", () => {
	const rumors = [
		{ text: "old", heardAt: { real: "2026-01-01T00:00:00Z" } },
		{ text: "new", heardAt: { real: Date.parse("2026-03-01T00:00:00Z") } },
		{ text: "" },
		{ text: "undated" },
	];
	assert.deepEqual(pq.newestRumors(rumors).map(r => r.text), ["new", "old", "undated"]);
	assert.deepEqual(pq.newestRumors(undefined), []);
});

test("the tracker follows the party on the scene, else the character's party, else the only party", () => {
	world([actor("ash")]);
	const band = party("band", ["ash"]);
	const crew = party("crew", []);
	assert.equal(pq.pickActiveParty([band, crew], { sceneActorIds: ["x", "crew"], characterUuid: "Actor.ash" }), crew);
	assert.equal(pq.pickActiveParty([band, crew], { sceneActorIds: [], characterUuid: "Actor.ash" }), band);
	assert.equal(pq.pickActiveParty([band, crew], { sceneActorIds: [] }), null, "two parties and no clue");
	assert.equal(pq.pickActiveParty([crew]), crew);
	assert.equal(pq.pickActiveParty([]), null);
});

test("the Quests tab is absent without Enhancer, and a failing read hides it instead of breaking the sheet", async () => {
	const band = party("band", ["ash"]);
	world([actor("ash"), band]);
	assert.equal(await pq.questTabData(band), null, "no Enhancer, no tab");

	world([actor("ash"), band], { sde: { quests: fakeQuests([quest("q", "active", 1, { party: "Actor.band" })]) } });
	const tab = await pq.questTabData(band);
	assert.deepEqual(tab.groups.map(g => [g.status, g.label]), [["active", "SHADOWDARK_EXTRAS.party.quests.status.active"]]);
	assert.equal(tab.rumors, null, "no rumors section until Enhancer has rumors.heard");

	world([actor("ash"), band], { sde: {
		quests: fakeQuests([]),
		rumors: { heard: async () => [{ text: "A bell under the water", region: "Low Town", heardAt: { real: 0 } }] },
	} });
	assert.deepEqual((await pq.questTabData(band)).rumors.list.map(r => [r.text, r.region]), [["A bell under the water", "Low Town"]]);

	world([band], { sde: { quests: { list: () => { throw new Error("boom"); } } } });
	const warn = console.warn;
	console.warn = () => {};
	try {
		assert.equal(await pq.questTabData(band), null);
	}
	finally {
		console.warn = warn;
	}
});

test("the tracker setting exists only when Enhancer's quest log does, per user and off by default", () => {
	hooks.length = 0;
	pq.registerPartyQuests();
	const setup = hooks.find(h => h.event === "setup");
	assert.ok(setup?.once);
	assert.ok(hooks.some(h => h.event === "shadowdark-enhancer.questsChanged"), "re-renders on Enhancer's hook");

	for (const sde of [undefined, { quests: fakeQuests([]) }]) {
		const registered = [];
		world([], { sde });
		game.settings = { register: (scope, key, config) => registered.push({ scope, key, config }) };
		setup.fn();
		if (!sde) {
			assert.deepEqual(registered, [], "no option without Enhancer");
			continue;
		}
		assert.equal(registered.length, 1);
		const [{ scope, key, config }] = registered;
		assert.deepEqual([scope, key, config.scope, config.default, config.config], [MODULE_ID, "questTracker", "user", false, true]);
	}
});

test("the open tracker refreshes when a party's roster or this user's character changes, and not otherwise", () => {
	hooks.length = 0;
	pq.registerPartyQuests();
	world([], { sde: { quests: fakeQuests([]) } });
	let config;
	game.settings = { register: (_scope, _key, value) => { config = value; } };
	hooks.find(h => h.event === "setup").fn();
	config.onChange(true);
	const fire = (event, ...args) => hooks.filter(h => h.event === event).forEach(h => h.fn(...args));

	const opened = renders.length;
	fire("updateActor", {}, { system: { attributes: { hp: { value: 3 } } } });
	fire("updateActor", {}, { flags: { [MODULE_ID]: { travelSpeed: "fast" } } });
	fire("updateUser", { isSelf: false }, { character: "someone-else" });
	fire("updateUser", { isSelf: true }, { color: "#ffffff" });
	assert.equal(renders.length, opened, "unrelated actor and user updates leave the tracker alone");

	fire("updateActor", {}, { flags: { [MODULE_ID]: { members: ["ash"] } } });
	fire("updateActor", {}, { flags: { [MODULE_ID]: { isParty: true } } });
	fire("updateUser", { isSelf: true }, { character: "ash" });
	assert.equal(renders.length, opened + 3);
});
