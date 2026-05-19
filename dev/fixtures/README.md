# Test Fixtures

Reproducible Foundry-side test data used by `dev/probes/`. Run `setup.mjs`
to create them in your active world; run `teardown.mjs` to remove them.

## Fixtures created

| Name | Type | Purpose | Ownership |
|---|---|---|---|
| `_SDX TestPC` | Player | Caster for duration-spell tests, owned-actor for cross-client auth tests | default = OWNER (any player) |
| `_SDX TestNPC` | NPC | Not-owned actor for cross-client unauthorized tests | default = NONE |
| `_SDX TestSpell` (on TestPC) | Spell | trackDuration + rect template, exercises injectDamageCard pipeline | inherited from TestPC |

All fixtures live in folder `_SDX Test Fixtures` (purple, Actor type) so
they don't pollute the world's actor list.

## How to run

In Claude / Codex / Gemini with the foundry-vtt MCP server connected:

```
mcp__foundry-vtt__evaluate(expression: <paste setup.mjs body>)
```

`setup.mjs` is idempotent — re-running won't create duplicates. Returns
the actor/item IDs so subsequent probes can look up fixtures.

## Probes that depend on these fixtures

| Probe | Uses |
|---|---|
| `socket-auth-cross-client.mjs` | TestPC (owned), TestNPC (not owned) |
| `duration-spell-linkage.mjs`   | TestPC + TestSpell |

The other probes are fixture-free.

## Cleaning up

```
mcp__foundry-vtt__evaluate(expression: <paste teardown.mjs body>)
```

Removes the folder and every actor in it. Idempotent.
