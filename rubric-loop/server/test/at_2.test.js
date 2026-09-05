// AT-2: ごまかし検出①：成果物不変でスコアだけ上昇。docs/design-rubric-loop-mcp.md §13 AT-2。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { auditExport } from '../src/tools/audit_export.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at2-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at2-${submissionCounter}`.padEnd(8, '0');
}

function criterion(id, overrides = {}) {
  return {
    id,
    statement: `${id} の基準を十分に満たしていることの根拠が示されている`,
    weight: 1,
    verification: 'manual',
    anchors: { 1: '全く満たさない', 5: '半分程度満たす', 9: '完全に満たす' },
    ...overrides,
  };
}

const RUBRIC = {
  criteria: [criterion('acceptance_tests'), criterion('self_hosting')],
};

function createSession(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      label: 'rubric-loop-at2',
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: RUBRIC,
    },
    persistence,
  });
}

function commit(persistence, sessionId, expectedRound, content, addresses) {
  return artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      content,
      change_note: `第${expectedRound}版の改訂理由をここに20文字以上で説明する`,
      ...(addresses ? { addresses } : {}),
    },
    persistence,
  });
}

function score(persistence, sessionId, expectedRound, digest, scores) {
  return scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      artifact_digest: digest,
      scores: scores.map(({ id, value, excerpt }) => ({
        criterion_id: id,
        score: value,
        rationale: 'a'.repeat(45),
        weakness: value === 10 ? 'none' : 'b'.repeat(15),
        evidence: [{ kind: 'locator', locator: '§1', excerpt }],
      })),
    },
    persistence,
  });
}

test('AT-2: 成果物不変でスコアだけ上げると E_SCORE_INFLATION、同点提出は通り audit_export に記録される', () => {
  const persistence = durablePersistence();

  const created = createSession(persistence);
  const CONTENT_1 = '# 設計書\n受け入れテストは3本しかなく本数が不足している。\nセルフホスティングについては何も着手していない状態である。';
  const c1 = commit(persistence, created.session_id, 1, CONTENT_1);

  const r1 = score(persistence, created.session_id, 1, c1.artifact.digest, [
    { id: 'acceptance_tests', value: 6, excerpt: '受け入れテストは3本しかなく本数が不足している。' },
    { id: 'self_hosting', value: 3, excerpt: 'セルフホスティングについては何も着手していない状態である。' },
  ]);
  assert.equal(r1.verdict, 'ITERATING');
  assert.equal(r1.round, 2);

  // 1. round2: 前周と同一本文を再 commit → unchanged:true
  const c2 = commit(persistence, created.session_id, 2, CONTENT_1, ['self_hosting']);
  assert.equal(c2.ok, true);
  assert.equal(c2.artifact.unchanged, true);
  assert.equal(c2.artifact.previous_digest, c2.artifact.digest);
  assert.ok(c2.warnings.includes('artifact_unchanged'));

  // 2. 成果物不変なのに acceptance_tests を 6→9 に上げる → E_SCORE_INFLATION
  assert.throws(
    () =>
      score(persistence, created.session_id, 2, c2.artifact.digest, [
        { id: 'acceptance_tests', value: 9, excerpt: '# 設計書\n受け入れテストは3本しかなく本数が不足している。' },
        { id: 'self_hosting', value: 3, excerpt: 'セルフホスティングについては何も着手していない状態である。' },
      ]),
    (err) => {
      assert.equal(err.code, 'E_SCORE_INFLATION');
      assert.equal(err.detail.criteria[0].criterion_id, 'acceptance_tests');
      assert.equal(err.detail.criteria[0].previous_score, 6);
      assert.equal(err.detail.criteria[0].score, 9);
      return true;
    },
  );

  // 状態は SCORING のまま、round も進んでいない
  const afterRejected = score(persistence, created.session_id, 2, c2.artifact.digest, [
    { id: 'acceptance_tests', value: 6, excerpt: '受け入れテストは3本しかなく本数が不足している。' },
    { id: 'self_hosting', value: 3, excerpt: 'セルフホスティングについては何も着手していない状態である。' },
  ]);
  // 3. 全て前周と同点で再提出 → 通る、improvement:0、stall カウント増加
  assert.equal(afterRejected.ok, true);
  assert.equal(afterRejected.verdict, 'ITERATING');
  assert.equal(afterRejected.evaluation.improvement, 0);
  assert.equal(afterRejected.stall.rounds_without_improvement, 1);

  // 4. audit_export の rejected_submissions に E_SCORE_INFLATION が記録される
  const exported = auditExport({ input: { session_id: created.session_id }, persistence });
  assert.equal(exported.ok, true);
  assert.equal(exported.export.summary.rejected_submissions, 1);
  const audit = JSON.parse(readFileSync(exported.export.path, 'utf8'));
  assert.equal(audit.rejected_submissions.length, 1);
  assert.equal(audit.rejected_submissions[0].error_code, 'E_SCORE_INFLATION');
});
