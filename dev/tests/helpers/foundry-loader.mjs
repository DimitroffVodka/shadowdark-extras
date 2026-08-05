// Module resolution hook for tests that import a real tray/sheet application.
//
// The application modules pull in a large slice of the module — TrayApp alone
// reaches 50 files — and exactly one of those imports cannot resolve outside
// Foundry: scripts/animation/TMFXFilterEditor.mjs reaches sideways into the
// TokenMagic FX module ("../../../tokenmagic/gui/apps/data/fxControls.js"),
// which only exists when both modules are installed side by side.
//
// Rather than mock the whole graph, this stubs that one sibling-module import
// so the real code loads. Import this module BEFORE anything that transitively
// reaches TokenMagic.

import { registerHooks } from "node:module";

const STUB_URL = "sdx-test-stub:tokenmagic-fx-controls";

// TokenMagic's control tables are only read when its filter editor opens, so
// empty objects are enough to satisfy the import binding.
const STUB_SOURCE = "export const ANIM_PARAM_CONTROLS = {};\n"
	+ "export const FILTER_PARAM_CONTROLS = {};\n";

registerHooks({
	resolve(specifier, context, next) {
		if (specifier.includes("tokenmagic/")) {
			return { url: STUB_URL, format: "module", shortCircuit: true };
		}
		return next(specifier, context);
	},
	load(url, context, next) {
		if (url === STUB_URL) {
			return { format: "module", source: STUB_SOURCE, shortCircuit: true };
		}
		return next(url, context);
	},
});
