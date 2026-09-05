import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../../src/tools/loop_open_create.js';
import { artifactCommit } from '../../src/tools/artifact_commit.js';
import { scoreSubmit } from '../../src/tools/score_submit.js';
import { loopState } from '../../src/tools/loop_state.js';
import { escalate } from '../../src/tools/escalate.js';
import { computeManifestDigest } from '../../src/artifact/fileset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at12-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at12-${subCounter}`.padEnd(8, '0');
}

const PLAN_CRITERION = {
  id: 'plan_task_soundness',
  statement: '計画の構成と依存関係が妥当であること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '破綻がある', 5: '概ね妥当である', 9: '完全に妥当である' },
};

const IMPL_CRITERIA = [
  {
    id: 'plan_task_completion',
    statement: '計画されたタスクが漏れなく完了していること',
    weight: 2,
    verification: 'manual',
    anchors: { 1: '未完了である', 5: '一部完了している', 9: '完全に完了している' },
  },
  {
    id: 'acceptance_satisfied',
    statement: '計画の受け入れ条件がすべて満たされていること',
    weight: 2,
    verification: 'manual',
    anchors: { 1: '条件未達である', 5: '概ね満たす', 9: '完全に満たしている' },
  },
  {
    id: 'tests_green',
    statement: 'テストが全件パスしていること',
    weight: 1,
    verification: 'manual',
    anchors: { 1: 'テスト失敗がある', 5: '概ねパスする', 9: '全テストが完全に通る' },
  },
];

const PLAN_DOC_V1 = JSON.stringify({
  plan_version: 1,
  summary: '初版の実装計画書であり、T001からT004までのタスク構成と検証手順を定義する。十分な文字数を確保する。',
  tasks: [
    {
      id: 'T001',
      title: '初期タスク',
      intent: '初期タスクの実装を行うための十分な文字数の意図説明文である。',
      design_refs: ['§1.1'],
      depends_on: [],
      changes: [{ path: 'src/init.js', kind: 'add' }],
      acceptance: ['初期化が正常に完了すること'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
    {
      id: 'T004',
      title: '依存タスク',
      intent: 'T004タスクの実装を行うための十分な文字数の意図説明文である。',
      design_refs: ['§1.2'],
      depends_on: ['T001'],
      changes: [{ path: 'src/main.js', kind: 'add' }],
      acceptance: ['旧版メイン機能が正常に動作することを確認するための受け入れ条件である'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
  ],
});

const PLAN_DOC_V2 = JSON.stringify({
  plan_version: 1,
  summary: '改訂版の実装計画書であり、T004の依存関係を見直して再構成した計画である。十分な文字数を確保する。',
  tasks: [
    {
      id: 'T001',
      title: '初期タスク修正版',
      intent: '初期タスクの修正版を実装するための十分な文字数の意図説明文である。',
      design_refs: ['§1.1'],
      depends_on: ['T004'],
      changes: [{ path: 'src/init.js', kind: 'add' }],
      acceptance: ['初期化が正常に完了することを確認するための十分な受け入れ条件である'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
    {
      id: 'T004',
      title: '修正後タスク',
      intent: '修正後タスクの実装を行うための十分な文字数の意図説明文である。',
      design_refs: ['§1.2'],
      depends_on: [],
      changes: [{ path: 'src/main.js', kind: 'add' }],
      acceptance: ['改訂後のメイン機能が正常に動作することを確認するための受け入れ条件である'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
  ],
});

test('AT-12: 上流変更による下流の失効と部分再検証（reopen -> FROZEN -> SUPERSEDED -> rebase）', () => {
  const persistence = durablePersistence();
  const dataDir = persistence.dir;

  // 1. 上流セッション BBB (plan モード) を開き、FINAL まで進める
  // （design セッション AAA をまず作って FINAL にする）
  const openDesign = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      task: 'AT-12検証用の設計書作成タスクである。十分な長さの説明文。',
      rubric: {
        criteria: [
          {
            id: 'design_spec',
            statement: '設計仕様が明確であること',
            weight: 1,
            verification: 'manual',
            anchors: { 1: '不明確である状態', 5: '概ね明確である状態', 9: '完全に明確である状態' },
          },
        ],
      },
    },
    pluginRoot,
    persistence,
  });
  const commitDesign = artifactCommit({
    input: {
      session_id: openDesign.session_id,
      submission_id: subId(),
      expected_round: 1,
      content: '# 設計仕様書\n§1.1 初期化仕様\n§1.2 メイン機能仕様\n',
      change_note: '初版の設計仕様書を作成した。十分な文字数の変更注記文である。',
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
          rationale: '設計仕様が極めて明確に記述されているため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: [
            {
              kind: 'locator',
              locator: 'spec.md#design_spec',
              excerpt: '§1.1 初期化仕様\n§1.2 メイン機能仕様\n',
            },
          ],
        },
      ],
    },
    persistence,
  });

  // plan セッション BBB
  const openPlan = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'plan',
      label: 'BBB',
      task: 'AT-12検証用の実装計画タスクである。十分な長さの説明文。',
      upstream: {
        session_id: openDesign.session_id,
        artifact_digest: commitDesign.artifact.digest,
      },
      rubric: { criteria: [PLAN_CRITERION] },
    },
    pluginRoot,
    persistence,
  });
  const sessionBBB = openPlan.session_id;

  const commitPlan1 = artifactCommit({
    input: {
      session_id: sessionBBB,
      submission_id: subId(),
      expected_round: 1,
      content: PLAN_DOC_V1,
      change_note: '初版の実装計画書を作成して提出する。十分な長さの説明文である。',
    },
    persistence,
  });
  const planDigest1 = commitPlan1.artifact.digest;

  scoreSubmit({
    input: {
      session_id: sessionBBB,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: planDigest1,
      scores: [
        {
          criterion_id: 'plan_task_soundness',
          score: 9,
          rationale: '計画の構成と依存関係が完全に妥当であるため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: [
            {
              kind: 'locator',
              locator: 'plan.json#soundness',
              excerpt: 'T001からT004までのタスク構成と検証手順を定義する。',
            },
          ],
        },
      ],
    },
    persistence,
  });

  // 2. 下流セッション CCC (implement モード) を開き、round 1 でコミット & 採点（FINAL）
  const openImpl = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'implement',
      label: 'CCC',
      task: '計画に基づいてコードとテストを実装するタスクである。十分な長さの説明文。',
      upstream: {
        session_id: sessionBBB,
        artifact_digest: planDigest1,
      },
      rubric: { criteria: IMPL_CRITERIA },
    },
    pluginRoot,
    persistence,
  });
  const sessionCCC = openImpl.session_id;

  const files1 = [
    { path: 'src/main_application_component_v1.js', sha256: 'a'.repeat(64), bytes: 100, role: 'source' },
    { path: 'test/main_application_component_v1.test.js', sha256: 'b'.repeat(64), bytes: 120, role: 'test' },
  ];
  const manifestCmd = 'git ls-files -s';
  const manifestSha1 = computeManifestDigest(files1);
  const testInv1 = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'c'.repeat(64),
    counts: { total: 2, passed: 2, failed: 0, skipped: 0 },
    tests: [
      { id: 'test/main.test.js::test1', file: 'test/main.test.js', status: 'passed' },
      { id: 'test/main.test.js::test2', file: 'test/main.test.js', status: 'passed' },
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
      change_note: '初版の実装成果物を提出する。十分な長さの説明文である。',
    },
    persistence,
  });
  const implDigest1 = commitImpl1.artifact.digest;

  // CCC を採点し、upstream 根拠（上流の計画本文からの引用）をつけて評価する
  scoreSubmit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: implDigest1,
      scores: [
        {
          criterion_id: 'plan_task_completion',
          score: 9,
          rationale: '計画タスクが完全に完了しているため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: [
            {
              kind: 'upstream',
              upstream_locator: 'plan.json#T004',
              // この excerpt は PLAN_DOC_V1 にのみ存在し、V2 には存在しないため、rebase 時に失効する
              excerpt: 'T001からT004までのタスク構成と検証手順を定義する。',
            },
          ],
        },
        {
          criterion_id: 'acceptance_satisfied',
          score: 9,
          rationale: '計画の受け入れ条件が満たされているため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: [
            {
              kind: 'upstream',
              upstream_locator: 'plan.json#acc',
              // この excerpt も V1 にのみ存在し、V2 には存在しないため、rebase 時に失効する
              excerpt: '旧版メイン機能が正常に動作することを確認するための受け入れ条件である',
            },
          ],
        },
        {
          criterion_id: 'tests_green',
          score: 9,
          rationale: '全テストが完全に通っているため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: [
            {
              kind: 'locator',
              locator: 'manifest.json',
              excerpt: 'src/main_application_component_v1.js',
            },
          ],
        },
      ],
    },
    persistence,
  });

  // Step 1: BBB を reopen する（FINAL -> DRAFTING, round += 1）
  const reopenRes = escalate({
    input: {
      session_id: sessionBBB,
      submission_id: subId(),
      action: 'reopen',
      human_token: 'token-human-reopen-bbb-001',
      note: 'T004 の依存が逆で実装できないため計画を再検討する。40文字以上の詳細な説明文である。',
    },
    persistence,
  });
  assert.equal(reopenRes.state, 'DRAFTING');
  assert.equal(reopenRes.round, 2);
  assert.ok(reopenRes.reopened.length > 0);
  assert.equal(reopenRes.reopened[0].previous_final_digest, planDigest1);

  // Step 2: CCC の状態を確認すると、上流が DRAFTING のため FROZEN になっている
  const stateFrozen = loopState({
    input: {
      session_id: sessionCCC,
    },
    persistence,
  });
  assert.equal(stateFrozen.state, 'FROZEN');

  // Step 3: FROZEN 状態で CCC に artifact_commit を呼ぶと E_FROZEN で拒否される
  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: sessionCCC,
          submission_id: subId(),
          expected_round: 2,
          content: '# 凍結中の無効なコミット\n',
          change_note: '凍結中に提出を試みる無効なコミットである。',
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_FROZEN');
      assert.equal(err.detail.upstream_session_id, sessionBBB);
      return true;
    }
  );

  // Step 4: BBB が新しい成果物 PLAN_DOC_V2 で再びコミットし FINAL に達する
  const commitPlan2 = artifactCommit({
    input: {
      session_id: sessionBBB,
      submission_id: subId(),
      expected_round: 2,
      content: PLAN_DOC_V2,
      change_note: 'T004の依存を見直した改訂版計画書である。十分な長さの説明文である。',
      addresses: ['plan_task_soundness'],
    },
    persistence,
  });
  const planDigest2 = commitPlan2.artifact.digest;
  assert.notEqual(planDigest1, planDigest2);

  const scorePlan2 = scoreSubmit({
    input: {
      session_id: sessionBBB,
      submission_id: subId(),
      expected_round: 2,
      artifact_digest: planDigest2,
      scores: [
        {
          criterion_id: 'plan_task_soundness',
          score: 9,
          rationale: '改訂後の依存関係が完全に整合しているため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: [
            {
              kind: 'locator',
              locator: 'plan.json#v2',
              excerpt: 'T004の依存関係を見直して再構成した計画である。',
            },
          ],
        },
      ],
    },
    persistence,
  });
  assert.equal(scorePlan2.state, 'FINAL');

  // Step 5: CCC の状態を確認すると、上流が新しい版で FINAL になったため SUPERSEDED に落ちている
  const stateSuperseded = loopState({
    input: {
      session_id: sessionCCC,
    },
    persistence,
  });
  assert.equal(stateSuperseded.state, 'SUPERSEDED');

  // Step 6: CCC で escalate(action: "rebase") を呼んで新しい上流 digest を取り込む
  const rebaseRes = escalate({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      action: 'rebase',
      upstream_digest: planDigest2,
      note: '上流の再確定計画書を取り込んで差分を反映させるためのリベースである。十分な文字数。',
    },
    persistence,
  });

  assert.equal(rebaseRes.state, 'DRAFTING');
  assert.equal(rebaseRes.round, 2);
  assert.ok(rebaseRes.rebase_result);
  // V1 に依存していた2基準が invalidated になり、tests_green は carried_over になる
  assert.deepEqual(rebaseRes.rebase_result.invalidated.sort(), ['acceptance_satisfied', 'plan_task_completion'].sort());
  assert.deepEqual(rebaseRes.rebase_result.carried_over, ['tests_green']);

  // rebases/1.json が保存されていること
  const rebaseJsonPath = path.join(dataDir, 'sessions', sessionCCC, 'rebases', '1.json');
  assert.ok(existsSync(rebaseJsonPath));
  const rebaseRecord = JSON.parse(readFileSync(rebaseJsonPath, 'utf8'));
  assert.equal(rebaseRecord.from_digest, planDigest1);
  assert.equal(rebaseRecord.to_digest, planDigest2);

  // must_fix に invalidated の2件が入っていること
  const mustFixIds = rebaseRes.must_fix.map((m) => m.criterion_id);
  assert.ok(mustFixIds.includes('plan_task_completion'));
  assert.ok(mustFixIds.includes('acceptance_satisfied'));

  // Step 7: artifact_commit & score_submit で invalidated 2件と carried_over 1件を再採点
  const files2 = [
    { path: 'src/main_application_component_v2.js', sha256: 'd'.repeat(64), bytes: 150, role: 'source' },
    { path: 'test/main_application_component_v2.test.js', sha256: 'e'.repeat(64), bytes: 160, role: 'test' },
  ];
  const manifestSha2 = computeManifestDigest(files2);
  const testInv2 = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'f'.repeat(64),
    counts: { total: 2, passed: 2, failed: 0, skipped: 0 },
    tests: [
      { id: 'test/main.test.js::test1', file: 'test/main.test.js', status: 'passed' },
      { id: 'test/main.test.js::test2', file: 'test/main.test.js', status: 'passed' },
    ],
  };

  const commitImpl2 = artifactCommit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 2,
      files: files2,
      manifest_command: manifestCmd,
      manifest_output_sha256: manifestSha2,
      test_inventory: testInv2,
      change_note: '改訂版計画に合わせた実装コード更新。十分な長さの説明文である。',
      addresses: ['plan_task_completion', 'acceptance_satisfied'],
    },
    persistence,
  });
  const implDigest2 = commitImpl2.artifact.digest;

  // invalidated された2件は previous_score が null にリセットされているため、
  // 6点からジャンプ検査に引っかからずに採点できる
  const scoreImpl2 = scoreSubmit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 2,
      artifact_digest: implDigest2,
      scores: [
        {
          criterion_id: 'plan_task_completion',
          score: 9,
          rationale: '新計画の全タスクが完全に完了しているため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: [
            {
              kind: 'upstream',
              upstream_locator: 'plan.json#T004-v2',
              excerpt: '初期タスクの修正版を実装するための十分な文字数の意図説明文である。',
            },
          ],
        },
        {
          criterion_id: 'acceptance_satisfied',
          score: 9,
          rationale: '新計画の受け入れ条件が満たされているため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: [
            {
              kind: 'upstream',
              upstream_locator: 'plan.json#acc-v2',
              excerpt: '改訂後のメイン機能が正常に動作することを確認するための受け入れ条件である',
            },
          ],
        },
        {
          criterion_id: 'tests_green',
          score: 9,
          rationale: '全テストが完全に通っているため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: [
            {
              kind: 'locator',
              locator: 'manifest.json',
              excerpt: 'src/main_application_component_v2.js',
            },
          ],
        },
      ],
    },
    persistence,
  });

  assert.equal(scoreImpl2.verdict, 'FINAL');
  assert.equal(scoreImpl2.state, 'FINAL');
});
