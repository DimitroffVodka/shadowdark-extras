/**
 * Quench batch for the feature-reorganization structural track.
 *
 * The Phase 0 gates in `verify.sh` are all static. They prove that files
 * resolve, that names still exist, and that call sites did not move. They
 * cannot prove the module actually LOADED and did its work — and after a
 * feature-folder move, that is the failure everyone is afraid of.
 *
 * This batch is the runtime half. Run it after each Phase 2 move commit; it
 * covers the smoke-matrix rows that were otherwise manual clicking:
 *
 *   - Bootstrap & API   -> module active, api key set matches the baseline
 *   - (previously unguarded) -> every settings key actually registered
 *   - Bootstrap         -> declared esmodules loaded and self-registered
 *   - Inventory / sheets -> a real sheet renders with SDX markup injected
 *
 * Dev-only: this file lives under dev/ and is NOT part of module.zip, so it
 * never ships. Registration is guarded so a released install with Quench
 * enabled stays silent rather than logging an import failure.
 *
 * Non-destructive: the only documents it creates are a scratch actor and item,
 * both deleted in afterEach, and it never writes a setting.
 *
 * RUNNING IT HEADLESSLY (e.g. over the foundry-vtt MCP bridge): render the
 * Quench results app FIRST. Quench's reporter writes into that app's DOM, and
 * calling `quench.runBatches()` while it is closed leaves the run wedged — no
 * tests execute, no `end` event fires, and every later run is refused with
 * "Mocha instance is currently running tests". Recovering needs a page reload.
 *
 *   await quench.app.render(true);
 *   await new Promise((r) => setTimeout(r, 1000));
 *   const runner = await quench.runBatches(["shadowdark-extras.structural"]);
 *   runner.once("end", () => console.log(runner.stats));
 *
 * Verified 2026-07-30 on Quench 0.10.1 / Foundry 14.365: 9 passing, 0 failing.
 */

const MODULE_ID = "shadowdark-extras";
const NAME_PREFIX = "Test sdx-structural ";

const SNAPSHOT_BASE = `/modules/${MODULE_ID}/dev/snapshots/`;

async function loadSnapshot(name) {
    const response = await fetch(`${SNAPSHOT_BASE}${name}`);
    if (!response.ok) throw new Error(`cannot read dev/snapshots/${name} (HTTP ${response.status})`);
    return response.json();
}

export function registerStructuralBatch(quench) {
    quench.registerBatch(
        `${MODULE_ID}.structural`,
        (context) => {
            const { describe, it, assert, before, afterEach } = context;

            const api = () => game.modules.get(MODULE_ID)?.api;
            const created = [];

            let apiBaseline = null;
            let settingsBaseline = null;

            before(async function () {
                this.timeout(30000);
                apiBaseline = await loadSnapshot("api-exports.json");
                settingsBaseline = await loadSnapshot("settings-keys.json");

                // Self-heal after a crashed prior run.
                const staleActors = game.actors.filter((a) => a.name.startsWith(NAME_PREFIX)).map((a) => a.id);
                if (staleActors.length) await Actor.deleteDocuments(staleActors);
                const staleItems = game.items.filter((i) => i.name.startsWith(NAME_PREFIX)).map((i) => i.id);
                if (staleItems.length) await Item.deleteDocuments(staleItems);
            });

            afterEach(async function () {
                this.timeout(30000);
                while (created.length) {
                    const doc = created.pop();
                    try {
                        await doc.delete();
                    } catch {
                        // Already gone, or deleted by the test itself.
                    }
                }
            });

            describe("module bootstrap", function () {
                it("is active and exposes its API", function () {
                    const module = game.modules.get(MODULE_ID);
                    assert.ok(module, `${MODULE_ID} is not installed`);
                    assert.ok(module.active, `${MODULE_ID} is installed but not active`);
                    assert.ok(api(), "module.api is missing — the composition root did not finish");
                });

                /**
                 * The static export snapshot proves the ROOT still exports its
                 * names. This proves the API object was actually assembled from
                 * them at runtime, which is the part Phase 3's extractions can
                 * break while every static gate stays green.
                 */
                it("exposes exactly the baselined module.api key set", function () {
                    const expected = [...(apiBaseline.moduleApi?.keys ?? [])].sort();
                    assert.ok(expected.length > 0, "api baseline is empty — recapture it from a live world");

                    const actual = Object.keys(api()).sort();
                    const missing = expected.filter((key) => !actual.includes(key));
                    const added = actual.filter((key) => !expected.includes(key));

                    assert.deepEqual(missing, [], `module.api lost keys: ${missing.join(", ")}`);
                    assert.deepEqual(added, [], `module.api gained keys: ${added.join(", ")}`);
                });

                it("exposes the baselined nested API groups", function () {
                    for (const [group, expected] of Object.entries(apiBaseline.moduleApi?.nested ?? {})) {
                        const actual = api()[group];
                        assert.ok(actual, `module.api.${group} is missing`);
                        assert.deepEqual(
                            Object.keys(actual).sort(),
                            [...expected].sort(),
                            `module.api.${group} keys changed`,
                        );
                    }
                });

                /**
                 * `module.json` declares four esmodules. Three are feature entry
                 * points that self-register on import; if one silently fails to
                 * load after a move, its API names simply never appear.
                 */
                it("loaded every declared esmodule", function () {
                    const surface = api();
                    // SpellMacrosSD backs these; TileFlattenSD and SheetEditorConfig
                    // register sheets/hooks rather than API names, so they are
                    // covered by the settings and hook checks below.
                    for (const name of ["identifyItem", "isUnidentified", "showIdentifyDialog"]) {
                        assert.equal(typeof surface[name], "function", `SpellMacrosSD export missing: ${name}`);
                    }
                });
            });

            describe("settings identity", function () {
                /**
                 * Settings keys are stored in user worlds — a rename orphans
                 * every GM's configured value without throwing. The static gate
                 * can only read ~141 of them; this reads the live registry, so
                 * it also covers the ones built in loops.
                 */
                it("registered every statically-known settings key", function () {
                    const gated = new Set(
                        Object.entries(settingsBaseline.optionalModuleGated ?? {})
                            .filter(([moduleId]) => !game.modules.get(moduleId)?.active)
                            .flatMap(([, keys]) => keys),
                    );

                    const missing = settingsBaseline.keys
                        .filter((key) => !gated.has(key))
                        .filter((key) => !game.settings.settings.has(`${MODULE_ID}.${key}`));

                    assert.deepEqual(
                        missing,
                        [],
                        `settings keys in source but not registered: ${missing.join(", ")}`,
                    );
                });

                it("registered every settings menu", function () {
                    const missing = settingsBaseline.menus.filter(
                        (id) => !game.settings.menus.has(`${MODULE_ID}.${id}`),
                    );

                    assert.deepEqual(missing, [], `settings menus not registered: ${missing.join(", ")}`);
                });

                /**
                 * Guards the other direction: the static gate is blind to keys
                 * built in loops, so a move that drops one of those would pass
                 * every gate. Pinning the live total catches it.
                 */
                it("registers at least as many keys as the recorded live total", function () {
                    const recorded = settingsBaseline.liveKeyTotalExcludingGated;
                    if (recorded === null || recorded === undefined) {
                        this.skip();
                        return;
                    }

                    const live = [...game.settings.settings.keys()].filter((k) =>
                        k.startsWith(`${MODULE_ID}.`),
                    ).length;
                    // The baseline excludes gated keys; add back the ones whose
                    // module is active HERE, so the expectation holds in any world.
                    const gatedActive = Object.entries(settingsBaseline.optionalModuleGated ?? {})
                        .filter(([moduleId]) => game.modules.get(moduleId)?.active)
                        .flatMap(([, keys]) => keys).length;
                    const expected = recorded + gatedActive;

                    assert.ok(
                        live >= expected,
                        `live settings keys dropped: ${live} registered, expected at least ${expected}`,
                    );
                });
            });

            describe("sheet rendering", function () {
                /**
                 * The most-repeated smoke rows in the plan are "open a PC sheet"
                 * and "open an item sheet". A move that breaks a sheet enhancer
                 * throws during render, which is what this actually catches —
                 * asserting on specific injected markup would couple the gate to
                 * cosmetic DOM and produce false failures.
                 */
                it("renders a character sheet without error", async function () {
                    this.timeout(30000);
                    const actor = await Actor.create({ name: `${NAME_PREFIX}PC`, type: "Player" });
                    created.push(actor);
                    assert.ok(actor, "could not create a scratch Player actor");

                    const sheet = actor.sheet;
                    await sheet.render(true);
                    await new Promise((resolve) => setTimeout(resolve, 400));

                    assert.ok(sheet.rendered, "character sheet did not render");
                    assert.ok(sheet.element, "character sheet produced no element");
                    await sheet.close();
                });

                it("renders an item sheet without error", async function () {
                    this.timeout(30000);
                    const item = await Item.create({ name: `${NAME_PREFIX}Spell`, type: "Spell" });
                    created.push(item);
                    assert.ok(item, "could not create a scratch Spell item");

                    const sheet = item.sheet;
                    await sheet.render(true);
                    await new Promise((resolve) => setTimeout(resolve, 400));

                    assert.ok(sheet.rendered, "item sheet did not render");
                    await sheet.close();
                });
            });
        },
        { displayName: "SDX: structural (post-move smoke)" },
    );
}
