import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const moduleRoot = new URL("../../", import.meta.url);

test("frozen compendium index system data is replaced with a mergeable clone", async () => {
	// Literal relative specifier, never a constructed `new URL(...)`: the
	// structural track's import resolver can only follow literal paths, and this
	// file is Phase 1 step 11's move target. The old existsSync guard was removed
	// for the same reason — it was a second, ungated reference to the same path.
	// The resolver now blocks such a move before this test can even run.
	const { ensureMutableItemCompendiumIndexes } = await import("../../scripts/CompendiumIndexSD.mjs");
	const frozenSystem = Object.freeze({
		baseWeapon: "",
		magicItem: false,
	});
	const entry = {
		_id: "weapon-id",
		name: "Longsword",
		system: frozenSystem,
	};
	const pack = {
		metadata: { type: "Item" },
		index: new Map([[entry._id, entry]]),
	};

	const replacements = ensureMutableItemCompendiumIndexes([pack], structuredClone);
	const repaired = pack.index.get(entry._id);

	assert.equal(replacements, 1);
	assert.notEqual(repaired, entry);
	assert.notEqual(repaired.system, frozenSystem);
	assert.ok(Object.isExtensible(repaired.system));
	assert.deepEqual(repaired.system, frozenSystem);
	assert.equal(repaired.name, "Longsword");
});

test("SDX Roller buttons expose their ApplicationV2 actions", () => {
	const template = readFileSync(
		new URL("templates/sdx-roller.hbs", moduleRoot),
		"utf8"
	);

	assert.match(
		template,
		/class="sdx-roller-remove-participant"[^>]*data-action="remove-participant"/
	);
	assert.match(
		template,
		/class="sdx-roller-btn-roll"[^>]*data-action="roll"/
	);
	assert.match(
		template,
		/class="sdx-roller-btn-cancel"[^>]*data-action="cancel"/
	);
});
