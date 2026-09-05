import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../../src/tools/loop_open_create.js';
import { loopOpenResume } from '../../src/tools/loop_open_resume.js';
import { loopState } from '../../src/tools/loop_state.js';
import { artifactCommit } from '../../src/tools/artifact_commit.js';
import { scoreSubmit } from '../../src/tools/score_submit.js';
import { escalate } from '../../src/tools/escalate.js';
import { writeSession, readSession, sessionDir } from '../../src/store/session_store.js';
import { computeManifestDigest } from '../../src/artifact/fileset.js';
import { loadRubric } from '../../src/rubric/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at17-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir, source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at17-${subCounter}`.padEnd(8, '0');
}

const DESIGN_DOC = `# 設計書
## 1. アーキテクチャ構成
システム全体の基本設計と責務分割について定義する。
## 2. データ構造
永続化レイアウトおよびエラーコード体系を定義する。
`;

function makePlanContent() {
  return JSON.stringify({
    plan_version: 1,
    summary: 'これはAT-17検証用の40文字以上ある実装計画全体の概要説明文です。十分な長さを確保しています。',
    tasks: [
      {
        id: 'T001',
        title: 'タスク1 基本実装',
        intent: 'タスク1の意図を20文字以上で詳細に記述する文章です。',
        depends_on: [],
        design_refs: ['# 設計書'],
        changes: [{ path: 'src/main.js', kind: 'add' }],
        acceptance: ['受け入れ条件1が満たされること'],
        verify: [{ command: 'npm test', expect_exit_code: 0 }],
      },
    ],
  });
}

function makeEvidence(criterion, artifactDigest, isFileset, options = {}) {
  const { isRound11 = false } = options;
  if (criterion.verification === 'auto') {
    return [
      {
        kind: 'command',
        command: `npm test check_${criterion.id}`,
        exit_code: 0,
        output_excerpt: isRound11 ? `Round 11 verified ${criterion.id}` : `Command verified for ${criterion.id}`,
        output_sha256: isRound11 ? 'e'.repeat(64) : 'c'.repeat(64),
        ...(isFileset ? { target_digest: artifactDigest } : {}),
      },
    ];
  }
  return [
    {
      kind: 'locator',
      locator: isFileset ? 'manifest.json' : 'spec.md#arch',
      excerpt: options.excerpt ?? (isFileset ? 'src/main_application_component_core.js' : 'システム全体の基本設計と責務分割について定義する。'),
    },
  ];
}

function makeScores(rubric, artifactDigest, isFileset, overrides = {}, options = {}) {
  return rubric.criteria.map((c) => {
    const scoreVal = overrides[c.id] ?? 9;
    const rationale = `${c.id} は完全に要件を満たしていると判定した。十分な文字数を確保するための補足説明文である。`;
    const weakness = scoreVal < 9 ? '改善が必要な箇所が存在する。' : '特段の弱点や欠陥は見当たらない。';
    return {
      criterion_id: c.id,
      score: scoreVal,
      rationale,
      weakness,
      evidence: makeEvidence(c, artifactDigest, isFileset, options),
    };
  });
}

test('AT-17: 途中モードからの再開（実装セッションのハンドル1個）', () => {
  const dataDir = tmpDataDir();
  const persistence = durablePersistence(dataDir);

  // 1. Session AAA: design モードで作成し FINAL にする (round: 4)
  const openResA = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      task: 'AT-17 設計タスクの十分な長さの説明文です。20文字以上を確実に確保します。',
      loop_mode: 'design',
    },
    persistence,
    pluginRoot,
    pluginRootSource: 'PLUGIN_ROOT',
  });
  const sessionAAA = openResA.session_id;
  const chainId = openResA.chain_id;

  const commitResA = artifactCommit({
    input: {
      session_id: sessionAAA,
      submission_id: subId(),
      expected_round: 1,
      content: DESIGN_DOC,
      change_note: '初回の設計成果物です。十分な長さの説明文を記述しています。',
    },
    persistence,
  });
  const digestAAA = commitResA.artifact.digest;

  // design モードの全15基準に 9 点をつけて FINAL にする
  const designRubric = loadRubric(sessionDir(dataDir, sessionAAA), 1);
  assert.equal(designRubric.criteria.length, 15);
  const designScores = makeScores(designRubric, digestAAA, false);

  const scoreResA = scoreSubmit({
    input: {
      session_id: sessionAAA,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: digestAAA,
      scores: designScores,
    },
    persistence,
  });
  assert.equal(scoreResA.verdict, 'FINAL');

  // round を 4 に調整
  const sessA = readSession(dataDir, sessionAAA);
  sessA.round = 4;
  writeSession(dataDir, sessA);

  // 2. Session BBB: plan モードで作成し FINAL にする (round: 6)
  const openResB = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      task: 'AT-17 計画タスクの十分な長さの説明文です。20文字以上を確実に確保します。',
      loop_mode: 'plan',
      upstream: { session_id: sessionAAA, artifact_digest: digestAAA },
    },
    persistence,
    pluginRoot,
    pluginRootSource: 'PLUGIN_ROOT',
  });
  const sessionBBB = openResB.session_id;

  const planContentBBB = makePlanContent();
  const commitResB = artifactCommit({
    input: {
      session_id: sessionBBB,
      submission_id: subId(),
      expected_round: 1,
      content: planContentBBB,
      change_note: '初回の計画成果物です。十分な長さの説明文を記述しています。',
    },
    persistence,
  });
  const digestBBB = commitResB.artifact.digest;

  // plan モードの全9基準に 9 点をつけて FINAL にする
  const planRubric = loadRubric(sessionDir(dataDir, sessionBBB), 1);
  assert.equal(planRubric.criteria.length, 8);
  const planScores = makeScores(planRubric, digestBBB, false, {}, { excerpt: 'これはAT-17検証用の40文字以上ある実装計画全体の概要説明文です。' });

  const scoreResB = scoreSubmit({
    input: {
      session_id: sessionBBB,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: digestBBB,
      scores: planScores,
    },
    persistence,
  });
  assert.equal(scoreResB.verdict, 'FINAL');

  // round を 6 に調整
  const sessB = readSession(dataDir, sessionBBB);
  sessB.round = 6;
  writeSession(dataDir, sessB);

  // 3. Session CCC: implement モードで作成し、round 10 成果物コミット + 採点(不合格で must_fix あり)
  const openResC = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      task: 'AT-17 実装タスクの十分な長さの説明文です。20文字以上を確実に確保します。',
      loop_mode: 'implement',
      upstream: { session_id: sessionBBB, artifact_digest: digestBBB },
    },
    persistence,
    pluginRoot,
    pluginRootSource: 'PLUGIN_ROOT',
  });
  const sessionCCC = openResC.session_id;

  const files10 = [
    { path: 'src/main_application_component_core.js', sha256: 'a'.repeat(64), bytes: 200, role: 'source' },
    { path: 'test/main.test.js', sha256: 'b'.repeat(64), bytes: 300, role: 'test' },
  ];
  const manifestSha10 = computeManifestDigest(files10);
  const testInv10 = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'c'.repeat(64),
    counts: { total: 10, passed: 10, failed: 0, skipped: 0 },
    tests: [
      { id: 'test/main.test.js::test1', file: 'test/main.test.js', status: 'passed' },
      { id: 'test/main.test.js::test2', file: 'test/main.test.js', status: 'passed' },
    ],
  };

  const commitResC = artifactCommit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 1,
      files: files10,
      manifest_command: 'git ls-files -s',
      manifest_output_sha256: manifestSha10,
      test_inventory: testInv10,
      change_note: '初回の実装成果物です。十分な長さの説明文を記述しています。',
    },
    persistence,
  });
  const digestCCC = commitResC.artifact.digest;

  // round 10 時点で採点し、code_quality が 6 点で must_fix に残る状態にする
  const implementRubric = loadRubric(sessionDir(dataDir, sessionCCC), 1);
  assert.equal(implementRubric.criteria.length, 9);
  const implementScores = makeScores(implementRubric, digestCCC, true, { code_quality: 6 }, { excerpt: 'src/main_application_component_core.js' });

  const scoreResC = scoreSubmit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: digestCCC,
      scores: implementScores,
    },
    persistence,
  });
  assert.equal(scoreResC.verdict, 'ITERATING');
  assert.equal(scoreResC.state, 'DRAFTING');

  // round を 11 に調整 (4 + 6 + 11 = 21周)
  const sessC = readSession(dataDir, sessionCCC);
  sessC.round = 11;
  writeSession(dataDir, sessC);

  // -------------------------------------------------------------
  // AT-17 Step 1: 新しいプロセス・空のコンテキスト。持っているのは sessionCCC だけ。
  // loop_open{mode: "resume", session_id: sessionCCC}
  // -------------------------------------------------------------
  const resumeRes = loopOpenResume({
    input: {
      mode: 'resume',
      submission_id: subId(),
      session_id: sessionCCC,
    },
    persistence,
  });

  assert.equal(resumeRes.ok, true);
  assert.equal(resumeRes.session_id, sessionCCC);
  assert.equal(resumeRes.chain_id, chainId);
  assert.equal(resumeRes.loop_mode, 'implement');
  assert.equal(resumeRes.state, 'DRAFTING');
  assert.equal(resumeRes.round, 11);
  assert.equal(resumeRes.artifact_kind, 'fileset');

  // 上流段 (BBB) の情報が復元されている
  assert.ok(resumeRes.upstream);
  assert.equal(resumeRes.upstream.session_id, sessionBBB);
  assert.equal(resumeRes.upstream.loop_mode, 'plan');
  assert.equal(resumeRes.upstream.artifact_digest, digestBBB);
  assert.equal(resumeRes.upstream.verdict, 'FINAL');
  assert.equal(resumeRes.upstream.drift, false);

  // chain 状況 (chain_rounds: 21, limit: 28)
  assert.ok(resumeRes.chain);
  assert.equal(resumeRes.chain.chain_rounds, 21);
  assert.equal(resumeRes.chain.limit, 28);

  // must_fix
  assert.ok(resumeRes.must_fix);
  assert.equal(resumeRes.must_fix.length, 1);
  assert.equal(resumeRes.must_fix[0].criterion_id, 'code_quality');
  assert.equal(resumeRes.must_fix[0].score, 6);

  // next_action
  assert.equal(resumeRes.next_action.tool, 'artifact_commit');

  // -------------------------------------------------------------
  // AT-17 Step 2: loop_state で詳細復元
  // -------------------------------------------------------------
  const stateRes = loopState({
    input: {
      session_id: sessionCCC,
      include: ['rubric', 'must_fix', 'upstream', 'chain', 'artifact_head'],
    },
    persistence,
  });

  // rubric: 9件
  assert.ok(stateRes.rubric);
  assert.equal(stateRes.rubric.criteria.length, 9);

  // upstream_artifact: 計画JSON全文とdigest
  assert.ok(stateRes.upstream_artifact);
  assert.equal(stateRes.upstream_artifact.pinned_digest, digestBBB);
  assert.ok(stateRes.upstream_artifact.content.includes('タスク1 基本実装'));

  // current_artifact: digest
  assert.ok(stateRes.current_artifact);
  assert.equal(stateRes.current_artifact.digest, digestCCC);

  // chain: 3件のリンク
  assert.ok(stateRes.chain);
  assert.equal(stateRes.chain.links.length, 3);
  assert.equal(stateRes.chain.chain_rounds, 21);
  assert.equal(stateRes.chain.kickbacks, 0);

  // -------------------------------------------------------------
  // AT-17 Step 3: 上流が消えていた場合（孤立セッション）
  // -------------------------------------------------------------
  // 上流 sessionBBB のディレクトリを削除して欠落を再現
  rmSync(sessionDir(dataDir, sessionBBB), { recursive: true, force: true });

  const orphanResumeRes = loopOpenResume({
    input: {
      mode: 'resume',
      submission_id: subId(),
      session_id: sessionCCC,
    },
    persistence,
  });

  assert.equal(orphanResumeRes.state, 'DRAFTING');
  assert.equal(orphanResumeRes.orphan, true);
  assert.ok(orphanResumeRes.warnings.includes('upstream_missing'));
  assert.equal(orphanResumeRes.upstream.session_id, sessionBBB);
  assert.equal(orphanResumeRes.upstream.resolved, false);

  // 作業を続けてコミット
  const files11 = [
    { path: 'src/main_application_component_core.js', sha256: 'd'.repeat(64), bytes: 250, role: 'source' },
    { path: 'test/main.test.js', sha256: 'b'.repeat(64), bytes: 300, role: 'test' },
  ];
  const manifestSha11 = computeManifestDigest(files11);
  const testInv11 = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'f'.repeat(64),
    counts: { total: 10, passed: 10, failed: 0, skipped: 0 },
    tests: [
      { id: 'test/main.test.js::test1', file: 'test/main.test.js', status: 'passed' },
      { id: 'test/main.test.js::test2', file: 'test/main.test.js', status: 'passed' },
    ],
  };

  const commitRes11 = artifactCommit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 11,
      files: files11,
      manifest_command: 'git ls-files -s',
      manifest_output_sha256: manifestSha11,
      test_inventory: testInv11,
      change_note: '第11周目の改善成果物です。十分な長さの説明文を記述しています。',
      addresses: ['code_quality'],
    },
    persistence,
  });
  const digest11 = commitRes11.artifact.digest;

  // 合格判定（全9点）に達しても、上流欠落のため FINAL にはならず ESCALATED (upstream_missing) になる
  const passScores = makeScores(implementRubric, digest11, true, {}, { isRound11: true, excerpt: 'd'.repeat(64) });

  const orphanScoreRes = scoreSubmit({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      expected_round: 11,
      artifact_digest: digest11,
      scores: passScores,
    },
    persistence,
  });

  assert.equal(orphanScoreRes.verdict, 'PASS');
  assert.equal(orphanScoreRes.state, 'ESCALATED');
  assert.ok(orphanScoreRes.escalation);
  assert.equal(orphanScoreRes.escalation.reason, 'upstream_missing');

  // escalate(rebase) で digest 不一致なら E_UPSTREAM_DIGEST_MISMATCH
  assert.throws(
    () =>
      escalate({
        input: {
          session_id: sessionCCC,
          submission_id: subId(),
          action: 'rebase',
          upstream_digest: digestBBB,
          upstream_content: '不正な上流計画本文でありダイジェストが一致しないテキスト内容です。',
          note: '監査エクスポートから上流本文を復元しようとするがダイジェストが一致しないテストケース。',
        },
        persistence,
      }),
    { code: 'E_UPSTREAM_DIGEST_MISMATCH' },
  );

  // escalate(rebase) で正しい upstream_content を再供給して復元
  const rebaseRes = escalate({
    input: {
      session_id: sessionCCC,
      submission_id: subId(),
      action: 'rebase',
      upstream_digest: digestBBB,
      upstream_content: planContentBBB,
      note: '監査エクスポートから取り出した上流計画本文を復元しセッションの孤立状態を解消する。',
    },
    persistence,
  });

  assert.equal(rebaseRes.ok, true);
  assert.equal(rebaseRes.state, 'DRAFTING');
  assert.equal(rebaseRes.orphan, false);
});
