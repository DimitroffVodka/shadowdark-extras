// Behaviour tests for placeable notes, driven through the module's real
// public entry point rather than its class members.
//
// Every test here starts at `initPlaceableNotes()`, which registers the two
// hooks Foundry actually calls, and then dispatches those hooks the way a
// sheet render does. The control the module contributes is invoked the way a
// user clicks it, and what is asserted is the outcome: an app opened against
// the right document, carrying the right context.
//
// HARNESS BOUNDARY — the .hbs template is not rendered here. Handlebars is not
// resolvable in this repo's dependency tree (`node -e "import('handlebars')"`
// fails; there are no devDependencies beyond eslint/acorn/the Foundry CLI), so
// no Node-side test can compile templates/placeable-notes.hbs and prove what a
// user sees. What is asserted instead is the strongest contract available: the
// context the template is handed carries the saved note, enriched, with
// secrets gated on GM. The rendered-output half is a live-V14 acceptance item.
//
// Mocks are confined to the Foundry boundary: ApplicationV2 (so an "open"
// is observable), the text enricher, the form reader, i18n, and the document.
// i18n is backed by the REAL i18n/en.json and falls back to the key when a
// string is missing, exactly as game.i18n.localize does — so a missing
// translation surfaces here as the raw key, the same way it does in the UI.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { installAppGlobals } from "./helpers/dom-harness.mjs";
import { expandObject, getProperty } from "./helpers/foundry-utils.mjs";

const EN = JSON.parse(
	readFileSync(new URL("../../i18n/en.json", import.meta.url), "utf8")
);

// Every app the module opens, in order. Standing in for ApplicationV2 at the
// boundary is what makes "the user's click opened the notes app" observable
// without reaching into the module.
const opened = [];

class RecordingApplicationV2 {
	static DEFAULT_OPTIONS = {};

	static PARTS = {};

	constructor(options = {}) {
		this.options = options;
	}

	render(force) {
		opened.push({ app: this, force });
		return this;
	}

	async close() {
		this.closed = true;
		return this;
	}
}

const { hooks } = installAppGlobals({
	applications: {
		api: {
			ApplicationV2: RecordingApplicationV2,
			HandlebarsApplicationMixin: Base => class extends Base {},
			DialogV2: class StubDialogV2 {},
		},
	},
});

// Foundry's localize returns the key unchanged when nothing is registered for
// it, which is why an unregistered key renders as itself in the UI.
globalThis.game = {
	user: { isGM: true },
	i18n: { localize: key => EN[key] ?? key },
	settings: { get: () => true },
};
globalThis.ui = { notifications: { info() {} } };

Object.assign(globalThis.foundry.utils, { expandObject, getProperty });

// Tagging the enricher's output is what lets a test tell "the saved note
// reached enrichment" apart from "some string was copied across".
globalThis.foundry.applications.ux = {
	TextEditor: {
		implementation: {
			enrichHTML: async (html, options = {}) =>
				`[enriched secrets=${!!options.secrets}]${html ?? ""}`,
		},
	},
	FormDataExtended: class {
		constructor(element) {
			this.object = element?.formData ?? {};
		}
	},
};

const { initPlaceableNotes } = await import(
	"../../scripts/journal/PlaceableNotesSD.mjs"
);

// The module's public entry point. Everything below reaches the code only
// through the hooks this registers.
initPlaceableNotes();

/** A stand-in placeable document holding one flag. */
function makeDocument({ notes = "", documentName = "Token", name = "Goblin" } = {}) {
	const flags = { "shadowdark-extras": { notes } };
	return {
		documentName,
		name,
		id: "abc123",
		getFlag: (scope, key) => flags[scope]?.[key],
		setFlag: async (scope, key, value) => {
			(flags[scope] ??= {})[key] = value;
		},
	};
}

/** Dispatch a Foundry hook to whatever the module registered for it. */
function callHook(name, ...args) {
	const registered = hooks.filter(hook => hook.name === name);
	assert.notEqual(registered.length, 0, `nothing is registered for the "${name}" hook`);
	for (const hook of registered) hook.fn(...args);
}

/**
 * Render a v14 document sheet's header and return the controls it offers.
 * `getHeaderControlsDocumentSheetV2` is the hook every DocumentSheetV2 fires.
 */
function headerControlsFor(document) {
	const controls = [];
	callHook("getHeaderControlsDocumentSheetV2", { document }, controls);
	return controls;
}

/** Same, for the legacy V1 actor sheet, which fires its own hook. */
function actorHeaderButtonsFor(document) {
	const buttons = [];
	callHook("getActorSheetHeaderButtons", { document }, buttons);
	return buttons;
}

test("clicking the control on a v14 sheet opens that placeable's notes", async () => {
	opened.length = 0;
	const document = makeDocument({ notes: "<p>Trapped chest</p>" });

	const control = headerControlsFor(document).find(c => c.action === "open-sdx-notes");
	control.onClick();

	assert.equal(opened.length, 1);
	assert.equal(opened[0].app.object, document);
});

test("clicking the control on a legacy actor sheet opens that actor's notes", async () => {
	opened.length = 0;
	const document = makeDocument({ documentName: "Actor", name: "Vex" });

	const button = actorHeaderButtonsFor(document).find(b => b.class === "open-sdx-notes");
	button.onclick();

	assert.equal(opened.length, 1);
	assert.equal(opened[0].app.object, document);
});

test("the notes a placeable already has are the notes its opened app shows", async () => {
	opened.length = 0;
	const document = makeDocument({ notes: "<p>Trapped chest</p>" });

	headerControlsFor(document).find(c => c.action === "open-sdx-notes").onClick();
	const context = await opened[0].app._prepareContext({});

	// The template renders `enrichedNotes` in both its branches, so this is the
	// value that decides whether a saved note is visible at all.
	assert.equal(context.enrichedNotes, "[enriched secrets=true]<p>Trapped chest</p>");
});

test("a player's view of a note is enriched without GM secrets", async () => {
	opened.length = 0;
	game.user.isGM = true;
	const document = makeDocument({ notes: "<p>Trapped chest</p>" });
	headerControlsFor(document).find(c => c.action === "open-sdx-notes").onClick();
	const app = opened[0].app;

	game.user.isGM = false;
	try {
		const context = await app._prepareContext({});
		assert.equal(context.enrichedNotes, "[enriched secrets=false]<p>Trapped chest</p>");
	}
	finally {
		game.user.isGM = true;
	}
});

// Only the label is asserted for the v2 control. Foundry v14's
// _renderHeaderControl builds the entry from `icon` + `_loc(label)` and reads
// no tooltip, so a tooltip assertion here would claim hover behaviour the
// platform does not provide. The V1 hook below is the one core gives a
// data-tooltip, per templates/app-window.html.
test("the v14 sheet control names itself in the user's language", () => {
	const control = headerControlsFor(makeDocument()).find(c => c.action === "open-sdx-notes");

	assert.equal(control.label, "SDX Notes");
});

test("the legacy actor-sheet button names itself on hover, in the user's language", () => {
	const button = actorHeaderButtonsFor(makeDocument({ documentName: "Actor" }))
		.find(b => b.class === "open-sdx-notes");

	assert.equal(button.label, "SDX Notes");
	assert.equal(button.tooltip, "SDX Notes");
});

test("players are not offered the notes control at all", () => {
	game.user.isGM = false;
	try {
		assert.deepEqual(headerControlsFor(makeDocument()), []);
		assert.deepEqual(actorHeaderButtonsFor(makeDocument({ documentName: "Actor" })), []);
	}
	finally {
		game.user.isGM = true;
	}
});

test("the notes window is titled in words, not with a translation key", () => {
	opened.length = 0;
	headerControlsFor(makeDocument()).find(c => c.action === "open-sdx-notes").onClick();

	const title = opened[0].app.constructor.DEFAULT_OPTIONS.window.title;

	assert.equal(game.i18n.localize(title), "GM Notes");
});

test("saving a note confirms it in words, and the note survives a reopen", async () => {
	opened.length = 0;
	const messages = [];
	globalThis.ui.notifications.info = (message, options = {}) => {
		messages.push(options.localize ? game.i18n.localize(message) : message);
	};
	const document = makeDocument();

	headerControlsFor(document).find(c => c.action === "open-sdx-notes").onClick();
	const app = opened[0].app;
	app.element = { formData: { "flags.shadowdark-extras.notes": "<p>Beware</p>" } };
	// The `save` action is the button binding the form declares, so this is the
	// same route the Save button takes.
	await app.constructor.DEFAULT_OPTIONS.actions.save.call(app);

	assert.deepEqual(messages, ["Notes saved."]);

	opened.length = 0;
	headerControlsFor(document).find(c => c.action === "open-sdx-notes").onClick();
	const reopened = await opened[0].app._prepareContext({});
	assert.equal(reopened.enrichedNotes, "[enriched secrets=true]<p>Beware</p>");
});
