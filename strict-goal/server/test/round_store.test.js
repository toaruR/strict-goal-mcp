import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordRejectedSubmission, listRejectedSubmissions, pageRejectedSubmissions, pageUnresolvedIssues } from '../src/judge/round_store.js';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { appendIssueEvent, readIssueLedger } from '../src/evidence/issue_ledger.js';
import { readSession } from '../src/store/session_store.js';

test('unresolved issue windows preserve first-seen order across cursor reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-pages-'));
  try {
    for (const issue_id of ['a', 'b', 'c', 'd']) appendIssueEvent(dir, 'session', { issue_id, lifecycle: 'opened', blocking: true });
    appendIssueEvent(dir, 'session', { issue_id: 'b', lifecycle: 'resolved' });
    const first = JSON.parse(JSON.stringify(pageUnresolvedIssues(dir, 'session', { limit: 2 })));
    const second = pageUnresolvedIssues(dir, 'session', { limit: 2, cursor: first.next_cursor });
    assert.deepEqual(first.items.map((item) => item.issue_id), ['a', 'c']);
    assert.deepEqual(second.items.map((item) => item.issue_id), ['d']);
    assert.equal(second.total_count, 3);
    assert.equal(second.ledger_ref.event_count, 5);
    assert.equal(second.next_cursor, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rejected submissions deduplicate matching payloads and paginate oldest first after reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'round-store-'));
  try {
    const write = (round, id, digest) => recordRejectedSubmission(dir, round, { round, submission_id: id, payload_digest: digest, error_code: 'E_VALIDATION' });
    write(2, 'submission-2', 'digest-2');
    write(1, 'submission-1', 'digest-1');
    write(1, 'submission-1', 'digest-1');
    write(1, 'submission-1', 'digest-changed');
    write(10, 'submission-10', 'digest-10');
    assert.equal(listRejectedSubmissions(dir).length, 4);
    const first = pageRejectedSubmissions(dir, { limit: 2 });
    assert.deepEqual(first.items.map((item) => [item.round, item.attempt]), [[1, 1], [1, 2]]);
    const saved = JSON.parse(JSON.stringify(first));
    const second = pageRejectedSubmissions(dir, { limit: 2, cursor: saved.next_cursor });
    assert.deepEqual(second.items.map((item) => [item.round, item.attempt]), [[2, 1], [10, 1]]);
    assert.equal(second.next_cursor, null);
    assert.equal(second.total_count, 4);
    assert.equal(second.reference, 'rounds/');
    assert.throws(() => pageRejectedSubmissions(dir, { limit: 0 }), RangeError);
    assert.throws(() => pageRejectedSubmissions(dir, { cursor: 'bad' }), TypeError);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('accepted score replay returns its response without another ledger event after a new artifact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'round-replay-'));
    const persistence = { mode: 'durable', dir, source: 'STRICT_GOAL_DATA', roundReductionStage: 'enforce-new-session' };
  try {
    const created = loopOpenCreate({ persistence, input: {
      mode: 'create', submission_id: 'create-001', loop_mode: 'design',
      task: '十分に長いタスク説明を指定して再送時の台帳更新を検証します。',
      rubric: { criteria: [{ id: 'works', statement: '機能が仕様どおりに動作することを確認する。', weight: 1, verification: 'manual', anchors: { 1: '動作しない', 5: '一部動作する', 9: '完全に動作する' } }] },
    } });
    const content = '# 設計\n機能の動作に関する証拠をここに記載します。';
    const commit = (round, id, body) => artifactCommit({ persistence, input: { session_id: created.session_id, submission_id: id, expected_round: round, content: body, change_note: '変更内容を説明する十分な長さの文章です。', ...(round > 1 ? { addresses: ['works'] } : {}) } });
    const artifact = commit(1, 'commit-001', content);
    const context = (digest) => ({ snapshot: { artifact_digest: digest, rubric_digest: readSession(dir, created.session_id).rubric_digest, scope_digest: `sha256:${'a'.repeat(64)}`, environment_digest: `sha256:${'b'.repeat(64)}`, test_selection_digest: `sha256:${'c'.repeat(64)}` }, condition_changes: [] });
    const input = { session_id: created.session_id, submission_id: 'score-001', expected_round: 1, artifact_digest: artifact.artifact.digest, scores: [{ criterion_id: 'works', score: 8, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: '機能の動作に関する証拠をここに記載します。' }] }] };
    input.evaluation_context = context(artifact.artifact.digest);
    const first = scoreSubmit({ persistence, input });
    assert.equal(readIssueLedger(dir, created.session_id).length, 1);
    const nextArtifact = commit(2, 'commit-002', `${content}\n追加の変更を記録します。`);
    const replay = scoreSubmit({ persistence, input });
    assert.deepEqual(replay, first);
    assert.equal(readIssueLedger(dir, created.session_id).length, 1);
    scoreSubmit({ persistence, input: { ...input, submission_id: 'score-002', expected_round: 2, artifact_digest: nextArtifact.artifact.digest, evaluation_context: context(nextArtifact.artifact.digest) } });
    assert.equal(readIssueLedger(dir, created.session_id).length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
