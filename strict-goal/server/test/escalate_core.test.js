import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { rubricAmend } from '../src/tools/rubric_amend.js';
import { escalate } from '../src/tools/escalate.js';
import { createEscalation, consumeToken } from '../src/escalation/token.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-escalate-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-esc-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'a'.repeat(45);

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

const CRITERION_A = {
  id: 'impl_works',
  statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
  weight: 2,
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

const CONTENT = '# 設計書\n実装は一部だけ動作することを目視で確認したという記録がある。';
const EXCERPT = '実装は一部だけ動作することを目視で確認したという記録がある。';
const CONTENT_V2 = `${CONTENT}\n実装は完全に動作することを実行ログで確認したという記録が新たにある。`;
const EXCERPT_V2 = '実装は完全に動作することを実行ログで確認したという記録が新たにある。';

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

function scoreOnce(persistence, sessionId, expectedRound, digest, criteriaScores) {
  return scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      artifact_digest: digest,
      scores: criteriaScores.map(({ criterionId, score }) => ({
        criterion_id: criterionId,
        score,
        rationale: 'a'.repeat(45),
        weakness: score === 10 ? 'none' : 'b'.repeat(15),
        evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }],
      })),
    },
    persistence,
  });
}

function sessionJsonPath(persistence, sessionId) {
  return path.join(persistence.dir, 'sessions', sessionId, 'session.json');
}

function readSessionRaw(persistence, sessionId) {
  return JSON.parse(readFileSync(sessionJsonPath(persistence, sessionId), 'utf8'));
}

function driveToStalled(persistence) {
  const created = createSession(persistence, oneCriterionRubric({ max_rounds: 2 }));
  const c1 = commit(persistence, created.session_id, 1);
  const r1 = scoreOnce(persistence, created.session_id, 1, c1.artifact.digest, [{ criterionId: 'impl_works', score: 5 }]);
  assert.equal(r1.verdict, 'ITERATING');
  const c2 = commit(persistence, created.session_id, 2);
  const r2 = scoreOnce(persistence, created.session_id, 2, c2.artifact.digest, [{ criterionId: 'impl_works', score: 5 }]);
  assert.equal(r2.verdict, 'STALLED');
  return created;
}

function readEscalationToken(persistence, sessionId, escalationId) {
  const tokenFile = path.join(persistence.dir, 'sessions', sessionId, 'escalations', `${escalationId}.token`);
  return readFileSync(tokenFile, 'utf8').trim();
}

test('STALLED で request_human を呼ぶと ESCALATED になり token ファイルが作られ、応答にトークン値が含まれない', () => {
  const persistence = durablePersistence();
  const created = driveToStalled(persistence);

  const result = escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE },
    persistence,
  });

  assert.equal(result.state, 'ESCALATED');
  assert.equal(result.escalation.escalation_id, 'esc_01');
  assert.ok(existsSync(result.escalation.token_path));

  const realToken = readEscalationToken(persistence, created.session_id, 'esc_01');
  assert.ok(!JSON.stringify(result).includes(realToken));
});

test('誤った human_token の resolve は E_TOKEN_INVALID になり state は ESCALATED のまま、正しい human_token の resolve/continue で DRAFTING・停滞カウンタ0・実効max_roundsが+3になる', () => {
  const persistence = durablePersistence();
  const created = driveToStalled(persistence);
  escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE },
    persistence,
  });

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
  assert.equal(readSessionRaw(persistence, created.session_id).state, 'ESCALATED');

  const realToken = readEscalationToken(persistence, created.session_id, 'esc_01');
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

  // max_rounds は2だったが +3 されたので、round=2 で再度ITERATINGになり即STALLEDには戻らない。
  const c2 = commit(persistence, created.session_id, 2);
  const r2 = scoreOnce(persistence, created.session_id, 2, c2.artifact.digest, [{ criterionId: 'impl_works', score: 5 }]);
  assert.equal(r2.verdict, 'ITERATING');
});

test('同じ human_token を再利用すると2回目は E_TOKEN_INVALID になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, oneCriterionRubric());
  const sDir = path.join(persistence.dir, 'sessions', created.session_id);

  const { tokenPath } = createEscalation(sDir, { reason: 'manual_request' });
  const token = readFileSync(tokenPath, 'utf8').trim();

  const first = consumeToken(sDir, token, { resolution: 'continue' });
  assert.equal(first.consumed, true);

  assert.throws(() => consumeToken(sDir, token, { resolution: 'continue' }), { code: 'E_TOKEN_INVALID' });
});

test('resolve/accept_as_is で ESCALATED から FINAL_WITH_RELAXATION になり監査フラグが残る', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, oneCriterionRubric());

  const escalated = escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE },
    persistence,
  });
  assert.equal(escalated.state, 'ESCALATED');
  const realToken = readEscalationToken(persistence, created.session_id, escalated.escalation.escalation_id);

  const resolved = escalate({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      action: 'resolve',
      resolution: 'accept_as_is',
      human_token: realToken,
      note: NOTE,
    },
    persistence,
  });
  assert.equal(resolved.state, 'FINAL_WITH_RELAXATION');

  const sessionAfter = readSessionRaw(persistence, created.session_id);
  assert.equal(sessionAfter.audit_flags.length, 1);
  assert.equal(sessionAfter.audit_flags[0].type, 'accepted_as_is_below_threshold');
});

test('resolve/relax_rubric の後、次の score_submit が閾値を満たせば FINAL_WITH_RELAXATION になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, { criteria: [CRITERION_A, CRITERION_B] });

  const c1 = commit(persistence, created.session_id, 1);
  const r1 = scoreOnce(persistence, created.session_id, 1, c1.artifact.digest, [
    { criterionId: 'impl_works', score: 6 },
    { criterionId: 'docs_clear', score: 6 },
  ]);
  assert.equal(r1.verdict, 'ITERATING');

  rubricAmend({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      criteria: [{ ...CRITERION_A, weight: 1 }, CRITERION_B],
      reason: 'a'.repeat(45),
      acknowledge_relaxation: true,
    },
    persistence,
  });

  const c2 = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      content: CONTENT_V2,
      change_note: 'これは20文字以上ある変更理由の説明文です',
      addresses: ['impl_works', 'docs_clear'],
    },
    persistence,
  });
  const r2 = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      artifact_digest: c2.artifact.digest,
      scores: [
        { criterion_id: 'impl_works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_V2 }] },
        { criterion_id: 'docs_clear', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_V2 }] },
      ],
    },
    persistence,
  });
  assert.equal(r2.verdict, 'ESCALATED');
  assert.equal(r2.verdict_reason, 'relaxation_pending_approval');

  const sDir = path.join(persistence.dir, 'sessions', created.session_id, 'escalations');
  const escFile = readdirSync(sDir).find((name) => name.endsWith('.json'));
  const escalationId = escFile.replace('.json', '');
  const realToken = readEscalationToken(persistence, created.session_id, escalationId);

  const resolved = escalate({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      action: 'resolve',
      resolution: 'relax_rubric',
      human_token: realToken,
      note: NOTE,
    },
    persistence,
  });
  assert.equal(resolved.state, 'SCORING');

  const r3 = scoreOnce(persistence, created.session_id, 2, c2.artifact.digest, [
    { criterionId: 'impl_works', score: 9 },
    { criterionId: 'docs_clear', score: 9 },
  ]);
  assert.equal(r3.verdict, 'FINAL_WITH_RELAXATION');
});

test('DRAFTING で resolution を渡すと E_RESOLUTION_NOT_APPLICABLE になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, oneCriterionRubric());

  assert.throws(
    () =>
      escalate({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          action: 'resolve',
          resolution: 'continue',
          human_token: 'x'.repeat(20),
          note: NOTE,
        },
        persistence,
      }),
    { code: 'E_RESOLUTION_NOT_APPLICABLE' },
  );
});

test('abort で state が ABORTED（終端）になり、以後の escalate は E_STATE_VIOLATION になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, oneCriterionRubric());

  const result = escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'abort', note: NOTE },
    persistence,
  });
  assert.equal(result.state, 'ABORTED');

  assert.throws(
    () =>
      escalate({
        input: { session_id: created.session_id, submission_id: submissionId(), action: 'abort', note: NOTE },
        persistence,
      }),
    { code: 'E_STATE_VIOLATION' },
  );
});
