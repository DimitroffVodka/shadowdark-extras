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
 * Non-destructive: creates and deletes nothing. Every assertion is a read or a
 * call against plain object literals.
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
			const { describe, it, assert, before } = context;

			let levelContext = null;
			let painter = null;
			let generator = null;

			before(async function () {
				this.timeout(30000);
				levelContext = await load("dungeon/dungeon-level-context.mjs");
				painter = await load("dungeon/DungeonPainterSD.mjs");
				generator = await load("dungeon/DungeonGeneratorSD.mjs");
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

				it("getDocumentLevelId ignores the default level and tolerates absent levels", function () {
					const { getDocumentLevelId } = levelContext;

					assert.equal(getDocumentLevelId(null), null);
					assert.equal(getDocumentLevelId({}), null);
					assert.equal(getDocumentLevelId({ levels: ["defaultLevel0000"] }), null);
					assert.equal(getDocumentLevelId({ levels: ["defaultLevel0000", "abc123"] }), "abc123");
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
