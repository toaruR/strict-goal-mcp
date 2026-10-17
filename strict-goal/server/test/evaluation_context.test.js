import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { readSession } from '../src/store/session_store.js';
import {
  persistEvaluationContext,
  readApprovalBindings,
  recordApprovalBinding,
  validateConditionChanges,
} from '../src/evidence/evaluation_context.js';

let sequence = 0;
const digest = (letter) => `sha256:${letter.repeat(64)}`;
const submissionId = () => `context-${++sequence}`.padEnd(8, '0');
const persistence = () => ({ mode: 'durable', dir: mkdtempSync(path.join(os.tmpdir(), 'strict-goal-context-')), source: 'STRICT_GOAL_DATA', roundReductionStage: 'enforce-new-session' });
const snapshot = (overrides = {}) => ({
  artifact_digest: digest('a'),
  scope_digest: digest('b'),
  rubric_digest: digest('c'),
  environment_digest: digest('d'),
  test_selection_digest: digest('e'),
  ...overrides,
});

function createScorableSession(store) {
  const created = loopOpenCreate({ input: {
    mode: 'create', submission_id: submissionId(), loop_mode: 'design',
    task: '評価コンテキストを承認境界で保存するための十分に長いテストタスクです。',
    rubric: { criteria: [{ id: 'context_ok', statement: '評価コンテキストが保存され承認境界を守る。', weight: 1, verification: 'manual', anchors: { 1: 'poor state', 5: 'fair state', 9: 'good state' } }] },
  }, persistence: store });
  const committed = artifactCommit({ input: {
    session_id: created.session_id, submission_id: submissionId(), expected_round: 1,
    content: '評価コンテキストの提出根拠を含む十分に長い本文です。', change_note: '評価コンテキストを検証するための十分に長い変更理由です。',
  }, persistence: store });
  return { created, committed };
}

function scoreInput(created, committed, context) {
  return {
    session_id: created.session_id, submission_id: submissionId(), expected_round: 1,
    artifact_digest: committed.artifact.digest, evaluation_context: context,
    scores: [{ criterion_id: 'context_ok', score: 9, rationale: '承認済みの条件変更を品質改善から分離して記録する根拠です。'.repeat(2), weakness: '将来の再評価で追加の監査を行う必要が残る。', evidence: [{ kind: 'locator', locator: '本文', excerpt: '評価コンテキストの提出根拠を含む十分に長い本文です。' }] }],
  };
}

test('unapproved scope change returns E_SCOPE_APPROVAL_REQUIRED', () => {
  const store = persistence();
  const { created, committed } = createScorableSession(store);
  const base = snapshot({ artifact_digest: committed.artifact.digest, rubric_digest: readSession(store.dir, created.session_id).rubric_digest });
  persistEvaluationContext(store.dir, created.session_id, { context: base, invalidation: [], submission_id: 'baseline', round: 0 });
  assert.throws(() => scoreSubmit({ input: scoreInput(created, committed, { snapshot: { ...base, scope_digest: digest('f') }, condition_changes: [] }), persistence: store }), { code: 'E_SCOPE_APPROVAL_REQUIRED' });
});

test('one exact digest-bound approval marks a scope change as condition_changed without artifact improvement', () => {
  const store = persistence();
  const { created, committed } = createScorableSession(store);
  const before = snapshot({ artifact_digest: committed.artifact.digest, rubric_digest: readSession(store.dir, created.session_id).rubric_digest });
  const after = { ...before, scope_digest: digest('f') };
  persistEvaluationContext(store.dir, created.session_id, { context: before, invalidation: [], submission_id: 'baseline', round: 0 });
  recordApprovalBinding(store.dir, created.session_id, { approval_id: 'scope-approval', reason: 'scope_change', before_digest: before.scope_digest, after_digest: after.scope_digest });
  const result = scoreSubmit({ input: scoreInput(created, committed, { snapshot: after, condition_changes: [{ reason: 'scope_change', before_digest: before.scope_digest, after_digest: after.scope_digest, approval_id: 'scope-approval' }] }), persistence: store });
  assert.equal(result.evaluation.quality_delta.condition_changed, true);
  assert.equal(result.evaluation.quality_delta.artifact_improved, false);
  const bindings = readApprovalBindings(store.dir, created.session_id);
  assert.equal(bindings.at(-1).event_type, 'approval_consumed');
  assert.equal(bindings.at(-1).previous_hash, bindings.at(-2).hash);
  const context = JSON.parse(readFileSync(path.join(store.dir, 'sessions', created.session_id, 'evaluation-context.json'), 'utf8'));
  assert.equal(context.records.length, 2);
  assert.equal(context.records[1].previous_hash, context.records[0].hash);
  assert.doesNotMatch(JSON.stringify(context), /command|secret/i);
});

test('rubric, environment and test-selection approvals require a matching unexpired binding', () => {
  const store = persistence();
  for (const [reason, code] of [['rubric_change', 'E_RUBRIC_APPROVAL_REQUIRED'], ['environment_change', 'E_ENVIRONMENT_APPROVAL_REQUIRED'], ['test_selection_change', 'E_TEST_SELECTION_CHANGED']]) {
    const before = digest('1');
    const after = digest('2');
    assert.throws(() => validateConditionChanges(store.dir, 'rl_context', [{ reason, before_digest: before, after_digest: after, approval_id: `${reason}-approval` }]), { code });
    recordApprovalBinding(store.dir, 'rl_context', { approval_id: `${reason}-approval`, reason, before_digest: before, after_digest: after, expires_at: '2000-01-01T00:00:00.000Z' });
    assert.throws(() => validateConditionChanges(store.dir, 'rl_context', [{ reason, before_digest: before, after_digest: after, approval_id: `${reason}-approval` }]), { code });
    recordApprovalBinding(store.dir, 'rl_context', { approval_id: `${reason}-fresh`, reason, before_digest: before, after_digest: after });
    assert.equal(validateConditionChanges(store.dir, 'rl_context', [{ reason, before_digest: before, after_digest: after, approval_id: `${reason}-fresh` }])[0].condition_changed, true);
    assert.throws(() => validateConditionChanges(store.dir, 'rl_context', [{ reason, before_digest: before, after_digest: digest('3'), approval_id: `${reason}-fresh` }]), { code });
  }
});
