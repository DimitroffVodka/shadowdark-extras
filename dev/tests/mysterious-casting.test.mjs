import assert from "node:assert/strict";
import test from "node:test";

// Mysterious Casting: the GM keeps the full card (roll, success/failure,
// effects); only player clients see the mask.
const hooks = {};
globalThis.Hooks = { on: (name, fn) => { hooks[name] = fn; } };
globalThis.foundry = { utils: { escapeHTML: s => String(s) } };
globalThis.game = {
	user: { isGM: true },
	settings: { register() {}, get: () => "The creature casts a mysterious spell..." },
};

const { initMysteriousCasting } = await import("../../scripts/npc/MysteriousCasting.mjs");
initMysteriousCasting();

// Turn mysterious mode on for npc-1 through the sheet toggle.
let clickToggle;
const $header = {
	length: 1,
	find: () => ({ length: 0, on: (_e, fn) => { clickToggle = fn; } }),
	append() {},
};
hooks.renderNpcSheetSD(
	{ actor: { id: "npc-1", type: "NPC" }, render() {} },
	{ find: () => $header }
);
await clickToggle({ preventDefault() {}, stopPropagation() {} });

const REAL_CARD = "<div class=\"dice-roll\">Fireball — DC 12, Success, 4d6</div>";

function castMessage() {
	const msg = {
		content: REAL_CARD,
		flavor: "Fireball",
		speaker: { actor: "npc-1" },
		flags: {},
		rolls: [],
		updateSource(update) {
			assert.deepEqual(Object.keys(update), ["flags.shadowdark.isMysterious"]);
			this.flags.shadowdark = { isMysterious: update["flags.shadowdark.isMysterious"] };
		},
	};
	game.user.isGM = true;
	hooks.preCreateChatMessage(msg);
	return msg;
}

function render(msg, isGM) {
	game.user.isGM = isGM;
	const body = { innerHTML: msg.content };
	const flavor = { text: msg.flavor, replaceChildren(t) { this.text = t; } };
	hooks.renderChatMessageHTML(msg, {
		querySelector: sel => ({ ".message-content": body, ".flavor-text": flavor })[sel] ?? null,
	});
	return { body: body.innerHTML, flavor: flavor.text };
}

test("the stored card is flagged but left whole", () => {
	const msg = castMessage();
	assert.equal(msg.flags.shadowdark.isMysterious, true);
	assert.equal(msg.content, REAL_CARD);
	assert.equal(msg.flavor, "Fireball");
});

test("the GM sees the full card", () => {
	const out = render(castMessage(), true);
	assert.equal(out.body, REAL_CARD);
	assert.equal(out.flavor, "Fireball");
});

test("players see only the mask", () => {
	const out = render(castMessage(), false);
	assert.match(out.body, /The creature casts a mysterious spell/);
	assert.doesNotMatch(out.body, /Fireball|DC 12|Success/);
	assert.equal(out.flavor, "Unknown Spell");
});
