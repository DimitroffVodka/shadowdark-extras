import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  extractReleaseNotes,
  WIKI_URL,
} from "../extract-release-notes.mjs";

test("extracts only the requested version and appends the Wiki link", () => {
  const changelog = `# Changelog

## [Unreleased]

- Work in progress.

## [12.34.56] — Example release

### Fixed

- The requested fix.

## [12.34.55] — Previous release

- An older fix.
`;

  const notes = extractReleaseNotes(changelog, "v12.34.56");

  assert.match(notes, /^## \[12\.34\.56\] — Example release/);
  assert.match(notes, /The requested fix\./);
  assert.doesNotMatch(notes, /Previous release|An older fix/);
  assert.match(notes, new RegExp(`\\[Read the Shadowdark Extras Wiki\\]\\(${WIKI_URL}\\)`));
});

test("rejects a missing or empty changelog section", () => {
  assert.throws(
    () => extractReleaseNotes("## [1.0.0]\n\n- Present.\n", "v2.0.0"),
    /no section for \[2\.0\.0\]/,
  );
  assert.throws(
    () => extractReleaseNotes("## [2.0.0]\n\n## [1.0.0]\n\n- Present.\n", "2.0.0"),
    /section \[2\.0\.0\] is empty/,
  );
});

test("the current release has non-empty publishable notes", async () => {
  const changelog = await readFile(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
  const notes = extractReleaseNotes(changelog, "v6.10.50");

  assert.match(notes, /Automated camping/);
  assert.match(notes, /SDX group rolls/);
  assert.match(notes, /Read the Shadowdark Extras Wiki/);
  assert.ok(notes.length > 1_000);
});
