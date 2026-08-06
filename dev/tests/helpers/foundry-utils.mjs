// Faithful stand-ins for the `foundry.utils` helpers the test harnesses need.
//
// These lived twice, implemented differently and wrongly in both places:
// `persistence-harness.mjs` and `pixi-harness.mjs` each carried a shallow
// `mergeObject` and a JSON-round-trip `deepClone`. A harness whose whole
// contract is faithfulness cannot afford a divergence its tests then assert
// against — see issues #91 and #92. One implementation, shared, so the next
// divergence has nowhere to hide.
//
// Faithful for the options this repository actually passes, and LOUD about the
// rest: an unimplemented option throws rather than being silently ignored.

/** Plain objects and arrays are traversed; everything else is a leaf. */
export function isPlainContainer(value) {
	if (Array.isArray(value)) return true;
	if (!value || typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

const isPlainObject = value => isPlainContainer(value) && !Array.isArray(value);

/**
 * Stand-in for `foundry.utils.deepClone`.
 *
 * A JSON round-trip was the obvious shortcut and the wrong one: it silently
 * drops `undefined` values, turns a Date into a string, and throws on a cycle.
 *
 * Dates, Sets and Maps are cloned because real documents carry them. Anything
 * else with a prototype — a class instance, a Foundry Document — is returned by
 * reference, which is what Foundry's own non-strict clone does.
 */
export function deepClone(value) {
	if (value === null || typeof value !== "object") return value;
	if (value instanceof Date) return new Date(value.getTime());
	if (value instanceof Set) return new Set([...value].map(deepClone));
	if (value instanceof Map) return new Map([...value].map(([k, v]) => [k, deepClone(v)]));
	if (Array.isArray(value)) return value.map(deepClone);
	if (!isPlainContainer(value)) return value;

	const out = {};
	for (const [key, item] of Object.entries(value)) out[key] = deepClone(item);
	return out;
}

/**
 * Stand-in for `foundry.utils.expandObject` — turn flattened dotted keys into
 * nested structure: `{"flags.scope.key": 1}` becomes `{flags: {scope: {key: 1}}}`.
 *
 * Its absence is what made `JournalPinManager.update` untestable: the function
 * calls it before merging, so any test reaching that path threw
 * "expandObject is not a function" (issue #92).
 */
export function expandObject(source) {
	const expanded = {};

	for (const [key, value] of Object.entries(source ?? {})) {
		const path = key.split(".");
		let cursor = expanded;

		for (const segment of path.slice(0, -1)) {
			if (!isPlainObject(cursor[segment])) cursor[segment] = {};
			cursor = cursor[segment];
		}

		cursor[path.at(-1)] = isPlainObject(value) ? expandObject(value) : deepClone(value);
	}

	return expanded;
}

/**
 * Expand the dotted keys of a merge source, preserving literal keys.
 *
 * Foundry's `mergeObject` expands a dotted key (`"flags.scope.key"`) into
 * nested structure while merging, but only when the dotted key is not already
 * present as a literal key in the target — a literal `"a.b"` must be merged
 * as itself, not split apart. Non-dotted keys are cloned as written, matching
 * the harness `expandObject`'s recursive expansion for the expanded subtree.
 */
function expandMergeSource(original, other) {
	const source = {};

	for (const [key, value] of Object.entries(other)) {
		if (key.includes(".") && !Object.prototype.hasOwnProperty.call(original, key)) {
			const path = key.split(".");
			let cursor = source;
			for (const segment of path.slice(0, -1)) {
				if (!isPlainObject(cursor[segment])) cursor[segment] = {};
				cursor = cursor[segment];
			}
			cursor[path.at(-1)] = isPlainObject(value) ? expandObject(value) : deepClone(value);
		}
		else {
			source[key] = deepClone(value);
		}
	}

	return source;
}

/**
 * Stand-in for `foundry.utils.mergeObject`.
 *
 * Two divergences from a naive `Object.assign` matter enough to implement.
 * The real merge is RECURSIVE — `pin-manager.update` merges the output of
 * `expandObject`, which is nested by construction, so a shallow merge would
 * replace a whole `flags.<scope>` object and drop every sibling key. And it
 * defaults to `inplace: true`, mutating and returning `original`;
 * `applySceneLevelData` passes `{ inplace: false }` precisely because it needs
 * the other behaviour, so a stub that always copied made that call site look
 * correct however it was written.
 *
 * Three options mirror Foundry's semantics (issue #95 finding 5):
 *   - `expand` — dotted keys in `other` are expanded to nested structure
 *     before merging, unless the dotted key is already a literal key of
 *     `original`.
 *   - `insertKeys` — whether whole new keys are inserted AT THIS LEVEL.
 *   - `insertValues` — whether new keys are inserted INTO an already-present
 *     nested object. Foundry swaps this in for `insertKeys` when it recurses,
 *     which is how one controls insertion at depth without blocking it deeper.
 *
 * Unimplemented options throw. A silently ignored option is how a test comes to
 * assert against behaviour the real function does not have.
 */
export function mergeObject(original, other = {}, options = {}) {
	const {
		inplace = true, insertKeys = true, insertValues = true, overwrite = true,
		recursive = true, expand = true, ...rest
	} = options;

	const unsupported = Object.keys(rest);
	if (unsupported.length > 0) {
		throw new Error(
			`test-harness mergeObject does not implement ${unsupported.join(", ")} — `
			+ "implement it faithfully before relying on it in a test",
		);
	}

	const target = inplace ? original : deepClone(original);
	const source = expand ? expandMergeSource(target, other) : other;

	for (const [key, value] of Object.entries(source)) {
		if (!Object.prototype.hasOwnProperty.call(target, key)) {
			if (insertKeys) target[key] = deepClone(value);
			continue;
		}
		if (recursive && isPlainObject(target[key]) && isPlainObject(value)) {
			mergeObject(target[key], value, {
				inplace: true,
				insertKeys: insertValues,
				insertValues,
				overwrite,
				recursive,
				expand: false,
			});
			continue;
		}
		if (overwrite) target[key] = deepClone(value);
	}

	return target;
}

/** Dot-path read. Matches Foundry's own semantics, including numeric segments. */
export function getProperty(object, key) {
	return String(key).split(".").reduce((cursor, segment) => cursor?.[segment], object);
}
