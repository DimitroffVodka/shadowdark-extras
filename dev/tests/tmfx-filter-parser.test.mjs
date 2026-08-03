import assert from "node:assert/strict";
import test from "node:test";

import { parseTMFXFilterParams } from "../../scripts/animation/tmfx-filter-parser.mjs";

test("parses TokenMagic JSON-like filter objects", () => {
  assert.deepEqual(
    parseTMFXFilterParams('new Macro([{ "filterId": "glow", filterType: "glow", enabled: true, values: [1, 2] }]);'),
    [{ filterId: "glow", filterType: "glow", enabled: true, values: [1, 2] }],
  );
});

test("accepts single-quoted strings but does not resolve identifiers", () => {
  assert.deepEqual(parseTMFXFilterParams("([{filterId: 'blur', filterType: 'blur', amount: null}])"), [
    { filterId: "blur", filterType: "blur", amount: null },
  ]);
  assert.throws(() => parseTMFXFilterParams("([{filterId: getSecret(), filterType: 'blur'}])"), /unsupported identifier/);
});

test("rejects malformed and prototype-polluting input", () => {
  assert.throws(() => parseTMFXFilterParams("([{filterId: 'blur', filterType: 'blur'}"), /not closed/);
  assert.throws(() => parseTMFXFilterParams("([{__proto__: {polluted: true}, filterType: 'blur'}])"), /invalid object key/);
  assert.deepEqual(parseTMFXFilterParams("([{filterId: 'blur', filterType: 'blur'}]); globalThis.process.exit()"), [
    { filterId: "blur", filterType: "blur" },
  ]);
});

test("rejects executable or non-object filter payloads", () => {
  assert.throws(() => parseTMFXFilterParams("([globalThis.process, {filterType: 'blur'}])"), /unsupported identifier/);
  assert.throws(() => parseTMFXFilterParams("(['not-a-filter'])"), /must contain objects/);
});
