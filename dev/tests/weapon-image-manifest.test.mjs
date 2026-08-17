import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The weapon picker used to discover its art with `FilePicker.browse`, which
// needs the `FILES_BROWSE` permission. The PLAYER role does not have it by
// default, so every browse was rejected, the scan returned nothing, and the
// dialog reported "No weapon images found in assets/Weapons folder" — a claim
// about the folder for what was really a permission failure. The art now ships
// as a static manifest, which needs no permission to read.
//
// A generated file is only as good as the thing that notices it went stale, so
// these tests are that thing.

const moduleRoot = new URL("../../", import.meta.url);
const manifestUrl = new URL("assets/Weapons/manifest.json", moduleRoot);
const generatorPath = fileURLToPath(new URL("dev/build-weapon-manifest.mjs", moduleRoot));

const RUNTIME_PREFIX = "modules/shadowdark-extras/assets/Weapons/";

function readManifest() {
	return JSON.parse(readFileSync(manifestUrl, "utf8"));
}

test("the bundled weapon manifest exists", () => {
	assert.ok(existsSync(manifestUrl), "assets/Weapons/manifest.json is missing — run `npm run weapon-manifest`");
});

test("the manifest matches the art on disk", () => {
	// The generator's own --check mode is the comparison: it rebuilds from disk
	// and diffs against the committed file, so adding or deleting weapon art
	// without regenerating fails here rather than silently shipping a manifest
	// that points at files which no longer exist.
	execFileSync(process.execPath, [generatorPath, "--check"], { stdio: "pipe" });
});

test("every manifest entry points at a file that is actually shipped", () => {
	const { images } = readManifest();
	assert.ok(images.length > 0, "manifest is empty");

	for (const image of images) {
		assert.ok(image.path.startsWith(RUNTIME_PREFIX), `path escapes the weapons folder: ${image.path}`);
		const onDisk = new URL(image.path.replace("modules/shadowdark-extras/", ""), moduleRoot);
		assert.ok(existsSync(onDisk), `manifest lists a file that does not exist: ${image.path}`);
	}
});

test("manifest entries carry the exact shape the picker groups by", () => {
	// `path`, `name` and `category` are what the browse-based scanner produced.
	// The picker groups on `category` and de-duplicates on `name`, so a change
	// in shape here is a change in what the dialog renders.
	for (const image of readManifest().images) {
		assert.equal(typeof image.path, "string");
		assert.equal(typeof image.name, "string");
		assert.equal(typeof image.category, "string");
		assert.ok(image.name.length > 0, `empty name for ${image.path}`);
		assert.ok(!/\.(webp|png|jpg)$/i.test(image.name), `name still carries an extension: ${image.name}`);
		assert.ok(image.category.length > 0, `empty category for ${image.path}`);
	}
});

test("names are unique, because the picker de-duplicates on them", () => {
	const seen = new Set();
	for (const image of readManifest().images) {
		assert.ok(!seen.has(image.name), `duplicate name would shadow an image: ${image.name}`);
		seen.add(image.name);
	}
});

test("the categories the presets rely on are present", () => {
	// Every bundled sprite preset points into one of these. A category vanishing
	// means the matching preset resolves to art that is no longer selectable.
	const categories = new Set(readManifest().images.map(image => image.category));
	for (const required of ["Daggers", "Crossbows", "Swords/Longswords", "Axes/Greataxes", "Bows", "Shields"]) {
		assert.ok(categories.has(required), `missing category: ${required}`);
	}
});

test("the manifest declares its own count honestly", () => {
	const manifest = readManifest();
	assert.equal(manifest.count, manifest.images.length, "count field disagrees with the images array");
	assert.equal(manifest.base, RUNTIME_PREFIX.replace(/\/$/, ""), "base path drifted from the runtime prefix");
});
