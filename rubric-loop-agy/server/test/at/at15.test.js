import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
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
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at15-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at15-${subCounter}`.padEnd(8, '0');
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

test('AT-15: 実装モードのごまかし検出（結果の使い回しとアサート弱化）', () => {
  const persistence = durablePersistence();

  // 1. 上流 design & plan を作成して FINAL にする
  const openDesign = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'design-15',
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
      label: 'plan-15',
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
      label: 'impl-15',
      task: '計画に基づいて実装するタスクである。十分な長さの説明文を確保する。',
      upstream: { session_id: openPlan.session_id, artifact_digest: commitPlan.artifact.digest },
      rubric: { criteria: IMPL_CRITERIA },
    },
    pluginRoot,
    persistence,
  });
  const sessionCCC = openImpl.session_id;

  // round 1 コミット
  const files1 = [
    { path: 'src/main_application_component.js', sha256: '1'.repeat(64), bytes: 100, role: 'source' },
    { path: 'test/foo.test.js', sha256: '2'.repeat(64), bytes: 120, role: 'test' },
  ];
  const manifestCmd = 'git ls-files -s';
  const manifestSha1 = computeManifestDigest(files1);
  const testInv1 = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'a'.repeat(64),
    counts: { total: 10, passed: 10, failed: 0, skipped: 0 },
    tests: [
      { id: 'test/foo.test.js::test1', file: 'test/foo.test.js', status: 'passed' },
    ],
  };

  const commitImpl1 = artifactCommit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 1,
      files: files1,
      manifest_command: manifestCmd,
      manifest_output_sha256: manifestSha1,
      test_inventory: testInv1,
      change_note: '初版の実装コードとテストをコミットする。十分な長さの説明文である。',
    },
    persistence,
  });
  const digest1 = commitImpl1.artifact.digest;

  // (a) 古い結果の使い回し: command 根拠の target_digest が現在の成果物と不一致
  const staleTargetDigest = 'sha256:' + '9'.repeat(64);
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionCCC,
          submission_id: subId(),
          expected_round: 1,
          artifact_digest: digest1,
          scores: [
            {
              criterion_id: 'tests_green',
              score: 9,
              rationale: '古いテスト結果を使い回して採点しようとする試みである。十分な文字数を確保するための説明文。',
              weakness: '特段の弱点や欠陥は見当たらない。',
              evidence: [
                {
                  kind: 'command',
                  command: 'npm test',
                  exit_code: 0,
                  output_excerpt: '10 passed',
                  output_sha256: 'a'.repeat(64),
                  target_digest: staleTargetDigest,
                },
              ],
            },
            {
              criterion_id: 'code_quality',
              score: 9,
              rationale: 'コード品質が良好であるため9点とする。十分な文字数を確保するための補足説明文である。',
              weakness: '特段の弱点や欠陥は見当たらない。',
              evidence: [
                {
                  kind: 'locator',
                  locator: 'manifest.json',
                  excerpt: 'src/main_application_component.js',
                },
              ],
            },
          ],
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_EVIDENCE_TARGET');
      assert.equal(err.detail.expected, digest1);
      assert.equal(err.detail.actual, staleTargetDigest);
      assert.equal(err.detail.criterion_id, 'tests_green');
      return true;
    },
  );

  // (b) target_digest を書き忘れる
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionCCC,
          submission_id: subId(),
          expected_round: 1,
          artifact_digest: digest1,
          scores: [
            {
              criterion_id: 'tests_green',
              score: 9,
              rationale: 'target_digest を欠落させた状態で採点しようとする試み。十分な文字数を確保するための説明文。',
              weakness: '特段の弱点や欠陥は見当たらない。',
              evidence: [
                {
                  kind: 'command',
                  command: 'npm test',
                  exit_code: 0,
                  output_excerpt: '10 passed',
                  output_sha256: 'a'.repeat(64),
                },
              ],
            },
            {
              criterion_id: 'code_quality',
              score: 9,
              rationale: 'コード品質が良好であるため9点とする。十分な文字数を確保するための補足説明文である。',
              weakness: '特段の弱点や欠陥は見当たらない。',
              evidence: [
                {
                  kind: 'locator',
                  locator: 'manifest.json',
                  excerpt: 'src/main_application_component.js',
                },
              ],
            },
          ],
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_EVIDENCE_TARGET');
      assert.equal(err.detail.reason, 'target_digest_required_in_implement_mode');
      return true;
    },
  );

  // 正しい採点で round 1 を完了し (REVISE: code_quality 6点)、round 2 へ進める
  const validScore1 = scoreSubmit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: digest1,
      scores: [
        {
          criterion_id: 'tests_green',
          score: 9,
          rationale: '全テストが完全にパスしているため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '特段の弱点や欠陥は見当たらない。',
          evidence: [
            {
              kind: 'command',
              command: 'npm test',
              exit_code: 0,
              output_excerpt: '10 passed',
              output_sha256: 'a'.repeat(64),
              target_digest: digest1,
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
              excerpt: 'src/main_application_component.js',
            },
          ],
        },
      ],
    },
    persistence,
  });
  assert.equal(validScore1.state, 'DRAFTING');
  assert.equal(validScore1.round, 2);

  // (c) アサート弱化: test/foo.test.js の sha256 を変更し、test_inventory.diffs: [] のまま提出
  const files2Mutated = [
    { path: 'src/main_application_component.js', sha256: '3'.repeat(64), bytes: 110, role: 'source' },
    { path: 'test/foo.test.js', sha256: '4'.repeat(64), bytes: 120, role: 'test' },
  ];
  const manifestSha2 = computeManifestDigest(files2Mutated);

  const testInvMutatedNoDiff = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'b'.repeat(64),
    counts: { total: 10, passed: 10, failed: 0, skipped: 0 },
    tests: [
      { id: 'test/foo.test.js::test1', file: 'test/foo.test.js', status: 'passed' },
    ],
    diffs: [],
  };

  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: sessionCCC,
          submission_id: subId(),
          expected_round: 2,
          files: files2Mutated,
          manifest_command: manifestCmd,
          manifest_output_sha256: manifestSha2,
          test_inventory: testInvMutatedNoDiff,
          change_note: 'テストを改変したが差分を添付していない提出。十分な長さの説明文である。',
          addresses: ['code_quality'],
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_TEST_MUTATED_WITHOUT_DIFF');
      assert.deepEqual(err.detail.files, ['test/foo.test.js']);
      return true;
    },
  );

  // 差分を添えた弱化提出は受理されること
  const testInvMutatedWithDiff = {
    ...testInvMutatedNoDiff,
    diffs: [
      {
        file: 'test/foo.test.js',
        command: 'git diff test/foo.test.js',
        output_excerpt: '--- test/foo.test.js\n+++ test/foo.test.js\n@@ -1 +1 @@\n-assert.equal(val, 100);\n+assert.ok(val >= 0);',
        output_sha256: 'a'.repeat(64),
      },
    ],
  };

  const commitWithDiff = artifactCommit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 2,
      files: files2Mutated,
      manifest_command: manifestCmd,
      manifest_output_sha256: manifestSha2,
      test_inventory: testInvMutatedWithDiff,
      change_note: 'テストの期待値を仕様に合わせて修正し差分を添付した提出。十分な長さの説明文である。',
      addresses: ['code_quality'],
    },
    persistence,
  });
  assert.equal(commitWithDiff.accepted, true);
  const digest2 = commitWithDiff.artifact.digest;

  // (d) テストが赤いまま auto 基準に 9 点
  // ここで test_inventory は failed: 0 だったので、一旦 REVISE にして round 3 で failed: 3 をコミット
  scoreSubmit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 2,
      artifact_digest: digest2,
      scores: [
        {
          criterion_id: 'tests_green',
          score: 9,
          rationale: '全テストが通っているため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '特段の弱点や欠陥は見当たらない。',
          evidence: [
            {
              kind: 'command',
              command: 'npm test',
              exit_code: 0,
              output_excerpt: '10 passed',
              output_sha256: 'b'.repeat(64),
              target_digest: digest2,
            },
          ],
        },
        {
          criterion_id: 'code_quality',
          score: 7,
          rationale: 'コード品質が少し改善されたため7点とする。十分な文字数を確保するための補足説明文である。',
          weakness: 'あと少しリファクタが必要である。',
          evidence: [
            {
              kind: 'locator',
              locator: 'manifest.json',
              excerpt: '4'.repeat(64),
            },
          ],
        },
      ],
    },
    persistence,
  });

  // round 3 コミット (failed: 3 の test_inventory)
  const files3 = [
    { path: 'src/main_application_component.js', sha256: '5'.repeat(64), bytes: 120, role: 'source' },
    { path: 'test/foo.test.js', sha256: '4'.repeat(64), bytes: 120, role: 'test' },
  ];
  const manifestSha3 = computeManifestDigest(files3);
  const testInvFailed = {
    source_command: 'npm test',
    source_exit_code: 1,
    source_output_sha256: 'c'.repeat(64),
    counts: { total: 10, passed: 7, failed: 3, skipped: 0 },
    tests: [
      { id: 'test/foo.test.js::test1', file: 'test/foo.test.js', status: 'passed' },
      { id: 'test/foo.test.js::test2', file: 'test/foo.test.js', status: 'failed' },
      { id: 'test/foo.test.js::test3', file: 'test/foo.test.js', status: 'failed' },
      { id: 'test/foo.test.js::test4', file: 'test/foo.test.js', status: 'failed' },
    ],
  };

  const commitFailed = artifactCommit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 3,
      files: files3,
      manifest_command: manifestCmd,
      manifest_output_sha256: manifestSha3,
      test_inventory: testInvFailed,
      change_note: 'テストが一部失敗している状態での中間成果物提出。十分な長さの説明文である。',
      addresses: ['code_quality'],
    },
    persistence,
  });
  const digest3 = commitFailed.artifact.digest;

  // テストが赤いのに auto 基準 (tests_green) に 9 点を出すと E_TEST_NOT_GREEN
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionCCC,
          submission_id: subId(),
          expected_round: 3,
          artifact_digest: digest3,
          scores: [
            {
              criterion_id: 'tests_green',
              score: 9,
              rationale: 'テストが失敗しているにもかかわらず9点を付ける試み。十分な文字数を確保するための説明文。',
              weakness: '特段の弱点や欠陥は見当たらない。',
              evidence: [
                {
                  kind: 'command',
                  command: 'npm test',
                  exit_code: 1,
                  output_excerpt: '3 failed',
                  output_sha256: 'c'.repeat(64),
                  target_digest: digest3,
                },
              ],
            },
            {
              criterion_id: 'code_quality',
              score: 8,
              rationale: 'コード品質が8点であると判定した。十分な文字数を確保するための補足説明文である。',
              weakness: '特段の弱点や欠陥は見当たらない。',
              evidence: [
                {
                  kind: 'locator',
                  locator: 'manifest.json',
                  excerpt: 'src/main_application_component.js',
                },
              ],
            },
          ],
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_TEST_NOT_GREEN');
      assert.deepEqual(err.detail.criteria, ['tests_green']);
      assert.equal(err.detail.failed, 3);
      return true;
    },
  );
});
