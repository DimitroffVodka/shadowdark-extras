# MCP Probes

Self-contained JS snippets that verify v14 behaviors and module invariants
via the Foundry MCP `evaluate` tool (or paste into the Foundry F12 console
with an `await` wrapper).

Each probe returns `{ pass: boolean, ... }`. Use them as smoke tests after
behavior changes, or as fast falsification when a bug is suspected.

## When to run

| Probe | When | Needs |
|---|---|---|
| `socket-auth-resolves.mjs` | After any socketlib handler change | GM bridge |
| `socket-auth-cross-client.mjs` | After auth-gate logic change | GM + Player bridge |
| `formula-math-eval.mjs` | After CombatSettingsSD formula changes | GM bridge |
| `formula-requirement-eval.mjs` | After source-requirement logic changes | GM bridge |
| `chat-light-source-injection.mjs` | After render-hook or chat-card changes | GM bridge |
| `template-region-pair.mjs` | After template/region code changes | GM bridge, active scene |
| `duration-spell-linkage.mjs` | After injectDamageCard / template-id wiring changes | GM bridge, configured spell |

## How to run

In Claude / Codex / Gemini with the foundry-vtt MCP server connected:

```
mcp__foundry-vtt__evaluate(expression: <paste file contents here>)
```

For cross-client probes set `targetUser` to the player's exact name on the
second invocation.

## Adding a probe

1. Pick a behavior you'd want to falsify before claiming "verified."
2. Write a self-contained snippet that returns `{ pass: boolean, ... }`.
3. Clean up any documents/globals you create at the end.
4. Add a row to the table above with the trigger condition.

If a probe catches a real regression, also add the regex to `verify.sh`'s
grep wall so the bad pattern can't sneak back in via static review.
