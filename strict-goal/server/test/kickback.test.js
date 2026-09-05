import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { escalate } from '../src/tools/escalate.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-kickback-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-kbk-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'a'.repeat(45);
const HUMAN_TOKEN = 'human-approval-token-placeholder';
const DESIGN_CONTENT = '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。';
const DESIGN_EXCERPT = '実装は完全に動作することを実行ログで確認したという記録がある。';
const PLAN_CONTENT = JSON.stringify({
  plan_version: 1,
  summary: 'これはテスト用の有効な計画サマリー文字列であり、長さが40文字以上になるように長めに記述しています。',
  tasks: [
    {
      id: 'T001',
      title: 'タスク1のタイトル',
      intent: 'タスク1の意図を20文字以上で記述するための文字列です',
      depends_on: [],
      design_refs: ['# 設計'],
      changes: [{ path: 'src/a.js', kind: 'add' }],
      acceptance: ['受け入れ条件1が10文字以上'],
      verify: [{ command: 'node --test', expect_exit_code: 0 }],
    },
  ],
});

function oneCriterionRubric() {
  return {
    criteria: [
      {
        id: 'impl_works',
        statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
        weight: 1,
        verification: 'manual',
        anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
      },
    ],
    policy: {},
  };
}

function planRubric() {
  return {
    criteria: [
      {
        id: 'plan_local',
        statement: '計画自身の記述だけで完結する根拠の確認',
        weight: 1,
        verification: 'manual',
        anchors: { 1: '根拠が全くない', 5: '一部だけ根拠がある', 9: '十分な根拠がある' },
      },
    ],
    policy: {},
  };
}

function createDesign(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: oneCriterionRubric(),
    },
    persistence,
  });
}

function createPlan(persistence, upstream) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'plan',
      upstream,
      rubric: planRubric(),
    },
    persistence,
  });
}

function finalizeDesign(persistence, sessionId, round) {
  const content = round === 1 ? DESIGN_CONTENT : `${DESIGN_CONTENT}\n改訂第${round}版で欠陥を修正した。`;
  const c1 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: round,
      content,
      change_note: 'これは20文字以上ある変更理由の説明文です',
      ...(round >= 2 ? { addresses: ['impl_works'] } : {}),
    },
    persistence,
  });
  const r1 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: round,
      artifact_digest: c1.artifact.digest,
      scores: [
        {
          criterion_id: 'impl_works',
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: DESIGN_EXCERPT }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
  return c1.artifact.digest;
}

function finalizePlan(persistence, sessionId) {
  const c1 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      content: PLAN_CONTENT,
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });
  const r1 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: c1.artifact.digest,
      scores: [
        {
          criterion_id: 'plan_local',
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: PLAN_CONTENT }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
}

function readSessionRaw(persistence, sessionId) {
  return JSON.parse(readFileSync(path.join(persistence.dir, 'sessions', sessionId, 'session.json'), 'utf8'));
}

function readChainRaw(persistence, chainId) {
  return JSON.parse(readFileSync(path.join(persistence.dir, 'chains', chainId, 'chain.json'), 'utf8'));
}

function buildFinalChain(persistence) {
  const design = createDesign(persistence);
  finalizeDesign(persistence, design.session_id, 1);
  const designDigest = readSessionRaw(persistence, design.session_id).current_artifact.digest;
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  finalizePlan(persistence, plan.session_id);
  return { design, plan };
}

function kickback(persistence, sessionId, targetCriteria = ['impl_works']) {
  return escalate({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      action: 'kickback',
      human_token: HUMAN_TOKEN,
      target_criteria: targetCriteria,
      note: NOTE,
    },
    persistence,
  });
}

test('kickback すると上流が DRAFTING に再開し、下流は FROZEN になり chain.json に記録される', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);

  const result = kickback(persistence, plan.session_id);
  assert.equal(result.state, 'FROZEN');

  const designAfter = readSessionRaw(persistence, design.session_id);
  assert.equal(designAfter.state, 'DRAFTING');
  assert.equal(designAfter.round, 2);
  assert.equal(designAfter.reopened.length, 1);
  assert.equal(designAfter.reopened[0].from_session, plan.session_id);
  assert.deepEqual(
    designAfter.last_evaluation.must_fix.map((m) => m.criterion_id),
    ['impl_works'],
  );

  const chain = readChainRaw(persistence, design.chain_id);
  assert.equal(chain.kickbacks.length, 1);
  assert.equal(chain.kickbacks[0].from, plan.session_id);
  assert.equal(chain.kickbacks[0].to, design.session_id);
  assert.deepEqual(chain.kickbacks[0].target_criteria, ['impl_works']);
});

test('FROZEN 下では artifact_commit/score_submit/rubric_amend が E_FROZEN になり、escalate(abort) だけ通る', () => {
  const persistence = durablePersistence();
  const { plan } = buildFinalChain(persistence);
  kickback(persistence, plan.session_id);

  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: plan.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          content: PLAN_CONTENT,
          change_note: 'これは20文字以上ある変更理由の説明文です',
        },
        persistence,
      }),
    { code: 'E_FROZEN' },
  );

  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: plan.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          artifact_digest: readSessionRaw(persistence, plan.session_id).current_artifact.digest,
          scores: [
            {
              criterion_id: 'plan_local',
              score: 9,
              rationale: 'a'.repeat(45),
              weakness: 'b'.repeat(15),
              evidence: [{ kind: 'locator', locator: '§1', excerpt: PLAN_CONTENT }],
            },
          ],
        },
        persistence,
      }),
    { code: 'E_FROZEN' },
  );

  const aborted = escalate({
    input: { session_id: plan.session_id, submission_id: submissionId(), action: 'abort', note: NOTE },
    persistence,
  });
  assert.equal(aborted.state, 'ABORTED');
});

test('上流が再び FINAL になれば下流は FROZEN から SUPERSEDED を経て rebase できる', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);
  kickback(persistence, plan.session_id);

  const newDesignDigest = finalizeDesign(persistence, design.session_id, 2);

  const state = loopState({ input: { session_id: plan.session_id }, persistence });
  assert.equal(state.state, 'SUPERSEDED');

  const rebased = escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'rebase',
      upstream_digest: newDesignDigest,
      note: NOTE,
    },
    persistence,
  });
  assert.equal(rebased.state, 'DRAFTING');
});

test('kickback が chain_max_kickbacks を超えると E_CHAIN_BUDGET_EXHAUSTED になる', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);

  for (let i = 0; i < 2; i += 1) {
    kickback(persistence, plan.session_id);
    finalizeDesign(persistence, design.session_id, i + 2);
    loopState({ input: { session_id: plan.session_id }, persistence });
    escalate({
      input: {
        session_id: plan.session_id,
        submission_id: submissionId(),
        action: 'rebase',
        upstream_digest: readSessionRaw(persistence, design.session_id).current_artifact.digest,
        note: NOTE,
      },
      persistence,
    });
    finalizePlan(persistence, plan.session_id);
  }

  assert.throws(() => kickback(persistence, plan.session_id), { code: 'E_CHAIN_BUDGET_EXHAUSTED' });
});
