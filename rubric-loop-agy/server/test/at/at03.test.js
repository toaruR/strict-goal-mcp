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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at03-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at03-${subCounter}`.padEnd(8, '0');
}

const CONTENT_R1 = `# rubric-loop-design 初版
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

const CONTENT_R2 = CONTENT_R1 + '\n14. self_hosting: セルフホスティングの記録として9周かけて収束させた完全なトレースログが保存されている。\n';

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

function makeEvidence(criterionId, verification, content, tag) {
  if (verification === 'auto') {
    return [
      {
        kind: 'command',
        command: `node --test check_${criterionId}.test.js`,
        exit_code: 0,
        output_excerpt: `Command output verified successfully for ${criterionId} with exit code 0`,
        output_sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
    ];
  }
  let excerpt = '';
  if (criterionId === 'self_hosting') {
    if (content.includes('完全なトレースログ')) {
      excerpt = '14. self_hosting: セルフホスティングの記録として9周かけて収束させた完全なトレースログが保存されている。';
    } else {
      excerpt = '14. self_hosting: セルフホスティングの記述は初版では限定的である。';
    }
  } else {
    const match = content.match(new RegExp(`.*${criterionId}.*`));
    excerpt = match ? match[0] : `${criterionId}: 失敗モードと基準の対応付けを詳細に定義している。`;
  }
  return [
    {
      kind: 'locator',
      locator: `spec.md#${criterionId}-${tag}`,
      excerpt,
    },
  ];
}

test('AT-3: ごまかし検出②（根拠捏造、使い回し、autoにlocator、ジャンプの拒否と監査記録）', () => {
  const persistence = durablePersistence();

  // 1. loop_open
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

  // Round 1 commit & score (self_hosting = 6)
  const commitRes1 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      content: CONTENT_R1,
      change_note: '初版の設計書を作成し各基準に対応する記述を盛り込んだ。',
    },
    persistence,
  });

  const scores1 = criteriaList.map((c) => ({
    criterion_id: c.id,
    score: c.id === 'self_hosting' ? 6 : (c.id === 'acceptance_tests' ? 4 : 7),
    rationale: `Round 1 evaluation rationale for criterion ${c.id} with sufficient explanation.`,
    weakness: '未達成の点があるため改善が必要である。',
    evidence: makeEvidence(c.id, c.v, CONTENT_R1, 'r1'),
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

  // Round 2 commit with revised content
  const commitRes2 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 2,
      content: CONTENT_R2,
      change_note: 'セルフホスティングの記述を改稿して改善した。',
      addresses: ['acceptance_tests'],
    },
    persistence,
  });

  // Step 2: 根拠の捏造（本文に存在しない excerpt を持つ locator） -> E_EVIDENCE_NOT_FOUND
  const scoresFabricated = criteriaList.map((c) => {
    if (c.id === 'self_hosting') {
      return {
        criterion_id: c.id,
        score: 9,
        rationale: '捏造した根拠に基づく自己評価の提示を行うテスト用の十分な長さの説明文であり40文字以上の制限を確実に満たす。',
        weakness: '更なる改善の余地があるため継続検討を要する。',
        evidence: [
          {
            kind: 'locator',
            locator: '付録Z',
            excerpt: '本設計書自身を9周かけて収束させた記録は付録Zに記載されている。',
          },
        ],
      };
    }
    return {
      criterion_id: c.id,
      score: 7,
      rationale: `Round 2 rationale for criterion ${c.id} with sufficient explanation exceeding 40 chars.`,
      weakness: '更なる改善の余地があるため継続検討を要する。',
      evidence: makeEvidence(c.id, c.v, CONTENT_R2, 'r2'),
    };
  });

  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 2,
          artifact_digest: commitRes2.artifact.digest,
          scores: scoresFabricated,
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_EVIDENCE_NOT_FOUND');
      assert.equal(err.detail.criterion_id, 'self_hosting');
      return true;
    }
  );

  // Step 3: 前周と同一の根拠を使い回してスコア上昇 (6 -> 9) -> E_EVIDENCE_STALE
  const scoresStale = criteriaList.map((c) => {
    if (c.id === 'self_hosting') {
      return {
        criterion_id: c.id,
        score: 9,
        rationale: '前周と全く同じ根拠のままスコアだけ引き上げる不正な提出に対する説明文であり40文字制限を満たす。',
        weakness: '更なる改善の余地があるため継続検討を要する。',
        evidence: makeEvidence(c.id, c.v, CONTENT_R1, 'r1'), // same locator as r1
      };
    }
    return {
      criterion_id: c.id,
      score: 7,
      rationale: `Round 2 rationale for criterion ${c.id} with sufficient explanation exceeding 40 chars.`,
      weakness: '更なる改善の余地があるため継続検討を要する。',
      evidence: makeEvidence(c.id, c.v, CONTENT_R2, 'r2'),
    };
  });

  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 2,
          artifact_digest: commitRes2.artifact.digest,
          scores: scoresStale,
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_EVIDENCE_STALE');
      assert.equal(err.detail.criterion_id, 'self_hosting');
      return true;
    }
  );

  // Step 4: verification:"auto" の基準に locator 根拠のみ -> E_EVIDENCE_KIND
  const scoresAutoWrongKind = criteriaList.map((c) => {
    if (c.id === 'packaging_conformance') {
      return {
        criterion_id: c.id,
        score: 9,
        rationale: 'auto基準に対してコマンドではなくロケータを提出する不正な試みの説明文であり40文字以上を満たす。',
        weakness: '更なる改善の余地があるため継続検討を要する。',
        evidence: [
          {
            kind: 'locator',
            locator: 'spec.md#packaging_conformance-wrong',
            excerpt: '8. packaging_conformance: パッケージ構成は規約に完全に準拠している。',
          },
        ],
      };
    }
    return {
      criterion_id: c.id,
      score: c.id === 'self_hosting' ? 6 : 7,
      rationale: `Round 2 rationale for criterion ${c.id} with sufficient explanation exceeding 40 chars.`,
      weakness: '更なる改善の余地があるため継続検討を要する。',
      evidence: makeEvidence(c.id, c.v, CONTENT_R2, 'r2'),
    };
  });

  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 2,
          artifact_digest: commitRes2.artifact.digest,
          scores: scoresAutoWrongKind,
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_EVIDENCE_KIND');
      assert.equal(err.detail.criterion_id, 'packaging_conformance');
      return true;
    }
  );

  // Step 5: スコアジャンプ（acceptance_tests 4 -> 9, delta 5 > max_score_jump 3, command根拠1件以下） -> E_SCORE_JUMP
  const scoresJump = criteriaList.map((c) => {
    if (c.id === 'acceptance_tests') {
      return {
        criterion_id: c.id,
        score: 9,
        rationale: '4点から9点へ一気に5点ジャンプさせる提出に対する十分な長さの説明文であり40文字制限を満たす。',
        weakness: '更なる改善の余地があるため継続検討を要する。',
        evidence: [
          {
            kind: 'locator',
            locator: 'spec.md#acceptance_tests-jump',
            excerpt: '12. acceptance_tests: 受け入れテストは初版では不十分である。',
          },
        ],
      };
    }
    return {
      criterion_id: c.id,
      score: c.id === 'self_hosting' ? 6 : 7,
      rationale: `Round 2 rationale for criterion ${c.id} with sufficient explanation exceeding 40 chars.`,
      weakness: '更なる改善の余地があるため継続検討を要する。',
      evidence: makeEvidence(c.id, c.v, CONTENT_R2, 'r2'),
    };
  });

  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 2,
          artifact_digest: commitRes2.artifact.digest,
          scores: scoresJump,
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_SCORE_JUMP');
      assert.equal(err.detail.criterion_id, 'acceptance_tests');
      assert.equal(err.detail.delta, 5);
      return true;
    }
  );

  // Step 6: 正しい根拠一式で提出 -> 受理され ITERATING または FINAL になる
  const scoresValid = criteriaList.map((c) => ({
    criterion_id: c.id,
    score: c.id === 'acceptance_tests' ? 7 : (c.id === 'self_hosting' ? 8 : 7), // delta <= 3
    rationale: `Round 2 valid evaluation rationale for criterion ${c.id} with sufficient explanation.`,
    weakness: '更なる改善の余地があるため継続検討を要する。',
    evidence: makeEvidence(c.id, c.v, CONTENT_R2, 'r2-valid'),
  }));

  const scoreResValid = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 2,
      artifact_digest: commitRes2.artifact.digest,
      scores: scoresValid,
    },
    persistence,
  });

  assert.equal(scoreResValid.ok, true);
  assert.equal(scoreResValid.verdict, 'ITERATING');
  assert.equal(scoreResValid.round, 3);

  // 監査エクスポートに各拒否提出が記録されていることを確認
  const auditRes = auditExport({
    input: {
      session_id: sessionId,
    },
    persistence,
  });

  const auditContent = JSON.parse(readFileSync(auditRes.export.path, 'utf8'));
  const rejectedCodes = auditContent.rejected_submissions.map((r) => r.error_code);
  assert.ok(rejectedCodes.includes('E_EVIDENCE_NOT_FOUND'));
  assert.ok(rejectedCodes.includes('E_EVIDENCE_STALE'));
  assert.ok(rejectedCodes.includes('E_EVIDENCE_KIND'));
  assert.ok(rejectedCodes.includes('E_SCORE_JUMP'));
  assert.equal(auditRes.export.summary.rejected_submissions, 4);
});
