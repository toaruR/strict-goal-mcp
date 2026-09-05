// AT-6: セッション再開。docs/design-rubric-loop-mcp.md §13 AT-6。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopOpenResume } from '../src/tools/loop_open_resume.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at6-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at6-${submissionCounter}`.padEnd(8, '0');
}

const CRITERION = {
  id: 'self_hosting',
  statement: 'セルフホスティングの根拠が十分に示されている',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '全く満たさない', 5: '半分程度満たす', 9: '完全に満たす' },
};

function createSession(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      label: 'rubric-loop-design',
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: { criteria: [CRITERION], policy: { stall_window: 10, max_rounds: 20 } },
    },
    persistence,
  });
}

const EXCERPT = 'セルフホスティングはトレースが3周分しかない状態である。';
const FINAL_EXCERPT = 'セルフホスティングは本ツール自身をこのループで収束させた記録として十分に示された。';
const CONTENT = `# 設計書\n${EXCERPT}`;
const FINAL_CONTENT = `${CONTENT}\n${FINAL_EXCERPT}`;

function commit(persistence, sessionId, expectedRound) {
  return artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      content: `${CONTENT}\n改訂 ${expectedRound} 回目の追記文です。`,
      change_note: `第${expectedRound}版の改訂理由をここに20文字以上で説明する`,
      ...(expectedRound > 1 ? { addresses: ['self_hosting'] } : {}),
    },
    persistence,
  });
}

function score(persistence, sessionId, expectedRound, digest, value, submissionIdOverride, excerpt = EXCERPT) {
  return scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionIdOverride ?? submissionId(),
      expected_round: expectedRound,
      artifact_digest: digest,
      scores: [
        {
          criterion_id: 'self_hosting',
          score: value,
          rationale: 'a'.repeat(45),
          weakness: value === 10 ? 'none' : 'トレースが3周分しかない',
          evidence: [{ kind: 'locator', locator: '§1', excerpt }],
        },
      ],
    },
    persistence,
  });
}

test('AT-6: resumeで状態復元、rubric再指定はE_RUBRIC_ON_RESUME、古いexpected_roundはE_CONCURRENT、同一submission_idは冪等', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  // round1〜4を回して round5 DRAFTING まで進める(スコアは足踏みさせる)
  let round = 1;
  let last;
  for (let i = 0; i < 4; i += 1) {
    const committed = commit(persistence, created.session_id, round);
    last = score(persistence, created.session_id, round, committed.artifact.digest, 6);
    assert.equal(last.verdict, 'ITERATING');
    round = last.round;
  }
  assert.equal(round, 5);
  assert.equal(last.state, 'DRAFTING');

  // 1. loop_open{mode:"resume", session_id} で state/round/rubric_version が復元される
  const resumed = loopOpenResume({
    input: { mode: 'resume', submission_id: submissionId(), session_id: created.session_id },
    persistence,
  });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.state, 'DRAFTING');
  assert.equal(resumed.round, 5);
  assert.equal(resumed.rubric_version, 1);
  assert.ok(resumed.rubric);

  // ハンドルを失っていても label で引ける
  const resumedByLabel = loopOpenResume({
    input: { mode: 'resume', submission_id: submissionId(), label: 'rubric-loop-design' },
    persistence,
  });
  assert.equal(resumedByLabel.session_id, created.session_id);

  // 2. loop_state で must_fix / current_artifact が読める
  const state = loopState({
    input: { session_id: created.session_id, include: ['rubric', 'must_fix', 'last_scores', 'artifact_head'] },
    persistence,
  });
  assert.equal(state.must_fix[0].criterion_id, 'self_hosting');
  assert.equal(state.must_fix[0].score, 6);
  assert.ok(state.current_artifact.digest);

  // 3. resume 時に rubric を渡すと E_RUBRIC_ON_RESUME
  assert.throws(
    () =>
      loopOpenResume({
        input: { mode: 'resume', submission_id: submissionId(), session_id: created.session_id, rubric: { criteria: [CRITERION] } },
        persistence,
      }),
    { code: 'E_RUBRIC_ON_RESUME' },
  );

  // 4. 古い expected_round は E_CONCURRENT
  assert.throws(
    () => commit(persistence, created.session_id, 4),
    (err) => {
      assert.equal(err.code, 'E_CONCURRENT');
      assert.equal(err.detail.expected, 5);
      return true;
    },
  );

  // 5. 正しい round で commit → SCORING
  const c5 = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: 'a5-1'.padEnd(8, '0'),
      expected_round: 5,
      content: FINAL_CONTENT,
      change_note: '第5版の改訂理由をここに20文字以上で説明する',
      addresses: ['self_hosting'],
    },
    persistence,
  });
  assert.equal(c5.ok, true);
  assert.equal(c5.state, 'SCORING');

  // 6. 同一 submission_id の再送は完全に同じ応答（二重登録なし）
  const c5Retry = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: 'a5-1'.padEnd(8, '0'),
      expected_round: 5,
      content: FINAL_CONTENT,
      change_note: '第5版の改訂理由をここに20文字以上で説明する',
      addresses: ['self_hosting'],
    },
    persistence,
  });
  assert.deepEqual(c5Retry, c5);

  // 7. score_submit も同一 submission_id の再送で同じ verdict/round を返す(周は1つしか進まない)
  const s5a = score(persistence, created.session_id, 5, c5.artifact.digest, 9, 's5-1'.padEnd(8, '0'), FINAL_EXCERPT);
  const s5b = score(persistence, created.session_id, 5, c5.artifact.digest, 9, 's5-1'.padEnd(8, '0'), FINAL_EXCERPT);
  assert.deepEqual(s5b, s5a);
  assert.equal(s5a.verdict, 'FINAL');

  // 8. mode:"create" に session_id を渡すと E_HANDLE_NOT_ACCEPTED
  assert.throws(
    () =>
      loopOpenCreate({
        input: {
          mode: 'create',
          submission_id: submissionId(),
          session_id: created.session_id,
          task: 'サンプルタスクの説明文で20文字以上になるようにする',
          loop_mode: 'design',
          rubric: { criteria: [CRITERION] },
        },
        persistence,
      }),
    { code: 'E_HANDLE_NOT_ACCEPTED' },
  );
});
