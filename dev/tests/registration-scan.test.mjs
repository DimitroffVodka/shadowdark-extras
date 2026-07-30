import assert from "node:assert/strict";
import test from "node:test";

import { scanRegistrations } from "../tools/registration-scan.mjs";

/**
 * Hook, libWrapper, and socketlib registration order is observable behaviour.
 * Phase 3 of the reorganization cuts new seams inside a 21k-line composition
 * root, and the failure mode there is a registration that quietly moves
 * relative to its neighbours. This scanner produces the static call-site
 * inventory that the snapshot gate diffs against.
 */

const summarise = (source) =>
  scanRegistrations(source).map((entry) => `${entry.api} ${entry.name} @${entry.line}`);

test("captures Hooks.on and Hooks.once in source order", () => {
  const source = [
    'Hooks.once("init", () => {});',
    'Hooks.on("renderActorSheet", () => {});',
    "Hooks.on('updateItem', () => {});",
  ].join("\n");

  assert.deepEqual(summarise(source), [
    "Hooks.once init @1",
    "Hooks.on renderActorSheet @2",
    "Hooks.on updateItem @3",
  ]);
});

test("tolerates whitespace and line breaks inside the call", () => {
  const source = ["Hooks.on(", '  "canvasReady",', "  () => {},", ");"].join("\n");

  assert.deepEqual(summarise(source), ["Hooks.on canvasReady @1"]);
});

test("ignores registrations inside comments and strings", () => {
  const source = [
    '// Hooks.on("ghost", () => {});',
    '/* Hooks.once("ghost2", () => {}); */',
    'const doc = "Hooks.on(\'ghost3\')";',
    'Hooks.on("real", () => {});',
  ].join("\n");

  assert.deepEqual(summarise(source), ["Hooks.on real @4"]);
});

/**
 * The wrapped target is libWrapper's real identity — the module id first
 * argument is the same everywhere and says nothing.
 */
test("captures the libWrapper target rather than the module id", () => {
  const source =
    'libWrapper.register(MODULE_ID, "foundry.canvas.placeables.Wall.prototype._onClickRight", fn, "WRAPPER");';

  assert.deepEqual(summarise(source), [
    "libWrapper.register foundry.canvas.placeables.Wall.prototype._onClickRight @1",
  ]);
});

/**
 * One of the three live call sites passes the target as a variable. The
 * snapshot must record the call site rather than drop it, so the entry is
 * marked dynamic and keeps its place in the order.
 */
test("records a libWrapper call site whose target is a variable", () => {
  const source = ["const wrapperPath = getPath();", 'libWrapper.register(MODULE_ID, wrapperPath, fn, "WRAPPER");'].join("\n");

  const found = scanRegistrations(source);
  assert.equal(found.length, 1);
  assert.equal(found[0].api, "libWrapper.register");
  assert.equal(found[0].dynamic, true);
  assert.equal(found[0].line, 2);
});

test("captures socketlib module registration", () => {
  const source = "socketlibSocket = globalThis.socketlib.registerModule(MODULE_ID);";

  const found = scanRegistrations(source);
  assert.equal(found.length, 1);
  assert.equal(found[0].api, "socketlib.registerModule");
});

/**
 * Three separate socket instances exist, each with its own variable name, so
 * the receiver is derived from the `registerModule` assignment rather than
 * hardcoded.
 */
test("captures socket handler registrations on a derived receiver", () => {
  const source = [
    "let _dungeonSocket;",
    "_dungeonSocket = socketlib.registerModule(MODULE_ID);",
    '_dungeonSocket.register("paintTiles", handler);',
    '_dungeonSocket.register("clearTiles", handler);',
  ].join("\n");

  const handlers = scanRegistrations(source).filter((entry) => entry.api === "socket.register");
  assert.deepEqual(handlers.map((entry) => entry.name), ["paintTiles", "clearTiles"]);
});

/**
 * `game.settings.register` is by far the most common `.register(` in the tree
 * and is not a registration-order contract. Sweeping it in would bury the
 * signal the gate exists to protect.
 */
test("does not treat settings registration as a socket handler", () => {
  const source = 'game.settings.register(MODULE_ID, "enableAuras", { scope: "world" });';

  assert.deepEqual(scanRegistrations(source), []);
});

test("records the hook name as dynamic when it is not a literal", () => {
  const source = "Hooks.on(hookName, () => {});";

  const found = scanRegistrations(source);
  assert.equal(found.length, 1);
  assert.equal(found[0].dynamic, true);
  assert.equal(found[0].name, null);
});
