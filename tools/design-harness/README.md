# Design harness

Fixtures and proposed templates/CSS for previewing this module's windows with no Foundry world
running. Nothing here ships: `tools/` is not in `module.zip` and nothing in `scripts/` loads it.

**The runner is not in this repo.** It is the Shadowdark Enhancer's harness; this folder only holds
the data it reads. From a sibling checkout of `shadowdark-enhancer`, launch it from this module's
root so it picks up this repo's `module.json` and `tools/design-harness/fixtures/`:

    cd <this repo> && node <shadowdark-enhancer>/tools/design-harness/serve.mjs     # http://127.0.0.1:4177/
    cd <this repo> && node <shadowdark-enhancer>/tools/design-harness/shot.mjs party-proposed out.png --w=750

`MODULE_DIR` names the module to render when you are not in its root, `PORT` moves the server, and
`FOUNDRY_APP` and `SYSTEM_DIR` default to `~/FoundryV14/app` and the system in `module.json`.
`shot.mjs` writes a PNG and prints the layout check; it needs `chromium` or `google-chrome` on PATH
(or `CHROME=/path`). The runner's own README documents the rest.

## What is here

- `fixtures/<window>.mjs` is the current window: its template and a sample context. `medkit`,
  `camping-rest`, `carousing`, `party`, `sdx-roller`, `sdx-tray`.
- `fixtures/<window>-proposed.mjs` is the redesign, built by `fixtures/_proposed.mjs`: the current
  fixture's context plus a template from `proposed/templates/` and a stylesheet from `proposed/css/`,
  injected unlayered so it beats the module's own `@layer` rules.
- A proposal keeps the real templates' `data-action`, `name` and `data-tab` hooks, so adopting one is
  a template and CSS swap.

## What it cannot show

It is not Foundry: no module JS runs, helpers are stubs, and only the actions a fixture lists
respond. Specifically here:

- The `party` fixture renders the Members tab only; the other tabs' contexts are stubs.
- `sdx-tray`'s `hexes-custom` state lists `assets/Hexes/Autumn` as a stand-in, because the live
  Custom tab reads a runtime `data/hexes` scan.
- `carousing` is a viewport-fixed overlay drawn in a 1200px window, so its `sticks out sideways`
  lines are framing, identical in base and proposed.
