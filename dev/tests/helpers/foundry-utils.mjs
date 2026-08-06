// Faithful stand-ins for the `foundry.utils` helpers the test harnesses need.
//
// These lived twice, implemented differently and wrongly in both places:
// `persistence-harness.mjs` and `pixi-harness.mjs` each carried a shallow
// `mergeObject` and a JSON-round-trip `deepClone`. A harness whose whole
// contract is faithfulness cannot afford a divergence its tests then assert
// against — see issues #91 and #92. One implementation, shared, so the next
// divergence has nowhere to hide.
//
// Faithful for the options this repository actually passes. Where Foundry v14
// has machinery this harness deliberately does not carry (operator
// serialisation, the ForcedReplacement inspection Proxy), it is documented as
// a scoped stand-in rather than silently diverging.

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
 * The value slot of a data-field operator, mirroring Foundry's private
 * `OPERATOR_VALUE` symbol. Keeping it symbol-keyed makes an operator instance
 * read as a class instance to `deepClone` and `getType`, never as plain data.
 */
const OPERATOR_VALUE = Symbol("DataFieldOperatorValue");

/**
 * Base class for Foundry's special database operators, used by
 * `applyOperators`. The merge logic recognises instances by `instanceof`, and
 * nothing else in the harness may treat them as plain objects.
 */
class DataFieldOperator {
	constructor(value) {
		this[OPERATOR_VALUE] = value;
	}

	/** The wrapped value of an operator, or the value itself when not one. */
	static get(value) {
		return value instanceof DataFieldOperator ? value[OPERATOR_VALUE] : value;
	}
}

/** Force the deletion of a field during a merge with `applyOperators`. */
export class ForcedDeletion extends DataFieldOperator {
	constructor() {
		super(undefined);
	}
}

/**
 * Force the replacement of a field without inner recursion. Foundry wraps the
 * instance in a Proxy so user code can inspect it; the merge only needs
 * `instanceof` and `get`, so the harness omits the Proxy — the merge OUTPUT is
 * identical either way.
 */
export class ForcedReplacement extends DataFieldOperator {
	static create(value) {
		return new ForcedReplacement(value);
	}
}

/** Whether a key uses the deprecated `-=key` / `==key` operator syntax. */
function isDeletionKey(key) {
	return typeof key === "string" && key[1] === "=" && (key[0] === "=" || key[0] === "-");
}

/** Migrate a legacy `-=key` / `==key` key-value pair to its operator form. */
function migrateDeletionKey(key, value) {
	const name = key.slice(2);
	let operator;
	if (key[0] === "-") {
		if (value !== null) {
			throw new Error("Removing a key using the deprecated -= deletion syntax requires the value "
				+ "of that deletion key to be null, for example {-=key: null}");
		}
		operator = new ForcedDeletion();
	}
	else {
		operator = ForcedReplacement.create(value);
	}
	return { key: name, value: operator };
}

/**
 * Classify a value the way Foundry's `getType` does: primitives by `typeof`,
 * plain objects as "Object", arrays as "Array", known container prototypes by
 * name, and every other class instance as "Unknown". "Unknown" is what lets a
 * class instance participate in a recursive merge like an object while still
 * being distinct from a plain object for `enforceTypes`.
 */
function getType(variable) {
	const typeOf = typeof variable;
	if (typeOf !== "object") return typeOf;
	if (variable === null) return "null";
	if (isPlainObject(variable)) return "Object";
	if (Array.isArray(variable)) return "Array";
	// Match Foundry's typePrototypes exactly (foundry.mjs:2298-2304): Set,
	// Map, Promise, Error. Date is deliberately NOT classified — like other
	// class instances it falls through to "Unknown", which is what lets a
	// recursive merge into an existing Date proceed (Foundry recurses into
	// it and retains the Date, rather than replacing it with a plain object).
	if (variable instanceof Set) return "Set";
	if (variable instanceof Map) return "Map";
	return "Unknown";
}

/**
 * Recurse through a value applying every data-field operator: `ForcedDeletion`
 * values drop their key, `ForcedReplacement` values unwrap to their payload,
 * and legacy `-=key` / `==key` keys are migrated first.
 */
function applyDataOperators(obj) {
	if (Array.isArray(obj)) return obj.map(applyDataOperators);
	if (obj instanceof ForcedReplacement) return ForcedReplacement.get(obj);
	if (!isPlainObject(obj)) return obj;

	const clone = {};
	for (const [key0, raw] of Object.entries(obj)) {
		let key = key0;
		let value = raw;
		if (isDeletionKey(key)) {
			const migrated = migrateDeletionKey(key, value);
			key = migrated.key;
			value = migrated.value;
		}
		if (value instanceof ForcedDeletion) continue;
		if (value instanceof ForcedReplacement) value = ForcedReplacement.get(value);
		clone[key] = applyDataOperators(value);
	}
	return clone;
}

/**
 * Stand-in for `foundry.utils.mergeObject`, faithful to the installed Foundry
 * v14 (foundry.mjs, `mergeObject`).
 *
 * The behaviours that matter for this repo:
 *   - RECURSIVE merge — `pin-manager.update` merges the output of
 *     `expandObject`, which is nested by construction, so a shallow merge
 *     would replace a whole `flags.<scope>` object and drop every sibling key.
 *   - `inplace: true` by default, mutating and returning `original`;
 *     `applySceneLevelData` passes `{ inplace: false }` precisely because it
 *     needs the other behaviour.
 *   - Depth-0 expansion — dotted keys in `other` are ALWAYS expanded to nested
 *     structure before merging, and `original` is expanded too when it carries
 *     any. There is no `expand` option; expansion is unconditional, exactly as
 *     in Foundry v14.
 *   - `insertKeys` vs `insertValues` — `insertKeys` governs whole new keys at
 *     the current level; `insertValues` governs new keys inside an
 *     already-present nested object. Foundry swaps one in for the other as it
 *     recurses, which is how insertion can be disabled at one depth without
 *     blocking it deeper.
 *   - `enforceTypes` throws on a mismatched-type overwrite; `applyOperators`
 *     (and its deprecated alias `performDeletions`) apply `ForcedDeletion` /
 *     `ForcedReplacement` operators and the legacy `-=key` / `==key` syntax.
 *
 * Options Foundry does not know are ignored, as Foundry ignores them. The
 * operator classes carry the same names but are plain (no serialisation or
 * inspection Proxy surface) — a documented scoped stand-in, since the merge
 * OUTPUT is what the harness contract is about.
 */
export function mergeObject(original, other = {}, options = {}, _d = 0) {
	const {
		insertKeys = true, insertValues = true, overwrite = true, recursive = true,
		inplace = true, enforceTypes = false, applyOperators = false, performDeletions = false,
	} = options;

	if (!(original instanceof Object) || !(other instanceof Object)) {
		throw new Error("One of original or other are not Objects!");
	}

	// performDeletions is the deprecated v14 name for applyOperators.
	const opts = {
		insertKeys, insertValues, overwrite, recursive, inplace, enforceTypes,
		applyOperators: applyOperators || performDeletions,
	};

	// Depth 0 — dotted keys are expanded on BOTH sides before merging. A merge
	// must not leave a literal "a.b" sibling of the nested "a" it is about to
	// write, and a literal dotted key in `original` is expanded so the nested
	// merge actually meets it.
	if (_d === 0) {
		if (Object.keys(other).some(key => key.includes("."))) other = expandObject(other);
		if (Object.keys(original).some(key => key.includes("."))) {
			const expanded = expandObject(original);
			if (inplace) {
				Object.keys(original).forEach(key => delete original[key]);
				Object.assign(original, expanded);
			}
			else original = expanded;
		}
		else if (!inplace) original = deepClone(original);
	}

	for (const entry of Object.entries(other)) {
		let [key, value] = entry;
		if (isDeletionKey(key)) {
			const migrated = migrateDeletionKey(key, value);
			key = migrated.key;
			value = migrated.value;
		}
		if (Object.prototype.hasOwnProperty.call(original, key)) mergeUpdate(original, key, value, _d + 1, opts);
		else mergeInsert(original, key, value, _d + 1, opts);
	}
	return original;
}

/** Insert a key that does not exist in the target. `insertValues` takes over
 * below depth 1, which is how `insertKeys: false` does not leak into nested
 * objects. */
function mergeInsert(original, key, value, depth, options) {
	const canInsert = ((depth <= 1) && options.insertKeys) || ((depth > 1) && options.insertValues);
	if (!canInsert || (value instanceof ForcedDeletion)) return;
	if (value instanceof ForcedReplacement) {
		original[key] = options.applyOperators ? applyDataOperators(ForcedReplacement.get(value)) : value;
		return;
	}
	original[key] = options.applyOperators ? applyDataOperators(value) : deepClone(value);
}

/** Update a key that already exists in the target, recursing when both sides
 * are object-like. */
function mergeUpdate(original, key, value, depth, options) {
	const existing = original[key];
	const valueType = getType(value);
	const existingType = getType(existing);
	const valueObjectLike = (valueType === "Object") || (valueType === "Unknown");
	const existingObjectLike = (existingType === "Object") || (existingType === "Unknown");

	if (value instanceof ForcedDeletion) {
		if (options.overwrite === false) return;
		if (options.applyOperators) delete original[key];
		else original[key] = value;
		return;
	}
	if (value instanceof ForcedReplacement) {
		if (options.overwrite === false) return;
		original[key] = options.applyOperators ? applyDataOperators(ForcedReplacement.get(value)) : value;
		return;
	}
	if (valueObjectLike && existingObjectLike && options.recursive) {
		return mergeObject(existing, value, { ...options, inplace: true }, depth);
	}
	if (options.overwrite) {
		if ((existingType !== "undefined") && (valueType !== existingType) && options.enforceTypes) {
			throw new Error("Mismatched data types encountered during object merge.");
		}
		original[key] = options.applyOperators ? applyDataOperators(value) : deepClone(value);
	}
}

/** Dot-path read. Matches Foundry's own semantics, including numeric segments. */
export function getProperty(object, key) {
	return String(key).split(".").reduce((cursor, segment) => cursor?.[segment], object);
}
