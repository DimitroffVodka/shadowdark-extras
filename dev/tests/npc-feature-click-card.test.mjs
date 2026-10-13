import assert from "node:assert/strict";
import test, { mock } from "node:test";
import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

// Reported as "on NPC sheets, I'm not able to send their features into the chat
// by clicking on its name."
//
// Shadowdark 4.0.6 defines no Item#rollItem. Extras installs its own wrapper so
// an NPC item's macros and activities can run, and routed the sheet's
// display-feature click through it. With no system method underneath, the
// wrapper ran the macros and posted nothing — and because it made
// `typeof item.rollItem === "function"` true for every item, the sheet's
// showItemCard fallback could never be reached. A feature with no macro did
// nothing on click, with no error.

installCanvasGlobals();
installAppGlobals({ dom: makeSelectorDom() });
const { registerNPCFeatureItemMacros } = await import("../../scripts/item-macros/npc-feature-macros.mjs");

class FakeItem {
	constructor(type, id) {
		this.type = type;
		this.id = id;
		this.uuid = `Actor.npc1.Item.${id}`;
		this.actor = { id: "npc1" };
		this.flags = {};
	}

	getFlag() {
		return undefined;
	}
}

/**
 * Install the patches on fresh stand-ins for the system's classes and fire the
 * two 100 ms `ready` timers. `systemRollItem` is the system's own Item#rollItem:
 * absent on 4.0.6, which is the case that broke.
 */
function setup({ systemRollItem = false } = {}) {
	const log = { cards: [], systemRollItem: [], systemDisplayFeature: [] };

	if (systemRollItem) {
		FakeItem.prototype.rollItem = async function() {
			log.systemRollItem.push(this.uuid);
		};
	}
	else {
		delete FakeItem.prototype.rollItem;
	}
	// A patch flag left on the shared prototype would make the next setup a no-op.
	delete FakeItem.prototype.__sdxNpcFeatureMacroPatched;

	class NpcSheetSD {
		async _displayFeature(event) {
			log.systemDisplayFeature.push(event.currentTarget.dataset.itemId);
		}
	}

	globalThis.Hooks = { once: (_name, fn) => fn() };
	globalThis.CONFIG = { Item: { documentClass: FakeItem }, Actor: { sheetClasses: {} } };
	globalThis.game = { user: { targets: new Set() } };
	globalThis.canvas = { tokens: { controlled: [] } };
	globalThis.shadowdark = {
		chat: {
			showItemCard: async uuid => {
				log.cards.push(uuid);
			},
		},
		applications: { NpcSheetSD },
	};

	mock.timers.enable({ apis: ["setTimeout"] });
	registerNPCFeatureItemMacros();
	mock.timers.tick(100);
	mock.timers.reset();

	/** A click on `item`'s name, the way the sheet's listener delivers it. */
	const click = item => {
		const sheet = Object.assign(new NpcSheetSD(), {
			actor: { items: new Map([[item.id, item]]) },
		});
		return NpcSheetSD.prototype._displayFeature.call(sheet, {
			preventDefault() {},
			currentTarget: { dataset: { itemId: item.id } },
		});
	};

	return { log, click };
}

for (const type of ["NPC Feature", "NPC Special Attack", "NPC Spell"]) {
	test(`clicking an ${type}'s name on the sheet posts its card once (system has no rollItem)`, async () => {
		const { log, click } = setup();
		const item = new FakeItem(type, "item1");

		await click(item);

		assert.deepEqual(log.cards, [item.uuid]);
		// The system's own handler would post a second card if both ran.
		assert.deepEqual(log.systemDisplayFeature, []);
	});
}

test("when the system provides rollItem it owns the card and Extras adds none", async () => {
	const { log, click } = setup({ systemRollItem: true });
	const item = new FakeItem("NPC Feature", "item1");

	await click(item);

	assert.deepEqual(log.systemRollItem, [item.uuid]);
	assert.deepEqual(log.cards, []);
});

test("an item that is not an NPC ability gets no card from the wrapper", async () => {
	const { log } = setup();

	await new FakeItem("Weapon", "sword1").rollItem();

	assert.deepEqual(log.cards, []);
});

test("a card that fails to post is logged and does not reject the click", async () => {
	const { click } = setup();
	globalThis.shadowdark.chat.showItemCard = async () => {
		throw new Error("boom");
	};
	const logged = mock.method(console, "error", () => {});

	try {
		await assert.doesNotReject(click(new FakeItem("NPC Feature", "item1")));
		assert.ok(
			logged.mock.calls.some(call => String(call.arguments[0]).includes("showItemCard failed")),
			"the failure must be loud"
		);
	}
	finally {
		logged.mock.restore();
	}
});
