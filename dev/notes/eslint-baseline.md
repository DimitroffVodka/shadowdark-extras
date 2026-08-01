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

## 5.0.4 record (in the 5.0.4 style commit)

- **Allow-list config:** temporary, not committed; SHA-256
  `74aae676fbed0ff2e26bba9b06f7677a054803539dbde26a5948c865371f470a`.
  Generated from `.eslintrc.json` by setting every rule to `off` except
  `indent`, `quotes`, `comma-dangle`, `eol-last`, `one-var`,
  `space-before-function-paren` (the plan's 5.0.4 mechanical class).
- **Applied:** `eslint --ext .mjs scripts/ -c <allowlist> --fix` — 184 files,
  49,014/49,014 lines. NOTE: no committed command reproduces this commit
  (`lint:baseline:fix` disables `quotes`/`brace-style` by design); the
  allow-list SHA above + the change-class census below are the record.
- **Change-class census** (Claude Code AST/token analysis, 2026-08-01):
  quotes 5,118 flips + 386 static backtick→string = **5,504** (= recorded
  debt exactly); comma-dangle 2,274 added + 19 removed (`functions: never`)
  = **2,293** (= recorded debt exactly); 222 one-var splits; remainder
  whitespace (indent 40,291). Zero `${}`-substitution templates converted;
  zero string values changed; zero line-count deltas; comments intact.
- **Artifact fix:** 3 ESLint space-before-tab sites (operator-aligned
  continuations) hand-normalized to pure tabs — AuraEffectsSD.mjs:1164,
  TemplateEffectsSD.mjs:1055, :1217. Rule-verified fixed points.
- **Post-state:** remaining debt 2,236 errors (ALL `brace-style` → 5.0.5) +
  4,779 warnings; `max-len` 899→913 (+14, mechanical consequence of
  comma-dangle/quote reflow, deferred). `git diff --check` clean; node
  --check ×184; test:all 158 passing; verify.sh OK.
- **Review:** Codex + Claude Code both verified AST/comment equivalence
  across all 184 files and reproduced 182 byte-for-byte from the parent via
  the allow-list (the other 2 = documented artifact fix). Both APPROVE-WITH-NITS
  (nits: commit-message accuracy, addressed here); consent to merge.

## 5.0.5 record (in the 5.0.5 style commit)

- **Decision:** adopt Stroustrup braces (plan decision table line 937;
  matches base system). Config already targets `stroustrup` since 5.0.1
  (adopted wholesale) — this commit is the mechanical conversion.
- **Mechanism (two passes + sweep):** brace-only allow-list (SHA
  `bc6a801fcc9498ce83767255a7e6c63e2ba42ab262cbcf97a82c64558114755a`) →
  5.0.4 six-rule layout allow-list (SHA `74aae676…`) → trailing-ws sweep.
  WHY: the `brace-style` autofix is not self-contained — for single-line
  blocks (`try { x(); } catch {}`, `const f = () => { a; b; }`) it moves
  braces but leaves the body at column 0 with trailing whitespace; the
  layout pass finalizes them. This does not violate the plan's "no
  remaining suggestion is changed" — indent is a layout class, and the
  brace-only+layout replay is deterministic.
- **Scope:** 147 files, 4,023/1,787 lines. Census: the 2,236 pre-fix
  brace-style findings resolve to 1,618 moved `else`/`catch`/`finally`
  boundaries and 309 single-line blocks expanded to multi-line (each
  expanded block accounts for 2 findings) — exactly reproducible from the
  recorded pre-fix count. All 309 expanded blocks preserve statement
  tokens and order (138 of them multi-statement, up to five statements).
  No other change class present.
- **Proof:** replay probe reproduces all 147 files byte-for-byte from
  parent + (brace, layout, ws); AST/token/comment/non-whitespace-stream
  identity across all 147 files (independent, Codex + Claude Code);
  idempotent (each of the three passes re-run against HEAD changes 0
  files); diff --check clean; no hand edits anywhere in the commit.
- **Post-state:** lint errors ZERO (brace-style was the last error class);
  4,760 warnings (all suggestion/deferred classes). max-len 913→894
  (expansions reduce line lengths; mechanical, deferred).

## 5.0.6 record (in the 5.0.6 build commit)

- **Port:** ESLint 8.57.1 (exact) → 9.39.5 (exact, latest 9.x maintenance
  line); `.eslintrc.json` deleted; `eslint.config.mjs` flat config added;
  `lint` / `lint:strict` (`--max-warnings 0`) scripts added;
  `lint:baseline*` scripts removed. NOTE on `--ext`: the option still
  parses in 9.39.5, but flat-config scoping no longer honors the
  ESLint 8-style `--ext .mjs scripts/` restriction; the equivalent scope
  is expressed via `files` + `ignores` in the flat config.
- **Config generation:** flat config derived from the committed
  `.eslintrc.json` (5.0.1 commit) via a one-shot generator (not
  committed). All 128 rules preserved verbatim; env → globals (browser,
  node, jquery from the `globals` package; es2022 → ecmaVersion 2022).
- **Two deliberate deltas (each verified against the baseline):**
  1. `js.configs.recommended` NOT merged — the eslintrc had no `extends`
     (standalone rules list; absent rules OFF). Merging recommended
     injected 9,898 phantom errors (no-undef etc.) on a 0-error tree.
  2. `no-unused-vars` gets explicit `caughtErrors: "none"` — ESLint 9
     changed the default from "none" to "all", which alone added 192
     phantom catch-parameter findings. Restored explicitly.
  3. Scope: `files: ["scripts/**/*.mjs"]` + ignores (compiled, maphub,
     dev/**, greensock/**, libs/**, scripts/macros/*.js) — the linted
     file set (193) exactly matches ESLint 8's `--ext .mjs scripts/`.
- **Verification (plan's requirement — identical findings):**
  ESLint 9.39.5 vs ESLint 8.57.1 on the same tree: 0 errors / 4,760
  warnings both; identical 193-file set; finding-by-finding identical by
  (file, rule) — every finding's file and rule match, with exactly two
  no-implicit-coercion messages reworded by ESLint 9 itself and two
  no-dupe-class-members findings at shifted line/column anchors (same
  rule + message).
- **Tooling note:** ESLint 8.57.1 kept reproducible via the 5.0.1 commit
  (exact pin) + this note; the isolated /tmp/es8prefix copy was used for
  the side-by-side check.

## Why not a gate yet

`verify.sh` does not call lint until the error-level baseline is clean
(plan 5.0.7). Adding a blocking gate against thousands of known errors would
fail every commit with no signal.

## 5.0.6 port hazards (recorded 5.0.1, from review)

- `--ext` still parses in ESLint 9 but its scoping semantics changed: the
  ESLint 8-style `--ext .mjs scripts/` restriction is not honored the same
  way in flat config — replace with flat-config file-matching
  (`files: ["scripts/**/*.mjs"]` + `ignores`). Both old scripts needed
  replacement at the port.
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
