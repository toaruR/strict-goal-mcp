import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeSession, readSession } from '../src/store/session_store.js';
import { readIndex, resolveByLabel, resolveByChain } from '../src/store/index_store.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-session-'));
}

function sampleSession(overrides = {}) {
  return {
    session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY',
    created_at: '2026-09-04T09:12:33Z',
    updated_at: '2026-09-04T10:41:02Z',
    task: 'サンプルタスク',
    artifact_kind: 'markdown',
    state: 'DRAFTING',
    round: 4,
    rubric_version: 1,
    rubric_digest: 'sha256:5b1e0f9c',
    label: 'my-label',
    server: {
      plugin_root: '/home/u/.agent-plugins/strict-goal',
      plugin_root_source: 'PLUGIN_ROOT',
      data_dir: '/home/u/.agent-plugins-data/strict-goal',
      data_dir_source: 'STRICT_GOAL_DATA',
      persistence: 'durable',
    },
    ...overrides,
  };
}

test('session.json を書いた直後に読み戻すと全フィールドが一致する', () => {
  const dataDir = tmpDataDir();
  const session = sampleSession();
  writeSession(dataDir, session);
  const readBack = readSession(dataDir, session.session_id);
  assert.deepEqual(readBack, session);
});

test('session.json に server.plugin_root_source が記録される', () => {
  const dataDir = tmpDataDir();
  const session = sampleSession();
  writeSession(dataDir, session);
  const readBack = readSession(dataDir, session.session_id);
  assert.equal(readBack.server.plugin_root_source, 'PLUGIN_ROOT');
});

test('index.json に session_id -> {state, round, updated_at} が反映される', () => {
  const dataDir = tmpDataDir();
  const session = sampleSession();
  writeSession(dataDir, session);
  const index = readIndex(dataDir);
  assert.deepEqual(index.sessions[session.session_id], {
    state: 'DRAFTING',
    round: 4,
    updated_at: '2026-09-04T10:41:02Z',
  });
});

test('同じ label を持つセッションが複数あるとき label 逆引きが候補配列を返す', () => {
  const dataDir = tmpDataDir();
  const a = sampleSession({ session_id: 'rl_01AAAAAAAAAAAAAAAAAAAAAAAA', label: 'shared' });
  const b = sampleSession({ session_id: 'rl_01BBBBBBBBBBBBBBBBBBBBBBBB', label: 'shared' });
  writeSession(dataDir, a);
  writeSession(dataDir, b);
  const candidates = resolveByLabel(dataDir, 'shared');
  assert.equal(candidates.length, 2);
  const ids = candidates.map((c) => c.session_id).sort();
  assert.deepEqual(ids, [a.session_id, b.session_id].sort());
});

test('chain_id 逆引きが同一チェーンの全 session_id を返す', () => {
  const dataDir = tmpDataDir();
  const a = sampleSession({ session_id: 'rl_01CCCCCCCCCCCCCCCCCCCCCCCC', chain_id: 'ch_01AAAAAAAAAAAAAAAAAAAAAAAA' });
  const b = sampleSession({ session_id: 'rl_01DDDDDDDDDDDDDDDDDDDDDDDD', chain_id: 'ch_01AAAAAAAAAAAAAAAAAAAAAAAA' });
  writeSession(dataDir, a);
  writeSession(dataDir, b);
  const ids = resolveByChain(dataDir, 'ch_01AAAAAAAAAAAAAAAAAAAAAAAA').sort();
  assert.deepEqual(ids, [a.session_id, b.session_id].sort());
});

test('session.json の書き込みが writeAtomic 経由である', () => {
  const dataDir = tmpDataDir();
  const session = sampleSession();
  const target = path.join(dataDir, 'sessions', session.session_id, 'session.json');
  writeSession(dataDir, session);
  assert.ok(readSession(dataDir, session.session_id));
  assert.ok(target);
});
