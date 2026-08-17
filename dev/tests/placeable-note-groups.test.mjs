// Behaviour tests for the grouped Notes tab.
//
// Two seams, both real production entry points:
//
//   - `getNoteGroupsData()`, the tray context the Notes template renders, built
//     through the actual scene index rather than a stand-in for it;
//   - `renderTray()`, which decides whether that context is built at all.
//
// The DOM harness does not render Handlebars, so nothing here asserts markup.
// What the template does with this context — and how it looks — is live-Foundry
// acceptance in Ticket 4.

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
} from "./helpers/placeable-note-tray.mjs";

// The world a real tray reads at load and render time, shared with the
// lifecycle suite: the ambient Foundry surface, the feature switch, the
// note-bearing document doubles, and the enrichment tracer both files use as
// their oracle. What is not shared is scene shape — this file's scenes are its
// own.
const { features } = installTrayHarness();

const { TrayApp } = await import("../../scripts/tray/TrayApp.mjs");
const TraySD = await import("../../scripts/tray/TraySD.mjs");
const { getNoteGroupsData, getViewMode, renderTray, setViewMode } = TraySD;

installEnricher();
const tray = makeTrayDriver(TraySD, features);

// --- scene fixtures ----------------------------------------------------------

/** Install a scene as the one the tray is looking at, and who is looking. */
function stage({ isGM = true, scene = null } = {}) {
	// The pin list reads the active scene out of the world collection, so a
	// scene the tray is looking at has to be a scene the world has.
	scene ??= null;
	if (scene) {
		scene.getFlag ??= () => [];
		// Foundry's own Map Notes, which the Pins tab lists and this ticket does
		// not touch. An empty collection keeps that tab renderable.
		scene.notes ??= [];
	}
	globalThis.game.scenes = new Map(scene ? [[scene.id, scene]] : []);
	globalThis.canvas.scene = scene;
	globalThis.game.user = { id: "user-1", isGM };
	return scene;
}

/**
 * A scene shaped the way Foundry 14 shapes one, holding a note on each of the
 * six legacy supported types. The Token reaches its Actor through `.actor`,
 * which is the only way an Actor enters a scene-scoped index.
 */
function sceneWithEveryType() {
	const token = noted("Token", "Scene.s1.Token.t1", { name: "Grix" });
	token.actor = noted("Actor", "Actor.a1", { name: "Grix" });

	return {
		id: "s1",
		tokens: { contents: [token] },
		tiles: { contents: [noted("Tile", "Scene.s1.Tile.tile1", { name: "Mural" })] },
		walls: { contents: [noted("Wall", "Scene.s1.Wall.w1", { c: [0, 0, 100, 100] })] },
		lights: { contents: [noted("AmbientLight", "Scene.s1.AmbientLight.l1")] },
		sounds: { contents: [noted("AmbientSound", "Scene.s1.AmbientSound.s1", { path: "a/bell.ogg" })] },
	};
}

// --- grouped context ---------------------------------------------------------

test("the Notes tab is given one labelled group per type, in the fixed order", async () => {
	stage({ scene: sceneWithEveryType() });

	const groups = await getNoteGroupsData();

	assert.deepEqual(groups.map(group => [group.id, group.label]), [
		["tokens", "Tokens"],
		["actors", "Actors"],
		["tiles", "Tiles"],
		["walls", "Walls"],
		["lights", "Lights"],
		["sounds", "Sounds"],
	]);
});

/** The group with this id, or a failure that names the id rather than `undefined`. */
function group(groups, id) {
	const found = groups.find(entry => entry.id === id);
	assert.ok(found, `expected a "${id}" group, got ${groups.map(entry => entry.id).join(", ")}`);
	return found;
}

// A Token note and its Actor note are two different notes on two different
// documents that a GM habitually gives one name. Nothing in the row text can
// tell them apart, so the presentation has to.
test("a Token row and its Actor row are told apart by icon, not by name", async () => {
	stage({ scene: sceneWithEveryType() });

	const groups = await getNoteGroupsData();
	const tokenRow = group(groups, "tokens").rows[0];
	const actorRow = group(groups, "actors").rows[0];

	assert.equal(tokenRow.displayName, actorRow.displayName, "the two rows read the same");
	assert.ok(tokenRow.icon, "a Token row carries an icon");
	assert.ok(actorRow.icon, "an Actor row carries an icon");
	assert.notEqual(tokenRow.icon, actorRow.icon);
	assert.notEqual(group(groups, "tokens").icon, group(groups, "actors").icon);
});

// --- the flat list that is still exported ------------------------------------
//
// `getNotesData` is older than the grouped tab and older than Ticket 2: it is
// TraySD's long-standing exported flat list. Dropping it breaks a named-import
// consumer at LINK time — not a wrong answer, a module that will not load — so
// the export survives the grouped tab and forwards to it.

test("TraySD still provides the getNotesData export a named import binds to", () => {
	assert.ok(Object.hasOwn(TraySD, "getNotesData"),
		"a named import of getNotesData would fail to link against this module");
});

test("getNotesData is the grouped index flattened, one row per exact source", async () => {
	stage({ scene: sceneWithEveryType() });

	const rows = await TraySD.getNotesData();

	assert.deepEqual(rows.map(row => row.sourceUuid), [
		"Scene.s1.Token.t1",
		"Actor.a1",
		"Scene.s1.Tile.tile1",
		"Scene.s1.Wall.w1",
		"Scene.s1.AmbientLight.l1",
		"Scene.s1.AmbientSound.s1",
	]);
	assert.deepEqual(rows.map(row => row.sourceType), [
		"Token", "Actor", "Tile", "Wall", "AmbientLight", "AmbientSound",
	]);
	assert.equal(rows[2].displayName, "Mural");
	assert.ok(rows.every(row => !!row.icon), "every row still carries the icon it used to");
	assert.ok(rows.every(row => !("rows" in row)), "the result is rows, not groups");
});

// --- carried through from the index -----------------------------------------
//
// CHARACTERIZATION, not TDD. Viewer filtering, group counts, empty-group
// omission and natural row order are Ticket 1 behaviour; these were green
// before this ticket's production changes. They are here because the grouped
// tab is the first thing that actually SHOWS them, and a context builder that
// re-sorted, re-counted or re-filtered on the way past would be a regression
// nothing else would catch.

test("a group count is what this viewer was shown, not what the scene holds", async () => {
	const scene = {
		id: "s1",
		tokens: { contents: [] },
		tiles: {
			contents: [
				noted("Tile", "Scene.s1.Tile.shared", {
					name: "Mural", flags: { [MODULE_ID]: { noteVisible: true } },
				}),
				noted("Tile", "Scene.s1.Tile.hidden", { name: "Trap" }),
			],
		},
	};

	stage({ isGM: true, scene });
	const asGM = group(await getNoteGroupsData(), "tiles");
	stage({ isGM: false, scene });
	const asPlayer = group(await getNoteGroupsData(), "tiles");

	assert.equal(asGM.count, 2);
	assert.equal(asPlayer.count, 1, "the hidden note is not counted for a player");
	assert.deepEqual(asPlayer.rows.map(row => row.sourceUuid), ["Scene.s1.Tile.shared"]);
});

test("a type with no notes on the scene is not shown as an empty group", async () => {
	stage({
		scene: {
			id: "s1",
			tokens: { contents: [] },
			tiles: { contents: [noted("Tile", "Scene.s1.Tile.tile1", { name: "Mural" })] },
		},
	});

	const groups = await getNoteGroupsData();

	assert.deepEqual(groups.map(entry => entry.id), ["tiles"]);
});

test("rows keep the index's natural order: Room 2 comes before Room 10", async () => {
	stage({
		scene: {
			id: "s1",
			tokens: { contents: [] },
			tiles: {
				contents: [
					noted("Tile", "Scene.s1.Tile.c", { name: "Room 10" }),
					noted("Tile", "Scene.s1.Tile.a", { name: "Room 2" }),
					noted("Tile", "Scene.s1.Tile.b", { name: "Room 1" }),
				],
			},
		},
	});

	const groups = await getNoteGroupsData();

	assert.deepEqual(group(groups, "tiles").rows.map(row => row.displayName),
		["Room 1", "Room 2", "Room 10"]);
});

test("Drawing and Region notes reach fixed groups beside the existing groups", async () => {
	stage({
		scene: {
			id: "s1",
			tokens: { contents: [] },
			drawings: { contents: [noted("Drawing", "Scene.s1.Drawing.d1", { name: "Sketch" })] },
			regions: { contents: [noted("Region", "Scene.s1.Region.r1", { name: "Zone" })] },
			tiles: { contents: [noted("Tile", "Scene.s1.Tile.tile1", { name: "Mural" })] },
		},
	});

	const groups = await getNoteGroupsData();

	assert.deepEqual(groups.map(entry => entry.id), ["tiles", "drawings", "regions"]);
	assert.equal(group(groups, "drawings").rows[0].sourceType, "Drawing");
	assert.equal(group(groups, "regions").rows[0].sourceType, "Region");
});

// REVIEW-DRIVEN CHARACTERIZATION: all eight groups must be present together so
// order, labels, and both new icon mappings are proved by one real context.
test("all eight grouped sources keep their exact order, labels, and icons", async () => {
	const scene = sceneWithEveryType();
	scene.drawings = {
		contents: [noted("Drawing", "Scene.s1.Drawing.d1", {
			name: "Drawing", text: "Sketch", x: 10, y: 20,
		})],
	};
	scene.regions = {
		contents: [noted("Region", "Scene.s1.Region.r1", {
			name: "Zone", bounds: { left: 0, top: 0, right: 100, bottom: 100 },
			shapes: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 100 }],
		})],
	};
	stage({ scene });

	const groups = await getNoteGroupsData();

	assert.deepEqual(groups.map(group => [group.id, group.label, group.icon]), [
		["tokens", "Tokens", "fa-solid fa-user"],
		["actors", "Actors", "fa-solid fa-address-card"],
		["tiles", "Tiles", "fa-solid fa-image"],
		["drawings", "Drawings", "fa-solid fa-pencil"],
		["walls", "Walls", "fa-solid fa-block-brick"],
		["lights", "Lights", "fa-solid fa-lightbulb"],
		["sounds", "Sounds", "fa-solid fa-volume-high"],
		["regions", "Regions", "fa-solid fa-draw-polygon"],
	]);
	assert.equal(group(groups, "drawings").rows[0].icon, "fa-solid fa-pencil");
	assert.equal(group(groups, "regions").rows[0].icon, "fa-solid fa-draw-polygon");
});

// --- the inactive-view gate --------------------------------------------------
//
// Enriching a note is the expensive part of building this tab, and the tray
// rebuilds its whole context on every render — a token moving, a pin changing,
// a scene switching. Six of the seven views would throw that work away.
//
// The seam is `renderTray()` driven through `setViewMode()`, which is how a user
// changes tab, and the oracle is Foundry's own enrichment boundary: not "the
// context was empty", but "the enricher was never called".

/** Start the real tray application, once, without the painters' asset loads. */
const startTray = () => tray.start();

/** Every tray view except the Notes tab, for a GM with every feature on. */
const OTHER_VIEWS = ["scenes", "party", "pins", "hexes", "dungeons", "decor"];

/** Switch tab and wait for the tray to be rebuilt. */
const showView = mode => tray.showView(mode);

test("no view but Notes enriches a note", async t => {
	stage({ scene: sceneWithEveryType() });
	startTray();
	const enriched = traceEnrichment(t);

	for (const mode of OTHER_VIEWS) {
		await showView(mode);
		assert.equal(getViewMode(), mode, `the tray did not actually switch to ${mode}`);
		assert.deepEqual(enriched, [], `the ${mode} view enriched a note`);
	}

	await showView("notes");

	assert.ok(enriched.length > 0,
		"the Notes view enriches, so the empty results above are a gate and not an empty scene");
});

// CHARACTERIZATION: the feature half of the gate predates this ticket — the old
// flat list was already built only when Placeable Notes was on. It is asserted
// here because the gate now has two clauses and a later edit could drop this one
// while the view clause kept the mode test green.
test("with Placeable Notes switched off, no view enriches a note", async t => {
	stage({ scene: sceneWithEveryType() });
	startTray();
	const enriched = traceEnrichment(t);
	features.disable(["journal.placeableNotes"]);
	t.after(() => features.enableAll());

	// Asking for the tab rather than being put on it: `showView` insists the
	// tray arrived where it was sent, and the whole point here is that it
	// refuses to go.
	await setViewMode("notes");
	await renderTray();

	assert.notEqual(getViewMode(), "notes", "the Notes tab is not offered at all");
	assert.deepEqual(enriched, []);
});

// --- browsing state belongs to the scene it was formed on ---------------------
//
// Group ids are the same eight words on every scene, so "tiles" folded on one
// scene names a perfectly valid group on the next one — pruning cannot tell
// them apart, and the new scene would open with a group already folded that
// this user never touched. Row UUIDs do not have that problem; group ids do.
//
// End to end on purpose: the fold is made through the registered production
// binding, the scene change goes through the real `renderTray()`, and the
// answer is read from the real render context.

/** A scene holding one noted Tile, so it has a Tiles group and nothing else. */
function sceneWithTiles(id) {
	return {
		id,
		tokens: { contents: [] },
		tiles: { contents: [noted("Tile", `Scene.${id}.Tile.t1`, { name: "Mural" })] },
	};
}

/** A scene with both extension source types, for the async publication guard. */
function sceneWithDrawingAndRegion(id) {
	return {
		id,
		tokens: { contents: [] },
		drawings: {
			contents: [noted("Drawing", `Scene.${id}.Drawing.d1`, {
				name: "Drawing", text: `Sketch ${id}`, x: 100, y: 100,
			})],
		},
		regions: {
			contents: [noted("Region", `Scene.${id}.Region.r1`, {
				name: `Zone ${id}`, bounds: { left: 200, top: 200, right: 300, bottom: 300 },
			})],
		},
	};
}

/** Fold a group shut through the binding a render registers. */
function collapseGroupThroughBinding(app, groupId) {
	const dom = makeSelectorDom({
		seedAll: true,
		lists: { ".note-group-header": [{ dataset: { noteGroup: groupId } }] },
	});
	app._bindPlaceableNoteEvents(dom.node(".sdx-tray"));
	dom.fire(".sdx-tray .note-group-header[0]", "click");
}

test("a group folded on one scene arrives expanded on the next", async () => {
	stage({ scene: sceneWithTiles("scene-a") });
	startTray();
	await showView("notes");
	const app = TrayApp._instance;
	// ApplicationV2 builds its context as part of rendering; the harness's stub
	// application does not, so the render that showed scene A is finished by
	// hand. A user cannot fold a group that was never drawn for them.
	await app._prepareContext({});

	collapseGroupThroughBinding(app, "tiles");
	assert.deepEqual([...app._collapsedNoteGroups], ["tiles"], "the fold was recorded");

	stage({ scene: sceneWithTiles("scene-b") });
	await renderTray();
	const context = await app._prepareContext({});

	assert.deepEqual(context.noteGroups.map(group => [group.id, group.collapsed]),
		[["tiles", false]]);
});

// CHARACTERIZATION, not a RED. Actor deduplication by exact UUID is Ticket 1
// behaviour and was already green before this ticket; it is asserted here
// because the grouped tab is the first place a user would SEE a duplicate, and
// because a context builder that re-flattened or re-collected rows on the way
// past could reintroduce one.
//
// The two Actor objects are deliberately DISTINCT objects carrying the same
// exact UUID, which is what two linked tokens hand you: identity is the UUID,
// not the reference. The Token rows are the positive control — without them a
// fixture that quietly lost a token would look like successful deduplication.
test("two linked Tokens of one Actor give two Token rows and a single Actor row", async () => {
	const left = noted("Token", "Scene.s1.Token.a", { name: "Grix (left)" });
	const right = noted("Token", "Scene.s1.Token.b", { name: "Grix (right)" });
	left.actor = noted("Actor", "Actor.a1", { name: "Grix" });
	right.actor = noted("Actor", "Actor.a1", { name: "Grix" });

	stage({ scene: { id: "s1", tokens: { contents: [left, right] } } });
	const groups = await getNoteGroupsData();

	assert.deepEqual(group(groups, "tokens").rows.map(row => row.sourceUuid),
		["Scene.s1.Token.a", "Scene.s1.Token.b"],
		"positive control: both Tokens really are on the scene");
	assert.deepEqual(group(groups, "actors").rows.map(row => row.sourceUuid), ["Actor.a1"]);
	assert.equal(group(groups, "actors").count, 1, "and the count agrees with the rows");
});

// --- two renders in flight at once -------------------------------------------
//
// A render is asynchronous: it reads the scene, then waits while every note on
// it is enriched. The world does not wait. If the canvas moves to another scene
// during that pause, two renders are in flight over two different scenes, and
// they can finish in either order.
//
// Completion order must not decide what the user sees. The render that STARTED
// last is the one describing the world as it is now; an earlier one arriving
// afterwards is stale by definition, however fresh its own data looked when it
// began.

/**
 * Hold every enrichment open until the test releases it by source UUID.
 *
 * Nothing here sleeps: `inFlight` waits for a condition and fails loudly if it
 * never arrives, so the interleaving is chosen by the test rather than by
 * timing.
 */
function deferEnrichment(t) {
	const pending = new Map();
	const previous = foundry.applications.ux.TextEditor.implementation.enrichHTML;
	foundry.applications.ux.TextEditor.implementation.enrichHTML = html =>
		new Promise(resolve => pending.set(html, () => resolve(html)));
	t.after(() => {
		foundry.applications.ux.TextEditor.implementation.enrichHTML = previous;
	});

	return {
		/** Wait until exactly `count` enrichments are outstanding. */
		async inFlight(count) {
			for (let tick = 0; tick < 200 && pending.size < count; tick++) {
				await new Promise(resolve => setTimeout(resolve, 0));
			}
			assert.equal(pending.size, count, `expected ${count} enrichment(s) in flight`);
		},

		/** Let one source's note finish enriching. */
		release(sourceUuid) {
			const key = `<p>body of ${sourceUuid}</p>`;
			const resolve = pending.get(key);
			assert.ok(resolve, `no enrichment in flight for ${sourceUuid}`);
			pending.delete(key);
			resolve();
		},
	};
}

test("a render that finishes late is discarded, not published over the newer one", async t => {
	// A scene with no notes, so getting onto the Notes tab enriches nothing and
	// the deferred enricher below sees only the two renders under test.
	stage({ scene: { id: "scene-quiet", tokens: { contents: [] } } });
	startTray();
	await showView("notes");
	const app = TrayApp._instance;
	const enricher = deferEnrichment(t);

	// Render A begins on scene A and stops to enrich.
	stage({ scene: sceneWithTiles("scene-a") });
	const renderA = renderTray();
	await enricher.inFlight(1);

	// The canvas moves to scene B, whose render begins and finishes first.
	stage({ scene: sceneWithTiles("scene-b") });
	const renderB = renderTray();
	await enricher.inFlight(2);
	enricher.release("Scene.scene-b.Tile.t1");
	await renderB;

	// Only now does A's enrichment come back.
	enricher.release("Scene.scene-a.Tile.t1");
	await renderA;

	const context = await app._prepareContext({});

	assert.equal(app.trayData.noteSceneId, "scene-b", "the published payload names scene B");
	assert.deepEqual(
		context.noteGroups.flatMap(group => group.rows).map(row => row.sourceUuid),
		["Scene.scene-b.Tile.t1"],
		"and holds scene B's rows, not the late render's scene A rows"
	);
});

test("a late render with Drawing and Region rows cannot replace the newest Scene", async t => {
	stage({ scene: { id: "scene-quiet", tokens: { contents: [] } } });
	startTray();
	await showView("notes");
	const app = TrayApp._instance;
	const probeGroups = await getNoteGroupsData(sceneWithDrawingAndRegion("probe"));
	assert.deepEqual(probeGroups.map(group => group.id), ["drawings", "regions"]);
	const enricher = deferEnrichment(t);

	stage({ scene: sceneWithDrawingAndRegion("scene-a") });
	const renderA = renderTray();
	await enricher.inFlight(1);
	enricher.release("Scene.scene-a.Drawing.d1");
	await enricher.inFlight(1);

	stage({ scene: sceneWithDrawingAndRegion("scene-b") });
	const renderB = renderTray();
	await enricher.inFlight(2);
	enricher.release("Scene.scene-b.Drawing.d1");
	await enricher.inFlight(2);
	enricher.release("Scene.scene-b.Region.r1");
	await renderB;

	enricher.release("Scene.scene-a.Region.r1");
	await renderA;

	const context = await app._prepareContext({});
	assert.equal(app.trayData.noteSceneId, "scene-b");
	assert.deepEqual(
		context.noteGroups.flatMap(group => group.rows).map(row => row.sourceUuid),
		["Scene.scene-b.Drawing.d1", "Scene.scene-b.Region.r1"],
		"the stale Drawing/Region render did not publish over the current Scene"
	);
});

// The other half of the guard. "A newer render started" is the usual way a
// render learns it has been overtaken, but a scene can change without anything
// having rebuilt the tray yet — the hook that will do it has not run. A render
// describing a scene nobody is on any more must not publish either, or the tray
// shows the previous scene's notes until something else happens to redraw it.
test("a render whose scene changed under it is discarded with no newer render", async t => {
	stage({ scene: { id: "scene-still", tokens: { contents: [] } } });
	startTray();
	await showView("notes");
	const app = TrayApp._instance;
	const published = app.trayData.noteSceneId;
	const enricher = deferEnrichment(t);

	stage({ scene: sceneWithTiles("scene-c") });
	const renderC = renderTray();
	await enricher.inFlight(1);

	// The canvas moves on, and nothing has begun a replacement render.
	stage({ scene: sceneWithTiles("scene-d") });
	enricher.release("Scene.scene-c.Tile.t1");
	await renderC;

	assert.equal(published, "scene-still", "the tray was showing the earlier scene");
	assert.equal(app.trayData.noteSceneId, "scene-still",
		"and the overtaken render published nothing over it");
});

// Isolating the generation guard from the identity checks. Both renders here
// are of the SAME scene object, so every identity check passes for both and the
// only thing that can tell them apart is which one started later. The note is
// edited in between, which is what makes the two payloads distinguishable —
// exactly the case of a GM saving a note while a slow render is in flight.
test("of two renders of one scene, the one that started last is the one that shows", async t => {
	const scene = sceneWithTiles("scene-e");
	stage({ scene });
	startTray();
	await showView("notes");
	const app = TrayApp._instance;
	const enricher = deferEnrichment(t);

	// Render A begins and stops to enrich the note as it reads now.
	const renderA = renderTray();
	await enricher.inFlight(1);

	// The note is edited, and render B begins on that same scene.
	scene.tiles.contents[0].flags[MODULE_ID].notes
		= "<p>body of Scene.scene-e.Tile.t1 (edited)</p>";
	const renderB = renderTray();
	await enricher.inFlight(2);

	enricher.release("Scene.scene-e.Tile.t1 (edited)");
	await renderB;
	enricher.release("Scene.scene-e.Tile.t1");
	await renderA;

	const context = await app._prepareContext({});

	assert.deepEqual(
		context.noteGroups.flatMap(group => group.rows).map(row => row.enrichedContent),
		["<p>body of Scene.scene-e.Tile.t1 (edited)</p>"],
		"the earlier render's stale copy of the note did not come back over the edit"
	);
});
