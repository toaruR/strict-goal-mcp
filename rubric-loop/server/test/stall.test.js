import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { nextRoundsWithoutImprovement, decideStallVerdict } from '../src/judge/stall.js';
import { checkStateTransition } from '../src/fsm/guard.js';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-stall-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-stall-${submissionCounter}`.padEnd(8, '0');
}

function oneCriterionRubric(policyOverrides) {
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
    policy: policyOverrides ?? {},
  };
}

function createSession(persistence, loopMode, policyOverrides, upstream) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: loopMode,
      rubric: oneCriterionRubric(policyOverrides),
      ...(upstream ? { upstream } : {}),
    },
    persistence,
  });
}

// plan/implement は upstream に FINAL な design セッションを要求するため、まず設計を1周で通す。
function createFinalUpstream(persistence) {
  const created = createSession(persistence, 'design', undefined);
  const committed = commit(persistence, created.session_id, 1);
  const result = scoreOnce(persistence, created.session_id, 1, committed.artifact.digest, 9);
  assert.equal(result.verdict, 'FINAL');
  return { session_id: created.session_id, artifact_digest: committed.artifact.digest };
}

const CONTENT = '# 設計書\n実装は一部だけ動作することを目視で確認したという記録がある。';
const EXCERPT = '実装は一部だけ動作することを目視で確認したという記録がある。';

function commit(persistence, sessionId, expectedRound) {
  return artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      content: CONTENT,
      change_note: 'これは20文字以上ある変更理由の説明文です',
      ...(expectedRound > 1 ? { addresses: ['impl_works'] } : {}),
    },
    persistence,
  });
}

function scoreOnce(persistence, sessionId, expectedRound, digest, scoreValue) {
  return scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      artifact_digest: digest,
      scores: [
        {
          criterion_id: 'impl_works',
          score: scoreValue,
          rationale: 'a'.repeat(45),
          weakness: scoreValue === 10 ? 'none' : 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }],
        },
      ],
    },
    persistence,
  });
}

test('改善量が0.24の周は停滞としてカウントされ、0.25の周はカウントされない', () => {
  assert.equal(nextRoundsWithoutImprovement(0.24, 0.25, 0), 1);
  assert.equal(nextRoundsWithoutImprovement(0.25, 0.25, 0), 0);
});

test('decideStallVerdict は max_rounds 到達を stall_window 到達より優先する', () => {
  const result = decideStallVerdict({ round: 5, maxRounds: 5, roundsWithoutImprovement: 5, stallWindow: 3 });
  assert.equal(result.verdict, 'STALLED');
  assert.equal(result.verdict_reason, 'max_rounds_reached');
});

test('design モードで改善のない周が3周連続すると verdict:STALLED, verdict_reason:no_improvement になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, 'design', { stall_window: 3, stall_epsilon: 0.25, max_rounds: 50 });

  let round = 1;
  let result;
  for (let i = 0; i < 4; i += 1) {
    const committed = commit(persistence, created.session_id, round);
    result = scoreOnce(persistence, created.session_id, round, committed.artifact.digest, 5);
    if (result.verdict !== 'ITERATING') break;
    round = result.round;
  }
  assert.equal(result.verdict, 'STALLED');
  assert.equal(result.verdict_reason, 'no_improvement');
});

test('plan モードでは改善のない周が2周連続すると STALLED になる', () => {
  const persistence = durablePersistence();
  const upstream = createFinalUpstream(persistence);
  const created = createSession(persistence, 'plan', { stall_window: 2, stall_epsilon: 0.25, max_rounds: 10 }, upstream);

  let round = 1;
  let result;
  for (let i = 0; i < 4; i += 1) {
    const committed = commit(persistence, created.session_id, round);
    result = scoreOnce(persistence, created.session_id, round, committed.artifact.digest, 5);
    if (result.verdict !== 'ITERATING') break;
    round = result.round;
  }
  assert.equal(result.verdict, 'STALLED');
  assert.equal(result.verdict_reason, 'no_improvement');
});

test('round が max_rounds に達すると verdict:STALLED, verdict_reason:max_rounds_reached になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, 'design', { max_rounds: 2 });

  const committed1 = commit(persistence, created.session_id, 1);
  const round1 = scoreOnce(persistence, created.session_id, 1, committed1.artifact.digest, 5);
  assert.equal(round1.verdict, 'ITERATING');
  assert.equal(round1.round, 2);

  const committed2 = commit(persistence, created.session_id, 2);
  const round2 = scoreOnce(persistence, created.session_id, 2, committed2.artifact.digest, 5);
  assert.equal(round2.verdict, 'STALLED');
  assert.equal(round2.verdict_reason, 'max_rounds_reached');
});

test('STALLED では artifact_commit / score_submit / rubric_amend が E_STATE_VIOLATION で拒否され escalate だけが通る', () => {
  assert.throws(() => checkStateTransition('STALLED', 'artifact_commit'), { code: 'E_STATE_VIOLATION' });
  assert.throws(() => checkStateTransition('STALLED', 'score_submit'), { code: 'E_STATE_VIOLATION' });
  assert.throws(() => checkStateTransition('STALLED', 'rubric_amend'), { code: 'E_STATE_VIOLATION' });
  assert.doesNotThrow(() => checkStateTransition('STALLED', 'escalate', { action: 'request_human' }));
  assert.doesNotThrow(() => checkStateTransition('STALLED', 'escalate', { action: 'abort' }));
});
