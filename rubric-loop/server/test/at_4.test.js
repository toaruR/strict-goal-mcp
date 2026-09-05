// AT-4: 停滞打ち切り。docs/design-rubric-loop-mcp.md §13 AT-4。
// 設計書は改善量が epsilon 未満に細かく減衰する例(8.10→8.20→8.28→8.35)を挙げるが、
// スコアは整数のみ許可されるため本テストは改善量0が3周連続する単純化版で代替する
// （stall_window/epsilon の判定ロジック自体は stall.test.js で単体検証済み）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { escalate } from '../src/tools/escalate.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at4-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at4-${submissionCounter}`.padEnd(8, '0');
}

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
      label: 'rubric-loop-at4',
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: { criteria: [CRITERION], policy: { stall_window: 3, stall_epsilon: 0.25, max_rounds: 50 } },
    },
    persistence,
  });
}

const NOTE = 'a'.repeat(45);
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

function readEscalationToken(persistence, sessionId, escalationId) {
  const tokenFile = path.join(persistence.dir, 'sessions', sessionId, 'escalations', `${escalationId}.token`);
  return readFileSync(tokenFile, 'utf8').trim();
}

function readSessionRaw(persistence, sessionId) {
  return JSON.parse(readFileSync(path.join(persistence.dir, 'sessions', sessionId, 'session.json'), 'utf8'));
}

test('AT-4: 改善が続かず3周でSTALLED、STALLED中の commit は拒否、request_human→誤トークン失敗→正トークンでDRAFTING復帰', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  let round = 1;
  let result;
  for (let i = 0; i < 4; i += 1) {
    const committed = commit(persistence, created.session_id, round);
    result = scoreOnce(persistence, created.session_id, round, committed.artifact.digest);
    if (result.verdict !== 'ITERATING') break;
    round = result.round;
  }
  assert.equal(result.verdict, 'STALLED');
  assert.equal(result.verdict_reason, 'no_improvement');
  assert.equal(result.state, 'STALLED');

  // 1. STALLED 中の artifact_commit は拒否される
  assert.throws(
    () => commit(persistence, created.session_id, result.round),
    (err) => {
      assert.equal(err.code, 'E_STATE_VIOLATION');
      assert.ok(err.detail.expected_tools.includes('escalate'));
      return true;
    },
  );

  // 2. escalate(request_human) → ESCALATED、トークンはファイルのみ・応答本文には出ない
  const escalated = escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE },
    persistence,
  });
  assert.equal(escalated.state, 'ESCALATED');
  const realToken = readEscalationToken(persistence, created.session_id, escalated.escalation.escalation_id);
  assert.ok(!JSON.stringify(escalated).includes(realToken));

  // 3. 誤った human_token は E_TOKEN_INVALID、state は ESCALATED のまま
  assert.throws(
    () =>
      escalate({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          action: 'resolve',
          resolution: 'continue',
          human_token: 'wrong-token-wrong-token-wrong-token',
          note: NOTE,
        },
        persistence,
      }),
    { code: 'E_TOKEN_INVALID' },
  );

  // 4. 正しい human_token で resolve/continue → DRAFTING に戻り停滞カウンタがリセットされる
  const resolved = escalate({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      action: 'resolve',
      resolution: 'continue',
      human_token: realToken,
      note: NOTE,
    },
    persistence,
  });
  assert.equal(resolved.state, 'DRAFTING');
  const sessionAfter = readSessionRaw(persistence, created.session_id);
  assert.equal(sessionAfter.counters.rounds_without_improvement, 0);
  assert.equal(sessionAfter.counters.extra_rounds_granted, 3);
});
