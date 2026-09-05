import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../../src/tools/loop_open_create.js';
import { artifactCommit } from '../../src/tools/artifact_commit.js';
import { scoreSubmit } from '../../src/tools/score_submit.js';
import { auditExport } from '../../src/tools/audit_export.js';
import { sessionDir } from '../../src/store/session_store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at02-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at02-${subCounter}`.padEnd(8, '0');
}

const CONTENT = `# rubric-loop-design 初版
本設計書は rubric-loop MCP サーバの仕様と受け入れ基準を定義する文書である。
1. failure_mode_mapping: 失敗モードと基準の対応付けを詳細に定義している。
2. interface_completeness: 全てのMCPツールとスキーマ定義が揃っている。
3. state_externalized: 状態は全てファイルシステムに外部化されている。
4. verdict_ownership: 判定はサーバのみが下しクライアントは関与できない。
5. anti_gaming: スコアの急上昇や成果物不変での点数上昇を厳格に阻止する。
6. state_machine: 状態遷移機械は全9状態と遷移ルールを網羅している。
7. convergence: 周回の上限と停滞検出により必ず有限時間で収束する。
8. packaging_conformance: パッケージ構成は規約に完全に準拠している。
9. host_portability: ホスト依存を排除し各環境で可搬である。
10. responsibility_split: 責務分割が明確で単一責任の原則に従う。
11. auditability: 全ての決定と提出が監査ログに記録され検証可能である。
12. acceptance_tests: 受け入れテストは初版では不十分である。
13. defaults_decided: 全ての既定値が表形式で決定されている。
14. self_hosting: セルフホスティングの記述は初版では限定的である。
15. rejected_alternatives: 却下された代替案が理由とともに記録されている。
`;

function makeEvidence(criterionId, verification, round) {
  if (verification === 'auto') {
    return [
      {
        kind: 'command',
        command: `node --test check_${criterionId}.test.js`,
        exit_code: 0,
        output_excerpt: `Command verified successfully for ${criterionId} at round ${round} with exit code 0`,
        output_sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
    ];
  }
  let excerpt = '';
  if (criterionId === 'acceptance_tests') {
    excerpt = '12. acceptance_tests: 受け入れテストは初版では不十分である。';
  } else if (criterionId === 'self_hosting') {
    excerpt = '14. self_hosting: セルフホスティングの記述は初版では限定的である。';
  } else {
    const match = CONTENT.match(new RegExp(`.*${criterionId}.*`));
    excerpt = match ? match[0] : `${criterionId}: 失敗モードと基準の対応付けを詳細に定義している。`;
  }
  return [
    {
      kind: 'locator',
      locator: `spec.md#${criterionId}-r${round}`,
      excerpt,
    },
  ];
}

const criteriaList = [
  { id: 'failure_mode_mapping', v: 'manual' },
  { id: 'interface_completeness', v: 'auto' },
  { id: 'state_externalized', v: 'manual' },
  { id: 'verdict_ownership', v: 'manual' },
  { id: 'anti_gaming', v: 'manual' },
  { id: 'state_machine', v: 'manual' },
  { id: 'convergence', v: 'manual' },
  { id: 'packaging_conformance', v: 'auto' },
  { id: 'host_portability', v: 'manual' },
  { id: 'responsibility_split', v: 'manual' },
  { id: 'auditability', v: 'manual' },
  { id: 'acceptance_tests', v: 'manual' },
  { id: 'defaults_decided', v: 'auto' },
  { id: 'self_hosting', v: 'manual' },
  { id: 'rejected_alternatives', v: 'manual' },
];

test('AT-2: ごまかし検出①（成果物不変でスコア上昇 E_SCORE_INFLATION）', () => {
  const persistence = durablePersistence();

  // 1. セッション初期化と Round 1 実行（AT-1のステップ3まで）
  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'rubric-loop-design',
      task: 'rubric-loop MCP サーバの設計書を作成し、15基準で評価して収束させる。',
    },
    pluginRoot,
    persistence,
  });

  const sessionId = openRes.session_id;

  const commitRes1 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      content: CONTENT,
      change_note: '初版の設計書を作成し各基準に対応する記述を盛り込んだ。',
    },
    persistence,
  });

  const scores1 = criteriaList.map((c) => ({
    criterion_id: c.id,
    score: c.id === 'acceptance_tests' ? 6 : 7,
    rationale: `Round 1 evaluation rationale for criterion ${c.id} with sufficient explanation.`,
    weakness: c.id === 'acceptance_tests' ? '受け入れテストのシナリオ数が少なく網羅性が不十分である。' : '全体的により詳細な検証が必要である。',
    evidence: makeEvidence(c.id, c.v, 1),
  }));

  const scoreRes1 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: commitRes1.artifact.digest,
      scores: scores1,
    },
    persistence,
  });

  assert.equal(scoreRes1.round, 2);
  assert.equal(scoreRes1.state, 'DRAFTING');

  // Step 1: artifact_commit (Round 2) with IDENTICAL content
  const commitRes2 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 2,
      content: CONTENT,
      change_note: '表現を見直したが結論は同じであるため本文は変更しない。',
      addresses: ['acceptance_tests'],
    },
    persistence,
  });

  assert.equal(commitRes2.ok, true);
  assert.equal(commitRes2.artifact.unchanged, true);
  assert.equal(commitRes2.artifact.previous_digest, commitRes2.artifact.digest);
  assert.ok(commitRes2.warnings.includes('artifact_unchanged'));

  // Step 2: score_submit with acceptance_tests inflated from 6 to 9 -> E_SCORE_INFLATION
  const scoresInflated = criteriaList.map((c) => ({
    criterion_id: c.id,
    score: c.id === 'acceptance_tests' ? 9 : 7,
    rationale: `Round 2 evaluation rationale for criterion ${c.id} with sufficient explanation.`,
    weakness: '更なるブラッシュアップの余地がある。',
    evidence: makeEvidence(c.id, c.v, 2),
  }));

  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 2,
          artifact_digest: commitRes2.artifact.digest,
          scores: scoresInflated,
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_SCORE_INFLATION');
      assert.ok(err.detail.criteria.some((item) => item.criterion_id === 'acceptance_tests'));
      return true;
    }
  );

  // 拒否された提出が rounds/2.rejected/ に残る
  const sDir = sessionDir(persistence.dir, sessionId);
  const rejectedDir = path.join(sDir, 'rounds', '2.rejected');
  assert.ok(existsSync(rejectedDir));
  const rejectedFiles = readdirSync(rejectedDir);
  assert.ok(rejectedFiles.length > 0);
  const rejectedRecord = JSON.parse(readFileSync(path.join(rejectedDir, rejectedFiles[0]), 'utf8'));
  assert.equal(rejectedRecord.error_code, 'E_SCORE_INFLATION');
  assert.equal(rejectedRecord.round, 2);

  // Step 3: score_submit with all identical scores to round 1 -> succeeds, improvement: 0
  const scoresUnchanged = criteriaList.map((c) => ({
    criterion_id: c.id,
    score: c.id === 'acceptance_tests' ? 6 : 7,
    rationale: `Round 2 evaluation rationale with unchanged scores for ${c.id}.`,
    weakness: '前回と同じ弱点が存在している。',
    evidence: makeEvidence(c.id, c.v, 2),
  }));

  const scoreRes3 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 2,
      artifact_digest: commitRes2.artifact.digest,
      scores: scoresUnchanged,
    },
    persistence,
  });

  assert.equal(scoreRes3.ok, true);
  assert.equal(scoreRes3.verdict, 'ITERATING');
  assert.equal(scoreRes3.evaluation.improvement, 0.0);
  assert.equal(scoreRes3.stall.rounds_without_improvement, 1);
  assert.equal(scoreRes3.round, 3);

  // Step 4: audit_export should contain the rejected submission
  const auditRes = auditExport({
    input: {
      session_id: sessionId,
    },
    persistence,
  });

  const auditContent = JSON.parse(readFileSync(auditRes.export.path, 'utf8'));
  assert.ok(auditContent.rejected_submissions.length >= 1);
  assert.equal(auditContent.rejected_submissions[0].error_code, 'E_SCORE_INFLATION');
  assert.equal(auditRes.export.summary.rejected_submissions, 1);
});
