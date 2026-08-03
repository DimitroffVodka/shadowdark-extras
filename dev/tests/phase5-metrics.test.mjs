import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeSource,
  classifyConsoleLines,
  collectPhase5Metrics,
  LINE_THRESHOLDS,
} from "../tools/phase5-metrics.mjs";

test("classifies active and commented console calls without counting strings", () => {
  const source = [
    "console.log(\"active\");",
    "// console.warn(\"commented\");",
    "const text = \"console.error(\\\"string\\\")\";",
    "/* console.info(\"commented\") */ console.debug(\"active\");",
  ].join("\n");

  assert.deepEqual(classifyConsoleLines(source), { active: 2, commented: 1, total: 3 });
});

test("reports physical newline lines and threshold candidates from a fixture", () => {
  const fixture = ["a", "b", "c"].join("\n") + "\n";
  assert.deepEqual(analyzeSource(fixture, "fixture.mjs"), {
    file: "fixture.mjs",
    physicalLines: 3,
    sourceLines: 4,
    console: { active: 0, commented: 0, total: 0 },
  });
  assert.equal(LINE_THRESHOLDS.review, 1200);
  assert.equal(LINE_THRESHOLDS.split, 2000);
});

test("the checked-in baseline has the expected first-party denominator and direct counts", () => {
  const metrics = collectPhase5Metrics();
  assert.equal(metrics.schema, "phase5-metrics-v1");
  assert.match(metrics.gitSha, /^[0-9a-f]{40}$/);
  assert.equal(metrics.firstParty.files, 44);
  assert.equal(metrics.firstParty.physicalLines, 27529);
  assert.equal(metrics.firstParty.activeConsole, 413);
  assert.equal(metrics.firstParty.commentedConsole, 80);
  assert.deepEqual(metrics.over2000, [
    { file: "scripts/combat/CombatSettingsSD.mjs", physicalLines: 2284 },
    { file: "scripts/combat/WeaponBonusConfig.mjs", physicalLines: 2461 },
  ]);
});
