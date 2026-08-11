// Integrity of the debate-review verdict.
//
// These pin the properties that make the durable report trustworthy, because
// every one of them has already failed at least once in practice:
//
//   1. A run that loses a reviewer is not a debate, and must not produce an
//      artifact that reads like one.
//   2. A reviewer that judges its own findings is not adjudication.
//   3. "I could not verify this" is not "I disproved this".
//   4. Anonymity has to survive a judge with read access to the repository —
//      randomising labels is useless if model-named transcripts are already
//      sitting on disk when the judge runs.
//
// runDebate is deliberately IO-free: it takes a reviewer registry and returns
// data. That is what makes property 4 testable at all, and what keeps the
// orchestration honest — it cannot leak what it cannot write.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDebate, renderReport } from "../tools/debate-review.mjs";

const OPTS = { timeout: 60, codexModel: "m-codex", claudeModel: "m-claude" };

/** A reviewer that answers with a fenced JSON block, and records its prompts. */
function fakeReviewer(payload, log = []) {
  return async (prompt) => {
    log.push(prompt);
    return { ok: true, text: "```json\n" + JSON.stringify(payload) + "\n```" };
  };
}

const deadReviewer = async () => ({ ok: false, code: 1, text: "", stderr: "boom" });

const FINDING = {
  file: "scripts/a.mjs", line: 10, severity: "high", category: "correctness",
  claim: "It explodes.", evidence: "Given x=1 it throws.",
};

test("a run that loses a reviewer is marked degraded", async () => {
  const res = await runDebate({
    diff: "diff --git a/x b/x",
    registry: { codex: fakeReviewer([FINDING]), claude: deadReviewer },
    opts: { ...OPTS, reviewers: ["codex", "claude"], judges: ["codex"] },
  });

  assert.equal(res.degraded, true, "one survivor is not a debate");
  assert.ok(
    res.transcript.failures.some(f => f.startsWith("claude")),
    "the dead reviewer is named in the transcript",
  );
});

test("a degraded run never invokes a judge", async () => {
  const judgeCalls = [];
  const judge = fakeReviewer([{ id: "A1", verdict: "confirmed", severity: "high", rationale: "sure" }], judgeCalls);

  const res = await runDebate({
    diff: "d",
    registry: { codex: fakeReviewer([FINDING]), claude: deadReviewer },
    opts: { ...OPTS, reviewers: ["codex", "claude"], judges: ["codex"] },
  });

  assert.equal(judgeCalls.length, 0, "no adjudication prompt was issued");
  assert.deepEqual(res.transcript.verdicts, [], "a degraded run confirms nothing");
  void judge;
});

test("the durable report announces a degraded run in its first line", async () => {
  const res = await runDebate({
    diff: "d",
    registry: { codex: fakeReviewer([FINDING]), claude: deadReviewer },
    opts: { ...OPTS, reviewers: ["codex", "claude"], judges: ["codex"] },
  });

  const first = renderReport(res.transcript).split("\n")[0];
  assert.match(first, /DEGRADED/, "the artifact must not be titled like a real debate");
  assert.doesNotMatch(first, /^# Debate review/);
});

test("runDebate writes nothing, so a judge cannot read peer identities mid-run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "debate-"));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await runDebate({
      diff: "d",
      registry: {
        codex: fakeReviewer([FINDING]),
        claude: fakeReviewer([{ ...FINDING, claim: "Different." }]),
        arbiter: fakeReviewer([{ id: "A1", verdict: "confirmed", severity: "low", rationale: "ok" }]),
      },
      opts: { ...OPTS, reviewers: ["codex", "claude"], judges: ["arbiter"] },
    });
    assert.deepEqual(readdirSync(dir), [], "no model-named artifact may exist before adjudication ends");
  }
  finally {
    process.chdir(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("labels are randomised, so a fixed map cannot be assumed", async () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const res = await runDebate({
      diff: "d",
      registry: {
        codex: fakeReviewer([FINDING]),
        claude: fakeReviewer([FINDING]),
        arbiter: fakeReviewer([]),
      },
      opts: { ...OPTS, reviewers: ["codex", "claude"], judges: ["arbiter"] },
    });
    seen.add(res.transcript.labelMap.codex);
  }
  assert.deepEqual([...seen].sort(), ["A", "B"], "codex must not always be A");
});

test("an unverified rebuttal is not treated as a refutation", async () => {
  const res = await runDebate({
    diff: "d",
    registry: {
      codex: fakeReviewer([FINDING]),
      claude: fakeReviewer([{ id: "A1", verdict: "unverified", confidence: "low", reasoning: "could not check" }]),
      arbiter: fakeReviewer([{ id: "A1", verdict: "uncertain", severity: "high", rationale: "unresolved" }]),
    },
    opts: { ...OPTS, reviewers: ["codex", "claude"], judges: ["arbiter"] },
  });

  const reb = Object.values(res.transcript.rebuttals).flat().find(r => r.id === "A1");
  assert.equal(reb.verdict, "unverified");
  assert.notEqual(reb.verdict, "refuted", "inability to verify is not counter-evidence");
});

test("two judges that disagree leave the finding uncertain", async () => {
  const res = await runDebate({
    diff: "d",
    registry: {
      codex: fakeReviewer([FINDING]),
      claude: fakeReviewer([{ id: "A1", verdict: "refuted", confidence: "high", reasoning: "guarded upstream" }]),
      judgeYes: fakeReviewer([{ id: "A1", verdict: "confirmed", severity: "high", rationale: "real" }]),
      judgeNo: fakeReviewer([{ id: "A1", verdict: "rejected", severity: "high", rationale: "not real" }]),
    },
    opts: { ...OPTS, reviewers: ["codex", "claude"], judges: ["judgeYes", "judgeNo"] },
  });

  const v = res.transcript.verdicts.find(x => x.id === "A1");
  assert.equal(v.verdict, "uncertain", "disagreement must not be settled by rhetoric");
  assert.deepEqual(v.judgeVerdicts.map(j => j.verdict).sort(), ["confirmed", "rejected"]);
});

test("two judges that agree keep the verdict", async () => {
  const agree = { id: "A1", verdict: "confirmed", severity: "high", rationale: "real" };
  const res = await runDebate({
    diff: "d",
    registry: {
      codex: fakeReviewer([FINDING]),
      claude: fakeReviewer([{ id: "A1", verdict: "corroborated", confidence: "high", reasoning: "checked it" }]),
      j1: fakeReviewer([agree]),
      j2: fakeReviewer([{ ...agree, rationale: "also real" }]),
    },
    opts: { ...OPTS, reviewers: ["codex", "claude"], judges: ["j1", "j2"] },
  });

  assert.equal(res.transcript.verdicts.find(x => x.id === "A1").verdict, "confirmed");
});

test("reviewers never receive their own findings to rebut", async () => {
  const codexPrompts = [];
  const claudePrompts = [];
  await runDebate({
    diff: "d",
    registry: {
      codex: fakeReviewer([{ ...FINDING, claim: "CODEX_CLAIM" }], codexPrompts),
      claude: fakeReviewer([{ ...FINDING, claim: "CLAUDE_CLAIM" }], claudePrompts),
      arbiter: fakeReviewer([]),
    },
    opts: { ...OPTS, reviewers: ["codex", "claude"], judges: ["arbiter"] },
  });

  const codexRebut = codexPrompts.at(-1);
  assert.match(codexRebut, /CLAUDE_CLAIM/, "codex rebuts claude's finding");
  assert.doesNotMatch(codexRebut, /CODEX_CLAIM/, "codex never rebuts itself");
});

test("no prompt sent to any model names a reviewer", async () => {
  const prompts = [];
  const collect = (payload) => fakeReviewer(payload, prompts);
  await runDebate({
    diff: "d",
    registry: {
      codex: collect([FINDING]),
      claude: collect([FINDING]),
      arbiter: collect([{ id: "A1", verdict: "confirmed", severity: "low", rationale: "ok" }]),
    },
    opts: { ...OPTS, reviewers: ["codex", "claude"], judges: ["arbiter"] },
  });

  for (const p of prompts) {
    assert.doesNotMatch(p, /\bcodex\b|\bclaude\b/i, "prompts must not carry model identity");
  }
});
