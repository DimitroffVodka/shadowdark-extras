// Lifecycle tests for the placeable-note index: what keeps the Notes tab
// honest while the scene changes underneath it.
//
// The seam is the REGISTERED document hook. `initTray()` is the production
// entry point that installs them, and every test here reaches into what it
// installed and calls it the way Foundry would — the harness records each
// `Hooks.on`, so `fire("updateToken", ...)` runs the handler the module
// actually registered rather than a stand-in for it. Nothing here calls
// `renderTray()` to make a refresh happen; that would test the renderer and
// prove nothing about whether anything asks for it.
//
// The oracle throughout is Foundry's enrichment boundary plus the payload the
// tray was handed. "The tray rebuilt" means a note was enriched; "the tray did
// not rebuild" means none was. Reading the published `noteGroups` says what the
// rebuild concluded.
//
// The DOM harness does not render Handlebars, so nothing here asserts markup.
// Real `tray.hbs` output stays a live-Foundry acceptance seam.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { makeSelectorDom } from "./helpers/dom-harness.mjs";
import {
	MODULE_ID,
	installEnricher,
	installTrayHarness,
	makeTrayDriver,
	noted,
	traceEnrichment,
	unnoted,
	useDebounceClock,
} from "./helpers/placeable-note-tray.mjs";

const { hooks, features } = installTrayHarness();

const { TrayApp } = await import("../../scripts/tray/TrayApp.mjs");
const TraySD = await import("../../scripts/tray/TraySD.mjs");

installEnricher();
const tray = makeTrayDriver(TraySD, features);

// --- scene fixtures ----------------------------------------------------------

/**
 * A mutable scene shaped the way Foundry 14 shapes one. Every collection is a
 * live array a test can push to or splice from, because that is what a document
 * being created or deleted does before its hook fires: Foundry has already
 * updated the collection by the time `createX`/`deleteX` reaches a listener.
 */
function makeScene(id = "scene-a") {
	return {
		id,
		uuid: `Scene.${id}`,
		tokens: { contents: [] },
		tiles: { contents: [] },
		walls: { contents: [] },
		lights: { contents: [] },
		sounds: { contents: [] },
		// Foundry's own Map Notes, which the Pins tab lists and this ticket does
		// not touch. An empty collection keeps that tab renderable.
		notes: [],
		getFlag: () => [],
	};
}

/** Which scene collection holds each embedded type. */
const SCENE_COLLECTIONS = {
	Token: "tokens",
	Tile: "tiles",
	Wall: "walls",
	AmbientLight: "lights",
	AmbientSound: "sounds",
};

/**
 * Put embedded documents on a scene, the way Foundry holds them: in the
 * collection for their type, each knowing the Scene it belongs to. The parent
 * link is not decoration — it is how a command decides whether a row still
 * names something on the scene the tray is showing.
 */
function place(scene, ...documents) {
	for (const document of documents) {
		document.parent = scene;
		scene[SCENE_COLLECTIONS[document.documentName]].contents.push(document);
	}
	return documents.length === 1 ? documents[0] : documents;
}

/** Take an embedded document off its scene, as Foundry does before its delete hook. */
function unplace(scene, document) {
	const contents = scene[SCENE_COLLECTIONS[document.documentName]].contents;
	contents.splice(contents.indexOf(document), 1);
}

/** Install a scene as the one the tray is looking at, and who is looking. */
function stage(scene, { isGM = true } = {}) {
	globalThis.game.scenes = new Map(scene ? [[scene.id, scene]] : []);
	globalThis.canvas.scene = scene;
	globalThis.game.user = { id: "user-1", isGM };
	// Every document a command could resolve. A row is only ever routed by its
	// exact UUID, so this is the whole world as far as the bindings are
	// concerned. Read through a function rather than snapshotted, because a
	// test can add or retarget a document after staging.
	globalThis.fromUuidSync = uuid => {
		for (const collection of Object.values(SCENE_COLLECTIONS)) {
			for (const document of scene?.[collection]?.contents ?? []) {
				if (document.uuid === uuid) return document;
				if (document.actor?.uuid === uuid) return document.actor;
			}
		}
		return null;
	};
	return scene;
}

// --- driving the registered hooks -------------------------------------------

/**
 * Call the handlers `initTray()` registered for a hook, the way Foundry calls
 * them: all of them, in registration order, with the arguments Foundry passes.
 *
 * A hook nobody listens to is a failure rather than a no-op — a test that
 * silently fires nothing would pass for the wrong reason forever.
 */
async function fire(name, ...args) {
	const listeners = hooks.filter(hook => hook.name === name);
	assert.ok(listeners.length > 0, `no handler is registered for the ${name} hook`);
	for (const listener of listeners) await listener.fn(...args);
}

/** Whether `initTray()` registered anything at all for a hook. */
function isRegistered(name) {
	return hooks.some(hook => hook.name === name);
}

/** Everything the tray was last handed, as `group:uuid` pairs in render order. */
function publishedRows() {
	return (TrayApp._instance.trayData.noteGroups ?? [])
		.flatMap(group => group.rows.map(row => `${group.id}:${row.sourceUuid}`));
}

/** What each row reads as, and whether it is showing as shared. */
function publishedLabels() {
	return (TrayApp._instance.trayData.noteGroups ?? [])
		.flatMap(group => group.rows.map(row => [row.displayName, row.isVisible]));
}

/**
 * Put the tray on the Notes tab looking at `scene`, with a clock the test
 * drives and nothing left in flight.
 */
async function showNotes(t, scene, options) {
	stage(scene, options);
	tray.start();
	const clock = useDebounceClock(t);
	await tray.showView("notes");
	await clock.idle();
	return clock;
}

// --- 1. the registered hook matrix ------------------------------------------

// Ticket 4 requires registered create/update/delete coverage for all six
// supported source types. This asks only what was installed; the behavioural
// matrix below is what proves each registration does something.
test("all six supported types have create, update and delete hooks registered", async t => {
	await showNotes(t, makeScene());

	const missing = [];
	for (const type of ["Token", "Actor", "Tile", "Wall", "AmbientLight", "AmbientSound"]) {
		for (const verb of ["create", "update", "delete"]) {
			if (!isRegistered(`${verb}${type}`)) missing.push(`${verb}${type}`);
		}
	}

	assert.deepEqual(missing, [], "the tray registers no handler for these");

	// The scene itself changing is the seventh lifecycle event, and the one that
	// invalidates every row at once.
	assert.ok(isRegistered("canvasReady"), "a scene change would never rebuild the index");
});

// --- 2. the behavioural lifecycle matrix ------------------------------------
//
// A registration that exists and does nothing passes the test above. This one
// drives every create/update/delete hook for every supported type and asks what
// the tray was handed afterwards, so a no-op handler cannot survive.
//
// Each entry describes one type's whole lifecycle against a scene that already
// holds an unrelated noted Tile — the control that tells "the row went" apart
// from "the index collapsed".

const CONTROL_ROW = "tiles:Scene.scene-a.Tile.control";

/** A scene holding one unrelated noted Tile, as the control row. */
function sceneWithControl(id = "scene-a") {
	const scene = makeScene(id);
	place(scene, noted("Tile", `Scene.${id}.Tile.control`, { name: "Control" }));
	return scene;
}

/**
 * How each supported type arrives in, changes within, and leaves the index.
 *
 * Token/Tile/Wall/Light/Sound are embedded documents: they arrive and leave
 * their scene collection. An Actor is not on a scene at all — it is in the
 * index because a Token there represents it — so it arrives and leaves by
 * becoming resolvable through a Token that stays put the whole time.
 */
const LIFECYCLE = [
	{
		type: "Token", group: "tokens", uuid: "Scene.scene-a.Token.t1",
		arrive(scene) {
			return place(scene, noted("Token", this.uuid, { name: "Grix" }));
		},
		depart(scene, document) {
			unplace(scene, document);
		},
	},
	{
		type: "Tile", group: "tiles", uuid: "Scene.scene-a.Tile.t1",
		arrive(scene) {
			return place(scene, noted("Tile", this.uuid, { name: "Mural" }));
		},
		depart(scene, document) {
			unplace(scene, document);
		},
	},
	{
		type: "Wall", group: "walls", uuid: "Scene.scene-a.Wall.w1",
		arrive(scene) {
			return place(scene, noted("Wall", this.uuid, { c: [0, 0, 100, 100] }));
		},
		depart(scene, document) {
			unplace(scene, document);
		},
	},
	{
		type: "AmbientLight", group: "lights", uuid: "Scene.scene-a.AmbientLight.l1",
		arrive(scene) {
			return place(scene, noted("AmbientLight", this.uuid));
		},
		depart(scene, document) {
			unplace(scene, document);
		},
	},
	{
		type: "AmbientSound", group: "sounds", uuid: "Scene.scene-a.AmbientSound.s1",
		arrive(scene) {
			return place(scene, noted("AmbientSound", this.uuid, { path: "a/bell.ogg" }));
		},
		depart(scene, document) {
			unplace(scene, document);
		},
	},
	{
		type: "Actor", group: "actors", uuid: "Actor.a1",
		// The Token is put down first and never moves: what arrives and leaves
		// is the Actor it points at, which is exactly the case Token
		// creation/deletion cannot speak for.
		carrier(scene) {
			return place(scene, unnoted("Token", "Scene.scene-a.Token.carrier", { name: "Grix" }));
		},
		arrive(scene) {
			const token = scene.tokens.contents.find(t => t.uuid === "Scene.scene-a.Token.carrier")
				?? this.carrier(scene);
			token.actor = noted("Actor", this.uuid, { name: "Grix" });
			return token.actor;
		},
		depart(scene) {
			scene.tokens.contents.find(t => t.uuid === "Scene.scene-a.Token.carrier").actor = null;
		},
	},
];

for (const entry of LIFECYCLE) {
	const row = `${entry.group}:${entry.uuid}`;

	test(`a noted ${entry.type} created on the scene reaches its group`, async t => {
		const scene = sceneWithControl();
		entry.carrier?.(scene);
		const clock = await showNotes(t, scene);
		traceEnrichment(t);
		assert.deepEqual(publishedRows(), [CONTROL_ROW], `the ${entry.type} is not there yet`);

		const document = entry.arrive(scene);
		await fire(`create${entry.type}`, document, {}, "user-1");
		await clock.settle();

		assert.ok(publishedRows().includes(row), `create${entry.type} did not add the row`);
		assert.ok(publishedRows().includes(CONTROL_ROW), "and the control row is still there");
	});

	test(`a note saved on an existing ${entry.type} reaches its group`, async t => {
		const scene = sceneWithControl();
		entry.carrier?.(scene);
		const document = entry.arrive(scene);
		// On the scene, but with nothing to index yet: the note is what the
		// update adds.
		delete document.flags[MODULE_ID].notes;
		const clock = await showNotes(t, scene);
		traceEnrichment(t);
		assert.deepEqual(publishedRows(), [CONTROL_ROW], `the ${entry.type} has no note yet`);

		document.flags[MODULE_ID].notes = `<p>body of ${entry.uuid}</p>`;
		await fire(`update${entry.type}`, document, {
			_id: document.id,
			flags: { [MODULE_ID]: { notes: "<p>saved</p>" } },
		});
		await clock.settle();

		assert.ok(publishedRows().includes(row), `update${entry.type} did not add the row`);
	});

	test(`a noted ${entry.type} deleted from the scene leaves its group`, async t => {
		const scene = sceneWithControl();
		entry.carrier?.(scene);
		const document = entry.arrive(scene);
		const clock = await showNotes(t, scene);
		traceEnrichment(t);
		assert.ok(publishedRows().includes(row), "the row is there to begin with");

		entry.depart(scene, document);
		await fire(`delete${entry.type}`, document, {}, "user-1");
		await clock.settle();

		assert.ok(!publishedRows().includes(row), `delete${entry.type} did not remove the row`);
		assert.deepEqual(publishedRows(), [CONTROL_ROW],
			"and it took nothing else with it");
	});
}

// --- 3. Actor arrival and departure with the Token standing still ------------
//
// The matrix above proves the Actor hooks fire. These two say what makes them
// necessary: in both, the representing Token is on the scene before and after,
// so no Token lifecycle event happens at all and nothing else would rebuild.

test("an Actor's row appears while its representing Token never moves", async t => {
	const scene = sceneWithControl();
	const token = place(scene, noted("Token", "Scene.scene-a.Token.t1", { name: "Grix" }));
	const clock = await showNotes(t, scene);
	traceEnrichment(t);

	assert.deepEqual(publishedRows(), ["tokens:Scene.scene-a.Token.t1", CONTROL_ROW]);

	// The Actor the Token has always pointed at becomes resolvable.
	token.actor = noted("Actor", "Actor.a1", { name: "Grix" });
	await fire("createActor", token.actor, {}, "user-1");
	await clock.settle();

	assert.deepEqual(publishedRows(),
		["tokens:Scene.scene-a.Token.t1", "actors:Actor.a1", CONTROL_ROW],
		"the Actor row arrived without its Token being created or deleted");
});

test("an Actor's row disappears while its representing Token stays on the scene", async t => {
	const scene = sceneWithControl();
	const token = place(scene, noted("Token", "Scene.scene-a.Token.t1", { name: "Grix" }));
	token.actor = noted("Actor", "Actor.a1", { name: "Grix" });
	const clock = await showNotes(t, scene);
	traceEnrichment(t);

	assert.deepEqual(publishedRows(),
		["tokens:Scene.scene-a.Token.t1", "actors:Actor.a1", CONTROL_ROW]);

	const actor = token.actor;
	token.actor = null;
	await fire("deleteActor", actor, {}, "user-1");
	await clock.settle();

	assert.deepEqual(publishedRows(), ["tokens:Scene.scene-a.Token.t1", CONTROL_ROW],
		"the stale Actor row was still being shown");
});

// --- 4. a saved note that shares an update with a movement ------------------

// A note is saved by writing a flag, and a flag write can arrive in the same
// document update as a movement — a compound `TokenDocument.update()`, an undo
// of one, or any module that batches the two.
test("a note saved in the same update that moved the Token still reaches the tray", async t => {
	const scene = makeScene();
	const token = place(scene, unnoted("Token", "Scene.scene-a.Token.t1", { name: "Grix" }));
	const clock = await showNotes(t, scene);
	traceEnrichment(t);

	assert.deepEqual(publishedRows(), [], "the Token has no note yet");

	token.flags[MODULE_ID].notes = "<p>body of Scene.scene-a.Token.t1</p>";
	await fire("updateToken", token, {
		_id: "t1",
		x: 500,
		y: 600,
		flags: { [MODULE_ID]: { notes: "<p>saved</p>" } },
	});
	await clock.settle();

	assert.deepEqual(publishedRows(), ["tokens:Scene.scene-a.Token.t1"]);
});

// The same defect one field along. A Token's note is its own, but the ACTOR row
// it contributes belongs to whatever Actor it represents — so an update that
// reassigns that while also moving the token retires one row and raises
// another. Read as "has a movement key and no listed exception", every shape
// below looks like a drag.
//
// The exact V14 differential for each of these is a live-matrix confirmation;
// what is under test here is that the tray does not decide by consulting a list
// of fields it happens to know about.
const IDENTITY_CHANGES = [
	{ what: "actorId", changes: { actorId: "a2" } },
	{ what: "actorLink", changes: { actorLink: true } },
	{ what: "delta", changes: { delta: { flags: { [MODULE_ID]: { notes: "<p>x</p>" } } } } },
];

for (const { what, changes } of IDENTITY_CHANGES) {
	test(`a Token that moved and changed the Actor it represents (${what}) retires the old row`, async t => {
		const scene = makeScene();
		const token = place(scene, unnoted("Token", "Scene.scene-a.Token.t1", { name: "Grix" }));
		token.actor = noted("Actor", "Actor.old", { name: "Grix" });
		const clock = await showNotes(t, scene);
		traceEnrichment(t);

		assert.deepEqual(publishedRows(), ["actors:Actor.old"]);

		// Foundry has already applied the update by the time the hook fires, so
		// the Token now reaches a different Actor.
		token.actor = noted("Actor", "Actor.new", { name: "Grix" });
		await fire("updateToken", token, { _id: "t1", x: 500, ...changes });
		await clock.settle();

		assert.deepEqual(publishedRows(), ["actors:Actor.new"],
			"the tray kept showing the Actor this Token no longer represents");
	});
}

// --- 5. a deleted note takes its own row and nothing else --------------------

test("deleting a Token's note leaves its same-named Actor's note in place", async t => {
	const scene = makeScene();
	const token = place(scene, noted("Token", "Scene.scene-a.Token.t1", { name: "Grix" }));
	token.actor = noted("Actor", "Actor.a1", { name: "Grix" });
	const clock = await showNotes(t, scene);
	traceEnrichment(t);

	assert.deepEqual(publishedRows(),
		["tokens:Scene.scene-a.Token.t1", "actors:Actor.a1"],
		"both same-named rows are there to begin with");

	// What `unsetFlag` produces: the note key is removed from the document, and
	// the update names the deletion.
	delete token.flags[MODULE_ID].notes;
	await fire("updateToken", token, { _id: "t1", flags: { [MODULE_ID]: { "-=notes": null } } });
	await clock.settle();

	assert.deepEqual(publishedRows(), ["actors:Actor.a1"],
		"the Token row went and the identically named Actor row stayed");
});

// --- 6. renaming and sharing are the same refresh, seen from the tray -------

test("renaming a note's label updates that row and moves it into its sorted place", async t => {
	const scene = makeScene();
	const [alpha] = place(scene,
		noted("Tile", "Scene.scene-a.Tile.t1", { name: "Alpha" }),
		noted("Tile", "Scene.scene-a.Tile.t2", { name: "Beta" }));
	const clock = await showNotes(t, scene);
	traceEnrichment(t);

	assert.deepEqual(publishedLabels().map(([name]) => name), ["Alpha", "Beta"]);

	alpha.flags[MODULE_ID].customName = "Zeta";
	await fire("updateTile", alpha, { _id: "t1", flags: { [MODULE_ID]: { customName: "Zeta" } } });
	await clock.settle();

	assert.deepEqual(publishedLabels().map(([name]) => name), ["Beta", "Zeta"],
		"the renamed row is relabelled and re-sorted, and there is still only one of it");
});

test("a player's list follows the same refresh, and shows only what was shared", async t => {
	const scene = makeScene();
	const [shared, hidden] = place(scene,
		noted("Tile", "Scene.scene-a.Tile.shared", { name: "Mural" }),
		noted("Tile", "Scene.scene-a.Tile.hidden", { name: "Trap" }));
	const clock = await showNotes(t, scene, { isGM: false });
	traceEnrichment(t);

	assert.deepEqual(publishedRows(), [], "nothing is shared yet");

	shared.flags[MODULE_ID].noteVisible = true;
	await fire("updateTile", shared, {
		_id: "shared", flags: { [MODULE_ID]: { noteVisible: true } },
	});
	await clock.settle();

	assert.deepEqual(publishedRows(), ["tiles:Scene.scene-a.Tile.shared"]);
	assert.equal(TrayApp._instance.trayData.noteGroups[0].count, 1,
		"the count is what this viewer was shown, so it cannot hint at the hidden note");
	assert.ok(hidden.flags[MODULE_ID].notes, "positive control: the hidden note does exist");
});

// --- 7. the last Token of an Actor going takes the Actor row with it ---------

test("deleting the last Token representing an Actor removes the Actor's row too", async t => {
	const scene = makeScene();
	const token = place(scene, noted("Token", "Scene.scene-a.Token.t1", { name: "Grix" }));
	token.actor = noted("Actor", "Actor.a1", { name: "Grix" });
	const clock = await showNotes(t, scene);
	traceEnrichment(t);

	assert.deepEqual(publishedRows(), ["tokens:Scene.scene-a.Token.t1", "actors:Actor.a1"]);

	unplace(scene, token);
	await fire("deleteToken", token, {}, "user-1");
	await clock.settle();

	assert.deepEqual(publishedRows(), [],
		"an Actor is in a scene index only while a Token there represents it");
});

test("one of two Tokens going leaves the Actor row, still deduplicated", async t => {
	const scene = makeScene();
	const [left, right] = place(scene,
		noted("Token", "Scene.scene-a.Token.a", { name: "Grix (left)" }),
		noted("Token", "Scene.scene-a.Token.b", { name: "Grix (right)" }));
	// Two DISTINCT Actor objects carrying one exact UUID, which is what two
	// linked tokens hand you: identity is the UUID, not the reference.
	left.actor = noted("Actor", "Actor.a1", { name: "Grix" });
	right.actor = noted("Actor", "Actor.a1", { name: "Grix" });
	const clock = await showNotes(t, scene);
	traceEnrichment(t);

	assert.deepEqual(publishedRows(), [
		"tokens:Scene.scene-a.Token.a",
		"tokens:Scene.scene-a.Token.b",
		"actors:Actor.a1",
	], "two Token rows and a single Actor row");

	unplace(scene, left);
	await fire("deleteToken", left, {}, "user-1");
	await clock.settle();

	assert.deepEqual(publishedRows(),
		["tokens:Scene.scene-a.Token.b", "actors:Actor.a1"],
		"the surviving Token still represents the Actor");
});

test("a command against an Actor row whose last Token has gone writes nothing", async t => {
	const scene = makeScene();
	const token = place(scene, noted("Token", "Scene.scene-a.Token.t1", { name: "Grix" }));
	token.actor = noted("Actor", "Actor.a1", { name: "Grix" });
	const clock = await showNotes(t, scene);
	traceEnrichment(t);

	// The row as it was rendered, before the Token went. Its identity is all a
	// command is ever given.
	const rendered = { noteUuid: "Actor.a1", noteType: "Actor" };
	const actor = token.actor;

	// The non-vacuity probe: while the Token is still there the very same fired
	// control does write, so the empty `calls` below is the staleness check
	// refusing and not the click failing to arrive.
	await fireRowControl(rendered, "toggle-visibility");
	assert.deepEqual(actor.calls.filter(call => call.startsWith("setFlag")),
		["setFlag:noteVisible=true"], "the command does reach the Actor while its Token is here");

	unplace(scene, token);
	await fire("deleteToken", token, {}, "user-1");
	await clock.settle();

	assert.deepEqual(publishedRows(), [], "the row is gone from the list");

	actor.calls.length = 0;
	await fireRowControl(rendered, "toggle-visibility");

	assert.deepEqual(actor.calls, [],
		"the stale row's command resolved the Actor and then left it alone");
});

/**
 * Fire a row command the way a click does: through the binding a render
 * registered, on a row carrying exactly these data attributes.
 */
async function fireRowControl(dataset, action) {
	const dom = makeSelectorDom({
		seedAll: true,
		lists: {
			".note-control": [{ dataset: { action } }],
			".note-entry": [{ dataset }],
		},
	});
	const previousDocument = globalThis.document;
	globalThis.document = dom.document;
	dom.closestResults.set(".note-entry", dom.node(".sdx-tray .note-entry[0]"));
	dom.closestResults.set(".note-controls", null);
	try {
		TrayApp._instance._bindPlaceableNoteEvents(dom.node(".sdx-tray"));
		await dom.fire(".sdx-tray .note-control[0]", "click");
	}
	finally {
		globalThis.document = previousDocument;
	}
}

// --- 8. a scene change replaces everything ----------------------------------

test("the canvasReady hook rebuilds the index from the scene that is now active", async t => {
	const sceneA = makeScene("scene-a");
	place(sceneA, noted("Tile", "Scene.scene-a.Tile.t1", { name: "Mural" }));
	const clock = await showNotes(t, sceneA);
	traceEnrichment(t);

	const sceneB = makeScene("scene-b");
	place(sceneB, noted("Wall", "Scene.scene-b.Wall.w1", { c: [0, 0, 50, 50] }));
	stage(sceneB);
	await fire("canvasReady");
	await clock.settle();

	assert.deepEqual(publishedRows(), ["walls:Scene.scene-b.Wall.w1"]);
	assert.equal(TrayApp._instance.trayData.noteSceneId, "scene-b");
});

test("a scene change through canvasReady forgets where the user was in the old list", async t => {
	const sceneA = makeScene("scene-a");
	place(sceneA, noted("Tile", "Scene.scene-a.Tile.t1", { name: "Mural" }));
	const clock = await showNotes(t, sceneA);
	traceEnrichment(t);

	const app = TrayApp._instance;
	// ApplicationV2 builds its context as part of rendering; the harness's stub
	// application does not, so the render that showed scene A is finished by
	// hand. A user cannot fold a group that was never drawn for them.
	await app._prepareContext({});
	app._collapsedNoteGroups.add("tiles");
	app._expandedNoteRows.add("Scene.scene-a.Tile.t1");

	const sceneB = makeScene("scene-b");
	place(sceneB, noted("Tile", "Scene.scene-b.Tile.t9", { name: "Fresco" }));
	stage(sceneB);
	await fire("canvasReady");
	await clock.settle();
	const context = await app._prepareContext({});

	assert.deepEqual(context.noteGroups.map(group => [group.id, group.collapsed]),
		[["tiles", false]],
		"the new scene's Tiles group is not folded by the old scene's fold");
	assert.deepEqual([...app._expandedNoteRows], [],
		"and no row key survived from a scene nobody is on");
});

// --- 9. movement is still free, and panning still finds the token -----------

// CHARACTERIZATION: the position-only skip predates this ticket. It is asserted
// here because the predicate was rewritten to decide by the complete set of
// changed keys, and a rewrite that went one field too far would make every step
// of a token rebuild and re-enrich the whole Notes tab.
//
// `_id` rides along on every embedded-document differential — it is how Foundry
// routes the update — so a plain drag is never a bare `{x, y}`.
test("a Token moving does not rebuild the Notes tab", async t => {
	const scene = makeScene();
	const token = place(scene, noted("Token", "Scene.scene-a.Token.t1", { name: "Grix" }));
	const clock = await showNotes(t, scene);
	const enriched = traceEnrichment(t);

	for (const changes of [{ x: 100 }, { y: 200 }, { x: 300, y: 400 }, { rotation: 90 },
		{ elevation: 5 }, { x: 10, y: 20, rotation: 45, elevation: 1 }]) {
		await fire("updateToken", token, { _id: "t1", ...changes });
	}
	await clock.settle();

	assert.deepEqual(enriched, [], "a token step re-enriched the scene's notes");

	// The positive control: the same hook, the same token, a change that is not
	// a movement. Without it the empty result above could be a broken fixture.
	await fire("updateToken", token, { _id: "t1", name: "Grix the Bold" });
	await clock.settle();
	assert.ok(enriched.length > 0, "the hook itself is live");
});

// A differential with nothing semantic left in it is not something the tray
// can learn anything from. `_id` and `_stats` are Foundry's own bookkeeping —
// the contract above the handler says they are never a reason to rebuild
// anything — so an update that carries only those, or carries no field at all,
// must cost exactly what a step costs: nothing.
//
// Hook traffic like this is not hypothetical. A bare `_id` differential is
// what a no-op save produces, and `_stats` rides along with the ones that
// change nothing else. Paying for a full re-enrichment of a large scene for
// them is the same performance hole the movement skip exists to close.
test("a Token update carrying only Foundry's bookkeeping does not rebuild the Notes tab", async t => {
	const scene = makeScene();
	const token = place(scene, noted("Token", "Scene.scene-a.Token.t1", { name: "Grix" }));
	const clock = await showNotes(t, scene);
	const enriched = traceEnrichment(t);

	for (const changes of [
		{},
		{ _id: "t1" },
		{ _stats: { modifiedTime: 1 } },
		{ _id: "t1", _stats: { modifiedTime: 2 } },
	]) {
		await fire("updateToken", token, changes);
		await clock.settle();

		assert.deepEqual(enriched, [], `${JSON.stringify(changes)} rebuilt the Notes tab`);
	}

	// The positive control: the same hook and the same token, changing a field
	// the tray does read. Without it the four empty results above could be a
	// fixture that never rebuilds for anything.
	await fire("updateToken", token, { _id: "t1", name: "Grix the Bold" });
	await clock.settle();
	assert.ok(enriched.length > 0, "the hook itself is live");
});

// Skipping has to be a return and nothing else. A skip that cancelled the
// pending refresh on its way out would let bookkeeping traffic — which Foundry
// sends freely, and which no user asked for — swallow the rebuild a real change
// had already scheduled, and the tray would sit showing the old rows.
//
// The clock is advanced in two partial steps rather than one, because that is
// what tells the two implementations apart: the semantic refresh is due 100ms
// after the change that asked for it, and only an implementation that restarted
// that timer is still waiting when the window closes.
test("a bookkeeping-only Token update does not cancel a rebuild already pending", async t => {
	const scene = makeScene();
	const token = place(scene, noted("Token", "Scene.scene-a.Token.t1", { name: "Grix" }));
	const clock = await showNotes(t, scene);
	const enriched = traceEnrichment(t);

	await fire("updateToken", token, { _id: "t1", name: "Grix the Bold" });
	await clock.settle(60);
	assert.deepEqual(enriched, [], "the semantic refresh ran before its debounce window closed");

	await fire("updateToken", token, { _id: "t1" });
	await clock.settle(60);

	assert.ok(enriched.length > 0, "a bookkeeping-only update swallowed the rebuild already due");
	await clock.settle();
});

// The clock these tests run on is a mock, which is only honest if the thing it
// is standing in for is still under test. The tray coalesces a burst of
// document updates into one rebuild, and cancels the pending one each time —
// so a bulk edit costs one enrichment pass, not one per document. Driving the
// timer rather than waiting for it must not quietly turn that into per-update
// rebuilds, or into no rebuild at all.
test("a burst of note saves is coalesced into a single rebuild", async t => {
	const scene = makeScene();
	const tiles = place(scene,
		noted("Tile", "Scene.scene-a.Tile.t1", { name: "One" }),
		noted("Tile", "Scene.scene-a.Tile.t2", { name: "Two" }),
		noted("Tile", "Scene.scene-a.Tile.t3", { name: "Three" }));
	const clock = await showNotes(t, scene);
	const enriched = traceEnrichment(t);

	// Three documents changed inside one debounce window, as a bulk update or a
	// paste of several tiles would produce.
	for (const tile of tiles) {
		await fire("updateTile", tile, {
			_id: tile.id, flags: { [MODULE_ID]: { notes: "<p>saved</p>" } },
		});
	}
	// Nothing has run yet: the refresh is still pending, and each update
	// replaced the last one's timer rather than adding to it.
	await clock.idle();
	assert.deepEqual(enriched, [], "a refresh ran before its debounce window closed");

	await clock.settle();

	assert.equal(enriched.length, 3,
		"three rows enriched once each — one rebuild, not one per update");
});

test("a door opening does not rebuild the Notes tab, but a Wall note saved does", async t => {
	const scene = makeScene();
	const wall = place(scene, noted("Wall", "Scene.scene-a.Wall.w1", { c: [0, 0, 100, 100] }));
	const clock = await showNotes(t, scene);
	const enriched = traceEnrichment(t);

	await fire("updateWall", wall, { ds: 1 });
	await clock.settle();
	assert.deepEqual(enriched, [], "opening a door re-enriched the scene's notes");

	await fire("updateWall", wall, { flags: { [MODULE_ID]: { notes: "<p>saved</p>" } } });
	await clock.settle();
	assert.ok(enriched.length > 0, "a Wall note saved did not reach the tray");
});

test("panning to a Token that moved without a rerender uses where it is now", async t => {
	const scene = makeScene();
	const token = place(scene, noted("Token", "Scene.scene-a.Token.t1", { name: "Grix" }));
	const clock = await showNotes(t, scene);
	traceEnrichment(t);

	// The drawn placeable, which is where a current position lives. The document
	// records where the token was saved; the placeable is where it is now.
	const placeable = { id: "t1", center: { x: 100, y: 100 }, controlled: false };
	const pans = [];
	Object.assign(globalThis.canvas, {
		tokens: { controlled: [], placeables: [], get: id => (id === "t1" ? placeable : undefined) },
		animatePan: target => pans.push(target),
	});
	t.after(() => {
		globalThis.canvas.tokens = { controlled: [], placeables: [] };
	});

	await fire("updateToken", token, { _id: "t1", x: 900, y: 900 });
	await clock.settle();
	placeable.center = { x: 900, y: 900 };

	await fireRowControl({ noteUuid: "Scene.scene-a.Token.t1", noteType: "Token" }, "pan");

	assert.deepEqual(pans.map(pan => [pan.x, pan.y]), [[900, 900]],
		"the pan used the rendered row's stale coordinates");
});

// --- 10. one broken note does not cost the scene its index -------------------

test("a note that fails to enrich leaves every other row in the rebuilt list", async t => {
	const scene = makeScene();
	place(scene,
		noted("Tile", "Scene.scene-a.Tile.good", { name: "Mural" }),
		noted("Tile", "Scene.scene-a.Tile.broken", { name: "Statue" }));
	const clock = await showNotes(t, scene);
	traceEnrichment(t, { failFor: "Scene.scene-a.Tile.broken" });
	captureConsole(t);

	const wall = place(scene, noted("Wall", "Scene.scene-a.Wall.w1", { c: [0, 0, 100, 100] }));
	await fire("createWall", wall, {}, "user-1");
	await clock.settle();

	assert.deepEqual(publishedRows(), [
		"tiles:Scene.scene-a.Tile.good",
		"tiles:Scene.scene-a.Tile.broken",
		"walls:Scene.scene-a.Wall.w1",
	], "the broken note kept its own row and cost no other row its place");
});

test("a note that fails to enrich produces one warning and no error", async t => {
	const scene = makeScene();
	const [good] = place(scene,
		noted("Tile", "Scene.scene-a.Tile.good", { name: "Mural" }),
		noted("Tile", "Scene.scene-a.Tile.broken", { name: "Statue" }));
	const clock = await showNotes(t, scene);
	traceEnrichment(t, { failFor: "Scene.scene-a.Tile.broken" });
	const logged = captureConsole(t);

	await fire("updateTile", good, {
		_id: "good", flags: { [MODULE_ID]: { notes: "<p>saved</p>" } },
	});
	await clock.settle();

	assert.equal(logged.warn.length, 1, `expected one warning, got ${JSON.stringify(logged.warn)}`);
	assert.match(logged.warn[0], /Scene\.scene-a\.Tile\.broken/,
		"the diagnostic says which note to go and look at");
	assert.deepEqual(logged.error, [],
		"a note this module can recover from was reported as an error");

	// Neither the note nor anything the enricher wrote reaches a shared console.
	assert.ok(!logged.warn[0].includes("body of Scene.scene-a.Tile.broken"),
		"the broken note's content reached the console");
	assert.ok(!logged.warn[0].includes("unparseable note"),
		"the enricher's own error message reached the console");
});

/** Everything the module says to the console while a test runs. */
function captureConsole(t) {
	const logged = { warn: [], error: [] };
	const previous = { warn: console.warn, error: console.error };
	console.warn = (...args) => logged.warn.push(args.map(String).join(" "));
	console.error = (...args) => logged.error.push(args.map(String).join(" "));
	t.after(() => Object.assign(console, previous));
	return logged;
}

// --- 11. the inactive-view gate survives the lifecycle ----------------------

// The gate is proved for a tab switch in placeable-note-groups.test.mjs. This is
// the other way into a render: a document changing. Every hook above rebuilds
// the tray, and a rebuild while the user is on another tab must still enrich
// nothing — otherwise a busy scene pays for the Notes tab on every view.
test("no lifecycle hook enriches a note while another tab is showing", async t => {
	const scene = makeScene();
	const [token, tile, wall] = place(scene,
		noted("Token", "Scene.scene-a.Token.t1", { name: "Grix" }),
		noted("Tile", "Scene.scene-a.Tile.t1", { name: "Mural" }),
		noted("Wall", "Scene.scene-a.Wall.w1", { c: [0, 0, 100, 100] }));
	token.actor = noted("Actor", "Actor.a1", { name: "Grix" });
	const clock = await showNotes(t, scene);
	const enriched = traceEnrichment(t);

	for (const mode of ["scenes", "party", "pins", "hexes", "dungeons", "decor"]) {
		await tray.showView(mode);
		enriched.length = 0;

		await fire("updateToken", token, { _id: "t1", flags: { [MODULE_ID]: { notes: "<p>a</p>" } } });
		await fire("createActor", token.actor, {}, "user-1");
		await fire("updateActor", token.actor, { flags: { [MODULE_ID]: { notes: "<p>b</p>" } } });
		await fire("deleteActor", token.actor, {}, "user-1");
		await fire("createToken", token, {}, "user-1");
		await fire("deleteToken", token, {}, "user-1");
		await fire("updateTile", tile, { _id: "t1", flags: { [MODULE_ID]: { notes: "<p>c</p>" } } });
		await fire("createWall", wall, {}, "user-1");
		await fire("deleteWall", wall, {}, "user-1");
		await fire("canvasReady");
		await clock.settle();

		assert.deepEqual(enriched, [], `a lifecycle hook enriched a note in the ${mode} view`);
	}

	// The positive control: the same hooks, on the tab that does show notes.
	await tray.showView("notes");
	enriched.length = 0;
	await fire("updateTile", tile, { _id: "t1", flags: { [MODULE_ID]: { notes: "<p>d</p>" } } });
	await clock.settle();
	assert.ok(enriched.length > 0,
		"the Notes tab enriches, so the empty results above are a gate and not an empty scene");
});

// --- 12. the command reaches the tray only through the document hook ---------
//
// The tests above supply a document update and ask what the tray does with it.
// These start one step earlier, at the rendered control a GM clicks, and ask
// whether the command reaches the list at all except through that update.
//
// The bridge is a stand-in, and a deliberately narrow one: a real `setFlag`
// goes to the server, comes back over a socket, and is applied to a document
// before any listener hears about it. What is modelled here is only the ORDER —
// the write happens, and the rebuild happens because of the broadcast it
// causes, not alongside it. It is not Foundry's persistence, its differential
// shapes, or its permissions, and none of those are claimed; the live matrix
// owns them.
//
// The proof it does support is the one commentary cannot: with the broadcast
// silenced, the list must not change. That is what "no optimistic state" means,
// and it is why each test below runs the same command twice.

/**
 * Wire a document double so a flag write broadcasts the update hook Foundry
 * would broadcast for it, and hand back a switch to silence that broadcast.
 */
function bridgeWritesToHooks(document) {
	const bridge = { live: true };
	document.emitUpdate = async changes => {
		if (!bridge.live) return;
		await fire(`update${document.documentName}`, document, { _id: document.id, flags: changes });
	};
	return bridge;
}

test("the visibility control changes the list only through the update it causes", async t => {
	const scene = makeScene();
	const tile = place(scene, noted("Tile", "Scene.scene-a.Tile.t1", { name: "Mural" }));
	const bridge = bridgeWritesToHooks(tile);
	const clock = await showNotes(t, scene);
	traceEnrichment(t);
	const rendered = { noteUuid: "Scene.scene-a.Tile.t1", noteType: "Tile" };

	// Silenced: the command still writes, and the list must not notice.
	bridge.live = false;
	await fireRowControl(rendered, "toggle-visibility");
	await clock.settle();

	assert.deepEqual(tile.calls.filter(call => call.startsWith("setFlag")),
		["setFlag:noteVisible=true"], "the command did write the exact source's flag");
	assert.deepEqual(publishedLabels(), [["Mural", false]],
		"the list changed without a document update — the row was patched optimistically");

	// Live: the same command, and now the broadcast is what moves the list.
	bridge.live = true;
	await fireRowControl(rendered, "toggle-visibility");
	await clock.settle();

	assert.deepEqual(publishedLabels(), [["Mural", false]],
		"toggling twice returns the row to where it started");

	await fireRowControl(rendered, "toggle-visibility");
	await clock.settle();
	assert.deepEqual(publishedLabels(), [["Mural", true]], "and the hook-driven rebuild shows it");
});

test("the rename control changes the list only through the update it causes", async t => {
	const scene = makeScene();
	const tile = place(scene, noted("Tile", "Scene.scene-a.Tile.t1", { name: "Alpha" }));
	const bridge = bridgeWritesToHooks(tile);
	const clock = await showNotes(t, scene);
	traceEnrichment(t);
	const dialogs = captureDialogs(t);
	const rendered = { noteUuid: "Scene.scene-a.Tile.t1", noteType: "Tile" };

	bridge.live = false;
	await fireRowControl(rendered, "rename");
	await saveRename(dialogs, "Zeta");
	await clock.settle();

	assert.deepEqual(tile.calls.filter(call => call.startsWith("setFlag")),
		["setFlag:customName=Zeta"], "the command did write the exact source's flag");
	assert.deepEqual(publishedLabels().map(([name]) => name), ["Alpha"],
		"the list changed without a document update — the row was patched optimistically");

	bridge.live = true;
	await fireRowControl(rendered, "rename");
	await saveRename(dialogs, "Omega");
	await clock.settle();

	assert.deepEqual(publishedLabels().map(([name]) => name), ["Omega"]);
});

test("the delete control changes the list only through the update it causes", async t => {
	const scene = makeScene();
	const [doomed] = place(scene,
		noted("Tile", "Scene.scene-a.Tile.t1", { name: "Alpha" }),
		noted("Tile", "Scene.scene-a.Tile.t2", { name: "Beta" }));
	const bridge = bridgeWritesToHooks(doomed);
	const clock = await showNotes(t, scene);
	traceEnrichment(t);
	confirmDeletes(t, true);
	const rendered = { noteUuid: "Scene.scene-a.Tile.t1", noteType: "Tile" };

	bridge.live = false;
	await fireRowControl(rendered, "delete");
	await clock.settle();

	assert.deepEqual(doomed.calls.filter(call => call.startsWith("unsetFlag")),
		["unsetFlag:notes", "unsetFlag:noteVisible"],
		"the command did remove the note and its sharing from the exact source");
	assert.deepEqual(publishedRows(),
		["tiles:Scene.scene-a.Tile.t1", "tiles:Scene.scene-a.Tile.t2"],
		"the list changed without a document update — the row was dropped optimistically");

	// Live: the note is put back so the same command can run again, and this
	// time the broadcast the delete itself causes is what the list learns from.
	doomed.flags[MODULE_ID].notes = "<p>body of Scene.scene-a.Tile.t1</p>";
	bridge.live = true;
	doomed.calls.length = 0;
	await fireRowControl(rendered, "delete");
	await clock.settle();

	assert.deepEqual(doomed.calls.filter(call => call.startsWith("unsetFlag")),
		["unsetFlag:notes", "unsetFlag:noteVisible"], "the same command ran again");
	assert.deepEqual(publishedRows(), ["tiles:Scene.scene-a.Tile.t2"],
		"the hook-driven rebuild is what removed the row");
});

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

/** Press Save in the rename dialog that was just opened, with a new name. */
async function saveRename(dialogs, name) {
	const dialog = dialogs.pop();
	assert.ok(dialog, "the rename control opened no dialog");
	const save = dialog.buttons.find(button => button.action === "save");
	await save.callback({}, { form: { elements: { name: { value: name } } } });
}

/** Answer every delete confirmation the same way for one test. */
function confirmDeletes(t, answer) {
	const DialogV2 = foundry.applications.api.DialogV2;
	const previous = DialogV2.confirm;
	DialogV2.confirm = async () => answer;
	t.after(() => {
		DialogV2.confirm = previous;
	});
}
