// AT-5: max_rounds 到達。docs/design-rubric-loop-mcp.md §13 AT-5。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { escalate } from '../src/tools/escalate.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-at5-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at5-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'a'.repeat(45);
const CRITERION = {
  id: 'impl_works',
  statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
};

function createSession(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      label: 'strict-goal-at5',
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: { criteria: [CRITERION], policy: { max_rounds: 2 } },
    },
    persistence,
  });
}

const EXCERPT = '実装は一部だけ動作することを目視で確認したという記録がある。';
const CONTENT = `# 設計書\n${EXCERPT}`;

function commit(persistence, sessionId, expectedRound) {
  return artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      content: `${CONTENT}\n改訂 ${expectedRound} 回目の追記文です。`,
      change_note: `第${expectedRound}版の改訂理由をここに20文字以上で説明する`,
      ...(expectedRound > 1 ? { addresses: ['impl_works'] } : {}),
    },
    persistence,
  });
}

function scoreOnce(persistence, sessionId, expectedRound, digest) {
  return scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      artifact_digest: digest,
      scores: [
        {
          criterion_id: 'impl_works',
          score: 5,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }],
        },
      ],
    },
    persistence,
  });
}

test('AT-5: max_rounds到達でSTALLED、escalate(abort)でABORTED（終端）、以後の呼び出しはE_STATE_VIOLATION', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  const c1 = commit(persistence, created.session_id, 1);
  const r1 = scoreOnce(persistence, created.session_id, 1, c1.artifact.digest);
  assert.equal(r1.verdict, 'ITERATING');
  assert.equal(r1.round, 2);

  // 1. round 2(=max_rounds) の score_submit はまだ pass_score 未達 → STALLED, max_rounds_reached
  const c2 = commit(persistence, created.session_id, 2);
  const r2 = scoreOnce(persistence, created.session_id, 2, c2.artifact.digest);
  assert.equal(r2.verdict, 'STALLED');
  assert.equal(r2.verdict_reason, 'max_rounds_reached');
  assert.equal(r2.state, 'STALLED');

  // 2. escalate(abort) → ABORTED（終端）、next_action は audit_export
  const aborted = escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'abort', note: NOTE },
    persistence,
  });
  assert.equal(aborted.state, 'ABORTED');
  assert.equal(aborted.next_action.tool, 'audit_export');

  // 3. ABORTED は終端。以後の escalate も E_STATE_VIOLATION
  assert.throws(
    () =>
      escalate({
        input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE },
        persistence,
      }),
    { code: 'E_STATE_VIOLATION' },
  );
});
