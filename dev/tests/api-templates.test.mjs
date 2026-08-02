import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { REPO_ROOT } from "../tools/project-scan.mjs";

const readScript = (relativePath) => readFileSync(path.join(REPO_ROOT, relativePath), "utf8");

test("template and combat seams contain no confirmed dead-code candidates", () => {
  const templates = readScript("scripts/api/templates.mjs");
  const combatSocket = readScript("scripts/shared/combat-socket.mjs");

  assert.doesNotMatch(templates, /_originalGetRectShape/);
  assert.doesNotMatch(templates, /const bounds = token\.bounds/);
  assert.doesNotMatch(templates, /const onKeyUp =/);
  assert.doesNotMatch(templates, /\/\/console\.log/);
  assert.doesNotMatch(combatSocket, /\/\/ effectData\.name/);
});

test("template and combat seams contain no debug console logging", () => {
  for (const relativePath of [
    "scripts/api/templates.mjs",
    "scripts/api/template-target-sync.mjs",
    "scripts/shared/combat-socket.mjs",
  ]) {
    assert.doesNotMatch(readScript(relativePath), /console\.log/);
  }
});
