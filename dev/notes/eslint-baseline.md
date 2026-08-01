# ESLint baseline record (Phase 5.0.1)

The permanent lint gate is a migration, not a sweep. This file records the exact
tool state of the mechanical baseline so the result is reproducible and
revertible. It is written once when the baseline lands; later lint runs use the
ESLint 9 flat config (5.0.6).

## Tool state

- **ESLint version:** 8.57.1 (exact, `devDependencies`, reproducible via `npm ci`)
- **Config path:** `.eslintrc.json` (repo root, `"root": true` so no parent
  directory config can merge in and silently change the baseline)
- **Config SHA-256:** `30aa9784ccf01a1a842dbfea07651b0a4dc2e5a91fd1fd0388950b30b6846a37`
- **Config source:** Shadowdark system's published `.eslintrc.json`
  (`Muttley/foundryvtt-shadowdark`, develop branch), adopted wholesale, minus:
  - the invalid `disallowTabs` key (not a real ESLint rule),
  - `foundry/**/*` ignore (system-specific), replaced with `scripts/maphub/**`
    (the vendored generator tree, excluded from lint by the plan).
- **Lint scope:** `eslint --ext .mjs scripts/` — first-party `.mjs` only.
  `scripts/maphub/OnePageParserSD.mjs` exists, so `ignorePatterns` is the
  load-bearing exclusion; the `.mjs` extension filter alone would not exclude
  it. `dev/**/*.mjs` (56 files, including the gate tooling `verify.sh` runs) is
  deliberately out of scope; "baseline clean" means `scripts/` only.

## Baseline debt (measured 2026-08-01, ESLint 8.57.1, LF worktree at `ffc6692`)

Reproducible with `npm ci && npm run lint:baseline`:

| Metric | Count |
| --- | ---: |
| files linted | 193 |
| **errors** | **42,632** |
| **warnings** | **13,024** |
| **total problems** | **55,656** |
| fixable (errors / warnings) | 42,632 / 11,139 |

Top rules: `indent` 40,291 ERR · `brace-style` 2,236 ERR · `no-trailing-spaces`
105 ERR · `quotes` 5,504 WARN · `comma-dangle` 2,293 WARN · `max-len` 899 WARN ·
`no-unused-vars` 116 WARN · `no-mixed-operators` 772 WARN · `arrow-parens`
701 WARN.

The `phase5-plan-v2.md` baseline table (40,532 indent, 5,507 quotes, 111,484
linebreak-style, 194 unused-vars) predates this worktree and counts the CRLF
smudge as `linebreak-style` — on LF-clean blobs (`.gitattributes` already on
main, `3f34ab3`) that rule reports **0**. The plan table is a historical
measurement; this file is the reproducible one. Do not mix the two figures.

`lint:baseline:fix` runs `--fix --fix-type layout` with `quotes` and
`brace-style` explicitly disabled (`--rule` override). It applies the pure
formatting class (indent, spacing, EOL, commas) but leaves the two staged
classes untouched: `quotes` (5,504) belongs to the 5.0.4 mechanical pass and
`brace-style` (2,236) to 5.0.5. It deliberately does NOT run a full `--fix`,
which would fold in content-level rewrites (`quotes` 5,504, `prefer-template`
73, `no-useless-escape` 15, `dot-notation`, coercions) into one unreviewable
commit. Note: `--fix-type layout` alone is NOT sufficient scoping — ESLint
classifies `quotes` and `brace-style` as layout fixes too (verified empirically
2026-08-01), so the `--rule` override is load-bearing, not belt-and-braces.

## Reproduction

```bash
npm ci                                  # exact eslint 8.57.1 from lockfile
npm run lint:baseline                   # measure debt (not a gate yet)
npm run lint:baseline:fix               # formatting class only; quotes/brace-style staged
```

Rollback for the 5.0.1 toolchain commit: `git revert <the 5.0.1 commit SHA>` —
the file cannot name its own final SHA (it changes on every amend/squash), so
revert by the merge commit or by `git log --oneline --grep="5.0.1"`. Rollback
for the 5.0.4 style commit (when it lands): `git revert <5.0.4 SHA>`; the
recorded version + hash make an exact rerun possible.

## Why not a gate yet

`verify.sh` does not call lint until the error-level baseline is clean
(plan 5.0.7). Adding a blocking gate against thousands of known errors would
fail every commit with no signal.

## 5.0.6 port hazards (recorded 5.0.1, from review)

- `--ext` is removed in ESLint 9 — both scripts break at the port; replace with
  the flat-config file-matching (`files: ["**/*.mjs"]`).
- `env` → `languageOptions.globals` (adds a `globals` dependency); `ignorePatterns`
  → `ignores` in flat config.
- 42 of the 128 rules are deprecated core formatting rules (40 formatting; per
  ESLint v9.39.2 rule metadata they remain available through v11, and the
  recommended replacement is `@stylistic/eslint-plugin`) — keeping this exact
  baseline likely means adding that plugin at the port.
- `parserOptions.requireConfigFile: false` is a `@babel/eslint-parser` option,
  inert here (no `parser` set); inherited from upstream, drop it at 5.0.6.
- **`no-unused-vars` `caughtErrors` default changes in v9** (Codex review,
  2026-08-01): ESLint 8 defaults to `caughtErrors: "none"` implicitly; ESLint
  9.39.2 defaults differently and would raise `no-unused-vars` from 116 to 308
  on otherwise-identical rules, violating 5.0.6's identical-findings
  requirement. The flat config must set `caughtErrors: "none"` explicitly.
