import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../../src/tools/loop_open_create.js';
import { artifactCommit } from '../../src/tools/artifact_commit.js';
import { scoreSubmit } from '../../src/tools/score_submit.js';
import { readIndex } from '../../src/store/index_store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at11-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at11-${subCounter}`.padEnd(8, '0');
}

const CRITERION = {
  id: 'architecture_clarity',
  statement: 'アーキテクチャ設計と責務分割が明確に記述されていること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '設計が不明確である', 5: '概ね明確である', 9: '完全に明確である' },
};

const DESIGN_DOC = `# 設計書
## 1. 基本構成
システム全体のアーキテクチャ基本設計と責務分割を定義する。
`;

test('AT-11: 上流の版を知らずに下流を開こうとする（E_UPSTREAM_DIGEST_MISMATCH, E_UPSTREAM_REQUIRED, E_UPSTREAM_NOT_ALLOWED）', () => {
  const persistence = durablePersistence();
  const dataDir = persistence.dir;

  // 1. 正常な design セッションを開き、FINAL まで進める
  const openDesign = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'X-design',
      task: '上流ピン検証のための設計書作成タスクである。',
      rubric: { criteria: [CRITERION] },
    },
    pluginRoot,
    persistence,
  });

  const sessionA = openDesign.session_id;

  const commitDesign = artifactCommit({
    input: {
      session_id: sessionA,
      submission_id: subId(),
      expected_round: 1,
      content: DESIGN_DOC,
      change_note: '初版の設計書をコミットする。十分な長さの説明文である。',
    },
    persistence,
  });
  const designDigest = commitDesign.artifact.digest;

  scoreSubmit({
    input: {
      session_id: sessionA,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: designDigest,
      scores: [
        {
          criterion_id: 'architecture_clarity',
          score: 9,
          rationale: 'アーキテクチャ設計と責務分割が明確に記述されているため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: [
            {
              kind: 'locator',
              locator: 'spec.md#architecture_clarity',
              excerpt: 'システム全体のアーキテクチャ基本設計と責務分割を定義する。',
            },
          ],
        },
      ],
    },
    persistence,
  });

  const indexBeforeFails = readIndex(dataDir);
  assert.equal(Object.keys(indexBeforeFails.sessions).length, 1);

  // (a) 不正な上流 digest（sha256:000...）で plan を開こうとすると E_UPSTREAM_DIGEST_MISMATCH
  const fakeDigest = 'sha256:' + '0'.repeat(64);
  assert.throws(
    () =>
      loopOpenCreate({
        input: {
          mode: 'create',
          submission_id: subId(),
          loop_mode: 'plan',
          task: '不正な digest で plan セッションを開こうとする試みである。',
          upstream: {
            session_id: sessionA,
            artifact_digest: fakeDigest,
          },
          rubric_preset: 'plan',
        },
        pluginRoot,
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_UPSTREAM_DIGEST_MISMATCH');
      assert.equal(err.detail.expected, designDigest);
      assert.equal(err.detail.actual, fakeDigest);
      return true;
    }
  );

  // セッションは作られない（index.json に増えない）
  const indexAfterFail1 = readIndex(dataDir);
  assert.equal(Object.keys(indexAfterFail1.sessions).length, 1);

  // (b) upstream を省略して plan を開こうとすると E_UPSTREAM_REQUIRED または E_VALIDATION
  assert.throws(
    () =>
      loopOpenCreate({
        input: {
          mode: 'create',
          submission_id: subId(),
          loop_mode: 'plan',
          task: 'upstream を省略して plan セッションを開こうとする試みである。',
          rubric_preset: 'plan',
        },
        pluginRoot,
        persistence,
      }),
    (err) => {
      assert.ok(err.code === 'E_UPSTREAM_REQUIRED' || err.code === 'E_VALIDATION');
      return true;
    }
  );

  // セッションは作られない（index.json に増えない）
  const indexAfterFail2 = readIndex(dataDir);
  assert.equal(Object.keys(indexAfterFail2.sessions).length, 1);

  // (c) design モードなのに upstream を指定すると E_UPSTREAM_NOT_ALLOWED
  assert.throws(
    () =>
      loopOpenCreate({
        input: {
          mode: 'create',
          submission_id: subId(),
          loop_mode: 'design',
          task: 'design なのに upstream を指定して開こうとする試みである。',
          upstream: {
            session_id: sessionA,
            artifact_digest: designDigest,
          },
          rubric_preset: 'design',
        },
        pluginRoot,
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_UPSTREAM_NOT_ALLOWED');
      return true;
    }
  );

  // セッションは作られない（index.json に増えない）
  const indexAfterFail3 = readIndex(dataDir);
  assert.equal(Object.keys(indexAfterFail3.sessions).length, 1);
});
