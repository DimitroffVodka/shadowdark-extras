// Unit tests for the document-flag scanner, dev/tools/flag-scan.mjs.
//
// The first version of this gate shipped with no tests. It matched only
// `setFlag`/`getFlag`/`unsetFlag` method calls while describing itself as
// repo-wide, and 72 keys were invisible to it — 20 of them in the files the
// sweep-6 split was about to touch (issue #91). A single fixture asserting
// that a payload-written key is found would have caught that before it shipped.
//
// The two fixtures that matter are named below and taken from real call sites.

import assert from "node:assert/strict";
import test from "node:test";

import { scanFlags, scanFlagLiterals } from "../tools/flag-scan.mjs";

const keysOf = (entries, api) => entries
	.filter(entry => (api ? entry.api === api : true) && !entry.dynamic)
	.map(entry => entry.key);

// --- channel 1: method calls (the original scan) -----------------------------

test("method calls are found with their scope and key", () => {
	const found = scanFlags(`
		await scene.setFlag(MODULE_ID, "hexFogEnabled", true);
		const v = scene.getFlag(MODULE_ID, "hexFogRevealed");
		await scene.unsetFlag(MODULE_ID, "hexFogEffect");
	`);

	assert.deepEqual(found.map(entry => [entry.api, entry.key]), [
		["setFlag", "hexFogEnabled"],
		["getFlag", "hexFogRevealed"],
		["unsetFlag", "hexFogEffect"],
	]);
	assert.ok(found.every(entry => entry.dynamicScope), "MODULE_ID is not statically resolvable");
});

test("a foreign scope is reported as its literal namespace", () => {
	const [entry] = scanFlags(`const c = doc.getFlag("core", "sheetClass");`);

	assert.equal(entry.scope, "core");
	assert.equal(entry.dynamicScope, false);
});

test("a computed key is reported as dynamic rather than guessed at", () => {
	const [entry] = scanFlags("actor.setFlag(MODULE_ID, `prefix.${id}`, value);");

	assert.equal(entry.dynamic, true);
	assert.equal(entry.key, null);
});

// --- channel 2: creation/update payloads -------------------------------------

test("dungeonGenWall — a payload-written key is found (issue #91 fixture)", () => {
	// scripts/dungeon/DungeonGeneratorSD.mjs:822 and six sibling sites. Written
	// only this way; the method-call scan could not see it at all.
	const found = scanFlagLiterals(`
		await scene.createEmbeddedDocuments("Wall", [{
			c: coords,
			flags: { [MODULE_ID]: { dungeonGenWall: true } },
		}]);
	`);

	assert.deepEqual(keysOf(found, "payload"), ["dungeonGenWall"]);
});

test("hexGenJournal — a payload write is a WRITE, not merely a read (issue #91 fixture)", () => {
	// scripts/hex/HexTooltipSD.mjs:834. Its getFlag reads put it in readKeys, so
	// it looked covered while every one of its writes was invisible. A key with
	// reads but no writes is dead persistence, which is the case the separate
	// written/read lists exist to surface.
	const found = scanFlagLiterals(`
		journal = await JournalEntry.create({
			name: \`\${sceneName} - Hexplorer\`,
			flags: { [MODULE_ID]: { hexGenJournal: sceneId } },
		});
	`);

	assert.equal(found.length, 1);
	assert.equal(found[0].api, "payload");
	assert.equal(found[0].key, "hexGenJournal");
});

test("several keys in one payload are all found", () => {
	// scripts/dungeon/DungeonPainterSD.mjs:907 — the real shape.
	const found = scanFlagLiterals(`
		const d = { flags: { [MODULE_ID]: { dungeonWall: true, dungeonIntWall: true } } };
	`);

	assert.deepEqual(keysOf(found, "payload"), ["dungeonWall", "dungeonIntWall"]);
});

test("our module id written as a literal counts as ours", () => {
	const found = scanFlagLiterals(`
		const d = { flags: { "shadowdark-extras": { painted: true } } };
	`);

	assert.deepEqual(keysOf(found, "payload"), ["painted"]);
});

test("another package's flags payload is not collected", () => {
	const found = scanFlagLiterals(`
		const d = { flags: { "levels-3d-preview": { currentFloor: 2 } } };
	`);

	assert.deepEqual(found, []);
});

test("the legacy -=key deletion form counts as touching the base key", () => {
	const found = scanFlagLiterals(`
		await scene.update({ flags: { [MODULE_ID]: { "-=hexFogEffect": null } } });
	`);

	assert.deepEqual(keysOf(found, "payload"), ["hexFogEffect"]);
});

test("a computed payload key is reported as dynamic, not as its variable name", () => {
	// Guards a real bug from the first measurement pass: reading `[CAMPFIRE_FLAG]`
	// as the literal key "CAMPFIRE_FLAG" inflates coverage with a key that does
	// not exist.
	const found = scanFlagLiterals(`
		const d = { flags: { [MODULE_ID]: { [CAMPFIRE_FLAG]: true } } };
	`);

	assert.equal(found.length, 1);
	assert.equal(found[0].dynamic, true);
	assert.equal(found[0].key, null);
});

// --- channel 3: direct property access ---------------------------------------

test("a direct flags read is found through optional chaining", () => {
	// scripts/dungeon/DungeonGeneratorSD.mjs:1094 — the read half of the
	// dungeonGenWall fixture above.
	const found = scanFlagLiterals(`
		const isDungeonWall = (w) => w.flags?.[MODULE_ID]?.dungeonGenWall;
	`);

	assert.deepEqual(keysOf(found, "property"), ["dungeonGenWall"]);
});

test("a direct flags read is found without optional chaining", () => {
	const found = scanFlagLiterals(`const v = doc.flags[MODULE_ID].dungeonFloor;`);

	assert.deepEqual(keysOf(found, "property"), ["dungeonFloor"]);
});

test("a direct read of another package's flags is not collected", () => {
	const found = scanFlagLiterals(`
		const f = canvas.scene?.flags?.["levels-3d-preview"]?.currentFloor;
	`);

	assert.deepEqual(found, []);
});

test("a payload write and a direct read of the same key are reported separately", () => {
	const found = scanFlagLiterals(`
		const made = { flags: { [MODULE_ID]: { dungeonIntWall: true } } };
		const seen = w.flags?.[MODULE_ID]?.dungeonIntWall;
	`);

	assert.deepEqual(keysOf(found, "payload"), ["dungeonIntWall"]);
	assert.deepEqual(keysOf(found, "property"), ["dungeonIntWall"]);
});

// --- robustness --------------------------------------------------------------

test("a file the parser rejects reports the error instead of silently yielding nothing", () => {
	// This test previously asserted the opposite — that a parse failure returned
	// an empty array — which blessed a silent green. A first-party file using
	// syntax newer than the pinned ecmaVersion would contribute no keys at all
	// and the snapshot would stay happy while a whole file went unscanned.
	// `collectFlagKeys` now blocks on this rather than scanning less.
	const result = scanFlagLiterals("this is ( not javascript");

	assert.ok(result.parseError, "a parse failure must be reported, not swallowed");
	assert.equal(Array.isArray(result), false);
});

test("a flags payload with no namespace nesting is ignored", () => {
	// `flags: { hidden: true }` is a document field, not our namespace.
	assert.deepEqual(scanFlagLiterals(`const d = { flags: { hidden: true } };`), []);
});
