import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { readSession, writeSession } from '../src/store/session_store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-commit-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir: dir ?? tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-commit-${submissionCounter}`.padEnd(8, '0');
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

const CHANGE_NOTE = 'これは20文字以上ある変更理由の説明文です';

test('commit 後に state が SCORING になり artifact_digest が返る', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const result = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: '# 設計書\n本文です。',
      change_note: CHANGE_NOTE,
    },
    persistence,
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, 'SCORING');
  assert.match(result.artifact.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.artifact.unchanged, false);
  assert.equal(result.artifact.previous_digest, null);
});

test('同一内容を2回 commit しても artifacts/ に1ファイルしか増えない', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const content = '# 設計書\n同一内容です。';

  artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content, change_note: CHANGE_NOTE },
    persistence,
  });

  // 2周目に進めてから同じ内容を再 commit する。
  let session = readSession(persistence.dir, created.session_id);
  session.state = 'DRAFTING';
  session.round = 2;
  writeSession(persistence.dir, session);

  const result2 = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      content,
      change_note: CHANGE_NOTE,
      addresses: [],
    },
    persistence,
  });

  assert.equal(result2.artifact.unchanged, true);
  const artifactsDir = path.join(persistence.dir, 'sessions', created.session_id, 'artifacts');
  const files = readdirSync(artifactsDir).filter((name) => name !== 'index.json');
  assert.equal(files.length, 1);
});

test('artifacts/index.json に round -> digest の対応が記録される', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const result = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: '# 設計書\n本文です。',
      change_note: CHANGE_NOTE,
    },
    persistence,
  });

  const indexPath = path.join(persistence.dir, 'sessions', created.session_id, 'artifacts', 'index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  assert.equal(index['1'], result.artifact.digest);
});

test('round>=2 で addresses が前周 must_fix[0].criterion_id を含まないとき E_ADDRESS_MISSING になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: '# 本文1', change_note: CHANGE_NOTE },
    persistence,
  });

  let session = readSession(persistence.dir, created.session_id);
  session.state = 'DRAFTING';
  session.round = 2;
  session.last_evaluation = {
    scores: [{ criterion_id: 'crit_a', score: 3, passed: false }],
    must_fix: [{ criterion_id: 'crit_a', score: 3, gap: 6, anchor_9: '9点相当', verify_hint: '検証方法' }],
  };
  writeSession(persistence.dir, session);

  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 2,
          content: '# 本文2',
          change_note: CHANGE_NOTE,
          addresses: ['crit_b'],
        },
        persistence,
      }),
    { code: 'E_ADDRESS_MISSING' },
  );
});

test('content が1000001バイトのとき E_VALIDATION になり、1000000バイトは通る', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          content: 'a'.repeat(1_000_001),
          change_note: CHANGE_NOTE,
        },
        persistence,
      }),
    { code: 'E_VALIDATION' },
  );

  const result = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: 'a'.repeat(1_000_000),
      change_note: CHANGE_NOTE,
    },
    persistence,
  });
  assert.equal(result.ok, true);
});

test('SCORING 状態での artifact_commit が E_STATE_VIOLATION になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: '# 本文', change_note: CHANGE_NOTE },
    persistence,
  });

  assert.throws(
    () =>
      artifactCommit({
        input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: '# 本文2', change_note: CHANGE_NOTE },
        persistence,
      }),
    { code: 'E_STATE_VIOLATION' },
  );
});

test('同一 submission_id の再送で artifacts/ が増えない', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const subId = submissionId();
  const input = {
    session_id: created.session_id,
    submission_id: subId,
    expected_round: 1,
    content: '# 本文',
    change_note: CHANGE_NOTE,
  };

  const first = artifactCommit({ input, persistence });
  const second = artifactCommit({ input, persistence });
  assert.deepEqual(first, second);

  const artifactsDir = path.join(persistence.dir, 'sessions', created.session_id, 'artifacts');
  const files = readdirSync(artifactsDir).filter((name) => name !== 'index.json');
  assert.equal(files.length, 1);
});

test('expected_round が現在の round と一致しないとき E_CONCURRENT になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  assert.throws(
    () =>
      artifactCommit({
        input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 99, content: '# 本文', change_note: CHANGE_NOTE },
        persistence,
      }),
    { code: 'E_CONCURRENT' },
  );
});
