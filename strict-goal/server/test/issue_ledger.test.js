import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendIssueEvent, readIssueLedger, unresolvedIssueSummary } from '../src/evidence/issue_ledger.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issue-ledger-'));
}

test('issue ledger accepts lifecycle events and links every event to its predecessor hash', () => {
  const dataDir = tempDir();
  const sessionId = 'ledger-session';
  const opened = appendIssueEvent(dataDir, sessionId, {
    issue_id: 'issue-a', lifecycle: 'opened', severity: 'high', blocking: true,
    criterion_ids: ['alpha'], at: '2026-10-17T00:00:00.000Z',
  });
  const reaffirmed = appendIssueEvent(dataDir, sessionId, {
    issue_id: 'issue-a', lifecycle: 'reaffirmed', blocking: true, at: '2026-10-17T00:01:00.000Z',
  });
  appendIssueEvent(dataDir, sessionId, {
    issue_id: 'issue-a', lifecycle: 'resolved', blocking: true, at: '2026-10-17T00:02:00.000Z',
  });
  const reopened = appendIssueEvent(dataDir, sessionId, {
    issue_id: 'issue-a', lifecycle: 'reopened', blocking: true, at: '2026-10-17T00:03:00.000Z',
  });
  const events = readIssueLedger(dataDir, sessionId);
  assert.equal(events.length, 4);
  assert.equal(reaffirmed.previous_hash, opened.hash);
  assert.equal(reopened.previous_hash, events[2].hash);
  assert.match(reopened.hash, /^sha256:[0-9a-f]{64}$/);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('issue ledger rejects illegal lifecycle transitions with E_ISSUE_STATE_INVALID', () => {
  const dataDir = tempDir();
  assert.throws(() => appendIssueEvent(dataDir, 'ledger-session', {
    issue_id: 'issue-a', lifecycle: 'resolved', blocking: true,
  }), (error) => error.code === 'E_ISSUE_STATE_INVALID');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('AC-RR-04 projects the stable top three unresolved blocking issue IDs without dropping a fourth', () => {
  const dataDir = tempDir();
  const sessionId = 'ledger-session';
  const issues = [
    ['low-old', 'low', ['a'], '2026-10-17T00:00:00.000Z'],
    ['high-one', 'high', ['a'], '2026-10-17T00:01:00.000Z'],
    ['high-two', 'high', ['a', 'b'], '2026-10-17T00:02:00.000Z'],
    ['critical', 'critical', ['a'], '2026-10-17T00:03:00.000Z'],
  ];
  for (const [issue_id, severity, criterion_ids, at] of issues) {
    appendIssueEvent(dataDir, sessionId, { issue_id, lifecycle: 'opened', severity, criterion_ids, blocking: true, at });
  }
  const summary = unresolvedIssueSummary(dataDir, sessionId);
  assert.deepEqual(summary.must_fix, ['critical', 'high-two', 'high-one']);
  assert.equal(summary.unresolved_count, 4);
  assert.deepEqual(summary.undisplayed_issue_ids, ['low-old']);
  assert.equal(summary.ledger_ref.path, 'issue-ledger.jsonl');
  assert.match(summary.ledger_ref.head_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(readIssueLedger(dataDir, sessionId).length, 4);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
