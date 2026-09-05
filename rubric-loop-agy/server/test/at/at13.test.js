import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../../src/tools/loop_open_create.js';
import { artifactCommit } from '../../src/tools/artifact_commit.js';
import { scoreSubmit } from '../../src/tools/score_submit.js';
import { loopState } from '../../src/tools/loop_state.js';
import { escalate } from '../../src/tools/escalate.js';
import { auditExport } from '../../src/tools/audit_export.js';
import { computeManifestDigest } from '../../src/artifact/fileset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at13-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at13-${subCounter}`.padEnd(8, '0');
}

const DESIGN_CRITERION = {
  id: 'design_architecture',
  statement: '基本設計が妥当であること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '設計に破綻がある', 5: '概ね妥当である', 9: '完全に妥当である' },
};

const PLAN_CRITERIA = [
  {
    id: 'dependency_soundness',
    statement: 'タスク間の依存関係が整合していること',
    weight: 1,
    verification: 'manual',
    anchors: { 1: '循環や逆向き依存がある', 5: '概ね整合している', 9: '完全に整合している' },
  },
];

const IMPL_CRITERIA = [
  {
    id: 'tests_green',
    statement: 'テストが全件パスしていること',
    weight: 1,
    verification: 'manual',
    anchors: { 1: 'テスト失敗がある', 5: '概ねパスする', 9: '全テストが完全に通る' },
  },
];

const DESIGN_DOC = `
# システム基本設計書
システム全体のアーキテクチャ基本設計と責務分割を定義する。
`;

function makePlanDoc(round) {
  return JSON.stringify({
    plan_version: 1,
    summary: `第${round}版の実装計画書であり、T001からT004までのタスク構成と検証手順を定義する。十分な文字数を確保する。`,
    tasks: [
      {
        id: 'T001',
        title: `初期タスク第${round}版`,
        intent: '初期タスクの実装を行うための十分な文字数の意図説明文である。',
        design_refs: ['システム全体のアーキテクチャ基本設計と責務分割を定義する。'],
        depends_on: [],
        changes: [{ path: 'src/init.js', kind: 'add' }],
        acceptance: ['初期化が正常に完了することを確認するための十分な受け入れ条件である'],
        verify: [{ command: 'npm test', expect_exit_code: 0 }],
      },
      {
        id: 'T004',
        title: `依存タスク第${round}版`,
        intent: 'T004タスクの実装を行うための十分な文字数の意図説明文である。',
        design_refs: ['システム全体のアーキテクチャ基本設計と責務分割を定義する。'],
        depends_on: ['T001'],
        changes: [{ path: 'src/main.js', kind: 'add' }],
        acceptance: ['メイン機能が正常に動作することを確認するための十分な受け入れ条件である'],
        verify: [{ command: 'npm test', expect_exit_code: 0 }],
      },
    ],
  });
}

test('AT-13: 差し戻し（implement → plan）', () => {
  const persistence = durablePersistence();

  // 1. AAA (design) を作成して FINAL にする
  const openDesign = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'AAA-design',
      task: '設計タスクを完了させるための十分な長さの説明文である。',
      rubric: { criteria: [DESIGN_CRITERION] },
    },
    pluginRoot,
    persistence,
  });
  const sessionAAA = openDesign.session_id;

  const commitDesign = artifactCommit({
    input: {
      session_id: sessionAAA,
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
      session_id: sessionAAA,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: designDigest,
      scores: [
        {
          criterion_id: 'design_architecture',
          score: 9,
          rationale: '基本設計が妥当であるため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なる改善余地がある。',
          evidence: [
            {
              kind: 'locator',
              locator: 'doc#arch',
              excerpt: 'システム全体のアーキテクチャ基本設計と責務分割を定義する。',
            },
          ],
        },
      ],
    },
    persistence,
  });

  // 2. BBB (plan) を作成して round 4 まで回して FINAL にする
  const openPlan = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'plan',
      label: 'BBB-plan',
      task: '設計書に基づいて計画を作成するタスクである。十分な長さの説明文。',
      upstream: {
        session_id: sessionAAA,
        artifact_digest: designDigest,
      },
      rubric: { criteria: PLAN_CRITERIA },
    },
    pluginRoot,
    persistence,
  });
  const sessionBBB = openPlan.session_id;

  let planDigest;
  for (let r = 1; r <= 4; r++) {
    const commitRes = artifactCommit({
      input: {
        session_id: sessionBBB,
        submission_id: subId(),
        expected_round: r,
        content: makePlanDoc(r),
        change_note: `第${r}版の実装計画書を作成してコミットする。十分な長さの説明文である。`,
        ...(r > 1 ? { addresses: ['dependency_soundness'] } : {}),
      },
      persistence,
    });
    planDigest = commitRes.artifact.digest;

    const scoreRes = scoreSubmit({
      input: {
        session_id: sessionBBB,
        submission_id: subId(),
        expected_round: r,
        artifact_digest: planDigest,
        scores: [
          {
            criterion_id: 'dependency_soundness',
            score: 5 + r,
            rationale: `第${r}ラウンドの採点である。十分な文字数を確保するための補足説明文であり、要件を満たす。`,
            weakness: '更なる改善余地がある。',
            evidence: [
              {
                kind: 'upstream',
                upstream_locator: `design.md#${r}`,
                excerpt: 'システム全体のアーキテクチャ基本設計と責務分割を定義する。',
              },
            ],
          },
        ],
      },
      persistence,
    });
    if (r === 4) {
      assert.equal(scoreRes.state, 'FINAL');
    }
  }

  // 3. CCC (implement) を作成
  const openImpl = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'implement',
      label: 'CCC-implement',
      task: '計画に基づいて実装するタスクである。十分な長さの説明文。',
      upstream: {
        session_id: sessionBBB,
        artifact_digest: planDigest,
      },
      rubric: { criteria: IMPL_CRITERIA },
    },
    pluginRoot,
    persistence,
  });
  const sessionCCC = openImpl.session_id;

  // Step 1: escalate action: "kickback"
  // 下流 CCC から上流 BBB へ kickback する
  const kickbackRes1 = escalate({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      action: 'kickback',
      target_criteria: ['dependency_soundness'],
      human_token: 'token-human-at13-kickback-001',
      note: 'T004 が T007 の成果物を前提にしているが依存が逆向きで実装順に並べると失敗する。40文字以上の詳細な説明文である。',
    },
    persistence,
  });

  assert.equal(kickbackRes1.state, 'FROZEN');
  assert.equal(kickbackRes1.freeze_reason, 'kicked_back');
  assert.ok(kickbackRes1.upstream);
  assert.equal(kickbackRes1.upstream.session_id, sessionBBB);
  assert.equal(kickbackRes1.upstream.state_after, 'DRAFTING');

  // Step 2: loop_state で BBB を確認
  // state: "DRAFTING", round: 5, must_fix: [{ criterion_id: "dependency_soundness", origin: "kickback", from_session: sessionCCC }]
  const stateBBB = loopState({
    input: {
      session_id: sessionBBB,
    },
    persistence,
  });
  assert.equal(stateBBB.state, 'DRAFTING');
  assert.equal(stateBBB.round, 5);
  assert.ok(stateBBB.must_fix);
  assert.equal(stateBBB.must_fix.length, 1);
  assert.equal(stateBBB.must_fix[0].criterion_id, 'dependency_soundness');
  assert.equal(stateBBB.must_fix[0].origin, 'kickback');
  assert.equal(stateBBB.must_fix[0].from_session, sessionCCC);

  // FROZEN の下流 CCC で artifact_commit を呼ぶと E_FROZEN になること
  const filesSample = [
    { path: 'src/main.js', sha256: 'a'.repeat(64), bytes: 100, role: 'source' },
    { path: 'test/main.test.js', sha256: 'b'.repeat(64), bytes: 120, role: 'test' },
  ];
  const manifestCmd = 'git ls-files -s';
  const manifestSha = computeManifestDigest(filesSample);
  const testInv = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'c'.repeat(64),
    counts: { total: 2, passed: 2, failed: 0, skipped: 0 },
    tests: [
      { id: 'test/main.test.js::test1', file: 'test/main.test.js', status: 'passed' },
      { id: 'test/main.test.js::test2', file: 'test/main.test.js', status: 'passed' },
    ],
  };

  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: sessionCCC,
          submission_id: subId(),
          expected_round: 1,
          files: filesSample,
          manifest_command: manifestCmd,
          manifest_output_sha256: manifestSha,
          test_inventory: testInv,
          change_note: '凍結中に提出を試みるテスト。十分な長さの説明文である。',
        },
        persistence,
      }),
    (err) => err.code === 'E_FROZEN',
  );

  // 下流だけを先に進める呼び出し列（score_submit）も拒否されること
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionCCC,
          submission_id: subId(),
          expected_round: 1,
          artifact_digest: 'sha256:' + 'f'.repeat(64),
          scores: [
            {
              criterion_id: 'tests_green',
              score: 9,
              rationale: '凍結中に採点を試みるテストである。十分な文字数を確保するための補足説明文である。',
              weakness: '更なる改善余地がある。',
              evidence: [
                {
                  kind: 'command',
                  command: 'npm test',
                  exit_code: 0,
                  output_excerpt: '2 passed',
                  output_sha256: 'c'.repeat(64),
                  target_digest: 'sha256:' + 'f'.repeat(64),
                },
              ],
            },
          ],
        },
        persistence,
      }),
    (err) => err.code === 'E_STATE_VIOLATION' || err.code === 'E_FROZEN',
  );

  // BBB を再度 FINAL に進めて CCC をリベースし、2回目の kickback を行う
  // BBB の round 5 をコミット＆採点して FINAL に戻す
  const commitBBB2 = artifactCommit({
    input: {
      session_id: sessionBBB,
      submission_id: subId(),
      expected_round: 5,
      content: makePlanDoc(5),
      change_note: '逆向き依存を解消した改訂版計画書。十分な長さの説明文である。',
      addresses: ['dependency_soundness'],
    },
    persistence,
  });
  const planDigest2 = commitBBB2.artifact.digest;

  scoreSubmit({
    input: {
      session_id: sessionBBB,
      submission_id: subId(),
      expected_round: 5,
      artifact_digest: planDigest2,
      scores: [
        {
          criterion_id: 'dependency_soundness',
          score: 9,
          rationale: '依存関係が正常に解消されたため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なる改善余地がある。',
          evidence: [
            {
              kind: 'upstream',
              upstream_locator: 'design.md#1',
              excerpt: 'システム全体のアーキテクチャ基本設計と責務分割を定義する。',
            },
          ],
        },
      ],
    },
    persistence,
  });

  // CCC は SUPERSEDED になっているため rebase
  const stateCCC = loopState({ input: { session_id: sessionCCC }, persistence });
  assert.equal(stateCCC.state, 'SUPERSEDED');

  escalate({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      action: 'rebase',
      upstream_digest: planDigest2,
      note: '上流の新計画を取り込むためのリベースである。十分な長さの説明文を確保して40文字以上とする。',
    },
    persistence,
  });

  // 2回目の kickback を実行（上限2回目）
  const kickbackRes2 = escalate({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      action: 'kickback',
      target_criteria: ['dependency_soundness'],
      human_token: 'token-human-at13-kickback-002',
      note: '別の依存問題が判明したため計画を再検討する。40文字以上の詳細な説明文である。十分に長くする。',
    },
    persistence,
  });
  assert.equal(kickbackRes2.state, 'FROZEN');

  // Step 3: 3回目の kickback を呼ぶと E_CHAIN_BUDGET_EXHAUSTED (used: 2, limit: 2) で拒否される
  assert.throws(
    () =>
      escalate({
        input: {
          session_id: sessionCCC,
          submission_id: subId(),
          action: 'kickback',
          target_criteria: ['dependency_soundness'],
          human_token: 'token-human-at13-kickback-003',
          note: '3回目の差し戻しを試みるテストである。40文字以上の詳細な説明文を確保して要件を満たす。',
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_CHAIN_BUDGET_EXHAUSTED');
      assert.equal(err.detail.check, 'kickbacks');
      assert.equal(err.detail.used, 2);
      assert.equal(err.detail.limit, 2);
      return true;
    },
  );

  // Step 4: audit_export(scope: "chain")
  // kickbacks[] に {from, to, target_criteria, downstream_state_after: "FROZEN", upstream_state_after: "DRAFTING", resolved_at}
  const auditRes = auditExport({
    input: {
      session_id: sessionCCC,
      scope: 'chain',
    },
    persistence,
  });
  const chainAudit = JSON.parse(readFileSync(auditRes.export.path, 'utf8'));
  assert.ok(chainAudit.kickbacks);
  assert.equal(chainAudit.kickbacks.length, 2);
  for (const kb of chainAudit.kickbacks) {
    assert.equal(kb.from, sessionCCC);
    assert.equal(kb.to, sessionBBB);
    assert.deepEqual(kb.target_criteria, ['dependency_soundness']);
    assert.equal(kb.downstream_state_after, 'FROZEN');
    assert.equal(kb.upstream_state_after, 'DRAFTING');
    assert.ok(kb.resolved_at);
  }
});
