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
	let readyRegistrationCount = 0;
	let registration;
	const registrations = [];

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
						const entry = { namespace, sheetClass, options, default: Boolean(options.makeDefault) };
						if (entry.default) {
							for (const previous of registrations) {
								if (previous.options.types?.some(type => options.types?.includes(type))) {
									previous.default = false;
								}
							}
						}
						registrations.push(entry);
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
			readyRegistrationCount += 1;
			readyCallback = callback;
		},
	};
	globalThis.shadowdark = { sheets: { ItemSheetSD } };

	try {
		class PotionSheetSD {}
		globalThis.foundry.documents.collections.Items.registerSheet("shadowdark-extras", PotionSheetSD, {
			types: ["Potion"],
			makeDefault: true,
		});

		const { applyUnidentifiedMagicPrivacy, initUnidentifiedSheetContext } = await import(
			"../../scripts/inventory/UnidentifiedDisplaySD.mjs"
		);
		initUnidentifiedSheetContext();
		initUnidentifiedSheetContext();
		assert.equal(readyRegistrationCount, 1, "repeated init registers one ready callback");
		assert.equal(typeof readyCallback, "function", "the ready hook must be registered");

		await readyCallback();
		assert.equal(registration.namespace, "shadowdark-extras");
		assert.equal(registration.sheetClass.prototype instanceof ItemSheetSD, true);
		assert.deepEqual(registration.options.types, [
			"Armor",
			"Basic",
			"Scroll",
			"Wand",
			"Weapon",
		]);
		assert.deepEqual(
			[...registration.options.types, "Potion"].sort(),
			["Armor", "Basic", "Potion", "Scroll", "Wand", "Weapon"].sort(),
			"PhysicalItemSD inventory covers every type with identification and magicItem",
		);
		assert.equal(registration.options.types.includes("Gem"), false, "Gem is not a PhysicalItemSD type");
		assert.equal(registration.options.makeDefault, true);
		assert.equal(
			registrations.find(entry => entry.options.types?.includes("Potion") && entry.default)?.sheetClass.name,
			"PotionSheetSD",
			"Potion keeps the SDX AppV2 default sheet",
		);

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
				assert.equal(
					applyUnidentifiedMagicPrivacy(context, item).system,
					context.system,
					"repeated privacy application is idempotent",
				);
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

test("PotionSheetSD masks only its rendered system context", async () => {
	const previous = {
		CONFIG: globalThis.CONFIG,
		TextEditor: globalThis.TextEditor,
		foundry: globalThis.foundry,
		fromUuid: globalThis.fromUuid,
		game: globalThis.game,
		shadowdark: globalThis.shadowdark,
	};

	globalThis.foundry = {
		applications: {
			api: {
				DocumentSheetV2: class {
					async _prepareContext() {
						return { baseSentinel: "appv2-base" };
					}
				},
				HandlebarsApplicationMixin: Base => class extends Base {},
			},
			apps: { FilePicker: { implementation: class {} } },
			ux: { TextEditor: { implementation: { enrichHTML: async text => text } } },
		},
		utils: { duplicate: value => structuredClone(value) },
	};
	globalThis.CONFIG = { SHADOWDARK: {} };
	globalThis.TextEditor = { enrichHTML: async text => text };
	globalThis.fromUuid = async () => null;
	globalThis.game = { user: { isGM: false } };
	globalThis.shadowdark = { compendiums: { sources: async () => [] } };

	try {
		const { default: PotionSheetSD } = await import("../../scripts/item-sheets/PotionSheetSD.mjs");
		const cases = [
			{ name: "unidentified player magic", isGM: false, isIdentified: false, magicItem: true, expected: false },
			{ name: "unidentified GM magic", isGM: true, isIdentified: false, magicItem: true, expected: true },
			{ name: "identified player magic", isGM: false, isIdentified: true, magicItem: true, expected: true },
			{ name: "unidentified player non-magic", isGM: false, isIdentified: false, magicItem: false, expected: false },
		];

		for (const testCase of cases) {
			globalThis.game.user.isGM = testCase.isGM;
			const system = {
				description: "hidden",
				identification: { identified: testCase.isIdentified, name: "Potion of Secrets", description: "" },
				isIdentified: testCase.isIdentified,
				magicItem: testCase.magicItem,
			};
			const item = {
				flags: {},
				id: "potion-1",
				isOwner: false,
				name: "Unidentified Potion",
				system,
				getFlag: () => undefined,
				toObject: () => ({ system: structuredClone(system) }),
			};
			const sheet = Object.create(PotionSheetSD.prototype);
			sheet.document = item;
			sheet.isEditable = true;
			sheet.tabGroups = { primary: "details" };

			const context = await sheet._prepareContext({});
			assert.equal(context.baseSentinel, "appv2-base", `${testCase.name}: AppV2 base survives`);
			assert.equal(context.item, item, `${testCase.name}: item context alias`);
			assert.equal(context.system.magicItem, testCase.expected, `${testCase.name}: magic flag`);
			assert.equal(context.source.system.magicItem, testCase.magicItem, `${testCase.name}: source snapshot remains truthful`);
			assert.equal(item.system.magicItem, testCase.magicItem, `${testCase.name}: Item document remains truthful`);
			if (testCase.name === "unidentified player magic") {
				assert.notEqual(context.system, item.system, "privacy branch detaches only rendered system");
			}
			else {
				assert.equal(context.system, item.system, `${testCase.name}: non-privacy context keeps system alias`);
			}
		}
	}
	finally {
		globalThis.CONFIG = previous.CONFIG;
		globalThis.TextEditor = previous.TextEditor;
		globalThis.foundry = previous.foundry;
		globalThis.fromUuid = previous.fromUuid;
		globalThis.game = previous.game;
		globalThis.shadowdark = previous.shadowdark;
	}
});
