// Party tracker data shaping: what players may see about other tokens.
//
// Two rules pin down here:
//   1. Players never see monster/NPC AC or exact HP numbers — even when the
//      GM reveals NPCs to them. They get the bar (percent) and everything
//      derived from it (wounded overlay, death skull), never the digits.
//   2. A hidden token never appears in a player's tracker, regardless of the
//      reveal setting.
//
// The GM's own view keeps full numbers for everything.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

installCanvasGlobals();
installAppGlobals({ dom: makeSelectorDom() });
let showNPCs = true;
globalThis.game.settings = {
	get: (moduleId, key) =>
		moduleId === "shadowdark-extras" && key === "tray.showNPCs" ? showNPCs : undefined,
	set: async () => {},
	register() {},
};
globalThis.game.modules = { get: () => ({ active: false }) };

const {
	getPartyTokens,
	getHealthOverlayHeight,
	toggleHideNpcsFromPlayers,
	registerPartyStatsSocket,
	buildPartyStatsPayload,
} = await import("../../scripts/tray/TraySD.mjs");

/** A fake actor with Shadowdark-shaped system data (limited actors have {}). */
function makeActor({ type = "NPC", owner = false, hp = 10, max = 10, ac = 13, system = null } = {}) {
	const sys = system ?? {
		attributes: { hp: { value: hp, max }, ac: { value: ac } },
	};
	if (type === "Player" && !system) sys.luck = { remaining: 0, available: true };
	return {
		type,
		isOwner: owner,
		hasPlayerOwner: owner,
		name: type === "Player" ? "PC" : "Monster",
		img: "icons/test.svg",
		system: sys,
		getFlag: () => null,
	};
}

function makeToken(id, actor, { hidden = false } = {}) {
	return {
		id,
		name: actor.name,
		actor,
		document: { hidden, getFlag: () => null },
		center: { x: 0, y: 0 },
	};
}

function setCanvasTokens(tokens, sceneId = "scene-current") {
	globalThis.canvas.scene = { id: sceneId };
	globalThis.canvas.tokens = {
		placeables: tokens,
		controlled: [],
		get: id => tokens.find(t => t.id === id) ?? null,
	};
}

// Receive a snapshot the way a player client does: through the socket
// handler, with a fake socketlib socket.
const socketHandlers = {};
const broadcasts = [];
registerPartyStatsSocket({
	register: (name, fn) => { socketHandlers[name] = fn; },
	executeForEveryone: (name, payload) => broadcasts.push({ name, payload }),
});

function receiveSnapshot(stats) {
	return socketHandlers.sdxTrayPartyStats(stats);
}

// --- player view ------------------------------------------------------------

test("a player sees NPC cards with the bar but never numbers or AC", async () => {
	const prevGM = globalThis.game.user.isGM;
	globalThis.game.user.isGM = true;
	toggleHideNpcsFromPlayers(); // reveal NPCs to players (cache -> false)
	globalThis.game.user.isGM = false;

	const pc1 = makeToken("pc1", makeActor({ type: "Player", owner: true, hp: 6, max: 6, ac: 12 }));
	const pc2 = makeToken("pc2", makeActor({ type: "Player", hp: 0, max: 0, ac: 0, system: {} }));
	const npcVisible = makeToken("npcA", makeActor({ hp: 15, max: 15, ac: 14 }));
	const npcHidden = makeToken("npcHidden", makeActor({ hp: 30, max: 30, ac: 18 }), { hidden: true });
	const pcHidden = makeToken("pcHidden", makeActor({ type: "Player", owner: true, hp: 9, max: 9, ac: 9 }), { hidden: true });
	setCanvasTokens([pc1, pc2, npcVisible, npcHidden, pcHidden]);

	// GM snapshot as broadcast today: party members full, NPCs percent-only.
	await receiveSnapshot({
		pc2: { hp: { value: 8, max: 14, percent: 57 }, ac: 16, luck: 0 },
		npcA: { hp: { percent: 20 }, ac: null, luck: null },
	});

	try {
		const { partyTokens, npcTokens } = getPartyTokens();

		assert.deepEqual(partyTokens.map(t => t.id).sort(), ["pc1", "pc2"], "hidden PC excluded");
		assert.deepEqual(npcTokens.map(t => t.id), ["npcA"], "hidden NPC excluded");

		const npc = npcTokens[0];
		assert.equal(npc.showHpNumbers, false, "no exact HP digits for NPCs");
		assert.equal(npc.showAc, false, "no AC for NPCs");
		assert.equal(npc.hp.percent, 20, "the bar still knows the percentage");
		assert.equal(npc.hasLuck, false, "no luck chip on NPCs");

		const pc2Entry = partyTokens.find(t => t.id === "pc2");
		assert.equal(pc2Entry.hp.value, 8, "party member HP from snapshot");
		assert.equal(pc2Entry.hp.max, 14);
		assert.equal(pc2Entry.ac, 16);
		assert.equal(pc2Entry.luck, 0);
		assert.equal(pc2Entry.showHpNumbers, true, "party members keep numbers");
		assert.equal(pc2Entry.showAc, true);

		const pc1Entry = partyTokens.find(t => t.id === "pc1");
		assert.equal(pc1Entry.hp.value, 6, "owned actor reads live data");
		assert.equal(pc1Entry.showHpNumbers, true);
	}
	finally {
		globalThis.game.user.isGM = prevGM;
	}
});

test("percent-only HP still drives the wounded overlay and bar status", () => {
	assert.equal(getHealthOverlayHeight({ percent: 20 }), "80%");
	assert.equal(getHealthOverlayHeight({ percent: 100 }), "0%");
	assert.equal(getHealthOverlayHeight({ percent: 0 }), "100%");
	assert.equal(getHealthOverlayHeight({ value: 3, max: 15, percent: 20 }), "80%");
	assert.equal(getHealthOverlayHeight(null), "0%");
	// hp.max of exactly 0 used to produce "NaN%"; it must fall back to "0%".
	assert.equal(getHealthOverlayHeight({ value: 0, max: 0, percent: Number.NaN }), "0%");
});

test("the GM's broadcast payload carries percent-only NPC stats and no hidden tokens", () => {
	const prevGM = globalThis.game.user.isGM;
	globalThis.game.user.isGM = true;

	const pc = makeToken("pcWire", makeActor({ type: "Player", owner: true, hp: 6, max: 6, ac: 12 }));
	const npc = makeToken("npcWire", makeActor({ hp: 15, max: 15, ac: 14 }));
	const hiddenNpc = makeToken("npcHiddenWire", makeActor({ hp: 30, max: 30, ac: 18 }), { hidden: true });
	setCanvasTokens([pc, npc, hiddenNpc]);

	try {
		const { partyTokens, npcTokens } = getPartyTokens();
		const payload = buildPartyStatsPayload(partyTokens, npcTokens);

		assert.deepEqual(payload[npc.id], { hp: { percent: 100 }, ac: null, luck: null },
			"NPCs never leave the GM with exact HP or AC");
		assert.deepEqual(payload[pc.id], { hp: { value: 6, max: 6, percent: 100 }, ac: 12, luck: 1 },
			"party members keep full stats");
		assert.equal(payload[hiddenNpc.id], undefined, "hidden tokens never leave the GM");
	}
	finally {
		globalThis.game.user.isGM = prevGM;
	}
});

test("authoritative NPC data ignores the GM's client-only tray filter", () => {
	const prevGM = globalThis.game.user.isGM;
	const previousShowNPCs = showNPCs;
	globalThis.game.user.isGM = true;
	showNPCs = false;
	const npc = makeToken("npcFilteredLocally", makeActor({ hp: 4, max: 10, ac: 15 }));
	setCanvasTokens([npc]);

	try {
		assert.equal(getPartyTokens().npcTokens.length, 0, "GM-local tray remains filtered");
		const authoritative = getPartyTokens({ includeAllNPCs: true });
		assert.equal(authoritative.npcTokens.length, 1, "wire roster bypasses the local filter");
		assert.deepEqual(
			buildPartyStatsPayload(authoritative.partyTokens, authoritative.npcTokens)[npc.id],
			{ hp: { percent: 40 }, ac: null, luck: null }
		);
	}
	finally {
		showNPCs = previousShowNPCs;
		globalThis.game.user.isGM = prevGM;
	}
});

test("a snapshot for another scene cannot replace the active scene's stats", async () => {
	const prevGM = globalThis.game.user.isGM;
	globalThis.game.user.isGM = false;
	const limitedPc = makeToken("duplicate-id", makeActor({ type: "Player", system: {} }));
	setCanvasTokens([limitedPc], "scene-b");

	try {
		await receiveSnapshot({
			sceneId: "scene-a",
			stats: { "duplicate-id": { hp: { value: 1, max: 10, percent: 10 }, ac: 9, luck: 0 } },
		});
		assert.equal(getPartyTokens().partyTokens[0].hp.value, 0,
			"scene A's duplicate token id is ignored on scene B");

		await receiveSnapshot({
			sceneId: "scene-b",
			stats: { "duplicate-id": { hp: { value: 8, max: 10, percent: 80 }, ac: 14, luck: 1 } },
		});
		assert.equal(getPartyTokens().partyTokens[0].hp.value, 8);
		assert.equal(getPartyTokens().partyTokens[0].ac, 14);
	}
	finally {
		globalThis.game.user.isGM = prevGM;
	}
});

test("the GM answers a player's requested scene rather than the GM canvas scene", async () => {
	const prevGM = globalThis.game.user.isGM;
	const previousScenes = globalThis.game.scenes;
	globalThis.game.user.isGM = true;
	setCanvasTokens([], "gm-scene");
	const remoteActor = makeActor({ type: "Player", owner: true, hp: 7, max: 9, ac: 13 });
	globalThis.game.scenes = new Map([["player-scene", {
		id: "player-scene",
		tokens: { contents: [{ id: "remote-pc", name: "Remote PC", actor: remoteActor, hidden: false }] },
	}]]);
	broadcasts.length = 0;

	try {
		await socketHandlers.sdxTrayRequestPartyStats("player-scene");
		assert.equal(broadcasts.at(-1).name, "sdxTrayPartyStats");
		assert.equal(broadcasts.at(-1).payload.sceneId, "player-scene");
		assert.deepEqual(broadcasts.at(-1).payload.stats["remote-pc"].hp,
			{ value: 7, max: 9, percent: (7 / 9) * 100 });
	}
	finally {
		globalThis.game.scenes = previousScenes;
		globalThis.game.user.isGM = prevGM;
	}
});

// --- GM view ----------------------------------------------------------------

test("the GM sees full numbers and AC for NPCs", () => {
	const prevGM = globalThis.game.user.isGM;
	globalThis.game.user.isGM = true;

	const npc = makeToken("npcB", makeActor({ hp: 3, max: 15, ac: 14 }));
	setCanvasTokens([npc]);

	try {
		const { npcTokens } = getPartyTokens();
		assert.equal(npcTokens.length, 1);
		const entry = npcTokens[0];
		assert.equal(entry.showHpNumbers, true);
		assert.equal(entry.showAc, true);
		assert.equal(entry.hp.value, 3);
		assert.equal(entry.hp.max, 15);
		assert.equal(entry.ac, 14);
	}
	finally {
		globalThis.game.user.isGM = prevGM;
	}
});
