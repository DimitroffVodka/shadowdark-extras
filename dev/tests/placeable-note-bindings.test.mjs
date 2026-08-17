// Behaviour tests for the tray's placeable-note commands.
//
// The seam is the REGISTERED production binding: every test renders a real
// TrayApp into the selector-keyed DOM harness and fires the handler the render
// attached, so what is under test is the command path a user actually reaches.
//
// A row is identified by the exact source it was built from — `data-note-uuid`
// plus the `data-note-type` the index recorded — never by a canvas-layer id or
// a Font Awesome class. Two same-named rows (a Token and its Actor) are the
// case that tells the two apart, so they recur throughout.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

installCanvasGlobals();
installAppGlobals({ dom: makeSelectorDom() });
globalThis.game.settings = { get: () => undefined, set: async () => {}, register() {} };
globalThis.game.scenes = new Map();
globalThis.canvas.grid = { size: 100, isHexagonal: true };

const { TrayApp } = await import("../../scripts/tray/TrayApp.mjs");
const { PlaceableNotesSD } = await import("../../scripts/journal/PlaceableNotesSD.mjs");
const { getNotesData } = await import("../../scripts/tray/TraySD.mjs");

// The one boundary this vertical does not own. Ticket 1 proved the enrichment
// policy against it; here it only has to give the rows something to carry.
foundry.applications.ux.TextEditor = { implementation: { enrichHTML: async html => html } };

const MODULE_ID = "shadowdark-extras";

// --- document-shaped fixtures ------------------------------------------------

/**
 * A Foundry document double that records every call a command makes on it.
 *
 * `calls` is the oracle for the forged-DOM tests: a rejected command must leave
 * it empty, which is a stronger statement than "the flag did not change".
 */
function makeDocument({ documentName, uuid, id, name = "", flags = {}, parent = null, ...rest }) {
	const calls = [];
	const stored = { [MODULE_ID]: { ...flags } };
	return {
		documentName, uuid, id, name, parent, calls, flags: stored,
		getFlag(scope, key) {
			calls.push(`getFlag:${key}`);
			return stored[scope]?.[key];
		},
		async setFlag(scope, key, value) {
			calls.push(`setFlag:${key}=${value}`);
			(stored[scope] ??= {})[key] = value;
		},
		async unsetFlag(scope, key) {
			calls.push(`unsetFlag:${key}`);
			delete stored[scope]?.[key];
		},
		...rest,
	};
}

/**
 * Install a world: which documents exist, which Tokens the active Scene holds,
 * and who is looking. Returns the spies a test asserts against.
 */
function stage({
	isGM = true, sceneId = "scene-1", documents = [], sceneTokens = [], placeables = {},
	sceneCollections = {},
} = {}) {
	const resolved = [];
	const byUuid = new Map(documents.map(document => [document.uuid, document]));
	globalThis.fromUuidSync = uuid => {
		resolved.push(uuid);
		return byUuid.get(uuid) ?? null;
	};

	const collect = documentsIn =>
		new foundry.utils.Collection(documentsIn.map(document => [document.id, document]));
	const scene = {
		id: sceneId,
		uuid: `Scene.${sceneId}`,
		tokens: collect(sceneTokens),
		...Object.fromEntries(Object.entries(sceneCollections)
			.map(([name, documentsIn]) => [name, collect(documentsIn)])),
	};
	globalThis.canvas.scene = scene;
	globalThis.game.user = { id: "user-1", isGM };

	// The drawn placeables, which is where a current position lives. A document
	// records where something was saved; the placeable is where it is now.
	const pans = [];
	const layer = name => ({ get: id => placeables[name]?.[id] ?? undefined });
	Object.assign(globalThis.canvas, {
		tokens: layer("tokens"),
		tiles: layer("tiles"),
		walls: layer("walls"),
		lighting: layer("lighting"),
		sounds: layer("sounds"),
		animatePan: target => pans.push(target),
	});

	return { resolved, scene, pans };
}

// --- rendering ---------------------------------------------------------------

/**
 * Render a tray whose Notes list holds one row, and hand back the DOM so its
 * registered handlers can be fired.
 */
function render({ control = {}, entry = {} } = {}) {
	const dom = makeSelectorDom({
		seedAll: true,
		lists: {
			".note-control": [{ dataset: control }],
			".note-entry": [{ dataset: entry }],
		},
	});

	globalThis.document = dom.document;
	const app = new TrayApp({});
	app._onRender({}, {});

	// The row that owns the fired control. The harness answers closest() by
	// selector, so the rendered row is registered as that answer rather than a
	// second node standing in for it.
	dom.closestResults.set(".note-entry", dom.node(".sdx-tray .note-entry[0]"));
	return { app, dom };
}

const NOTE_CONTROL = ".sdx-tray .note-control[0]";

// --- dialogs -----------------------------------------------------------------

/**
 * Capture every DialogV2 a command opens. The rename flow builds its dialog and
 * renders it, so the constructed config is what a test drives.
 */
function captureDialogs(t) {
	const DialogV2 = foundry.applications.api.DialogV2;
	const opened = [];
	const previousRender = DialogV2.prototype.render;
	DialogV2.prototype.render = function captureRender() {
		opened.push(this.config);
		return this;
	};
	t.after(() => {
		DialogV2.prototype.render = previousRender;
	});
	return opened;
}

// --- listener ownership ------------------------------------------------------

// Moving the Notes handlers out of the pin list is only safe if exactly one
// module ends up owning them. Two owners is not a cosmetic duplication: every
// command runs twice, so a visibility toggle flips back to where it started and
// a delete confirmation is asked for twice.
const NOTE_SELECTORS = [
	[".sdx-tray .note-control[0]", "click"],
	[".sdx-tray .note-header[0]", "click"],
	[".sdx-tray .note-entry[0]", "contextmenu"],
];

test("one render leaves exactly one listener on each Notes affordance", () => {
	stage();
	const { dom } = render();

	for (const [selector, event] of NOTE_SELECTORS) {
		assert.equal(dom.handlers(selector, event).length, 1, `${selector} :: ${event}`);
	}
});

test("the Notes affordances belong to the Notes module, not the pin list", () => {
	stage();
	const { app } = render();

	const notesDom = makeSelectorDom({ seedAll: true });
	app._bindPlaceableNoteEvents(notesDom.node(".sdx-tray"));
	const pinsDom = makeSelectorDom({ seedAll: true });
	app._bindPinListEvents(pinsDom.node(".sdx-tray"));

	assert.deepEqual(notesDom.manifest(), [
		".sdx-tray .note-control[0] :: click",
		".sdx-tray .note-entry[0] :: contextmenu",
		".sdx-tray .note-header[0] :: click",
	]);
	assert.deepEqual(pinsDom.manifest().filter(entry => entry.includes(".note-")), [],
		"the pin list keeps no Notes handler");
});

test("a rerender into a fresh element runs a command once, not once per render", async t => {
	const tile = makeDocument({
		documentName: "Tile", uuid: "Scene.scene-1.Tile.x1", id: "x1", name: "Mural",
		parent: { id: "scene-1" },
	});
	stage({ documents: [tile], sceneTokens: [] });
	const dialogs = captureDialogs(t);

	// Foundry replaces the tray element on every render; the second render is
	// the one whose listeners a later click reaches.
	render({ control: { action: "rename" }, entry: { noteUuid: tile.uuid, noteType: "Tile" } });
	const { dom } = render({
		control: { action: "rename" },
		entry: { noteUuid: tile.uuid, noteType: "Tile" },
	});
	await dom.fire(NOTE_CONTROL, "click");

	assert.equal(dialogs.length, 1);
});

/** Capture every note sheet a command opens, with the source it was opened on. */
function captureSheets(t) {
	const opened = [];
	const previousRender = PlaceableNotesSD.prototype.render;
	PlaceableNotesSD.prototype.render = function captureRender() {
		opened.push(this.object);
		return this;
	};
	t.after(() => {
		PlaceableNotesSD.prototype.render = previousRender;
	});
	return opened;
}

// --- command authorization ---------------------------------------------------

// GM-only markup is presentation, not authorization: the controls are simply
// absent from a player's rendered tray, which stops an honest click and nothing
// else. A forged control must be refused in the command path — and refused
// early enough that it discloses nothing, so the row is never even resolved.
//
// The Actor here is one the player owns and could legitimately write to, so a
// document-permission check would let all four commands through. Only the
// GM check stops them.
for (const [name, action] of [
	["rename", "rename"],
	["visibility", "toggle-visibility"],
	["delete", "delete"],
]) {
	test(`a forged ${name} control from a non-GM resolves nothing and calls nothing`, async t => {
		const actor = makeDocument({
			documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix",
			flags: { notes: "<p>secret</p>", noteVisible: false },
			isOwner: true,
			testUserPermission: () => true,
		});
		const { resolved } = stage({ isGM: false, documents: [actor] });
		const dialogs = captureDialogs(t);
		const sheets = captureSheets(t);

		const { dom } = render({
			control: { action },
			entry: { noteUuid: "Actor.a1", noteType: "Actor" },
		});
		await dom.fire(NOTE_CONTROL, "click");

		assert.deepEqual(resolved, [], "the row's UUID is never resolved");
		assert.deepEqual(actor.calls, [], "no document method is called");
		assert.deepEqual(dialogs, [], "no dialog is opened");
		assert.deepEqual(sheets, [], "no sheet is opened");
		assert.equal(actor.flags[MODULE_ID].noteVisible, false);
	});
}

test("a forged edit context menu from a non-GM resolves nothing and calls nothing", async t => {
	const actor = makeDocument({
		documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix",
		flags: { notes: "<p>secret</p>" },
		isOwner: true,
		testUserPermission: () => true,
	});
	const { resolved } = stage({ isGM: false, documents: [actor] });
	const dialogs = captureDialogs(t);
	const sheets = captureSheets(t);

	const { dom } = render({ entry: { noteUuid: "Actor.a1", noteType: "Actor" } });
	await dom.fire(".sdx-tray .note-entry[0]", "contextmenu");

	assert.deepEqual(resolved, []);
	assert.deepEqual(actor.calls, []);
	assert.deepEqual(dialogs, []);
	assert.deepEqual(sheets, []);
});

// --- exact-source routing ----------------------------------------------------

test("renaming an Actor row renames the Actor, not the same-named Token", async t => {
	const actor = makeDocument({ documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix" });
	const scene = { id: "scene-1" };
	const token = makeDocument({
		documentName: "Token", uuid: "Scene.scene-1.Token.t1", id: "t1", name: "Grix",
		parent: scene, actor,
	});
	stage({ documents: [actor, token], sceneTokens: [token] });
	const dialogs = captureDialogs(t);

	const { dom } = render({
		control: { action: "rename" },
		entry: { noteUuid: "Actor.a1", noteType: "Actor" },
	});
	await dom.fire(NOTE_CONTROL, "click");

	assert.equal(dialogs.length, 1, "the rename dialog opens");
	const save = dialogs[0].buttons.find(button => button.action === "save");
	await save.callback({}, { form: { elements: { name: { value: "Grix the Bold" } } } });

	assert.deepEqual(actor.calls, ["getFlag:customName", "setFlag:customName=Grix the Bold"]);
	assert.deepEqual(token.calls, [], "the same-named Token is never touched");
});

test("renaming a Token row renames the Token, not the same-named Actor", async t => {
	const actor = makeDocument({ documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix" });
	const scene = { id: "scene-1" };
	const token = makeDocument({
		documentName: "Token", uuid: "Scene.scene-1.Token.t1", id: "t1", name: "Grix",
		parent: scene, actor,
	});
	stage({ documents: [actor, token], sceneTokens: [token] });
	const dialogs = captureDialogs(t);

	const { dom } = render({
		control: { action: "rename" },
		entry: { noteUuid: "Scene.scene-1.Token.t1", noteType: "Token" },
	});
	await dom.fire(NOTE_CONTROL, "click");

	const save = dialogs[0].buttons.find(button => button.action === "save");
	await save.callback({}, { form: { elements: { name: { value: "Grix the Bold" } } } });

	assert.deepEqual(token.calls, ["getFlag:customName", "setFlag:customName=Grix the Bold"]);
	assert.deepEqual(actor.calls, [], "the same-named Actor is never touched");
});

// --- panning -----------------------------------------------------------------

// Token movement is deliberately excluded from tray rerenders, so any position
// captured while the row was rendered is stale the moment the token moves. Pan
// therefore reads the drawn placeable at click time.
test("panning to a Token that has moved uses where it is now", async () => {
	const scene = { id: "scene-1" };
	const token = makeDocument({
		documentName: "Token", uuid: "Scene.scene-1.Token.t1", id: "t1", name: "Grix",
		parent: scene,
	});
	const drawn = { id: "t1", center: { x: 100, y: 100 } };
	const { pans } = stage({
		documents: [token], sceneTokens: [token], placeables: { tokens: { t1: drawn } },
	});

	const { dom } = render({
		control: { action: "pan" },
		entry: { noteUuid: token.uuid, noteType: "Token" },
	});
	// The token moves; the tray is not rerendered.
	drawn.center = { x: 900, y: 700 };
	await dom.fire(NOTE_CONTROL, "click");

	assert.deepEqual(pans, [{ x: 900, y: 700, scale: 1.5, duration: 500 }]);
});

test("panning to an Actor row centres on a Token representing it on this scene", async () => {
	const actor = makeDocument({ documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix" });
	const scene = { id: "scene-1" };
	const token = makeDocument({
		documentName: "Token", uuid: "Scene.scene-1.Token.t1", id: "t1", name: "Grix",
		parent: scene, actor,
	});
	const { pans } = stage({
		documents: [actor, token],
		sceneTokens: [token],
		placeables: { tokens: { t1: { id: "t1", center: { x: 420, y: 240 } } } },
	});

	const { dom } = render({
		control: { action: "pan" },
		entry: { noteUuid: "Actor.a1", noteType: "Actor" },
	});
	await dom.fire(NOTE_CONTROL, "click");

	assert.deepEqual(pans, [{ x: 420, y: 240, scale: 1.5, duration: 500 }]);
});

// --- visibility --------------------------------------------------------------

test("toggling a Tile row's visibility writes the flag on that Tile", async () => {
	const tile = makeDocument({
		documentName: "Tile", uuid: "Scene.scene-1.Tile.x1", id: "x1", name: "Mural",
		parent: { id: "scene-1" }, flags: { notes: "<p>note</p>", noteVisible: false },
	});
	stage({ documents: [tile] });

	const { dom } = render({
		control: { action: "toggle-visibility" },
		entry: { noteUuid: tile.uuid, noteType: "Tile" },
	});
	await dom.fire(NOTE_CONTROL, "click");

	assert.equal(tile.flags[MODULE_ID].noteVisible, true);
});

// An Actor note predating Actor-level sharing was shared through the Token
// representing it. That decision still counts when the row is displayed, so the
// GM sees a shared row — and the toggle has to move it from shared to hidden,
// which means writing the explicit `false` the Actor never had.
test("the first toggle of a legacy-shared Actor note writes explicit false on the Actor", async () => {
	const actor = makeDocument({
		documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix",
		flags: { notes: "<p>actor note</p>" },
	});
	const token = makeDocument({
		documentName: "Token", uuid: "Scene.scene-1.Token.t1", id: "t1", name: "Grix",
		parent: { id: "scene-1" }, actor, flags: { noteVisible: true },
	});
	stage({ documents: [actor, token], sceneTokens: [token] });

	const { dom } = render({
		control: { action: "toggle-visibility" },
		entry: { noteUuid: "Actor.a1", noteType: "Actor" },
	});
	await dom.fire(NOTE_CONTROL, "click");

	assert.equal(actor.flags[MODULE_ID].noteVisible, false);
	assert.deepEqual(token.calls, [], "the representing Token is never written to");
	assert.equal(token.flags[MODULE_ID].noteVisible, true, "the Token's own sharing is untouched");
});

// A Token that carries its own note was shared for that note, not for the
// separate Actor note it happens to sit on. The Actor row is therefore hidden,
// and its first toggle shares it.
test("a shared Token with its own note leaves the Actor row hidden, so its first toggle shares it", async () => {
	const actor = makeDocument({
		documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix",
		flags: { notes: "<p>actor note</p>" },
	});
	const token = makeDocument({
		documentName: "Token", uuid: "Scene.scene-1.Token.t1", id: "t1", name: "Grix",
		parent: { id: "scene-1" }, actor,
		flags: { notes: "<p>token note</p>", noteVisible: true },
	});
	stage({ documents: [actor, token], sceneTokens: [token] });

	const { dom } = render({
		control: { action: "toggle-visibility" },
		entry: { noteUuid: "Actor.a1", noteType: "Actor" },
	});
	await dom.fire(NOTE_CONTROL, "click");

	assert.equal(actor.flags[MODULE_ID].noteVisible, true);
	assert.deepEqual(token.calls, []);
});

// --- deleting ----------------------------------------------------------------

/**
 * Answer the confirmation a destructive command asks for.
 *
 * `whileOpen` runs before the answer comes back, which is how a test says "the
 * world changed while the confirmation was on screen".
 */
function answerConfirm(t, answer, whileOpen) {
	const DialogV2 = foundry.applications.api.DialogV2;
	const asked = [];
	const previousConfirm = DialogV2.confirm;
	DialogV2.confirm = async config => {
		asked.push(config);
		whileOpen?.();
		return answer;
	};
	t.after(() => {
		DialogV2.confirm = previousConfirm;
	});
	return asked;
}

test("deleting a Wall row removes the note and its sharing from that Wall", async t => {
	const wall = makeDocument({
		documentName: "Wall", uuid: "Scene.scene-1.Wall.w1", id: "w1", name: "Wall",
		parent: { id: "scene-1" }, flags: { notes: "<p>note</p>", noteVisible: true },
	});
	stage({ documents: [wall] });
	const asked = answerConfirm(t, true);

	const { dom } = render({
		control: { action: "delete" },
		entry: { noteUuid: wall.uuid, noteType: "Wall" },
	});
	await dom.fire(NOTE_CONTROL, "click");

	assert.equal(asked.length, 1, "deleting a note asks first");
	assert.deepEqual(wall.calls, ["unsetFlag:notes", "unsetFlag:noteVisible"]);
	assert.deepEqual(wall.flags[MODULE_ID], {});
});

test("declining the confirmation leaves the note alone", async t => {
	const wall = makeDocument({
		documentName: "Wall", uuid: "Scene.scene-1.Wall.w1", id: "w1", name: "Wall",
		parent: { id: "scene-1" }, flags: { notes: "<p>note</p>", noteVisible: true },
	});
	stage({ documents: [wall] });
	answerConfirm(t, false);

	const { dom } = render({
		control: { action: "delete" },
		entry: { noteUuid: wall.uuid, noteType: "Wall" },
	});
	await dom.fire(NOTE_CONTROL, "click");

	assert.deepEqual(wall.calls, []);
	assert.equal(wall.flags[MODULE_ID].notes, "<p>note</p>");
});

// --- editing -----------------------------------------------------------------

test("the edit context menu opens the note sheet on the row's exact source", async t => {
	const actor = makeDocument({ documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix" });
	const token = makeDocument({
		documentName: "Token", uuid: "Scene.scene-1.Token.t1", id: "t1", name: "Grix",
		parent: { id: "scene-1" }, actor,
	});
	stage({ documents: [actor, token], sceneTokens: [token] });
	const sheets = captureSheets(t);

	const { dom } = render({ entry: { noteUuid: "Actor.a1", noteType: "Actor" } });
	await dom.fire(".sdx-tray .note-entry[0]", "contextmenu");

	assert.deepEqual(sheets, [actor]);
});

// --- active-scene validation -------------------------------------------------

/**
 * Watch the tray's own refresh. A stale row must not merely fail: the list it
 * came from is out of date, so the command asks the tray to rebuild.
 */
function watchRefresh(app) {
	const refreshes = [];
	const previous = app._refreshPlaceableNotes.bind(app);
	app._refreshPlaceableNotes = () => {
		refreshes.push(true);
		return previous();
	};
	return refreshes;
}

// A resolvable UUID is not enough. The tray is a scene tool, and a row rendered
// before the scene changed still names a document that exists — on the scene
// that is no longer open. Opening or mutating it would edit a scene the GM is
// not looking at.
for (const [name, action] of [
	["rename", "rename"],
	["visibility", "toggle-visibility"],
	["delete", "delete"],
	["pan", "pan"],
]) {
	test(`${name} on a row from a previous scene does nothing and refreshes`, async t => {
		const tile = makeDocument({
			documentName: "Tile", uuid: "Scene.scene-1.Tile.x1", id: "x1", name: "Mural",
			parent: { id: "scene-1" }, flags: { notes: "<p>note</p>", noteVisible: true },
		});
		const dialogs = captureDialogs(t);
		const confirms = answerConfirm(t, true);
		// The scene changed after the row was rendered.
		const { pans } = stage({
			sceneId: "scene-2",
			documents: [tile],
			placeables: { tiles: { x1: { id: "x1", center: { x: 10, y: 20 } } } },
		});

		const { app, dom } = render({
			control: { action },
			entry: { noteUuid: tile.uuid, noteType: "Tile" },
		});
		const refreshes = watchRefresh(app);
		await dom.fire(NOTE_CONTROL, "click");

		assert.deepEqual(tile.calls, [], "no method is called on the out-of-scope source");
		assert.deepEqual(dialogs, []);
		assert.deepEqual(confirms, []);
		assert.deepEqual(pans, []);
		assert.equal(refreshes.length, 1, "the stale list is rebuilt");
	});
}

test("the edit context menu on a row from a previous scene opens no sheet", async t => {
	const tile = makeDocument({
		documentName: "Tile", uuid: "Scene.scene-1.Tile.x1", id: "x1", name: "Mural",
		parent: { id: "scene-1" }, flags: { notes: "<p>note</p>" },
	});
	stage({ sceneId: "scene-2", documents: [tile] });
	const sheets = captureSheets(t);

	const { app, dom } = render({ entry: { noteUuid: tile.uuid, noteType: "Tile" } });
	const refreshes = watchRefresh(app);
	await dom.fire(".sdx-tray .note-entry[0]", "contextmenu");

	assert.deepEqual(sheets, []);
	assert.equal(refreshes.length, 1);
});

// An Actor belongs to the world, not to a scene, so it goes on resolving
// perfectly after its last Token here is deleted. The row it left behind is
// still scene-scoped, and acting on it would edit an Actor this scene no longer
// shows.
for (const [name, action] of [
	["rename", "rename"],
	["visibility", "toggle-visibility"],
	["delete", "delete"],
	["pan", "pan"],
]) {
	test(`${name} on an Actor row whose last Token is gone does nothing and refreshes`, async t => {
		const actor = makeDocument({
			documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix",
			flags: { notes: "<p>note</p>", noteVisible: true },
		});
		const dialogs = captureDialogs(t);
		const confirms = answerConfirm(t, true);
		// The Actor still resolves; no Token on this scene represents it.
		const { resolved, pans } = stage({ documents: [actor], sceneTokens: [] });

		const { app, dom } = render({
			control: { action },
			entry: { noteUuid: "Actor.a1", noteType: "Actor" },
		});
		const refreshes = watchRefresh(app);
		await dom.fire(NOTE_CONTROL, "click");

		assert.deepEqual(resolved, ["Actor.a1"], "the Actor does resolve");
		assert.deepEqual(actor.calls, [], "and is still never acted on");
		assert.deepEqual(dialogs, []);
		assert.deepEqual(confirms, []);
		assert.deepEqual(pans, []);
		assert.equal(refreshes.length, 1);
	});
}

// --- type substitution -------------------------------------------------------

// Ids are unique per collection, not across them, so a Tile and a light can
// share one. The rendered type is therefore part of the row's identity: if the
// UUID now names a document of another type, this is not the row's source.
test("a source of another type at the row's UUID is refused, not acted on", async t => {
	const substitute = makeDocument({
		documentName: "AmbientLight", uuid: "Scene.scene-1.Tile.x1", id: "x1", name: "Torch",
		parent: { id: "scene-1" }, flags: { notes: "<p>note</p>", noteVisible: true },
	});
	stage({ documents: [substitute] });
	const dialogs = captureDialogs(t);

	const { app, dom } = render({
		control: { action: "rename" },
		entry: { noteUuid: "Scene.scene-1.Tile.x1", noteType: "Tile" },
	});
	const refreshes = watchRefresh(app);
	await dom.fire(NOTE_CONTROL, "click");

	assert.deepEqual(substitute.calls, []);
	assert.deepEqual(dialogs, []);
	assert.equal(refreshes.length, 1);
});

test("a Token row whose UUID now names the Actor is refused", async t => {
	const actor = makeDocument({
		documentName: "Actor", uuid: "Scene.scene-1.Token.t1", id: "t1", name: "Grix",
		flags: { notes: "<p>note</p>" },
	});
	stage({ documents: [actor] });
	const sheets = captureSheets(t);

	const { dom } = render({
		entry: { noteUuid: "Scene.scene-1.Token.t1", noteType: "Token" },
	});
	await dom.fire(".sdx-tray .note-entry[0]", "contextmenu");

	assert.deepEqual(sheets, []);
	assert.deepEqual(actor.calls, []);
});

// --- the list the commands are rendered from ---------------------------------

// The tray still shows one flat list — the folder-like groups come later — but
// the rows in it are now the scene index's, so each one names the exact source
// its commands will act on. Flattening is presentation; the identity is not.
test("the Notes list is the scene index, flattened, one row per exact source", async () => {
	const actor = makeDocument({
		documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix",
		flags: { notes: "<p>actor note</p>" },
	});
	const token = makeDocument({
		documentName: "Token", uuid: "Scene.scene-1.Token.t1", id: "t1", name: "Grix",
		parent: { id: "scene-1" }, actor, flags: { notes: "<p>token note</p>" },
	});
	const tile = makeDocument({
		documentName: "Tile", uuid: "Scene.scene-1.Tile.x1", id: "x1", name: "Mural",
		parent: { id: "scene-1" }, flags: { notes: "<p>tile note</p>", noteVisible: true },
	});
	stage({
		documents: [actor, token, tile],
		sceneTokens: [token],
		sceneCollections: { tiles: [tile] },
	});

	const rows = await getNotesData();

	assert.deepEqual(rows.map(row => [row.sourceUuid, row.sourceType]), [
		["Scene.scene-1.Token.t1", "Token"],
		["Actor.a1", "Actor"],
		["Scene.scene-1.Tile.x1", "Tile"],
	]);
	assert.deepEqual(rows.map(row => row.displayName), ["Grix", "Grix", "Mural"]);
	assert.deepEqual(rows.map(row => row.isVisible), [false, false, true]);
	assert.equal(rows[2].enrichedContent, "<p>tile note</p>");
	assert.ok(rows.every(row => !!row.icon), "every row still has an icon to render");
});

test("a player's Notes list holds only the rows shared with them", async () => {
	const shared = makeDocument({
		documentName: "Tile", uuid: "Scene.scene-1.Tile.x1", id: "x1", name: "Mural",
		parent: { id: "scene-1" }, flags: { notes: "<p>shared</p>", noteVisible: true },
	});
	const hidden = makeDocument({
		documentName: "Tile", uuid: "Scene.scene-1.Tile.x2", id: "x2", name: "Trap",
		parent: { id: "scene-1" }, flags: { notes: "<p>hidden</p>" },
	});
	stage({ isGM: false, documents: [shared, hidden], sceneCollections: { tiles: [shared, hidden] } });

	const rows = await getNotesData();

	assert.deepEqual(rows.map(row => row.sourceUuid), ["Scene.scene-1.Tile.x1"]);
});

// Drawings and Regions have no SDX Notes control and never enter the index, so
// no honest row names one. A forged row that does is not a note row at all, and
// the shared supported-source rule is what says so — the command path does not
// keep a second opinion about which types carry notes.
test("a row naming a document type that cannot carry a note is refused", async t => {
	const drawing = makeDocument({
		documentName: "Drawing", uuid: "Scene.scene-1.Drawing.d1", id: "d1", name: "Sketch",
		parent: { id: "scene-1" },
	});
	stage({ documents: [drawing] });
	const dialogs = captureDialogs(t);

	const { app, dom } = render({
		control: { action: "rename" },
		entry: { noteUuid: drawing.uuid, noteType: "Drawing" },
	});
	const refreshes = watchRefresh(app);
	await dom.fire(NOTE_CONTROL, "click");

	assert.deepEqual(drawing.calls, []);
	assert.deepEqual(dialogs, []);
	assert.equal(refreshes.length, 1);
});

// --- reauthorization at the moment of mutation -------------------------------

// A dialog button is a later user action, not part of the click that opened it.
// Between the two the GM can be demoted, the active Scene can change, and an
// Actor can lose its last representing Token — so the check that ran when the
// dialog opened has expired by the time the write happens. Each of these proves
// the mutation re-asks rather than reusing the document it was handed.

/** A Tile with a note on the active Scene, and the row that names it. */
function notedTile() {
	return makeDocument({
		documentName: "Tile", uuid: "Scene.scene-1.Tile.x1", id: "x1", name: "Mural",
		parent: { id: "scene-1" }, flags: { notes: "<p>note</p>", noteVisible: true },
	});
}

const TILE_ROW = { noteUuid: "Scene.scene-1.Tile.x1", noteType: "Tile" };

/** An Actor reachable only through one Token on the active Scene. */
function notedActorWithToken() {
	const actor = makeDocument({
		documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix",
		flags: { notes: "<p>note</p>", noteVisible: true },
	});
	const token = makeDocument({
		documentName: "Token", uuid: "Scene.scene-1.Token.t1", id: "t1", name: "Grix",
		parent: { id: "scene-1" }, actor,
	});
	return { actor, token };
}

const ACTOR_ROW = { noteUuid: "Actor.a1", noteType: "Actor" };

/** Open a row's rename dialog as a GM and hand back its buttons. */
async function openRename(t, { entry, documents, sceneTokens = [] }) {
	const dialogs = captureDialogs(t);
	const world = stage({ documents, sceneTokens });
	const { app, dom } = render({ control: { action: "rename" }, entry });
	const refreshes = watchRefresh(app);
	await dom.fire(NOTE_CONTROL, "click");

	assert.equal(dialogs.length, 1, "the rename dialog opened");
	return {
		...world,
		refreshes,
		buttons: Object.fromEntries(dialogs[0].buttons.map(button => [button.action, button])),
	};
}

/** Switch the active Scene to one the row's source does not belong to. */
function switchScene() {
	globalThis.canvas.scene = { id: "scene-2", tokens: new foundry.utils.Collection() };
}

test("a rename Save by a user demoted since the dialog opened resolves and writes nothing", async t => {
	const tile = notedTile();
	const { resolved, refreshes, buttons } = await openRename(t, {
		documents: [tile], entry: TILE_ROW,
	});
	const resolutionsWhenOpened = resolved.length;

	globalThis.game.user.isGM = false;
	await buttons.save.callback({}, { form: { elements: { name: { value: "stale write" } } } });

	assert.equal(resolved.length, resolutionsWhenOpened, "the row is never resolved again");
	assert.deepEqual(tile.calls, ["getFlag:customName"], "only the read that prefilled the dialog");
	assert.equal(tile.flags[MODULE_ID].customName, undefined);
	assert.equal(refreshes.length, 0, "a demotion is not a stale row; nothing is disclosed");
});

test("a rename Save after the Scene changed writes nothing and refreshes", async t => {
	const tile = notedTile();
	const { refreshes, buttons } = await openRename(t, { documents: [tile], entry: TILE_ROW });

	switchScene();
	await buttons.save.callback({}, { form: { elements: { name: { value: "stale write" } } } });

	assert.deepEqual(tile.calls, ["getFlag:customName"]);
	assert.equal(tile.flags[MODULE_ID].customName, undefined);
	assert.equal(refreshes.length, 1);
});

test("a rename Reset by a user demoted since the dialog opened resolves and writes nothing", async t => {
	const tile = notedTile();
	tile.flags[MODULE_ID].customName = "Painted Mural";
	const { resolved, refreshes, buttons } = await openRename(t, {
		documents: [tile], entry: TILE_ROW,
	});
	const resolutionsWhenOpened = resolved.length;

	globalThis.game.user.isGM = false;
	await buttons.reset.callback({}, {});

	assert.equal(resolved.length, resolutionsWhenOpened);
	assert.deepEqual(tile.calls, ["getFlag:customName"]);
	assert.equal(tile.flags[MODULE_ID].customName, "Painted Mural");
	assert.equal(refreshes.length, 0);
});

test("a rename Reset after the Actor's last Token is gone writes nothing and refreshes", async t => {
	const { actor, token } = notedActorWithToken();
	actor.flags[MODULE_ID].customName = "Grix the Bold";
	const { scene, refreshes, buttons } = await openRename(t, {
		documents: [actor, token], sceneTokens: [token], entry: ACTOR_ROW,
	});

	// The Actor still resolves; nothing on this Scene represents it any more.
	scene.tokens.delete("t1");
	await buttons.reset.callback({}, {});

	assert.deepEqual(actor.calls, ["getFlag:customName"]);
	assert.equal(actor.flags[MODULE_ID].customName, "Grix the Bold");
	assert.equal(refreshes.length, 1);
});

test("a delete confirmed by a user demoted while confirming removes nothing", async t => {
	const tile = notedTile();
	const { resolved } = stage({ documents: [tile] });
	answerConfirm(t, true, () => {
		globalThis.game.user.isGM = false;
	});

	const { app, dom } = render({ control: { action: "delete" }, entry: TILE_ROW });
	const refreshes = watchRefresh(app);
	await dom.fire(NOTE_CONTROL, "click");

	assert.equal(resolved.length, 1, "resolved once, when the control was clicked");
	assert.deepEqual(tile.calls, []);
	assert.equal(tile.flags[MODULE_ID].notes, "<p>note</p>");
	assert.equal(refreshes.length, 0);
});

test("a delete confirmed after the Scene changed removes nothing and refreshes", async t => {
	const tile = notedTile();
	stage({ documents: [tile] });
	answerConfirm(t, true, switchScene);

	const { app, dom } = render({ control: { action: "delete" }, entry: TILE_ROW });
	const refreshes = watchRefresh(app);
	await dom.fire(NOTE_CONTROL, "click");

	assert.deepEqual(tile.calls, []);
	assert.equal(tile.flags[MODULE_ID].notes, "<p>note</p>");
	assert.equal(refreshes.length, 1);
});

test("a delete confirmed after the Actor's last Token is gone removes nothing and refreshes", async t => {
	const { actor, token } = notedActorWithToken();
	const { scene } = stage({ documents: [actor, token], sceneTokens: [token] });
	answerConfirm(t, true, () => scene.tokens.delete("t1"));

	const { app, dom } = render({ control: { action: "delete" }, entry: ACTOR_ROW });
	const refreshes = watchRefresh(app);
	await dom.fire(NOTE_CONTROL, "click");

	assert.deepEqual(actor.calls, []);
	assert.equal(actor.flags[MODULE_ID].notes, "<p>note</p>");
	assert.equal(refreshes.length, 1);
});

test("a rename Save still writes when nothing changed while the dialog was open", async t => {
	const tile = notedTile();
	const { refreshes, buttons } = await openRename(t, { documents: [tile], entry: TILE_ROW });

	await buttons.save.callback({}, { form: { elements: { name: { value: "Painted Mural" } } } });

	assert.deepEqual(tile.calls, ["getFlag:customName", "setFlag:customName=Painted Mural"]);
	assert.equal(refreshes.length, 0);
});

// --- edit/open, for both halves of a same-named pair -------------------------

// The Actor half of this pair is proved above. A Token and its Actor can carry
// two distinct notes under one display name, so opening the wrong one is the
// mistake worth ruling out from both sides, not one.
test("the edit context menu on a Token row opens the Token, not its same-named Actor", async t => {
	const actor = makeDocument({
		documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix",
		flags: { notes: "<p>actor note</p>" },
	});
	const token = makeDocument({
		documentName: "Token", uuid: "Scene.scene-1.Token.t1", id: "t1", name: "Grix",
		parent: { id: "scene-1" }, actor, flags: { notes: "<p>token note</p>" },
	});
	stage({ documents: [actor, token], sceneTokens: [token] });
	const sheets = captureSheets(t);

	const { dom } = render({
		entry: { noteUuid: "Scene.scene-1.Token.t1", noteType: "Token" },
	});
	await dom.fire(".sdx-tray .note-entry[0]", "contextmenu");

	assert.deepEqual(sheets, [token]);
});

// The Actor-specific stale branch: not a Scene change, but the loss of the last
// Token that put this world Actor into a scene-scoped list at all.
test("the edit context menu on an Actor row whose last Token is gone opens nothing", async t => {
	const actor = makeDocument({
		documentName: "Actor", uuid: "Actor.a1", id: "a1", name: "Grix",
		flags: { notes: "<p>actor note</p>" },
	});
	const { resolved } = stage({ documents: [actor], sceneTokens: [] });
	const sheets = captureSheets(t);

	const { app, dom } = render({ entry: { noteUuid: "Actor.a1", noteType: "Actor" } });
	const refreshes = watchRefresh(app);
	await dom.fire(".sdx-tray .note-entry[0]", "contextmenu");

	assert.deepEqual(resolved, ["Actor.a1"], "the world Actor does resolve");
	assert.deepEqual(sheets, [], "and is still not opened");
	assert.deepEqual(actor.calls, []);
	assert.equal(refreshes.length, 1);
});
