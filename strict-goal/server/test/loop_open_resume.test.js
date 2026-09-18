import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopOpenResume } from '../src/tools/loop_open_resume.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-resume-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir: dir ?? tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-resume-${submissionCounter}`.padEnd(8, '0');
}

function createSession(persistence, overrides = {}) {
  const input = {
    mode: 'create',
    submission_id: submissionId(),
    task: 'サンプルタスクの説明文で20文字以上になるようにする',
    loop_mode: 'design',
    ...overrides,
  };
  return loopOpenCreate({ input, pluginRoot, persistence });
}

test('存在しない session_id の resume が E_SESSION_NOT_FOUND になる', () => {
  const persistence = durablePersistence();
  createSession(persistence);
  assert.throws(
    () =>
      loopOpenResume({
        input: { mode: 'resume', submission_id: submissionId(), session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY' },
        persistence,
      }),
    { code: 'E_SESSION_NOT_FOUND' },
  );
});

test('同じ label のセッションが2件あるとき E_AMBIGUOUS_LABEL になり detail.candidates に両方の session_id が入る', () => {
  const persistence = durablePersistence();
  const first = createSession(persistence, { label: 'shared-label' });
  const second = createSession(persistence, { label: 'shared-label' });

  try {
    loopOpenResume({ input: { mode: 'resume', submission_id: submissionId(), label: 'shared-label' }, persistence });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 'E_AMBIGUOUS_LABEL');
    const ids = err.detail.candidates.map((c) => c.session_id);
    assert.ok(ids.includes(first.session_id));
    assert.ok(ids.includes(second.session_id));
  }
});

test('mode:"resume" で rubric を渡すと E_RUBRIC_ON_RESUME になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  assert.throws(
    () =>
      loopOpenResume({
        input: {
          mode: 'resume',
          submission_id: submissionId(),
          session_id: created.session_id,
          rubric: {
            criteria: [
              {
                id: 'x',
                statement: '0123456789012345678901234567890',
                weight: 1,
                verification: 'manual',
                anchors: { 1: 'low low', 5: 'mid mid', 9: 'high high' },
              },
            ],
          },
        },
        persistence,
      }),
    { code: 'E_RUBRIC_ON_RESUME' },
  );
});

test('再開応答だけで rubric 全文・round・state・must_fix・upstream・chain_id が揃う', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const result = loopOpenResume({
    input: { mode: 'resume', submission_id: submissionId(), session_id: created.session_id },
    persistence,
  });

  assert.equal(result.ok, true);
  assert.equal(result.resumed, true);
  assert.equal(result.session_id, created.session_id);
  assert.equal(result.state, 'DRAFTING');
  assert.equal(result.round, 1);
  assert.ok(Array.isArray(result.rubric.criteria));
  assert.equal(result.rubric.criteria.length, 8);
  assert.ok(Array.isArray(result.must_fix));
  assert.match(result.chain_id, /^ch_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(result.upstream, null);
});

test('サーバプロセスを再起動しても同じハンドルで同じ状態が復元される（ファイル永続からの再読込）', () => {
  const dir = tmpDataDir();
  const persistence = durablePersistence(dir);
  const created = createSession(persistence);

  // 別プロセスを模して、同じ dataDir だけを頼りに新たに resume する。
  const reopenedPersistence = durablePersistence(dir);
  const result = loopOpenResume({
    input: { mode: 'resume', submission_id: submissionId(), session_id: created.session_id },
    persistence: reopenedPersistence,
  });

  assert.equal(result.session_id, created.session_id);
  assert.equal(result.state, 'DRAFTING');
  assert.equal(result.round, 1);
  assert.equal(result.rubric.criteria.length, 8);
});
