import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpen } from '../src/tools/loop_open.js';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopOpenResume } from '../src/tools/loop_open_resume.js';
import { writeSession, readSession } from '../src/store/session_store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-open-err-'));
}

function durablePersistence(dir = tmpDataDir()) {
  return { mode: 'durable', dir, source: 'RUBRIC_LOOP_DATA' };
}

let subCount = 0;
function nextSubId() {
  subCount += 1;
  return `sub-open-err-${String(subCount).padStart(6, '0')}`;
}

const EXPECTED_LOOP_OPEN_ERRORS = new Set([
  'E_VALIDATION',
  'E_HANDLE_NOT_ACCEPTED',
  'E_SESSION_NOT_FOUND',
  'E_AMBIGUOUS_LABEL',
  'E_NO_PERSISTENCE',
  'E_RUBRIC_ON_RESUME',
  'E_UPSTREAM_REQUIRED',
  'E_UPSTREAM_NOT_ALLOWED',
  'E_UPSTREAM_NOT_FOUND',
  'E_UPSTREAM_NOT_FINAL',
  'E_UPSTREAM_MODE_MISMATCH',
  'E_UPSTREAM_DIGEST_MISMATCH',
  'E_CHAIN_BUDGET_EXHAUSTED',
]);

const observedErrors = new Set();

function recordError(fn) {
  try {
    fn();
    assert.fail('Expected function to throw error');
  } catch (err) {
    assert.ok(err.code, `Error must have code, got ${err.message}`);
    assert.notEqual(err.code, 'ERR_ASSERTION');
    observedErrors.add(err.code);
    return err;
  }
}

test('T068 loop_open: E_VALIDATION on invalid schema input', () => {
  const persistence = durablePersistence();
  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'invalid_mode',
        submission_id: nextSubId(),
      },
      pluginRoot,
      persistence,
    })
  );
  assert.equal(err.code, 'E_VALIDATION');
});

test('T068 loop_open: E_HANDLE_NOT_ACCEPTED on mode:create with session_id provided', () => {
  const persistence = durablePersistence();
  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'create',
        submission_id: nextSubId(),
        task: 'モード作成時にクライアントがハンドルを指定してはならない',
        loop_mode: 'design',
        session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY',
      },
      pluginRoot,
      persistence,
    })
  );
  assert.equal(err.code, 'E_HANDLE_NOT_ACCEPTED');
});

test('T068 loop_open: E_SESSION_NOT_FOUND on mode:resume with nonexistent session_id or label', () => {
  const persistence = durablePersistence();
  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'resume',
        submission_id: nextSubId(),
        session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY',
      },
      pluginRoot,
      persistence,
    })
  );
  assert.equal(err.code, 'E_SESSION_NOT_FOUND');
});

test('T068 loop_open: E_AMBIGUOUS_LABEL on mode:resume matching multiple sessions', () => {
  const persistence = durablePersistence();
  const dir = persistence.dir;
  const label = 'shared-feature-label';

  const res1 = loopOpen({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '最初のセッションを作成して同一ラベルを付与するタスク説明文',
      loop_mode: 'design',
      label,
    },
    pluginRoot,
    persistence,
  });

  const res2 = loopOpen({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '2番目のセッションを作成して同一ラベルを付与するタスク説明文',
      loop_mode: 'design',
      label,
    },
    pluginRoot,
    persistence,
  });

  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'resume',
        submission_id: nextSubId(),
        label,
      },
      pluginRoot,
      persistence,
    })
  );
  assert.equal(err.code, 'E_AMBIGUOUS_LABEL');
});

test('T068 loop_open: E_NO_PERSISTENCE when ephemeral persistence and allow_ephemeral is false', () => {
  const ephemeralPersistence = { mode: 'ephemeral', dir: null, source: 'fallback' };
  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'create',
        submission_id: nextSubId(),
        task: '永続ストレージ利用不能かつ allow_ephemeral 未指定時のテスト',
        loop_mode: 'design',
        allow_ephemeral: false,
      },
      pluginRoot,
      persistence: ephemeralPersistence,
    })
  );
  assert.equal(err.code, 'E_NO_PERSISTENCE');
});

test('T068 loop_open: E_RUBRIC_ON_RESUME when rubric or rubric_preset provided on resume', () => {
  const persistence = durablePersistence();
  const createRes = loopOpen({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '再開時にrubricを変更しようとするのを防ぐテスト用タスク',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'resume',
        submission_id: nextSubId(),
        session_id: createRes.session_id,
        rubric_preset: 'design',
      },
      pluginRoot,
      persistence,
    })
  );
  assert.equal(err.code, 'E_RUBRIC_ON_RESUME');
});

test('T068 loop_open: E_UPSTREAM_REQUIRED when loop_mode is plan or implement without upstream', () => {
  const persistence = durablePersistence();
  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'create',
        submission_id: nextSubId(),
        task: '上流ピンを指定せずにplanセッションを作成しようとするテスト',
        loop_mode: 'plan',
      },
      pluginRoot,
      persistence,
    })
  );
  assert.equal(err.code, 'E_UPSTREAM_REQUIRED');
});

test('T068 loop_open: E_UPSTREAM_NOT_ALLOWED when loop_mode is design but upstream is provided', () => {
  const persistence = durablePersistence();
  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'create',
        submission_id: nextSubId(),
        task: 'designモードなのにupstreamピンを指定しようとするテスト',
        loop_mode: 'design',
        upstream: {
          session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY',
          artifact_digest: `sha256:${'a'.repeat(64)}`,
        },
      },
      pluginRoot,
      persistence,
    })
  );
  assert.equal(err.code, 'E_UPSTREAM_NOT_ALLOWED');
});

test('T068 loop_open: E_UPSTREAM_NOT_FOUND when upstream session does not exist on disk', () => {
  const persistence = durablePersistence();
  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'create',
        submission_id: nextSubId(),
        task: '存在しないupstreamセッションを指定してplanを作成するテスト',
        loop_mode: 'plan',
        upstream: {
          session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY',
          artifact_digest: `sha256:${'a'.repeat(64)}`,
        },
      },
      pluginRoot,
      persistence,
    })
  );
  assert.equal(err.code, 'E_UPSTREAM_NOT_FOUND');
});

test('T068 loop_open: E_UPSTREAM_NOT_FINAL when upstream session is not in FINAL state', () => {
  const persistence = durablePersistence();
  const designRes = loopOpen({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: 'まだFINALになっていないdesignセッションを作成するテスト',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'create',
        submission_id: nextSubId(),
        task: '未FINALの上流を指定してplanセッションを作成しようとするテスト',
        loop_mode: 'plan',
        upstream: {
          session_id: designRes.session_id,
          artifact_digest: `sha256:${'a'.repeat(64)}`,
        },
      },
      pluginRoot,
      persistence,
    })
  );
  assert.equal(err.code, 'E_UPSTREAM_NOT_FINAL');
});

test('T068 loop_open: E_UPSTREAM_MODE_MISMATCH when predecessor loop_mode does not match expected', () => {
  const persistence = durablePersistence();
  // Create a design session and artificially mark it FINAL
  const designRes = loopOpen({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '上流モード不一致テストのためのdesignセッション作成タスク',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const s = readSession(persistence.dir, designRes.session_id);
  const digest = `sha256:${'b'.repeat(64)}`;
  s.state = 'FINAL';
  s.current_artifact = { digest, kind: 'markdown' };
  writeSession(persistence.dir, s);

  // implement expects upstream to be plan, but design is provided
  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'create',
        submission_id: nextSubId(),
        task: 'implementモードの上流にdesignを指定して不一致を起こすテスト',
        loop_mode: 'implement',
        upstream: {
          session_id: designRes.session_id,
          artifact_digest: digest,
        },
      },
      pluginRoot,
      persistence,
    })
  );
  assert.equal(err.code, 'E_UPSTREAM_MODE_MISMATCH');
});

test('T068 loop_open: E_UPSTREAM_DIGEST_MISMATCH when upstream artifact_digest does not match current confirmed artifact', () => {
  const persistence = durablePersistence();
  const designRes = loopOpen({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: 'digest不一致テストのための上流designセッション作成タスク',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const actualDigest = `sha256:${'c'.repeat(64)}`;
  const s = readSession(persistence.dir, designRes.session_id);
  s.state = 'FINAL';
  s.current_artifact = { digest: actualDigest, kind: 'markdown' };
  writeSession(persistence.dir, s);

  const wrongDigest = `sha256:${'d'.repeat(64)}`;
  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'create',
        submission_id: nextSubId(),
        task: '上流digestと一致しないdigestを指定してplanを作成するテスト',
        loop_mode: 'plan',
        upstream: {
          session_id: designRes.session_id,
          artifact_digest: wrongDigest,
        },
      },
      pluginRoot,
      persistence,
    })
  );
  assert.equal(err.code, 'E_UPSTREAM_DIGEST_MISMATCH');
});

test('T068 loop_open: E_CHAIN_BUDGET_EXHAUSTED when chain round budget is exhausted', () => {
  const persistence = durablePersistence();
  const designRes = loopOpen({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: 'チェーン予算枯渇テストのための上流designセッション作成',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const actualDigest = `sha256:${'e'.repeat(64)}`;
  const s = readSession(persistence.dir, designRes.session_id);
  s.state = 'FINAL';
  // Exhaust budget: default chain_max_rounds is 28
  s.round = 28;
  s.current_artifact = { digest: actualDigest, kind: 'markdown' };
  writeSession(persistence.dir, s);

  const err = recordError(() =>
    loopOpen({
      input: {
        mode: 'create',
        submission_id: nextSubId(),
        task: 'チェーン全体の周回予算が上限に達しているため拒絶されるテスト',
        loop_mode: 'plan',
        upstream: {
          session_id: designRes.session_id,
          artifact_digest: actualDigest,
        },
      },
      pluginRoot,
      persistence,
    })
  );
  assert.equal(err.code, 'E_CHAIN_BUDGET_EXHAUSTED');
});

test('T068 verification: exactly 13 error codes covered and no unexpected code', () => {
  assert.equal(observedErrors.size, 13, `Expected exactly 13 error codes, got ${observedErrors.size}`);
  assert.deepEqual(
    Array.from(observedErrors).sort(),
    Array.from(EXPECTED_LOOP_OPEN_ERRORS).sort(),
    'Observed error codes must match expected set exactly'
  );
});
