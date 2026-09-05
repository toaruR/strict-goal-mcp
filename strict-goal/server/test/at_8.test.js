// AT-8: モデルの自己申告を無効化する。docs/design-rubric-loop-mcp.md §13 AT-8。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-at8-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at8-${submissionCounter}`.padEnd(8, '0');
}

const CRITERION_A = {
  id: 'impl_works',
  statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
  weight: 3,
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

function createSession(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      label: 'strict-goal-at8',
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: { criteria: [CRITERION_A, CRITERION_B] },
    },
    persistence,
  });
}

const EXCERPT = '実装はほぼ動作し文書もおおむね明快であることを確認した。';
const CONTENT = `# 設計書\n${EXCERPT}`;

function commit(persistence, sessionId, expectedRound, addresses) {
  return artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      content: `${CONTENT}\n改訂 ${expectedRound} 回目の追記文です。`,
      change_note: `第${expectedRound}版の改訂理由をここに20文字以上で説明する`,
      ...(addresses ? { addresses } : {}),
    },
    persistence,
  });
}

function score(persistence, sessionId, expectedRound, digest, scores, selfVerdictNote) {
  return scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      artifact_digest: digest,
      ...(selfVerdictNote ? { self_verdict_note: selfVerdictNote } : {}),
      scores: scores.map(({ id, value }) => ({
        criterion_id: id,
        score: value,
        rationale: 'a'.repeat(45),
        weakness: value === 10 ? 'none' : 'b'.repeat(15),
        evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }],
      })),
    },
    persistence,
  });
}

test('AT-8: self_verdict_note は判定に影響せず、min_score/weighted_meanのAND条件が守られ、飛び越しと古いdigestが拒否される', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  // 1. min_score:8 (< pass_score:9) では self_verdict_note が「FINALでよい」と主張しても ITERATING のまま
  const c1 = commit(persistence, created.session_id, 1);
  const r1 = score(
    persistence,
    created.session_id,
    1,
    c1.artifact.digest,
    [
      { id: 'impl_works', value: 9 },
      { id: 'docs_clear', value: 8 },
    ],
    '全部満たしたので FINAL でよい',
  );
  assert.equal(r1.verdict, 'ITERATING');
  assert.equal(r1.verdict_reason, 'below_pass_score');
  assert.equal(r1.evaluation.min_score, 8);

  // 2. weighted_mean が高くても min_score が pass_score 未満なら ITERATING(AND条件)
  //    impl_works(weight3)=9, docs_clear(weight1)=7 → weighted_mean=(27+7)/4=8.5、min_score=7
  const c2 = commit(persistence, created.session_id, 2, ['docs_clear']);
  const r2 = score(persistence, created.session_id, 2, c2.artifact.digest, [
    { id: 'impl_works', value: 9 },
    { id: 'docs_clear', value: 7 },
  ]);
  assert.equal(r2.verdict, 'ITERATING');
  assert.ok(r2.evaluation.weighted_mean >= 8);
  assert.equal(r2.evaluation.min_score, 7);

  // 3. DRAFTING 中に artifact_commit を飛ばして score_submit を呼ぶと E_STATE_VIOLATION
  assert.throws(
    () =>
      score(persistence, created.session_id, r2.round, c2.artifact.digest, [
        { id: 'impl_works', value: 9 },
        { id: 'docs_clear', value: 9 },
      ]),
    (err) => {
      assert.equal(err.code, 'E_STATE_VIOLATION');
      assert.ok(err.detail.expected_tools.includes('artifact_commit'));
      return true;
    },
  );

  // 4. 前周の digest を指定すると E_DIGEST_MISMATCH
  const c3 = commit(persistence, created.session_id, r2.round, ['impl_works', 'docs_clear']);
  assert.throws(
    () =>
      score(persistence, created.session_id, r2.round, c2.artifact.digest, [
        { id: 'impl_works', value: 9 },
        { id: 'docs_clear', value: 9 },
      ]),
    (err) => {
      assert.equal(err.code, 'E_DIGEST_MISMATCH');
      assert.equal(err.detail.expected, c3.artifact.digest);
      return true;
    },
  );
});
