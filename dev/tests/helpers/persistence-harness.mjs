// Recording harness for the hex/dungeon persistence freeze.
//
// The hex and dungeon roots persist through two channels: document flags
// (`scene.setFlag`, `journal.setFlag`) and world settings (`game.settings.set`).
// Both land in the GM's world database, so a key rename or a change to the
// stored value shape silently orphans data that players already have. Nothing
// in the repository asserted either surface before sweep 6.
//
// This installs the ambient globals those write paths read, and swaps the two
// persistence channels for recorders. A test drives the REAL exported function
// and then asserts the exact `(document, scope, key, value)` that reached the
// database — so a later file split is provable against the payload, not just
// against "it didn't throw".
//
// The globals are deliberately minimal but real enough to import the modules
// under test unmodified. `SDXHexFogSD` in particular reaches
// `JournalPinsSD` → `foundry.canvas.layers.CanvasLayer` at module scope, which
// is why a canvas-layer base class appears in a harness about persistence.

/** Plain objects and arrays are cloned through; everything else is a leaf. */
function isPlainContainer(value) {
	if (Array.isArray(value)) return true;
	if (!value || typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Stand-in for `foundry.utils.deepClone`.
 *
 * A JSON round-trip was the obvious shortcut and the wrong one: it silently
 * drops `undefined` values, turns a Date into a string, and throws on a cycle.
 * A harness whose contract is faithfulness cannot afford divergences its tests
 * would then assert against.
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
 * Stand-in for `foundry.utils.mergeObject`, faithful for the options this
 * repository actually passes and LOUD about the rest.
 *
 * Two divergences from a naive `Object.assign` matter enough to implement:
 * the real merge is recursive, and it defaults to `inplace: true` — it mutates
 * and returns `original`. `applySceneLevelData` passes `{ inplace: false }`
 * precisely because it needs the other behaviour, so a stub that always copied
 * would make that call site look correct no matter which way it was written.
 *
 * Unimplemented options throw rather than being ignored. A silently ignored
 * option is how a test comes to assert against behaviour the real function
 * does not have.
 */
export function mergeObject(original, other = {}, options = {}) {
	const { inplace = true, insertKeys = true, overwrite = true, recursive = true, ...rest } = options;

	const unsupported = Object.keys(rest);
	if (unsupported.length > 0) {
		throw new Error(
			`persistence-harness mergeObject does not implement ${unsupported.join(", ")} — `
			+ "implement it faithfully before relying on it in a test",
		);
	}

	const target = inplace ? original : deepClone(original);

	for (const [key, value] of Object.entries(other)) {
		const has = Object.prototype.hasOwnProperty.call(target, key);
		if (!has) {
			if (insertKeys) target[key] = deepClone(value);
			continue;
		}
		if (recursive && isPlainContainer(target[key]) && isPlainContainer(value)
			&& !Array.isArray(target[key]) && !Array.isArray(value)) {
			mergeObject(target[key], value, { inplace: true, insertKeys, overwrite, recursive });
			continue;
		}
		if (overwrite) target[key] = deepClone(value);
	}

	return target;
}

/**
 * A document (scene or journal) whose flag writes are recorded.
 *
 * Flags are stored under a flat `"scope.key"` string rather than a nested
 * object, because that is all the read paths need and it keeps `unsetFlag`
 * honest — a real `unsetFlag` removes the key rather than setting `undefined`.
 */
function makeRecordingDocument(recorder, { id, name }) {
	const flags = {};
	return {
		id,
		name,
		clearFlags() {
			for (const key of Object.keys(flags)) delete flags[key];
		},
		getFlag: (scope, key) => flags[`${scope}.${key}`],
		setFlag: async (scope, key, value) => {
			flags[`${scope}.${key}`] = value;
			recorder.flagWrites.push({ doc: name, op: "set", scope, key, value });
			return value;
		},
		unsetFlag: async (scope, key) => {
			delete flags[`${scope}.${key}`];
			recorder.flagWrites.push({ doc: name, op: "unset", scope, key });
		},
	};
}

/**
 * Install the globals the hex/dungeon persistence paths read, with recording
 * flag and settings channels. Call BEFORE importing the module under test —
 * several of these are read at module scope.
 *
 * @param {object}  [options]
 * @param {boolean} [options.isGM]     starting GM state; flip later with setGM
 * @param {object}  [options.settings] seed values for `game.settings.get`
 * @returns {object} recorder plus the handles a test needs to drive and assert
 */
export function installPersistenceGlobals({ isGM = true, settings = {} } = {}) {
	const recorder = { flagWrites: [], settingWrites: [], documentsCreated: [] };
	const journals = [];
	const scene = makeRecordingDocument(recorder, { id: "scene-1", name: "scene" });
	const settingValues = { ...settings };

	// The hex data layer looks journals up with `game.journal.find(...)`, so the
	// collection has to be array-like rather than Foundry's Collection map.
	globalThis.game = {
		user: { isGM },
		journal: journals,
		scenes: { get: sceneId => (sceneId === scene.id ? scene : null) },
		settings: {
			get: (scope, key) => settingValues[`${scope}.${key}`],
			set: async (scope, key, value) => {
				settingValues[`${scope}.${key}`] = value;
				recorder.settingWrites.push({ scope, key, value });
				return value;
			},
			register() {},
			registerMenu() {},
		},
		i18n: { localize: key => key },
	};

	globalThis.JournalEntry = {
		create: async data => {
			const journal = makeRecordingDocument(recorder, {
				id: `journal-${journals.length}`,
				name: data.name,
			});
			journal.createData = data;
			journals.push(journal);
			recorder.documentsCreated.push({ type: "JournalEntry", data });
			return journal;
		},
	};

	globalThis.JournalEntryPage = {
		create: async (data, context) => {
			recorder.documentsCreated.push({ type: "JournalEntryPage", data, context });
			return { id: `page-${recorder.documentsCreated.length}`, ...data };
		},
	};

	globalThis.foundry = {
		utils: {
			deepClone,
			mergeObject,
			randomID: () => "test-id",
		},
		applications: {
			api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base, DialogV2: class {} },
			apps: { FilePicker: class {} },
			ux: { TextEditor: {} },
		},
		data: { operators: { ForcedDeletion: class ForcedDeletion {} } },
		canvas: { layers: { CanvasLayer: class CanvasLayer {} } },
	};

	globalThis.PIXI = {
		Container: class {},
		Graphics: class {},
		Sprite: class {},
		Text: class {},
		Texture: { from: source => ({ source }) },
	};

	globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };
	globalThis.canvas = { scene };
	globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
	globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
	// Left undefined on purpose: JournalPinsSD only wraps CONFIG.Canvas.layers
	// when it is already present, so an empty CONFIG skips that registration.
	globalThis.CONFIG = {};
	globalThis.window = { gsap: undefined };
	globalThis.document = {
		fonts: { load: async () => {} },
		createElement: () => ({ style: {}, appendChild() {} }),
		addEventListener() {},
		removeEventListener() {},
		body: { appendChild() {} },
	};

	return {
		recorder,
		scene,
		journals,
		/** Every flag write so far, oldest first. */
		flagWrites: () => recorder.flagWrites,
		/** The value of the most recent flag write. */
		lastFlagValue: () => recorder.flagWrites.at(-1)?.value,
		/**
		 * Drop recorded history but keep everything already stored. Use this
		 * mid-test to set up a starting state and then assert only the writes
		 * that follow it.
		 */
		clearRecords() {
			recorder.flagWrites.length = 0;
			recorder.settingWrites.length = 0;
			recorder.documentsCreated.length = 0;
		},
		/**
		 * Drop recorded history AND every stored document, so each test starts
		 * from an empty world. The journal store has to go too: the hex data
		 * layer finds its journal by name and reads the existing flag before
		 * every write, so a journal left behind by one test would seed the
		 * next one's payload.
		 */
		reset() {
			recorder.flagWrites.length = 0;
			recorder.settingWrites.length = 0;
			recorder.documentsCreated.length = 0;
			journals.length = 0;
			scene.clearFlags();
			for (const key of Object.keys(settingValues)) delete settingValues[key];
			Object.assign(settingValues, settings);
		},
		setGM(value) {
			globalThis.game.user.isGM = value;
		},
		/** Make every scene lookup miss, to exercise the not-found guards. */
		hideScenes() {
			globalThis.game.scenes.get = () => null;
		},
		showScenes() {
			globalThis.game.scenes.get = sceneId => (sceneId === scene.id ? scene : null);
		},
	};
}
