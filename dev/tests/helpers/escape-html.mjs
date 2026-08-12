/**
 * The escapeHTML stub every harness should use.
 *
 * WHY THIS EXISTS AS ONE THING. Nine harnesses had stubbed it independently as
 * `value => String(value)` — an IDENTITY function. That makes any assertion
 * about escaped output vacuous: a test asserting "the payload renders inert"
 * passes whether or not the code under test escapes anything. Three separate
 * runs during the #125 work also discovered a harness that had no stub at all,
 * each time as a wall of `foundry.utils.escapeHTML is not a function` in tests
 * unrelated to the change.
 *
 * Both failures come from the same cause: the stub was a local detail in ten
 * files rather than a shared decision. This mirrors Foundry's real behaviour so
 * the assertions mean something, and lives in one place so the next harness can
 * import it instead of inventing an eleventh version.
 */
export function escapeHTML(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;");
}
