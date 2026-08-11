/**
 * Adversarial multi-model code review: blind -> rebut -> judge.
 *
 * The failure mode this exists to avoid is agreement. If you show model B what
 * model A found and ask "thoughts?", B anchors on A's framing and the pair
 * converge on consensus that looks like verification but never tested anything.
 * So the rounds are deliberately staged:
 *
 *   1. BLIND  — each reviewer sees only the diff. No peer output. Findings are
 *               independent by construction, not by instruction.
 *   2. REBUT  — each reviewer sees ONLY the others' findings and attacks them,
 *               answering refuted / corroborated / unverified. Asking for
 *               refutation rather than "review" is what keeps the round
 *               adversarial; a neutral prompt here reliably produces nodding.
 *               The third state matters: "I could not check this" is not
 *               counter-evidence, and collapsing it into "refuted" silently
 *               buries real defects.
 *   3. JUDGE   — one or more models adjudicate claim + rebuttal on cited
 *               evidence. With `--judge a,b` they run independently and any
 *               disagreement resolves to `uncertain`, never a majority.
 *
 * Identity isolation has three parts, because the first two alone leak:
 *   - findings travel as "Reviewer A/B/C", never as model names;
 *   - labels are assigned randomly per run, so a fixed map cannot be assumed;
 *   - NOTHING is written to disk until the last judge has answered. Reviewers
 *     hold read-only access to the repository under review, so a model-named
 *     `blind-codex.txt` sitting in `.debate-review/` mid-run would let a judge
 *     that is also a contestant rebuild the map by matching text to findings.
 *
 * A run that loses a reviewer skips cross-examination and adjudication
 * entirely, titles its report `# DEGRADED SINGLE-REVIEWER RUN`, and exits 2
 * unless `--allow-degraded`. The sole survivor must never judge its own work,
 * and the durable artifact must never read like a debate that did not happen.
 *
 * Reviewers run read-only. Codex gets `-s read-only`, Claude gets
 * `--permission-mode plan` plus an explicit tool denylist, so both can read the
 * repo for context but neither can touch it.
 *
 * Every subprocess has a hard timeout and a stall is reported as a failure with
 * its partial output. A reviewer that dies is excluded loudly and named in the
 * report — the one thing this must never do is quietly review with one model
 * and present it as a debate.
 *
 * Usage:
 *   node dev/tools/debate-review.mjs --base HEAD~1
 *   node dev/tools/debate-review.mjs --base main --judge codex
 *   node dev/tools/debate-review.mjs --base main --judge codex,claude
 *   node dev/tools/debate-review.mjs --reviewers codex,claude --allow-degraded
 *   node dev/tools/debate-review.mjs --diff-file /tmp/change.diff --dry-run
 *   node dev/tools/debate-review.mjs --rejudge .debate-review/<stamp> --judge codex
 */

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_DIFF_CHARS = 200_000;
const DEFAULTS = {
  base: "HEAD~1",
  head: "HEAD",
  out: ".debate-review",
  reviewers: "codex,claude",
  judge: "claude",
  timeout: 900,
  codexModel: "gpt-5.6-luna",
  claudeModel: "opus",
  effort: "high",
};

/* -------------------------------------------------------------- args ---- */

function parseArgs(argv) {
  const opts = { ...DEFAULTS, dryRun: false, diffFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--base") opts.base = next();
    else if (a === "--head") opts.head = next();
    else if (a === "--diff-file") opts.diffFile = next();
    else if (a === "--rejudge") opts.rejudge = next();
    else if (a === "--allow-dirty") opts.allowDirty = true;
    else if (a === "--out") opts.out = next();
    else if (a === "--judge") opts.judge = next();
    else if (a === "--reviewers") opts.reviewers = next();
    else if (a === "--allow-degraded") opts.allowDegraded = true;
    else if (a === "--timeout") opts.timeout = Number(next());
    else if (a === "--codex-model") opts.codexModel = next();
    else if (a === "--claude-model") opts.claudeModel = next();
    else if (a === "--effort") opts.effort = next();
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  const list = (s) => String(s).split(",").map((x) => x.trim()).filter(Boolean);
  opts.reviewers = list(opts.reviewers);
  // `--judge a,b` runs both independently; disagreement resolves to uncertain.
  opts.judges = list(opts.judge);
  if (!opts.reviewers.length) throw new Error("--reviewers cannot be empty");
  if (!opts.judges.length) throw new Error("--judge cannot be empty");
  return opts;
}

/* ------------------------------------------------------------ process ---- */

/** Run a command with stdin, capturing output. Never rejects; reports failure in the result. */
function run(cmd, args, { input = "", timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: `${stderr}\n${err.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut });
    });

    child.stdin.end(input);
  });
}

/* ---------------------------------------------------------- reviewers ---- */

/**
 * Codex reads its prompt from stdin when PROMPT is `-`, which sidesteps
 * argv length limits on large diffs.
 *
 * `model_reasoning_effort` is passed without --strict-config, so if Codex ever
 * renames that key the override is ignored silently rather than erroring. If
 * effort seems not to apply, re-run once with --strict-config to find out.
 */
async function askCodex(prompt, opts) {
  const args = [
    "exec",
    "-s", "read-only",
    "-C", process.cwd(),
    "-m", opts.codexModel,
    "-c", `model_reasoning_effort="${opts.effort}"`,
    "-",
  ];
  const r = await run("codex", args, { input: prompt, timeoutMs: opts.timeout * 1000 });
  return { ...r, text: r.stdout };
}

/**
 * `--output-format json` wraps the reply in an envelope whose `result` holds the
 * text, which is far more parseable than scraping the pretty-printed transcript.
 * We deliberately do NOT pass --bare: it forces API-key auth and would break a
 * subscription/OAuth login.
 */
async function askClaude(prompt, opts) {
  const args = [
    "-p",
    "--output-format", "json",
    "--model", opts.claudeModel,
    "--effort", opts.effort,
    "--permission-mode", "plan",
    "--disallowed-tools", "Write", "Edit", "NotebookEdit",
    "--append-system-prompt",
    "You are acting as an independent code reviewer. Analyse and report only; never modify files.",
  ];
  const r = await run("claude", args, { input: prompt, timeoutMs: opts.timeout * 1000 });
  let text = r.stdout;
  try {
    const env = JSON.parse(r.stdout);
    if (typeof env.result === "string") text = env.result;
  } catch {
    /* fall back to raw stdout; extractJson below still gets a shot */
  }
  return { ...r, text };
}

const REVIEWERS = { codex: askCodex, claude: askClaude };

/* --------------------------------------------------------- extraction ---- */

/**
 * Pull a JSON array out of model prose. Prefers the last fenced ```json block
 * (models often show a draft before the final answer), then falls back to
 * bracket matching so a missing fence is not fatal.
 */
function extractJson(text) {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  for (const m of fences.reverse()) {
    try {
      return JSON.parse(m[1].trim());
    } catch { /* try the next fence */ }
  }
  const start = text.indexOf("[");
  if (start !== -1) {
    for (let end = text.lastIndexOf("]"); end > start; end = text.lastIndexOf("]", end - 1)) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch { /* shrink and retry */ }
    }
  }
  return null;
}

/* ------------------------------------------------------------ prompts ---- */

const FINDING_SCHEMA = `[
  {
    "file": "path/to/file.mjs",
    "line": 123,
    "severity": "high" | "medium" | "low",
    "category": "correctness" | "security" | "performance" | "maintainability" | "test-coverage",
    "claim": "One sentence stating the defect.",
    "evidence": "Concrete inputs or state -> wrong output/crash. Quote the offending code."
  }
]`;

function blindPrompt(diff) {
  return `You are reviewing a code change. You have read-only access to the repository, so you may read surrounding files to check your reasoning.

Report only defects you can substantiate: correctness bugs, security issues, real performance problems, missing test coverage for risky paths. Do not report style preferences. If you find nothing substantiable, return an empty array — a short honest list beats a padded one.

Output ONLY a fenced \`\`\`json block matching this schema, with no prose after it:
${FINDING_SCHEMA}

--- DIFF UNDER REVIEW ---
${diff}`;
}

function rebutPrompt(diff, peerFindings) {
  return `You are cross-examining another reviewer's findings on the code change below. You have read-only repository access; verify claims against the actual code.

Your job is to attack each finding: show the code path is unreachable, the input cannot occur, a guard exists elsewhere, the reviewer misread the diff, or the claim is too vague to act on.

Report one of three verdicts per finding, and keep them distinct — "I could not verify this" is NOT "I disproved this":

  "refuted"      you have concrete counter-evidence. Cite it.
  "corroborated" you positively confirmed the defect against the source. Cite it.
  "unverified"   you lack the evidence to decide either way. Say what you could not check.

Never report "refuted" merely because you are unsure; that is "unverified". A "corroborated" finding should mean "I tried to break this and could not", never "I did not check".

Output ONLY a fenced \`\`\`json block, no prose after it:
[
  {
    "id": "A1",
    "verdict": "refuted" | "corroborated" | "unverified",
    "confidence": "high" | "medium" | "low",
    "reasoning": "The evidence, cited as file:line. For 'unverified', what blocked you."
  }
]

--- FINDINGS TO REFUTE ---
${JSON.stringify(peerFindings, null, 2)}

--- DIFF UNDER REVIEW ---
${diff}`;
}

function judgePrompt(diff, findings, rebuttals) {
  return `You are adjudicating a code review dispute. Two reviewers worked independently; each then attempted to refute the other's findings. Decide each finding on the evidence alone.

Rules: a finding survives only if it names a concrete failure — inputs or state leading to a wrong result. Reject anything speculative, stylistic, or already handled by a guard the rebuttal identified. Verbosity is not evidence; a terse correct claim beats a long vague one. Where claim and rebuttal conflict, prefer whichever cites checkable code.

A rebuttal of "unverified" carries no evidential weight in either direction — it means the cross-examiner could not check. Do NOT read it as support for rejecting the finding. Judge such findings on the original evidence alone, and answer "uncertain" when that evidence is insufficient.

Output ONLY a fenced \`\`\`json block, no prose after it:
[
  {
    "id": "A1",
    "verdict": "confirmed" | "rejected" | "uncertain",
    "severity": "high" | "medium" | "low",
    "rationale": "One or two sentences resolving the dispute."
  }
]

--- FINDINGS ---
${JSON.stringify(findings, null, 2)}

--- REBUTTALS ---
${JSON.stringify(rebuttals, null, 2)}

--- DIFF UNDER REVIEW ---
${diff}`;
}

/* --------------------------------------------------------------- main ---- */

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/**
 * The diff is taken between two COMMITS, never against the working tree.
 *
 * Reviewers get a static diff but read the live repository for context, so any
 * edit landing mid-run makes them argue about text that no longer exists. That
 * is not hypothetical: the first real run had both reviewers correctly flag a
 * bug in the hunk they were handed, then had the rebuttal round throw both out
 * as "stale" because the file had been rewritten underneath them seconds after
 * the snapshot was taken. Reviewing a moving target wastes a whole round and
 * looks exactly like a model error.
 *
 * `base...head` scopes to what this branch added, ignoring commits that landed
 * on the base meanwhile.
 */
function getDiff(opts) {
  if (opts.diffFile) return readFileSync(opts.diffFile, "utf8");
  return git(["diff", `${opts.base}...${opts.head}`]);
}

/**
 * Refuse to review paths whose working-tree copy differs from the commit under
 * review — those are precisely the files where the reviewers' live reads and
 * their diff will disagree.
 */
function assertClean(diff, opts) {
  const paths = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
  if (!paths.length) return;
  const dirty = git(["status", "--porcelain", "--", ...paths])
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("??"))
    .map((l) => l.slice(3));
  if (!dirty.length) return;
  const msg =
    `${dirty.length} file(s) in this diff differ from the working tree:\n` +
    dirty.map((d) => `  ${d}`).join("\n") +
    `\nReviewers read live files, so they would review one version and cite another.` +
    `\nCommit or stash them, or pass --allow-dirty to accept the skew.`;
  if (!opts.allowDirty) {
    console.error(msg);
    process.exit(1);
  }
  console.error(`WARNING: ${msg}`);
}

/** Re-run only the adjudication round over a stored transcript. */
async function rejudge(opts) {
  const dir = opts.rejudge;
  const t = JSON.parse(readFileSync(join(dir, "transcript.json"), "utf8"));
  const diff = readFileSync(join(dir, "diff.txt"), "utf8");
  const findings = Object.keys(t.findings).flatMap((n) => stripAuthorship(t.findings[n]));
  const rebuttals = Object.values(t.rebuttals).flatMap((l) => l ?? []);

  console.error(`Re-adjudicating ${findings.length} finding(s) with ${opts.judges.join(", ")}...`);
  const perJudge = {};
  for (const j of opts.judges) {
    const r = await REVIEWERS[j](judgePrompt(diff, findings, rebuttals), opts);
    writeFileSync(join(dir, `judge-${j}.txt`), r.text || r.stderr);
    const parsed = (r.ok && extractJson(r.text)) || null;
    if (!parsed) {
      console.error(`${j} produced no parseable verdict${r.timedOut ? " (TIMED OUT)" : ""}.`);
      continue;
    }
    perJudge[j] = parsed;
  }
  if (!Object.keys(perJudge).length) process.exit(1);

  // The original run's report is left intact so judges can be compared.
  const tag = opts.judges.join("-");
  const swapped = { ...t, judges: opts.judges, verdicts: aggregateVerdicts(findings, opts.judges, perJudge) };
  writeFileSync(join(dir, `report-judge-${tag}.md`), renderReport(swapped));
  console.log(renderReport(swapped));
  console.error(`\nWrote ${dir}/report-judge-${tag}.md`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("See the header comment in dev/tools/debate-review.mjs for usage.");
    return;
  }

  for (const n of new Set([...opts.reviewers, ...opts.judges])) {
    if (!REVIEWERS[n]) {
      throw new Error(`unknown reviewer "${n}" — known: ${Object.keys(REVIEWERS).join(", ")}`);
    }
  }

  if (opts.rejudge) return rejudge(opts);

  let diff = getDiff(opts);
  if (!diff.trim()) {
    console.error(`No diff found for ${opts.base}...${opts.head}. Nothing to review.`);
    process.exit(1);
  }
  if (!opts.diffFile) assertClean(diff, opts);
  if (diff.length > MAX_DIFF_CHARS) {
    console.error(
      `WARNING: diff is ${diff.length} chars; truncating to ${MAX_DIFF_CHARS}. ` +
      `Findings past the cut-off will be missed — review in smaller slices for full coverage.`,
    );
    diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[... DIFF TRUNCATED AT ${MAX_DIFF_CHARS} CHARS ...]`;
  }

  if (opts.dryRun) {
    console.log(blindPrompt(diff));
    return;
  }

  // The output directory is NOT created yet — nothing may exist on disk while
  // reviewers and judges are running. See runDebate.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(opts.out, stamp);

  console.error(`Round 1/3  blind review (${opts.reviewers.join(", ")} in parallel)...`);
  const { transcript, degraded, raw } = await runDebate({ diff, registry: REVIEWERS, opts });

  for (const f of transcript.failures) console.error(`  FAILED: ${f}`);
  if (degraded) {
    console.error(
      `\nDEGRADED: only ${transcript.survivors.length} reviewer(s) survived round 1. ` +
      `This is NOT a debate — cross-examination and adjudication were skipped.`,
    );
  }

  // Artifacts land only now, after every judge has answered. See runDebate.
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "diff.txt"), diff);
  for (const [n, text] of Object.entries(raw.blind)) writeFileSync(join(outDir, `blind-${n}.txt`), text);
  for (const [n, text] of Object.entries(raw.rebut)) writeFileSync(join(outDir, `rebut-${n}.txt`), text);
  for (const [n, text] of Object.entries(raw.judge)) writeFileSync(join(outDir, `judge-${n}.txt`), text);
  writeFileSync(join(outDir, "transcript.json"), JSON.stringify(transcript, null, 2));
  const report = renderReport(transcript);
  writeFileSync(join(outDir, "report.md"), report);

  console.log(report);
  console.error(`\nArtifacts: ${outDir}/`);
  // Fail closed: a degraded run must not read as a pass to a caller or CI step.
  if (degraded && !opts.allowDegraded) process.exitCode = 2;
}

/* --------------------------------------------------------------- core ---- */

/** Fisher-Yates, so label assignment carries no information about the roster order. */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Collapse each judge's verdicts into one. Unanimity keeps the verdict;
 * any disagreement resolves to `uncertain` rather than a majority.
 *
 * Majority voting looks stronger and is not: correlated models outvote a
 * correct minority, and the panel manufactures confidence precisely where the
 * evidence was thinnest. An unresolved finding is a more honest artifact than
 * a 2-1 verdict.
 */
function aggregateVerdicts(findings, judges, perJudge) {
  const out = [];
  for (const f of findings) {
    const votes = judges
      .map((j) => {
        const v = (perJudge[j] ?? []).find((x) => x.id === f.id);
        return v ? { judge: j, verdict: v.verdict, severity: v.severity, rationale: v.rationale } : null;
      })
      .filter(Boolean);
    if (!votes.length) continue;

    const agreed = new Set(votes.map((v) => v.verdict)).size === 1;
    out.push({
      id: f.id,
      verdict: agreed ? votes[0].verdict : "uncertain",
      severity: votes[0].severity,
      rationale: agreed
        ? votes[0].rationale
        : `Judges disagreed (${votes.map((v) => `${v.judge}: ${v.verdict}`).join("; ")}) — left unresolved. ` +
          votes.map((v) => v.rationale).filter(Boolean).join(" / "),
      judgeVerdicts: votes,
    });
  }
  return out;
}

/**
 * The debate itself: reviewers in, transcript out, nothing touched on disk.
 *
 * The IO-free boundary is a security property, not tidiness. Reviewers hold
 * read-only access to the repository under review, so a `blind-codex.txt`
 * sitting in `.debate-review/` while adjudication runs lets a judge that is
 * also a contestant rebuild the label map by matching text to findings —
 * randomised labels would merely relocate that leak. Holding every artifact in
 * memory until the last judge has answered removes it structurally: the
 * function cannot leak what it has no means to write.
 */
export async function runDebate({ diff, registry, opts }) {
  const names = opts.reviewers;
  const raw = { blind: {}, rebut: {}, judge: {} };
  const failures = [];

  // Round 1 — blind. Reviewers in parallel; none sees another's output.
  const blind = await Promise.all(names.map((n) => registry[n](blindPrompt(diff), opts)));

  const letters = shuffle(names.map((_, i) => String.fromCharCode(65 + i)));
  const labels = Object.fromEntries(names.map((n, i) => [n, letters[i]]));

  const findings = {};
  const survived = [];
  names.forEach((n, i) => {
    const r = blind[i];
    raw.blind[n] = r.text || r.stderr || "";
    findings[n] = [];
    const parsed = r.ok ? extractJson(r.text) : null;
    if (!parsed) {
      failures.push(
        `${n} (round 1): ${r.timedOut ? `TIMED OUT after ${opts.timeout}s` : `exit ${r.code}, unparseable output`}`,
      );
      return;
    }
    // An empty array is a valid result — "I found nothing" is not a failure.
    survived.push(n);
    findings[n] = parsed.map((f, idx) => ({ id: `${labels[n]}${idx + 1}`, ...f }));
  });

  const degraded = survived.length < 2;

  // Round 2 — cross-examination. Each reviewer sees every OTHER reviewer's
  // findings, anonymised, and never its own.
  const rebuttals = {};
  if (!degraded) {
    await Promise.all(names.map(async (n) => {
      rebuttals[n] = [];
      const peer = names.filter((other) => other !== n).flatMap((other) => findings[other]);
      if (!peer.length) return;
      const r = await registry[n](rebutPrompt(diff, stripAuthorship(peer)), opts);
      raw.rebut[n] = r.text || r.stderr || "";
      const parsed = r.ok ? extractJson(r.text) : null;
      if (!parsed) {
        failures.push(`${n} (round 2): ${r.timedOut ? "TIMED OUT" : `exit ${r.code}, unparseable`}`);
        return;
      }
      rebuttals[n] = parsed;
    }));
  }

  // Round 3 — adjudication. Skipped entirely when degraded: the sole survivor
  // would otherwise be scoring its own findings.
  const allFindings = names.flatMap((n) => stripAuthorship(findings[n]));
  const allRebuttals = Object.values(rebuttals).flat();
  let verdicts = [];
  if (!degraded && allFindings.length) {
    const perJudge = {};
    for (const j of opts.judges) {
      const r = await registry[j](judgePrompt(diff, allFindings, allRebuttals), opts);
      raw.judge[j] = r.text || r.stderr || "";
      const parsed = (r.ok && extractJson(r.text)) || null;
      if (!parsed) {
        failures.push(`${j} (round 3): ${r.timedOut ? "TIMED OUT" : "unparseable verdict"}`);
        continue;
      }
      perJudge[j] = parsed;
    }
    verdicts = aggregateVerdicts(allFindings, opts.judges, perJudge);
  }

  const transcript = {
    base: opts.base,
    judges: opts.judges,
    models: Object.fromEntries(names.map((n) => [
      n, n === "codex" ? opts.codexModel : n === "claude" ? opts.claudeModel : n,
    ])),
    labelMap: labels,
    degraded,
    survivors: survived,
    findings,
    rebuttals,
    verdicts,
    failures,
  };
  return { transcript, degraded, raw };
}

/** Reviewer identity is stripped before any prompt that another model will read. */
function stripAuthorship(list) {
  return list.map(({ id, file, line, severity, category, claim, evidence }) =>
    ({ id, file, line, severity, category, claim, evidence }));
}

export function renderReport(t) {
  const byId = new Map();
  for (const n of Object.keys(t.findings)) {
    for (const f of t.findings[n]) byId.set(f.id, { ...f, author: n });
  }
  const rebuttalById = new Map();
  for (const list of Object.values(t.rebuttals)) {
    for (const r of list ?? []) rebuttalById.set(r.id, r);
  }

  const rank = { high: 0, medium: 1, low: 2 };
  const rows = t.verdicts
    .filter((v) => v.verdict === "confirmed")
    .sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));

  // The heading is the whole point of the degraded flag: stderr scrolls away,
  // this file is what someone reads a week later.
  const lines = t.degraded
    ? [
      `# DEGRADED SINGLE-REVIEWER RUN — base \`${t.base}\``,
      "",
      "**This is not a debate.** Fewer than two reviewers survived the blind round, so"
      + " cross-examination and adjudication were skipped. Nothing here has been"
      + " adjudicated, and no finding below may be treated as confirmed.",
      "",
    ]
    : [`# Debate review — base \`${t.base}\``, ""];

  const roster = Object.entries(t.labelMap ?? {})
    .map(([n, l]) => `${n} (\`${t.models?.[n] ?? "?"}\`) = **${l}**`)
    .join(", ");
  const judges = (t.judges ?? []).join(", ") || "none";
  lines.push(`Reviewers: ${roster}. Judge${(t.judges ?? []).length > 1 ? "s" : ""}: **${judges}**.`);
  lines.push(`Raised: ${byId.size} · confirmed: ${rows.length} · rejected: ${t.verdicts.filter((v) => v.verdict === "rejected").length} · uncertain: ${t.verdicts.filter((v) => v.verdict === "uncertain").length}`);
  lines.push("");

  if (t.failures.length) {
    lines.push("> **Incomplete run.** " + t.failures.join("; "), "");
  }

  if (!rows.length) {
    lines.push(
      t.degraded
        ? `_${byId.size} finding(s) were raised but none were adjudicated._`
        : "_No findings survived cross-examination._",
      "",
    );
  }
  for (const v of rows) {
    const f = byId.get(v.id) ?? {};
    const reb = rebuttalById.get(v.id);
    lines.push(`## [${v.severity}] ${f.claim ?? v.id}`);
    lines.push(`\`${f.file ?? "?"}:${f.line ?? "?"}\` · ${f.category ?? "?"} · raised by **${f.author ?? "?"}** (${v.id})`);
    lines.push("");
    if (f.evidence) lines.push(`**Evidence:** ${f.evidence}`, "");
    if (reb) {
      const stance = { refuted: "refuted", corroborated: "corroborated", unverified: "could not verify" };
      lines.push(`**Cross-examination:** ${stance[reb.verdict] ?? reb.verdict ?? "?"} (${reb.confidence}) — ${reb.reasoning}`, "");
    }
    lines.push(`**Verdict:** ${v.rationale}`, "");
  }

  const contested = t.verdicts.filter((v) => v.verdict === "uncertain");
  if (contested.length) {
    lines.push("## Unresolved", "");
    for (const v of contested) {
      const f = byId.get(v.id) ?? {};
      lines.push(`- \`${f.file ?? "?"}:${f.line ?? "?"}\` — ${f.claim ?? v.id} — ${v.rationale}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// Only run when invoked directly; importing this module (for tests) must not
// start a review.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
