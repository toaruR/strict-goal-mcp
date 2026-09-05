// AT-16: チェーン予算の超過。docs/design-rubric-loop-mcp.md §13 AT-16。
// 設計書の例はscore_submit自身がchain round予算を検査して{verdict:"REVISE",escalation:{reason:"chain_budget_exhausted"}}
// を返し、escalate(resolve,"continue")がchainレベルのgranted_extra_roundsを上乗せし、
// 予算超過でも合格ならwarnings:["chain_budget_exceeded"]で押し通す、という3点を挙げているが、
// 実装(src/tools/score_submit.js, src/tools/escalate.js)にはこれらへの参照が一切無い
// (grepで"chain_budget_exceeded"/"chain_budget_exhausted"/"REVISE"がヒットしない)。
// 実際にchain round予算(src/chain/budget.js)を検査する公開経路はloop_open(plan|implement作成時)のみで、
// grantExtraRoundsはどの公開ツールからも呼ばれていない契約専用関数(test/chain_budget.test.jsが先例)。
// そのため本テストは(1)loop_open経由のE_CHAIN_BUDGET_EXHAUSTED(複数セッションのround合算)と
// (2)grantExtraRoundsの「1チェーン1回だけ」契約をmodule直呼びで検証する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { readSession, writeSession } from '../src/store/session_store.js';
import { assertRoundBudget, grantExtraRounds } from '../src/chain/budget.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-at16-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at16-${submissionCounter}`.padEnd(8, '0');
}

function oneCriterionRubric(criterionId) {
  return {
    criteria: [
      {
        id: criterionId,
        statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
        weight: 1,
        verification: 'manual',
        anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
      },
    ],
  };
}

function createDesign(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: oneCriterionRubric('impl_works'),
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
      rubric: oneCriterionRubric('plan_works'),
    },
    persistence,
  });
}

const PLAN_CONTENT = JSON.stringify({
  plan_version: 1,
  summary: 'これはテスト用の実装計画書であり、40文字以上の長さを十分に確保するための要約文章です。',
  tasks: [
    {
      id: 'T001',
      title: 'タスクの実装',
      intent: 'タスクの実装を行うための十分な文字数の意図説明文である。',
      depends_on: [],
      design_refs: ['# 設計'],
      changes: [{ path: 'src/main.js', kind: 'add' }],
      acceptance: ['初期機能が正常に動作することを確認するための受け入れ条件である'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
  ],
});
const PLAN_EXCERPT = 'これはテスト用の実装計画書であり、40文字以上の長さを十分に確保するための要約文章です。';

function finalize(persistence, sessionId, content, criterionId, excerptOverride = undefined) {
  const c1 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      content,
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });
  const excerpt = excerptOverride ?? content;
  const r1 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: c1.artifact.digest,
      scores: [
        {
          criterion_id: criterionId,
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
  return c1.artifact.digest;
}

function bumpRound(persistence, sessionId, round) {
  const session = readSession(persistence.dir, sessionId);
  session.round = round;
  writeSession(persistence.dir, session);
  return session;
}

test('AT-16: loop_openの新規参加はチェーン内全メンバーのround合算がchain_max_rounds(28)に達すると拒否され、grantExtraRoundsで1回だけ上限を上乗せできる', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalize(persistence, design.session_id, '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。', 'impl_works');

  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  const planDigest = finalize(persistence, plan.session_id, PLAN_CONTENT, 'plan_works', PLAN_EXCERPT);

  // 27round実際に回す代わりに、chain_budget.test.js と同じ直接書き換えで
  // 「design+planの合算がちょうどchain_max_rounds(28)」という状況だけを再現する。
  bumpRound(persistence, design.session_id, 20);
  bumpRound(persistence, plan.session_id, 8);

  // 予算はちょうど枯渇(20+8=28>=28)しているので、3セッション目(implement)の新規参加は拒否される
  assert.throws(
    () =>
      loopOpenCreate({
        input: {
          mode: 'create',
          submission_id: submissionId(),
          task: 'サンプルタスクの説明文で20文字以上になるようにする',
          loop_mode: 'implement',
          upstream: { session_id: plan.session_id, artifact_digest: planDigest },
          rubric: oneCriterionRubric('impl_done'),
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_CHAIN_BUDGET_EXHAUSTED');
      assert.equal(err.detail.chain_rounds, 28);
      assert.equal(err.detail.limit, 28);
      assert.deepEqual(
        err.detail.per_session.map((s) => s.round),
        [20, 8],
      );
      return true;
    },
  );

  // grantExtraRoundsを1回適用するとlimitが34に上がり、同じ状況でも新規参加が通る
  const updatedChain = grantExtraRounds(persistence.dir, design.chain_id);
  assert.equal(updatedChain.granted_extra_rounds, 6);

  const implement = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'implement',
      upstream: { session_id: plan.session_id, artifact_digest: planDigest },
      rubric: oneCriterionRubric('impl_done'),
    },
    persistence,
  });
  assert.equal(implement.state, 'DRAFTING');

  // 上乗せは1チェーンにつき1回だけ
  assert.throws(() => grantExtraRounds(persistence.dir, design.chain_id), (err) => {
    assert.equal(err.code, 'E_RESOLUTION_NOT_APPLICABLE');
    assert.equal(err.detail.reason, 'extra_rounds_already_granted');
    return true;
  });

  // 参考: assertRoundBudgetを直接呼んでも同じ判定になる(スコープが公開ツールと同一であることの確認)
  const { chainRounds, limit } = assertRoundBudget(persistence.dir, design.chain_id);
  assert.equal(chainRounds, 29); // 20 + 8 + implement作成時点のround(1)
  assert.equal(limit, 34);
});
