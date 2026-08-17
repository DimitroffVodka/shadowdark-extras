import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the published manifest advertises Foundry 14 as both minimum and verified", async () => {
	const manifest = JSON.parse(await readFile(new URL("../../module.json", import.meta.url), "utf8"));

	assert.equal(manifest.compatibility.minimum, "14");
	assert.equal(manifest.compatibility.verified, "14");
});
