import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const moduleRoot = new URL("../../", import.meta.url);

const conditions = readFileSync(
	new URL("../../scripts/character-sheet/conditions.mjs", import.meta.url),
	"utf8"
);
const root = readFileSync(new URL("../../scripts/shadowdark-extras.mjs", import.meta.url), "utf8");

test("the three vestigial condition hooks are gone from conditions.mjs", () => {
	for (const name of [
		"registerConditionEffectHooks",
		"updateConditionToggles",
	]) {
		assert.ok(!conditions.includes(name), `${name} removed`);
	}
	// The hooks registered these three events; no registration may remain
	// in this module (other modules legitimately register the same events).
	for (const event of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"]) {
		assert.ok(
			!conditions.includes(`Hooks.on("${event}")`) &&
				!conditions.includes(`Hooks.on('${event}')`),
			`no ${event} registration remains in conditions.mjs`
		);
	}
});

test("the composition root no longer imports or calls the hooks", () => {
	assert.ok(!root.includes("registerConditionEffectHooks"));
});

test("the conditions API surface is unchanged (three exports)", () => {
	// The modal + sheet injection features still ship; only the dead hooks
	// went away.
	for (const name of ["getConditionsData", "injectConditionsToggles", "showConditionsModal"]) {
		assert.ok(
			conditions.includes(`export ${name === "injectConditionsToggles" ? "async " : ""}function ${name}`) ||
				conditions.includes(`export function ${name}`) ||
				conditions.includes(`export async function ${name}`),
			`${name} still exported`
		);
	}
	assert.ok(!conditions.includes("export function registerConditionEffectHooks"));
});

test("the modal self-update path is intact (the hooks were its replacement)", () => {
	// The measured evidence for deleting the hooks: the modal re-reads the
	// actor's condition items after a toggle click.
	assert.ok(conditions.includes("refreshModalConditionOrder"));
	assert.ok(conditions.includes('$toggle.addClass("active")'));
	assert.ok(conditions.includes('$toggle.removeClass("active")'));
});
