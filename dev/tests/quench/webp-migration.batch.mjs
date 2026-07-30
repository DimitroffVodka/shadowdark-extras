/**
 * Quench batch for the PNG/JPG -> WebP stored-path migration.
 *
 * The unit tests in dev/tests/webp-migration-paths.test.mjs cover the pure
 * path/encoding logic. This batch covers what they cannot: that the migration
 * actually finds and rewrites paths buried in real Foundry documents - scene
 * tiles, token textures, note icons and module flags - in a live client.
 *
 * Dev-only: this file lives under dev/ and is NOT part of module.zip, so it
 * never ships. Registration is guarded so a released install with Quench
 * enabled stays silent rather than logging an import failure.
 */

const MODULE_ID = "shadowdark-extras";
const P = `modules/${MODULE_ID}/`;
const NAME_PREFIX = "Test sdx-webp ";

export function registerWebpMigrationBatch(quench) {
    quench.registerBatch(
        `${MODULE_ID}.webp-migration`,
        (context) => {
            const { describe, it, assert, before, afterEach } = context;
            const created = [];

            const api = () => game.modules.get(MODULE_ID).api;

            before(async function () {
                this.timeout(60000);
                // Self-heal after a crashed prior run.
                const stale = game.scenes.filter((s) => s.name.startsWith(NAME_PREFIX)).map((s) => s.id);
                if (stale.length) await Scene.deleteDocuments(stale);
            });

            afterEach(async function () {
                this.timeout(60000);
                if (created.length) await Scene.deleteDocuments(created.splice(0));
            });

            const makeScene = async (tiles, extra = {}) => {
                const scene = await Scene.create({
                    name: `${NAME_PREFIX}${Date.now()}-${Math.floor(performance.now())}`,
                    width: 4000,
                    height: 4000,
                    tiles: tiles.map((src, i) => ({
                        texture: { src },
                        x: i * 120, y: 0, width: 100, height: 100,
                    })),
                    ...extra,
                });
                created.push(scene.id);
                return scene;
            };

            describe("stored path rewriting", function () {
                it("rewrites converted paths regardless of URL encoding", async function () {
                    this.timeout(60000);
                    const scene = await makeScene([
                        `${P}assets/tiles/skulls.png`,
                        `${P}assets/symbols/Dysonstyle/B%26W-Camp-Feu01.png`,
                        `${P}assets/symbols/Dysonstyle/B&W-Camp-Feu01.png`,
                        `${P}assets/Hexes/Badlands/Hex%20-%20Plains%20(damp)%201.png`,
                        `${P}assets/Hexes/Badlands/Hex - Plains (damp) 1.png`,
                    ]);

                    await api().migrateWebpAssetPaths({ force: true });

                    for (const tile of scene.toObject().tiles) {
                        assert.ok(
                            tile.texture.src.endsWith(".webp"),
                            `not migrated: ${tile.texture.src}`
                        );
                    }
                });

                it("leaves every migrated path resolvable over HTTP", async function () {
                    this.timeout(60000);
                    const scene = await makeScene([
                        `${P}assets/symbols/Dysonstyle/B%26W-Camp-Feu01.png`,
                        `${P}assets/Hexes/Badlands/Hex%20-%20Plains%20(damp)%201.png`,
                        `${P}assets/symbols/Dysonstyle/B%26W-Country-Barri%C3%A8re-01.png`,
                    ]);

                    await api().migrateWebpAssetPaths({ force: true });

                    for (const tile of scene.toObject().tiles) {
                        const url = "/" + tile.texture.src.split("/").map((seg) => {
                            let d = seg;
                            try { d = decodeURIComponent(seg); } catch (e) { /* keep raw */ }
                            return encodeURIComponent(d);
                        }).join("/");
                        const res = await fetch(url, { method: "HEAD" });
                        assert.equal(res.status, 200, `dead after migration: ${tile.texture.src}`);
                    }
                });

                it("does not touch assets deliberately kept as PNG/JPG", async function () {
                    this.timeout(60000);
                    const kept = [
                        `${P}assets/Dungeon/backgrounds/dark-wood.png`,
                        `${P}assets/Tom/banner_tom.png`,
                    ];
                    const scene = await makeScene(kept);

                    await api().migrateWebpAssetPaths({ force: true });

                    const after = scene.toObject().tiles.map((t) => t.texture.src);
                    assert.deepEqual(after, kept, "a kept PNG was rewritten to a non-existent webp");
                });

                it("does not touch other packages' asset paths", async function () {
                    this.timeout(60000);
                    const foreign = [
                        "modules/tokenmagic/fx/assets/distortion-1.png",
                        "systems/shadowdark/assets/some-art.png",
                        "worlds/test/uploads/player-token.png",
                    ];
                    const scene = await makeScene(foreign);

                    await api().migrateWebpAssetPaths({ force: true });

                    assert.deepEqual(scene.toObject().tiles.map((t) => t.texture.src), foreign);
                });

                it("reaches paths nested inside module flags", async function () {
                    this.timeout(60000);
                    const scene = await makeScene([], {
                        flags: {
                            [MODULE_ID]: {
                                hexData: {
                                    tiles: [
                                        { img: `${P}assets/Hexes/Autumn/autumnbog.png` },
                                        { img: `${P}assets/tiles/skulls.png` },
                                    ],
                                },
                            },
                        },
                    });

                    await api().migrateWebpAssetPaths({ force: true });

                    const flagged = scene.toObject().flags[MODULE_ID].hexData.tiles;
                    for (const entry of flagged) {
                        assert.ok(entry.img.endsWith(".webp"), `flag path not migrated: ${entry.img}`);
                    }
                });
            });

            describe("idempotence", function () {
                it("is a no-op on a second pass", async function () {
                    this.timeout(60000);
                    const scene = await makeScene([`${P}assets/tiles/skulls.png`]);

                    await api().migrateWebpAssetPaths({ force: true });
                    const firstPass = scene.toObject().tiles[0].texture.src;

                    const second = await api().migrateWebpAssetPaths({ force: true, dryRun: true });
                    const stillSame = scene.toObject().tiles[0].texture.src;

                    assert.equal(stillSame, firstPass, "second pass mutated an already-migrated path");
                    assert.equal(second.refs, 0, "dry run still reports pending changes");
                });

                it("dry run reports changes without writing them", async function () {
                    this.timeout(60000);
                    const original = `${P}assets/tiles/skulls.png`;
                    const scene = await makeScene([original]);

                    const dry = await api().migrateWebpAssetPaths({ force: true, dryRun: true });

                    assert.ok(dry.refs >= 1, "dry run found nothing to do");
                    assert.equal(
                        scene.toObject().tiles[0].texture.src,
                        original,
                        "dry run mutated the document"
                    );
                });
            });
        },
        { displayName: "Shadowdark Extras: WebP path migration" }
    );
}
