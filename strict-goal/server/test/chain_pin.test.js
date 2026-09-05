import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { readSession, writeSession } from '../src/store/session_store.js';
import { readChain } from '../src/chain/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-chain-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir: dir ?? tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-chain-${submissionCounter}`.padEnd(8, '0');
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

// FINAL 到達は score_submit（未実装）を経るため、テストでは session.json を直接
// FINAL + current_artifact に書き換えて上流の確定成果物を模す。
function finalizeUpstream(persistence, sessionId, digest, { state = 'FINAL' } = {}) {
  const session = readSession(persistence.dir, sessionId);
  session.state = state;
  session.current_artifact = { digest, bytes: 100, committed_at: new Date().toISOString() };
  writeSession(persistence.dir, session);
  return session;
}

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

test('loop_mode:"plan" で upstream 未指定のとき E_UPSTREAM_REQUIRED になる', () => {
  const persistence = durablePersistence();
  assert.throws(
    () => createSession(persistence, { loop_mode: 'plan' }),
    { code: 'E_UPSTREAM_REQUIRED' },
  );
});

test('loop_mode:"design" で upstream を指定すると E_UPSTREAM_NOT_ALLOWED になる', () => {
  const persistence = durablePersistence();
  assert.throws(
    () =>
      createSession(persistence, {
        loop_mode: 'design',
        upstream: { session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY', artifact_digest: DIGEST_A },
      }),
    { code: 'E_UPSTREAM_NOT_ALLOWED' },
  );
});

test('存在しない上流 session_id は E_UPSTREAM_NOT_FOUND になる', () => {
  const persistence = durablePersistence();
  assert.throws(
    () =>
      createSession(persistence, {
        loop_mode: 'plan',
        upstream: { session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY', artifact_digest: DIGEST_A },
      }),
    { code: 'E_UPSTREAM_NOT_FOUND' },
  );
});

test('上流が FINAL でも FINAL_WITH_RELAXATION でもないとき E_UPSTREAM_NOT_FINAL になる', () => {
  const persistence = durablePersistence();
  const upstream = createSession(persistence, { loop_mode: 'design' });
  assert.throws(
    () =>
      createSession(persistence, {
        loop_mode: 'plan',
        upstream: { session_id: upstream.session_id, artifact_digest: DIGEST_A },
      }),
    { code: 'E_UPSTREAM_NOT_FINAL' },
  );
});

test('上流の loop_mode が直前段でないとき E_UPSTREAM_MODE_MISMATCH になる', () => {
  const persistence = durablePersistence();
  const upstream = createSession(persistence, { loop_mode: 'design' });
  finalizeUpstream(persistence, upstream.session_id, DIGEST_A);

  const upstreamAsPlan = createSession(persistence, {
    loop_mode: 'plan',
    upstream: { session_id: upstream.session_id, artifact_digest: DIGEST_A },
  });
  finalizeUpstream(persistence, upstreamAsPlan.session_id, DIGEST_B);

  // implement は plan を要求するので、plan の代わりに design 直下のセッションを渡すと mismatch。
  assert.throws(
    () =>
      createSession(persistence, {
        loop_mode: 'implement',
        upstream: { session_id: upstream.session_id, artifact_digest: DIGEST_A },
      }),
    { code: 'E_UPSTREAM_MODE_MISMATCH' },
  );
});

test('artifact_digest が上流の確定成果物と不一致のとき E_UPSTREAM_DIGEST_MISMATCH になる', () => {
  const persistence = durablePersistence();
  const upstream = createSession(persistence, { loop_mode: 'design' });
  finalizeUpstream(persistence, upstream.session_id, DIGEST_A);

  assert.throws(
    () =>
      createSession(persistence, {
        loop_mode: 'plan',
        upstream: { session_id: upstream.session_id, artifact_digest: DIGEST_B },
      }),
    { code: 'E_UPSTREAM_DIGEST_MISMATCH' },
  );
});

test('chain.json が追記のみで、既存レコードが書き換わらない', () => {
  const persistence = durablePersistence();
  const upstream = createSession(persistence, { loop_mode: 'design' });
  finalizeUpstream(persistence, upstream.session_id, DIGEST_A);

  const upstreamSession = readSession(persistence.dir, upstream.session_id);
  const chainId = upstreamSession.chain_id;
  const chainAfterDesign = readChain(persistence.dir, chainId);
  assert.equal(chainAfterDesign.members.length, 1);
  const firstMember = chainAfterDesign.members[0];

  const downstream = createSession(persistence, {
    loop_mode: 'plan',
    upstream: { session_id: upstream.session_id, artifact_digest: DIGEST_A },
  });
  assert.equal(downstream.chain_id, chainId);

  const chainAfterPlan = readChain(persistence.dir, chainId);
  assert.equal(chainAfterPlan.members.length, 2);
  assert.deepEqual(chainAfterPlan.members[0], firstMember);
  assert.equal(chainAfterPlan.members[1].session_id, downstream.session_id);
  assert.equal(chainAfterPlan.members[1].upstream, upstream.session_id);
});
