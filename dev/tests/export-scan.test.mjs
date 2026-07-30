import assert from "node:assert/strict";
import test from "node:test";

import { scanExports } from "../tools/export-scan.mjs";

/**
 * The four manifest-declared esmodules are the module's static public surface.
 * Phase 3 cuts registration groups out of the 21k-line composition root and
 * re-exports them through an API facade; the export names are what must not
 * move while that happens.
 *
 * A green result here means the NAMES are stable. It says nothing about
 * parameters or return shapes — a changed signature breaks consumers with the
 * name set still green, so this is necessary, never sufficient.
 */

test("captures function and class declarations", () => {
  const source = [
    "export function executeItemMacro() {}",
    "export async function hasItemMacro() {}",
    "export class TileFlattenSD {}",
    "export function* walk() {}",
  ].join("\n");

  assert.deepEqual(scanExports(source).names, ["executeItemMacro", "hasItemMacro", "TileFlattenSD", "walk"].sort());
});

test("captures variable declarations, including multiple declarators", () => {
  const source = ["export const MODULE_ID = 'sdx';", "export let cache = null, pending = 0;"].join("\n");

  assert.deepEqual(scanExports(source).names, ["MODULE_ID", "cache", "pending"].sort());
});

test("captures export lists and renames", () => {
  const source = "export { registerSpellMacros, internalName as publicName };";

  assert.deepEqual(scanExports(source).names, ["publicName", "registerSpellMacros"]);
});

test("captures re-export lists as exports of this module", () => {
  const source = 'export { getCustomLightSources } from "./party/PartySheetSD.mjs";';

  assert.deepEqual(scanExports(source).names, ["getCustomLightSources"]);
});

test("records default exports under the name 'default'", () => {
  assert.deepEqual(scanExports("export default class SheetEditorConfig {}").names, ["default"]);
  assert.deepEqual(scanExports("export default fn;").names, ["default"]);
});

/**
 * A star re-export forwards names this parser cannot enumerate without
 * following the import. Recording the source lets a reviewer see that the
 * surface depends on another module rather than silently reporting nothing.
 */
test("records star re-exports separately from named exports", () => {
  const result = scanExports('export * from "./effects/AuraEffectsSD.mjs";');

  assert.deepEqual(result.names, []);
  assert.deepEqual(result.starExports, ["./effects/AuraEffectsSD.mjs"]);
});

test("names a namespaced star re-export", () => {
  const result = scanExports('export * as auras from "./effects/AuraEffectsSD.mjs";');

  assert.deepEqual(result.names, ["auras"]);
  assert.deepEqual(result.starExports, []);
});

test("ignores exports written in comments and strings", () => {
  const source = [
    "// export function ghost() {}",
    "/* export const ghost2 = 1; */",
    'const doc = "export function ghost3() {}";',
    "export function real() {}",
  ].join("\n");

  assert.deepEqual(scanExports(source).names, ["real"]);
});

test("does not treat the word export inside an identifier as an export", () => {
  const source = ["const exportedThing = 1;", "obj.export = 2;", "export function real() {}"].join("\n");

  assert.deepEqual(scanExports(source).names, ["real"]);
});

test("deduplicates and sorts names for a stable snapshot", () => {
  const source = ["export function a() {}", "export { b, a as c };", "export const d = 1;"].join("\n");

  assert.deepEqual(scanExports(source).names, ["a", "b", "c", "d"]);
});
