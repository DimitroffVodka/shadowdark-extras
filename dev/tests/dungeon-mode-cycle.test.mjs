// The Dungeons tab footer hint promises "Ctrl to switch mode", and the Ctrl
// handler in scripts/tray/TraySD.mjs is the only thing that keeps that promise.
// It used to toggle tiles <-> doors, which made the Int. Walls tab unreachable
// from the keyboard even though the hint rendered in all three modes.
//
// So what is tested here is that the cycle visits every mode tab, in the order
// the tabs render — because a shortcut advertised as "switch mode" that skips a
// mode is the bug, and a cycle running in some other order than the tabs is the
// next one.
//
// NOT TESTED HERE — that pressing Ctrl in a live world actually fires. The
// listener is a document-level keydown registered inside initTray(), gated on
// the tray being expanded and in dungeons view; reproducing that needs a real
// tray instance and a real key event. Live-V14 acceptance covers it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DUNGEON_MODES, getDungeonMode, nextDungeonMode, setDungeonMode } from "../../scripts/dungeon/dungeon-tool-state.mjs";

const TRAY_HBS = new URL("../../templates/sdx-tray/tray.hbs", import.meta.url);

test("the Ctrl cycle visits every mode and returns to the start", () => {
	const seen = [];
	let mode = DUNGEON_MODES[0];
	for (let i = 0; i < DUNGEON_MODES.length; i++) {
		seen.push(mode);
		mode = nextDungeonMode(mode);
	}

	assert.deepEqual(seen, DUNGEON_MODES, "cycle skipped a mode or ran out of order");
	assert.equal(mode, DUNGEON_MODES[0], "cycle did not wrap around");
});

test("the cycle order matches the mode tabs in tray.hbs", () => {
	const hbs = readFileSync(TRAY_HBS, "utf8");
	const tabs = [...hbs.matchAll(/data-dungeon-mode="([^"]+)"/g)].map(m => m[1]);

	assert.deepEqual(tabs, DUNGEON_MODES, "tab order and cycle order have drifted apart");
});

test("an unknown mode restarts the cycle rather than dropping out of it", () => {
	assert.equal(nextDungeonMode(undefined), DUNGEON_MODES[0]);
	assert.equal(nextDungeonMode("nonsense"), DUNGEON_MODES[0]);
});

test("every cycled mode is one setDungeonMode accepts", () => {
	// The setter silently ignores anything off its allowlist, so a cycle that
	// produced an unlisted mode would wedge the tab instead of erroring.
	let mode = getDungeonMode();
	for (let i = 0; i < DUNGEON_MODES.length; i++) {
		mode = nextDungeonMode(mode);
		setDungeonMode(mode);
		assert.equal(getDungeonMode(), mode, `setDungeonMode rejected "${mode}"`);
	}
});
