import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../../src/tools/loop_open_create.js';
import { artifactCommit } from '../../src/tools/artifact_commit.js';
import { scoreSubmit } from '../../src/tools/score_submit.js';
import { rubricAmend } from '../../src/tools/rubric_amend.js';
import { escalate } from '../../src/tools/escalate.js';
import { auditExport } from '../../src/tools/audit_export.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at07-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at07-${subCounter}`.padEnd(8, '0');
}

const CRITERION_A = {
  id: 'functionality',
  statement: '機能が設計書の要求仕様を完全に満たしていること',
  weight: 2,
  verification: 'manual',
  anchors: { 1: '機能が不十分な状態', 5: '概ね動作する状態', 9: '完全に動作する状態' },
};

const CRITERION_B = {
  id: 'performance',
  statement: '性能が目標指標を満たし高速に応答すること',
  weight: 2,
  verification: 'manual',
  anchors: { 1: '性能が非常に低い状態', 5: '許容範囲内の状態', 9: '非常に高速な状態' },
};

const CONTENT = `# 設計書
本設計書は rubric 緩和の検出とエスカレーション機構を検証するための文書である。
1. functionality: 機能要求はすべて完全に満たされていることが確認できる。
2. performance: 性能要求はすべて目標数値を達成していることが確認できる。
`;

function makeEvidence(cid) {
  return [
    {
      kind: 'locator',
      locator: `spec.md#${cid}`,
      excerpt: '本設計書は rubric 緩和の検出とエスカレーション機構を検証するための文書である。',
    },
  ];
}

test('AT-7: rubric 緩和検出シナリオ（緩和改訂、ESCALATED、人間承認後のFINAL_WITH_RELAXATION、監査記録）', () => {
  const persistence = durablePersistence();

  // 1. loop_open
  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'rubric-loop-at07',
      task: 'rubric緩和の検出と人間承認による確定プロセスをテストする。',
      rubric: {
        criteria: [CRITERION_A, CRITERION_B],
      },
    },
    pluginRoot,
    persistence,
  });

  const sessionId = openRes.session_id;

  // Step 1: rubric_amend で重みを下げる（緩和）を acknowledge_relaxation: false で提出 -> E_RELAXATION_UNACKNOWLEDGED
  assert.throws(
    () =>
      rubricAmend({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 1,
          criteria: [{ ...CRITERION_A, weight: 1 }, CRITERION_B], // weight lowered from 2 to 1 -> relaxation
          reason: '機能基準の重みを2から1へ下げる改訂を行う理由の十分な説明文であり40文字以上を満たす。',
          acknowledge_relaxation: false,
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_RELAXATION_UNACKNOWLEDGED');
      assert.equal(err.detail.classification, 'relaxation');
      return true;
    }
  );

  // Step 2: acknowledge_relaxation: true で再提出 -> 受理され final_reachable: false
  const amendRes = rubricAmend({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      criteria: [{ ...CRITERION_A, weight: 1 }, CRITERION_B],
      reason: '機能基準の重みを2から1へ下げる改訂を行う理由の十分な説明文であり40文字以上を満たす。',
      acknowledge_relaxation: true,
    },
    persistence,
  });

  assert.equal(amendRes.ok, true);
  assert.equal(amendRes.rubric_version, 2);
  assert.equal(amendRes.classification, 'relaxation');
  assert.equal(amendRes.relaxation_count, 1);
  assert.equal(amendRes.final_reachable, false);

  // Step 3: criteria に policy を含めて送る -> E_VALIDATION
  assert.throws(
    () =>
      rubricAmend({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 1,
          policy: { pass_score: 8 },
          criteria: [{ ...CRITERION_A, weight: 1 }, CRITERION_B],
          reason: 'policy変更を試行してバリデーションエラーとなることを確認するためのテスト用説明文。',
          acknowledge_relaxation: true,
        },
        persistence,
      }),
    { code: 'E_VALIDATION' }
  );

  // Step 4: artifact_commit & score_submit (全基準 9点) -> FINALにならず ESCALATED
  const commitRes = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      content: CONTENT,
      change_note: '初版の成果物を提出して採点フェーズへと移行させる説明文。',
    },
    persistence,
  });

  const scoreRes = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: commitRes.artifact.digest,
      scores: [
        {
          criterion_id: 'functionality',
          score: 9,
          rationale: '機能基準について満点を付与した十分な説明文であり40文字以上の要件を確実に満たす。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: makeEvidence('functionality'),
        },
        {
          criterion_id: 'performance',
          score: 9,
          rationale: '性能基準について満点を付与した十分な説明文であり40文字以上の要件を確実に満たす。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: makeEvidence('performance'),
        },
      ],
    },
    persistence,
  });

  assert.equal(scoreRes.verdict, 'ESCALATED');
  assert.equal(scoreRes.verdict_reason, 'relaxation_pending_approval');
  assert.equal(scoreRes.state, 'ESCALATED');

  // Step 5: 人間によるトークン承認 (resolve / relax_rubric)
  const sDir = path.join(persistence.dir, 'sessions', sessionId, 'escalations');
  const escFiles = readdirSync(sDir).filter((name) => name.endsWith('.token'));
  assert.ok(escFiles.length > 0);
  const token = readFileSync(path.join(sDir, escFiles[0]), 'utf8').trim();

  const resolveRes = escalate({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      action: 'resolve',
      resolution: 'relax_rubric',
      human_token: token,
      note: '基準の重み緩和を人間が確認し承認したため確定処理へと進めるための十分な長さのノート。',
    },
    persistence,
  });

  assert.equal(resolveRes.ok, true);

  // Step 6: 承認後の提出 -> FINAL_WITH_RELAXATION
  const finalScoreRes = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: commitRes.artifact.digest,
      scores: [
        {
          criterion_id: 'functionality',
          score: 9,
          rationale: '機能基準について承認後の再評価で満点を付与した40文字以上の要件を満たす説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: makeEvidence('functionality'),
        },
        {
          criterion_id: 'performance',
          score: 9,
          rationale: '性能基準について承認後の再評価で満点を付与した40文字以上の要件を満たす説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: makeEvidence('performance'),
        },
      ],
    },
    persistence,
  });

  assert.equal(finalScoreRes.verdict, 'FINAL_WITH_RELAXATION');
  assert.equal(finalScoreRes.state, 'FINAL_WITH_RELAXATION');

  // Step 7: audit_export で緩和の事実が監査に残ることを確認
  const auditRes = auditExport({
    input: { session_id: sessionId },
    persistence,
  });

  assert.equal(auditRes.export.summary.final_verdict, 'FINAL_WITH_RELAXATION');
  assert.equal(auditRes.export.summary.relaxations, 1);

  const auditContent = JSON.parse(readFileSync(auditRes.export.path, 'utf8'));
  assert.equal(auditContent.rubric_versions[1].classification, 'relaxation');
});
