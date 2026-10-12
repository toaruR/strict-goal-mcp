import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { rubricAmend } from '../src/tools/rubric_amend.js';
import { escalate } from '../src/tools/escalate.js';
import { createApproval, consumeApproval } from '../src/escalation/approval.js';
import { loopState } from '../src/tools/loop_state.js';
import { loopOpenResume } from '../src/tools/loop_open_resume.js';
import { handleToolsCall } from '../src/mcp/tools_call.js';
import { validate } from '../src/schema/validate.js';
import { TOOL_SCHEMAS } from '../src/schema/tools_schema.js';
import { readChain } from '../src/chain/store.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-escalate-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
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



function requestChatApproval(persistence, sessionId) {
  return escalate({ input: { session_id: sessionId, submission_id: submissionId(), action: 'request_human', note: NOTE }, persistence });
}

test('STALLEDのMCP呼出しはチャット承認待ちになり、再取得・resumeでも確認IDと待機指示を返す', () => {
  const persistence = durablePersistence();
  const created = driveToStalled(persistence);
  const response = handleToolsCall({ name: 'escalate', arguments: {
    session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE,
  } }, { persistence });
  assert.notEqual(response.isError, true);
  const pending = response.structuredContent;
  validate(TOOL_SCHEMAS.escalate.output.properties.escalation, pending.escalation);
  assert.equal(pending.state, 'ESCALATED');
  assert.equal(pending.escalation.channel, 'chat');
  assert.equal(pending.escalation.token_path, undefined);
  assert.deepEqual(pending.warnings, []);
  const dir = path.join(persistence.dir, 'sessions', created.session_id, 'escalations');
  assert.equal(readdirSync(dir).some(name => name.endsWith('.token')), false);
  assert.equal(pending.next_action.input_skeleton.escalation_id, pending.escalation.escalation_id);
  assert.match(pending.next_action.instruction, /Wait for an explicit user reply/);
  const state = loopState({ input: { session_id: created.session_id, projection: 'skill_state' }, persistence });
  assert.deepEqual(state.next_action, pending.next_action);
  assert.deepEqual(state.skill_state.recent_observation.details.next_action, pending.next_action);
  const resumed = loopOpenResume({ input: { mode: 'resume', session_id: created.session_id, submission_id: submissionId() }, persistence });
  assert.deepEqual(resumed.next_action, pending.next_action);
  assert.equal(readSessionRaw(persistence, created.session_id).state, 'ESCALATED');
});

for (const [resolution, expectedState] of [['continue', 'DRAFTING'], ['accept_as_is', 'FINAL_WITH_RELAXATION'], ['relax_rubric', 'SCORING'], ['abort', 'ABORTED']]) {
  test(`チャット返答を記録して${resolution}を反映し、同じ確認を再利用できない`, () => {
    const persistence = durablePersistence();
    const created = driveToStalled(persistence);
    const pending = requestChatApproval(persistence, created.session_id);
    const input = {
      session_id: created.session_id, submission_id: submissionId(), action: 'resolve',
      escalation_id: pending.escalation.escalation_id, resolution, human_reply: 'この選択で進めてください', note: NOTE,
    };
    const result = escalate({ input, persistence });
    validate(TOOL_SCHEMAS.escalate.output.properties.escalation, result.escalation);
    assert.equal(result.state, expectedState);
    const record = JSON.parse(readFileSync(path.join(persistence.dir, 'sessions', created.session_id, 'escalations', `${input.escalation_id}.json`), 'utf8'));
    assert.equal(record.human_reply, input.human_reply);
    assert.equal(record.resolution, resolution);
    assert.equal(record.consumed, true);
    assert.ok(record.consumed_at);
    if (resolution === 'continue') {
      const nextPending = requestChatApproval(persistence, created.session_id);
      assert.notEqual(nextPending.escalation.escalation_id, input.escalation_id);
      assert.throws(() => escalate({ input: { ...input, submission_id: submissionId() }, persistence }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
      assert.equal(readSessionRaw(persistence, created.session_id).state, 'ESCALATED');
    } else {
      assert.throws(() => escalate({ input: { ...input, submission_id: submissionId() }, persistence }));
    }
  });
}

test('返答なし・空白・確認IDなし・別確認ID・トークンとの混在は承認として扱わない', () => {
  const persistence = durablePersistence();
  const created = driveToStalled(persistence);
  const pending = requestChatApproval(persistence, created.session_id);
  const base = { session_id: created.session_id, action: 'resolve', resolution: 'continue', escalation_id: pending.escalation.escalation_id, human_reply: '続けて', note: NOTE };
  for (const patch of [{ human_reply: undefined }, { human_reply: '   ' }, { escalation_id: undefined }, { human_token: 'x'.repeat(24) }]) {
    assert.throws(() => escalate({ input: { ...base, ...patch, submission_id: submissionId() }, persistence }), { code: 'E_VALIDATION' });
  }
  assert.throws(() => escalate({ input: { ...base, escalation_id: 'esc_99', submission_id: submissionId() }, persistence }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
  assert.equal(readSessionRaw(persistence, created.session_id).state, 'ESCALATED');
  const record = JSON.parse(readFileSync(path.join(persistence.dir, 'sessions', created.session_id, 'escalations', `${base.escalation_id}.json`), 'utf8'));
  assert.equal(record.consumed, false);
});

test('STALLED の承認要求は確認IDのみを作成する', () => {
  const persistence = durablePersistence();
  const created = driveToStalled(persistence);

  const result = escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', approval_channel: 'chat', note: NOTE },
    persistence,
  });

  assert.equal(result.state, 'ESCALATED');
  assert.equal(result.escalation.escalation_id, 'esc_01');
  assert.equal(result.escalation.channel, 'chat');
  assert.equal(result.escalation.token_path, undefined);



});

test('誤った確認IDでは停止を維持し、正しいIDと返答による続行で停滞カウンタを初期化し3周延長する', () => {
  const persistence = durablePersistence();
  const created = driveToStalled(persistence);
  escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', approval_channel: 'chat', note: NOTE },
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
          escalation_id: 'esc_99', human_reply: '続けて',
          note: NOTE,
        },
        persistence,
      }),
    { code: 'E_RESOLUTION_NOT_APPLICABLE' },
  );
  assert.equal(readSessionRaw(persistence, created.session_id).state, 'ESCALATED');


  const resolved = escalate({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      action: 'resolve',
      resolution: 'continue',
      escalation_id: 'esc_01', human_reply: 'この操作を承認します',
      note: NOTE,
    },
    persistence,
  });
  assert.equal(resolved.state, 'DRAFTING');

  const sessionAfter = readSessionRaw(persistence, created.session_id);
  assert.equal(sessionAfter.counters.rounds_without_improvement, 0);
  assert.equal(sessionAfter.counters.extra_rounds_granted, 3);

  // max_rounds は2だったが +3 されたので、次の周で再度ITERATINGになり即STALLEDには戻らない。
  const nextR = sessionAfter.round;
  const c2 = commit(persistence, created.session_id, nextR);
  const r2 = scoreOnce(persistence, created.session_id, nextR, c2.artifact.digest, [{ criterionId: 'impl_works', score: 5 }]);
  assert.equal(r2.verdict, 'ITERATING');
});

test('同じ承認IDを再利用すると拒否される', () => {
 const persistence = durablePersistence();
 const created = createSession(persistence, oneCriterionRubric());
 const sDir = path.join(persistence.dir, 'sessions', created.session_id);
 const { escalationId } = createApproval(sDir, { reason: 'manual_request' });
 assert.equal(consumeApproval(sDir, escalationId, { resolution: 'continue', humanReply: '続けて' }).consumed, true);
 assert.throws(() => consumeApproval(sDir, escalationId, { resolution: 'continue', humanReply: '続けて' }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
});

test('resolve/accept_as_is で ESCALATED から FINAL_WITH_RELAXATION になり監査フラグが残る', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, oneCriterionRubric());

  const escalated = escalate({
    input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', approval_channel: 'chat', note: NOTE },
    persistence,
  });
  assert.equal(escalated.state, 'ESCALATED');


  const resolved = escalate({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      action: 'resolve',
      resolution: 'accept_as_is',
      escalation_id: 'esc_01', human_reply: 'この操作を承認します',
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


  const resolved = escalate({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      action: 'resolve',
      resolution: 'relax_rubric',
      escalation_id: 'esc_01', human_reply: 'この操作を承認します',
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
          escalation_id: 'esc_00', human_reply: '続けて',
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

test('旧形式の保留確認も秘密ファイルに触れずチャットで解決し監査を正規化する', () => {
 const persistence = durablePersistence();
 const created = driveToStalled(persistence);
 const pending = requestChatApproval(persistence, created.session_id);
 const sDir = path.join(persistence.dir, 'sessions', created.session_id, 'escalations');
 const recordPath = path.join(sDir, 'esc_01.json');
 const record = JSON.parse(readFileSync(recordPath, 'utf8'));
 writeFileSync(recordPath, JSON.stringify({ ...record, channel: 'token_file', token_read_at: null, token: 'historical-secret' }));
 const companion = path.join(sDir, 'esc_01.token');
 writeFileSync(companion, 'historical-secret');
 const resumed = loopState({ input: { session_id: created.session_id, projection: 'skill_state' }, persistence });
 assert.equal(resumed.next_action.input_skeleton.escalation_id, 'esc_01');
  assert.deepEqual(resumed.skill_state.recent_observation.details.next_action, resumed.next_action);
 assert.equal(resumed.next_action.input_skeleton.action, 'resolve');
 assert.ok(!JSON.stringify(resumed).includes('historical-secret'));
 const result = escalate({ input: { session_id: created.session_id, submission_id: submissionId(), action: 'resolve', resolution: 'continue', escalation_id: 'esc_01', human_reply: '計画の続行を承認します', note: NOTE }, persistence });
 assert.equal(result.state, 'DRAFTING');
 const normalized = JSON.parse(readFileSync(recordPath, 'utf8'));
 assert.equal(normalized.channel, 'chat');
 assert.equal(normalized.human_reply, '計画の続行を承認します');
 assert.equal(normalized.token_read_at, undefined);
 assert.equal(normalized.token, undefined);
 assert.equal(readFileSync(companion, 'utf8'), 'historical-secret');
});

test('廃止された承認方式を指定しても承認ファイルを生成しない', () => {
 const persistence = durablePersistence();
 const created = driveToStalled(persistence);
 assert.throws(() => escalate({ input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', approval_channel: 'token_file', note: NOTE }, persistence }), { code: 'E_VALIDATION' });
 assert.equal(readSessionRaw(persistence, created.session_id).state, 'STALLED');
});

test('reopenもチャットで確認し、目的・返答・成果物を検査して一度だけ再開する', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, oneCriterionRubric());
  const committed = commit(persistence, created.session_id, 1);
  assert.equal(scoreOnce(persistence, created.session_id, 1, committed.artifact.digest, [{ criterionId: 'impl_works', score: 9 }]).verdict, 'FINAL');
  assert.throws(() => escalate({ input: { session_id: created.session_id, submission_id: submissionId(), action: 'reopen', escalation_id: 'esc_01', human_reply: '再開して', note: NOTE }, persistence }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
  const pending = escalate({ input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', approval_action: 'reopen', note: NOTE }, persistence });
  assert.equal(pending.next_action.input_skeleton.action, 'reopen');
  assert.equal(pending.escalation.channel, 'chat');
  const resumed = loopOpenResume({ input: { mode: 'resume', session_id: created.session_id, submission_id: submissionId() }, persistence });
  assert.deepEqual(resumed.next_action, pending.next_action);
  const input = { session_id: created.session_id, action: 'reopen', escalation_id: pending.escalation.escalation_id, human_reply: 'この確定成果物の再開を承認します', note: NOTE };
  for (const patch of [{ human_reply: '   ' }, { escalation_id: undefined }, { human_token: 'removed-approval-field' }]) {
    assert.throws(() => escalate({ input: { ...input, ...patch, submission_id: submissionId() }, persistence }), { code: 'E_VALIDATION' });
  }
  assert.throws(() => escalate({ input: { ...input, action: 'resolve', resolution: 'continue', submission_id: submissionId() }, persistence }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
  const result = escalate({ input: { ...input, submission_id: submissionId() }, persistence });
  assert.equal(result.state, 'DRAFTING');
  assert.equal(result.round, 2);
  assert.equal(result.reopened[0].previous_final_digest, committed.artifact.digest);
  const record = JSON.parse(readFileSync(path.join(persistence.dir, 'sessions', created.session_id, 'escalations', 'esc_01.json'), 'utf8'));
  assert.equal(record.resolution, 'reopen');
  assert.equal(record.human_reply, input.human_reply);
  assert.equal(record.consumed, true);
  assert.throws(() => escalate({ input: { ...input, submission_id: submissionId() }, persistence }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
});

test('承認経路の違うMRTR返答は確認を消費せず、チャット返答なら解決できる', () => {
  const persistence = durablePersistence();
  const created = driveToStalled(persistence);
  const pending = requestChatApproval(persistence, created.session_id);
  assert.throws(() => escalate({ input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE }, persistence,
    meta: { clientCapabilities: { elicitation: true }, requestState: { escalation_id: pending.escalation.escalation_id }, inputResponses: [{ resolution: 'continue' }] },
  }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
  assert.equal(readSessionRaw(persistence, created.session_id).state, 'ESCALATED');
  const result = escalate({ input: { session_id: created.session_id, submission_id: submissionId(), action: 'resolve', resolution: 'continue', escalation_id: pending.escalation.escalation_id, human_reply: '続行を承認します', note: NOTE }, persistence });
  assert.equal(result.state, 'DRAFTING');
});

test('MRTRの新しい続行承認ごとにチェーン予算を累積し、再送では二重加算しない', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, oneCriterionRubric());
  let previousEscalationId;
  for (const [index, round] of [28, 34, 40].entries()) {
    const session = readSessionRaw(persistence, created.session_id);
    session.round = round;
    writeFileSync(sessionJsonPath(persistence, created.session_id), JSON.stringify(session, null, 2));
    const pending = escalate({
      input: { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE },
      persistence,
      meta: { clientCapabilities: { elicitation: true } },
    });
    assert.equal(pending.resultType, 'input_required');
    const input = { session_id: created.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE };
    const meta = {
      clientCapabilities: { elicitation: true },
      requestState: pending.requestState,
      inputResponses: [{ resolution: 'continue', note: '追加予算による続行を承認します' }],
    };
    if (previousEscalationId) {
      assert.throws(() => escalate({
        input: { ...input, submission_id: submissionId() },
        persistence,
        meta: { ...meta, requestState: { escalation_id: previousEscalationId } },
      }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
    }
    const resolved = escalate({ input, persistence, meta });
    assert.equal(resolved.state, 'DRAFTING');
    assert.equal(resolved.round, round + 1);
    assert.equal(resolved.chain.limit, 28 + 6 * (index + 1));
    assert.equal(resolved.chain.granted_extra_rounds, 6 * (index + 1));
    assert.deepEqual(escalate({ input, persistence, meta }), resolved);
    assert.equal(readSessionRaw(persistence, created.session_id).counters.extra_rounds_granted, 3 * (index + 1));
    const chain = readChain(persistence.dir, readSessionRaw(persistence, created.session_id).chain_id);
    assert.equal(chain.granted_extra_rounds, 6 * (index + 1));
    assert.equal(chain.events.filter((event) => event.type === 'extra_rounds_granted').length, index + 1);
    previousEscalationId = pending.requestState.escalation_id;
  }
});
