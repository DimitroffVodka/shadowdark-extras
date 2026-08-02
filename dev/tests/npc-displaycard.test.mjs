import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const moduleRoot = new URL("../../", import.meta.url);
const scriptsDir = new URL("../../scripts/", import.meta.url);

/** Recursively list .mjs files under a directory. */
function listMjsFiles(dirUrl) {
	const results = [];
	for (const entry of readdirSync(dirUrl)) {
		const childPath = join(dirUrl.pathname, entry);
		if (statSync(childPath).isDirectory()) {
			results.push(...listMjsFiles(new URL(entry + "/", dirUrl)));
		}
		else if (entry.endsWith(".mjs")) {
			results.push(new URL(entry, dirUrl));
		}
	}
	return results;
}

test("no item.displayCard call remains anywhere in scripts/", () => {
	// Comments may explain the retirement; CALLS (`.displayCard(`) must not.
	const offenders = [];
	for (const fileUrl of listMjsFiles(scriptsDir)) {
		const source = readFileSync(fileUrl, "utf8");
		if (/\.displayCard\s*\(/.test(source)) {
			offenders.push(fileUrl.pathname);
		}
	}
	assert.deepEqual(offenders, [], "displayCard is a 3.x method that SD 4.x removed");
});

test("every showItemCard call site is guarded by try/catch (loud failure)", () => {
	// The KNOWN-ISSUES write-up demands the replacement be awaited inside a
	// try/catch so the next system change is loud instead of silent.
	const expected = {
		"scripts/inventory/containers.mjs": 1,
		"scripts/canvas/TokenToolbarApp.mjs": 3,
		"scripts/macros/shapechanger.mjs": 3,
		"scripts/party/partyinventory.mjs": 1,
	};
	let total = 0;
	for (const [file, expectedCount] of Object.entries(expected)) {
		const source = readFileSync(new URL(file, moduleRoot), "utf8");
		const callCount = (source.match(/shadowdark\.chat\.showItemCard\(/g) || []).length;
		assert.equal(callCount, expectedCount, `${file} call count`);
		assert.ok(source.includes("showItemCard failed"), `${file} must catch showItemCard errors`);
		total += callCount;
	}
	assert.equal(total, 8, "one card entry point, used at every former displayCard site");
});

test("roll-fallback card sites are else-guarded (no duplicate card after a successful roll)", () => {
	// Reviewer-caught Major: an unconditional showItemCard block after the
	// rollAttack chain posted a duplicate card after every successful normal
	// NPC attack. Every roll-fallback card must sit in an `else`; the
	// special-attack branches (inside `if (attackType === "special")` with an
	// early return) are the exception.
	const expected = {
		"scripts/canvas/TokenToolbarApp.mjs": { markers: 2, elseGuarded: 1 },
		"scripts/macros/shapechanger.mjs": { markers: 3, elseGuarded: 2 },
	};
	for (const [file, { markers, elseGuarded }] of Object.entries(expected)) {
		const source = readFileSync(new URL(file, moduleRoot), "utf8");
		const markerCount = (source.match(/use ChatSD\.showItemCard\./g) || []).length;
		const guardedCount =
			(source.match(/else \{\n(?:\s*\/\/[^\n]*\n){0,2}\s*\/\/ SD 4\.x removed item\.displayCard/g) || []).length;
		assert.equal(markerCount, markers, `${file} marker count`);
		assert.equal(guardedCount, elseGuarded, `${file}: fallback cards are else-guarded`);
	}
});

test("the 4.x chat card entry point is the documented one", () => {
	// PlayerSheetSD._onItemChatClick uses shadowdark.chat.showItemCard(uuid);
	// the module must reference the same entry point, not a custom one.
	for (const file of [
		"scripts/inventory/containers.mjs",
		"scripts/canvas/TokenToolbarApp.mjs",
		"scripts/macros/shapechanger.mjs",
		"scripts/party/partyinventory.mjs",
	]) {
		const source = readFileSync(new URL(file, moduleRoot), "utf8");
		assert.ok(
			!source.includes("showItemCard(") || source.includes("shadowdark.chat.showItemCard("),
			`${file} uses the system entry point`
		);
	}
});
