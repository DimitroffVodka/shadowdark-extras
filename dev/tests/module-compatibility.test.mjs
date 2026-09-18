import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the manifest requires the stable v14 Active Effect duration fixes", async () => {
	const manifest = JSON.parse(await readFile(new URL("../../module.json", import.meta.url), "utf8"));

	assert.equal(manifest.compatibility.minimum, "14.361");
	assert.equal(manifest.compatibility.verified, "14");
});
