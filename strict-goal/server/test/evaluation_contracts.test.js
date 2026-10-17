import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChangeReason, createCriterionEvaluation, createIssueRecord, evaluationV2Schema } from '../src/evaluation/contracts.js';

const digest = (letter) => `sha256:${letter.repeat(64)}`;
const seen = { session_id: 'rl_example', round: 1, context_digest: digest('a') };

function issue(overrides = {}) {
  return { id: 'ISS-docs_updated-0001', criterion_id: 'docs_updated', anchor_clause_ids: ['docs_updated:A2'], severity: 'blocking', state: 'open', first_seen: seen, last_evaluated: seen, locator: { path: 'README.md', line: 42 }, claim: 'The required migration section is absent.', evidence_refs: ['ev-1'], resolution_condition: 'Document the migration policy.', dependency_keys: ['artifact:README.md'], duplicate_of: null, history: [{ event: 'opened', at: '2026-10-17T00:00:00Z' }], ...overrides };
}

function evaluation(overrides = {}) {
  return { criterion_id: 'docs_updated', score: 8, anchor_status: [{ id: 'docs_updated:A2', status: 'unmet', evidence_refs: ['ev-1'] }], blocking_issue_ids: ['ISS-docs_updated-0001'], advisory_issue_ids: [], dependency_declaration: { artifact_paths: ['README.md'], upstream_contract_ids: [], scope_ids: ['scope:documentation'], rubric_clause_ids: ['docs_updated:A2'], evidence_kinds: ['command'], verification_env_keys: ['node'] }, basis: 'fresh', change_reason_ids: [], context_digest: digest('b'), ...overrides };
}

function reason(overrides = {}) {
  return { id: 'CR-artifact-0001', reason: 'artifact_change', before_digest: digest('c'), after_digest: digest('d'), diff_locator: 'README.md:42', affected_dependency_keys: ['artifact:README.md'], requested_by: 'verifier', at: '2026-10-17T00:00:00Z', condition_status: 'changed', ...overrides };
}

test('valid records preserve stable IDs, lifecycle bindings, and explicit statuses', () => {
  const stored = createIssueRecord(issue());
  assert.equal(stored.id, 'ISS-docs_updated-0001');
  assert.equal(stored.first_seen.round, 1);
  assert.equal(stored.history[0].event, 'opened');
  assert.equal(createCriterionEvaluation(evaluation({ basis: 'not_applicable', score: 9, blocking_issue_ids: [] })).basis, 'not_applicable');
  assert.equal(createChangeReason(reason()).condition_status, 'changed');
  assert.equal(evaluationV2Schema.schema_version, 'evaluation-v2');
});

test('missing bindings, oversized fields and unknown fields are rejected', () => {
  assert.throws(() => createIssueRecord(issue({ evidence_refs: [] })), { code: 'E_EVALUATION_CONTRACT' });
  assert.throws(() => createIssueRecord(issue({ unexpected: true })), { code: 'E_EVALUATION_CONTRACT' });
  assert.throws(() => createIssueRecord(issue({ claim: 'x'.repeat(8001) })), { code: 'E_EVALUATION_CONTRACT' });
  assert.throws(() => createCriterionEvaluation(evaluation({ score: 8, blocking_issue_ids: [] })), { code: 'E_EVALUATION_CONTRACT' });
});

test('change reasons are enumerable and unknown conditions cannot be silently unchanged', () => {
  assert.throws(() => createChangeReason(reason({ reason: 'unknown_change' })), { code: 'E_EVALUATION_CONTRACT' });
  assert.throws(() => createChangeReason(reason({ reason: 'scope_change', approval_record_id: undefined })), { code: 'E_EVALUATION_CONTRACT' });
  assert.equal(createChangeReason(reason({ condition_status: 'unknown' })).condition_status, 'unknown');
});
