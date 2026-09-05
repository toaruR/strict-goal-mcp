import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateSubmissionId, withIdempotency, MUTATION_TOOLS_REQUIRING_SUBMISSION_ID } from '../src/idempotency/guard.js';

function tmpSessionDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-idem-'));
}

test('submission_id は7文字だと E_VALIDATION、8文字と128文字は通り、129文字は E_VALIDATION', () => {
  assert.throws(() => validateSubmissionId('a'.repeat(7)), { code: 'E_VALIDATION' });
  assert.doesNotThrow(() => validateSubmissionId('a'.repeat(8)));
  assert.doesNotThrow(() => validateSubmissionId('a'.repeat(128)));
  assert.throws(() => validateSubmissionId('a'.repeat(129)), { code: 'E_VALIDATION' });
});

test('同一 submission_id を2回送っても handler は1回しか実行されず round が1回しか進まない', () => {
  const sessionDir = tmpSessionDir();
  let round = 0;
  let callCount = 0;
  const submissionId = 'sub-0001';
  const handler = () => {
    callCount += 1;
    round += 1;
    return { round };
  };

  const first = withIdempotency(sessionDir, submissionId, handler);
  const second = withIdempotency(sessionDir, submissionId, handler);

  assert.equal(callCount, 1);
  assert.equal(round, 1);
  assert.deepEqual(first, second);
});

test('2回目の応答は1回目とバイト単位（JSON直列化）で一致する', () => {
  const sessionDir = tmpSessionDir();
  const submissionId = 'sub-0002';
  const handler = () => ({ ok: true, round: 1, nested: { a: [1, 2, 3] } });

  const first = withIdempotency(sessionDir, submissionId, handler);
  const second = withIdempotency(sessionDir, submissionId, handler);

  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('冪等記録はセッション単位で分離され、別セッションの同名 submission_id と衝突しない', () => {
  const sessionDirA = tmpSessionDir();
  const sessionDirB = tmpSessionDir();
  const submissionId = 'sub-0003';

  const resultA = withIdempotency(sessionDirA, submissionId, () => ({ session: 'A' }));
  const resultB = withIdempotency(sessionDirB, submissionId, () => ({ session: 'B' }));

  assert.deepEqual(resultA, { session: 'A' });
  assert.deepEqual(resultB, { session: 'B' });
});

test('submission_id を必須とする5ツールが loop_open, artifact_commit, score_submit, rubric_amend, escalate であること', () => {
  assert.deepEqual(
    [...MUTATION_TOOLS_REQUIRING_SUBMISSION_ID].sort(),
    ['artifact_commit', 'escalate', 'loop_open', 'rubric_amend', 'score_submit'].sort(),
  );
});
