import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../../src/tools/loop_open_create.js';
import { artifactCommit } from '../../src/tools/artifact_commit.js';
import { scoreSubmit } from '../../src/tools/score_submit.js';
import { sha256Hex } from '../../src/hash/digest.js';
import { loadRubric } from '../../src/rubric/store.js';
import { sessionDir } from '../../src/store/session_store.js';
import { computeManifestDigest } from '../../src/artifact/fileset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at18-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir, source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at18-${subCounter}`.padEnd(8, '0');
}

test('AT-18: MCP サーバ起動失敗（3モード縮退規約と事後追認）', () => {
  // Step 1: SKILL.md の 3モード縮退規約の検証
  const skillPath = path.resolve(pluginRoot, 'skills', 'rubric-loop', 'SKILL.md');
  const skillContent = readFileSync(skillPath, 'utf8');

  // (1) 3モードいずれでもサーバ不在時に FINAL を名乗らないことが規定されていること
  assert.ok(skillContent.includes('FINAL を名乗らない'));
  const designSection = skillContent.slice(skillContent.indexOf('- design'));
  assert.ok(designSection.includes('自ら FINAL を名乗らない'));
  const planSection = skillContent.slice(skillContent.indexOf('- plan'));
  assert.ok(planSection.includes('自ら FINAL を名乗らない'));
  const implementSection = skillContent.slice(skillContent.indexOf('- implement'));
  assert.ok(implementSection.includes('自ら FINAL を名乗らない'));

  // (2) 3モードいずれでも UNVERIFIED-COMPLETE への格下げが規定されていること
  assert.ok(skillContent.includes('UNVERIFIED-COMPLETE: rubric-loop server unavailable'));

  // (3) 3モードいずれでもフォールバック journal の書式・保存先が同一であること
  assert.ok(skillContent.includes('rubric-loop-fallback.json'));

  // (4) implement ではマージ・デプロイ判断せず人間のレビューを求めることが規定されていること
  assert.ok(skillContent.includes('マージ・デプロイ'));
  assert.ok(skillContent.includes('人間のレビュー'));

  // -------------------------------------------------------------
  // Step 2: 縮退環境のシミュレーション（サーバ不在下での成果物作成）
  // -------------------------------------------------------------
  const UNVERIFIED_HEADER = 'UNVERIFIED-COMPLETE: rubric-loop server unavailable\n\n';

  // 1. Design 成果物
  const degradedDesignContent = `${UNVERIFIED_HEADER}# システム基本設計書
## 1. アーキテクチャ構成
システム全体の基本設計と責務分割について定義する。
## 2. データ構造
永続化レイアウトおよびエラーコード体系を定義する。

## 自己採点表（縮退）
全基準について自己採点を行い要件を満たすことを確認した。
`;

  // 2. Plan 成果物（トポロジカルソートと design_refs 照合結果を含む）
  const degradedPlanContent = JSON.stringify({
    plan_version: 1,
    summary: 'UNVERIFIED-COMPLETE: rubric-loop server unavailable\nこれは縮退中に作成された40文字以上ある実装計画全体の概要説明文です。トポロジカルソート確認済。',
    tasks: [
      {
        id: 'T001',
        title: '基本タスク1',
        intent: 'タスク1の意図を20文字以上で詳細に記述する文章です。',
        depends_on: [],
        design_refs: ['# システム基本設計書'],
        changes: [{ path: 'src/app_main_core_component.js', kind: 'add' }],
        acceptance: ['受け入れ条件が満たされること'],
        verify: [{ command: 'npm test', expect_exit_code: 0 }],
      },
    ],
  });

  // 3. Implement 成果物（テスト実行結果・変更ファイル一覧・人間レビュー要請を含む）
  const degradedImplementNotice = `${UNVERIFIED_HEADER}マージ・デプロイの可否は判断していない。人間のレビューを求める。\nテスト実行結果: 10 passed, 0 failed, exit code 0`;
  assert.ok(degradedImplementNotice.includes('人間のレビューを求める'));

  // 4. フォールバック journal の書式が 3 モードで共通であることの検証
  const fallbackJournals = {
    design: {
      mode: 'design',
      round: 1,
      artifact_content: degradedDesignContent,
      artifact_sha256: sha256Hex(degradedDesignContent),
      change_note: '縮退中に作成した設計書初版',
      self_scores: [{ criterion_id: 'architecture_clarity', score: 9, rationale: '十分な長さの根拠説明' }],
    },
    plan: {
      mode: 'plan',
      round: 1,
      artifact_content: degradedPlanContent,
      artifact_sha256: sha256Hex(degradedPlanContent),
      change_note: '縮退中に作成した計画初版',
      self_scores: [{ criterion_id: 'plan_feasibility', score: 9, rationale: '十分な長さの根拠説明' }],
    },
    implement: {
      mode: 'implement',
      round: 1,
      artifact_content: degradedImplementNotice,
      artifact_sha256: sha256Hex(degradedImplementNotice),
      change_note: '縮退中に作成した実装初版',
      self_scores: [{ criterion_id: 'tests_green', score: 9, rationale: '十分な長さの根拠説明' }],
    },
  };

  for (const [mode, journal] of Object.entries(fallbackJournals)) {
    assert.equal(journal.round, 1);
    assert.ok(journal.artifact_content);
    assert.ok(journal.artifact_sha256);
    assert.ok(journal.change_note);
    assert.ok(Array.isArray(journal.self_scores));
  }

  // -------------------------------------------------------------
  // Step 3: サーバ復旧後の事後追認手順の検証（3モード共通）
  // 縮退中に書いた成果物を round 1 の artifact_commit として提出し、
  // 縮退中の自己採点は引き継がれず、previous_score は null から始まる。
  // -------------------------------------------------------------
  const dataDir = tmpDataDir();
  const persistence = durablePersistence(dataDir);

  // (A) Design モードの復旧・追認
  const openDesign = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      task: '縮退からの復旧追認設計タスク。十分な長さの20文字以上の文章です。',
      loop_mode: 'design',
    },
    persistence,
    pluginRoot,
    pluginRootSource: 'PLUGIN_ROOT',
  });
  const sessionDesign = openDesign.session_id;

  const commitDesign = artifactCommit({
    input: {
      session_id: sessionDesign,
      submission_id: subId(),
      expected_round: 1,
      content: degradedDesignContent,
      change_note: '縮退中に作成した設計書を round 1 の成果物として提出する。',
    },
    persistence,
  });
  const digestDesign = commitDesign.artifact.digest;

  // 縮退中の自己採点は引き継がれず、サーバの初回採点が行われる
  const designRubric = loadRubric(sessionDir(dataDir, sessionDesign), 1);
  const designScores = designRubric.criteria.map((c) => {
    if (c.verification === 'auto') {
      return {
        criterion_id: c.id,
        score: 9,
        rationale: '自動検証基準を満たしていると確認した。十分な文字数を確保するための補足説明文である。',
        weakness: '特段の欠陥は見当たらない。',
        evidence: [
          {
            kind: 'command',
            command: `npm test check_${c.id}`,
            exit_code: 0,
            output_excerpt: `Command verified ${c.id}`,
            output_sha256: '0'.repeat(64),
          },
        ],
      };
    }
    return {
      criterion_id: c.id,
      score: 9,
      rationale: '手動検証基準を満たしていると確認した。十分な文字数を確保するための補足説明文である。',
      weakness: '特段の欠陥は見当たらない。',
      evidence: [
        {
          kind: 'locator',
          locator: 'spec.md#arch',
          excerpt: 'システム全体の基本設計と責務分割について定義する。',
        },
      ],
    };
  });

  const scoreDesign = scoreSubmit({
    input: {
      session_id: sessionDesign,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: digestDesign,
      scores: designScores,
    },
    persistence,
  });

  // previous_score がすべて null であったことを確認（自己採点の非引き継ぎ）
  assert.ok(scoreDesign.evaluation);
  for (const s of scoreDesign.evaluation.per_criterion) {
    assert.equal(s.previous_score, null);
  }
  assert.equal(scoreDesign.verdict, 'FINAL');

  // (B) Plan モードの復旧・追認
  const openPlan = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      task: '縮退からの復旧追認計画タスク。十分な長さの20文字以上の文章です。',
      loop_mode: 'plan',
      upstream: { session_id: sessionDesign, artifact_digest: digestDesign },
    },
    persistence,
    pluginRoot,
    pluginRootSource: 'PLUGIN_ROOT',
  });
  const sessionPlan = openPlan.session_id;

  const commitPlan = artifactCommit({
    input: {
      session_id: sessionPlan,
      submission_id: subId(),
      expected_round: 1,
      content: degradedPlanContent,
      change_note: '縮退中に作成した実装計画を round 1 の成果物として提出する。',
    },
    persistence,
  });
  const digestPlan = commitPlan.artifact.digest;

  const planRubric = loadRubric(sessionDir(dataDir, sessionPlan), 1);
  const planScores = planRubric.criteria.map((c) => {
    if (c.verification === 'auto') {
      return {
        criterion_id: c.id,
        score: 9,
        rationale: '計画の自動検証基準を満たしていると確認した。十分な文字数を確保するための補足説明文である。',
        weakness: '特段の欠陥は見当たらない。',
        evidence: [
          {
            kind: 'command',
            command: `npm test check_${c.id}`,
            exit_code: 0,
            output_excerpt: `Command verified ${c.id}`,
            output_sha256: '0'.repeat(64),
          },
        ],
      };
    }
    return {
      criterion_id: c.id,
      score: 9,
      rationale: '計画の手動検証基準を満たしていると確認した。十分な文字数を確保するための補足説明文である。',
      weakness: '特段の欠陥は見当たらない。',
      evidence: [
        {
          kind: 'locator',
          locator: 'plan.json#tasks',
          excerpt: 'これは縮退中に作成された40文字以上ある実装計画全体の概要説明文です。',
        },
      ],
    };
  });

  const scorePlan = scoreSubmit({
    input: {
      session_id: sessionPlan,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: digestPlan,
      scores: planScores,
    },
    persistence,
  });

  for (const s of scorePlan.evaluation.per_criterion) {
    assert.equal(s.previous_score, null);
  }
  assert.equal(scorePlan.verdict, 'FINAL');

  // (C) Implement モードの復旧・追認
  const openImplement = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      task: '縮退からの復旧追認実装タスク。十分な長さの20文字以上の文章です。',
      loop_mode: 'implement',
      upstream: { session_id: sessionPlan, artifact_digest: digestPlan },
    },
    persistence,
    pluginRoot,
    pluginRootSource: 'PLUGIN_ROOT',
  });
  const sessionImplement = openImplement.session_id;

  const files = [
    { path: 'src/app_main_core_component.js', sha256: 'a'.repeat(64), bytes: 200, role: 'source' },
    { path: 'test/app_main_core_component.test.js', sha256: 'b'.repeat(64), bytes: 300, role: 'test' },
  ];
  const manifestSha = computeManifestDigest(files);
  const testInv = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'c'.repeat(64),
    counts: { total: 10, passed: 10, failed: 0, skipped: 0 },
    tests: [
      { id: 'test/app.test.js::test1', file: 'test/app_main_core_component.test.js', status: 'passed' },
    ],
  };

  const commitImplement = artifactCommit({
    input: {
      session_id: sessionImplement,
      submission_id: subId(),
      expected_round: 1,
      files,
      manifest_command: 'git ls-files -s',
      manifest_output_sha256: manifestSha,
      test_inventory: testInv,
      change_note: '縮退中に作成したコードとテストを round 1 の成果物として提出する。',
    },
    persistence,
  });
  const digestImplement = commitImplement.artifact.digest;

  const implementRubric = loadRubric(sessionDir(dataDir, sessionImplement), 1);
  const implementScores = implementRubric.criteria.map((c) => {
    if (c.verification === 'auto') {
      return {
        criterion_id: c.id,
        score: 9,
        rationale: '実装の自動検証基準を満たしていると確認した。十分な文字数を確保するための補足説明文である。',
        weakness: '特段の欠陥は見当たらない。',
        evidence: [
          {
            kind: 'command',
            command: 'npm test',
            exit_code: 0,
            output_excerpt: '10 passed',
            output_sha256: 'c'.repeat(64),
            target_digest: digestImplement,
          },
        ],
      };
    }
    return {
      criterion_id: c.id,
      score: 9,
      rationale: '実装の手動検証基準を満たしていると確認した。十分な文字数を確保するための補足説明文である。',
      weakness: '特段の欠陥は見当たらない。',
      evidence: [
        {
          kind: 'locator',
          locator: 'manifest.json',
          excerpt: 'src/app_main_core_component.js',
        },
      ],
    };
  });

  const scoreImplement = scoreSubmit({
    input: {
      session_id: sessionImplement,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: digestImplement,
      scores: implementScores,
    },
    persistence,
  });

  for (const s of scoreImplement.evaluation.per_criterion) {
    assert.equal(s.previous_score, null);
  }
  assert.equal(scoreImplement.verdict, 'FINAL');
});
