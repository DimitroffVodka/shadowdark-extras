// Behaviour tests for the scene-scoped placeable-note index model.
//
// The model is an internal leaf: it decides which documents can carry an SDX
// note and, later, how those notes are grouped for the tray. Nothing here
// touches Foundry globals — the seam under test is the module's own exports,
// driven with document-shaped fixtures.
//
// The supported-source list is a product decision recorded in the technical
// design (Token, Actor, Tile, Drawing, Wall, AmbientLight, AmbientSound,
// Region). Both halves are asserted as independent tests so a regression in
// one cannot hide behind a failure in the other.

import assert from "node:assert/strict";
import test from "node:test";

import {
	buildPlaceableNoteIndex,
	isEligibleNoteSource,
	isSupportedNoteSource,
} from "../../scripts/journal/placeable-note-index.mjs";

test("the eight document types SDX Notes supports are recognized as note sources", () => {
	for (const documentName of ["Token", "Actor", "Tile", "Drawing", "Wall", "AmbientLight", "AmbientSound", "Region"]) {
		assert.equal(
			isSupportedNoteSource({ documentName }),
			true,
			`${documentName} carries SDX Notes and must be a supported note source`
		);
	}
});

test("document types outside the supported set are not note sources", () => {
	for (const documentName of ["Note", "MeasuredTemplate"]) {
		assert.equal(
			isSupportedNoteSource({ documentName }),
			false,
			`${documentName} has no SDX Notes control and must not be a note source`
		);
	}
});

test("eligible sources distinguish durable Drawing and Region instances from owned lifetimes", () => {
	const scene = {
		id: "scene1",
		regions: { contents: [] },
		templates: { contents: [] },
	};
	const ordinaryDrawing = { documentName: "Drawing", flags: {}, parent: scene };
	const ordinaryRegion = { documentName: "Region", flags: {}, parent: scene };
	const importedRegion = {
		documentName: "Region",
		flags: { "shadowdark-extras": { spiral: "imported-once" } },
		parent: scene,
	};
	const helperRegion = {
		documentName: "Region",
		flags: { "shadowdark-extras": { behaviors: true } },
		parent: scene,
	};

	assert.equal(isEligibleNoteSource(ordinaryDrawing), true);
	assert.equal(isEligibleNoteSource(ordinaryRegion), true);
	assert.equal(isEligibleNoteSource(importedRegion), true,
		"a durable one-time import remains eligible");
	assert.equal(isEligibleNoteSource(helperRegion), true,
		"a durable helper Region remains eligible");
});

test("eligible sources reject the explicit opt-out and exact lifetime markers", () => {
	const excludedDrawing = {
		documentName: "Drawing",
		flags: { "shadowdark-extras": { placeableNotesExcluded: true } },
	};
	const excludedRegion = {
		documentName: "Region",
		flags: { "shadowdark-extras": { placeableNotesExcluded: true } },
	};
	const dungeonMarkers = ["dungeonWall", "dungeonBackground", "dungeonGenWall", "dungeonGenCurvedWall", "dungeonIntWall"];
	for (const marker of dungeonMarkers) {
		assert.equal(isEligibleNoteSource({
			documentName: "Drawing",
			flags: { "shadowdark-extras": { [marker]: true } },
		}), false, `${marker} keeps a dungeon Drawing out of Notes`);
	}
	for (const marker of ["auraRegion", "mlStairRegion"]) {
		assert.equal(isEligibleNoteSource({
			documentName: "Region",
			flags: { "shadowdark-extras": { [marker]: true } },
		}), false, `${marker} keeps an owned Region out of Notes`);
	}
	assert.equal(isEligibleNoteSource(excludedDrawing), false);
	assert.equal(isEligibleNoteSource(excludedRegion), false);
});

test("a Region with an exact same-id MeasuredTemplate companion is ineligible", () => {
	const scene = {
		id: "scene1",
		regions: { contents: [] },
		templates: { contents: [{ documentName: "MeasuredTemplate", id: "region1" }] },
	};
	const region = {
		documentName: "Region",
		id: "region1",
		parent: scene,
		flags: {},
	};

	assert.equal(isEligibleNoteSource(region), false);
});

test("a V14 auto-created Region carrying the exact MeasuredTemplate marker is ineligible", () => {
	const region = {
		documentName: "Region",
		id: "region1",
		parent: { id: "scene1", regions: { contents: [] } },
		flags: { core: { MeasuredTemplate: true } },
	};

	assert.equal(isEligibleNoteSource(region), false);
});

test("the instance eligibility predicate leaves the six existing source types unchanged", () => {
	for (const documentName of ["Token", "Actor", "Tile", "Wall", "AmbientLight", "AmbientSound"]) {
		assert.equal(isEligibleNoteSource({ documentName, flags: {} }), true, documentName);
	}
});

// Who is looking decides what the index contains, so the viewer is not
// something a caller may leave to a default. An omitted viewer is a caller bug
// and is refused loudly rather than silently answered as "a player".
test("building an index without an explicit viewer is refused", async () => {
	await assert.rejects(
		() => buildPlaceableNoteIndex({ tokens: { contents: [] } }, {}),
		{ name: "TypeError", message: /isGM/ }
	);
});

test("a scene that is not there indexes as nothing", async () => {
	assert.deepEqual(await buildPlaceableNoteIndex(null, { isGM: true, enrichHTML }), []);
});

/** A document carrying an SDX note, plus whatever else a test needs to set. */
function noted(documentName, uuid, extra = {}) {
	return {
		documentName,
		uuid,
		flags: { "shadowdark-extras": { notes: `<p>note on ${uuid}</p>` } },
		...extra,
	};
}

// What Foundry 14 actually stores for a GM secret: a section element whose
// payload is removed for anyone not allowed to see it.
const NOTE_WITH_SECRET = '<p>public</p><section class="secret">GM only</section>';

/**
 * Stands in for Foundry's TextEditor at the boundary this model does not own.
 * It models the one documented behaviour the secrecy contract rests on: with
 * `secrets: false` the secret section and its payload are gone from the result;
 * with `secrets: true` the stored markup survives intact.
 */
function makeEnricher() {
	const calls = [];
	return {
		calls,
		enrichHTML: async (html, options) => {
			calls.push({ html, options });
			return options.secrets
				? html
				: html.replace(/<section class="secret">.*?<\/section>/gs, "");
		},
	};
}

/**
 * The enrichment boundary every test needs, since building an index enriches
 * what it includes. Tests that assert *how* the enricher was called make their
 * own instance; the rest share this one.
 */
const { enrichHTML } = makeEnricher();

/** A scene holding one embedded collection, for single-type behaviour. */
function sceneOf(collection, documents) {
	return { [collection]: { contents: documents } };
}

/** The display names of one group's rows, in the order the index produced. */
function displayNames(groups, id) {
	return groups.find(group => group.id === id)?.rows.map(row => row.displayName) ?? [];
}

/**
 * A scene shaped the way Foundry 14 shapes one: embedded collections expose
 * their documents through `.contents`, and a Token reaches its Actor through
 * `.actor`. There is no Actor collection on a scene — an Actor is only in the
 * index because a Token on this scene represents it.
 *
 * The second Tile carries no note. It is here so that "these exact UUIDs" also
 * says "and nothing that has no note".
 */
function makeScene() {
	const token = noted("Token", "Scene.scene1.Token.token1");
	token.actor = noted("Actor", "Actor.actor1");

	return {
		tokens: { contents: [token] },
		tiles: {
			contents: [
				noted("Tile", "Scene.scene1.Tile.tile1"),
				{ documentName: "Tile", uuid: "Scene.scene1.Tile.tile2", flags: {} },
			],
		},
		walls: { contents: [noted("Wall", "Scene.scene1.Wall.wall1")] },
		lights: { contents: [noted("AmbientLight", "Scene.scene1.AmbientLight.light1")] },
		sounds: { contents: [noted("AmbientSound", "Scene.scene1.AmbientSound.sound1")] },
	};
}

test("a scene's notes are indexed as the eight fixed groups, in order", async () => {
	const groups = await buildPlaceableNoteIndex(makeScene(), { isGM: true, enrichHTML });

	assert.deepEqual(
		groups.map(group => group.id),
		["tokens", "actors", "tiles", "walls", "lights", "sounds"]
	);
});

test("Drawing and Region notes are indexed in their fixed groups", async () => {
	const groups = await buildPlaceableNoteIndex({
		tokens: { contents: [] },
		tiles: { contents: [noted("Tile", "Scene.scene1.Tile.tile1")] },
		drawings: { contents: [noted("Drawing", "Scene.scene1.Drawing.drawing1")] },
		regions: { contents: [noted("Region", "Scene.scene1.Region.region1")] },
	}, { isGM: true, enrichHTML });

	assert.deepEqual(
		groups.map(group => [group.id, group.rows.map(row => row.sourceType)]),
		[
			["tiles", ["Tile"]],
			["drawings", ["Drawing"]],
			["regions", ["Region"]],
		]
	);
});

/**
 * One Actor, two Tokens on the scene representing it — the ordinary case of a
 * linked Actor placed twice. Only one of those Tokens carries a note of its
 * own. Each Token holds a *separate object* for the Actor, so the only thing
 * that can identify them as the same Actor is the UUID.
 */
function makeSceneWithTwoTokensOfOneActor() {
	const notedToken = noted("Token", "Scene.scene1.Token.token1");
	notedToken.actor = noted("Actor", "Actor.actor1");

	const plainToken = {
		documentName: "Token",
		uuid: "Scene.scene1.Token.token2",
		flags: {},
		actor: noted("Actor", "Actor.actor1"),
	};

	return { tokens: { contents: [notedToken, plainToken] } };
}

test("an actor represented by two tokens is indexed once, beside its own token's note", async () => {
	const groups = await buildPlaceableNoteIndex(makeSceneWithTwoTokensOfOneActor(), { isGM: true, enrichHTML });

	assert.deepEqual(
		Object.fromEntries(groups.map(group => [group.id, group.rows.map(row => row.sourceUuid)])),
		{
			tokens: ["Scene.scene1.Token.token1"],
			actors: ["Actor.actor1"],
		}
	);
});

test("every indexed row names its exact source document", async () => {
	const groups = await buildPlaceableNoteIndex(makeScene(), { isGM: true, enrichHTML });

	assert.deepEqual(
		Object.fromEntries(groups.map(group => [group.id, group.rows.map(row => row.sourceUuid)])),
		{
			tokens: ["Scene.scene1.Token.token1"],
			actors: ["Actor.actor1"],
			tiles: ["Scene.scene1.Tile.tile1"],
			walls: ["Scene.scene1.Wall.wall1"],
			lights: ["Scene.scene1.AmbientLight.light1"],
			sounds: ["Scene.scene1.AmbientSound.sound1"],
		}
	);
});

// A row is named after the document that owns the note. For an Actor that is
// the Actor itself: the Token representing it on the scene is a different
// document with its own note and its own name, and using the Token's name here
// would label the Actor's note with something the Actor is not called.
test("an actor row is named after the actor, not the token representing it", async () => {
	const token = noted("Token", "Scene.scene1.Token.token1", { name: "Goblin Scout" });
	token.actor = noted("Actor", "Actor.actor1", { name: "Grix the Bold" });

	const groups = await buildPlaceableNoteIndex(sceneOf("tokens", [token]), { isGM: true, enrichHTML });

	assert.deepEqual(displayNames(groups, "actors"), ["Grix the Bold"]);
});

// `Room 2` belongs before `Room 10`. Plain string ordering puts `Room 10`
// first, which is how a list of numbered rooms stops reading like a list of
// numbered rooms.
test("rows within a group are ordered the way a person counts", async () => {
	const tiles = ["Room 10", "Room 2", "Room 1"].map((name, index) =>
		noted("Tile", `Scene.scene1.Tile.tile${index}`, { name }));

	const groups = await buildPlaceableNoteIndex(sceneOf("tiles", tiles), { isGM: true, enrichHTML });

	assert.deepEqual(displayNames(groups, "tiles"), ["Room 1", "Room 2", "Room 10"]);
});

// A wall has no name of its own, so a list of them would read as several
// identical rows. The current tray labels them by position, and this model owns
// the name the tray will show. `c` is the wall's [x0, y0, x1, y1]; the label is
// its midpoint, taken from the document rather than a canvas object so the
// index does not depend on a drawn scene.
test("a wall with no name of its own is labelled by where it is", async () => {
	const wall = noted("Wall", "Scene.scene1.Wall.wall1", { name: "Wall", c: [10, 20, 30, 40] });

	const groups = await buildPlaceableNoteIndex(sceneOf("walls", [wall]), { isGM: true, enrichHTML });

	assert.deepEqual(displayNames(groups, "walls"), ["Wall (20, 30)"]);
});

// Same problem as walls, different useful fact: what distinguishes one light
// from another at a glance is how far it throws.
test("a light with no name of its own is labelled by its radii", async () => {
	const light = noted("AmbientLight", "Scene.scene1.AmbientLight.light1", {
		name: "Ambient Light",
		config: { dim: 30, bright: 15 },
	});

	const groups = await buildPlaceableNoteIndex(sceneOf("lights", [light]), { isGM: true, enrichHTML });

	assert.deepEqual(displayNames(groups, "lights"), ["Light - 30/15"]);
});

// And for a sound it is the file that is playing.
test("a sound with no name of its own is labelled by its audio file", async () => {
	const sound = noted("AmbientSound", "Scene.scene1.AmbientSound.sound1", {
		name: "Ambient Sound",
		path: "audio/ambience/bell.ogg",
	});

	const groups = await buildPlaceableNoteIndex(sceneOf("sounds", [sound]), { isGM: true, enrichHTML });

	assert.deepEqual(displayNames(groups, "sounds"), ["Sound - bell.ogg"]);
});

// A GM who renames a note has said what they want the row called, and that
// beats whatever the document is named.
test("a note's custom name wins over the document's own name", async () => {
	const tile = noted("Tile", "Scene.scene1.Tile.tile1", { name: "Grand Hall" });
	tile.flags["shadowdark-extras"].customName = "Throne Room";

	const groups = await buildPlaceableNoteIndex(sceneOf("tiles", [tile]), { isGM: true, enrichHTML });

	assert.deepEqual(displayNames(groups, "tiles"), ["Throne Room"]);
});

test("a Drawing label trims its text, with customName taking precedence", async () => {
	const drawing = noted("Drawing", "Scene.scene1.Drawing.drawing1", {
		name: "Native drawing name",
		text: "  Room 2 — <unsafe>  ",
		x: 120,
		y: 240,
	});
	let groups = await buildPlaceableNoteIndex(sceneOf("drawings", [drawing]), { isGM: true, enrichHTML });
	assert.deepEqual(displayNames(groups, "drawings"), ["Room 2 — <unsafe>"]);

	drawing.flags["shadowdark-extras"].customName = "Hand-labelled";
	groups = await buildPlaceableNoteIndex(sceneOf("drawings", [drawing]), { isGM: true, enrichHTML });
	assert.deepEqual(displayNames(groups, "drawings"), ["Hand-labelled"]);
});

test("a Drawing with no useful text falls back to deterministic coordinates", async () => {
	const drawing = noted("Drawing", "Scene.scene1.Drawing.drawing1", {
		name: "Default drawing name",
		text: "   ",
		x: 120.4,
		y: 240.6,
	});

	const groups = await buildPlaceableNoteIndex(sceneOf("drawings", [drawing]), { isGM: true, enrichHTML });
	assert.deepEqual(displayNames(groups, "drawings"), ["Drawing (120, 241)"]);
});

test("a Region uses a useful trimmed name, customName, then coordinates", async () => {
	const region = noted("Region", "Scene.scene1.Region.region1", {
		name: "  Chamber  ",
		bounds: { left: 300, top: 400, right: 500, bottom: 600 },
		shapes: [{ type: "rectangle", x: 300, y: 400, width: 200, height: 200 }],
	});
	let groups = await buildPlaceableNoteIndex(sceneOf("regions", [region]), { isGM: true, enrichHTML });
	assert.deepEqual(displayNames(groups, "regions"), ["Chamber"]);

	region.flags["shadowdark-extras"].customName = "Secret room";
	groups = await buildPlaceableNoteIndex(sceneOf("regions", [region]), { isGM: true, enrichHTML });
	assert.deepEqual(displayNames(groups, "regions"), ["Secret room"]);

	delete region.flags["shadowdark-extras"].customName;
	region.name = "Region";
	groups = await buildPlaceableNoteIndex(sceneOf("regions", [region]), { isGM: true, enrichHTML });
	assert.deepEqual(displayNames(groups, "regions"), ["Region (300, 400)"]);
});

test("a V14-shaped Region fallback uses bounds over legacy coordinate guesses", async () => {
	const region = noted("Region", "Scene.scene1.Region.region1", {
		name: "Region",
		x: 900,
		y: 901,
		position: { x: 800, y: 801 },
		shape: { x: 700, y: 701 },
		bounds: { left: 0, top: 0, right: 100, bottom: 100 },
		shapes: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 100 }],
	});

	const groups = await buildPlaceableNoteIndex(sceneOf("regions", [region]), {
		isGM: true,
		enrichHTML,
	});
	assert.deepEqual(displayNames(groups, "regions"), ["Region (0, 0)"]);
});

// The descriptive fallbacks are for documents with nothing to say. A wall that
// has been given a real name keeps it, coordinates or no coordinates.
test("a document's own real name wins over the descriptive fallback", async () => {
	const wall = noted("Wall", "Scene.scene1.Wall.wall1", { name: "Secret Door", c: [10, 20, 30, 40] });

	const groups = await buildPlaceableNoteIndex(sceneOf("walls", [wall]), { isGM: true, enrichHTML });

	assert.deepEqual(displayNames(groups, "walls"), ["Secret Door"]);
});

/** The source UUIDs of one group's rows, in the order the index produced. */
function sourceUuids(groups, id) {
	return groups.find(group => group.id === id)?.rows.map(row => row.sourceUuid) ?? [];
}

/** Two noted Tiles: one deliberately shared with players, one deliberately not. */
function makeSceneWithOneSharedTile() {
	const shared = noted("Tile", "Scene.scene1.Tile.shared", { name: "Shared" });
	shared.flags["shadowdark-extras"].noteVisible = true;

	const hidden = noted("Tile", "Scene.scene1.Tile.hidden", { name: "Hidden" });
	hidden.flags["shadowdark-extras"].noteVisible = false;

	return sceneOf("tiles", [shared, hidden]);
}

// Sharing a note is an explicit decision the GM makes per note. A player's
// index contains what was shared with them and nothing else.
test("a player sees only the notes explicitly shared with them", async () => {
	const groups = await buildPlaceableNoteIndex(makeSceneWithOneSharedTile(), { isGM: false, enrichHTML });

	assert.deepEqual(sourceUuids(groups, "tiles"), ["Scene.scene1.Tile.shared"]);
});

// The GM's own view is unfiltered: sharing decides what a player sees, not
// what the GM can see.
test("a gm sees both the shared note and the hidden one", async () => {
	const groups = await buildPlaceableNoteIndex(makeSceneWithOneSharedTile(), { isGM: true, enrichHTML });

	assert.deepEqual(sourceUuids(groups, "tiles"), [
		"Scene.scene1.Tile.hidden",
		"Scene.scene1.Tile.shared",
	]);
});

// The count beside a group heading is part of what a player can see, so it
// counts what they were shown — not what exists. A count of 2 here would tell
// a player a note is being kept from them.
test("a group's count is what the viewer can actually see", async () => {
	const groups = await buildPlaceableNoteIndex(makeSceneWithOneSharedTile(), { isGM: false, enrichHTML });

	assert.equal(groups.find(group => group.id === "tiles").count, 1);
});

/** The shared/hidden pair again, with a real GM secret stored in the shared note. */
function makeSceneWithSecretNote() {
	const scene = makeSceneWithOneSharedTile();
	scene.tiles.contents[0].flags["shadowdark-extras"].notes = NOTE_WITH_SECRET;
	return scene;
}

test("a player's copy of a shared note is the public part of it", async () => {
	const { enrichHTML } = makeEnricher();

	const groups = await buildPlaceableNoteIndex(makeSceneWithSecretNote(), { isGM: false, enrichHTML });

	assert.equal(groups.find(group => group.id === "tiles").rows[0].enrichedContent, "<p>public</p>");
});

test("a player's copy of a shared note carries no trace of the gm's secret", async () => {
	const { enrichHTML } = makeEnricher();

	const groups = await buildPlaceableNoteIndex(makeSceneWithSecretNote(), { isGM: false, enrichHTML });
	const { enrichedContent } = groups.find(group => group.id === "tiles").rows[0];

	assert.equal(typeof enrichedContent, "string");
	assert.ok(!enrichedContent.includes("GM only"), "the secret payload reached a player");
	assert.ok(!enrichedContent.includes("secret"), "the secret markup reached a player");
});

// A note a player may not see is not merely dropped from the result — it is
// never handed to the enricher in the first place, so nothing downstream of
// this model ever holds the hidden text.
test("only the note a player was shown is enriched, and with secrets off", async () => {
	const enricher = makeEnricher();

	await buildPlaceableNoteIndex(makeSceneWithSecretNote(), {
		isGM: false,
		enrichHTML: enricher.enrichHTML,
	});

	assert.deepEqual(enricher.calls, [
		{ html: NOTE_WITH_SECRET, options: { async: true, secrets: false } },
	]);
});

test("a gm's notes are enriched with secrets on", async () => {
	const enricher = makeEnricher();

	await buildPlaceableNoteIndex(makeSceneWithSecretNote(), {
		isGM: true,
		enrichHTML: enricher.enrichHTML,
	});

	assert.deepEqual(enricher.calls, [
		{ html: NOTE_WITH_SECRET, options: { async: true, secrets: true } },
		{ html: "<p>note on Scene.scene1.Tile.hidden</p>", options: { async: true, secrets: true } },
	]);
});

test("a gm's copy of a shared note still contains the secret", async () => {
	const { enrichHTML } = makeEnricher();

	const groups = await buildPlaceableNoteIndex(makeSceneWithSecretNote(), { isGM: true, enrichHTML });
	const shared = groups
		.find(group => group.id === "tiles")
		.rows.find(row => row.sourceUuid === "Scene.scene1.Tile.shared");

	assert.equal(shared.enrichedContent, NOTE_WITH_SECRET);
});

/**
 * The shape a world has when an Actor note was shared before Actors could carry
 * their own sharing flag: the decision lives on the Token representing the
 * Actor, and that Token has no note of its own, so the only note it could ever
 * have been sharing is the Actor's.
 */
function makeSceneWithLegacyActorShare() {
	const token = {
		documentName: "Token",
		uuid: "Scene.scene1.Token.token1",
		name: "Goblin Scout",
		flags: { "shadowdark-extras": { noteVisible: true } },
		actor: noted("Actor", "Actor.actor1", { name: "Grix the Bold" }),
	};

	return sceneOf("tokens", [token]);
}

test("an actor note shared the old way, through its token, is still shared", async () => {
	const groups = await buildPlaceableNoteIndex(makeSceneWithLegacyActorShare(), {
		isGM: false,
		enrichHTML,
	});

	assert.deepEqual(sourceUuids(groups, "actors"), ["Actor.actor1"]);
});

/**
 * The same legacy shape, except the representing Token now has a note of its
 * own. Sharing that Token was sharing the *Token's* note; the Actor's note is a
 * different note on a different document and was never part of that decision.
 */
function makeSceneWithSharedTokenAndActorNote() {
	const scene = makeSceneWithLegacyActorShare();
	const [token] = scene.tokens.contents;
	token.flags["shadowdark-extras"].notes = "<p>the token's own note</p>";
	return scene;
}

test("sharing a token's own note does not share the separate actor note", async () => {
	const groups = await buildPlaceableNoteIndex(makeSceneWithSharedTokenAndActorNote(), {
		isGM: false,
		enrichHTML,
	});

	assert.deepEqual(sourceUuids(groups, "actors"), []);
});

test("the shared token's own note is the one the player gets", async () => {
	const groups = await buildPlaceableNoteIndex(makeSceneWithSharedTokenAndActorNote(), {
		isGM: false,
		enrichHTML,
	});

	assert.deepEqual(sourceUuids(groups, "tokens"), ["Scene.scene1.Token.token1"]);
});

// An explicit decision on the Actor is the whole answer, whichever way it goes:
// it is the note's own document saying what it wants.
test("an actor shared explicitly stays shared even when its token is not", async () => {
	const scene = makeSceneWithLegacyActorShare();
	const [token] = scene.tokens.contents;
	token.flags["shadowdark-extras"].noteVisible = false;
	token.actor.flags["shadowdark-extras"].noteVisible = true;

	const groups = await buildPlaceableNoteIndex(scene, { isGM: false, enrichHTML });

	assert.deepEqual(sourceUuids(groups, "actors"), ["Actor.actor1"]);
});

test("an actor hidden explicitly stays hidden even when its token is shared", async () => {
	const scene = makeSceneWithLegacyActorShare();
	scene.tokens.contents[0].actor.flags["shadowdark-extras"].noteVisible = false;

	const groups = await buildPlaceableNoteIndex(scene, { isGM: false, enrichHTML });

	assert.deepEqual(sourceUuids(groups, "actors"), []);
});

/** The visibility state of one group's rows, keyed by source UUID. */
function visibilityByUuid(groups, id) {
	return Object.fromEntries(
		(groups.find(group => group.id === id)?.rows ?? []).map(row => [row.sourceUuid, row.isVisible])
	);
}

// A GM sees every row, including the ones no player can. Which of them are
// shared is state the row itself carries, so whatever presents these rows shows
// the sharing state rather than working the policy out a second time.
test("a gm's rows say which notes are shared", async () => {
	const groups = await buildPlaceableNoteIndex(makeSceneWithOneSharedTile(), {
		isGM: true,
		enrichHTML,
	});

	assert.deepEqual(visibilityByUuid(groups, "tiles"), {
		"Scene.scene1.Tile.shared": true,
		"Scene.scene1.Tile.hidden": false,
	});
});

test("a gm's actor row carries the visibility the legacy token share gives it", async () => {
	const groups = await buildPlaceableNoteIndex(makeSceneWithLegacyActorShare(), {
		isGM: true,
		enrichHTML,
	});

	assert.deepEqual(visibilityByUuid(groups, "actors"), { "Actor.actor1": true });
});

/** A scene with the new supported types and a world Actor collection that must
 * still not be traversed as a scene source. */
function makeSceneWithDrawingRegionSources() {
	return {
		drawings: { contents: [noted("Drawing", "Scene.scene1.Drawing.drawing1", { name: "Sketch" })] },
		regions: { contents: [noted("Region", "Scene.scene1.Region.region1", { name: "Danger" })] },
		// An Actor reaches the index through a Token on this scene, never through
		// a world collection — there is no Token here, so there is no Actor row.
		actors: { contents: [noted("Actor", "Actor.worldActor", { name: "Wandering NPC" })] },
		tokens: { contents: [] },
		tiles: { contents: [] },
		walls: { contents: [] },
		lights: { contents: [] },
		sounds: { contents: [] },
	};
}

test("notes on Drawings and Regions enter the scene index, but world Actors do not", async () => {
	const groups = await buildPlaceableNoteIndex(makeSceneWithDrawingRegionSources(), {
		isGM: true,
		enrichHTML,
	});

	assert.deepEqual(
		groups.map(group => [group.id, group.rows.map(row => row.sourceUuid)]),
		[
			["drawings", ["Scene.scene1.Drawing.drawing1"]],
			["regions", ["Scene.scene1.Region.region1"]],
		]
	);
});

// The control for the test above: on the very same scene shape, a supported
// source does appear. Without this, an empty index would be equally consistent
// with the builder having failed to read the fixture at all.
test("a supported source on that same scene is still indexed", async () => {
	const scene = makeSceneWithDrawingRegionSources();
	scene.tiles.contents.push(noted("Tile", "Scene.scene1.Tile.tile1", { name: "Vault" }));

	const groups = await buildPlaceableNoteIndex(scene, { isGM: true, enrichHTML });

	assert.deepEqual(
		groups.map(group => [group.id, group.rows.map(row => row.sourceUuid)]),
		[
			["tiles", ["Scene.scene1.Tile.tile1"]],
			["drawings", ["Scene.scene1.Drawing.drawing1"]],
			["regions", ["Scene.scene1.Region.region1"]],
		]
	);
});

test("excluded Drawing and Region sources are filtered before note enrichment", async () => {
	const excludedDrawing = noted("Drawing", "Scene.scene1.Drawing.excluded", {
		name: "Generated wall",
		flags: { "shadowdark-extras": {
			notes: "<p>drawing secret</p>",
			placeableNotesExcluded: true,
		} },
	});
	const excludedRegion = noted("Region", "Scene.scene1.Region.excluded", {
		name: "Aura",
		flags: { "shadowdark-extras": {
			notes: "<p>region secret</p>",
			auraRegion: true,
		} },
	});
	const included = noted("Tile", "Scene.scene1.Tile.included", { name: "Mural" });
	const enricher = makeEnricher();

	const groups = await buildPlaceableNoteIndex({
		tokens: { contents: [] },
		tiles: { contents: [included] },
		drawings: { contents: [excludedDrawing] },
		regions: { contents: [excludedRegion] },
	}, { isGM: true, enrichHTML: enricher.enrichHTML });

	assert.deepEqual(groups.flatMap(group => group.rows).map(row => row.sourceUuid), [included.uuid]);
	assert.deepEqual(enricher.calls.map(call => call.html), [included.flags["shadowdark-extras"].notes]);
});

/** A logger for tests whose enrichment failure is expected, not the subject. */
const silentLogger = { warn() {} };

const BROKEN_NOTE = "<p>the note that breaks enrichment</p>";
const HEALTHY_NOTE = "<p>the note beside it</p>";

/** An enricher that fails for one particular note and works for every other. */
function makeFailingEnricher(brokenHtml, error) {
	const enricher = makeEnricher();
	const { enrichHTML } = enricher;
	return {
		...enricher,
		enrichHTML: async (html, options) => {
			if (html === brokenHtml) {
				enricher.calls.push({ html, options });
				throw error;
			}
			return enrichHTML(html, options);
		},
	};
}

/** Two notes a viewer may see, the first of which will fail to enrich. */
function makeSceneWithABrokenNote(brokenNote = BROKEN_NOTE) {
	const broken = noted("Tile", "Scene.scene1.Tile.broken", { name: "Broken" });
	broken.flags["shadowdark-extras"].notes = brokenNote;
	broken.flags["shadowdark-extras"].noteVisible = true;

	const healthy = noted("Tile", "Scene.scene1.Tile.healthy", { name: "Healthy" });
	healthy.flags["shadowdark-extras"].notes = HEALTHY_NOTE;
	healthy.flags["shadowdark-extras"].noteVisible = true;

	return sceneOf("tiles", [broken, healthy]);
}

test("a note that cannot be enriched does not take the rest of the index with it", async () => {
	const { enrichHTML } = makeFailingEnricher(BROKEN_NOTE, new Error("enrichment exploded"));

	const groups = await buildPlaceableNoteIndex(makeSceneWithABrokenNote(), {
		isGM: true,
		enrichHTML,
		logger: silentLogger,
	});

	assert.deepEqual(sourceUuids(groups, "tiles"), [
		"Scene.scene1.Tile.broken",
		"Scene.scene1.Tile.healthy",
	]);
});

test("the note beside a broken one is enriched as usual", async () => {
	const { enrichHTML } = makeFailingEnricher(BROKEN_NOTE, new Error("enrichment exploded"));

	const groups = await buildPlaceableNoteIndex(makeSceneWithABrokenNote(), {
		isGM: true,
		enrichHTML,
		logger: silentLogger,
	});
	const healthy = groups
		.find(group => group.id === "tiles")
		.rows.find(row => row.sourceUuid === "Scene.scene1.Tile.healthy");

	assert.equal(healthy.enrichedContent, HEALTHY_NOTE);
});

// CHARACTERIZATION: Drawing and Region rows use the same UUID-only enrichment
// boundary as every existing source type. Keeping both extension types in the
// adversarial fixture proves one rejected row cannot erase its sibling or put
// enricher-authored diagnostics in the shared warning.
for (const [documentName, groupId] of [["Drawing", "drawings"], ["Region", "regions"]]) {
	test(`${documentName} enrichment failures keep sibling rows and diagnostics fixed`, async () => {
		const broken = noted(documentName, `Scene.scene1.${documentName}.broken`, { name: "Broken" });
		broken.flags["shadowdark-extras"].notes = BROKEN_NOTE;
		broken.flags["shadowdark-extras"].noteVisible = true;
		const healthy = noted(documentName, `Scene.scene1.${documentName}.healthy`, { name: "Healthy" });
		healthy.flags["shadowdark-extras"].notes = HEALTHY_NOTE;
		healthy.flags["shadowdark-extras"].noteVisible = true;
		const scene = sceneOf(groupId, [broken, healthy]);
		const logger = { warnings: [], warn(...args) { this.warnings.push(args); } };
		const { enrichHTML } = makeFailingEnricher(BROKEN_NOTE, new Error("enrichment exploded"));

		const groups = await buildPlaceableNoteIndex(scene, {
			isGM: true,
			enrichHTML,
			logger,
		});

		assert.deepEqual(sourceUuids(groups, groupId), [
			`Scene.scene1.${documentName}.broken`,
			`Scene.scene1.${documentName}.healthy`,
		]);
		assert.equal(groups.find(group => group.id === groupId)
			.rows.find(row => row.sourceUuid.endsWith(".healthy")).enrichedContent, HEALTHY_NOTE);
		assert.equal(logger.warnings.length, 1);
		assert.deepEqual(logger.warnings[0], [
			`SDX Note Index | Could not enrich the note on Scene.scene1.${documentName}.broken`,
		]);
	});
}

// The dangerous case: enrichment is what removes secret sections, so when it
// fails the model — not Foundry — has to keep the GM's secret away from the
// player who was shown this note.
test("a player's fallback for a broken note keeps the gm's secret out of it", async () => {
	const { enrichHTML } = makeFailingEnricher(NOTE_WITH_SECRET, new Error("enrichment exploded"));

	const groups = await buildPlaceableNoteIndex(makeSceneWithABrokenNote(NOTE_WITH_SECRET), {
		isGM: false,
		enrichHTML,
		logger: silentLogger,
	});
	const broken = groups
		.find(group => group.id === "tiles")
		.rows.find(row => row.sourceUuid === "Scene.scene1.Tile.broken");

	assert.equal(typeof broken.enrichedContent, "string");
	assert.ok(!broken.enrichedContent.includes("GM only"), "the secret payload survived the fallback");
	assert.ok(!broken.enrichedContent.includes("section"), "the secret markup survived the fallback");
});

test("a player's fallback for a broken note is empty, public text and all", async () => {
	const content = await fallbackFor(NOTE_WITH_SECRET);

	assert.equal(content, "");
});

// The fallback lands in a field the tray renders as trusted HTML, so text that
// merely *looks* harmless is not enough — a note is authored content and can
// contain anything, including markup too malformed for tag-stripping to catch.
const MALFORMED_NOTE = '<p>Bell & Candle "the GM\'s" study</p><img src=x onerror=alert(1)';
const MALFORMED_ESCAPED =
	"Bell &amp; Candle &quot;the GM&#39;s&quot; study&lt;img src=x onerror=alert(1)";

test("a gm's fallback carries no raw markup into the tray", async () => {
	const content = await fallbackFor(MALFORMED_NOTE, { isGM: true });

	assert.equal(typeof content, "string");
	assert.ok(!content.includes("<"), "raw markup reached a field rendered as HTML");
});

test("a gm's fallback escapes the text it does show", async () => {
	const content = await fallbackFor(MALFORMED_NOTE, { isGM: true });

	assert.equal(content, MALFORMED_ESCAPED);
});

// A secret section with no closing tag cannot be excised confidently: there is
// no way to tell where the GM's payload stops. Showing the player the text that
// follows would be a guess, and a wrong guess discloses the secret — so nothing
// is shown at all.
test("a player gets nothing rather than a guess when a secret section is malformed", async () => {
	const unclosedSecret = '<p>public</p><section class="secret">GM only';
	const { enrichHTML } = makeFailingEnricher(unclosedSecret, new Error("enrichment exploded"));

	const groups = await buildPlaceableNoteIndex(makeSceneWithABrokenNote(unclosedSecret), {
		isGM: false,
		enrichHTML,
		logger: silentLogger,
	});
	const { enrichedContent } = groups
		.find(group => group.id === "tiles")
		.rows.find(row => row.sourceUuid === "Scene.scene1.Tile.broken");

	assert.ok(!enrichedContent.includes("GM only"), "an unremovable secret payload reached a player");
});

/**
 * Records what the model would have written to the console. Errors are
 * recorded as well as warnings: a note this module recovers from being reported
 * at error level is its own defect, and only a logger that could receive one
 * can show that none was.
 */
function makeLogger() {
	const warnings = [];
	const errors = [];
	return {
		warnings,
		errors,
		warn: (...args) => warnings.push(args),
		error: (...args) => errors.push(args),
	};
}

// A note that silently renders as a stub is a bug report nobody can act on, so
// the warning has to name which note failed. It must carry nothing else: a GM
// secret in a shared world's log is the same disclosure by another route, and
// every field of the rejection is a place the enricher could have put one.
//
// This test used to require the original error object as a second argument, and
// then the error's `name`. Both requirements were withdrawn in Ticket 4: an
// error composed by the enrichment boundary can quote the note it rejected in
// any of its fields, so passing any of them on reopened exactly the disclosure
// the rendered fallback closes. See the adversarial tests below.
test("a broken note is reported once, by uuid, and by nothing else", async () => {
	const error = new TypeError("enrichment exploded");
	const { enrichHTML } = makeFailingEnricher(BROKEN_NOTE, error);
	const logger = makeLogger();

	await buildPlaceableNoteIndex(makeSceneWithABrokenNote(), { isGM: true, enrichHTML, logger });

	assert.equal(logger.warnings.length, 1);
	assert.equal(logger.warnings[0].length, 1, "only the module's own message is logged");
	const [message] = logger.warnings[0];
	assert.ok(message.includes("Scene.scene1.Tile.broken"), "the warning does not say which note failed");
	assert.ok(!message.includes("enrichment exploded"),
		"the enricher's own message was passed through");
	assert.ok(!message.includes("TypeError"),
		"a field the enricher chose the value of was passed through");
});

test("a broken note's content stays out of the log", async () => {
	const { enrichHTML } = makeFailingEnricher(BROKEN_NOTE, new Error("enrichment exploded"));
	const logger = makeLogger();

	await buildPlaceableNoteIndex(makeSceneWithABrokenNote(), { isGM: true, enrichHTML, logger });

	assert.ok(!JSON.stringify(logger.warnings[0]).includes("breaks enrichment"));
});

// The note's own text is not the only way it can reach the console. An
// enricher rejects with an error IT composed, and a parser that quotes the
// input it choked on — which is ordinary, helpful behaviour for a parser —
// puts the whole note inside `error.message`. Logging that error hands a
// player the exact secret the rendered fallback refused them, through a
// console they can open. So nothing the enricher authored is logged at all.
const SECRET_NOTE = '<p>public part</p><section class="secret">DO-NOT-LOG-THE-DAGGER</section>';

/** An enricher that rejects with the note it was given, quoted in full. */
function makeQuotingEnricher(brokenHtml) {
	return {
		enrichHTML: async html => {
			if (html === brokenHtml) throw new Error(`parser rejected: ${html}`);
			return html;
		},
	};
}

/** Everything a warning would put in front of a reader, as one string. */
function warningText(warning) {
	return warning.map(part => (part instanceof Error
		? `${part.name}: ${part.message}\n${part.stack ?? ""}`
		: String(part))).join(" ");
}

test("an enrichment error that quotes the note does not carry it into the log", async () => {
	const { enrichHTML } = makeQuotingEnricher(SECRET_NOTE);
	const logger = makeLogger();
	const scene = makeSceneWithABrokenNote(SECRET_NOTE);

	await buildPlaceableNoteIndex(scene, { isGM: false, enrichHTML, logger });

	assert.equal(logger.warnings.length, 1, "one note failed, so one warning");
	const text = warningText(logger.warnings[0]);
	assert.ok(!text.includes("DO-NOT-LOG-THE-DAGGER"),
		`the secret reached the console: ${text}`);
	assert.ok(!text.includes("public part"),
		`the note's public text reached the console: ${text}`);
});

test("the warning about a quoting error still says which note to go and look at", async () => {
	const { enrichHTML } = makeQuotingEnricher(SECRET_NOTE);
	const logger = makeLogger();

	await buildPlaceableNoteIndex(makeSceneWithABrokenNote(SECRET_NOTE),
		{ isGM: false, enrichHTML, logger });

	const text = warningText(logger.warnings[0]);
	assert.ok(text.includes("Scene.scene1.Tile.broken"), "the warning does not say which note failed");
	assert.equal(text, "SDX Note Index | Could not enrich the note on Scene.scene1.Tile.broken",
		"the warning carries something beyond the uuid of the note to go and look at");
});

test("a player still sees nothing of a note whose error quoted it", async () => {
	const { enrichHTML } = makeQuotingEnricher(SECRET_NOTE);

	const groups = await buildPlaceableNoteIndex(makeSceneWithABrokenNote(SECRET_NOTE),
		{ isGM: false, enrichHTML, logger: silentLogger });
	const rows = groups.find(group => group.id === "tiles").rows;

	assert.equal(rows.find(row => row.sourceUuid === "Scene.scene1.Tile.broken").enrichedContent, "");
	assert.deepEqual(rows.map(row => row.sourceUuid),
		["Scene.scene1.Tile.broken", "Scene.scene1.Tile.healthy"],
		"and the healthy row beside it is untouched");
});

// A regression case, kept for the shape filter that used to stand here. The
// builder once logged `error.name` whenever it still LOOKED like a class name,
// on the reasoning that a note is HTML and a run of letters and digits is not.
// This payload is the half of that bet the filter won — HTML punctuation in
// `name`, rejected on sight — and it is exactly why the bet read as safe. The
// other half is the next test below: a note can be a door code, and a door code
// looks like a class name. No field of the rejection is read or logged now, so
// this case passes for the reason every other one does rather than for a
// property of the payload.
test("an error whose name has been loaded with note text is not logged either", async () => {
	const enrichHTML = async html => {
		const error = new Error("rejected");
		error.name = 'TypeError: <section class="secret">DO-NOT-LOG-THE-DAGGER</section>';
		throw error;
	};
	const logger = makeLogger();

	await buildPlaceableNoteIndex(makeSceneWithABrokenNote(SECRET_NOTE),
		{ isGM: false, enrichHTML, logger });

	const text = logger.warnings.map(warningText).join(" ");
	assert.ok(!text.includes("DO-NOT-LOG-THE-DAGGER"), `the secret reached the console: ${text}`);
});

// A note is not always HTML. It can be a door code, a password, a name — a run
// of letters and digits and nothing else — and any test of what a value LOOKS
// like passes such a note straight through. This is the case that closed the
// question of whether the rejection could be inspected safely at all: it cannot,
// so none of it is read.
const ALPHANUMERIC_SECRET = "DungeonPassword123";

/** An enricher that rejects with the note itself loaded into `error.name`. */
function makeNameLoadingEnricher(brokenHtml) {
	return async html => {
		if (html !== brokenHtml) return html;
		const error = new Error("rejected");
		error.name = html;
		throw error;
	};
}

test("a note that is only letters and digits does not reach the log through error.name", async () => {
	const enrichHTML = makeNameLoadingEnricher(ALPHANUMERIC_SECRET);
	const logger = makeLogger();

	const groups = await buildPlaceableNoteIndex(makeSceneWithABrokenNote(ALPHANUMERIC_SECRET),
		{ isGM: false, enrichHTML, logger });
	const rows = groups.find(group => group.id === "tiles").rows;

	assert.equal(logger.warnings.length, 1, "one note failed, so one warning");
	assert.deepEqual(logger.errors, [], "a note this module recovers from was reported as an error");
	const text = warningText(logger.warnings[0]);
	assert.ok(!text.includes(ALPHANUMERIC_SECRET), `the secret reached the console: ${text}`);
	assert.ok(text.includes("Scene.scene1.Tile.broken"), "the warning does not say which note failed");

	assert.equal(rows.find(row => row.sourceUuid === "Scene.scene1.Tile.broken").enrichedContent, "",
		"a player was shown something of a note that never enriched");
	assert.deepEqual(rows.map(row => row.sourceUuid),
		["Scene.scene1.Tile.broken", "Scene.scene1.Tile.healthy"],
		"and the healthy row beside it is untouched");
});

// Reading a field off the rejection is not only a disclosure risk, it is not
// even safe to attempt: the enricher chooses what it throws, and a getter is
// allowed to detonate. A read inside the catch block escapes it, and one broken
// note takes the whole scene's index with it — the exact failure the catch is
// there to prevent.
const BOOBY_TRAPPED_NOTE = "<p>the note whose rejection fights back</p>";

/** An enricher that rejects with an object no property of which can be touched. */
function makeDetonatingEnricher(brokenHtml) {
	return async html => {
		if (html !== brokenHtml) return html;
		throw {
			get name() { throw new Error("getter detonated"); },
			get message() { throw new Error("getter detonated"); },
			get stack() { throw new Error("getter detonated"); },
			toString() { throw new Error("getter detonated"); },
		};
	};
}

test("a rejection whose name getter detonates does not take the index with it", async () => {
	const enrichHTML = makeDetonatingEnricher(BOOBY_TRAPPED_NOTE);
	const logger = makeLogger();

	const groups = await buildPlaceableNoteIndex(makeSceneWithABrokenNote(BOOBY_TRAPPED_NOTE),
		{ isGM: false, enrichHTML, logger });
	const rows = groups.find(group => group.id === "tiles").rows;

	assert.equal(logger.warnings.length, 1, "one note failed, so one warning");
	assert.deepEqual(logger.errors, [], "a note this module recovers from was reported as an error");
	assert.ok(warningText(logger.warnings[0]).includes("Scene.scene1.Tile.broken"),
		"the warning does not say which note failed");

	assert.equal(rows.find(row => row.sourceUuid === "Scene.scene1.Tile.broken").enrichedContent, "");
	assert.deepEqual(rows.map(row => row.sourceUuid),
		["Scene.scene1.Tile.broken", "Scene.scene1.Tile.healthy"],
		"a rejection that fights back cost the scene the row beside it");
});

test("the healthy note beside a reported one is still indexed", async () => {
	const { enrichHTML } = makeFailingEnricher(BROKEN_NOTE, new Error("enrichment exploded"));
	const logger = makeLogger();

	const groups = await buildPlaceableNoteIndex(makeSceneWithABrokenNote(), {
		isGM: true,
		enrichHTML,
		logger,
	});

	assert.deepEqual(sourceUuids(groups, "tiles"), [
		"Scene.scene1.Tile.broken",
		"Scene.scene1.Tile.healthy",
	]);
});

/**
 * The fallback a viewer is given for a note whose enrichment failed. Every
 * adversarial case below is one stored note driven through the public builder.
 */
async function fallbackFor(storedNote, { isGM = false } = {}) {
	const { enrichHTML } = makeFailingEnricher(storedNote, new Error("enrichment exploded"));

	const groups = await buildPlaceableNoteIndex(makeSceneWithABrokenNote(storedNote), {
		isGM,
		enrichHTML,
		logger: silentLogger,
	});

	return groups
		.find(group => group.id === "tiles")
		.rows.find(row => row.sourceUuid === "Scene.scene1.Tile.broken")
		.enrichedContent;
}

// A note's HTML is not only ever written by Foundry's editor — imports, macros,
// the API, and older content all write this flag. Single quotes are ordinary
// HTML, and the secret in them is just as secret.
test("a player gets nothing when a secret is single-quoted", async () => {
	const content = await fallbackFor("<p>public</p><section class='secret'>GM only</section>");

	assert.ok(!content.includes("GM only"), "a single-quoted secret reached a player");
	assert.equal(content, "");
});

// An unquoted class attribute is valid HTML too.
test("a player gets nothing when a secret is unquoted", async () => {
	const content = await fallbackFor("<p>public</p><section class=secret>GM only</section>");

	assert.ok(!content.includes("GM only"), "an unquoted secret reached a player");
	assert.equal(content, "");
});

// A secret section can contain other sections. Removing up to the first closing
// tag stops inside the secret and hands back the rest of the GM's text.
test("a player gets nothing when a secret contains other sections", async () => {
	const content = await fallbackFor(
		'<p>public</p><section class="secret"><section>inner</section>GM after</section><p>tail</p>'
	);

	assert.ok(!content.includes("GM after"), "text inside a nested secret reached a player");
	assert.ok(!content.includes("inner"), "a nested section's content reached a player");
	assert.equal(content, "");
});

// Where a secret ends cannot be known if nothing closes it, whatever quoting
// its class used.
test("a player gets nothing when a single-quoted secret is never closed", async () => {
	const content = await fallbackFor("<p>public</p><section class='secret'>GM only");

	assert.ok(!content.includes("GM only"), "an unclosed single-quoted secret reached a player");
});

test("a player gets nothing when an unquoted secret is never closed", async () => {
	const content = await fallbackFor("<p>public</p><section class=secret>GM only");

	assert.ok(!content.includes("GM only"), "an unclosed unquoted secret reached a player");
});

// Foundry writes `secret` alongside other classes, so the class list is read as
// a list rather than searched as a string.
test("a player gets nothing when a secret carries other classes too", async () => {
	const content = await fallbackFor('<p>public</p><section class="foo secret bar">GM only</section>');

	assert.ok(!content.includes("GM only"), "a multi-class secret reached a player");
	assert.equal(content, "");
});

// Ticket 2 routes every command by UUID *and* expected source type, and is
// forbidden from inferring that type from an icon or a group id. The type a row
// carries is therefore the document's own, for every supported kind.
test("every row names the exact document type of its source", async () => {
	const groups = await buildPlaceableNoteIndex(makeScene(), { isGM: true, enrichHTML });

	assert.deepEqual(
		Object.fromEntries(groups.map(group => [group.id, group.rows.map(row => row.sourceType)])),
		{
			tokens: ["Token"],
			actors: ["Actor"],
			tiles: ["Tile"],
			walls: ["Wall"],
			lights: ["AmbientLight"],
			sounds: ["AmbientSound"],
		}
	);
});

// Foundry's enrichment sees these as a real `secret` class, because the HTML
// parser decodes character references inside attribute values before comparing
// class tokens. Anything that matches the raw source instead does not.
test("a player gets nothing when a secret class is written with a hex entity", async () => {
	const content = await fallbackFor(
		'<p>public</p><section class="sec&#x72;et">ENTITY-SECRET</section><p>tail</p>'
	);

	assert.ok(!content.includes("ENTITY-SECRET"), "a hex-entity secret class reached a player");
	assert.equal(content, "");
});

test("a player gets nothing when a secret class is written with a decimal entity", async () => {
	const content = await fallbackFor(
		'<p>public</p><section class="sec&#114;et">ENTITY-SECRET</section><p>tail</p>'
	);

	assert.ok(!content.includes("ENTITY-SECRET"), "a decimal-entity secret class reached a player");
	assert.equal(content, "");
});

test("a player gets nothing when a secret class is separated by an entity space", async () => {
	const content = await fallbackFor(
		'<p>public</p><section class="foo&Tab;secret">ENTITY-SECRET</section><p>tail</p>'
	);

	assert.ok(!content.includes("ENTITY-SECRET"), "an entity-separated secret class reached a player");
	assert.equal(content, "");
});

// A `>` inside a quoted attribute value is ordinary attribute data and does not
// end the start tag — so anything that ends a tag at the first raw `>` reads
// this section's class as something else entirely.
test("a player gets nothing when a section attribute quotes a closing bracket", async () => {
	const content = await fallbackFor(
		'<p>public</p><section title=">" class="secret">QUOTED-GT-SECRET</section><p>tail</p>'
	);

	assert.ok(!content.includes("QUOTED-GT-SECRET"), "a quoted-bracket secret reached a player");
	assert.equal(content, "");
});

// `data-class` is not `class`. Ordinary content in a section that merely has a
// similarly-named attribute is not a secret, and both surviving seams show it:
// what Foundry returns on success, and what a GM is given on failure.
const DATA_CLASS_NOTE =
	'<p>public</p><section data-class="secret">ordinary</section><p>tail</p>';

test("successful enrichment leaves a data-class section's ordinary content alone", async () => {
	const scene = makeSceneWithABrokenNote(DATA_CLASS_NOTE);
	// Nothing is broken here: this enricher succeeds, standing in for Foundry.
	const { enrichHTML } = makeEnricher();

	const groups = await buildPlaceableNoteIndex(scene, { isGM: false, enrichHTML });
	const { enrichedContent } = groups
		.find(group => group.id === "tiles")
		.rows.find(row => row.sourceUuid === "Scene.scene1.Tile.broken");

	assert.ok(enrichedContent.includes("ordinary"), "ordinary content was treated as a secret");
});

test("a gm's fallback keeps a data-class section's ordinary content", async () => {
	const content = await fallbackFor(DATA_CLASS_NOTE, { isGM: true });

	assert.equal(content, "publicordinarytail");
});

// The whole content contract in one place, because the three cases are only
// safe as a set: enrichment is what makes a note readable *and* what makes it
// safe, so when it fails the reader decides what is left — a player gets
// nothing, a GM gets inert text.
test("what a viewer is shown depends on the viewer and on whether enrichment worked", async () => {
	const working = makeEnricher();
	const groups = await buildPlaceableNoteIndex(makeSceneWithSecretNote(), {
		isGM: false,
		enrichHTML: working.enrichHTML,
	});
	const enrichedForPlayer = groups.find(group => group.id === "tiles").rows[0].enrichedContent;

	assert.equal(enrichedForPlayer, "<p>public</p>", "a working enrichment should still show a player the public part");
	assert.equal(await fallbackFor(NOTE_WITH_SECRET), "", "a failed enrichment should show a player nothing");
	assert.equal(
		await fallbackFor(MALFORMED_NOTE, { isGM: true }),
		MALFORMED_ESCAPED,
		"a failed enrichment should still show a gm escaped text"
	);
});

/**
 * A supported collection holding documents that do not belong in it. A scene's
 * `tiles` is *named* for tiles; nothing guarantees a module, macro, or import
 * has not put something else there. The Token is the sharper case of the two:
 * it is a supported type, so only its exact type — not its supportedness —
 * keeps it out of the Tiles group.
 */
function makeSceneWithImpostorsInTiles() {
	return sceneOf("tiles", [
		noted("Drawing", "Scene.scene1.Drawing.drawing1", { name: "Sketch" }),
		noted("Token", "Scene.scene1.Token.token1", { name: "Goblin" }),
		noted("Tile", "Scene.scene1.Tile.tile1", { name: "Vault" }),
	]);
}

test("a document in the wrong collection is not indexed as that collection's type", async () => {
	const groups = await buildPlaceableNoteIndex(makeSceneWithImpostorsInTiles(), {
		isGM: true,
		enrichHTML,
	});

	assert.deepEqual(
		groups.map(group => [group.id, group.rows.map(row => row.sourceUuid)]),
		[["tiles", ["Scene.scene1.Tile.tile1"]]]
	);
});
