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

// --- channel 4: dotted update paths (issue #95, the fifth channel) -----------
//
// The other half of the same hazard. Foundry addresses a flag by path as well
// as by namespace object, and this module does it 149 times — including the
// write side of the very key issue #95 is about. `aura.regionId` was written
// only here, so before this channel existed it was in neither list and could be
// renamed with every gate green.
//
// The string is a path wherever it appears, so it is matched wherever it
// appears. What differs by position is only whether it persists: a key position
// is an update payload, anything else is reading a path.

const writesOf = (entries) => entries.filter(entry => !entry.dynamic && entry.writes)
	.map(entry => entry.key);
const readsOf = (entries) => entries.filter(entry => !entry.dynamic && !entry.writes)
	.map(entry => entry.key);

test("aura.regionId — the dotted write site is finally visible (issue #95 fixture)", () => {
	// scripts/effects/aura-regions.mjs:75. The write half of the pair the issue
	// is named for, invisible to all three earlier channels.
	const found = scanFlagLiterals(
		"await effect.update({ [`flags.${MODULE_ID}.aura.regionId`]: region.id });",
	);

	assert.deepEqual(writesOf(found), ["aura.regionId"]);
});

test("a path assigned into an update object is a write", () => {
	// scripts/item-sheets/activity-tab-widgets.mjs:236 — the commonest form of
	// this channel by a wide margin, and not an object key at all.
	const found = scanFlagLiterals(
		"updateData[`flags.${MODULE_ID}.spellDamage.enabled`] = true;",
	);

	assert.deepEqual(writesOf(found), ["spellDamage.enabled"]);
});

test("a plain string key naming our namespace is a write", () => {
	// scripts/combat/chat-card-hooks.mjs:35. No interpolation to key off.
	const found = scanFlagLiterals(`
		await card.update({ "flags.shadowdark-extras.targetIds": ids });
	`);

	assert.deepEqual(writesOf(found), ["targetIds"]);
});

test("a path read out of a document is a read, not a write", () => {
	const found = scanFlagLiterals(
		"const m = foundry.utils.getProperty(actor, `flags.${MODULE_ID}.members`);",
	);

	assert.deepEqual(readsOf(found), ["members"]);
	assert.deepEqual(writesOf(found), []);
});

test("an interpolation in the key position is a dynamic site, not a guessed key", () => {
	// scripts/combat/MedkitSD.mjs:362. Nothing about `key` is knowable here.
	const found = scanFlagLiterals("set[`flags.${MODULE_ID}.${key}`] = value;");

	assert.equal(found.length, 1);
	assert.equal(found[0].dynamic, true);
	assert.equal(found[0].key, null);
});

test("an interpolation below a known segment truncates to what is known", () => {
	// scripts/party/carousing/carousing-core.mjs:511. A grep of these sites
	// reports `carousingDrops.` — the trailing dot is an artefact of the text,
	// not a key, and must not reach the snapshot.
	const found = scanFlagLiterals(
		"updates[`flags.${MODULE_ID}.carousingDrops.${userId}`] = actorId;",
	);

	assert.deepEqual(writesOf(found), ["carousingDrops"]);
	assert.ok(found.every(entry => !entry.key?.endsWith(".")), "no key may end in a dot");
});

test("a deep path truncates at the interpolation, keeping every segment above it", () => {
	// scripts/party/carousing/carousing-core.mjs:597.
	const found = scanFlagLiterals(
		"const p = `flags.${MODULE_ID}.carousingSession.modifiers.${userId}`;",
	);

	assert.deepEqual(readsOf(found), ["carousingSession.modifiers"]);
});

test("the legacy -=key deletion form is stripped in a dotted path too", () => {
	// scripts/item-sheets/activity-tab-widgets.mjs:414.
	const found = scanFlagLiterals("update[`flags.${MODULE_ID}.-=animationFx`] = null;");

	assert.deepEqual(writesOf(found), ["animationFx"]);
});

test("the bare namespace path is not a key", () => {
	// scripts/hex/SDXHexFogSD.mjs:621 reads `flags.${MODULE_ID}` whole. There is
	// no key here to record, the same as a bare `doc.flags[MODULE_ID]`.
	const found = scanFlagLiterals("const all = foundry.utils.getProperty(doc, `flags.${MODULE_ID}`);");

	assert.deepEqual(found, []);
});

test("another package's dotted path is not collected", () => {
	// scripts/dungeon/DungeonGeneratorSD.mjs:1358 and eight siblings write
	// `wall-height` and `levels` paths. Not our stored data.
	const found = scanFlagLiterals(`
		await wall.update({ "flags.wall-height.bottom": 0, "flags.levels.rangeTop": 10 });
	`);

	assert.deepEqual(found, []);
});

test("an unresolvable scope is not assumed to be ours", () => {
	// scripts/journal/pin-tmfx-adapter.mjs:54. `scope` is not MODULE_ID, so this
	// path may belong to any package — the same rule the object channels use.
	const found = scanFlagLiterals("updates[`flags.${scope}.${key}`] = value;");

	assert.deepEqual(found, []);
});

test("a dotted path and an object payload for one key agree on its name", () => {
	// The two write channels must produce the same string, or a rename would
	// look like a removal in one list and an addition in the other.
	const viaPath = scanFlagLiterals("d[`flags.${MODULE_ID}.aura.regionId`] = id;");
	const viaPayload = scanFlagLiterals(
		"const d = { flags: { [MODULE_ID]: { aura: { regionId: id } } } };",
	);

	assert.deepEqual(writesOf(viaPath), writesOf(viaPayload));
});

// --- aliased reads through a local const (issue #95 finding 2) ----------------
//
// `const flags = tileDoc.flags?.[MODULE_ID]` makes every later `flags.key` a
// flag read with nothing about `.flags` left in it. Before this pass those keys
// looked write-only to the gate, so removing their reads never moved them out
// of the "still read" list — the dead-persistence signal was blind to them.

test("tiles / drawings / originalPosition — alias reads are found (issue #95 fixture)", () => {
	// scripts/canvas/TileFlattenSD.mjs:696-707. The exact fixture from the issue.
	const found = scanFlagLiterals(`
		function unflattenTile(tileDoc) {
			const flags = tileDoc.flags?.[MODULE_ID];
			if (!flags?.flattenedTile || (!flags?.tiles?.length && !flags?.drawings?.length)) return;
			const storedTiles = flags.tiles || [];
			const origin = flags.originalPosition || {};
			const x = flags.originalPosition.x;
			const y = flags.originalPosition.y;
		}
	`);

	assert.deepEqual([...new Set(keysOf(found, "property"))].sort(), [
		"drawings", "flattenedTile", "originalPosition",
		"originalPosition.x", "originalPosition.y", "tiles",
	]);
});

test("the || {} fallback does not hide the alias (issue #95 fixture)", () => {
	// scripts/character-sheet/BackgroundSheetSD.mjs:141.
	const found = scanFlagLiterals(`
		function getFlags(item) {
			const flags = item.flags?.[MODULE_ID] || {};
			return flags.advancement ?? [];
		}
	`);

	assert.deepEqual(keysOf(found, "property"), ["advancement"]);
});

test("the ?? {} fallback after a method call is an alias too (issue #95 fixture)", () => {
	// scripts/combat/MedkitSD.mjs:116.
	const found = scanFlagLiterals(`
		function payload(doc) {
			const flags = doc.toObject().flags?.[MODULE_ID] ?? {};
			return flags.medkitSpellSource;
		}
	`);

	assert.deepEqual(keysOf(found, "property"), ["medkitSpellSource"]);
});

test("an alias of a sub-path prefixes every read with that path (issue #95 fixture)", () => {
	// scripts/combat/WeaponBonusConfig.mjs:194. `flags` is the `.weaponBonus`
	// branch, so `flags.enabled` is the stored key `weaponBonus.enabled`.
	const found = scanFlagLiterals(`
		function hitBonuses(weapon) {
			const flags = weapon.flags?.[MODULE_ID]?.weaponBonus;
			if (!flags?.enabled) return [];
			return flags.hitBonuses;
		}
	`);

	assert.deepEqual(keysOf(found, "property").sort(), ["weaponBonus", "weaponBonus.enabled", "weaponBonus.hitBonuses"]);
});

test("an incidental .length on an array-valued flag is not a sub-key", () => {
	const found = scanFlagLiterals(`
		function count(tileDoc) {
			const flags = tileDoc.flags?.[MODULE_ID];
			return flags?.tiles?.length;
		}
	`);

	assert.deepEqual(keysOf(found, "property"), ["tiles"]);
});

test("a computed member through an alias is a dynamic site, not a guessed key", () => {
	// scripts/combat/MedkitSD.mjs:119 — `flags[key]` for a loop over the
	// enhancement keys. Nothing about `key` is knowable.
	const found = scanFlagLiterals(`
		function payload(doc) {
			const flags = doc.toObject().flags?.[MODULE_ID] ?? {};
			return flags[key];
		}
	`);

	assert.equal(found.length, 1);
	assert.equal(found[0].dynamic, true);
	assert.equal(found[0].key, null);
});

test("an alias of an alias is not followed", () => {
	// `view` aliases `flags`, but only one hop from the root is supported.
	const found = scanFlagLiterals(`
		function read(tileDoc) {
			const flags = tileDoc.flags?.[MODULE_ID];
			const view = flags;
			return view.tiles;
		}
	`);

	assert.deepEqual(keysOf(found, "property"), []);
});

test("a shadowing declaration in an inner scope invalidates the alias", () => {
	// Luna's repro: the module alias must NOT apply under an ordinary
	// same-name shadow — `flags.foo` here reads a plain local, not our data.
	const found = scanFlagLiterals(`
		const flags = doc.flags?.[MODULE_ID];
		function f(x) {
			const flags = x;
			return flags.foo;
		}
	`);

	assert.deepEqual(keysOf(found, "property"), []);
});

test("the innermost binding wins — the alias is shadowed only where shadowed", () => {
	const found = scanFlagLiterals(`
		const flags = doc.flags?.[MODULE_ID];
		const hit = flags.tiles;
		function f(x) {
			const flags = x;
			return flags.foo;
		}
	`);

	assert.deepEqual(keysOf(found, "property"), ["tiles"]);
});

test("a block-scoped alias is confined to its block", () => {
	const found = scanFlagLiterals(`
		const flags = doc.flags?.[MODULE_ID];
		{
			const flags = other;
			const miss = flags.foo;
		}
		const hit = flags.tiles;
	`);

	assert.deepEqual(keysOf(found, "property"), ["tiles"]);
});

test("a destructured binding is not an alias and shadows one", () => {
	const found = scanFlagLiterals(`
		const flags = doc.flags?.[MODULE_ID];
		const hit = flags.tiles;
		function f(doc) {
			const { flags } = doc.system;
			return flags.foo;
		}
	`);

	assert.deepEqual(keysOf(found, "property"), ["tiles"]);
});

test("a let/var binding is not an alias and shadows one", () => {
	const found = scanFlagLiterals(`
		const flags = doc.flags?.[MODULE_ID];
		const hit = flags.tiles;
		function f(doc) {
			let flags = doc.system;
			return flags.foo;
		}
	`);

	assert.deepEqual(keysOf(found, "property"), ["tiles"]);
});

// --- scope constant resolution (issue #95 finding 3) --------------------------
//
// A bare identifier scope was assumed to be ours, so swapping `MODULE_ID` for a
// foreign constant left the key list identical. Resolving module-level string
// constants makes the swap visible: our id stays ours, another module's id
// classifies foreign, and anything genuinely unknowable is recorded by name.

test("a module-level const equal to our id resolves the scope to ours", () => {
	const found = scanFlags(`
		const MODULE_ID = "shadowdark-extras";
		await scene.setFlag(MODULE_ID, "hexFogEnabled", true);
	`);

	assert.equal(found[0].dynamicScope, false);
	assert.equal(found[0].scope, "shadowdark-extras");
	assert.equal(found[0].unresolvedScope, null);
});

test("a module-level const naming another module resolves to a foreign scope", () => {
	const [entry] = scanFlags(`
		const OTHER_MODULE = "tokenmagic";
		await token.setFlag(OTHER_MODULE, "filters", []);
	`);

	assert.equal(entry.dynamicScope, false);
	assert.equal(entry.scope, "tokenmagic");
});

test("an unresolvable scope identifier is recorded, not guessed at", () => {
	// scripts/journal/pin-tmfx-adapter.mjs:29 — `s` is a parameter.
	const [entry] = scanFlags("const adapter = { getFlag: (s, k) => pin.getFlag(s, k) };");

	assert.equal(entry.dynamicScope, true);
	assert.equal(entry.unresolvedScope, "s");
});

test("a non-string constant does not resolve the scope", () => {
	const [entry] = scanFlags(`
		const COUNT = 5;
		actor.getFlag(COUNT, "members");
	`);

	assert.equal(entry.dynamicScope, true);
	assert.equal(entry.unresolvedScope, "COUNT");
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
