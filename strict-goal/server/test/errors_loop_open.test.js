// T068: loop_open のエラー13件を全数検査する（設計書 19.6.7 総覧・6.4.1）。
// 各コードを1件ずつ最小手順で再現し、最後に集合がちょうど13件であることを確認する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopOpenResume } from '../src/tools/loop_open_resume.js';
import { readSession, writeSession } from '../src/store/session_store.js';
import { TOOL_ERRORS } from '../src/errors/codes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-errors-open-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-eopen-${submissionCounter}`.padEnd(8, '0');
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

function finalizeUpstream(persistence, sessionId, digest, { state = 'FINAL' } = {}) {
  const session = readSession(persistence.dir, sessionId);
  session.state = state;
  session.current_artifact = { digest, bytes: 100, committed_at: new Date().toISOString() };
  writeSession(persistence.dir, session);
}

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const seen = new Set();

function expectCode(code, fn) {
  test(`loop_open: ${code}`, () => {
    assert.throws(fn, { code });
    seen.add(code);
  });
}

expectCode('E_VALIDATION', () => {
  const persistence = durablePersistence();
  loopOpenCreate({ input: { mode: 'resume', submission_id: submissionId() }, pluginRoot, persistence });
});

expectCode('E_HANDLE_NOT_ACCEPTED', () => {
  const persistence = durablePersistence();
  createSession(persistence, { session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY' });
});

expectCode('E_SESSION_NOT_FOUND', () => {
  const persistence = durablePersistence();
  loopOpenResume({
    input: { mode: 'resume', submission_id: submissionId(), session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY' },
    persistence,
  });
});

expectCode('E_AMBIGUOUS_LABEL', () => {
  const persistence = durablePersistence();
  createSession(persistence, { label: 'dup-label' });
  createSession(persistence, { label: 'dup-label' });
  loopOpenResume({ input: { mode: 'resume', submission_id: submissionId(), label: 'dup-label' }, persistence });
});

expectCode('E_NO_PERSISTENCE', () => {
  const persistence = { mode: 'ephemeral', dir: null, source: 'EPHEMERAL' };
  createSession(persistence);
});

expectCode('E_RUBRIC_ON_RESUME', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  loopOpenResume({
    input: {
      mode: 'resume',
      submission_id: submissionId(),
      session_id: created.session_id,
      rubric: {
        criteria: [
          { id: 'x', statement: '0123456789012345678901234567890', weight: 1, verification: 'manual', anchors: { 1: 'low low', 5: 'mid mid', 9: 'high high' } },
        ],
      },
    },
    persistence,
  });
});

expectCode('E_UPSTREAM_REQUIRED', () => {
  const persistence = durablePersistence();
  createSession(persistence, { loop_mode: 'plan' });
});

expectCode('E_UPSTREAM_NOT_ALLOWED', () => {
  const persistence = durablePersistence();
  createSession(persistence, { loop_mode: 'design', upstream: { session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY', artifact_digest: DIGEST_A } });
});

expectCode('E_UPSTREAM_NOT_FOUND', () => {
  const persistence = durablePersistence();
  createSession(persistence, { loop_mode: 'plan', upstream: { session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY', artifact_digest: DIGEST_A } });
});

expectCode('E_UPSTREAM_NOT_FINAL', () => {
  const persistence = durablePersistence();
  const upstream = createSession(persistence, { loop_mode: 'design' });
  createSession(persistence, { loop_mode: 'plan', upstream: { session_id: upstream.session_id, artifact_digest: DIGEST_A } });
});

expectCode('E_UPSTREAM_MODE_MISMATCH', () => {
  const persistence = durablePersistence();
  const design = createSession(persistence, { loop_mode: 'design' });
  finalizeUpstream(persistence, design.session_id, DIGEST_A);
  createSession(persistence, { loop_mode: 'implement', upstream: { session_id: design.session_id, artifact_digest: DIGEST_A } });
});

expectCode('E_UPSTREAM_DIGEST_MISMATCH', () => {
  const persistence = durablePersistence();
  const design = createSession(persistence, { loop_mode: 'design' });
  finalizeUpstream(persistence, design.session_id, DIGEST_A);
  createSession(persistence, { loop_mode: 'plan', upstream: { session_id: design.session_id, artifact_digest: DIGEST_B } });
});

expectCode('E_CHAIN_BUDGET_EXHAUSTED', () => {
  const persistence = durablePersistence();
  const design = createSession(persistence, { loop_mode: 'design' });
  finalizeUpstream(persistence, design.session_id, DIGEST_A);
  const session = readSession(persistence.dir, design.session_id);
  session.round = 28;
  writeSession(persistence.dir, session);
  createSession(persistence, { loop_mode: 'plan', upstream: { session_id: design.session_id, artifact_digest: DIGEST_A } });
});

test('loop_open: 再現したコード集合がちょうど13件で E_INTERNAL 以外の未知コードが出ない', () => {
  assert.equal(seen.size, 13);
  assert.deepEqual([...seen].sort(), [...TOOL_ERRORS.loop_open].sort());
  assert.ok(!seen.has('E_INTERNAL'));
});
