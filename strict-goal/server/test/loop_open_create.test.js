import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { readSession } from '../src/store/session_store.js';
import { loadRubric } from '../src/rubric/store.js';
import { sessionDir } from '../src/store/session_store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-open-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-create-${submissionCounter}`.padEnd(8, '0');
}

function baseInput(overrides = {}) {
  return {
    mode: 'create',
    submission_id: submissionId(),
    task: 'サンプルタスクの説明文で20文字以上になるようにする',
    ...overrides,
  };
}

test('mode:"create" の成功応答が rl_ 前置の26文字 ULID を session_id として返す', () => {
  const persistence = durablePersistence();
  const result = loopOpenCreate({ input: baseInput({ loop_mode: 'design' }), pluginRoot, persistence });
  assert.equal(result.ok, true);
  assert.match(result.session_id, /^rl_[0-9A-HJKMNP-TV-Z]{26}$/);
});

test('mode:"create" で session_id を指定すると E_HANDLE_NOT_ACCEPTED になる', () => {
  const persistence = durablePersistence();
  assert.throws(
    () =>
      loopOpenCreate({
        input: baseInput({ loop_mode: 'design', session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY' }),
        pluginRoot,
        persistence,
      }),
    { code: 'E_HANDLE_NOT_ACCEPTED' },
  );
});

test('rubric 未指定のとき loop_mode に対応する presets が採用される（design→15基準）', () => {
  const persistence = durablePersistence();
  const result = loopOpenCreate({ input: baseInput({ loop_mode: 'design' }), pluginRoot, persistence });
  const sDir = sessionDir(persistence.dir, result.session_id);
  const rubric = loadRubric(sDir, 1);
  assert.equal(rubric.criteria.length, 15);
});

test('loop_mode 未指定のとき "design" が採用される', () => {
  const persistence = durablePersistence();
  const result = loopOpenCreate({ input: baseInput(), pluginRoot, persistence });
  assert.equal(result.loop_mode, 'design');
  const session = readSession(persistence.dir, result.session_id);
  assert.equal(session.loop_mode, 'design');
});

test('作成直後の state が DRAFTING、round が 1 であること', () => {
  const persistence = durablePersistence();
  const result = loopOpenCreate({ input: baseInput({ loop_mode: 'design' }), pluginRoot, persistence });
  assert.equal(result.state, 'DRAFTING');
  assert.equal(result.round, 1);
  const session = readSession(persistence.dir, result.session_id);
  assert.equal(session.state, 'DRAFTING');
  assert.equal(session.round, 1);
});

test('EPHEMERAL かつ allow_ephemeral 未指定のとき E_NO_PERSISTENCE になる', () => {
  const persistence = { mode: 'ephemeral', dir: null, source: 'EPHEMERAL' };
  assert.throws(
    () => loopOpenCreate({ input: baseInput({ loop_mode: 'design' }), pluginRoot, persistence }),
    { code: 'E_NO_PERSISTENCE' },
  );
});

test('EPHEMERAL かつ allow_ephemeral:true のときは作成できる', () => {
  const persistence = { mode: 'ephemeral', dir: null, source: 'EPHEMERAL' };
  const result = loopOpenCreate({
    input: baseInput({ loop_mode: 'design', allow_ephemeral: true }),
    pluginRoot,
    persistence,
  });
  assert.equal(result.ok, true);
  assert.equal(result.persistence, 'ephemeral');
});
