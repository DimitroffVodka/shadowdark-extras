// Shared setup for the suites that drive the tray's Notes tab.
//
// Two files need the same world before they can ask their own questions: the
// grouped-tab suite, which asks what context the Notes view is given, and the
// lifecycle suite, which asks what makes that context get rebuilt. Both need
// the whole ambient Foundry surface a real `TrayApp` touches, the same
// note-bearing document doubles, the same one-shot `initTray()`, and the same
// enrichment tracer — and the tracer in particular is the oracle both of them
// hang their assertions on, so it is worth having exactly one of it.
//
// What is NOT here is scene shape. The two suites want different scenes and
// mutate them differently, and a fixture builder general enough for both would
// be harder to read than the two it replaced.

import assert from "node:assert/strict";

import { installCanvasGlobals } from "./pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./dom-harness.mjs";

export const MODULE_ID = "shadowdark-extras";

/**
 * Install everything a real tray reads at load and render time, and hand back
 * the handles a test steers it with.
 *
 * Call this at module scope, BEFORE importing TraySD/TrayApp: the tray reads
 * these globals while it is being loaded, not only while it runs.
 *
 * @param {object} [options]
 * @param {object} [options.dom] A makeSelectorDom() result to install.
 * @returns {{hooks: Array, dom: object, features: object}} `hooks` records every
 *   `Hooks.on` the module makes, which is what lets a test fire a registered
 *   lifecycle handler rather than a stand-in for it.
 */
export function installTrayHarness({ dom = makeSelectorDom({ seedAll: true }) } = {}) {
	installCanvasGlobals();
	const { hooks } = installAppGlobals({ dom });

	// Which features the tray believes are on. `getDisabledFeatureIds` re-reads
	// the setting on every render, so changing this changes what the tray sees
	// without anything being re-imported.
	let disabled = [];
	const features = {
		disable: ids => {
			disabled = ids;
		},
		enableAll: () => {
			disabled = [];
		},
	};

	globalThis.game.settings = {
		get: (_scope, key) => {
			if (key === "tray.enabled") return true;
			if (key === "disabledFeatures") return disabled;
			return undefined;
		},
		set: async () => {},
		register() {},
	};
	globalThis.game.scenes = new Map();
	globalThis.game.modules = new Map();
	globalThis.game.actors = new Map();
	globalThis.game.users = [];
	globalThis.game.i18n = { localize: key => key, format: key => key };
	globalThis.game.user = { id: "user-1", isGM: true };
	globalThis.canvas.grid = { size: 100, isHexagonal: true };
	globalThis.canvas.tokens = { controlled: [], placeables: [] };

	return { hooks, dom, features };
}

/**
 * The one boundary these suites do not own. Ticket 1 proved the enrichment
 * policy against it; here it only has to give rows something to carry, and to
 * be observable when a test wants to know whether a rebuild happened.
 */
export function installEnricher() {
	foundry.applications.ux.TextEditor = { implementation: { enrichHTML: async html => html } };
}

/**
 * A document double carrying an SDX note.
 *
 * `calls` is what a refused command has to leave empty: "no write happened" is
 * weaker than "the document was never asked to do anything".
 *
 * The note body deliberately shares no wording with the diagnostic the index
 * logs when enrichment fails, so "the content stayed out of the log" is a real
 * question rather than a substring coincidence.
 */
export function noted(documentName, uuid, extra = {}) {
	const { flags: extraFlags, ...rest } = extra;
	const stored = { [MODULE_ID]: { notes: `<p>body of ${uuid}</p>`, ...extraFlags?.[MODULE_ID] } };
	const calls = [];
	const document = {
		documentName,
		uuid,
		id: uuid.split(".").pop(),
		name: "",
		...rest,
		flags: stored,
		calls,
		getFlag(scope, key) {
			calls.push(`getFlag:${key}`);
			return stored[scope]?.[key];
		},
		async setFlag(scope, key, value) {
			calls.push(`setFlag:${key}=${value}`);
			(stored[scope] ??= {})[key] = value;
			await document.emitUpdate({ [scope]: { [key]: value } });
		},
		async unsetFlag(scope, key) {
			calls.push(`unsetFlag:${key}`);
			delete stored[scope]?.[key];
			await document.emitUpdate({ [scope]: { [`-=${key}`]: null } });
		},
		// How a write becomes a refresh. Foundry answers a flag write by
		// broadcasting a document update, which is what every listener actually
		// hears; a test that wants the command path end to end installs that
		// bridge here. Left inert by default, so a fixture only gets the
		// behaviour it asked for.
		emitUpdate: async () => {},
	};
	return document;
}

/** A document with no SDX note on it at all — the "before" of a note being saved. */
export function unnoted(documentName, uuid, extra = {}) {
	const document = noted(documentName, uuid, extra);
	delete document.flags[MODULE_ID].notes;
	return document;
}

/**
 * Count what Foundry's enricher is asked to enrich, and restore it afterwards.
 *
 * This is the rebuild oracle for both suites: the Notes view enriches every
 * note it shows, so "a note was enriched" is how a test sees that the tray was
 * rebuilt, and an empty list is how it sees that it was not.
 *
 * @param {object} t The test context, for restoring the boundary afterwards.
 * @param {object} [options]
 * @param {string} [options.failFor] Reject for any note whose HTML contains this.
 */
export function traceEnrichment(t, { failFor = null } = {}) {
	const calls = [];
	const previous = foundry.applications.ux.TextEditor.implementation.enrichHTML;
	foundry.applications.ux.TextEditor.implementation.enrichHTML = async (html, options) => {
		calls.push({ html, options });
		if (failFor && html.includes(failFor)) throw new Error("unparseable note");
		return html;
	};
	t.after(() => {
		foundry.applications.ux.TextEditor.implementation.enrichHTML = previous;
	});
	return calls;
}

/**
 * Drive the tray's debounced refreshes on demand instead of by waiting for
 * them.
 *
 * The tray coalesces document updates behind 100ms and 300ms timers. Sleeping
 * past those is what a suite does when it has no other option, and it costs
 * real seconds and makes completion depend on how the machine felt about
 * scheduling. Node's mock timers make the same production callback run because
 * the test said so.
 *
 * `setTimeout` alone is mocked, so `setImmediate` stays real and can still be
 * used to give the renders those callbacks start a turn to finish — a render
 * awaits enrichment, so the timer firing is not the end of the story.
 *
 * @param {object} t The test context; the clock is restored when it ends.
 * @returns {{settle: Function, idle: Function}}
 */
export function useDebounceClock(t) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.after(() => t.mock.timers.reset());

	return {
		/**
		 * Run every refresh the tray has scheduled, and let it finish.
		 *
		 * @param {number} [ms] How far to advance. The default clears the
		 *   longest production debounce (300ms) with room to spare.
		 */
		async settle(ms = 500) {
			t.mock.timers.tick(ms);
			// A render is asynchronous well past the tick that started it:
			// enrichment is awaited per row, and the publish happens after. Ten
			// real turns is far more than that chain needs and still costs
			// microseconds.
			for (let turn = 0; turn < 10; turn++) {
				await new Promise(resolve => setImmediate(resolve));
			}
		},

		/** Let awaited work finish WITHOUT running any scheduled refresh. */
		async idle() {
			for (let turn = 0; turn < 10; turn++) {
				await new Promise(resolve => setImmediate(resolve));
			}
		},
	};
}

/**
 * Start the real tray once per process, without the painters' asset loads.
 *
 * The hex and dungeon painters read their tile catalogue from IndexedDB at
 * startup, which a Node process has none of. They are switched back on
 * immediately afterwards, so every tray mode stays reachable.
 */
export function makeTrayDriver(TraySD, features) {
	let started = false;

	return {
		start() {
			if (started) return;
			started = true;
			features.disable(["hex.painter", "dungeon.painter"]);
			TraySD.initTray();
			features.enableAll();
		},

		/**
		 * Switch tab and wait for the tray to be rebuilt. `setViewMode` starts a
		 * render without waiting for it, which is right for a click and useless
		 * for a measurement, so the render is repeated and awaited.
		 */
		async showView(mode) {
			await TraySD.setViewMode(mode);
			await TraySD.renderTray();
			assert.equal(TraySD.getViewMode(), mode, `the tray did not actually switch to ${mode}`);
		},
	};
}
