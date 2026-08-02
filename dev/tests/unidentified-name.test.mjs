import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Phase 5.2.9 regression (issue #50) — the unidentified-name helpers are
// consolidated: ONE implementation in shared/sd4Compat.mjs, re-exported by
// macros/identify.mjs (the module.api publisher). The winner is the richer
// copy: SD 4.x native identification when the schema is present, else the
// legacy SDX flags on 3.x-shaped documents, else the i18n label. The old
// sd4Compat copy (`item?.name ?? ""` unconditionally) revealed the real
// name on legacy worlds.

const MODULE_ID = "shadowdark-extras";

globalThis.game = {
	i18n: {
		localize: (key) => `[[${key}]]`,
	},
};

const sd4Compat = await import("../../scripts/shared/sd4Compat.mjs");
const identify = await import("../../scripts/macros/identify.mjs");
const partyUnidentified = await import("../../scripts/party/party-unidentified.mjs");

/** Model a Foundry ItemDocument with a sync getFlag over a flags map. */
function makeItem({ name, identification, isIdentified, flags = {} }) {
	const item = { name, system: {} };
	if (identification !== undefined) {
		item.system.identification = identification;
		item.system.isIdentified = isIdentified;
	}
	return {
		...item,
		flags,
		getFlag(scope, key) {
			return this.flags?.[scope]?.[key];
		},
	};
}

// ------------------------------------------------------------------ tests

test("one implementation exists (identify.mjs re-exports; no duplicate bodies)", () => {
	const identifySrc = readFileSync(new URL("../../scripts/macros/identify.mjs", import.meta.url), "utf8");
	const compatSrc = readFileSync(new URL("../../scripts/shared/sd4Compat.mjs", import.meta.url), "utf8");
	assert.ok(
		!identifySrc.includes("export function isUnidentified("),
		"identify.mjs must not define isUnidentified"
	);
	assert.ok(
		!identifySrc.includes("export function getUnidentifiedName("),
		"identify.mjs must not define getUnidentifiedName"
	);
	assert.ok(
		identifySrc.includes('import { isUnidentified, getUnidentifiedName } from "../shared/sd4Compat.mjs"'),
		"identify.mjs imports the canonical helpers (local binding for its own call sites)"
	);
	assert.ok(
		identifySrc.includes("export { isUnidentified, getUnidentifiedName };"),
		"identify.mjs re-exports them for the api seam"
	);
	assert.equal(
		(compatSrc.match(/export function getUnidentifiedName\(/g) || []).length,
		1,
		"sd4Compat defines getUnidentifiedName exactly once"
	);
	assert.equal(
		(compatSrc.match(/export function isUnidentified\(/g) || []).length,
		1,
		"sd4Compat defines isUnidentified exactly once"
	);
});

test("the re-export IS the canonical function (identity, not a copy)", () => {
	assert.equal(identify.getUnidentifiedName, sd4Compat.getUnidentifiedName);
	assert.equal(identify.isUnidentified, sd4Compat.isUnidentified);
});

test("SD 4.x shape: masked name is the item's own name", () => {
	const unidentified = makeItem({
		name: "Masked Blade",
		identification: {},
		isIdentified: false,
	});
	assert.equal(identify.getUnidentifiedName(unidentified), "Masked Blade");
	assert.equal(identify.isUnidentified(unidentified), true);

	const identified = makeItem({
		name: "Grimsword",
		identification: {},
		isIdentified: true,
	});
	assert.equal(identify.getUnidentifiedName(identified), "Grimsword");
	assert.equal(identify.isUnidentified(identified), false);
});

test("SD 3.x shape: the legacy unidentifiedName flag wins over item.name", () => {
	// The compat decision: on legacy worlds the masked name lived in the
	// flag; item.name is the REAL name and must not be revealed.
	const legacy = makeItem({
		name: "Sword of the Sun King",
		flags: { [MODULE_ID]: { unidentified: true, unidentifiedName: "Curious Relic" } },
	});
	assert.equal(identify.getUnidentifiedName(legacy), "Curious Relic");
	assert.equal(identify.isUnidentified(legacy), true);
});

test("SD 3.x shape: whitespace-only flag falls back to the i18n label", () => {
	const legacy = makeItem({
		name: "Sword of the Sun King",
		flags: { [MODULE_ID]: { unidentified: true, unidentifiedName: "   " } },
	});
	assert.equal(identify.getUnidentifiedName(legacy), "[[SHADOWDARK_EXTRAS.item.unidentified.label]]");
});

test("SD 3.x shape: no flag at all falls back to the i18n label", () => {
	const legacy = makeItem({ name: "Sword of the Sun King", flags: {} });
	assert.equal(identify.getUnidentifiedName(legacy), "[[SHADOWDARK_EXTRAS.item.unidentified.label]]");
	assert.equal(identify.isUnidentified(legacy), false);
});

test("null/undefined items are safe", () => {
	// The canonical (identify.mjs) behavior for a null item: the legacy
	// path yields the i18n label. Call sites guard item truthiness before
	// calling (e.g. root :950 `item && isUnidentified(item)`), so the
	// corner never displays; this pins the winner's declared behavior.
	assert.equal(identify.getUnidentifiedName(null), "[[SHADOWDARK_EXTRAS.item.unidentified.label]]");
	assert.equal(identify.isUnidentified(null), false);
	assert.equal(identify.getUnidentifiedName(undefined), "[[SHADOWDARK_EXTRAS.item.unidentified.label]]");
	assert.equal(identify.isUnidentified(undefined), false);
});

test("the party helpers are name-mapped re-exports of the canonical (divergence class ended)", () => {
	assert.equal(partyUnidentified.isItemUnidentified, sd4Compat.isUnidentified);
	assert.equal(partyUnidentified.getMaskedItemName, sd4Compat.getUnidentifiedName);
	// behavior through the party names
	const legacy = makeItem({
		name: "Sword of the Sun King",
		flags: { [MODULE_ID]: { unidentified: true, unidentifiedName: "Curious Relic" } },
	});
	assert.equal(partyUnidentified.getMaskedItemName(legacy), "Curious Relic");
	assert.equal(partyUnidentified.isItemUnidentified(legacy), true);
});

test("the data-shaped path mirrors the canonical logic (no 3.x real-name reveal)", () => {
	// 4.x data shape: name is the masked name
	const data4 = { name: "Masked Blade", system: { identification: {}, isIdentified: false } };
	assert.equal(sd4Compat.getUnidentifiedNameFromData(data4), "Masked Blade");

	// 3.x data shape: the flag wins over the real name
	const data3 = {
		name: "Sword of the Sun King",
		system: {},
		flags: { [MODULE_ID]: { unidentifiedName: "Curious Relic" } },
	};
	assert.equal(sd4Compat.getUnidentifiedNameFromData(data3), "Curious Relic");

	// 3.x data shape without the flag: i18n label
	const data3b = { name: "Sword of the Sun King", system: {}, flags: {} };
	assert.equal(sd4Compat.getUnidentifiedNameFromData(data3b), "[[SHADOWDARK_EXTRAS.item.unidentified.label]]");
});
