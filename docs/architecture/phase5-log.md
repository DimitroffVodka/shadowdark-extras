# Phase 5.3 Execution Log

- Created: 2026-08-03 (activation)
- Status: **ACTIVATION IN PROGRESS** — production explicitly resumed by user ("Begin Sweep 4"); no production candidate, branch, worktree, or PR exists yet.

## Setup-only creation note

This log is created per plan §4.1.2 as setup-only state, not production progress.
It lives in the canonical analysis clone (`/home/patricks/git/shadowdark-extras`) rather than the protected owner checkout (`/home/patricks/FoundryV14/Data/modules/shadowdark-extras`), because the owner checkout must remain unmutated (plan §3.2, §4.1.4). It is currently untracked; a sweep candidate may carry it into the repository during the allowed "local Phase 5 architecture logs" supporting-path commits.

## Accepted baseline

- Planning baseline: `70cf4e77a236404c6c858ff2bef47ce525f9ba4d`
- Canonical HEAD == origin/main == live remote main == Repowise indexed_commit == `70cf4e77a236404c6c858ff2bef47ce525f9ba4d`
- Owner checkout (protected): HEAD `c771e680a975f50f78338347b664abed4a3dd656`, behind 23, dirty — untouched.

## Activation provenance

| Item | Value |
|---|---|
| Hermes Agent | v0.19.1 (CLI 2026.7.30) |
| Hermes source SHA | `4e698cd471164cb70ebf9f8e5d640f9b7eaf1f07` |
| Policy SHA-256 (pre-extension) | `189c5f65e5e8c4cf4970179f900a39a9dabccf7c210fadae184adb97c0f0a7c1` (self-test 21/21) |
| Policy SHA-256 (post-extension, active) | `47c509f3b06118af3415c079a0974c46c681b14b725d115337e84b2dcf165a99` (self-test 30/30; commit `e894f6232e3c83a64c328210943b4b8a20706f65`; AGY APPROVE; independent review APPROVE-WITH-NITS) |
| orchestrator_profile | `phase53-coordinator-deepseek` |
| auto_decompose | false |
| default_assignee | (empty) |
| failure_limit | 2 |
| max_in_progress_per_profile | 1 |
| AGY | 1.1.10; route `gemini-3.6-flash` high |
| Node / npm | v26.4.0 / 12.0.1 |

## Sweep 4 → Sweep 5 reflection checkpoint (added 2026-08-03)

Decision: do not perform skill patches or process cleanup mid-session while a
sweep is running. Between Sweep 4 closure and any Sweep 5 authorization, run a
post-session self-reflection that MUST include:

1. Sweep 4 pilot telemetry review (coordinator/worker elapsed time, token
   usage, compaction count, failed dispatches/retries, policy validation
   failures, stale-SHA/path-scope catches, board reconciliation work, human
   interventions) — required by the plan before Sweep 5 regardless.
2. Process lessons from this activation: CLI flag-order (`--board` before the
   subcommand), the script-file scanner block for gateway-adjacent commands,
   the `curl | python3` approval trigger, AGY background invocation pattern.
3. Deferred skill hygiene: update `kanban-orchestrator` (and any other
   curator-flagged skills) for current Hermes facts (gateway dispatcher,
   `--idempotency-key`/`--max-runtime`/`--parent` on create) — in-session
   patch, user-approved, never autonomous.
4. Record the reflection in this log and present it to the user; Sweep 5
   begins only after explicit authorization.

Process lesson (2026-08-03, first rejection): the dispatcher dependency engine
demotes a `ready` card whose parent is blocked. A correction card created with
its parent edge pointing at the rejected gate therefore stalls in `todo`
despite `promote --force`. Fix: create correction cards with NO parent edge
(provenance lives in the card body and the blocked gate's comment/handoff);
if one already carries the edge, `hermes kanban unlink <blocked-gate> <correction>`
then let the engine promote it. The blocked gate stays blocked as evidence.

Gate-criterion lesson (2026-08-03, Sol-ruled): `verify.sh --strict` acceptance
is a DELTA criterion — the candidate must introduce ZERO NEW strict findings
vs the frozen baseline SHA — never absolute exit 0. The baseline itself exits
1 on pre-existing Sweep-5-owned findings (carousing img.src) plus raw eval(.
Gate application was inconsistent across workers (c0 skipped verify.sh; c1
absolute-exit on in-scope findings — right outcome, wrong reasoning; c2
absolute-exit on out-of-scope pre-existing findings — wrong, self-blocked the
correction). Fix: every tests/acceptance card body MUST state the delta rule
verbatim (as posted on t_27434dd3), and the corrected candidate can be
re-accepted on the SAME SHA. Recovery pattern for criterion-error blocks:
Sol adjudication (card t_06387da3, ACCEPT, attachment 36
SHA-256 5aa5150923f72ac42f6c92765c777466b5a97cca625861fa07e79103d020d00f) →
annotate the blocked card with the verdict (handoff stays as evidence) →
unblock → re-run acceptance with the corrected criterion. Sol merge consent
for c2 is conditional on all c2 gates plus lint/ownership/line-size evidence.

## Sweep ledger

WORKER-CARD CDP CONVENTION (2026-08-03, lane-C runtime block): headless
worker terminal commands hit the manual approval gate with no interactive user
→ consent timeout → permanent CDP lockout. Runtime/verification card bodies
MUST mandate the python3-subprocess path for ALL terminal access (never bare
curl/node — approval-gated). Apply to every runtime card created from now on.

STANDING WRITER DIRECTIVE (2026-08-03, user): "Keep using opus to fix
our problems for coding" — Opus (claude CLI harness) is the writer lane for
coding fixes from here on. Bounded jobs, disjoint worktrees per job, write-only
rules, coordinator commits. Evidence basis: wave 8/9 incl. parser 90s first-try;
ck2 6/6 clean; s5 carousing fix $0.62/15 turns (best writer work of the day).

WRITER ROUTING DECISION (2026-08-03, user): writers run via the CLAUDE
CLI (`claude -p`, model claude-opus-5, acceptEdits, trust pre-accepted) — NOT
Hermes profiles. Harness: hermes-subagents/.hermes/phase53/opus-writer/
(invocation, prompt template, write-only protocol, cost accounting). Evidence:
arena claude-cli-wave 8/9 incl. parser class first-try 90s; first ck runs
invalidated by workspace-trust failure (edits silently dropped, ~$2.70) —
trust must be set for every target workspace before any Opus run. Writer cards
route as coordinator-assigned CLI harness runs; write-only rule applies (gates
verify; writers never claim gate results).

COORDINATOR CLAIM-HYGIENE RULE (2026-08-03, after user caught a false claim):
the coordinator must POLL the board before asserting any gate outcome.
Violation: "c4 is at Sol's final adjudication — first merge of the day"
was stated AFTER Sol had already ruled REWORK (17:09, run 111) — an
unverified expectation dressed as status. Same failure class as the
fleet's fabricated claims; worse from the last line of defense. Future:
every status statement about a card is preceded by `hermes kanban show`
of that card. c5 chain (Sol attachment 83 remedy): t_c822bc40 correction
(run 121, running) -> t_e98d5810 tests -> t_9dfa1c9b agy -> t_a407b7bd
bp -> t_4244a474 luna -> t_c17ce78d live-runtime (REAL :30000) ->
t_cfba9f8f sol -> t_87564ae5 merge (Fixes #80). SEQUENTIAL parent edges,
no parallelization (the c4 sibling rewire was the violation).

REAL-SERVER RUNTIME PIVOT (2026-08-03, user): the live :30000 server / world
0100 is the user's TEST world (disposable, messy, "closer to a real game") —
not production. Runtime gates now run on the real server; disposables
(:30010/30011/30012) remain for lane-parallel coverage. INCIDENT (16:43-17:00):
wrong-boot orphan held :30000 with an empty dataPath (kills hit the python3
wrapper, not the node child) — user saw setup screen, "world gone", auth
popups; options.json world was reset to null. Recovery: killed orphan,
stashed the renamed checkout OUTSIDE Data/modules (Foundry flags invalid
module dirs), pinned options.json world=0100, relaunched with
--dataPath=/home/patricks/FoundryV14 → active:true, zero errors. RuntimeGM
(57daddd1f49698ae / runtimegate2026) injected into world 0100. Module dir
currently symlinked to the c4 candidate worktree (62b4d8a7); checkout
stashed at /home/patricks/FoundryV14/module-stash/ — RESTORE = mv back +
rm symlink after the sweep (served-dir convention). Lesson: kill the node
CHILD (process group), never just the wrapper; verify by port, not by pid.

STANDING DELEGATION (2026-08-03, user): user go/no-go is delegated to Sol
rulings for the remainder of the campaign — the coordinator executes
Sol-ruled recovery paths without per-step sign-off. User blocks in the
policy are informational when Sol has ruled and routing is already
established. Violations: the c3 and c4 go/no-go asks should have been
executed directly (user: "I should not be answering that; this is all
supposed to be automated").

GITHUB ISSUE TRACKING (2026-08-03, restored convention): every sweep-4
work item maps to a GitHub issue linked to epic #79; cards carry the issue
number in a comment; merge branches must reference "Fixes #N" so merges
auto-close. Issues: #79 epic (sweep 4), #80 c4 TMFX signed-number fix,
#81 lane-B combat splits, #82 lane-C effects splits. Gap: per-item issues
were dropped after the first rejection cycle (coordinator drift, no
decision) — restored with the lane cards.
c4 chain (Sol attachment 55 on t_fb665a4d, REWORK, CONFIRMED Major):
t_28166575 correction (writer-deepseek, NO parent edge) -> t_bf60c89f
tests (legal_next agy-review, no skip) -> t_7b2de59f agy-review (restored
per Sol; evidence protocol: re-executed commands only, fabricated findings
invalidate the review) -> t_be4d27b3 review-1 Big Pickle -> t_475e097f
review-2 Luna -> t_b740eea2 live-runtime (DISPOSABLE :30010, live untouched)
-> t_1ec43d71 sol -> t_718e62b2 cimerge -> t_7b488542 closure.

Disposable Foundry incident + build (2026-08-03): first disposable launch
symlinked the shadowdark system; the live server holds the system packs'
LevelDBs open, so the disposable hit "Database failed to open" and Foundry's
repair churned all 21 live system pack dirs (lost/, LOG.old) at 14:46.
Detected via mtime check; stopped the disposable immediately; restored live
packs byte-identical from 04-backups/phase53-pack-integrity-2026-08-02
(rsync --delete, user-approved; 1,393,447 bytes == backup); live console
verified clean (only pre-existing cartomancer Quench error). Root cause was
lock contention, not corruption: the rebuilt disposable with the system as a
COPY opens all packs with zero repairs. Build complete: :30010, Foundry
14.365, Shadowdark 4.0.6, world sdx-verify, GM DisposableGM
(76c8bb097bcfece5), modules socketlib+tokenmagic 0.8.4+shadowdark-extras
active (settings-DB core.moduleConfiguration, single record — duplicates
silently kill activation), CDP login driving proven, module symlink
candidate-pinnable. Skill reference updated with both lessons.

## Sweep ledger

| Sweep | Pipeline ID | Base SHA | Candidate SHA | AGY | Review | Runtime | Sol | CI | Merge | Status |

Writer/review routing change (2026-08-03, user decision): c3 correction lane
switched from Luna to phase53-writer-deepseek (deepseek-v4-flash high). Review
lane for c3: review-1 = Big Pickle (opencode/big-pickle via coordinator
harness), review-2 = Luna (phase53-review-luna, gpt-5.6-luna high). AGY
(gemini-3.6-flash high) dropped from the chain after measured 0/3 in the
crosscheck (2 timeouts, 1 fabricated-evidence REJECT). Note: Luna was already
running at reasoning_effort high for c0-c2 (profile config mtime 2026-08-02
18:05; transport maps high -> reasoning.effort high); the c0-c2 defects are
high-effort defects, not low-effort artifacts.
Crosscheck results (all sessions, identical prompts): DeepSeek 3/3 verified
rejections; AGY 0/3 usable (c0/c2 timeout, c1 fabricated evidence, 0/2 real
finding recall); Big Pickle 3/3 verified rejections with full recall — c0
2/2 + bonus (caught c1 defects at c0), c1 2/2 + ESLint 170-warning gap,
c2 hex + trailing commas + Infinity + silent-catch + corpus-coverage analysis
(matched Sol's REWORK requirements independently). Big Pickle outputs:
/hermes-subagents/.hermes/phase53/agy-crosscheck/big-pickle/bp-c{0,1,2}.json.
c3 graph: t_24b62de7 correction (writer-deepseek, NO parent edge) ->
t_6da877a3 tests -> t_dd567a79 review-1 Big Pickle -> t_def86afd review-2
Luna -> t_c67fbf19 runtime (user swap authorization required) ->
t_6546351f sol -> t_7fbaa485 cimerge -> t_704dc1ad closure.
|---|---|---|---|---|---|---|---|---|---|---|
| 4 | s4-effects-combat-animation | 70cf4e77… | — | — | — | — | — | — | — | running (baseline t_bdce9f41) |
| 5 | s5-party-npc-journal-tray-canvas | — | — | — | — | — | — | — | — | not started |
| 6 | s6-hex-dungeon | — | — | — | — | — | — | — | — | not started |
| 7 | s7-tom-scene-maphub | — | — | — | — | — | — | — | — | not started |
| closeout | p53-strict-closeout | — | — | — | — | — | — | — | — | not started |
