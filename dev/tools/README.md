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

Supporting tool, not a gate:

| Tool | Command | Produces |
| --- | --- | --- |
| Cross-feature import matrix | `npm run matrix:imports` | `docs/architecture/cross-feature-import-matrix.md` (local-only) |

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
