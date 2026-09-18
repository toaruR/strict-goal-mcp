import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit, workspaceRootFromDataDir } from '../src/tools/artifact_commit.js';
import { sessionDir } from '../src/store/session_store.js';
import { computeContentDigest, readArtifactContent } from '../src/artifact/store.js';
import { normalize } from '../src/hash/digest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-srcpath-${submissionCounter}`.padEnd(8, '0');
}

const CHANGE_NOTE = 'これは20文字以上ある変更理由の説明文です';

// <workspace>/.strict-goal を data_dir とする通常配置
function workspaceFixture() {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'strict-goal-ws-'));
  const dataDir = path.join(workspace, '.strict-goal');
  mkdirSync(dataDir, { recursive: true });
  const persistence = { mode: 'durable', dir: dataDir, source: 'STRICT_GOAL_DATA' };
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });
  return { workspace, dataDir, persistence, sessionId: created.session_id };
}

function commit(persistence, sessionId, extra) {
  return artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      change_note: CHANGE_NOTE,
      ...extra,
    },
    persistence,
  });
}

test('workspaceRootFromDataDir: .strict-goal ならその親、それ以外は data_dir 自身', () => {
  assert.equal(
    workspaceRootFromDataDir(path.join('D:', 'ws', '.strict-goal')),
    path.resolve(path.join('D:', 'ws'))
  );
  assert.equal(workspaceRootFromDataDir(path.join('D:', 'sandbox')), path.resolve(path.join('D:', 'sandbox')));
});

test('source_path（相対）で commit すると content と同じ digest が保存される', () => {
  const { workspace, dataDir, persistence, sessionId } = workspaceFixture();
  const body = '# 設計書\n\nsource_path 経由で読み込まれる本文です。\n';
  writeFileSync(path.join(workspace, 'specification.md'), body, 'utf8');

  const result = commit(persistence, sessionId, { source_path: 'specification.md' });
  assert.equal(result.ok, true);
  assert.equal(result.state, 'SCORING');
  assert.equal(result.artifact.digest, computeContentDigest(body));
  assert.equal(result.artifact.bytes, Buffer.byteLength(normalize(body), 'utf8'));

  // 保存された成果物本文は content 経路と同じ正規化済み本文
  const sDir = sessionDir(dataDir, sessionId);
  const saved = readArtifactContent(sDir, result.artifact.digest, 'markdown');
  assert.equal(saved, normalize(body));

  // コミット記録に source_path が残る
  const record = JSON.parse(readFileSync(path.join(sDir, 'rounds', '1.commit.json'), 'utf8'));
  assert.equal(record.source_path, 'specification.md');
  assert.equal(record.digest, result.artifact.digest);
});

test('source_path（絶対・ワークスペース内）も受理される', () => {
  const { workspace, persistence, sessionId } = workspaceFixture();
  const body = '# 設計書\n絶対パス指定です。\n';
  const abs = path.join(workspace, 'docs', 'spec.md');
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');

  const result = commit(persistence, sessionId, { source_path: abs });
  assert.equal(result.ok, true);
  assert.equal(result.artifact.digest, computeContentDigest(body));
});

test('--data-dir 直指定（.strict-goal でない）配置でも data_dir 自身を根として解決する', () => {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), 'strict-goal-sandbox-'));
  const persistence = { mode: 'durable', dir: sandbox, source: 'STRICT_GOAL_DATA' };
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });
  const body = '# 設計書\nサンドボックス直下の成果物。\n';
  writeFileSync(path.join(sandbox, 'specification.md'), body, 'utf8');
  const result = commit(persistence, created.session_id, { source_path: 'specification.md' });
  assert.equal(result.ok, true);
  assert.equal(result.artifact.digest, computeContentDigest(body));
});

test('ワークスペース外の source_path は E_VALIDATION(outside_workspace)', () => {
  const { persistence, sessionId } = workspaceFixture();
  const outside = mkdtempSync(path.join(os.tmpdir(), 'strict-goal-outside-'));
  writeFileSync(path.join(outside, 'x.md'), '# 外部\n', 'utf8');

  for (const p of [path.join(outside, 'x.md'), path.join('..', path.basename(outside), 'x.md')]) {
    assert.throws(
      () => commit(persistence, sessionId, { source_path: p }),
      (err) => err.code === 'E_VALIDATION' && err.detail.reason === 'outside_workspace' && err.detail.path === '$.source_path'
    );
  }
});

test('存在しない source_path は E_VALIDATION(source_not_found)', () => {
  const { persistence, sessionId } = workspaceFixture();
  assert.throws(
    () => commit(persistence, sessionId, { source_path: 'missing.md' }),
    (err) => err.code === 'E_VALIDATION' && err.detail.reason === 'source_not_found'
  );
});

test('空ファイルの source_path は E_VALIDATION(source_empty)', () => {
  const { workspace, persistence, sessionId } = workspaceFixture();
  writeFileSync(path.join(workspace, 'empty.md'), '', 'utf8');
  assert.throws(
    () => commit(persistence, sessionId, { source_path: 'empty.md' }),
    (err) => err.code === 'E_VALIDATION' && err.detail.reason === 'source_empty'
  );
});

test('content と source_path の同時指定は E_VALIDATION(oneOf_content_or_files)', () => {
  const { workspace, persistence, sessionId } = workspaceFixture();
  writeFileSync(path.join(workspace, 'specification.md'), '# a\n', 'utf8');
  assert.throws(
    () => commit(persistence, sessionId, { source_path: 'specification.md', content: '# b\n' }),
    (err) => err.code === 'E_VALIDATION' && err.detail.reason === 'oneOf_content_or_files'
  );
  // どちらも無しも従来どおり拒否
  assert.throws(
    () => commit(persistence, sessionId, {}),
    (err) => err.code === 'E_VALIDATION' && err.detail.reason === 'oneOf_content_or_files'
  );
});
