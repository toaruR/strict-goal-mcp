// T076: パッケージ骨格と7ツールの疎通のみを見る最小スイート。PLUGIN_DATA は一時ディレクトリに向ける。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { rubricAmend } from '../src/tools/rubric_amend.js';
import { escalate } from '../src/tools/escalate.js';
import { auditExport } from '../src/tools/audit_export.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-smoke-'));
}
function durablePersistence() {
  // 利用者の実データを汚さないよう常に一時ディレクトリを PLUGIN_DATA として使う。
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

test('パッケージ骨格: plugin.json/mcp.json/skills/server/main.js が存在する', () => {
  assert.ok(existsSync(path.join(packageRoot, 'plugin.json')));
  assert.ok(existsSync(path.join(packageRoot, 'mcp.json')));
  assert.ok(existsSync(path.join(packageRoot, 'skills', 'strict-goal', 'SKILL.md')));
  assert.ok(existsSync(path.join(packageRoot, 'server', 'main.js')));
});

test('7ツールが一通り疎通する（loop_open→loop_state→rubric_amend→artifact_commit→score_submit→escalate→audit_export）', () => {
  const persistence = durablePersistence();
  const criterion = {
    id: 'impl_works',
    statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
    weight: 1,
    verification: 'manual',
    anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
  };

  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: 'sub-smoke-0001',
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: { criteria: [criterion] },
    },
    persistence,
  });
  assert.equal(created.state, 'DRAFTING');

  const state1 = loopState({ input: { session_id: created.session_id }, persistence });
  assert.equal(state1.state, 'DRAFTING');

  const amended = rubricAmend({
    input: {
      session_id: created.session_id,
      submission_id: 'sub-smoke-0002',
      expected_round: 1,
      criteria: [criterion],
      reason: 'a'.repeat(45),
    },
    persistence,
  });
  assert.equal(amended.state, 'DRAFTING');

  const content = '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。';
  const committed = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: 'sub-smoke-0003',
      expected_round: 1,
      content,
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });
  assert.equal(committed.state, 'SCORING');

  const scored = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: 'sub-smoke-0004',
      expected_round: 1,
      artifact_digest: committed.artifact.digest,
      scores: [
        {
          criterion_id: 'impl_works',
          score: 5,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: '実装は完全に動作することを実行ログで確認したという記録がある。' }],
        },
      ],
    },
    persistence,
  });
  assert.equal(scored.verdict, 'ITERATING');

  const aborted = escalate({
    input: {
      session_id: created.session_id,
      submission_id: 'sub-smoke-0005',
      action: 'abort',
      note: 'a'.repeat(45),
    },
    persistence,
  });
  assert.equal(aborted.state, 'ABORTED');

  const audit = auditExport({ input: { session_id: created.session_id }, persistence });
  assert.equal(audit.session_id, created.session_id);
  assert.ok(existsSync(audit.export.path));
});
