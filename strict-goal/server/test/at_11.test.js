// AT-11: 上流の版を知らずに下流を開こうとする。docs/design-rubric-loop-mcp.md §13 AT-11。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-at11-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at11-${submissionCounter}`.padEnd(8, '0');
}

const DESIGN_CONTENT = '# 設計\n実装は完全に動作することを実行ログで確認したという記録がここにある。';

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

function finalizeDesign(persistence, sessionId) {
  const c1 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      content: DESIGN_CONTENT,
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
          criterion_id: 'impl_works',
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: DESIGN_CONTENT }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
  return c1.artifact.digest;
}

function sessionCount(persistence) {
  return readdirSync(path.join(persistence.dir, 'sessions')).length;
}

test('AT-11: digest不一致はE_UPSTREAM_DIGEST_MISMATCH、upstream欠落は受理されず、designにはupstreamを付けられない', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalizeDesign(persistence, design.session_id);
  const countBefore = sessionCount(persistence);

  // 1. 偽のdigestを指定するとE_UPSTREAM_DIGEST_MISMATCH、セッションは作られない
  assert.throws(
    () =>
      loopOpenCreate({
        input: {
          mode: 'create',
          submission_id: submissionId(),
          task: 'サンプルタスクの説明文で20文字以上になるようにする',
          loop_mode: 'plan',
          upstream: {
            session_id: design.session_id,
            artifact_digest: `sha256:${'0'.repeat(64)}`,
          },
          rubric: oneCriterionRubric('plan_works'),
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_UPSTREAM_DIGEST_MISMATCH');
      assert.equal(err.detail.expected, designDigest);
      assert.equal(err.detail.actual, `sha256:${'0'.repeat(64)}`);
      return true;
    },
  );
  assert.equal(sessionCount(persistence), countBefore);

  // 2. upstream無しでplanを開こうとすると受理されない(E_VALIDATIONまたはE_UPSTREAM_REQUIRED、どちらでも可)
  assert.throws(
    () =>
      loopOpenCreate({
        input: {
          mode: 'create',
          submission_id: submissionId(),
          task: 'サンプルタスクの説明文で20文字以上になるようにする',
          loop_mode: 'plan',
          rubric: oneCriterionRubric('plan_works'),
        },
        persistence,
      }),
    (err) => {
      assert.ok(['E_VALIDATION', 'E_UPSTREAM_REQUIRED'].includes(err.code));
      return true;
    },
  );
  assert.equal(sessionCount(persistence), countBefore);

  // 3. designにupstreamを付けるとE_UPSTREAM_NOT_ALLOWED
  assert.throws(
    () =>
      loopOpenCreate({
        input: {
          mode: 'create',
          submission_id: submissionId(),
          task: 'サンプルタスクの説明文で20文字以上になるようにする',
          loop_mode: 'design',
          upstream: { session_id: design.session_id, artifact_digest: designDigest },
          rubric: oneCriterionRubric('impl_works'),
        },
        persistence,
      }),
    (err) => {
      assert.ok(['E_VALIDATION', 'E_UPSTREAM_NOT_ALLOWED'].includes(err.code));
      return true;
    },
  );
  assert.equal(sessionCount(persistence), countBefore);
});
