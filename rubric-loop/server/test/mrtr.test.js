import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { escalate } from '../src/tools/escalate.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-mrtr-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-mrtr-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'a'.repeat(45);
const CONTENT = '# 設計書\n実装は一部だけ動作することを目視で確認したという記録がある。';
const EXCERPT = '実装は一部だけ動作することを目視で確認したという記録がある。';

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

function createSession(persistence, rubric) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric,
    },
    persistence,
  });
}

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

function scoreOnce(persistence, sessionId, expectedRound, digest, score) {
  return scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      artifact_digest: digest,
      scores: [
        {
          criterion_id: 'impl_works',
          score,
          rationale: 'a'.repeat(45),
          weakness: score === 10 ? 'none' : 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }],
        },
      ],
    },
    persistence,
  });
}

function driveToStalled(persistence) {
  const created = createSession(persistence, oneCriterionRubric({ max_rounds: 2 }));
  const c1 = commit(persistence, created.session_id, 1);
  const r1 = scoreOnce(persistence, created.session_id, 1, c1.artifact.digest, 5);
  assert.equal(r1.verdict, 'ITERATING');
  const c2 = commit(persistence, created.session_id, 2);
  const r2 = scoreOnce(persistence, created.session_id, 2, c2.artifact.digest, 5);
  assert.equal(r2.verdict, 'STALLED');
  return created;
}

function escalationsDir(persistence, sessionId) {
  return path.join(persistence.dir, 'sessions', sessionId, 'escalations');
}

const MRTR_META = { clientCapabilities: { elicitation: true } };

test('MRTR 対応クライアントは1往復で request_human を完結でき、トークンファイルを作らない', () => {
  const persistence = durablePersistence();
  const created = driveToStalled(persistence);

  const ask = escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE },
    persistence,
    meta: MRTR_META,
  });

  assert.equal(ask.resultType, 'input_required');
  assert.equal(ask.inputRequests[0].type, 'elicitation');
  assert.ok(ask.requestState.escalation_id);

  const escId = ask.requestState.escalation_id;
  const dir = escalationsDir(persistence, created.session_id);
  assert.ok(existsSync(path.join(dir, `${escId}.json`)));
  assert.ok(!existsSync(path.join(dir, `${escId}.token`)));

  const answer = escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE },
    persistence,
    meta: {
      ...MRTR_META,
      inputResponses: [{ resolution: 'continue' }],
      requestState: { escalation_id: escId },
    },
  });

  assert.equal(answer.resultType, 'complete');
  assert.equal(answer.state, 'DRAFTING');
  assert.ok(!existsSync(path.join(dir, `${escId}.token`)));
  assert.ok(!/[0-9a-f]{48}/.test(JSON.stringify(answer)));
});

test('MRTR 非対応クライアント（meta なし）は従来の token ファイル方式に縮退し、warnings に mrtr_unavailable が入る', () => {
  const persistence = durablePersistence();
  const created = driveToStalled(persistence);

  const result = escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE },
    persistence,
  });

  assert.equal(result.state, 'ESCALATED');
  assert.ok(result.warnings.includes('mrtr_unavailable'));
  assert.ok(existsSync(result.escalation.token_path));

  const escId = result.escalation.escalation_id;
  const dir = escalationsDir(persistence, created.session_id);
  const realToken = readdirSync(dir).includes(`${escId}.token`);
  assert.ok(realToken);
  assert.ok(!JSON.stringify(result).includes(readTokenValue(dir, escId)));
});

function readTokenValue(dir, escId) {
  return readFileSync(path.join(dir, `${escId}.token`), 'utf8').trim();
}

test('clientCapabilities.elicitation が無い meta は非対応クライアントとして扱われる', () => {
  const persistence = durablePersistence();
  const created = driveToStalled(persistence);

  const result = escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE },
    persistence,
    meta: {},
  });

  assert.equal(result.state, 'ESCALATED');
  assert.ok(result.warnings.includes('mrtr_unavailable'));
});
