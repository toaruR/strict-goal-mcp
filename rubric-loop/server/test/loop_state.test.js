import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';
import { readSession, writeSession } from '../src/store/session_store.js';
import { digestJson } from '../src/hash/digest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-state-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir: dir ?? tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-state-${submissionCounter}`.padEnd(8, '0');
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

function setState(persistence, sessionId, state) {
  const session = readSession(persistence.dir, sessionId);
  session.state = state;
  writeSession(persistence.dir, session);
  return session;
}

const NINE_STATES = [
  'DRAFTING',
  'SCORING',
  'STALLED',
  'ESCALATED',
  'FINAL',
  'FINAL_WITH_RELAXATION',
  'SUPERSEDED',
  'FROZEN',
  'ABORTED',
];

test('9状態すべてで loop_state が成功する', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  for (const state of NINE_STATES) {
    setState(persistence, created.session_id, state);
    const result = loopState({ input: { session_id: created.session_id }, persistence });
    assert.equal(result.ok, true, state);
    assert.equal(result.state, state, state);
  }
});

test('応答に rubric の全文（anchors を含む）が入る', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const result = loopState({ input: { session_id: created.session_id, include: ['rubric'] }, persistence });
  assert.ok(Array.isArray(result.rubric.criteria));
  assert.ok(result.rubric.criteria.length > 0);
  for (const criterion of result.rubric.criteria) {
    assert.ok(criterion.anchors['1']);
    assert.ok(criterion.anchors['5']);
    assert.ok(criterion.anchors['9']);
  }
});

test('直前が ITERATING のとき最低点3基準の全文アンカーが応答に含まれる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const session = readSession(persistence.dir, created.session_id);
  session.last_evaluation = {
    scores: [
      { criterion_id: 'a', score: 3, passed: false },
      { criterion_id: 'b', score: 4, passed: false },
      { criterion_id: 'c', score: 5, passed: false },
    ],
    must_fix: [
      { criterion_id: 'a', score: 3, gap: 6, anchor_9: 'aの9点相当の全文アンカー', verify_hint: 'aの検証ヒント' },
      { criterion_id: 'b', score: 4, gap: 5, anchor_9: 'bの9点相当の全文アンカー', verify_hint: 'bの検証ヒント' },
      { criterion_id: 'c', score: 5, gap: 4, anchor_9: 'cの9点相当の全文アンカー', verify_hint: 'cの検証ヒント' },
    ],
  };
  writeSession(persistence.dir, session);

  const result = loopState({ input: { session_id: created.session_id, include: ['must_fix'] }, persistence });
  assert.equal(result.must_fix.length, 3);
  for (const entry of result.must_fix) {
    assert.ok(entry.anchor_9.length > 0);
  }
});

test('応答に upstream ピンと chain_id と chain の周回集計が含まれる', () => {
  const persistence = durablePersistence();
  const upstream = createSession(persistence, { loop_mode: 'design' });
  const upstreamSession = readSession(persistence.dir, upstream.session_id);
  upstreamSession.state = 'FINAL';
  upstreamSession.current_artifact = { digest: `sha256:${'a'.repeat(64)}`, bytes: 10, committed_at: new Date().toISOString() };
  writeSession(persistence.dir, upstreamSession);

  const downstream = createSession(persistence, {
    loop_mode: 'plan',
    upstream: { session_id: upstream.session_id, artifact_digest: upstreamSession.current_artifact.digest },
  });

  const result = loopState({
    input: { session_id: downstream.session_id, include: ['upstream', 'chain'] },
    persistence,
  });

  assert.equal(result.chain_id, downstream.chain_id);
  assert.ok(result.upstream_artifact);
  assert.equal(result.upstream_artifact.session_id, upstream.session_id);
  assert.equal(result.upstream_artifact.drifted, false);
  assert.ok(result.chain);
  assert.equal(result.chain.chain_id, downstream.chain_id);
  assert.equal(result.chain.links.length, 2);
  assert.equal(result.chain.kickbacks, 0);
});

test('存在しない session_id で E_SESSION_NOT_FOUND になる', () => {
  const persistence = durablePersistence();
  assert.throws(
    () => loopState({ input: { session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY' }, persistence }),
    { code: 'E_SESSION_NOT_FOUND' },
  );
});

test('include に未知の値を渡すと E_VALIDATION になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  assert.throws(
    () => loopState({ input: { session_id: created.session_id, include: ['not_a_real_field'] }, persistence }),
    { code: 'E_VALIDATION' },
  );
});

test('上流を持たない design セッションに include:["upstream"] を渡してもエラーにせず no_upstream 警告を返す', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, { loop_mode: 'design' });
  const result = loopState({ input: { session_id: created.session_id, include: ['upstream'] }, persistence });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.includes('no_upstream'));
  assert.equal(result.upstream_artifact, undefined);
});

test('loop_state が状態を一切変更しない（呼び出し前後で session.json のダイジェストが不変）', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const before = digestJson(readSession(persistence.dir, created.session_id));

  loopState({
    input: { session_id: created.session_id, include: ['rubric', 'history', 'last_scores', 'must_fix', 'upstream', 'chain'] },
    persistence,
  });

  const after = digestJson(readSession(persistence.dir, created.session_id));
  assert.equal(before, after);
});
