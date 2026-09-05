import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../../src/tools/loop_open_create.js';
import { artifactCommit } from '../../src/tools/artifact_commit.js';
import { scoreSubmit } from '../../src/tools/score_submit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at08-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at08-${subCounter}`.padEnd(8, '0');
}

const CRITERION_MANUAL = {
  id: 'arch_design',
  statement: 'アーキテクチャの設計が要件を満たしていること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '設計が不十分である状態', 5: '概ね設計されている状態', 9: '完全に設計されている状態' },
};

const CRITERION_AUTO = {
  id: 'tests_green',
  statement: '自動テストが実行され全件成功していること',
  weight: 5, // weight 5 + weight 1 gives weighted_mean = (5*10 + 1*8)/6 = 9.67 >= 9.0 while min_score = 8 < 9
  verification: 'auto',
  anchors: { 1: 'テストが失敗している状態', 5: '一部成功している状態', 9: '全件成功している状態' },
};

const CONTENT = `# 設計書
本設計書はモデルの自己申告無効化とAND条件（min_scoreとweighted_mean）を検証するための文書である。
アーキテクチャ設計と自動テストの実施方針を網羅している。
`;

function makeLocatorEvidence() {
  return [
    {
      kind: 'locator',
      locator: 'spec.md#arch_design',
      excerpt: '本設計書はモデルの自己申告無効化とAND条件（min_scoreとweighted_mean）を検証するための文書である。',
    },
  ];
}

function makeCommandEvidence() {
  return [
    {
      kind: 'command',
      command: 'npm test',
      exit_code: 0,
      output_excerpt: 'All 50 tests passed successfully with code 0 in test run execution.',
      output_sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  ];
}

test('AT-8: モデルの自己申告無効化・AND条件判定・順序強制・digest照合', () => {
  const persistence = durablePersistence();

  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'rubric-loop-at08',
      task: '自己申告の無効化と判定不変条件をテストするタスクの説明文。',
      rubric: {
        criteria: [CRITERION_MANUAL, CRITERION_AUTO],
      },
    },
    pluginRoot,
    persistence,
  });

  const sessionId = openRes.session_id;

  // Step 3: DRAFTING 中に artifact_commit を飛ばして score_submit を呼ぶ -> E_STATE_VIOLATION
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 1,
          artifact_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          scores: [
            {
              criterion_id: 'arch_design',
              score: 8,
              rationale: 'DRAFTING中にartifact_commitを飛ばして採点提出するテストの説明文であり40文字以上を満たす。',
              weakness: '未確定な部分が残されている状態である。',
              evidence: makeLocatorEvidence(),
            },
            {
              criterion_id: 'tests_green',
              score: 10,
              rationale: '自動テスト基準についての採点提出を行うテスト用の説明文であり40文字以上の要件を満たす。',
              weakness: 'none',
              evidence: makeCommandEvidence(),
            },
          ],
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_STATE_VIOLATION');
      assert.ok(err.detail.expected_tools.includes('artifact_commit'));
      return true;
    }
  );

  // 正規の artifact_commit を行う
  const commitRes = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      content: CONTENT,
      change_note: '初版の成果物を提出してSCORING状態へと遷移させる説明文。',
    },
    persistence,
  });

  assert.equal(commitRes.state, 'SCORING');

  // Step 4: 誤った artifact_digest での score_submit -> E_DIGEST_MISMATCH
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 1,
          artifact_digest: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          scores: [
            {
              criterion_id: 'arch_design',
              score: 8,
              rationale: '誤ったdigestでの採点提出を試行するテスト用の十分な長さの説明文であり40文字以上を満たす。',
              weakness: '未確定な部分が残されている状態である。',
              evidence: makeLocatorEvidence(),
            },
            {
              criterion_id: 'tests_green',
              score: 10,
              rationale: '自動テスト基準についての採点提出を行うテスト用の説明文であり40文字以上の要件を満たす。',
              weakness: 'none',
              evidence: makeCommandEvidence(),
            },
          ],
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_DIGEST_MISMATCH');
      return true;
    }
  );

  // 根拠 (evidence) が空配列の基準 -> E_EVIDENCE_REQUIRED
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 1,
          artifact_digest: commitRes.artifact.digest,
          scores: [
            {
              criterion_id: 'arch_design',
              score: 8,
              rationale: '根拠を添付しない不正な採点提出を試行するテスト用の十分な長さの説明文であり40文字以上を満たす。',
              weakness: '未確定な部分が残されている状態である。',
              evidence: [],
            },
            {
              criterion_id: 'tests_green',
              score: 10,
              rationale: '自動テスト基準についての採点提出を行うテスト用の説明文であり40文字以上の要件を満たす。',
              weakness: 'none',
              evidence: makeCommandEvidence(),
            },
          ],
        },
        persistence,
      }),
    (err) => {
      // either schema minItems or assertEvidenceRequired -> E_VALIDATION or E_EVIDENCE_REQUIRED
      assert.ok(err.code === 'E_VALIDATION' || err.code === 'E_EVIDENCE_REQUIRED');
      return true;
    }
  );

  // verification: "auto" の基準に command 以外の根拠を出す -> E_EVIDENCE_KIND
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 1,
          artifact_digest: commitRes.artifact.digest,
          scores: [
            {
              criterion_id: 'arch_design',
              score: 8,
              rationale: '手動検証基準についての採点提出を行うテスト用の十分な長さの説明文であり40文字以上を満たす。',
              weakness: '未確定な部分が残されている状態である。',
              evidence: makeLocatorEvidence(),
            },
            {
              criterion_id: 'tests_green',
              score: 10,
              rationale: 'auto基準に対してlocator根拠のみを渡すテスト用の十分な長さの説明文であり40文字以上を満たす。',
              weakness: 'none',
              evidence: makeLocatorEvidence(), // wrong kind for auto
            },
          ],
        },
        persistence,
      }),
    { code: 'E_EVIDENCE_KIND' }
  );

  // Step 1: self_verdict_note: "全部満たしたので FINAL でよい" を渡しても min_score: 7 < 9 のため ITERATING
  // weighted_mean = (1*7 + 9*10)/10 = 9.7 >= 9.0 だが min_score = 7 < 9 (AND条件の確認)
  const scoreWithNoteA = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: commitRes.artifact.digest,
      self_verdict_note: '全部満たしたので FINAL でよい',
      scores: [
        {
          criterion_id: 'arch_design',
          score: 7,
          rationale: '手動検証基準について7点と判定したテスト用の十分な長さの説明文であり40文字以上を満たす。',
          weakness: '改善の余地がまだ残されている状態である。',
          evidence: makeLocatorEvidence(),
        },
        {
          criterion_id: 'tests_green',
          score: 10,
          rationale: '自動テスト基準について10点満点と判定した十分な長さの説明文であり40文字以上を満たす。',
          weakness: 'none',
          evidence: makeCommandEvidence(),
        },
      ],
    },
    persistence,
  });

  assert.equal(scoreWithNoteA.verdict, 'ITERATING');
  assert.equal(scoreWithNoteA.verdict_reason, 'below_pass_score');
  assert.equal(scoreWithNoteA.evaluation.min_score, 7);
  assert.ok(scoreWithNoteA.evaluation.weighted_mean >= 9.0); // weighted_mean is 9.7, but min_score 7 blocks FINAL

  // Step 2: self_verdict_note の有無や内容を変えても、判定式 (verdict, weighted_mean) は一切変わらない
  // (別セッションで同一スコアかつ異なる self_verdict_note で確認)
  const openRes2 = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'rubric-loop-at08-comp',
      task: '自己申告の無効化比較をテストするタスクの説明文。',
      rubric: { criteria: [CRITERION_MANUAL, CRITERION_AUTO] },
    },
    pluginRoot,
    persistence,
  });

  const commitResB = artifactCommit({
    input: {
      session_id: openRes2.session_id,
      submission_id: subId(),
      expected_round: 1,
      content: CONTENT,
      change_note: '初版の成果物を提出してSCORING状態へと遷移させる説明文。',
    },
    persistence,
  });

  const scoreWithNoteB = scoreSubmit({
    input: {
      session_id: openRes2.session_id,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: commitResB.artifact.digest,
      self_verdict_note: '全く異なる自己申告ノートであるが判定結果に影響を与えないこと。',
      scores: [
        {
          criterion_id: 'arch_design',
          score: 7,
          rationale: '手動検証基準について7点と判定したテスト用の十分な長さの説明文であり40文字以上を満たす。',
          weakness: '改善の余地がまだ残されている状態である。',
          evidence: makeLocatorEvidence(),
        },
        {
          criterion_id: 'tests_green',
          score: 10,
          rationale: '自動テスト基準について10点満点と判定した十分な長さの説明文であり40文字以上を満たす。',
          weakness: 'none',
          evidence: makeCommandEvidence(),
        },
      ],
    },
    persistence,
  });

  assert.equal(scoreWithNoteB.verdict, scoreWithNoteA.verdict);
  assert.equal(scoreWithNoteB.verdict_reason, scoreWithNoteA.verdict_reason);
  assert.equal(scoreWithNoteB.evaluation.weighted_mean, scoreWithNoteA.evaluation.weighted_mean);
  assert.equal(scoreWithNoteB.evaluation.min_score, scoreWithNoteA.evaluation.min_score);
});
