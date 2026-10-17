import fs from 'node:fs';
import path from 'node:path';
import { canonicalStringify, sha256Hex } from '../hash/digest.js';
import { sessionDir } from '../store/session_store.js';

const CONDITION_REASONS = new Map([
  ['scope_change', 'E_SCOPE_APPROVAL_REQUIRED'],
  ['rubric_change', 'E_RUBRIC_APPROVAL_REQUIRED'],
  ['environment_change', 'E_ENVIRONMENT_APPROVAL_REQUIRED'],
  ['test_selection_change', 'E_TEST_SELECTION_CHANGED'],
]);

function fail(code, message, detail = {}) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail;
  throw error;
}

function digest(record) {
  return `sha256:${sha256Hex(canonicalStringify(record))}`;
}

function appendJsonl(filePath, input) {
  const existing = readJsonl(filePath);
  const previous = existing.at(-1);
  const record = {
    sequence: existing.length + 1,
    ...input,
    previous_hash: previous?.hash ?? null,
  };
  record.hash = digest(record);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8').trim();
  return content ? content.split('\n').map((line) => JSON.parse(line)) : [];
}

function contextPath(dataDir, sessionId) {
  return path.join(sessionDir(dataDir, sessionId), 'evaluation-context.json');
}

function approvalPath(dataDir, sessionId) {
  return path.join(sessionDir(dataDir, sessionId), 'approval-bindings.jsonl');
}

function assertDigest(value, field) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail('E_EVALUATION_CONTEXT_INVALID', `${field} must be a SHA-256 digest`, { field });
  }
}

function redactContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    fail('E_EVALUATION_CONTEXT_INVALID', 'evaluation_context must be an object');
  }
  const result = {};
  for (const field of ['artifact_digest', 'scope_digest', 'rubric_digest', 'environment_digest', 'test_selection_digest']) {
    if (context[field] !== undefined) {
      assertDigest(context[field], field);
      result[field] = context[field];
    }
  }
  if (Object.keys(result).length === 0) fail('E_EVALUATION_CONTEXT_INVALID', 'evaluation_context requires at least one digest');
  return result;
}

export function recordApprovalBinding(dataDir, sessionId, input) {
  const reason = input?.reason;
  if (!CONDITION_REASONS.has(reason)) fail('E_EVALUATION_CONTEXT_INVALID', 'unsupported condition-change approval reason');
  assertDigest(input.before_digest, 'before_digest');
  assertDigest(input.after_digest, 'after_digest');
  if (typeof input.approval_id !== 'string' || input.approval_id.length < 1 || input.approval_id.length > 200) {
    fail('E_EVALUATION_CONTEXT_INVALID', 'approval_id is required');
  }
  const expiresAt = input.expires_at ?? null;
  if (expiresAt !== null && Number.isNaN(Date.parse(expiresAt))) {
    fail('E_EVALUATION_CONTEXT_INVALID', 'expires_at must be an ISO date');
  }
  return appendJsonl(approvalPath(dataDir, sessionId), {
    event_type: 'approval_binding',
    approval_id: input.approval_id,
    reason,
    before_digest: input.before_digest,
    after_digest: input.after_digest,
    expires_at: expiresAt,
    consumed: false,
    at: input.at ?? new Date().toISOString(),
  });
}

export function readApprovalBindings(dataDir, sessionId) {
  return readJsonl(approvalPath(dataDir, sessionId));
}

function activeApprovalBindings(dataDir, sessionId) {
  const latest = new Map();
  for (const record of readApprovalBindings(dataDir, sessionId)) {
    latest.set(record.approval_id, record);
  }
  return [...latest.values()];
}

export function validateConditionChanges(dataDir, sessionId, changes = []) {
  if (!Array.isArray(changes)) fail('E_EVALUATION_CONTEXT_INVALID', 'condition_changes must be an array');
  const bindings = activeApprovalBindings(dataDir, sessionId);
  const approved = [];
  const usedIds = new Set();
  for (const change of changes) {
    const reason = change?.reason;
    if (!CONDITION_REASONS.has(reason)) continue;
    assertDigest(change.before_digest, 'before_digest');
    assertDigest(change.after_digest, 'after_digest');
    const matches = bindings.filter((binding) => binding.event_type === 'approval_binding'
      && binding.approval_id === change.approval_id
      && binding.reason === reason
      && binding.before_digest === change.before_digest
      && binding.after_digest === change.after_digest
      && binding.consumed === false
      && (!binding.expires_at || Date.parse(binding.expires_at) >= Date.now()));
    if (matches.length !== 1 || usedIds.has(change.approval_id)) {
      fail(CONDITION_REASONS.get(reason), `${reason} requires one matching unexpired digest-bound approval`, {
        reason,
        approval_id: change?.approval_id ?? null,
        match_count: matches.length,
      });
    }
    usedIds.add(change.approval_id);
    approved.push({ ...change, condition_changed: true, quality_improved: false });
  }
  return approved;
}

export function consumeApprovalBindings(dataDir, sessionId, changes, input) {
  for (const change of changes) {
    appendJsonl(approvalPath(dataDir, sessionId), {
      event_type: 'approval_consumed',
      approval_id: change.approval_id,
      reason: change.reason,
      before_digest: change.before_digest,
      after_digest: change.after_digest,
      consumed: true,
      submission_id: input.submission_id,
      round: input.round,
      at: new Date().toISOString(),
    });
  }
}

export function readEvaluationContext(dataDir, sessionId) {
  const target = contextPath(dataDir, sessionId);
  if (!fs.existsSync(target)) return null;
  const stored = JSON.parse(fs.readFileSync(target, 'utf8'));
  return stored.records?.at(-1) ?? null;
}

export function deriveConditionChanges(dataDir, sessionId, context) {
  const previous = readEvaluationContext(dataDir, sessionId);
  const snapshot = redactContext(context);
  if (!previous) return { snapshot, required: [] };
  const fields = [
    ['scope_digest', 'scope_change'],
    ['rubric_digest', 'rubric_change'],
    ['environment_digest', 'environment_change'],
    ['test_selection_digest', 'test_selection_change'],
  ];
  const required = fields
    .filter(([field]) => previous.snapshot[field] !== undefined
      && snapshot[field] !== undefined
      && previous.snapshot[field] !== snapshot[field])
    .map(([field, reason]) => ({ reason, before_digest: previous.snapshot[field], after_digest: snapshot[field] }));
  return { snapshot, required };
}

export function persistEvaluationContext(dataDir, sessionId, input) {
  const snapshot = redactContext(input.context);
  const target = contextPath(dataDir, sessionId);
  const stored = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : { records: [] };
  const previous = stored.records.at(-1) ?? null;
  const record = {
    event_type: 'evaluation_context',
    snapshot,
    ...(input.unknown_fields?.length ? { unknown_fields: input.unknown_fields } : {}),
    submission_id: input.submission_id,
    round: input.round,
    invalidation: input.invalidation.map((change) => ({
      reason: change.reason,
      before_digest: change.before_digest,
      after_digest: change.after_digest,
      approval_id: change.approval_id,
    })),
    previous_hash: previous?.hash ?? null,
  };
  record.hash = digest(record);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  stored.records.push(record);
  fs.writeFileSync(target, JSON.stringify(stored, null, 2), 'utf8');
  return record;
}
