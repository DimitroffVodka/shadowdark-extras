import assert from "node:assert/strict";
import test from "node:test";

import { installPersistenceGlobals } from "./helpers/persistence-harness.mjs";

// The Journal directory hides this module's internal carousing journals. Deferring Carousing to
// the Enhancer turns the feature off; it must not bring those stores back into every user's list.
installPersistenceGlobals();
const handlers = {};
globalThis.Hooks = { on(event, fn) { (handlers[event] ??= []).push(fn); }, once() {}, off() {} };
globalThis.PIXI.Graphics = class {};
globalThis.PIXI.LegacyGraphics = class {};
globalThis.jQuery = class {};
// The Enhancer is installed and active, so Carousing reads off through its feature state.
globalThis.game.modules = { get: id => (id === "shadowdark-enhancer" ? { active: true } : undefined) };

const { registerJournalUIHooks } = await import("../../scripts/journal/journal-ui.mjs");
const { FEATURE_IDS, isFeatureEnabled } = await import("../../scripts/settings/feature-gates.mjs");

test("on an Enhancer world the internal carousing journals stay out of the Journal directory", () => {
	assert.equal(isFeatureEnabled(FEATURE_IDS.CAROUSING), false, "premise: the gate has flipped");
	const journals = {
		sync: { name: "__sdx_carousing_sync__" },
		tables: { name: "__sdx_carousing_tables__" },
		mine: { name: "Session notes" },
	};
	globalThis.game.journal = { get: id => journals[id] };
	const entry = id => ({ dataset: { entryId: id }, removed: false, remove() { this.removed = true; }, querySelector: () => null });
	const entries = Object.keys(journals).map(entry);

	registerJournalUIHooks();
	assert.equal(handlers.renderJournalDirectory?.length, 1, "the hiding hook is registered");
	handlers.renderJournalDirectory[0]({}, { querySelectorAll: () => entries }, {});

	assert.deepEqual(entries.map(e => e.removed), [true, true, false], "both internal journals hidden, the user's own left");
});
