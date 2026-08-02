import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { DEFAULT_SCENE_BACKGROUND } from "../../scripts/tom/tom-defaults.mjs";

// The TomStore import graph (TomStore -> TomSocketHandler -> TomPlayerView)
// touches foundry.applications.api and foundry.utils at load time.
globalThis.foundry = {
	applications: {
		api: {
			ApplicationV2: class {},
			HandlebarsApplicationMixin: (base) => base,
		},
	},
	utils: { randomID: () => "test-id", Collection: class extends Map {} },
};

const moduleRoot = new URL("../../", import.meta.url);

/** "modules/shadowdark-extras/assets/x" -> <repo>/assets/x */
function assetPathFor(modulePath) {
	const relative = modulePath.replace(/^modules\/shadowdark-extras\//, "");
	return new URL(relative, moduleRoot);
}

test("the default scene background constant points at a shipped asset", () => {
	assert.equal(
		DEFAULT_SCENE_BACKGROUND,
		"modules/shadowdark-extras/assets/default-scene.jpg",
		"the shipped path is the canonical default"
	);
	const file = assetPathFor(DEFAULT_SCENE_BACKGROUND);
	assert.ok(existsSync(file), `missing shipped asset: ${file.pathname}`);
});

test("the default background is a well-formed relative module path", () => {
	assert.ok(DEFAULT_SCENE_BACKGROUND.startsWith("modules/"));
	assert.ok(!DEFAULT_SCENE_BACKGROUND.startsWith("/"));
	assert.ok(!DEFAULT_SCENE_BACKGROUND.includes(".."));
	assert.match(DEFAULT_SCENE_BACKGROUND, /\.(jpg|jpeg|png|webp)$/);
});

test("the default background lives in one place: no divergent literals anywhere", () => {
	for (const file of ["scripts/tom/TomSceneModel.mjs", "scripts/tom/TomStore.mjs"]) {
		const source = readFileSync(new URL(file, moduleRoot), "utf8");
		assert.ok(
			!source.includes('"modules/shadowdark-extras/assets/default-scene.jpg"'),
			`${file} must not hardcode the path literal`
		);
	}
	// The exported model owns the default; TomStore no longer carries its own
	// copy at all (it imports the shared model).
	const sceneSource = readFileSync(
		new URL("scripts/tom/TomSceneModel.mjs", moduleRoot),
		"utf8"
	);
	assert.ok(sceneSource.includes("DEFAULT_SCENE_BACKGROUND"));
});

test("TomStore no longer carries a private duplicate model", () => {
	const source = readFileSync(new URL("scripts/tom/TomStore.mjs", moduleRoot), "utf8");
	assert.ok(!/\bclass TomSceneModel\b/.test(source), "private duplicate class removed");
	assert.ok(
		source.includes('import { TomSceneModel } from "./TomSceneModel.mjs"'),
		"shared model imported"
	);
});

test("runtime: both entry points default to the shipped asset", async () => {
	const { TomSceneModel } = await import("../../scripts/tom/TomSceneModel.mjs");
	const { TomStore } = await import("../../scripts/tom/TomStore.mjs");

	assert.equal(new TomSceneModel({}).background, DEFAULT_SCENE_BACKGROUND);
	assert.equal(new TomSceneModel({ background: "custom.jpg" }).background, "custom.jpg");
	assert.equal((await TomStore.createScene({})).background, DEFAULT_SCENE_BACKGROUND);
	assert.equal((await TomStore.createScene({ background: "custom.jpg" })).background, "custom.jpg");
});
