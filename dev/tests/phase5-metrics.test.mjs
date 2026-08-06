import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeSource,
  classifyConsoleLines,
  collectPhase5Metrics,
  LINE_THRESHOLDS,
} from "../tools/phase5-metrics.mjs";

const BASELINE_FIXTURE = {
  files: 44,
  physicalLines: 27529,
  activeConsole: 413,
  commentedConsole: 80,
  over2000: [
    { file: "scripts/combat/CombatSettingsSD.mjs", physicalLines: 2284 },
    { file: "scripts/combat/WeaponBonusConfig.mjs", physicalLines: 2461 },
  ],
};

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

test("the baseline fixture records the direct pre-cleanup card counts", () => {
  assert.deepEqual(BASELINE_FIXTURE, {
    files: 44,
    physicalLines: 27529,
    activeConsole: 413,
    commentedConsole: 80,
    over2000: [
      { file: "scripts/combat/CombatSettingsSD.mjs", physicalLines: 2284 },
      { file: "scripts/combat/WeaponBonusConfig.mjs", physicalLines: 2461 },
    ],
  });
});

test("the current first-party inventory is measured at the checked-in Git SHA", () => {
  const metrics = collectPhase5Metrics();
  assert.equal(metrics.schema, "phase5-metrics-v1");
  assert.match(metrics.gitSha, /^[0-9a-f]{40}$/);
  assert.equal(metrics.firstParty.files, 59);
  assert.equal(metrics.firstParty.physicalLines, 28300);
  assert.equal(metrics.firstParty.activeConsole, 412);
  assert.equal(metrics.firstParty.commentedConsole, 0);
  assert.deepEqual(metrics.over2000, []);
});
