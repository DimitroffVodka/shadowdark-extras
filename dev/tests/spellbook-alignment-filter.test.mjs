import assert from "node:assert/strict";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";
const modulePath = "../../scripts/character-sheet/spellbook-filter.mjs";
const PLAYER_PATCH = Symbol.for("shadowdark-extras.alignment-spellbook.player");
const SPELLBOOK_PATCH = Symbol.for("shadowdark-extras.alignment-spellbook.get-data");
let importSequence = 0;

function snapshotGlobals() {
	return {
		CONFIG: globalThis.CONFIG,
		Dialog: globalThis.Dialog,
		foundry: globalThis.foundry,
		fromUuid: globalThis.fromUuid,
		game: globalThis.game,
		Hooks: globalThis.Hooks,
		shadowdark: globalThis.shadowdark,
		ui: globalThis.ui,
	};
}

function restoreGlobals(previous) {
	for (const [name, value] of Object.entries(previous)) globalThis[name] = value;
}

async function loadInitializer(cacheBust = false) {
	const suffix = cacheBust ? `?cacheBust=${++importSequence}` : "";
	return (await import(`${modulePath}${suffix}`)).initAlignmentSpellFiltering;
}

function installFakeFoundry({ classes = [] } = {}) {
	const resolverInputs = [];
	const notifications = [];
	const renderedApps = [];
	const hooks = [];
	const templateCalls = [];
	const dialogCalls = [];
	const originalGetDataCalls = [];
	const uuidDocuments = new Map();
	let throwFromUuid = false;
	let currentClasses = classes;

	class ActorDocument {
		openSpellBook() {
			return "document-sentinel";
		}
	}

	class PlayerSD {
		constructor(parent) {
			this.parent = parent;
			this.alignment = parent.system.alignment;
			this.spellcasting = { classes: parent.spellClasses };
		}

		async openSpellBook() {
			return "player-sentinel";
		}
	}

	class SpellBookSD {
		constructor(classUuid, actorId) {
			this.classUuid = classUuid;
			this.actorId = actorId;
			this.alignment = undefined;
			this.entries = [];
		}

		render(force) {
			assert.equal(force, true);
			assert.notEqual(this.alignment, undefined, "alignment is set before render");
			renderedApps.push(this);
			return `rendered:${this.classUuid}`;
		}

		async getData(...args) {
			originalGetDataCalls.push({ receiver: this, args });
			return {
				baseSentinel: "preserved",
				nested: { preserved: true },
				spellList: { 1: this.entries },
			};
		}
	}

	class Dialog {
		constructor(options) {
			dialogCalls.push({ dialog: this, options });
			this.options = options;
			this.closed = false;
		}

		render(force) {
			assert.equal(force, true);
			this.options.render({
				find(selector) {
					assert.equal(selector, "[data-action='open-class-spellbook']");
					return {
						click(handler) {
							this.handler = handler;
							dialogCalls.at(-1).clickHandler = handler;
						},
					};
				},
			});
			return this;
		}

		close() {
			this.closed = true;
		}
	}

	globalThis.CONFIG = { Actor: { documentClass: ActorDocument, dataModels: { Player: PlayerSD } } };
	globalThis.Dialog = Dialog;
	globalThis.foundry = {
		applications: {
			handlers: {},
			handlebars: {
				renderTemplate: async (path, context) => {
					templateCalls.push({ path, context });
					return "dialog-html";
				},
			},
		},
	};
	globalThis.game = {
		i18n: {
			localize: key => `localized:${key}`,
		},
	};
	globalThis.Hooks = {
		on: (hook, callback) => {
			hooks.push({ hook, callback });
		},
	};
	globalThis.shadowdark = {
		apps: { SpellBookSD },
		utils: {
			resolveSpellClasses: async input => {
				resolverInputs.push(input);
				return currentClasses;
			},
		},
	};
	globalThis.ui = {
		notifications: {
			error: (...args) => {
				notifications.push(args);
				return "notification-result";
			},
		},
	};
	globalThis.fromUuid = async uuid => {
		if (throwFromUuid) throw new Error(`UUID failure: ${uuid}`);
		return uuidDocuments.has(uuid) ? uuidDocuments.get(uuid) : null;
	};

	return {
		ActorDocument,
		Dialog,
		PlayerSD,
		SpellBookSD,
		dialogCalls,
		hooks,
		notifications,
		originalGetDataCalls,
		renderedApps,
		resolverInputs,
		templateCalls,
		setClasses(value) {
			currentClasses = value;
		},
		setThrowFromUuid(value) {
			throwFromUuid = value;
		},
		uuidDocuments,
	};
}

test("alignment filtering reaches the PlayerSD method and preserves Shadowdark 4.0.6 behavior", async () => {
	const previous = snapshotGlobals();
	const fake = installFakeFoundry();
	try {
		const init = await loadInitializer();
		init();

		assert.equal(typeof CONFIG.Actor.documentClass.prototype.openSpellBook, "function");
		assert.equal(
			CONFIG.Actor.documentClass.prototype.openSpellBook(),
			"document-sentinel",
			"the dead Actor document seam remains untouched",
		);
		assert.equal(typeof fake.PlayerSD.prototype.getSpellcasterClasses, "undefined");
		assert.equal(typeof fake.ActorDocument.prototype.getSpellcasterClasses, "undefined");

		const actor = {
			id: "actor-1",
			name: "Test Player",
			spellClasses: ["wizard"],
			system: { alignment: "lawful" },
		};
		actor.system = new fake.PlayerSD(actor);
		actor.system.parent = actor;
		assert.equal(actor.system.openSpellBook, fake.PlayerSD.prototype.openSpellBook);

		const classInput = actor.system.spellcasting.classes;
		fake.setClasses([]);
		assert.equal(await actor.system.openSpellBook(), "notification-result");
		assert.deepEqual(fake.notifications, [["localized:SHADOWDARK.item.errors.no_spellcasting_classes", { permanent: false }]]);
		assert.deepEqual(fake.resolverInputs, [classInput]);

		fake.setClasses([{ uuid: "class-wizard", name: "wizard" }]);
		await actor.system.openSpellBook();
		assert.equal(fake.renderedApps.length, 1);
		assert.equal(fake.renderedApps[0].classUuid, "class-wizard");
		assert.equal(fake.renderedApps[0].actorId, "actor-1");
		assert.equal(fake.renderedApps[0].alignment, "lawful");

		fake.setClasses([
			{ uuid: "class-wizard", name: "wizard" },
			{ uuid: "class-priest", name: "priest" },
		]);
		const multiResult = await actor.system.openSpellBook();
		assert.equal(fake.templateCalls.length, 1);
		assert.equal(fake.templateCalls[0].path, "systems/shadowdark/templates/dialog/choose-spellbook.hbs");
		assert.deepEqual(fake.templateCalls[0].context, {
			classes: [
				{ uuid: "class-wizard", name: "wizard" },
				{ uuid: "class-priest", name: "priest" },
			],
		});
		assert.equal(multiResult, undefined, "the legacy multi-class promise preserves the installed return behavior");
		assert.equal(fake.dialogCalls.length, 1);
		assert.equal(fake.dialogCalls[0].options.title, "localized:SHADOWDARK.dialog.spellbook.open_which_class.title");
		assert.deepEqual(fake.dialogCalls[0].options.buttons, {});
		let prevented = false;
		fake.dialogCalls[0].clickHandler({
			preventDefault: () => {
				prevented = true;
			},
			currentTarget: { dataset: { uuid: "class-priest" } },
		});
		assert.equal(prevented, true);
		assert.equal(fake.dialogCalls[0].dialog.closed, true);
		assert.equal(fake.renderedApps.at(-1).classUuid, "class-priest");
		assert.equal(fake.renderedApps.at(-1).alignment, "lawful");

		const entries = {
			unflagged: { uuid: "spell-unflagged" },
			lawful: { uuid: "spell-lawful" },
			mixedCase: { uuid: "spell-mixed-case" },
			neutral: { uuid: "spell-neutral" },
			chaotic: { uuid: "spell-chaotic" },
			fallback: { uuid: "spell-fallback", flags: { [MODULE_ID]: { alignment: "neutral" } } },
		};
		fake.uuidDocuments.set(entries.unflagged.uuid, { uuid: entries.unflagged.uuid, flags: {} });
		fake.uuidDocuments.set(entries.lawful.uuid, {
			uuid: entries.lawful.uuid,
			flags: { [MODULE_ID]: { alignment: "lawful" } },
		});
		fake.uuidDocuments.set(entries.mixedCase.uuid, {
			uuid: entries.mixedCase.uuid,
			flags: { [MODULE_ID]: { alignment: "Lawful" } },
		});
		fake.uuidDocuments.set(entries.neutral.uuid, {
			uuid: entries.neutral.uuid,
			flags: { [MODULE_ID]: { alignment: "neutral" } },
		});
		fake.uuidDocuments.set(entries.chaotic.uuid, {
			uuid: entries.chaotic.uuid,
			flags: { [MODULE_ID]: { alignment: "chaotic" } },
		});
		const originalActor = {
			id: actor.id,
			spellClasses: [...actor.spellClasses],
			alignment: actor.system.alignment,
		};
		const originalEntryFlags = structuredClone(entries.fallback.flags);
		const expectedByAlignment = {
			lawful: ["spell-unflagged", "spell-lawful"],
			neutral: ["spell-unflagged", "spell-neutral", "spell-fallback"],
			chaotic: ["spell-unflagged", "spell-chaotic"],
			"": ["spell-unflagged"],
		};
		const entriesByUuid = new Map(Object.values(entries).map(entry => [entry.uuid, entry]));
		for (const [actorAlignment, expected] of Object.entries(expectedByAlignment)) {
			const app = new fake.SpellBookSD("class-wizard", actor.id);
			app.alignment = actorAlignment;
			app.entries = Object.values(entries);
			const options = { sentinel: actorAlignment };
			const callsBefore = fake.originalGetDataCalls.length;
			const context = await app.getData(options);
			assert.equal(fake.originalGetDataCalls.length, callsBefore + 1, "base getData runs exactly once");
			assert.deepEqual(
				context.spellList[1].map(entry => entry.uuid),
				expected,
				`${actorAlignment || "empty"} alignment applies exact-match filtering`,
			);
			for (const visibleEntry of context.spellList[1]) {
				assert.strictEqual(
					visibleEntry,
					entriesByUuid.get(visibleEntry.uuid),
					"visible results preserve the original spellbook/index entry identity",
				);
			}
			assert.equal(context.baseSentinel, "preserved");
			assert.deepEqual(context.nested, { preserved: true });
			const call = fake.originalGetDataCalls.at(-1);
			assert.equal(call.receiver, app);
			assert.deepEqual(call.args, [options]);
		}
		assert.deepEqual(
			{
				id: actor.id,
				spellClasses: actor.spellClasses,
				alignment: actor.system.alignment,
			},
			originalActor,
			"actor model and spellcasting values are unchanged",
		);
		assert.deepEqual(entries.fallback.flags, originalEntryFlags, "spell source flags are unchanged");

		const failingApp = new fake.SpellBookSD("class-wizard", actor.id);
		failingApp.alignment = "lawful";
		failingApp.entries = [{ uuid: "spell-throws" }];
		fake.setThrowFromUuid(true);
		await assert.rejects(failingApp.getData(), /UUID failure: spell-throws/);
		fake.setThrowFromUuid(false);
	} finally {
		restoreGlobals(previous);
	}
});

test("alignment filtering patches are repeat-safe and fail closed when a 4.x seam is absent", async () => {
	const previous = snapshotGlobals();
	const fake = installFakeFoundry();
	try {
		const init = await loadInitializer(true);
		init();
		const playerMethod = fake.PlayerSD.prototype.openSpellBook;
		const getDataMethod = fake.SpellBookSD.prototype.getData;
		const hookCount = fake.hooks.length;
		const cacheBustedInit = await loadInitializer(true);
		cacheBustedInit();
		init();
		assert.equal(fake.PlayerSD.prototype.openSpellBook, playerMethod);
		assert.equal(fake.SpellBookSD.prototype.getData, getDataMethod);
		assert.equal(fake.hooks.length, hookCount);

		const missingSeams = [
			{
				label: "CONFIG.Actor.dataModels.Player.prototype.openSpellBook",
				remove: fake => delete fake.PlayerSD.prototype.openSpellBook,
			},
			{
				label: "shadowdark.apps.SpellBookSD.prototype.getData",
				remove: fake => delete fake.SpellBookSD.prototype.getData,
			},
			{
				label: "shadowdark.utils.resolveSpellClasses",
				remove: () => delete globalThis.shadowdark.utils.resolveSpellClasses,
			},
			{
				label: "Hooks.on",
				remove: () => delete globalThis.Hooks.on,
			},
		];
		for (const seam of missingSeams) {
			const missingPrevious = snapshotGlobals();
			const missingFake = installFakeFoundry();
			const hookCount = missingFake.hooks.length;
			seam.remove(missingFake);
			const playerMethod = missingFake.PlayerSD.prototype.openSpellBook;
			const getDataMethod = missingFake.SpellBookSD.prototype.getData;
			const warnings = [];
			const previousWarn = console.warn;
			console.warn = message => warnings.push(message);
			try {
				const missingInit = await loadInitializer(true);
				assert.doesNotThrow(() => missingInit(), `${seam.label} fallback does not throw`);
			} finally {
				console.warn = previousWarn;
			}
			assert.equal(warnings.length, 1, `${seam.label} emits exactly one warning`);
			assert.ok(warnings[0].includes(seam.label), `${seam.label} warning is actionable`);
			assert.strictEqual(missingFake.PlayerSD.prototype.openSpellBook, playerMethod);
			assert.strictEqual(missingFake.SpellBookSD.prototype.getData, getDataMethod);
			assert.equal(missingFake.hooks.length, hookCount, `${seam.label} leaves hook count unchanged`);
			assert.equal(
				Object.prototype.hasOwnProperty.call(missingFake.PlayerSD.prototype, PLAYER_PATCH),
				false,
				`${seam.label} does not install a player marker`,
			);
			assert.equal(
				Object.prototype.hasOwnProperty.call(missingFake.SpellBookSD.prototype, SPELLBOOK_PATCH),
				false,
				`${seam.label} does not install a spellbook marker`,
			);
			restoreGlobals(missingPrevious);
		}
	} finally {
		restoreGlobals(previous);
	}
});
