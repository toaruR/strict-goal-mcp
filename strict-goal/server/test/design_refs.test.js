import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkDesignRefs } from '../src/artifact/design_refs.js';
import { saveContentArtifact } from '../src/artifact/store.js';
import { sessionDir, writeSession } from '../src/store/session_store.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-design-refs-'));
}

function seedUpstream(dataDir, sessionId, content) {
  const sDir = sessionDir(dataDir, sessionId);
  const { digest } = saveContentArtifact(sDir, 'markdown', content);
  writeSession(dataDir, {
    session_id: sessionId,
    artifact_kind: 'markdown',
    state: 'FINAL',
    round: 1,
    updated_at: new Date().toISOString(),
    label: null,
    chain_id: 'ch_test_design_refs',
  });
  return digest;
}

function task(overrides = {}) {
  return { id: 'T001', design_refs: ['§19.5.2 計画の型'], ...overrides };
}

function plan(tasks) {
  return { plan_version: 1, summary: 'x', tasks };
}

test('上流本文に実在する見出し文字列を design_refs に持つ plan が通る', () => {
  const dataDir = tmpDataDir();
  const digest = seedUpstream(dataDir, 'rl_upstream1', '# 設計書\n\n## §19.5.2 計画の型\n本文です。\n');
  const p = plan([task({ design_refs: ['§19.5.2 計画の型'] })]);

  assert.equal(checkDesignRefs(dataDir, p, { session_id: 'rl_upstream1', artifact_digest: digest }), true);
});

test('上流本文に存在しない文字列を1件でも持つと E_PLAN_DESIGN_REF になり detail に task_id と ref が入る', () => {
  const dataDir = tmpDataDir();
  const digest = seedUpstream(dataDir, 'rl_upstream2', '# 設計書\n\n## §1.1 概要\n本文です。\n');
  const p = plan([task({ id: 'T002', design_refs: ['存在しない見出し'] })]);

  assert.throws(
    () => checkDesignRefs(dataDir, p, { session_id: 'rl_upstream2', artifact_digest: digest }),
    (err) => err.code === 'E_PLAN_DESIGN_REF' && err.detail.task_id === 'T002' && err.detail.ref === '存在しない見出し',
  );
});

test('CRLF・行末空白・NFD の差異があっても正規化後に一致すれば通る', () => {
  const dataDir = tmpDataDir();
  const bodyWithCrlfAndTrailingSpace = '# 設計書\r\n\r\n## §2.3 対象範囲   \r\n本文です。\r\n';
  const digest = seedUpstream(dataDir, 'rl_upstream3', bodyWithCrlfAndTrailingSpace);

  const nfdRef = '§2.3 対象範囲'.normalize('NFD');
  const p = plan([task({ design_refs: [nfdRef] })]);

  assert.equal(checkDesignRefs(dataDir, p, { session_id: 'rl_upstream3', artifact_digest: digest }), true);
});

test('照合対象がピンした artifact_digest の本文であり、現在の上流最新版ではない', () => {
  const dataDir = tmpDataDir();
  const pinnedDigest = seedUpstream(dataDir, 'rl_upstream4', '# 設計書\n\n## §3.1 ピン止め時点の見出し\n');
  // 上流はその後さらに改稿され、ピン止め時点には無かった見出しを追加する。
  const sDir = sessionDir(dataDir, 'rl_upstream4');
  saveContentArtifact(sDir, 'markdown', '# 設計書\n\n## §3.1 ピン止め時点の見出し\n\n## §3.2 後から足した見出し\n');

  const referencesOnlyLatestHeading = plan([task({ design_refs: ['§3.2 後から足した見出し'] })]);
  assert.throws(
    () => checkDesignRefs(dataDir, referencesOnlyLatestHeading, { session_id: 'rl_upstream4', artifact_digest: pinnedDigest }),
    { code: 'E_PLAN_DESIGN_REF' },
  );

  const referencesPinnedHeading = plan([task({ design_refs: ['§3.1 ピン止め時点の見出し'] })]);
  assert.equal(
    checkDesignRefs(dataDir, referencesPinnedHeading, { session_id: 'rl_upstream4', artifact_digest: pinnedDigest }),
    true,
  );
});
