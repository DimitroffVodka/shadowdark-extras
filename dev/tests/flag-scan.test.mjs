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

// --- nested paths (issue #95, finding 1) -------------------------------------
//
// A flag value is often an object, and its sub-keys are stored data in exactly
// the same way its top-level key is. Recording only the first segment meant
// renaming `aura.regionId` at every site left the gate green while every
// existing document kept a `regionId` nobody read.
//
// Only the deepest path each site actually touches is recorded — the parent is
// not recorded alongside it. A path string already names every ancestor, so a
// rename at any level changes it; adding `aura` next to `aura.regionId` would
// duplicate that signal against no call site. A parent still stands alone
// wherever the code genuinely stops there (`?.aura` on its own, below).

test("aura.regionId — a nested payload write records the full path (issue #95 fixture)", () => {
	const found = scanFlagLiterals(`
		await effect.update({ flags: { [MODULE_ID]: { aura: { regionId: region.id } } } });
	`);

	assert.deepEqual(keysOf(found, "payload"), ["aura.regionId"]);
});

test("aura.regionId — a nested direct read records the full path (issue #95 fixture)", () => {
	// scripts/effects/aura-tokenmagic.mjs:163, the read half of the pair. The
	// scanner stopped at `aura` here, so renaming `regionId` at both sites was
	// invisible to the gate.
	const found = scanFlagLiterals(`
		const id = auraEffect?.flags?.[MODULE_ID]?.aura?.regionId;
	`);

	assert.deepEqual(keysOf(found, "property"), ["aura.regionId"]);
});

test("a three-level path is recorded whole, through both channels", () => {
	const found = scanFlagLiterals(`
		const d = { flags: { [MODULE_ID]: { aura: { visualFx: { preset: "fire" } } } } };
		const p = doc.flags[MODULE_ID].aura.visualFx.preset;
	`);

	assert.deepEqual(keysOf(found, "payload"), ["aura.visualFx.preset"]);
	assert.deepEqual(keysOf(found, "property"), ["aura.visualFx.preset"]);
});

test("a single-segment key is unchanged by the added depth", () => {
	// The regression that matters: `hexData` must stay `hexData`. Depth is
	// additive, not a reshape of what was already recorded.
	const found = scanFlagLiterals(`
		const d = { flags: { [MODULE_ID]: { hexData: cells } } };
		const v = scene.flags?.[MODULE_ID]?.hexData;
	`);

	assert.deepEqual(keysOf(found, "payload"), ["hexData"]);
	assert.deepEqual(keysOf(found, "property"), ["hexData"]);
});

test("a read that stops at the namespace records the namespace", () => {
	// scripts/effects/aura-regions.mjs:181 reads the whole `aura` object. The
	// parent is a key in its own right wherever the code actually stops there.
	const found = scanFlagLiterals(`const config = effect?.flags?.[MODULE_ID]?.aura;`);

	assert.deepEqual(keysOf(found, "property"), ["aura"]);
});

test("only the deepest path is recorded, not every prefix of it", () => {
	const found = scanFlagLiterals(`const v = doc.flags[MODULE_ID].aura.regionId;`);

	assert.deepEqual(found.map(entry => entry.key), ["aura.regionId"]);
});

test("a computed first segment is a dynamic site, not a guessed path", () => {
	const found = scanFlagLiterals(`const v = doc.flags?.[MODULE_ID]?.[someVar]?.regionId;`);

	assert.equal(found.length, 1);
	assert.equal(found[0].dynamic, true);
	assert.equal(found[0].key, null);
});

test("a computed segment below a known key truncates to what is known", () => {
	// `weaponBonus[slot]` indexes into a flag value. The prefix is a real key and
	// stays one; the segment below it is not guessed at.
	const found = scanFlagLiterals(`const v = item.flags?.[MODULE_ID]?.weaponBonus?.[slot]?.bonus;`);

	assert.deepEqual(keysOf(found, "property"), ["weaponBonus"]);
});

test("a nested computed payload key leaves its parent recorded", () => {
	// The parent is a real write even when the scan cannot enumerate what goes
	// under it, so it must not vanish along with the unenumerable child.
	const found = scanFlagLiterals(`
		const d = { flags: { [MODULE_ID]: { aura: { [CAMPFIRE_FLAG]: true } } } };
	`);

	assert.deepEqual(keysOf(found, "payload"), ["aura"]);
	assert.equal(found.filter(entry => entry.dynamic).length, 1);
});

test("a method called on a flag value is not mistaken for a sub-key", () => {
	const found = scanFlagLiterals(`doc.flags?.[MODULE_ID]?.tiles?.forEach(fn);`);

	assert.deepEqual(keysOf(found, "property"), ["tiles"]);
});

test("an empty payload object is a write of the namespace itself", () => {
	const found = scanFlagLiterals(`const d = { flags: { [MODULE_ID]: { aura: {} } } };`);

	assert.deepEqual(keysOf(found, "payload"), ["aura"]);
});

test("the legacy -=key deletion form is stripped at every depth", () => {
	const found = scanFlagLiterals(`
		await effect.update({ flags: { [MODULE_ID]: { aura: { "-=regionId": null } } } });
	`);

	assert.deepEqual(keysOf(found, "payload"), ["aura.regionId"]);
});

test("another package's nested flags are still not collected", () => {
	const found = scanFlagLiterals(`
		const d = { flags: { "levels-3d-preview": { camera: { floor: 2 } } } };
		const v = doc.flags?.["levels-3d-preview"]?.camera?.floor;
	`);

	assert.deepEqual(found, []);
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
