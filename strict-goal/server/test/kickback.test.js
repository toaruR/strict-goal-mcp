import { approvalFields } from './helpers/chat-approval.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { escalate } from '../src/tools/escalate.js';
import { loopOpenResume } from '../src/tools/loop_open_resume.js';
import { auditExport } from '../src/tools/audit_export.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-kickback-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-kbk-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'a'.repeat(45);
const HUMAN_TOKEN = 'human-approval-token-placeholder';
const DESIGN_CONTENT = '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。';
const DESIGN_EXCERPT = '実装は完全に動作することを実行ログで確認したという記録がある。';
const PLAN_CONTENT = JSON.stringify({
  plan_version: 1,
  summary: 'これはテスト用の有効な計画サマリー文字列であり、長さが40文字以上になるように長めに記述しています。',
  tasks: [
    {
      id: 'T001',
      title: 'タスク1のタイトル',
      intent: 'タスク1の意図を20文字以上で記述するための文字列です',
      depends_on: [],
      design_refs: ['# 設計'],
      changes: [{ path: 'src/a.js', kind: 'add' }],
      acceptance: ['受け入れ条件1が10文字以上'],
      verify: [{ command: 'node --test', expect_exit_code: 0 }],
    },
  ],
});

function oneCriterionRubric() {
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
    policy: {},
  };
}

function planRubric() {
  return {
    criteria: [
      {
        id: 'plan_local',
        statement: '計画自身の記述だけで完結する根拠の確認',
        weight: 1,
        verification: 'manual',
        anchors: { 1: '根拠が全くない', 5: '一部だけ根拠がある', 9: '十分な根拠がある' },
      },
    ],
    policy: {},
  };
}

function createDesign(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: oneCriterionRubric(),
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
      rubric: planRubric(),
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
      ...(round >= 2 ? { addresses: ['impl_works'] } : {}),
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
          criterion_id: 'impl_works',
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
}

function readSessionRaw(persistence, sessionId) {
  return JSON.parse(readFileSync(path.join(persistence.dir, 'sessions', sessionId, 'session.json'), 'utf8'));
}

function readChainRaw(persistence, chainId) {
  return JSON.parse(readFileSync(path.join(persistence.dir, 'chains', chainId, 'chain.json'), 'utf8'));
}

function buildFinalChain(persistence) {
  const design = createDesign(persistence);
  finalizeDesign(persistence, design.session_id, 1);
  const designDigest = readSessionRaw(persistence, design.session_id).current_artifact.digest;
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  finalizePlan(persistence, plan.session_id);
  return { design, plan };
}

function kickback(persistence, sessionId, targetCriteria = ['impl_works']) {
  return escalate({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      action: 'kickback',
      ...approvalFields(persistence, sessionId, { action: 'kickback', targetCriteria: targetCriteria, note: NOTE }),
      target_criteria: targetCriteria,
      note: NOTE,
    },
    persistence,
  });
}

function requestChatKickback(persistence, sessionId) {
  return escalate({ input: {
    session_id: sessionId, submission_id: submissionId(), action: 'request_human',
    approval_channel: 'chat', target_criteria: ['impl_works'], note: NOTE,
  }, persistence, meta: { clientCapabilities: { elicitation: true } } });
}

function chatKickbackInput(sessionId, escalationId) {
  return { session_id: sessionId, submission_id: submissionId(), action: 'kickback',
    escalation_id: escalationId, human_reply: '上流へ差し戻して修正してください',
    target_criteria: ['impl_works'], note: NOTE };
}

function readApproval(persistence, sessionId, escalationId) {
  return JSON.parse(readFileSync(path.join(persistence.dir, 'sessions', sessionId, 'escalations', `${escalationId}.json`), 'utf8'));
}

for (const initialState of ['DRAFTING', 'FINAL', 'FINAL_WITH_RELAXATION']) {
  test(`${initialState}から差し戻し用チャット承認を作成し、返答後のみ上流を再開・下流を凍結する`, () => {
    const persistence = durablePersistence();
    const design = createDesign(persistence);
    finalizeDesign(persistence, design.session_id, 1);
    const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: readSessionRaw(persistence, design.session_id).current_artifact.digest });
    if (initialState === 'FINAL') finalizePlan(persistence, plan.session_id);
    if (initialState === 'FINAL_WITH_RELAXATION') {
      const accepted = escalate({ input: { session_id: plan.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE }, persistence });
      escalate({ input: { session_id: plan.session_id, submission_id: submissionId(), action: 'resolve', resolution: 'accept_as_is', escalation_id: accepted.escalation.escalation_id, human_reply: 'この状態で受け入れます', note: NOTE }, persistence });
    }
    assert.equal(readSessionRaw(persistence, plan.session_id).state, initialState);
    const pending = requestChatKickback(persistence, plan.session_id);
    assert.equal(pending.state, 'ESCALATED');
    assert.equal(pending.escalation.channel, 'chat');
    assert.equal(pending.next_action.input_skeleton.action, 'kickback');
    assert.deepEqual(pending.next_action.input_skeleton.target_criteria, ['impl_works']);
    assert.equal(pending.next_action.input_skeleton.escalation_id, pending.escalation.escalation_id);
    const dir = path.join(persistence.dir, 'sessions', plan.session_id, 'escalations');
    assert.equal(readdirSync(dir).some(name => name.endsWith('.token')), false);
    assert.equal(readSessionRaw(persistence, design.session_id).state, 'FINAL');
    assert.equal(readChainRaw(persistence, design.chain_id).kickbacks.length, 0);
    assert.deepEqual(loopState({ input: { session_id: plan.session_id, projection: 'skill_state' }, persistence }).next_action, pending.next_action);
    assert.deepEqual(loopOpenResume({ input: { mode: 'resume', session_id: plan.session_id, submission_id: submissionId() }, persistence }).next_action, pending.next_action);

    const input = chatKickbackInput(plan.session_id, pending.escalation.escalation_id);
    const result = escalate({ input, persistence });
    assert.equal(result.state, 'FROZEN');
    assert.equal(result.escalation.escalation_id, input.escalation_id);
    assert.equal(readSessionRaw(persistence, design.session_id).state, 'DRAFTING');
    assert.equal(readSessionRaw(persistence, design.session_id).round, 2);
    assert.deepEqual(readSessionRaw(persistence, design.session_id).last_evaluation.must_fix.map(m => m.criterion_id), ['impl_works']);
    assert.equal(readChainRaw(persistence, design.chain_id).kickbacks.length, 1);
    const approval = readApproval(persistence, plan.session_id, input.escalation_id);
    assert.equal(approval.consumed, true);
    assert.equal(approval.resolution, 'kickback');
    assert.equal(approval.human_reply, input.human_reply);
    const audit = auditExport({ input: { session_id: plan.session_id, scope: 'session', include_artifacts: false, include_rejected: false, include_diffs: false }, persistence });
    const exported = JSON.parse(readFileSync(audit.export.path, 'utf8'));
    assert.ok(exported.escalations.some(e => e.escalation_id === input.escalation_id && e.human_reply === input.human_reply && e.resolution === 'kickback'));
    assert.throws(() => escalate({ input: { ...input, submission_id: submissionId() }, persistence }));
    assert.equal(readChainRaw(persistence, design.chain_id).kickbacks.length, 1);
  });
}

test('kickbackの返答・ID・対象基準が不正な場合は確認を消費せず上流を変更しない', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);
  const pending = requestChatKickback(persistence, plan.session_id);
  const base = chatKickbackInput(plan.session_id, pending.escalation.escalation_id);
  for (const patch of [{ human_reply: undefined }, { human_reply: '   ' }, { escalation_id: undefined }, { target_criteria: undefined }, { human_token: HUMAN_TOKEN }]) {
    assert.throws(() => escalate({ input: { ...base, ...patch, submission_id: submissionId() }, persistence }), { code: 'E_VALIDATION' });
  }
  for (const patch of [{ escalation_id: 'esc_99' }, { target_criteria: ['other_criterion'] }]) {
    assert.throws(() => escalate({ input: { ...base, ...patch, submission_id: submissionId() }, persistence }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
  }
  assert.throws(() => escalate({ input: { ...base, action: 'resolve', resolution: 'continue', submission_id: submissionId() }, persistence }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
  assert.equal(readApproval(persistence, plan.session_id, base.escalation_id).consumed, false);
  assert.equal(readSessionRaw(persistence, plan.session_id).state, 'ESCALATED');
  assert.equal(readSessionRaw(persistence, design.session_id).state, 'FINAL');
  assert.equal(readChainRaw(persistence, design.chain_id).kickbacks.length, 0);
});

test('通常のrequest_humanで作成したチャット確認でもkickbackの返答を記録できる', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  finalizeDesign(persistence, design.session_id, 1);
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: readSessionRaw(persistence, design.session_id).current_artifact.digest });
  const pending = escalate({ input: { session_id: plan.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE }, persistence });
  const result = escalate({ input: chatKickbackInput(plan.session_id, pending.escalation.escalation_id), persistence });
  assert.equal(result.state, 'FROZEN');
});

test('承認後に差し戻し予算が尽きた場合は確認を消費しない', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);
  const pending = requestChatKickback(persistence, plan.session_id);
  const chain = readChainRaw(persistence, design.chain_id);
  chain.policy.chain_max_kickbacks = 0;
  writeFileSync(path.join(persistence.dir, 'chains', design.chain_id, 'chain.json'), JSON.stringify(chain));
  assert.throws(() => escalate({ input: chatKickbackInput(plan.session_id, pending.escalation.escalation_id), persistence }), { code: 'E_CHAIN_BUDGET_EXHAUSTED' });
  assert.equal(readApproval(persistence, plan.session_id, pending.escalation.escalation_id).consumed, false);
  assert.equal(readSessionRaw(persistence, design.session_id).state, 'FINAL');
});

test('FINALでは通常の承認要求を拒否し、対象基準のある差し戻し要求のみ許可する', () => {
  const persistence = durablePersistence();
  const { plan } = buildFinalChain(persistence);
  assert.throws(() => escalate({ input: { session_id: plan.session_id, submission_id: submissionId(), action: 'request_human', note: NOTE }, persistence }), { code: 'E_STATE_VIOLATION' });
  assert.equal(readSessionRaw(persistence, plan.session_id).state, 'FINAL');
});

test('上流のないFINALでは差し戻し確認を作成せず、再開用の確認IDを差し戻しに流用できない', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  finalizeDesign(persistence, design.session_id, 1);
  assert.throws(() => requestChatKickback(persistence, design.session_id), { code: 'E_UPSTREAM_NOT_FOUND' });
  assert.equal(readSessionRaw(persistence, design.session_id).state, 'FINAL');
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: readSessionRaw(persistence, design.session_id).current_artifact.digest });
  finalizePlan(persistence, plan.session_id);
  const legacy = escalate({ input: { session_id: plan.session_id, submission_id: submissionId(), action: 'request_human', approval_action: 'reopen', note: NOTE }, persistence });
  assert.throws(() => escalate({ input: chatKickbackInput(plan.session_id, legacy.escalation.escalation_id), persistence }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
  assert.equal(readApproval(persistence, plan.session_id, legacy.escalation.escalation_id).consumed, false);
  assert.equal(readSessionRaw(persistence, design.session_id).state, 'FINAL');
});

test('再開後の新しい差し戻し確認に、消費済みの確認IDを使用できない', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);
  const first = requestChatKickback(persistence, plan.session_id);
  escalate({ input: chatKickbackInput(plan.session_id, first.escalation.escalation_id), persistence });
  const newDigest = finalizeDesign(persistence, design.session_id, 2);
  escalate({ input: { session_id: plan.session_id, submission_id: submissionId(), action: 'rebase', upstream_digest: newDigest, note: NOTE }, persistence });
  const second = requestChatKickback(persistence, plan.session_id);
  assert.throws(() => escalate({ input: chatKickbackInput(plan.session_id, first.escalation.escalation_id), persistence }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
  assert.equal(readApproval(persistence, plan.session_id, second.escalation.escalation_id).consumed, false);
  assert.equal(readSessionRaw(persistence, design.session_id).state, 'FINAL');
  assert.equal(readChainRaw(persistence, design.chain_id).kickbacks.length, 1);
});

test('差し戻し確認を中止した場合は上流を変更しない', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);
  const pending = requestChatKickback(persistence, plan.session_id);
  const result = escalate({ input: {
    session_id: plan.session_id, submission_id: submissionId(), action: 'resolve', resolution: 'abort',
    escalation_id: pending.escalation.escalation_id, human_reply: '差し戻さずこのセッションを終了して', note: NOTE,
  }, persistence });
  assert.equal(result.state, 'ABORTED');
  assert.equal(readSessionRaw(persistence, design.session_id).state, 'FINAL');
  assert.equal(readChainRaw(persistence, design.chain_id).kickbacks.length, 0);
});

test('kickback すると上流が DRAFTING に再開し、下流は FROZEN になり chain.json に記録される', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);

  const result = kickback(persistence, plan.session_id);
  assert.equal(result.state, 'FROZEN');

  const designAfter = readSessionRaw(persistence, design.session_id);
  assert.equal(designAfter.state, 'DRAFTING');
  assert.equal(designAfter.round, 2);
  assert.equal(designAfter.reopened.length, 1);
  assert.equal(designAfter.reopened[0].from_session, plan.session_id);
  assert.deepEqual(
    designAfter.last_evaluation.must_fix.map((m) => m.criterion_id),
    ['impl_works'],
  );

  const chain = readChainRaw(persistence, design.chain_id);
  assert.equal(chain.kickbacks.length, 1);
  assert.equal(chain.kickbacks[0].from, plan.session_id);
  assert.equal(chain.kickbacks[0].to, design.session_id);
  assert.deepEqual(chain.kickbacks[0].target_criteria, ['impl_works']);
});

test('FROZEN 下では artifact_commit/score_submit/rubric_amend が E_FROZEN になり、escalate(abort) だけ通る', () => {
  const persistence = durablePersistence();
  const { plan } = buildFinalChain(persistence);
  kickback(persistence, plan.session_id);

  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: plan.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          content: PLAN_CONTENT,
          change_note: 'これは20文字以上ある変更理由の説明文です',
        },
        persistence,
      }),
    { code: 'E_FROZEN' },
  );

  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: plan.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          artifact_digest: readSessionRaw(persistence, plan.session_id).current_artifact.digest,
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
      }),
    { code: 'E_FROZEN' },
  );

  const aborted = escalate({
    input: { session_id: plan.session_id, submission_id: submissionId(), action: 'abort', note: NOTE },
    persistence,
  });
  assert.equal(aborted.state, 'ABORTED');
});

test('上流が再び FINAL になれば下流は FROZEN から SUPERSEDED を経て rebase できる', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);
  kickback(persistence, plan.session_id);

  const newDesignDigest = finalizeDesign(persistence, design.session_id, 2);

  const state = loopState({ input: { session_id: plan.session_id }, persistence });
  assert.equal(state.state, 'SUPERSEDED');

  const rebased = escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'rebase',
      upstream_digest: newDesignDigest,
      note: NOTE,
    },
    persistence,
  });
  assert.equal(rebased.state, 'DRAFTING');
});

test('kickback が chain_max_kickbacks を超えると E_CHAIN_BUDGET_EXHAUSTED になる', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);

  for (let i = 0; i < 2; i += 1) {
    kickback(persistence, plan.session_id);
    finalizeDesign(persistence, design.session_id, i + 2);
    loopState({ input: { session_id: plan.session_id }, persistence });
    escalate({
      input: {
        session_id: plan.session_id,
        submission_id: submissionId(),
        action: 'rebase',
        upstream_digest: readSessionRaw(persistence, design.session_id).current_artifact.digest,
        note: NOTE,
      },
      persistence,
    });
    finalizePlan(persistence, plan.session_id);
  }

  assert.throws(() => kickback(persistence, plan.session_id), { code: 'E_CHAIN_BUDGET_EXHAUSTED' });
});
