import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { escapeHTML } from "./helpers/escape-html.mjs";

/** Every .mjs under a directory, recursively. */
function sourceFiles(dirUrl) {
	const out = [];
	for (const entry of readdirSync(dirUrl, { withFileTypes: true })) {
		const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dirUrl);
		if (entry.isDirectory()) out.push(...sourceFiles(child));
		else if (entry.name.endsWith(".mjs")) out.push(child);
	}
	return out;
}

// `ChatMessage#author` resolves the stored author id against `game.users` and
// returns null when that id no longer names anyone. Deleting a player from a
// world leaves their chat messages behind, so this is ordinary state in a
// long-running game, not a corrupt document.
//
// Reported from a live game as a repeating console error:
//   damage-card-pipeline.mjs:31 Uncaught (in promise)
//   TypeError: Cannot read properties of null (reading 'id')
//
// It repeated because every render of an affected message threw, and it was
// "uncaught" because the hook wrapped this async call in a synchronous
// try/catch — see the companion assertion at the bottom.

globalThis.window = globalThis;
globalThis.foundry = {
	applications: {
		api: {
			ApplicationV2: class {},
			HandlebarsApplicationMixin: (base) => base,
		},
	},
	utils: {
		randomID: () => "id",
		Collection: class extends Map {},
		escapeHTML,
		mergeObject: (a, b) => ({ ...a, ...b }),
	},
};
globalThis.game = {
	settings: { get: () => undefined, register: () => {} },
	i18n: { localize: (key) => key },
	user: { id: "user-me", isGM: false },
	users: new Map(),
};
globalThis.Roll = {
	safeEval: (expr) => {
		// eslint-disable-next-line no-new-func -- scoped test evaluator mirroring the runtime sandbox
		return new Function(`return (${expr})`)();
	},
};
// The pipeline re-wraps a raw v14 element with jQuery. Node has no DOM, so give
// it an HTMLElement that nothing matches — the stub html below is already the
// jQuery-shaped object the rest of the function expects.
globalThis.HTMLElement = class {};

const { injectDamageCard } = await import("../../scripts/combat/damage-card-pipeline.mjs");

/**
 * An html stand-in that reports the message as being torn down, so the pipeline
 * returns at its first guard. That guard sits immediately after the authorship
 * line, which is the line under test — everything past it needs a live Foundry.
 */
function closingHtml() {
	return {
		hasClass: (className) => className === "deleting",
		find: () => ({ length: 0 }),
	};
}

test("a message whose author no longer exists does not throw", async () => {
	// The exact shape Foundry hands over for a message authored by a deleted user.
	await injectDamageCard({ id: "msg-orphaned", author: null }, closingHtml(), {});
});

test("an undefined author does not throw either", async () => {
	await injectDamageCard({ id: "msg-undefined-author", author: undefined }, closingHtml(), {});
});

test("a resolvable author is still handled", async () => {
	// Positive control: the null guard must not have broken the ordinary path.
	await injectDamageCard({ id: "msg-mine", author: { id: "user-me" } }, closingHtml(), {});
	await injectDamageCard({ id: "msg-theirs", author: { id: "user-someone-else" } }, closingHtml(), {});
});

test("no module reads message.author without a null guard", () => {
	// Guards the fix itself. The behavioral tests above only prove the pipeline
	// returns for one early-exit path; they cannot see the four later derefs that
	// the same message would have reached, and this assertion is how those were
	// found in the first place — the crash at the top masked every one below it.
	//
	// Scoped to the whole tree rather than one file, because the sweep turned up
	// a fifth site in damage-card-targeting.mjs. `message.author` is null for any
	// message whose author has been deleted, everywhere, not just here.
	const offenders = [];
	for (const file of sourceFiles(new URL("../../scripts/", import.meta.url))) {
		const source = readFileSync(file, "utf8");
		source.split("\n").forEach((line, index) => {
			// Skip comments — several explain the guard and legitimately name the
			// unguarded form.
			if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
			if (/\.author\.(id|name)\b/.test(line)) {
				offenders.push(`${file.pathname.split("/scripts/")[1]}:${index + 1}`);
			}
		});
	}
	assert.deepEqual(offenders, [], `message.author dereferenced without a null guard:\n  ${offenders.join("\n  ")}`);
});

test("the damage-card hook attaches its handler to the promise", () => {
	// `injectDamageCard` is async. A synchronous try/catch around the call cannot
	// observe a rejection, which is precisely why the null-author TypeError
	// reached the console as "Uncaught (in promise)" instead of the module's own
	// error line. The neighbouring `processWeaponBonuses` call already had this
	// right; this one did not.
	const source = readFileSync(new URL("../../scripts/combat/chat-card-hooks.mjs", import.meta.url), "utf8");
	const call = source.slice(source.indexOf("injectDamageCard(message"));
	assert.match(
		call.slice(0, 200),
		/injectDamageCard\(message, html, context\)\s*\.catch\(/,
		"injectDamageCard's rejection must be handled on the promise, not by a surrounding try/catch");
});
