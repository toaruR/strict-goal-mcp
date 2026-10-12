// AT-16: チェーン予算の超過。docs/design-rubric-loop-mcp.md §13 AT-16。
// 28周上限（design 9 + plan 6 + implement 12 = 27周、第13周提出で28周到達）
// 不合格時は verdict:"REVISE", state:"ESCALATED", reason:"chain_budget_exhausted"
// 予算枯渇のたびに escalate(resolve, continue) の新しい承認で+6周（limit 28 -> 34 -> 40）
// 同じ承認の再利用を拒否し、同じリクエストの再送で二重加算しない
// 対照: 予算超過時でも合格していれば FINAL を維持し warnings: ['chain_budget_exceeded']
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { escalate } from '../src/tools/escalate.js';
import { writeSession, readSession } from '../src/store/session_store.js';
import { computeManifestDigest } from '../src/artifact/fileset.js';
import { readChain } from '../src/chain/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-at16-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at16-${subCounter}`.padEnd(8, '0');
}

const DESIGN_CRITERION = {
  id: 'design_architecture',
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
    weight: 1,
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

test('AT-16: チェーン予算の超過（28周上限、不合格時ESCALATED、承認ごとの+6上乗せ、合格時FINAL維持）', () => {
  const persistence = durablePersistence();
  const dataDir = persistence.dir;

  // 1. AAA (design) を作成
  const openAAA = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'AAA-design',
      task: '基本設計書を作成するタスクである。十分な長さの説明文を確保する。',
      rubric: { criteria: [DESIGN_CRITERION] },
    },
    pluginRoot,
    persistence,
  });
  const sessionAAA = openAAA.session_id;

  const commitAAA = artifactCommit({
    input: {
      session_id: sessionAAA,
      submission_id: subId(),
      expected_round: 1,
      content: '# 基本設計書\nアーキテクチャ概要と設計方針を記述する。\n',
      change_note: '初版の設計書をコミットする。十分な長さの説明文である。',
    },
    persistence,
  });
  scoreSubmit({
    input: {
      session_id: sessionAAA,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: commitAAA.artifact.digest,
      scores: [
        {
          criterion_id: 'design_architecture',
          score: 9,
          rationale: '基本設計が妥当であるため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '特段の弱点や欠陥は見当たらない。',
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

  // 2. BBB (plan) を作成
  const openBBB = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'plan',
      label: 'BBB-plan',
      task: '実装計画書を作成するタスクである。十分な長さの説明文を確保する。',
      upstream: { session_id: sessionAAA, artifact_digest: commitAAA.artifact.digest },
      rubric: { criteria: [PLAN_CRITERION] },
    },
    pluginRoot,
    persistence,
  });
  const sessionBBB = openBBB.session_id;

  const commitBBB = artifactCommit({
    input: {
      session_id: sessionBBB,
      submission_id: subId(),
      expected_round: 1,
      content: JSON.stringify({
        plan_version: 1,
        summary: '実装計画書の初版であり、全タスクの依存関係と受け入れ条件を明確に定義する。十分な文字数を確保する。',
        tasks: [
          {
            id: 'T001',
            title: '実装タスク',
            intent: '基本設計に従って機能を実装するタスクである。十分な文字数の意図説明文。',
            design_refs: ['アーキテクチャ概要と設計方針を記述する。'],
            depends_on: [],
            changes: [{ path: 'src/main.js', kind: 'add' }],
            acceptance: ['全機能が正常に動作することを確認するための十分な受け入れ条件である'],
            verify: [{ command: 'npm test', expect_exit_code: 0 }],
          },
        ],
      }),
      change_note: '初版の計画書をコミットする。十分な長さの説明文である。',
    },
    persistence,
  });
  scoreSubmit({
    input: {
      session_id: sessionBBB,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: commitBBB.artifact.digest,
      scores: [
        {
          criterion_id: 'plan_feasibility',
          score: 9,
          rationale: '計画が実現可能であるため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '特段の弱点や欠陥は見当たらない。',
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

  // 3. CCC (implement) を作成
  const openCCC = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'implement',
      label: 'CCC-impl',
      task: '計画に基づいて実装するタスクである。十分な長さの説明文を確保する。',
      upstream: { session_id: sessionBBB, artifact_digest: commitBBB.artifact.digest },
      rubric: { criteria: IMPL_CRITERIA },
    },
    pluginRoot,
    persistence,
  });
  const sessionCCC = openCCC.session_id;

  // 前提: chain_rounds = 27 (design 9 + plan 6 + implement 12), limit 28
  const sessA = readSession(dataDir, sessionAAA);
  sessA.round = 9;
  writeSession(dataDir, sessA);

  const sessB = readSession(dataDir, sessionBBB);
  sessB.round = 6;
  writeSession(dataDir, sessB);

  const sessC = readSession(dataDir, sessionCCC);
  sessC.round = 13;
  writeSession(dataDir, sessC);

  // implement の round 13 成果物をコミット
  const files13 = [
    { path: 'src/main_application_component.js', sha256: 'a'.repeat(64), bytes: 100, role: 'source' },
    { path: 'test/main_application_component.test.js', sha256: 'b'.repeat(64), bytes: 120, role: 'test' },
  ];
  const manifestCmd = 'git ls-files -s';
  const manifestSha13 = computeManifestDigest(files13);
  const testInv13 = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'c'.repeat(64),
    counts: { total: 10, passed: 10, failed: 0, skipped: 0 },
    tests: [
      { id: 'test/main.test.js::test1', file: 'test/main.test.js', status: 'passed' },
    ],
  };

  const commitRes13 = artifactCommit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 13,
      files: files13,
      manifest_command: manifestCmd,
      manifest_output_sha256: manifestSha13,
      test_inventory: testInv13,
      change_note: '第13周の実装成果物を提出する。十分な長さの説明文である。',
    },
    persistence,
  });
  const digest13 = commitRes13.artifact.digest;

  // Step 1: 不合格判定 (weighted_mean 8.0, tests_green 9点, code_quality 7点)
  // chain_rounds が 9 + 6 + 13 = 28 となり limit 28 に達するため ESCALATED になる
  function failingScores(digest) {
    return [
      {
        criterion_id: 'tests_green',
        score: 9,
        rationale: '全テストが完全に通っているため9点と判定した。十分な文字数を確保するための補足説明文である。',
        weakness: '特段の弱点や欠陥は見当たらない。',
        evidence: [
          {
            kind: 'command',
            command: 'npm test',
            exit_code: 0,
            output_excerpt: '10 passed',
            output_sha256: 'c'.repeat(64),
            target_digest: digest,
          },
        ],
      },
      {
        criterion_id: 'code_quality',
        score: 7,
        rationale: 'コード品質が7点と判定された。十分な文字数を確保するための補足説明文であり、要件を満たす。',
        weakness: '更なるリファクタリングが必要である。',
        evidence: [
          {
            kind: 'locator',
            locator: 'manifest.json',
            excerpt: 'src/main_application_component.js',
          },
        ],
      },
    ];
  }

  const scoreFailRes = scoreSubmit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 13,
      artifact_digest: digest13,
      scores: failingScores(digest13),
    },
    persistence,
  });

  assert.equal(scoreFailRes.verdict, 'REVISE');
  assert.equal(scoreFailRes.state, 'ESCALATED');
  assert.equal(scoreFailRes.next_action.tool, 'escalate');
  assert.ok(scoreFailRes.escalation);
  assert.equal(scoreFailRes.escalation.reason, 'chain_budget_exhausted');
  assert.equal(scoreFailRes.escalation.detail.chain_rounds, 28);
  assert.equal(scoreFailRes.escalation.detail.limit, 28);
  assert.equal(scoreFailRes.escalation.detail.per_session.length, 3);
  assert.deepEqual(scoreFailRes.escalation.detail.per_session, [
    { session_id: sessionAAA, loop_mode: 'design', round: 9 },
    { session_id: sessionBBB, loop_mode: 'plan', round: 6 },
    { session_id: sessionCCC, loop_mode: 'implement', round: 13 },
  ]);

  // Step 2: escalate resolve continue で +6 上乗せ (limit 28 -> 34)
  assert.equal(scoreFailRes.escalation.channel, 'chat');
  assert.equal(scoreFailRes.next_action.input_skeleton.escalation_id, 'esc_01');

  const resolveContinue1 = escalate({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      action: 'resolve',
      resolution: 'continue',
      escalation_id: 'esc_01', human_reply: '続行を承認します',
      note: 'あと少しで通る見込みであるため続行を承認する。40文字以上の詳細な説明文である。',
    },
    persistence,
  });

  assert.equal(resolveContinue1.state, 'DRAFTING');
  assert.equal(resolveContinue1.round, 14);
  assert.ok(resolveContinue1.chain);
  assert.equal(resolveContinue1.chain.limit, 34);
  assert.equal(resolveContinue1.chain.granted_extra_rounds, 6);

  // Step 3: 追加予算を使い切っても採点は保存され、新しい承認でさらに+6。
  const exhausted = readSession(dataDir, sessionCCC);
  exhausted.round = 19; // design 9 + plan 6 + implement 19 = limit 34
  writeSession(dataDir, exhausted);
  const files19 = files13.map((file) => file.role === 'source' ? { ...file, sha256: 'd'.repeat(64) } : file);
  const art19 = artifactCommit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 19,
      files: files19,
      manifest_command: manifestCmd,
      manifest_output_sha256: computeManifestDigest(files19),
      test_inventory: testInv13,
      change_note: '追加予算を使い切った第19周の変更内容を記録します。',
      addresses: ['code_quality'],
    },
    persistence,
  });
  const scoreFailRes19 = scoreSubmit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 19,
      artifact_digest: art19.artifact.digest,
      scores: failingScores(art19.artifact.digest),
    },
    persistence,
  });
  assert.equal(scoreFailRes19.state, 'ESCALATED');
  assert.equal(scoreFailRes19.verdict, 'REVISE');
  assert.equal(scoreFailRes19.escalation.reason, 'chain_budget_exhausted');
  assert.equal(scoreFailRes19.escalation.detail.chain_rounds, 34);
  assert.equal(scoreFailRes19.escalation.detail.limit, 34);
  assert.equal(scoreFailRes19.next_action.input_skeleton.escalation_id, 'esc_02');
  const recorded19 = JSON.parse(readFileSync(path.join(dataDir, 'sessions', sessionCCC, 'rounds', '19.json'), 'utf8'));
  assert.equal(recorded19.round, 19);
  assert.equal(recorded19.verdict, 'REVISE');
  assert.equal(recorded19.weighted_mean, 8);

  // 消費済みの確認IDでは新しい予算を付与しない。
  assert.throws(() => escalate({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      action: 'resolve',
      resolution: 'continue',
      escalation_id: 'esc_01',
      human_reply: '続行を承認します',
      note: '確認済みの承認を再利用しても予算が増えないことを検証するための十分な長さの説明文です。',
    },
    persistence,
  }), { code: 'E_RESOLUTION_NOT_APPLICABLE' });
  assert.equal(readChain(dataDir, openCCC.chain_id).granted_extra_rounds, 6);

  const continue2Input = {
    session_id: sessionCCC,
    submission_id: subId(),
    action: 'resolve',
    resolution: 'continue',
    escalation_id: 'esc_02',
    human_reply: '2回目の続行を承認します',
    note: '追加予算を再び使い切ったため新しい確認IDによる2回目の続行承認を反映する説明文です。',
  };
  const resolveContinue2 = escalate({ input: continue2Input, persistence });
  assert.equal(resolveContinue2.state, 'DRAFTING');
  assert.equal(resolveContinue2.round, 20);
  assert.equal(resolveContinue2.chain.limit, 40);
  assert.equal(resolveContinue2.chain.granted_extra_rounds, 12);
  // 同じ submission_id の再送は応答を再利用し、二重加算しない。
  assert.deepEqual(escalate({ input: continue2Input, persistence }), resolveContinue2);
  const afterContinue2 = readChain(dataDir, openCCC.chain_id);
  assert.equal(afterContinue2.granted_extra_rounds, 12);
  assert.equal(afterContinue2.events.filter((event) => event.type === 'extra_rounds_granted').length, 2);
  assert.equal(readSession(dataDir, sessionCCC).counters.extra_rounds_granted, 6);
  assert.equal(readSession(dataDir, sessionAAA).state, 'FINAL');
  assert.equal(readSession(dataDir, sessionBBB).state, 'FINAL');
  assert.equal(readSession(dataDir, sessionBBB).current_artifact.digest, commitBBB.artifact.digest);

  // Step 4: 対照（予算超過時でも合格していれば FINAL を維持し warnings: ['chain_budget_exceeded']）
  // round 25 に設定して 9 + 6 + 25 = 40 (limit 40) に到達させ、合格時の警告付与を検証
  const sessC2 = readSession(dataDir, sessionCCC);
  sessC2.state = 'DRAFTING';
  sessC2.round = 25;
  writeSession(dataDir, sessC2);

  const files25 = [
    { path: 'src/main_application_component.js', sha256: 'e'.repeat(64), bytes: 150, role: 'source' },
    { path: 'test/main_application_component.test.js', sha256: 'b'.repeat(64), bytes: 120, role: 'test' },
  ];
  const manifestSha25 = computeManifestDigest(files25);
  const testInv25 = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'c'.repeat(64),
    counts: { total: 10, passed: 10, failed: 0, skipped: 0 },
    tests: [
      { id: 'test/main.test.js::test1', file: 'test/main.test.js', status: 'passed' },
    ],
  };

  const art25 = artifactCommit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 25,
      files: files25,
      manifest_command: manifestCmd,
      manifest_output_sha256: manifestSha25,
      test_inventory: testInv25,
      change_note: '25周目の成果物改善のための変更内容を記録します。',
      addresses: ['code_quality'],
    },
    persistence,
  });

  const scorePassRes = scoreSubmit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 25,
      artifact_digest: art25.artifact.digest,
      scores: [
        {
          criterion_id: 'tests_green',
          score: 9,
          rationale: '全テストが完全に通っているため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '特段の弱点や欠陥は見当たらない。',
          evidence: [
            {
              kind: 'command',
              command: 'npm test',
              exit_code: 0,
              output_excerpt: '10 passed',
              output_sha256: 'c'.repeat(64),
              target_digest: art25.artifact.digest,
            },
          ],
        },
        {
          criterion_id: 'code_quality',
          score: 9,
          rationale: 'コード品質が完全に改善されたため9点とする。十分な文字数を確保するための補足説明文である。',
          weakness: '特段の弱点や欠陥は見当たらない。',
          evidence: [
            {
              kind: 'locator',
              locator: 'manifest.json',
              excerpt: 'e'.repeat(64),
            },
          ],
        },
      ],
    },
    persistence,
  });

  assert.equal(scorePassRes.verdict, 'PASS');
  assert.equal(scorePassRes.state, 'FINAL');
  assert.ok(scorePassRes.warnings.includes('chain_budget_exceeded'));
});
