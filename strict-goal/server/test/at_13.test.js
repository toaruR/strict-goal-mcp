// AT-13: 差し戻し（implement → plan）。docs/design-rubric-loop-mcp.md §13 AT-13。
// implement(fileset)はartifact_commitに未結線のため、kickback.test.jsと同じdesign/planの2セッション
// チェーンでkickback/budget機構そのもの(下流→上流の差し戻し・凍結・上限)を検証する。
// 監査JSONのkickbacks[]フィールドは設計書の例({downstream_state_after,upstream_state_after,resolved_at})
// ではなく chain/kickback.js の実際の記録形({at, from, to, target_criteria, note})に従う。
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
import { auditExport } from '../src/tools/audit_export.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-at13-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at13-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'T004 が T007 の成果物を前提にしているが依存が逆向きで実装順に並べると失敗する';
const HUMAN_TOKEN = 'human-approval-token-placeholder';
const DESIGN_CONTENT = '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。';
const DESIGN_EXCERPT = '実装は完全に動作することを実行ログで確認したという記録がある。';
const PLAN_CONTENT = JSON.stringify({
  plan_version: 1,
  summary: 'これはAT-13テスト用の実装計画書であり、40文字以上の長さを確保するための文章です。',
  tasks: [
    {
      id: 'T001',
      title: '初期タスクの実装',
      intent: '初期タスクの実装を行うための十分な文字数の意図説明文である。',
      depends_on: [],
      design_refs: ['# 設計'],
      changes: [{ path: 'src/main.js', kind: 'add' }],
      acceptance: ['初期機能が正常に動作することを確認するための受け入れ条件である'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
  ],
});

function oneCriterionRubric(criterionId, statement) {
  return {
    criteria: [
      {
        id: criterionId,
        statement,
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
      rubric: oneCriterionRubric('dependency_soundness', '依存関係の順序が正しいことの根拠が十分に示されている'),
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
      rubric: oneCriterionRubric('plan_local', '計画自身の記述だけで完結する根拠の確認'),
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
      ...(round >= 2 ? { addresses: ['dependency_soundness'] } : {}),
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
          criterion_id: 'dependency_soundness',
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
  return c1.artifact.digest;
}

function readSessionRaw(persistence, sessionId) {
  return JSON.parse(readFileSync(path.join(persistence.dir, 'sessions', sessionId, 'session.json'), 'utf8'));
}

function buildFinalChain(persistence) {
  const design = createDesign(persistence);
  finalizeDesign(persistence, design.session_id, 1);
  const designDigest = readSessionRaw(persistence, design.session_id).current_artifact.digest;
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  finalizePlan(persistence, plan.session_id);
  return { design, plan };
}

function kickback(persistence, sessionId) {
  return escalate({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      action: 'kickback',
      human_token: HUMAN_TOKEN,
      target_criteria: ['dependency_soundness'],
      note: NOTE,
    },
    persistence,
  });
}

test('AT-13: kickbackで下流はFROZEN・上流はDRAFTINGに再開し、上限chain_max_kickbacks(2)を超えるとE_CHAIN_BUDGET_EXHAUSTEDになり監査に残る', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);

  // 1. kickback 1回目 → 下流FROZEN、上流DRAFTINGで再開
  const result1 = kickback(persistence, plan.session_id);
  assert.equal(result1.state, 'FROZEN');
  const designAfter1 = readSessionRaw(persistence, design.session_id);
  assert.equal(designAfter1.state, 'DRAFTING');
  assert.equal(designAfter1.reopened[0].from_session, plan.session_id);
  assert.deepEqual(
    designAfter1.last_evaluation.must_fix.map((m) => m.criterion_id),
    ['dependency_soundness'],
  );

  // 上流を直し再びFINALにしてから rebase して plan を復帰させる(2回目のkickbackに備える)
  const designDigest2 = finalizeDesign(persistence, design.session_id, 2);
  loopState({ input: { session_id: plan.session_id }, persistence });
  escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'rebase',
      upstream_digest: designDigest2,
      note: 'a'.repeat(45),
    },
    persistence,
  });
  finalizePlan(persistence, plan.session_id);

  // 2. kickback 2回目(上限ちょうど)
  const result2 = kickback(persistence, plan.session_id);
  assert.equal(result2.state, 'FROZEN');

  // kickbackはFINAL/FINAL_WITH_RELAXATIONからしか呼べないため、3回目の予算超過を確認する前に
  // もう一度 rebase+finalizePlan で下流をFINALに戻しておく(kickback.test.jsと同じ手順)。
  const designDigest3 = finalizeDesign(persistence, design.session_id, 3);
  loopState({ input: { session_id: plan.session_id }, persistence });
  escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'rebase',
      upstream_digest: designDigest3,
      note: 'a'.repeat(45),
    },
    persistence,
  });
  finalizePlan(persistence, plan.session_id);

  // 3. kickback 3回目 → E_CHAIN_BUDGET_EXHAUSTED
  assert.throws(
    () => kickback(persistence, plan.session_id),
    (err) => {
      assert.equal(err.code, 'E_CHAIN_BUDGET_EXHAUSTED');
      assert.equal(err.detail.check, 'kickbacks');
      assert.equal(err.detail.count, 2);
      assert.equal(err.detail.limit, 2);
      return true;
    },
  );

  // 4. 予算超過は状態遷移前に弾かれるため、下流は破棄されず直前のFINALのまま
  assert.equal(readSessionRaw(persistence, plan.session_id).state, 'FINAL');

  // 5. audit_export(scope:chain) の kickbacks[] に2件とも記録が残る
  const exported = auditExport({ input: { session_id: plan.session_id, scope: 'chain' }, persistence });
  const audit = JSON.parse(readFileSync(exported.export.path, 'utf8'));
  assert.equal(audit.kickbacks.length, 2);
  assert.ok(audit.kickbacks.every((k) => k.from === plan.session_id && k.to === design.session_id));
  assert.ok(audit.kickbacks.every((k) => Array.isArray(k.target_criteria) && k.target_criteria.includes('dependency_soundness')));
});
