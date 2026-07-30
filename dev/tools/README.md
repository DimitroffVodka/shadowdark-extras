# Structural gates

Tooling for the feature-reorganization track. These gates exist to protect one
assumption: **script file paths may move freely, because nothing depends on
where a script lives.** Everything else — module id, settings keys, socket event
names, flag namespaces, Handlebars template paths under the module-root
`templates/` tree, i18n keys, public API names — is a rename invariant and is
not this tooling's concern.

All four run as blocking checks inside `verify.sh`. Run them individually while
iterating:

```bash
npm run gate:imports && npm run gate:script-paths && npm run snapshot:registrations && npm run snapshot:api
```

## The gates

| Gate | Command | Proves |
| --- | --- | --- |
| Relative-import resolver | `npm run gate:imports` | Every static and literal dynamic relative import resolves to a file that exists. |
| String-path guard | `npm run gate:script-paths` | No shipped runtime JS contains `modules/shadowdark-extras/scripts/`. |
| Registration snapshot | `npm run snapshot:registrations` | The set and per-module source order of `Hooks.on/once/off`, `libWrapper.register`, and socketlib registrations is unchanged. |
| API-export snapshot | `npm run snapshot:api` | The four manifest-declared esmodules export the same names. |
| Settings-key snapshot | `npm run snapshot:settings` | No settings key or menu id was renamed or removed. These are stored in user worlds, so a rename silently orphans every GM's configured value. |

## The runtime tier — Quench

The five gates above are static. They cannot prove the module actually loaded
and did its work, which is the failure a feature-folder move is most likely to
cause. The `shadowdark-extras.structural` Quench batch
(`dev/tests/quench/structural.batch.mjs`) covers that, and automates four rows
of the plan's smoke matrix: module active and `module.api` matching the
baseline, every settings key actually registered, the declared esmodules loaded,
and real character/item sheets rendering.

Run it after each Phase 2 move commit. It cannot run in CI — it needs a browser
and a world — so it is a pre-merge tier above the static gates, not a
replacement for them.

**Running it headlessly (MCP bridge): render the results app first.** Quench's
reporter writes into that app's DOM; calling `quench.runBatches()` while it is
closed wedges the run — no tests execute, no `end` event fires, and every later
run is refused with "Mocha instance is currently running tests" until the page
is reloaded.

```js
await quench.app.render(true);
await new Promise((r) => setTimeout(r, 1000));
const runner = await quench.runBatches(["shadowdark-extras.structural"]);
runner.once("end", () => console.log(runner.stats));
```

Verified 2026-07-30 on Quench 0.10.1 / Foundry 14.365 / Shadowdark 4.0.6:
**9 passing, 0 failing**, no leftover documents.

### Why the settings check needs both tiers

The static gate reads 141 keys and 17 menus. The live registry has **156** keys,
because roughly a dozen call sites build their key in a loop — those are counted
in `dynamicSites` rather than hidden, so the blind spot is visible and its size
is itself gated. The batch reads the live registry and so covers all 156.

Three keys go the other way: `aaIntegration`, `aaAnimateOnSuccess`, and
`aaAnimateSpellsWithoutTarget` exist in source but are registered only when the
`autoanimations` module is active. They are listed under `optionalModuleGated`
in the snapshot so the batch does not demand a key that legitimately cannot be
there. That list is hand-maintained and fails closed: a new gated key shows up
as a batch failure until it is added.

Supporting tools, not gates:

| Tool | Command | Produces |
| --- | --- | --- |
| Cross-feature import matrix | `npm run matrix:imports` | `docs/architecture/cross-feature-import-matrix.md` (local-only) |
| Pre-move reference finder | `npm run premove -- <path>` | Every textual reference to a file, split into "the resolver covers this" and "update by hand" |

## Run this before every Phase 2 move

```bash
npm run premove -- scripts/AuraEffectsSD.mjs
```

The gates only follow **literal** import specifiers. A path built at runtime is
invisible to all five of them, and two such paths already existed in this repo:

- `dev/regen-creature-type-map.mjs:23` builds its output path with
  `path.join(__dirname, "..", "data", …)`. Move the file it generates without
  editing that line and the next regeneration silently recreates the old copy.
- `dev/tests/shadowdarkling-roller-regressions.mjs` reached
  `CompendiumIndexSD.mjs` through `new URL(…)`. It was converted to a literal
  specifier in Phase 0, which is the only reason Phase 1 step 11 could move that
  file safely — the resolver named both consumers and the move updated both.

`premove` does that search for you and flags constructed paths specifically.
Treat its "NOT covered" list as the manual checklist for the move commit;
documentation hits are informational, constructed paths are not.

**Actually work the list.** During Phase 1 step 11 the tool correctly reported a
stale reference in this very file, the report was read, and the reference was
left unfixed until review caught it. A checklist you generate and skim is worth
nothing. Note in particular that the tool's own usage examples are references
like any other: naming a real path in a doc comment means that comment goes
stale the moment the path moves, and a stale example gives a confidently wrong
answer rather than an obviously broken one.

It is best-effort by nature: a path assembled from fragments
(`path.join(dir, name + ".mjs")`) cannot be matched by any search. Reviewing the
move commit is still the backstop.

## What these gates do NOT prove

Read this before reporting a green run as evidence of anything.

- **The registration snapshot is a static call-site inventory, not runtime
  order.** Registrations made inside `init`/`ready` callbacks, conditionals, or
  nested functions appear in call-site order, which is not the order Foundry
  executes them. Runtime behaviour is the smoke matrix's job.
- **The API-export snapshot compares names only.** A changed parameter or return
  shape breaks every consumer while this stays green. Necessary, never
  sufficient.
- **The resolver cannot follow computed dynamic imports.** Template literals with
  substitutions are reported as manual smoke-test obligations. There are zero in
  the tree today.
- **There is no live registration count.** The plan offers one as an optional
  secondary signal. It is deliberately omitted: Foundry's `Hooks` registry is
  global and a callback carries no module attribution, so any number captured
  from a live session counts every other active module too. A figure that moves
  when an unrelated module updates is worse than no figure, because it invites
  regenerating the baseline to chase it. libWrapper and socketlib *are*
  attributable, but a partial live count is more misleading than none.
- **Sibling-module imports are not existence-checked.** `TMFXFilterEditor`
  reaches into TokenMagic with `../../tokenmagic/…` behind a try/catch, and
  whether those files exist depends on which optional modules the developer has
  installed. What *is* checked is the escape depth: moving that file one
  directory deeper retargets `../../tokenmagic` at this module's own folder,
  which reclassifies the import as internal and fails the existence rule.

## Regenerating a baseline

```bash
npm run snapshot:registrations -- --write
npm run snapshot:api -- --write
```

Regenerating is how a real reordering gets waved through, so it needs a reviewed
reason recorded in the commit message. Both snapshots are keyed by module
**basename**, not path, precisely so that Phase 2's feature-folder moves do not
require regeneration — a move that trips these gates has changed something other
than the path.

The `moduleApi` block in `api-exports.json` cannot be produced headlessly. It is
captured from a live world and preserved across `--write`; re-check it at each
phase end:

```js
Object.keys(game.modules.get("shadowdark-extras").api).sort()
```

## Running the test suite

```bash
npm run test:all
```

`node --test dev/tests/` — the bare-directory form — **fails on Node 26** with
`Cannot find module …/dev/tests`, because the directory argument is resolved as
a module path. It reports as a red run with zero tests, which reads like a
broken suite rather than a wrong command. Use the glob form (`npm test`), which
Node expands itself and so does not depend on the shell.

Two cases are not covered by test discovery and need explicit invocation. A green
`npm test` must never be read as covering them:

| Case | How to run |
| --- | --- |
| `dev/tests/shadowdarkling-roller-regressions.mjs` (no `.test.` in the name) | `npm run test:roller` |
| `dev/tests/quench/webp-migration.batch.mjs` | In a live Foundry world via Quench; record the result manually. |

## Release-check runtime

`npm run release:check` is a release gate, and a failed run is never waived on
the grounds that the environment is unusual. Two environment failures look like
real failures and must be told apart from them:

1. **LevelDB lock contention.** With Foundry running, the four packs report
   `IO error: lock … Resource temporarily unavailable` and the run exits 1.
   Close the world and re-run. Observed 2026-07-30 on Node v26.4.0:
   `release-check: 35 ok, 4 failed`, all four being pack locks.
2. **`classic-level` failing to load.** This was the documented Node 26 blocker.
   It does **not** reproduce on Node v26.4.0 — `import("classic-level")` resolves
   and `release-check` reads the packs — but older Node 26 builds hit it.

**Node 24 is the supported local runtime** (declared in `package.json`
`engines`). Where it is unavailable, the same check must pass in CI for every
push; CI is the authority. Neither failure above may be recorded as a pass.
