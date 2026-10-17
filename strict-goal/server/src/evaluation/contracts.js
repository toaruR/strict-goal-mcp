import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validate } from '../schema/validate.js';

const schemaPath = fileURLToPath(new URL('../../schemas/evaluation-v2.json', import.meta.url));
export const evaluationV2Schema = Object.freeze(JSON.parse(fs.readFileSync(schemaPath, 'utf8')));

const CONDITION_REASONS = new Set(['scope_change', 'rubric_change', 'environment_change']);

function fail(code, message, detail = {}) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail;
  throw error;
}

function requireField(record, field, reason) {
  if (record[field] === undefined || record[field] === null || record[field] === '' || (Array.isArray(record[field]) && record[field].length === 0)) {
    fail('E_EVALUATION_CONTRACT', `missing ${field}: ${reason}`, { field, reason });
  }
}

function validateContract(name, record) {
  try {
    validate(evaluationV2Schema[name], record);
  } catch (error) {
    if (error.code === 'E_VALIDATION') {
      fail('E_EVALUATION_CONTRACT', error.message, { contract: name, ...error.detail });
    }
    throw error;
  }
}

export function createIssueRecord(record) {
  validateContract('issue_record', record);
  if (record.severity === 'blocking') {
    requireField(record, 'anchor_clause_ids', 'blocking issue requires an anchor');
    requireField(record, 'evidence_refs', 'blocking issue requires evidence');
    requireField(record, 'resolution_condition', 'blocking issue requires a resolution condition');
  }
  return Object.freeze({ ...record, anchor_clause_ids: Object.freeze([...record.anchor_clause_ids]), evidence_refs: Object.freeze([...record.evidence_refs]), dependency_keys: Object.freeze([...record.dependency_keys]), history: Object.freeze(record.history.map((event) => Object.freeze({ ...event }))) });
}

export function createCriterionEvaluation(record) {
  validateContract('criterion_evaluation', record);
  if (record.score < 9 && record.blocking_issue_ids.length === 0) {
    fail('E_EVALUATION_CONTRACT', 'score below 9 requires a blocking issue', { field: 'blocking_issue_ids' });
  }
  if (record.basis === 'unknown' && record.change_reason_ids.length === 0) {
    fail('E_EVALUATION_CONTRACT', 'unknown basis requires an explicit change reason', { field: 'change_reason_ids' });
  }
  return Object.freeze({ ...record });
}

export function createChangeReason(record) {
  validateContract('change_reason', record);
  if (record.before_digest === record.after_digest && record.condition_status === 'changed') {
    fail('E_EVALUATION_CONTRACT', 'a changed condition requires distinct digests', { field: 'after_digest' });
  }
  if (CONDITION_REASONS.has(record.reason) && !record.approval_record_id) {
    fail('E_EVALUATION_CONTRACT', `${record.reason} requires an approval record`, { field: 'approval_record_id' });
  }
  if (record.reason === 'evidence_change') requireField(record, 'evidence_refs', 'evidence change requires evidence');
  if (record.reason === 'upstream_finalized_change') requireField(record, 'upstream_contract_ids', 'upstream change requires contracts');
  if (record.reason === 'evaluation_correction') requireField(record, 'correction_basis', 'correction requires an independent or reproducible basis');
  return Object.freeze({ ...record, affected_dependency_keys: Object.freeze([...record.affected_dependency_keys]) });
}
