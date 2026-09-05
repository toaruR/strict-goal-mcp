import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { readSession, writeSession } from '../src/store/session_store.js';
import { readChain } from '../src/chain/store.js';
import { assertRoundBudget, assertKickbackBudget, grantExtraRounds } from '../src/chain/budget.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-budget-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir: dir ?? tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-budget-${submissionCounter}`.padEnd(8, '0');
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

function finalizeUpstream(persistence, sessionId, digest) {
  const session = readSession(persistence.dir, sessionId);
  session.state = 'FINAL';
  session.current_artifact = { digest, bytes: 100, committed_at: new Date().toISOString() };
  writeSession(persistence.dir, session);
  return session;
}

function bumpRound(persistence, sessionId, round) {
  const session = readSession(persistence.dir, sessionId);
  session.round = round;
  writeSession(persistence.dir, session);
  return session;
}

const DIGEST_A = `sha256:${'a'.repeat(64)}`;

test('チェーン合計 round が 28 に達した状態での loop_open が E_CHAIN_BUDGET_EXHAUSTED になる', () => {
  const persistence = durablePersistence();
  const upstream = createSession(persistence, { loop_mode: 'design' });
  finalizeUpstream(persistence, upstream.session_id, DIGEST_A);
  bumpRound(persistence, upstream.session_id, 28);

  assert.throws(
    () =>
      createSession(persistence, {
        loop_mode: 'plan',
        upstream: { session_id: upstream.session_id, artifact_digest: DIGEST_A },
      }),
    { code: 'E_CHAIN_BUDGET_EXHAUSTED' },
  );
});

test('チェーン合計 round が 28 に達した状態での予算チェック（score_submit が用いる契約）が E_CHAIN_BUDGET_EXHAUSTED になる', () => {
  const persistence = durablePersistence();
  const upstream = createSession(persistence, { loop_mode: 'design' });
  bumpRound(persistence, upstream.session_id, 28);
  const session = readSession(persistence.dir, upstream.session_id);

  assert.throws(() => assertRoundBudget(persistence.dir, session.chain_id), { code: 'E_CHAIN_BUDGET_EXHAUSTED' });
});

test('3 回目の escalate(action:"kickback")（が用いる契約）が E_CHAIN_BUDGET_EXHAUSTED になる', () => {
  const persistence = durablePersistence();
  const session = createSession(persistence, { loop_mode: 'design' });
  const chain = readChain(persistence.dir, session.chain_id);
  chain.kickbacks = [
    { at: new Date().toISOString(), from: 'rl_x', to: 'rl_y', target_criteria: [], note: '1回目' },
    { at: new Date().toISOString(), from: 'rl_x', to: 'rl_y', target_criteria: [], note: '2回目' },
  ];

  try {
    assertKickbackBudget(chain);
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 'E_CHAIN_BUDGET_EXHAUSTED');
    assert.equal(err.detail.check, 'kickbacks');
  }
});

test('人間承認による chain_extra_rounds 6 の上乗せが同一チェーンで1回しか効かない', () => {
  const persistence = durablePersistence();
  const session = createSession(persistence, { loop_mode: 'design' });

  const updated = grantExtraRounds(persistence.dir, session.chain_id);
  assert.equal(updated.granted_extra_rounds, 6);

  assert.throws(() => grantExtraRounds(persistence.dir, session.chain_id), {
    code: 'E_RESOLUTION_NOT_APPLICABLE',
    detail: { reason: 'extra_rounds_already_granted' },
  });
});

test('予算判定がチェーン内の全メンバーの round を合算する（単一セッションの値だけに依存しない）', () => {
  const persistence = durablePersistence();
  const upstream = createSession(persistence, { loop_mode: 'design' });
  finalizeUpstream(persistence, upstream.session_id, DIGEST_A);
  bumpRound(persistence, upstream.session_id, 10);

  const downstream = createSession(persistence, {
    loop_mode: 'plan',
    upstream: { session_id: upstream.session_id, artifact_digest: DIGEST_A },
  });
  bumpRound(persistence, downstream.session_id, 5);

  const chain = readChain(persistence.dir, downstream.chain_id);
  const result = assertRoundBudget(persistence.dir, chain.chain_id);
  assert.equal(result.chainRounds, 15);
});
