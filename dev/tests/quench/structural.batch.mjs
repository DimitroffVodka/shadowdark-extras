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
 * WAIT FOR `end`. `runBatches()` resolves before the two async sheet-render
 * tests have settled, so reading `runner.stats` off the resolved promise
 * reports **7 passing** and then climbs to 9 a second or two later. Over a
 * request/response bridge that under-read looks exactly like two tests silently
 * failing to register, which is a much more alarming thing than it is. If you
 * cannot hook `end` from your harness, poll `runner.stats.tests` until it stops
 * advancing before you believe the number.
 *
 * Verified 2026-07-30 on Quench 0.10.1 / Foundry 14.365: 9 passing, 0 failing.
 * Re-verified 2026-07-31 after the step-13 templates extraction: 9 passing,
 * 0 failing, 0 pending, 2,293 ms.
 *
 * THIS BATCH DEFINES NINE TESTS. `grep -c "it("` returns TEN, because
 * `.split(/\s+/)` below contains the substring `it(`. There is no conditional
 * or skipped test here — a PR #21 reviewer inferred one from that count, which
 * is the same substring-match mistake the binding gate shipped twice. Count
 * with a boundary: `grep -cP '(?<![\w$.])it\('`.
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
                 * `module.json` declares four esmodules. Each gets an observable,
                 * not an inference — two are proved transitively and the reason is
                 * stated, rather than being waved at:
                 *
                 *  - shadowdark-extras.mjs   its api object exists
                 *  - SheetEditorConfig.mjs   statically imported by the root
                 *                            (shadowdark-extras.mjs:57), so a load
                 *                            failure takes the root's api with it
                 *  - SpellMacrosSD.mjs       side-effect imported by the root
                 *                            (line 79) AND backs named api entries
                 *  - TileFlattenSD.mjs       loaded independently by Foundry, not by
                 *                            the root, so it needs its own probe: it
                 *                            is the tree's ONLY registrant of
                 *                            `renderTileHUD`
                 */
                it("loaded every declared esmodule", function () {
                    const surface = api();

                    // Root, and with it the two esmodules it imports.
                    assert.ok(surface, "composition root did not build module.api");

                    // SpellMacrosSD, named surface.
                    for (const name of ["identifyItem", "isUnidentified", "showIdentifyDialog"]) {
                        assert.equal(typeof surface[name], "function", `SpellMacrosSD export missing: ${name}`);
                    }

                    // TileFlattenSD — nothing else in the tree registers this hook,
                    // so a callback here means that module executed.
                    const tileHudHandlers = Hooks.events?.renderTileHUD?.length ?? 0;
                    assert.ok(
                        tileHudHandlers >= 1,
                        "TileFlattenSD did not register its renderTileHUD hook — the module failed to load",
                    );
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
                /**
                 * The exact live set, not a count. A count is satisfied by
                 * swapping one loop-built key for a different one, which loses a
                 * setting silently — the precise failure this tier exists to
                 * catch, since the static gate is blind to those keys entirely.
                 */
                it("registers exactly the expected live key set", function () {
                    const gatedInactive = new Set(
                        Object.entries(settingsBaseline.optionalModuleGated ?? {})
                            .filter(([moduleId]) => !game.modules.get(moduleId)?.active)
                            .flatMap(([, keys]) => keys),
                    );

                    const expected = new Set([
                        ...settingsBaseline.keys.filter((key) => !gatedInactive.has(key)),
                        ...(settingsBaseline.dynamicKeys ?? []),
                    ]);
                    const live = new Set(
                        [...game.settings.settings.keys()]
                            .filter((key) => key.startsWith(`${MODULE_ID}.`))
                            .map((key) => key.slice(MODULE_ID.length + 1)),
                    );

                    const missing = [...expected].filter((key) => !live.has(key)).sort();
                    const added = [...live].filter((key) => !expected.has(key)).sort();

                    assert.deepEqual(missing, [], `settings keys no longer registered: ${missing.join(", ")}`);
                    assert.deepEqual(added, [], `unrecorded settings keys registered: ${added.join(", ")}`);
                });
            });

            describe("sheet enhancement", function () {
                /**
                 * Rendering without throwing is not enough. A sheet enhancer that
                 * stops running after a move injects nothing and throws nothing —
                 * the sheet renders perfectly, as the system's own sheet. So these
                 * assert SDX-owned markup is actually present.
                 *
                 * The system's sheets are ApplicationV1, so `sheet.element` is a
                 * jQuery object, not an HTMLElement. Reading `.outerHTML` off it
                 * silently yields undefined — which is why the earlier version of
                 * this batch could assert `element` truthy and prove nothing.
                 *
                 * Run in the disposable test world with default settings: several
                 * of these markers belong to features a GM can switch off.
                 */
                const sheetHtml = (sheet) => {
                    const element = sheet.element;
                    if (!element) return "";
                    if (element instanceof HTMLElement) return element.outerHTML;
                    if (element[0] instanceof HTMLElement) return element[0].outerHTML;
                    return "";
                };

                const sdxClasses = (html) => [
                    ...new Set(
                        [...html.matchAll(/class="([^"]*)"/g)]
                            .flatMap((match) => match[1].split(/\s+/))
                            .filter((name) => /^sdx-/.test(name)),
                    ),
                ];

                it("injects SDX markup into a character sheet", async function () {
                    this.timeout(30000);
                    const actor = await Actor.create({ name: `${NAME_PREFIX}PC`, type: "Player" });
                    created.push(actor);

                    const sheet = actor.sheet;
                    await sheet.render(true);
                    await new Promise((resolve) => setTimeout(resolve, 900));
                    const html = sheetHtml(sheet);

                    assert.ok(sheet.rendered, "character sheet did not render");
                    assert.ok(html.length > 0, "character sheet produced no readable markup");

                    // Distinct owners, so a single moved feature is identifiable:
                    // the header/HP enhancers live in the composition root, the
                    // lock toggle in SheetLockManager (Phase 2 step 16).
                    for (const marker of ["sdx-enhanced-header", "sdx-hp-bar-container", "sdx-sheet-lock-toggle"]) {
                        assert.ok(
                            html.includes(marker),
                            `character sheet is missing "${marker}" — its enhancer did not run`,
                        );
                    }
                    assert.ok(
                        sdxClasses(html).length >= 10,
                        `only ${sdxClasses(html).length} SDX classes on the character sheet; enhancers largely absent`,
                    );
                    await sheet.close();
                });

                it("injects SDX markup into a spell item sheet", async function () {
                    this.timeout(30000);
                    const item = await Item.create({ name: `${NAME_PREFIX}Spell`, type: "Spell" });
                    created.push(item);

                    const sheet = item.sheet;
                    await sheet.render(true);
                    await new Promise((resolve) => setTimeout(resolve, 900));
                    const html = sheetHtml(sheet);

                    assert.ok(sheet.rendered, "item sheet did not render");
                    assert.ok(html.length > 0, "item sheet produced no readable markup");

                    for (const marker of ["sdx-targeting-box", "sdx-template-settings"]) {
                        assert.ok(
                            html.includes(marker),
                            `spell sheet is missing "${marker}" — the targeting enhancer did not run`,
                        );
                    }
                    assert.ok(
                        sdxClasses(html).length >= 10,
                        `only ${sdxClasses(html).length} SDX classes on the spell sheet; enhancers largely absent`,
                    );
                    await sheet.close();
                });
            });
        },
        { displayName: "SDX: structural (post-move smoke)" },
    );
}
