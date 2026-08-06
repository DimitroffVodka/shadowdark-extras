/**
 * Quench batch for the Phase 5.3 file splits.
 *
 * `verify.sh` and `dev/tools/prove-move.mjs` between them prove a great deal
 * about a split — that imports resolve, that names still exist, that the moved
 * declarations are ESTree-identical to what they replaced. All of it is static.
 * None of it proves the browser actually loaded the new module, or that the
 * name a caller imports resolves to the function that moved.
 *
 * The failure this exists to catch is the one static analysis is structurally
 * blind to: TWO INSTANCES OF THE MOVED MODULE. If the extracted file is reached
 * through two different specifiers, both copies load, both get their own copy of
 * the duplicated MODULE_ID/LEVEL_HEIGHT constants, and every static gate stays
 * green while callers silently diverge. An identity check between the re-export
 * and the origin is the only thing that sees it.
 *
 * Dev-only: lives under dev/, is not in module.zip, and registration is guarded
 * so a released install with Quench enabled stays silent.
 *
 * FOOTPRINT — read this before running it against a world you care about.
 *
 * Most of the batch only reads. Two groups do more:
 *
 *   - The live-binding tests briefly move two pieces of in-memory tool state
 *     (the selected wall tile, the transient selection overlay) and restore
 *     both in a `finally`. Neither is persisted.
 *
 *   - The interior-wall tests CREATE A SCRATCH SCENE, VIEW IT, paint into it,
 *     and delete it. This goes further than `structural.batch.mjs`'s scratch
 *     actor, and it does so because the three handlers under test read
 *     `canvas.scene` directly — they take positions, not a scene, so the only
 *     way to drive them without touching a real map is to make a throwaway
 *     scene the viewed one.
 *
 *     `view()` is GM-LOCAL and reversible; it is not `activate()`, so no other
 *     client is moved. The original scene is restored BEFORE the scratch scene
 *     is deleted, because deleting the viewed scene would otherwise leave
 *     Foundry to pick a replacement on its own. Restore and delete both live in
 *     `afterEach`, so a failing assertion still cleans up, and `before` sweeps
 *     any scratch scene left behind by a crashed earlier run.
 *
 *     Every document it creates lands on the scratch scene and dies with it.
 *     Nothing is written to a real scene.
 *
 * RUNNING IT HEADLESSLY (Playwright, or any console driver): render the Quench
 * results app FIRST, exactly as `structural.batch.mjs` documents —
 *
 *   await quench.app.render(true);
 *   await quench.runBatches(["shadowdark-extras.split"]);
 *
 * Calling runBatches() with the app closed wedges the run: no tests execute, no
 * `end` event fires, and every later run is refused until the page reloads.
 */

const MODULE_ID = "shadowdark-extras";
const BASE = `/modules/${MODULE_ID}/scripts`;

/**
 * The scratch-scene block is OPT-IN and skipped by default.
 *
 * It is the only part of this batch that creates documents and changes which
 * scene the GM is looking at. That is a fair price when you mean to run it and
 * an unpleasant surprise when you do not — so a plain `runBatches()` gets the
 * read-only subset, and the painting coverage is requested explicitly:
 *
 *   globalThis.SDX_SPLIT_SCRATCH = true;
 *   await quench.runBatches(["shadowdark-extras.split"]);
 *
 * When it is skipped, the three document-writing handlers
 * (`handleIntWallDrag`, `handleIntWallClick`, `handleIntWallDoorRemove`) are
 * UNCOVERED by the live pass. `updateIntWallLine` is covered either way,
 * because it touches only the PIXI overlay.
 */
const RUN_SCRATCH_SCENE_TESTS = globalThis.SDX_SPLIT_SCRATCH === true;

/** Scratch scenes are named so a crashed run can be swept on the next one. */
const SCRATCH_PREFIX = "sdx-split-scratch ";
const SCRATCH_GRID = 100;

/** Count embedded documents on a scene carrying one of our flags. */
const withFlag = (collection, key) =>
	[...collection].filter(doc => doc.flags?.[MODULE_ID]?.[key]);

/**
 * Import a module the way the running module already reached it.
 *
 * The absolute path matters. A relative or differently-spelled specifier
 * resolves to a different URL, which gives a SECOND module instance — and this
 * batch would then be testing its own import rather than the live one, turning
 * the identity assertions into tautologies that always pass.
 */
const load = path => import(`${BASE}/${path}`);

/** The eight declarations moved in 0c63168. */
const LEVEL_CONTEXT_EXPORTS = [
	"makeTopLeftTileTexture",
	"getSceneLevelContext",
	"getSceneLevelContextForElevation",
	"getDocumentLevelId",
	"resolveLevelContext",
	"documentMatchesLevel",
	"applySceneLevelData",
	"getCurrentElevation",
];

/** The four that were already public and must stay reachable from the painter. */
const PAINTER_REEXPORTS = [
	"getSceneLevelContext",
	"getDocumentLevelId",
	"applySceneLevelData",
	"getCurrentElevation",
];

export function registerSplitBatch(quench) {
	quench.registerBatch(
		`${MODULE_ID}.split`,
		(context) => {
			const { describe, it, assert, before, beforeEach, afterEach } = context;

			let levelContext = null;
			let painter = null;
			let generator = null;
			let toolState = null;
			let overlay = null;
			let interiorWalls = null;

			before(async function () {
				this.timeout(30000);
				levelContext = await load("dungeon/dungeon-level-context.mjs");
				painter = await load("dungeon/DungeonPainterSD.mjs");
				generator = await load("dungeon/DungeonGeneratorSD.mjs");
				toolState = await load("dungeon/dungeon-tool-state.mjs");
				overlay = await load("dungeon/dungeon-selection-overlay.mjs");
				interiorWalls = await load("dungeon/dungeon-interior-walls.mjs");
			});

			describe("dungeon-level-context extraction (0c63168)", function () {
				it("the extracted module loads in the browser", function () {
					assert.ok(levelContext, "dungeon-level-context.mjs did not load");
				});

				it("exports all eight moved declarations as functions", function () {
					for (const name of LEVEL_CONTEXT_EXPORTS) {
						assert.equal(
							typeof levelContext[name], "function",
							`dungeon-level-context.mjs is missing ${name}`,
						);
					}
				});

				it("still re-exports the four names that were already public", function () {
					for (const name of PAINTER_REEXPORTS) {
						assert.equal(
							typeof painter[name], "function",
							`DungeonPainterSD.mjs stopped exporting ${name} — importers break`,
						);
					}
				});

				it("re-exports the SAME function objects, so only one instance is loaded", function () {
					// The check the static gates cannot make. Two module instances
					// would satisfy every name-based gate and still diverge here.
					for (const name of PAINTER_REEXPORTS) {
						assert.strictEqual(
							painter[name], levelContext[name],
							`${name} is a different object via DungeonPainterSD — the module loaded twice`,
						);
					}
				});

				it("keeps the downstream importers loading", function () {
					// DungeonGeneratorSD imports three of the moved names. If the
					// re-export chain broke, this import would have thrown in before().
					assert.ok(generator, "DungeonGeneratorSD.mjs failed to load after the split");
				});
			});

			describe("ESM live bindings propagate across the extracted modules", function () {
				// The mechanism the whole split rests on. Every extracted module owns
				// some `let` that DungeonPainterSD.mjs still reads by bare identifier,
				// through an import. That only works because an ESM import is a LIVE
				// BINDING — a view onto the exporting module's variable — rather than a
				// value copied at import time.
				//
				// No static gate can check this. `prove-move` compares declaration
				// trees and is blind to it; the named-export and API snapshots only see
				// names. If the semantics were a snapshot instead, every gate would
				// stay green while the painter read stale state forever.

				it("a tool-state setter is visible to a painter-local reader", async function () {
					this.timeout(20000);
					// The strong form. `selectWallTile` assigns inside
					// dungeon-tool-state.mjs; `getDungeonPainterData` is declared in
					// DungeonPainterSD.mjs and reads its IMPORTED `_selectedWallTile`.
					// A snapshot import would return the pre-call value here.
					const original = toolState.getSelectedWallTile();
					const probe = "sdx-live-binding-probe.webp";

					try {
						toolState.selectWallTile(probe);

						const data = await painter.getDungeonPainterData();
						assert.equal(
							data.selectedWallTile, probe,
							"DungeonPainterSD read a stale value — its import is not a live binding",
						);
					}
					finally {
						toolState.selectWallTile(original);
					}

					assert.equal(toolState.getSelectedWallTile(), original, "the probe was not restored");
				});

				it("the exported binding itself updates, not just the getter", function () {
					// Guards the narrower failure where a getter is re-exported correctly
					// but the raw binding — which is what the painter actually imports —
					// is not.
					const original = toolState.getSelectedWallTile();
					const probe = "sdx-live-binding-probe-2.webp";

					try {
						toolState.selectWallTile(probe);
						assert.equal(toolState._selectedWallTile, probe);
					}
					finally {
						toolState.selectWallTile(original);
					}
				});

				it("the selection overlay's binding updates for its importers", function () {
					// Same mechanism in the module DungeonPainterSD leans on hardest:
					// updateIntWallLine calls createSelectionRect() and then immediately
					// re-reads `_selectionRect`, expecting the assignment made inside the
					// overlay module to be visible. If it were not, the overlay would be
					// built and then discarded on every single interior-wall drag.
					if (overlay._selectionRect) {
						// A drag is in flight — leave it alone rather than destroying
						// someone's in-progress selection.
						this.skip();
						return;
					}

					try {
						overlay.createSelectionRect();
						assert.ok(
							overlay._selectionRect,
							"createSelectionRect assigned, but importers still see null",
						);
					}
					finally {
						overlay.destroySelectionRect();
					}

					assert.equal(overlay._selectionRect, null, "destroySelectionRect did not clear the binding");
				});
			});

			describe("interior-wall drag preview (no documents touched)", function () {
				// The one moved painting function that writes nothing to the database.
				// It draws the drag line onto the shared PIXI overlay, so it can be
				// driven against a real world safely — and it is the only coverage the
				// interior-walls extraction gets when the scratch-scene block is
				// skipped, which is the default.
				//
				// It also exercises the cross-module path that extraction created:
				// updateIntWallLine lives in dungeon-interior-walls.mjs, calls
				// createSelectionRect() in dungeon-selection-overlay.mjs, and then
				// immediately re-reads `_selectionRect` expecting to see the assignment
				// the other module just made.

				it("builds the overlay on demand and draws into it", function () {
					if (overlay._selectionRect) {
						// A real drag is in flight; leave it alone.
						this.skip();
						return;
					}

					try {
						interiorWalls.updateIntWallLine({ x: 100, y: 100 }, { x: 400, y: 100 });

						assert.ok(
							overlay._selectionRect,
							"updateIntWallLine did not leave an overlay behind — either "
							+ "createSelectionRect was not reached, or the live binding did not propagate",
						);
					}
					finally {
						overlay.destroySelectionRect();
					}
				});

				it("reuses an existing overlay rather than building a second", function () {
					if (overlay._selectionRect) { this.skip(); return; }

					try {
						interiorWalls.updateIntWallLine({ x: 100, y: 100 }, { x: 400, y: 100 });
						const first = overlay._selectionRect;

						interiorWalls.updateIntWallLine({ x: 100, y: 100 }, { x: 500, y: 200 });

						assert.equal(overlay._selectionRect, first, "a second overlay was created");
					}
					finally {
						overlay.destroySelectionRect();
					}
				});
			});

			describe("interior-wall painting against a scratch scene", function () {
				// The three handlers moved in the interior-walls extraction create and
				// delete real Wall and Drawing documents. Everything else in this batch
				// only reads, so without this block the extraction's 545 moved lines
				// would be covered by nothing but "the module loaded" — a green run that
				// says nothing about the code that actually moved.
				//
				// They read `canvas.scene` rather than taking one, so the scratch scene
				// has to be the viewed scene. See the footprint note at the top.

				let scratch = null;
				let previousSceneId = null;
				let toolStateRestore = null;

				before(async function () {
					this.timeout(60000);
					if (!RUN_SCRATCH_SCENE_TESTS) { this.skip(); return; }
					// Sweep anything a crashed earlier run left behind.
					const stale = game.scenes.filter(s => s.name.startsWith(SCRATCH_PREFIX));
					for (const scene of stale) await scene.delete();
				});

				beforeEach(async function () {
					this.timeout(60000);
					previousSceneId = canvas.scene?.id ?? null;
					toolStateRestore = {
						intWall: toolState.getSelectedIntWallTile(),
						intDoor: toolState.getSelectedIntDoorTile(),
						noFoundryWalls: toolState.getNoFoundryWalls(),
						wallShadows: toolState.getWallShadows(),
					};

					scratch = await Scene.create({
						name: `${SCRATCH_PREFIX}${foundry.utils.randomID()}`,
						width: 2000,
						height: 2000,
						grid: { type: CONST.GRID_TYPES.SQUARE, size: SCRATCH_GRID },
					});
					await scratch.view();

					// The handlers bail with a notification unless a tile is selected.
					// Any path will do — nothing here asserts on the texture.
					toolState.selectIntWallTile(`modules/${MODULE_ID}/assets/Dungeon/wall_tiles/stone_brick_horizontal.webp`);
					toolState.selectIntDoorTile(`modules/${MODULE_ID}/assets/Dungeon/door_tiles/portal_horizontal.webp`);
					// Shadows off: TokenMagic may not be installed, and its absence is
					// not what these tests are about.
					toolState.setWallShadows(false);
					toolState.setNoFoundryWalls(false);
				});

				afterEach(async function () {
					this.timeout(60000);
					// Restore the view BEFORE deleting, or Foundry picks a replacement
					// scene on its own and the GM lands somewhere arbitrary.
					const previous = previousSceneId ? game.scenes.get(previousSceneId) : null;
					if (previous && previous.id !== scratch?.id) await previous.view();
					if (scratch) { await scratch.delete(); scratch = null; }

					if (toolStateRestore) {
						toolState.selectIntWallTile(toolStateRestore.intWall);
						toolState.selectIntDoorTile(toolStateRestore.intDoor);
						toolState.setNoFoundryWalls(toolStateRestore.noFoundryWalls);
						toolState.setWallShadows(toolStateRestore.wallShadows);
						toolStateRestore = null;
					}
				});

				/** Drag a wall four grid squares long, well inside the scene. */
				const dragAWall = () => interiorWalls.handleIntWallDrag(
					{ x: SCRATCH_GRID * 2, y: SCRATCH_GRID * 2 },
					{ x: SCRATCH_GRID * 6, y: SCRATCH_GRID * 2 },
				);
				const wallMidpoint = { x: SCRATCH_GRID * 4, y: SCRATCH_GRID * 2 };

				it("a drag paints an interior wall and its visual", async function () {
					this.timeout(60000);
					assert.equal(withFlag(scratch.walls, "dungeonIntWall").length, 0, "scratch scene started dirty");

					await dragAWall();

					assert.ok(
						withFlag(scratch.walls, "dungeonIntWall").length > 0,
						"handleIntWallDrag created no flagged Wall document",
					);
					assert.ok(
						withFlag(scratch.drawings, "dungeonIntWall").length > 0,
						"handleIntWallDrag created no flagged Drawing document",
					);
				});

				it("a drag creates nothing when no interior wall tile is selected", async function () {
					this.timeout(60000);
					toolState.selectIntWallTile(null);

					await dragAWall();

					assert.equal(
						withFlag(scratch.walls, "dungeonIntWall").length, 0,
						"a wall was painted despite no tile being selected",
					);
				});

				it("clicking an interior wall inserts a door into it", async function () {
					this.timeout(60000);
					await dragAWall();
					const before = withFlag(scratch.walls, "dungeonIntDoor").length;

					await interiorWalls.handleIntWallClick(wallMidpoint);

					assert.ok(
						withFlag(scratch.walls, "dungeonIntDoor").length > before,
						"handleIntWallClick inserted no door into the wall",
					);
				});

				it("removing a door takes the door documents back out", async function () {
					this.timeout(60000);
					await dragAWall();
					await interiorWalls.handleIntWallClick(wallMidpoint);
					assert.ok(withFlag(scratch.walls, "dungeonIntDoor").length > 0, "no door to remove");

					await interiorWalls.handleIntWallDoorRemove(wallMidpoint);

					assert.equal(
						withFlag(scratch.walls, "dungeonIntDoor").length, 0,
						"handleIntWallDoorRemove left door documents behind",
					);
				});

				it("the interior wall survives having a door inserted and removed", async function () {
					this.timeout(60000);
					// The round trip is the point: a door is cut into an existing wall
					// and then healed. Losing the wall itself would be a silent
					// regression that the per-step assertions above would not catch.
					await dragAWall();
					await interiorWalls.handleIntWallClick(wallMidpoint);
					await interiorWalls.handleIntWallDoorRemove(wallMidpoint);

					assert.ok(
						withFlag(scratch.walls, "dungeonIntWall").length > 0,
						"the interior wall vanished across the door round trip",
					);
				});

				it("a non-GM paints nothing", async function () {
					this.timeout(60000);
					// All three start with `if (!game.user.isGM) return;`. Quench runs as
					// whoever is logged in, so this only means anything for a GM — skip
					// rather than assert something vacuous.
					if (!game.user.isGM) { this.skip(); return; }

					const original = game.user.isGM;
					try {
						Object.defineProperty(game.user, "isGM", { value: false, configurable: true });
						await dragAWall();
						assert.equal(withFlag(scratch.walls, "dungeonIntWall").length, 0);
					}
					finally {
						Object.defineProperty(game.user, "isGM", { value: original, configurable: true });
					}
				});
			});

			describe("moved functions still work against the live canvas", function () {
				it("getSceneLevelContext returns the documented shape", function () {
					const result = levelContext.getSceneLevelContext();

					assert.ok(result && typeof result === "object", "expected a level context object");
					assert.ok(
						result.levelId === null || typeof result.levelId === "string",
						`levelId should be a string or null, got ${typeof result.levelId}`,
					);
					assert.ok(Number.isFinite(result.elevation), "elevation must be a finite number");
					assert.ok(Number.isFinite(result.rangeTop), "rangeTop must be a finite number");
				});

				it("getCurrentElevation returns a finite number", function () {
					// Its whole body is a fallback chain ending in `return 0`, so a
					// non-number here means a branch started throwing past its catch.
					assert.ok(Number.isFinite(levelContext.getCurrentElevation()));
				});

				it("getDocumentLevelId prefers a real level but falls back to the default", function () {
					// Measured against the live world, not predicted. The first
					// draft of this test asserted null for a default-only document
					// and failed: the function falls back to `defaultLevel0000`
					// rather than returning null, and that fallback is load-bearing
					// — world 0100's active scene reports exactly that level id, so
					// a null here would strip level membership from every document
					// created on an unlevelled scene.
					const { getDocumentLevelId } = levelContext;

					assert.equal(getDocumentLevelId(null), null);
					assert.equal(getDocumentLevelId({}), null);
					assert.equal(getDocumentLevelId({ levels: [] }), null);
					assert.equal(getDocumentLevelId({ levels: ["defaultLevel0000"] }), "defaultLevel0000");
					assert.equal(getDocumentLevelId({ levels: ["abc123"] }), "abc123");
					assert.equal(getDocumentLevelId({ levels: ["defaultLevel0000", "abc123"] }), "abc123");
					assert.equal(getDocumentLevelId({ levels: ["", "abc123"] }), "abc123");
					// Any iterable, not just an array — real documents hand it a Set.
					assert.equal(getDocumentLevelId({ levels: new Set(["defaultLevel0000"]) }), "defaultLevel0000");
				});

				it("applySceneLevelData tags a wall with an absolute wall-height range", function () {
					const doc = levelContext.applySceneLevelData({}, "Wall", {
						levelId: null, elevation: 20, rangeTop: 29,
					});

					assert.deepEqual(doc.flags["wall-height"], { bottom: 20, top: 29 });
					assert.equal(doc.elevation, undefined, "walls must not gain a relative elevation");
				});

				it("applySceneLevelData tags a non-wall with a relative elevation", function () {
					const doc = levelContext.applySceneLevelData({}, "Tile", {
						levelId: null, elevation: 20, rangeTop: 29,
					});

					assert.equal(doc.elevation, 0, "non-walls default to 0 within their level");
					assert.deepEqual(doc.flags.levels, { rangeTop: 29 });
				});

				it("applySceneLevelData preserves an explicit caller elevation", function () {
					const doc = levelContext.applySceneLevelData({ elevation: 7 }, "Tile", {
						levelId: null, elevation: 20, rangeTop: 29,
					});

					assert.equal(doc.elevation, 7);
				});

				it("applySceneLevelData assigns level membership when the context has a level", function () {
					const doc = levelContext.applySceneLevelData({}, "Tile", {
						levelId: "lvl-1", elevation: 0, rangeTop: 9,
					});

					assert.deepEqual(doc.levels, ["lvl-1"]);
				});
			});
		},
		{ displayName: "SDX: split (post-extraction runtime)" },
	);
}
