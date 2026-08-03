import assert from "node:assert/strict";
import test from "node:test";

test("unidentified magic privacy patches the Shadowdark ItemSheetSD chain", async () => {
	const previous = {
		foundry: globalThis.foundry,
		game: globalThis.game,
		Hooks: globalThis.Hooks,
		shadowdark: globalThis.shadowdark,
	};

	let readyCallback;
	let registration;

	class GenericItemSheet {
		constructor(item) {
			this.item = item;
		}

		async getData() {
			return { baseSentinel: "generic-base" };
		}
	}

	class ItemSheetSD extends GenericItemSheet {
		async getData(options) {
			const context = await super.getData(options);
			return {
				...context,
				item: this.item,
				system: this.item.system,
				systemSentinel: "shadowdark-subclass",
			};
		}
	}

	globalThis.foundry = {
		documents: {
			collections: {
				Items: {
					registerSheet(namespace, sheetClass, options) {
						registration = { namespace, sheetClass, options };
					},
				},
			},
		},
		utils: {
			duplicate(value) {
				return structuredClone(value);
			},
		},
	};
	globalThis.game = { user: { isGM: false } };
	globalThis.Hooks = {
		once(hook, callback) {
			assert.equal(hook, "ready");
			readyCallback = callback;
		},
	};
	globalThis.shadowdark = { sheets: { ItemSheetSD } };

	try {
		const { initUnidentifiedSheetContext } = await import(
			"../../scripts/inventory/UnidentifiedDisplaySD.mjs"
		);
		initUnidentifiedSheetContext();
		assert.equal(typeof readyCallback, "function", "the ready hook must be registered");

		await readyCallback();
		assert.equal(registration.namespace, "shadowdark-extras");
		assert.equal(registration.sheetClass.prototype instanceof ItemSheetSD, true);
		assert.deepEqual(registration.options.types, [
			"Armor",
			"Basic",
			"Potion",
			"Scroll",
			"Wand",
			"Weapon",
		]);
		assert.equal(registration.options.makeDefault, true);

		const cases = [
			{ name: "unidentified player magic", isGM: false, isIdentified: false, magicItem: true, expected: false },
			{ name: "unidentified GM magic", isGM: true, isIdentified: false, magicItem: true, expected: true },
			{ name: "identified player magic", isGM: false, isIdentified: true, magicItem: true, expected: true },
			{ name: "unidentified player non-magic", isGM: false, isIdentified: false, magicItem: false, expected: false },
		];

		for (const testCase of cases) {
			globalThis.game.user.isGM = testCase.isGM;
			const item = {
				type: "Weapon",
				system: {
					identification: { identified: testCase.isIdentified },
					isIdentified: testCase.isIdentified,
					magicItem: testCase.magicItem,
				},
			};
			const context = await new registration.sheetClass(item).getData();

			assert.equal(context.baseSentinel, "generic-base", `${testCase.name}: generic base data survives`);
			assert.equal(context.systemSentinel, "shadowdark-subclass", `${testCase.name}: system subclass data survives`);
			assert.equal(context.system.magicItem, testCase.expected, `${testCase.name}: magic flag`);
			assert.equal(context.item, item, `${testCase.name}: item context alias`);
			assert.equal(context.item.system, item.system, `${testCase.name}: item system alias`);
			assert.equal(item.system.magicItem, testCase.magicItem, `${testCase.name}: document is unchanged`);

			if (testCase.name === "unidentified player magic") {
				assert.notEqual(context.system, item.system, "privacy branch must detach the view system context");
			}
			else {
				assert.equal(context.system, item.system, `${testCase.name}: non-privacy context keeps system alias`);
			}
		}
	}
	finally {
		globalThis.foundry = previous.foundry;
		globalThis.game = previous.game;
		globalThis.Hooks = previous.Hooks;
		globalThis.shadowdark = previous.shadowdark;
	}
});
