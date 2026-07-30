import assert from "node:assert/strict";
import test from "node:test";

import { scanSettings } from "../tools/settings-scan.mjs";

/**
 * Settings keys and settings-menu ids are rename invariants: they are stored in
 * worlds, so renaming one silently discards every GM's configured value. The
 * reorganization plan lists them as untouchable, but nothing in the repository
 * guarded them until this scanner.
 *
 * This is a different contract from the registration snapshot, which is about
 * ORDER. Here only identity matters, so the two stay separate gates.
 */

const keys = (source) => scanSettings(source).map((entry) => entry.key);

test("captures registered settings keys", () => {
  const source = [
    'game.settings.register(MODULE_ID, "enableAuras", { scope: "world" });',
    "game.settings.register(MODULE_ID, 'hexFogEnabled', { scope: 'client' });",
  ].join("\n");

  assert.deepEqual(keys(source), ["enableAuras", "hexFogEnabled"]);
  assert.deepEqual(new Set(scanSettings(source).map((e) => e.api)), new Set(["register"]));
});

test("captures settings-menu ids separately from keys", () => {
  const source = 'game.settings.registerMenu(MODULE_ID, "combatSettingsMenu", { label: "Combat" });';

  const found = scanSettings(source);
  assert.equal(found.length, 1);
  assert.equal(found[0].api, "registerMenu");
  assert.equal(found[0].key, "combatSettingsMenu");
});

test("tolerates the call being split across lines", () => {
  const source = ["game.settings.register(", "  MODULE_ID,", '  "wrapped",', "  { scope: 'world' },", ");"].join("\n");

  assert.deepEqual(keys(source), ["wrapped"]);
  assert.equal(scanSettings(source)[0].line, 1);
});

/**
 * The tree has many other `.register(` calls — socketlib handlers and
 * libWrapper wrappers. Requiring the `game.settings` receiver is what keeps
 * them out; a bare `.register(` pattern would conflate three unrelated APIs.
 */
test("ignores registrations that are not settings", () => {
  const source = [
    'socketlibSocket.register("applyTokenDamage", handler);',
    'libWrapper.register(MODULE_ID, "Foo.prototype.bar", fn, "WRAPPER");',
    'Hooks.on("ready", () => {});',
    'game.settings.register(MODULE_ID, "real", {});',
  ].join("\n");

  assert.deepEqual(keys(source), ["real"]);
});

test("ignores settings written in comments and strings", () => {
  const source = [
    '// game.settings.register(MODULE_ID, "ghost", {});',
    'const help = "game.settings.register(MODULE_ID, \'ghost2\', {})";',
    'game.settings.register(MODULE_ID, "real", {});',
  ].join("\n");

  assert.deepEqual(keys(source), ["real"]);
});

/**
 * Roughly a dozen call sites in the tree build their key from a variable or a
 * loop. Those cannot be enumerated statically, and a gate that quietly dropped
 * them would overstate its own coverage — so they are counted, not hidden.
 */
test("reports a computed key as dynamic instead of guessing", () => {
  const source = [
    "for (const def of DEFS) game.settings.register(MODULE_ID, def.key, def.config);",
    "game.settings.register(MODULE_ID, `fx.${name}`, {});",
  ].join("\n");

  const found = scanSettings(source);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((entry) => entry.dynamic), [true, true]);
  assert.deepEqual(found.map((entry) => entry.key), [null, null]);
});

test("records the namespace when it is a literal", () => {
  const source = 'game.settings.register("shadowdark-extras", "literalNamespace", {});';

  assert.equal(scanSettings(source)[0].namespace, "shadowdark-extras");
});

test("records 1-based line numbers", () => {
  const source = ["", "", 'game.settings.register(MODULE_ID, "late", {});'].join("\n");

  assert.equal(scanSettings(source)[0].line, 3);
});
