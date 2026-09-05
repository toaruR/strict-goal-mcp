import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../../src/tools/loop_open_create.js';
import { artifactCommit } from '../../src/tools/artifact_commit.js';
import { scoreSubmit } from '../../src/tools/score_submit.js';
import { auditExport } from '../../src/tools/audit_export.js';
import { computeManifestDigest } from '../../src/artifact/fileset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at14-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at14-${subCounter}`.padEnd(8, '0');
}

const DESIGN_CRITERION = {
  id: 'design_spec',
  statement: '基本設計が妥当であること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '設計に破綻がある', 5: '概ね妥当である', 9: '完全に妥当である' },
};

const PLAN_CRITERION = {
  id: 'plan_feasibility',
  statement: '計画が実現可能であること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '実現不能である', 5: '概ね可能である', 9: '完全に可能である' },
};

const IMPL_CRITERIA = [
  {
    id: 'tests_green',
    statement: '全テストが成功していること',
    weight: 2,
    verification: 'auto',
    anchors: { 1: 'テストが失敗する', 5: '大半成功する', 9: '全テスト成功する' },
  },
  {
    id: 'code_quality',
    statement: 'コード品質が良好であること',
    weight: 1,
    verification: 'manual',
    anchors: { 1: '品質が悪い状態', 5: '概ね良質な状態', 9: '極めて高品質である' },
  },
];

function buildTestList(count) {
  const tests = [];
  for (let i = 1; i <= count; i++) {
    tests.push({
      id: `test/feature_${i}.test.js::works`,
      file: `test/feature_${i}.test.js`,
      status: 'passed',
    });
  }
  return tests;
}

test('AT-14: 実装モードのごまかし検出（テスト削除・skip増加・未添付・理由つき受理）', () => {
  const persistence = durablePersistence();
  const dataDir = persistence.dir;

  // 1. 上流 design & plan を作成して FINAL にする
  const openDesign = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'design-14',
      task: '基本設計書を作成するタスクである。十分な長さの説明文を確保する。',
      rubric: { criteria: [DESIGN_CRITERION] },
    },
    pluginRoot,
    persistence,
  });
  const commitDesign = artifactCommit({
    input: {
      session_id: openDesign.session_id,
      submission_id: subId(),
      expected_round: 1,
      content: '# 基本設計書\nアーキテクチャ概要と設計方針を記述する。\n',
      change_note: '初版の設計書をコミットする。十分な長さの説明文である。',
    },
    persistence,
  });
  scoreSubmit({
    input: {
      session_id: openDesign.session_id,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: commitDesign.artifact.digest,
      scores: [
        {
          criterion_id: 'design_spec',
          score: 9,
          rationale: '設計書が完全に記述されているため9点とする。十分な文字数を確保するための補足説明文である。',
          weakness: '更なる改善余地がある。',
          evidence: [
            {
              kind: 'locator',
              locator: 'spec#arch',
              excerpt: 'アーキテクチャ概要と設計方針を記述する。',
            },
          ],
        },
      ],
    },
    persistence,
  });

  const planTasks = [
    {
      id: 'T001',
      title: '実装タスク',
      intent: '基本設計に従って機能を実装するタスクである。十分な文字数の意図説明文。',
      design_refs: ['アーキテクチャ概要と設計方針を記述する。'],
      depends_on: [],
      changes: [{ path: 'src/app.js', kind: 'add' }],
      acceptance: ['全機能が正常に動作することを確認するための十分な受け入れ条件である'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
  ];
  const openPlan = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'plan',
      label: 'plan-14',
      task: '実装計画書を作成するタスクである。十分な長さの説明文を確保する。',
      upstream: { session_id: openDesign.session_id, artifact_digest: commitDesign.artifact.digest },
      rubric: { criteria: [PLAN_CRITERION] },
    },
    pluginRoot,
    persistence,
  });
  const commitPlan = artifactCommit({
    input: {
      session_id: openPlan.session_id,
      submission_id: subId(),
      expected_round: 1,
      content: JSON.stringify({
        plan_version: 1,
        summary: '実装計画書の初版であり、全タスクの依存関係と受け入れ条件を明確に定義する。十分な文字数を確保する。',
        tasks: planTasks,
      }),
      change_note: '初版の計画書をコミットする。十分な長さの説明文である。',
    },
    persistence,
  });
  scoreSubmit({
    input: {
      session_id: openPlan.session_id,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: commitPlan.artifact.digest,
      scores: [
        {
          criterion_id: 'plan_feasibility',
          score: 9,
          rationale: '計画が実現可能であるため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なる改善余地がある。',
          evidence: [
            {
              kind: 'upstream',
              upstream_locator: 'spec#arch',
              excerpt: 'アーキテクチャ概要と設計方針を記述する。',
            },
          ],
        },
      ],
    },
    persistence,
  });

  // 2. implement セッション CCC を作成
  const openImpl = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'implement',
      label: 'impl-14',
      task: '計画に基づいて実装するタスクである。十分な長さの説明文を確保する。',
      upstream: { session_id: openPlan.session_id, artifact_digest: commitPlan.artifact.digest },
      rubric: { criteria: IMPL_CRITERIA },
    },
    pluginRoot,
    persistence,
  });
  const sessionCCC = openImpl.session_id;

  // round 1: test_inventory 未添付なら E_TEST_INVENTORY_REQUIRED になること
  const files1 = [
    { path: 'src/app_controller_module.js', sha256: 'a'.repeat(64), bytes: 100, role: 'source' },
    { path: 'test/app_controller_module.test.js', sha256: 'b'.repeat(64), bytes: 120, role: 'test' },
  ];
  const manifestCmd = 'git ls-files -s';
  const manifestSha1 = computeManifestDigest(files1);

  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: sessionCCC,
          submission_id: subId(),
          expected_round: 1,
          files: files1,
          manifest_command: manifestCmd,
          manifest_output_sha256: manifestSha1,
          change_note: 'test_inventory を添付しない提出。十分な長さの説明文である。',
        },
        persistence,
      }),
    (err) => err.code === 'E_TEST_INVENTORY_REQUIRED',
  );

  // 正しい test_inventory (126件) で round 1 をコミット
  const tests126 = buildTestList(126);
  const testInvRound1 = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'c'.repeat(64),
    counts: { total: 126, passed: 126, failed: 0, skipped: 0 },
    tests: tests126,
  };

  const commitImpl1 = artifactCommit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 1,
      files: files1,
      manifest_command: manifestCmd,
      manifest_output_sha256: manifestSha1,
      test_inventory: testInvRound1,
      change_note: '初版の実装コードとテスト成果物を提出する。十分な長さの説明文である。',
    },
    persistence,
  });
  assert.equal(commitImpl1.accepted, true);

  // round 1 を採点 (7点で REVISE にして round 2 へ進める)
  const scoreImpl1 = scoreSubmit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: commitImpl1.artifact.digest,
      scores: [
        {
          criterion_id: 'tests_green',
          score: 9,
          rationale: '全テストが完全にグリーンであるため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '特段の弱点や欠陥は見当たらない。',
          evidence: [
            {
              kind: 'command',
              command: 'npm test',
              exit_code: 0,
              output_excerpt: '126 passed',
              output_sha256: 'c'.repeat(64),
              target_digest: commitImpl1.artifact.digest,
            },
          ],
        },
        {
          criterion_id: 'code_quality',
          score: 6,
          rationale: 'コード品質に改善の余地があるため6点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: 'リファクタリングが必要である。',
          evidence: [
            {
              kind: 'locator',
              locator: 'manifest.json',
              excerpt: 'src/app_controller_module.js',
            },
          ],
        },
      ],
    },
    persistence,
  });
  assert.equal(scoreImpl1.state, 'DRAFTING');
  assert.equal(scoreImpl1.round, 2);

  // round 2:
  // (a) 説明なきテスト削除 (126 -> 121 件、removed_tests: [])
  const files2 = [
    { path: 'src/app_controller_module.js', sha256: 'd'.repeat(64), bytes: 110, role: 'source' },
    { path: 'test/app_controller_module.test.js', sha256: 'b'.repeat(64), bytes: 120, role: 'test' },
  ];
  const manifestSha2 = computeManifestDigest(files2);

  const tests121 = tests126.slice(0, 121);
  const testInvDecreasedUnexplained = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'f'.repeat(64),
    counts: { total: 121, passed: 121, failed: 0, skipped: 0 },
    tests: tests121,
    removed_tests: [],
  };

  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: sessionCCC,
          submission_id: subId(),
          expected_round: 2,
          files: files2,
          manifest_command: manifestCmd,
          manifest_output_sha256: manifestSha2,
          test_inventory: testInvDecreasedUnexplained,
          change_note: '落ちるテストを勝手に整理した提出。十分な長さの説明文である。',
          addresses: ['code_quality'],
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_TEST_REGRESSION');
      assert.equal(err.detail.check, 'R3');
      assert.equal(err.detail.prev, 126);
      assert.equal(err.detail.now, 121);
      assert.equal(err.detail.unexplained.length, 5);
      return true;
    },
  );

  // 拒否された提出が rounds/2.rejected/1.json に保存されていること
  const rejected1Path = path.join(dataDir, 'sessions', sessionCCC, 'rounds', '2.rejected', '1.json');
  assert.ok(existsSync(rejected1Path));
  const rejected1 = JSON.parse(readFileSync(rejected1Path, 'utf8'));
  assert.equal(rejected1.round, 2);
  assert.equal(rejected1.error.code, 'E_TEST_REGRESSION');

  // (b) skip 数増加 (skipped: 1)
  const testInvSkipIncreased = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: '7'.repeat(64),
    counts: { total: 126, passed: 125, failed: 0, skipped: 1 },
    tests: [
      ...tests126.slice(0, 125),
      { id: tests126[125].id, file: tests126[125].file, status: 'skipped' },
    ],
  };

  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: sessionCCC,
          submission_id: subId(),
          expected_round: 2,
          files: files2,
          manifest_command: manifestCmd,
          manifest_output_sha256: manifestSha2,
          test_inventory: testInvSkipIncreased,
          change_note: 'テストをスキップに変更した提出。十分な長さの説明文である。',
          addresses: ['code_quality'],
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_TEST_REGRESSION');
      assert.equal(err.detail.skip_delta, 1);
      return true;
    },
  );

  // 拒否された提出が rounds/2.rejected/2.json に保存されていること
  const rejected2Path = path.join(dataDir, 'sessions', sessionCCC, 'rounds', '2.rejected', '2.json');
  assert.ok(existsSync(rejected2Path));
  const rejected2 = JSON.parse(readFileSync(rejected2Path, 'utf8'));
  assert.equal(rejected2.error.code, 'E_TEST_REGRESSION');

  // (c) 削除理由を添えた再提出: 受理され warnings に test_count_decreased が含まれること
  const removed5 = tests126.slice(121).map((t) => ({
    id: t.id,
    reason: '仕様変更により不要となった重複テストケースを正当に削除した。',
  }));

  const testInvDecreasedExplained = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: '8'.repeat(64),
    counts: { total: 121, passed: 121, failed: 0, skipped: 0 },
    tests: tests121,
    removed_tests: removed5,
  };

  const commitAccepted = artifactCommit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 2,
      files: files2,
      manifest_command: manifestCmd,
      manifest_output_sha256: manifestSha2,
      test_inventory: testInvDecreasedExplained,
      change_note: '不要なテストを理由つきで削除してリファクタリング完了した提出。十分な長さ。',
      addresses: ['code_quality'],
    },
    persistence,
  });

  assert.equal(commitAccepted.accepted, true);
  assert.ok(commitAccepted.warnings.includes('test_count_decreased'));

  // (d) audit_export で rejected_submissions が 3 件記録されていること（round 1 で 1 件、round 2 で 2 件）
  const auditRes = auditExport({
    input: {
      session_id: sessionCCC,
      scope: 'session',
    },
    persistence,
  });
  const auditData = JSON.parse(readFileSync(auditRes.export.path, 'utf8'));
  assert.equal(auditData.rejected_submissions.length, 3);
});
