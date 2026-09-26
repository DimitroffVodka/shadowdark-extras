import assert from "node:assert/strict";
import test from "node:test";
import { escapeHTML } from "./helpers/escape-html.mjs";

// Mysterious Casting masks an NPC's card for players. When the damage card is
// hidden from a player, finalizeDamageCard falls back to a "Total: N" summary
// appended to .chat-card, and the mask is a .chat-card, so on a masked message
// that summary would show players the damage. The fallback must skip masked
// messages. Verified live: a masked NPC attack showed no damage card to a real
// player client, while the same attack unmasked did.

globalThis.window = globalThis;
globalThis.foundry = {
	applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: base => base } },
	utils: { randomID: () => "id", Collection: class extends Map {}, escapeHTML, mergeObject: (a, b) => ({ ...a, ...b }) },
};
globalThis.game = {
	settings: { get: () => undefined, register: () => {} },
	i18n: { localize: key => key },
	user: { id: "player", isGM: false },
	users: new Map(),
};

const { finalizeDamageCard } = await import("../../scripts/combat/damage-card-finalization.mjs");

/** jQuery-shaped html stand-in that records everything appended to it. */
function recordingHtml() {
	const appended = [];
	const node = {
		length: 1,
		append: markup => { appended.push(markup); return node; },
		find: () => node,
		hide: () => node,
		on: () => node,
	};
	return { html: { find: () => node }, appended };
}

async function finalizeForPlayer(message) {
	const { html, appended } = recordingHtml();
	await finalizeDamageCard({
		html,
		message: { id: "m1", rolls: [], getFlag: () => undefined, ...message },
		item: null,
		settings: { damageCard: { autoApplyDamage: false, autoApplyConditions: false } },
		hideDamageCardFromPlayer: true,
		isSpellWithDamage: true,
		isSpellWithEffects: false,
		hasWeaponBonuses: false,
		weaponBonusDamage: null,
		isCritical: false,
		baseDamageType: "damage",
		totalDamage: 7,
		damageType: "damage",
		spellDamageConfig: null,
		targets: [],
		actor: null,
		allEffects: [],
	});
	return appended;
}

test("a masked message gets no damage summary for players", async () => {
	const appended = await finalizeForPlayer({ flags: { shadowdark: { isMysterious: true } } });
	assert.deepEqual(appended, []);
});

test("an unmasked message still gets the summary when the card is hidden", async () => {
	const appended = await finalizeForPlayer({ flags: {} });
	assert.equal(appended.length, 1);
	assert.match(appended[0], /Total: 7/);
});
