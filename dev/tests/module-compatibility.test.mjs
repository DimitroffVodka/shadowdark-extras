import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the published manifest requires Foundry 14.361 and verifies v14", async () => {
	const manifest = JSON.parse(await readFile(new URL("../../module.json", import.meta.url), "utf8"));

	assert.equal(manifest.compatibility.minimum, "14.361");
	assert.equal(manifest.compatibility.verified, "14");
});
