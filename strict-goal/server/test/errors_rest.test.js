// T071: loop_state(2)/rubric_amend(8)/escalate(8)/audit_export(2) のエラーを全数検査する
// （設計書 19.6.7 総覧・6.4.*）。plan-phase3.json の T071 受け入れ基準は rubric_amend=5 件・
// escalate=7 件などと書かれているが、src/errors/codes.js の実装ベース補正後レジストリ
// （rubric_amend=8, escalate=8）を正として検査する（CLAUDE.md ハマりポイント参照）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { rubricAmend } from '../src/tools/rubric_amend.js';
import { escalate } from '../src/tools/escalate.js';
import { auditExport } from '../src/tools/audit_export.js';
import { TOOL_ERRORS } from '../src/errors/codes.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-errors-rest-'));
}
function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-rest-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'a'.repeat(45);
const CHANGE_NOTE = 'これは20文字以上ある変更理由の説明文です';
const HUMAN_TOKEN = 'human-approval-token-placeholder';

const CRITERION_A = {
  id: 'impl_works',
  statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
  weight: 2,
  verification: 'manual',
  anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
};
const CRITERION_B = {
  id: 'docs_clear',
  statement: '文書が第三者にも明快に伝わることの根拠が十分に示されている',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '不明瞭で読めない', 5: 'まあまあ読める', 9: '非常に明瞭' },
};

function createDesignSession(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: { criteria: [CRITERION_A, CRITERION_B] },
    },
    persistence,
  });
}

function amend(persistence, sessionId, overrides = {}) {
  return rubricAmend({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      criteria: [CRITERION_A, CRITERION_B],
      reason: 'a'.repeat(45),
      ...overrides,
    },
    persistence,
  });
}

function oneCriterionRubric(criterionId) {
  return {
    criteria: [
      { id: criterionId, statement: '実装が仕様どおりに動作することの根拠が十分に示されている', weight: 1, verification: 'manual', anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' } },
    ],
  };
}
function planRubric(criterionId) {
  return {
    criteria: [
      { id: criterionId, statement: '計画が具体的で実行可能であることの根拠が十分に示されている', weight: 1, verification: 'manual', anchors: { 1: '計画が全く具体的でない', 5: '計画がある程度具体的である', 9: '計画が完全に具体的である' } },
    ],
  };
}

function createDesignK(persistence) {
  return loopOpenCreate({
    input: { mode: 'create', submission_id: submissionId(), task: 'サンプルタスクの説明文で20文字以上になるようにする', loop_mode: 'design', rubric: oneCriterionRubric('impl_works') },
    persistence,
  });
}
function createPlanK(persistence, upstream) {
  return loopOpenCreate({
    input: { mode: 'create', submission_id: submissionId(), task: 'サンプルタスクの説明文で20文字以上になるようにする', loop_mode: 'plan', upstream, rubric: planRubric('plan_works') },
    persistence,
  });
}
function finalizeDesignK(persistence, sessionId, round) {
  const content = round === 1
    ? '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。'
    : `# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。\n改訂第${round}版で欠陥を修正した。`;
  const c1 = artifactCommit({
    input: { session_id: sessionId, submission_id: submissionId(), expected_round: round, content, change_note: CHANGE_NOTE, ...(round >= 2 ? { addresses: ['impl_works'] } : {}) },
    persistence,
  });
  const r1 = scoreSubmit({
    input: { session_id: sessionId, submission_id: submissionId(), expected_round: round, artifact_digest: c1.artifact.digest, scores: [{ criterion_id: 'impl_works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: content }] }] },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
  return c1.artifact.digest;
}
const VALID_PLAN_CONTENT_K = JSON.stringify({
  plan_version: 1,
  summary: 'これは40文字以上になるように書いた計画の要約文章です。ダミーの文字を足して長さを稼ぎます。',
  tasks: [
    {
      id: 'T001',
      title: 'タスク1',
      intent: 'このタスクの意図を20文字以上で説明する文章',
      design_refs: ['# 設計'],
      depends_on: [],
      changes: [{ path: 'src/a.js', kind: 'add' }],
      acceptance: ['受け入れ条件が満たされること'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
  ],
}, null, 2);
const VALID_PLAN_EXCERPT_K = 'これは40文字以上になるように書いた計画の要約文章です。ダミーの文字を足して長さを稼ぎます。';

function finalizePlanK(persistence, sessionId) {
  const content = VALID_PLAN_CONTENT_K;
  const c1 = artifactCommit({
    input: { session_id: sessionId, submission_id: submissionId(), expected_round: 1, content, change_note: CHANGE_NOTE },
    persistence,
  });
  const r1 = scoreSubmit({
    input: { session_id: sessionId, submission_id: submissionId(), expected_round: 1, artifact_digest: c1.artifact.digest, scores: [{ criterion_id: 'plan_works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: VALID_PLAN_EXCERPT_K }] }] },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
}
function buildFinalChainK(persistence) {
  const design = createDesignK(persistence);
  finalizeDesignK(persistence, design.session_id, 1);
  const designDigest = readSessionRaw(persistence, design.session_id).current_artifact.digest;
  const plan = createPlanK(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  return { design, plan };
}
function kickback(persistence, sessionId, targetCriteria = ['impl_works']) {
  return escalate({
    input: { session_id: sessionId, submission_id: submissionId(), action: 'kickback', human_token: HUMAN_TOKEN, target_criteria: targetCriteria, note: NOTE },
    persistence,
  });
}

function sessionJsonPath(persistence, sessionId) {
  return path.join(persistence.dir, 'sessions', sessionId, 'session.json');
}
function readSessionRaw(persistence, sessionId) {
  return JSON.parse(readFileSync(sessionJsonPath(persistence, sessionId), 'utf8'));
}
function writeSessionRaw(persistence, sessionId, session) {
  writeFileSync(sessionJsonPath(persistence, sessionId), JSON.stringify(session, null, 2));
}

const seen = { loop_state: new Set(), rubric_amend: new Set(), escalate: new Set(), audit_export: new Set() };
function expectCode(tool, code, fn) {
  test(`${tool}: ${code}`, () => {
    assert.throws(fn, { code });
    seen[tool].add(code);
  });
}

// --- loop_state (2) ---

expectCode('loop_state', 'E_SESSION_NOT_FOUND', () => {
  const persistence = durablePersistence();
  loopState({ input: { session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY' }, persistence });
});

expectCode('loop_state', 'E_VALIDATION', () => {
  const persistence = durablePersistence();
  const created = createDesignSession(persistence);
  loopState({ input: { session_id: created.session_id, include: ['not_a_real_field'] }, persistence });
});

// --- rubric_amend (8) ---

expectCode('rubric_amend', 'E_SESSION_NOT_FOUND', () => {
  const persistence = durablePersistence();
  amend(persistence, 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY');
});

expectCode('rubric_amend', 'E_STATE_VIOLATION', () => {
  const persistence = durablePersistence();
  const created = createDesignSession(persistence);
  artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: '# 設計書\n本文', change_note: CHANGE_NOTE },
    persistence,
  });
  amend(persistence, created.session_id);
});

expectCode('rubric_amend', 'E_CONCURRENT', () => {
  const persistence = durablePersistence();
  const created = createDesignSession(persistence);
  amend(persistence, created.session_id, { expected_round: 2 });
});

expectCode('rubric_amend', 'E_VALIDATION', () => {
  const persistence = durablePersistence();
  const created = createDesignSession(persistence);
  amend(persistence, created.session_id, { reason: 'a'.repeat(39) });
});

expectCode('rubric_amend', 'E_RELAXATION_UNACKNOWLEDGED', () => {
  const persistence = durablePersistence();
  const created = createDesignSession(persistence);
  amend(persistence, created.session_id, { criteria: [{ ...CRITERION_A, weight: 1 }, CRITERION_B] });
});

expectCode('rubric_amend', 'E_UPSTREAM_NOT_FOUND', () => {
  const persistence = durablePersistence();
  const { plan } = buildFinalChainK(persistence);
  const raw = readSessionRaw(persistence, plan.session_id);
  raw.upstream = { ...raw.upstream, session_id: 'sess_does_not_exist' };
  writeSessionRaw(persistence, plan.session_id, raw);
  rubricAmend({
    input: { session_id: plan.session_id, submission_id: submissionId(), expected_round: 1, criteria: planRubric('plan_works').criteria, reason: 'a'.repeat(45) },
    persistence,
  });
});

expectCode('rubric_amend', 'E_FROZEN', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChainK(persistence);
  const raw = readSessionRaw(persistence, design.session_id);
  raw.state = 'DRAFTING';
  writeSessionRaw(persistence, design.session_id, raw);
  rubricAmend({
    input: { session_id: plan.session_id, submission_id: submissionId(), expected_round: 1, criteria: planRubric('plan_works').criteria, reason: 'a'.repeat(45) },
    persistence,
  });
});

expectCode('rubric_amend', 'E_SUPERSEDED', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChainK(persistence);
  const raw = readSessionRaw(persistence, design.session_id);
  raw.current_artifact = { ...raw.current_artifact, digest: `sha256:${'f'.repeat(64)}` };
  writeSessionRaw(persistence, design.session_id, raw);
  rubricAmend({
    input: { session_id: plan.session_id, submission_id: submissionId(), expected_round: 1, criteria: planRubric('plan_works').criteria, reason: 'a'.repeat(45) },
    persistence,
  });
});

// --- escalate (8) ---

expectCode('escalate', 'E_SESSION_NOT_FOUND', () => {
  const persistence = durablePersistence();
  escalate({ input: { session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY', submission_id: submissionId(), action: 'abort', note: NOTE }, persistence });
});

expectCode('escalate', 'E_VALIDATION', () => {
  const persistence = durablePersistence();
  const created = createDesignSession(persistence);
  escalate({ input: { session_id: created.session_id, submission_id: submissionId(), action: 'resolve', note: NOTE }, persistence });
});

expectCode('escalate', 'E_RESOLUTION_NOT_APPLICABLE', () => {
  const persistence = durablePersistence();
  const created = createDesignSession(persistence);
  escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'resolve', resolution: 'continue', human_token: 'x'.repeat(20), note: NOTE },
    persistence,
  });
});

expectCode('escalate', 'E_STATE_VIOLATION', () => {
  const persistence = durablePersistence();
  const created = createDesignSession(persistence);
  escalate({ input: { session_id: created.session_id, submission_id: submissionId(), action: 'abort', note: NOTE }, persistence });
  escalate({ input: { session_id: created.session_id, submission_id: submissionId(), action: 'abort', note: NOTE }, persistence });
});

expectCode('escalate', 'E_TOKEN_INVALID', () => {
  const persistence = durablePersistence();
  const created = createDesignSession(persistence);
  escalate({ input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE }, persistence });
  escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'resolve', resolution: 'continue', human_token: 'wrong-token-wrong-token-wrong-token', note: NOTE },
    persistence,
  });
});

expectCode('escalate', 'E_UPSTREAM_NOT_FOUND', () => {
  const persistence = durablePersistence();
  const { plan } = buildFinalChainK(persistence);
  const raw = readSessionRaw(persistence, plan.session_id);
  raw.upstream = { ...raw.upstream, session_id: 'sess_does_not_exist' };
  writeSessionRaw(persistence, plan.session_id, raw);
  escalate({ input: { session_id: plan.session_id, submission_id: submissionId(), action: 'abort', note: NOTE }, persistence });
});

expectCode('escalate', 'E_UPSTREAM_DIGEST_MISMATCH', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChainK(persistence);
  finalizePlanK(persistence, plan.session_id);
  kickback(persistence, plan.session_id);
  finalizeDesignK(persistence, design.session_id, 2);
  loopState({ input: { session_id: plan.session_id }, persistence });
  escalate({
    input: { session_id: plan.session_id, submission_id: submissionId(), action: 'rebase', upstream_digest: `sha256:${'f'.repeat(64)}`, note: NOTE },
    persistence,
  });
});

expectCode('escalate', 'E_CHAIN_BUDGET_EXHAUSTED', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChainK(persistence);
  finalizePlanK(persistence, plan.session_id);

  for (let i = 0; i < 2; i += 1) {
    kickback(persistence, plan.session_id);
    finalizeDesignK(persistence, design.session_id, i + 2);
    loopState({ input: { session_id: plan.session_id }, persistence });
    escalate({
      input: { session_id: plan.session_id, submission_id: submissionId(), action: 'rebase', upstream_digest: readSessionRaw(persistence, design.session_id).current_artifact.digest, note: NOTE },
      persistence,
    });
    finalizePlanK(persistence, plan.session_id);
  }

  kickback(persistence, plan.session_id);
});

// --- audit_export (2) ---

expectCode('audit_export', 'E_SESSION_NOT_FOUND', () => {
  const persistence = durablePersistence();
  auditExport({ input: { session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY' }, persistence });
});

expectCode('audit_export', 'E_VALIDATION', () => {
  const persistence = durablePersistence();
  const created = createDesignSession(persistence);
  auditExport({ input: { session_id: created.session_id, scope: 'not_a_real_scope' }, persistence });
});

test('loop_state/rubric_amend/escalate/audit_export: 再現したコード集合が各レジストリ件数と一致し E_INTERNAL 以外の未知コードが出ない', () => {
  for (const tool of ['loop_state', 'rubric_amend', 'escalate', 'audit_export']) {
    assert.deepEqual([...seen[tool]].sort(), [...TOOL_ERRORS[tool]].sort(), tool);
    assert.ok(!seen[tool].has('E_INTERNAL'), tool);
  }
});
