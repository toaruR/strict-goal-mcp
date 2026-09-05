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
import { auditExport } from '../../src/tools/audit_export.js';
import { readChain } from '../../src/chain/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at10-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at10-${subCounter}`.padEnd(8, '0');
}

const DESIGN_CRITERION = {
  id: 'architecture_clarity',
  statement: 'アーキテクチャ設計と責務分割が明確に記述されていること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '設計が不明確である', 5: '概ね明確である', 9: '完全に明確である' },
};

const PLAN_CRITERION = {
  id: 'plan_feasibility',
  statement: '計画の依存関係と実行順序が妥当であること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '依存関係に破綻がある', 5: '概ね実行可能である', 9: '完全に実行可能である' },
};

const IMPLEMENT_CRITERION = {
  id: 'code_correctness',
  statement: '実装とテストが仕様どおりにパスしていること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: 'テストが通らない', 5: '主要テストが通る', 9: '全テストが完全に通る' },
};

const DESIGN_DOC = `# 設計書
## 1. 基本構成
システム全体のアーキテクチャ基本設計と責務分割を定義する。
## 2. 状態管理
状態遷移と永続化レイアウトおよびエラーハンドリングを定義する。
`;

test('AT-10: 3モード連鎖の正常系（design -> plan -> implement の chain 接続、chain audit v2）', () => {
  const persistence = durablePersistence();

  // 1. loop_open (mode: "create", loop_mode: "design")
  const openDesign = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'X-design',
      task: '3モード連鎖の正常系を検証するための設計書作成タスクである。',
      rubric: { criteria: [DESIGN_CRITERION] },
    },
    pluginRoot,
    persistence,
  });

  const sessionA = openDesign.session_id;
  const chainId = openDesign.chain_id;
  assert.ok(sessionA.startsWith('rl_'));
  assert.ok(chainId.startsWith('ch_'));
  assert.equal(openDesign.loop_mode, 'design');
  assert.equal(openDesign.state, 'DRAFTING');
  assert.equal(openDesign.round, 1);
  assert.equal(openDesign.artifact_kind, 'markdown');
  assert.equal(openDesign.next_action.tool, 'artifact_commit');

  // 2. artifact_commit + score_submit で design を FINAL にする
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

  const scoreDesign = scoreSubmit({
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

  assert.equal(scoreDesign.verdict, 'FINAL');
  assert.equal(scoreDesign.state, 'FINAL');

  // 3. loop_open (mode: "create", loop_mode: "plan", upstream: sessionA)
  const openPlan = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'plan',
      label: 'X-plan',
      task: '確定した設計書に基づいて実装計画を作成するタスクである。',
      upstream: {
        session_id: sessionA,
        artifact_digest: designDigest,
      },
      rubric: { criteria: [PLAN_CRITERION] },
    },
    pluginRoot,
    persistence,
  });

  const sessionB = openPlan.session_id;
  assert.ok(sessionB.startsWith('rl_'));
  assert.equal(openPlan.chain_id, chainId); // 同一チェーン
  assert.equal(openPlan.loop_mode, 'plan');
  assert.equal(openPlan.artifact_kind, 'plan');
  assert.equal(openPlan.state, 'DRAFTING');
  assert.equal(openPlan.round, 1);
  assert.equal(openPlan.upstream.verdict, 'FINAL');
  assert.equal(openPlan.upstream.drift, false);

  // 4. loop_state (include: ["upstream"]) で上流設計書本文を取得できる
  const statePlan = loopState({
    input: {
      session_id: sessionB,
      include: ['upstream'],
    },
    persistence,
  });
  assert.equal(statePlan.upstream_artifact.digest, designDigest);
  assert.ok(statePlan.upstream_artifact.content.includes('基本設計と責務分割を定義する'));

  // 5. artifact_commit で計画JSONを提出
  const planTasks = [
    {
      id: 'T001',
      title: '基盤モジュール実装',
      intent: 'システム全体の基本設計に従い基盤モジュールを実装する。',
      design_refs: ['システム全体のアーキテクチャ基本設計と責務分割を定義する。'],
      depends_on: [],
      changes: [{ path: 'src/base.js', kind: 'add' }],
      acceptance: ['基盤モジュールが正常にビルドできること'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
    {
      id: 'T002',
      title: '状態管理モジュール実装',
      intent: '状態遷移と永続化レイアウトに従い状態管理を実装する。',
      design_refs: ['状態遷移と永続化レイアウトおよびエラーハンドリングを定義する。'],
      depends_on: ['T001'],
      changes: [{ path: 'src/state.js', kind: 'add' }],
      acceptance: ['状態管理テストが全件パスすること'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
  ];
  const planContent = JSON.stringify({
    plan_version: 1,
    summary: '上流の確定した設計書に基づいて全体を2件のタスクに分割した実装計画書であり、依存関係と検証コマンドを定義する。',
    tasks: planTasks,
  });

  const commitPlan = artifactCommit({
    input: {
      session_id: sessionB,
      submission_id: subId(),
      expected_round: 1,
      content: planContent,
      change_note: '初版の実装計画書を作成して提出する。十分な長さの説明文である。',
    },
    persistence,
  });

  assert.equal(commitPlan.accepted, true);
  assert.equal(commitPlan.plan_checks.tasks, 2);
  assert.equal(commitPlan.plan_checks.toposort, 'ok');
  assert.equal(commitPlan.plan_checks.design_refs_verified, 2);
  const planDigest = commitPlan.artifact.digest;

  // 6. score_submit で plan を FINAL にする
  const scorePlan = scoreSubmit({
    input: {
      session_id: sessionB,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: planDigest,
      scores: [
        {
          criterion_id: 'plan_feasibility',
          score: 9,
          rationale: '計画の依存関係と実行順序が完全に妥当であるため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: [
            {
              kind: 'upstream',
              upstream_locator: 'spec.md#architecture',
              excerpt: 'システム全体のアーキテクチャ基本設計と責務分割を定義する。',
            },
          ],
        },
      ],
    },
    persistence,
  });

  assert.equal(scorePlan.verdict, 'FINAL');
  assert.equal(scorePlan.state, 'FINAL');

  // 7. loop_open (mode: "create", loop_mode: "implement", upstream: sessionB)
  const openImplement = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'implement',
      label: 'X-implement',
      task: '確定した計画に基づいてコードとテストを実装するタスクである。',
      upstream: {
        session_id: sessionB,
        artifact_digest: planDigest,
      },
      rubric: { criteria: [IMPLEMENT_CRITERION] },
    },
    pluginRoot,
    persistence,
  });

  const sessionC = openImplement.session_id;
  assert.ok(sessionC.startsWith('rl_'));
  assert.equal(openImplement.chain_id, chainId); // 同一チェーン
  assert.equal(openImplement.loop_mode, 'implement');
  assert.equal(openImplement.artifact_kind, 'fileset');

  // 8. audit_export (scope: "chain")
  const chainAudit = auditExport({
    input: {
      session_id: sessionC,
      scope: 'chain',
    },
    persistence,
  });

  const exportData = JSON.parse(readFileSync(chainAudit.export.path, 'utf8'));
  assert.equal(exportData.chain_id, chainId);
  assert.equal(exportData.audit_version, 2);
  assert.equal(exportData.sessions.length, 3);
  assert.equal(exportData.links.length, 2);
  assert.ok(exportData.links.every((l) => l.verified === true));
  assert.equal(exportData.links[0].from, sessionA);
  assert.equal(exportData.links[0].to, sessionB);
  assert.equal(exportData.links[0].upstream_digest, designDigest);
  assert.equal(exportData.links[1].from, sessionB);
  assert.equal(exportData.links[1].to, sessionC);
  assert.equal(exportData.links[1].upstream_digest, planDigest);

  // chain.json に3セッションが追記のみで並んでいること
  const chainFile = readChain(persistence.dir, chainId);
  assert.equal(chainFile.members.length, 3);
  assert.equal(chainFile.members[0].session_id, sessionA);
  assert.equal(chainFile.members[1].session_id, sessionB);
  assert.equal(chainFile.members[2].session_id, sessionC);
});
