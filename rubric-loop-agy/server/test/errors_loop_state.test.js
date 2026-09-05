import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';
import { readSession } from '../src/store/session_store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-state-err-'));
}

function durablePersistence(dir = tmpDataDir()) {
  return { mode: 'durable', dir, source: 'RUBRIC_LOOP_DATA' };
}

let subCount = 0;
function nextSubId() {
  subCount += 1;
  return `sub-state-err-${String(subCount).padStart(6, '0')}`;
}

const EXPECTED_LOOP_STATE_ERRORS = new Set([
  'E_VALIDATION',
  'E_SESSION_NOT_FOUND',
]);

const observedErrors = new Set();

function recordError(persistence, sessionId, fn) {
  const beforeSession = sessionId ? readSession(persistence.dir, sessionId) : null;
  const beforeRound = beforeSession?.round;
  try {
    fn();
    assert.fail('Expected function to throw error');
  } catch (err) {
    assert.ok(err.code, `Error must have code, got: ${err.message}`);
    assert.notEqual(err.code, 'ERR_ASSERTION');
    observedErrors.add(err.code);
    if (sessionId) {
      const afterSession = readSession(persistence.dir, sessionId);
      assert.equal(afterSession.round, beforeRound, 'Session round must not advance on rejected loop_state');
    }
    return err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. E_VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
test('T071 loop_state: E_VALIDATION on invalid schema input (e.g. invalid include item)', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '状態確認エラーテスト用タスク説明文20文字以上です',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const err = recordError(persistence, created.session_id, () =>
    loopState({
      input: {
        session_id: created.session_id,
        include: ['invalid_include_key'],
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_VALIDATION');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. E_SESSION_NOT_FOUND
// ─────────────────────────────────────────────────────────────────────────────
test('T071 loop_state: E_SESSION_NOT_FOUND when session_id does not exist', () => {
  const persistence = durablePersistence();

  const err = recordError(persistence, null, () =>
    loopState({
      input: {
        session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY',
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_SESSION_NOT_FOUND');
});

// ─────────────────────────────────────────────────────────────────────────────
// Exhaustiveness verification
// ─────────────────────────────────────────────────────────────────────────────
test('T071 verification: exactly 2 error codes covered and no unexpected code', () => {
  assert.equal(observedErrors.size, 2, `Expected exactly 2 error codes, got ${observedErrors.size}`);
  assert.deepEqual(
    Array.from(observedErrors).sort(),
    Array.from(EXPECTED_LOOP_STATE_ERRORS).sort(),
    'Observed error codes must match expected set exactly'
  );
});
