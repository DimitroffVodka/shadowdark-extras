# Live verification via Playwright

How to run the in-world checks against a live Foundry world when the
`foundry-vtt` MCP bridge is unavailable. Written for sweep 6, where the bridge
was not connected and the `DungeonPainterSD.mjs` split needed a runtime check.

The static gates (`npm test`, `verify.sh`, `prove-move.mjs`) cannot see whether
the browser actually loaded the module. This is the layer that can.

## When it is worth running

Only when the commit touches something the browser loads. Check first:

```bash
git diff --name-only <base>..HEAD | grep -c '^scripts/'
```

Zero means a live pass proves nothing — nothing under `dev/`, `verify.sh` or
`package.json` reaches the browser, so the world would come back green whether
or not the work is correct. Record that instead of banking a meaningless pass.

## What runs

Three Quench batches, registered on `quenchReady` in `scripts/shadowdark-extras.mjs`:

| Batch | Covers |
|---|---|
| `shadowdark-extras.structural` | module active, API surface, settings registered, a real sheet renders |
| `shadowdark-extras.split` | Phase 5.3 splits: extracted modules load, re-exports resolve to the SAME function objects, moved functions still work |
| `shadowdark-extras.webpMigration` | asset migration |

The `split` batch exists for the one failure static analysis is blind to: an
extracted module reached through two different specifiers loads **twice**, each
copy with its own duplicated constants. Every name-based gate stays green and
callers silently diverge. Only an identity check between the re-export and the
origin sees it.

## Prerequisites

- Foundry running and a world **already launched** (`http://localhost:30000`
  redirects to `/join` when one is active).
- The module symlink pointing at the working checkout, so the branch under test
  is what the world runs:
  ```
  ~/FoundryV14/Data/modules/shadowdark-extras -> ~/git/shadowdark-extras
  ```
- The **Quench** module installed and active in that world.
- Credentials for a GM-role user. `Gamemaster` and `Bridge` are usually already
  connected and show as disabled on the join screen; `RuntimeGM` is the account
  kept for automation.
- A viewport of at least **1366x768**. Foundry logs a hard error below that and
  some features misbehave — resize the browser before navigating, not after.

## Procedure

1. **Resize, then navigate.** `browser_resize` to at least 1366x768, then
   `browser_navigate` to `http://localhost:30000`.

2. **Join.** Select the GM user in the combobox, type the password, click
   *Join Game Session*. A wrong password leaves you on `/join` with
   `Invalid password provided for <user>!` in the console — it does not throw.

3. **Wait for the world.** Poll rather than sleeping a fixed time:
   ```js
   () => globalThis.game?.ready === true
   ```

4. **Confirm you are on the right world and branch.**
   ```js
   () => ({
     world: game.world.id,
     user: game.user.name,
     isGM: game.user.isGM,
     sdxActive: game.modules.get("shadowdark-extras")?.active,
     quench: !!globalThis.quench,
   })
   ```

5. **Baseline the console.** Read errors *before* running anything, so
   pre-existing noise is not attributed to the change under test.

6. **Render the Quench app, then run.** The order is not optional:
   ```js
   async () => {
     await quench.app.render(true);
     await quench.runBatches(["shadowdark-extras.split"]);
   }
   ```
   Quench's reporter writes into that app's DOM. Calling `runBatches()` while it
   is closed wedges the run — no tests execute, no `end` event fires, and every
   later run is refused with *"Mocha instance is currently running tests"* until
   the page reloads.

7. **Collect results.** Quench does *not* put the outcome in the `<li>`'s class —
   every test stays `class="test"` whether it passed or failed. The outcome is
   the status icon inside it, so read that:
   ```js
   () => {
     const els = [...document.querySelectorAll("li.test")];
     const tally = { pass: 0, fail: 0, pending: 0 };
     const failures = [];
     for (const el of els) {
       const cls = el.querySelector("i.status-icon")?.className ?? "";
       const title = el.querySelector(".summary")?.textContent?.trim();
       if (/fa-check/.test(cls)) tally.pass++;
       else if (/fa-times|fa-xmark|fa-exclamation/.test(cls)) {
         tally.fail++;
         failures.push({ title, error: el.querySelector(".error, pre")?.textContent?.trim() });
       }
       else tally.pending++;
     }
     return { total: els.length, ...tally, failures };
   }
   ```
   Reading `el.className` instead returns 0 passed and 0 failed for a fully
   green run, which looks like "nothing executed" rather than success.

8. **Diff the console against the baseline from step 5.** New errors are the
   finding; pre-existing ones are not.

## Reading the result

A pure move should produce **zero new console errors** and a fully green
`split` batch. The assertions most worth looking at:

- *"re-exports the SAME function objects"* failing means the module loaded
  twice — the specifier used somewhere does not match the one Foundry used.
- *"keeps the downstream importers loading"* failing means the re-export chain
  broke; the importer threw during `before()`.
- A green batch with **new console errors** still fails the pass. The batch
  proves the moved code works; the console proves nothing else broke on the way.

## Caveats

- Joining consumes a player seat and is visible to anyone else in the world.
- The batches are non-destructive by design — `split` creates nothing at all,
  `structural` deletes its scratch documents in `afterEach` — but they run
  against real world data. Do not point this at a world mid-session.
- `game.ready` is true before every module has finished its `ready` hook work.
  If a check depends on late initialization, wait for the specific condition
  rather than `game.ready`.
