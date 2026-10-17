import fs from 'node:fs';
import path from 'node:path';
import { canonicalStringify, sha256Hex } from '../hash/digest.js';
import { sessionDir } from '../store/session_store.js';

const OPEN_EVENTS = new Set(['opened', 'reaffirmed', 'duplicated']);
const SEVERITY_ORDER = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });

function issueStateError(message, detail = {}) {
  const error = new Error(message);
  error.code = 'E_ISSUE_STATE_INVALID';
  error.detail = detail;
  return error;
}

export function issueLedgerPath(dataDir, sessionId) {
  return path.join(sessionDir(dataDir, sessionId), 'issue-ledger.jsonl');
}

export function readIssueLedger(dataDir, sessionId) {
  const ledgerPath = issueLedgerPath(dataDir, sessionId);
  if (!fs.existsSync(ledgerPath)) return [];
  const text = fs.readFileSync(ledgerPath, 'utf8').trim();
  if (!text) return [];
  return text.split('\n').map((line) => JSON.parse(line));
}

function stateByIssue(events) {
  const states = new Map();
  for (const event of events) {
    states.set(event.issue_id, event.lifecycle === 'resolved' ? 'resolved' : 'open');
  }
  return states;
}

function assertTransition(previousState, lifecycle, issueId) {
  const legal = (previousState === undefined && lifecycle === 'opened')
    || (previousState === 'open' && OPEN_EVENTS.has(lifecycle))
    || (previousState === 'open' && lifecycle === 'resolved')
    || (previousState === 'resolved' && lifecycle === 'reopened');
  if (!legal) {
    throw issueStateError(`Illegal issue lifecycle transition: ${previousState ?? 'absent'} -> ${lifecycle}`, {
      issue_id: issueId,
      previous_state: previousState ?? null,
      lifecycle,
    });
  }
}

function hashEvent(event) {
  return `sha256:${sha256Hex(canonicalStringify(event))}`;
}

export function appendIssueEvent(dataDir, sessionId, input) {
  const events = readIssueLedger(dataDir, sessionId);
  const lifecycle = input?.lifecycle;
  const issueId = input?.issue_id;
  if (typeof issueId !== 'string' || issueId.length === 0 || !['opened', 'duplicated', 'reaffirmed', 'resolved', 'reopened'].includes(lifecycle)) {
    throw issueStateError('An issue event requires issue_id and a supported lifecycle');
  }
  const states = stateByIssue(events);
  assertTransition(states.get(issueId), lifecycle, issueId);

  const prior = events.at(-1);
  const event = {
    sequence: events.length + 1,
    issue_id: issueId,
    lifecycle,
    severity: input.severity ?? null,
    criterion_ids: [...new Set(input.criterion_ids ?? [])].sort(),
    blocking: input.blocking === true,
    submission_id: input.submission_id ?? null,
    round: input.round ?? null,
    at: input.at ?? new Date().toISOString(),
    previous_hash: prior?.hash ?? null,
  };
  event.hash = hashEvent(event);

  const ledgerPath = issueLedgerPath(dataDir, sessionId);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

function latestIssueRecords(events) {
  const records = new Map();
  for (const event of events) {
    const prior = records.get(event.issue_id);
    records.set(event.issue_id, {
      ...event,
      first_seen: prior?.first_seen ?? event.at,
      first_sequence: prior?.first_sequence ?? event.sequence,
      severity: event.severity ?? prior?.severity ?? 'low',
      criterion_ids: event.criterion_ids?.length ? event.criterion_ids : (prior?.criterion_ids ?? []),
      blocking: event.blocking === true || prior?.blocking === true,
      state: event.lifecycle === 'resolved' ? 'resolved' : 'open',
    });
  }
  return [...records.values()];
}

export function unresolvedIssueSummary(dataDir, sessionId, limit = 3) {
  const events = readIssueLedger(dataDir, sessionId);
  const unresolved = latestIssueRecords(events)
    .filter((issue) => issue.state === 'open' && issue.blocking)
    .sort((left, right) => {
      const severity = (SEVERITY_ORDER[right.severity] ?? 0) - (SEVERITY_ORDER[left.severity] ?? 0);
      if (severity !== 0) return severity;
      const impact = right.criterion_ids.length - left.criterion_ids.length;
      if (impact !== 0) return impact;
      if (left.first_seen !== right.first_seen) return left.first_seen.localeCompare(right.first_seen);
      return left.first_sequence - right.first_sequence;
    });
  const ledgerRef = {
    path: 'issue-ledger.jsonl',
    event_count: events.length,
    head_hash: events.at(-1)?.hash ?? null,
  };
  return {
    must_fix: unresolved.slice(0, limit).map((issue) => issue.issue_id),
    unresolved_count: unresolved.length,
    undisplayed_issue_ids: unresolved.slice(limit).map((issue) => issue.issue_id),
    ledger_ref: ledgerRef,
  };
}
