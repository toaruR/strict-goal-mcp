import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
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
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at01-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at01-${subCounter}`.padEnd(8, '0');
}

const BASE_CONTENT_1 = `# rubric-loop-design 初版
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

const BASE_CONTENT_2 = BASE_CONTENT_1.replace(
  '12. acceptance_tests: 受け入れテストは初版では不十分である。',
  '12. acceptance_tests: 受け入れテストは18本の詳細なシナリオAT-1からAT-18まで完全網羅された仕様である。'
);

const BASE_CONTENT_3 = BASE_CONTENT_2.replace(
  '14. self_hosting: セルフホスティングの記述は初版では限定的である。',
  '14. self_hosting: セルフホスティングの記録として9周かけて収束させた完全なトレースログが保存されている。'
);

function makeEvidence(criterionId, verification, content, round) {
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
    if (round === 1) {
      excerpt = '12. acceptance_tests: 受け入れテストは初版では不十分である。';
    } else {
      excerpt = '12. acceptance_tests: 受け入れテストは18本の詳細なシナリオAT-1からAT-18まで完全網羅された仕様である。';
    }
  } else if (criterionId === 'self_hosting') {
    if (round < 3) {
      excerpt = '14. self_hosting: セルフホスティングの記述は初版では限定的である。';
    } else {
      excerpt = '14. self_hosting: セルフホスティングの記録として9周かけて収束させた完全なトレースログが保存されている。';
    }
  } else {
    // extract line
    const match = content.match(new RegExp(`.*${criterionId}.*`));
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

test('AT-1: 正常収束シナリオ（design 15基準で round 1〜3 経て FINAL、事後コミット拒否、audit_export）', () => {
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

  assert.equal(openRes.ok, true);
  assert.equal(openRes.handle_minted, true);
  assert.match(openRes.session_id, /^rl_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(openRes.state, 'DRAFTING');
  assert.equal(openRes.round, 1);
  assert.equal(openRes.rubric_version, 1);
  assert.equal(openRes.next_action.tool, 'artifact_commit');

  const sessionId = openRes.session_id;

  // 2. artifact_commit (Round 1)
  const commitRes1 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      content: BASE_CONTENT_1,
      change_note: '初版の設計書を作成し各基準に対応する記述を盛り込んだ。',
    },
    persistence,
  });

  assert.equal(commitRes1.state, 'SCORING');
  assert.match(commitRes1.artifact.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(commitRes1.artifact.unchanged, false);
  assert.equal(commitRes1.next_action.tool, 'score_submit');

  // 3. score_submit (Round 1) -> lowest 6 on acceptance_tests
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

  const scores1 = criteriaList.map((c) => ({
    criterion_id: c.id,
    score: c.id === 'acceptance_tests' ? 6 : 7,
    rationale: `Round 1 evaluation rationale for criterion ${c.id} with sufficient explanation.`,
    weakness: c.id === 'acceptance_tests' ? '受け入れテストのシナリオ数が少なく網羅性が不十分である。' : '全体的により詳細な検証が必要である。',
    evidence: makeEvidence(c.id, c.v, BASE_CONTENT_1, 1),
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

  assert.equal(scoreRes1.verdict, 'ITERATING');
  assert.equal(scoreRes1.verdict_reason, 'below_pass_score');
  assert.equal(scoreRes1.evaluation.min_score, 6);
  assert.equal(scoreRes1.must_fix[0].criterion_id, 'acceptance_tests');
  assert.equal(scoreRes1.round, 2);
  assert.equal(scoreRes1.state, 'DRAFTING');

  // 4. artifact_commit (Round 2)
  const commitRes2 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 2,
      content: BASE_CONTENT_2,
      change_note: '受け入れテストを18本に拡充して詳細仕様を定義した。',
      addresses: ['acceptance_tests'],
    },
    persistence,
  });

  assert.equal(commitRes2.state, 'SCORING');
  assert.equal(commitRes2.artifact.unchanged, false);
  assert.ok(commitRes2.artifact.diff.added_lines > 0);

  // 5. score_submit (Round 2) -> lowest 8 on self_hosting, others 9
  const scores2 = criteriaList.map((c) => ({
    criterion_id: c.id,
    score: c.id === 'self_hosting' ? 8 : 9,
    rationale: `Round 2 evaluation rationale for criterion ${c.id} with sufficient explanation.`,
    weakness: c.id === 'self_hosting' ? 'セルフホスティングの記録が限定的であり補強を要する。' : '細部の表現について更なる洗練の余地がある。',
    evidence: makeEvidence(c.id, c.v, BASE_CONTENT_2, 2),
  }));

  const scoreRes2 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 2,
      artifact_digest: commitRes2.artifact.digest,
      scores: scores2,
    },
    persistence,
  });

  assert.equal(scoreRes2.verdict, 'ITERATING');
  assert.ok(scoreRes2.evaluation.improvement > 0);
  assert.equal(scoreRes2.must_fix[0].criterion_id, 'self_hosting');
  assert.equal(scoreRes2.round, 3);

  // 6. artifact_commit (Round 3) & score_submit (Round 3) -> All >= 9
  const commitRes3 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 3,
      content: BASE_CONTENT_3,
      change_note: 'セルフホスティングの記述を大幅に補強し収束記録を追加した。',
      addresses: ['self_hosting'],
    },
    persistence,
  });

  assert.equal(commitRes3.state, 'SCORING');

  const scores3 = criteriaList.map((c) => ({
    criterion_id: c.id,
    score: 9,
    rationale: `Round 3 evaluation rationale for criterion ${c.id} with sufficient explanation.`,
    weakness: '軽微な語彙の選択について改善の余地が残る。',
    evidence: makeEvidence(c.id, c.v, BASE_CONTENT_3, 3),
  }));

  const scoreRes3 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 3,
      artifact_digest: commitRes3.artifact.digest,
      scores: scores3,
    },
    persistence,
  });

  assert.equal(scoreRes3.verdict, 'FINAL');
  assert.equal(scoreRes3.verdict_reason, 'all_criteria_passed');
  assert.ok(scoreRes3.evaluation.weighted_mean >= 9.0);
  assert.equal(scoreRes3.state, 'FINAL');
  assert.equal(scoreRes3.next_action.tool, 'audit_export');

  // 7. artifact_commit after FINAL should fail with E_STATE_VIOLATION
  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 3,
          content: BASE_CONTENT_3 + '\n# Extra',
          change_note: 'FINAL到達後の不要な追記を試みるテストのための変更注記。',
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_STATE_VIOLATION');
      assert.ok(err.detail.expected_tools.includes('audit_export'));
      assert.ok(err.detail.expected_tools.includes('loop_state'));
      return true;
    }
  );

  // 8. audit_export
  const auditRes = auditExport({
    input: {
      session_id: sessionId,
    },
    persistence,
  });

  assert.ok(auditRes.export.path);
  assert.ok(existsSync(auditRes.export.path));
  assert.equal(auditRes.export.summary.final_verdict, 'FINAL');
  assert.equal(auditRes.export.summary.rejected_submissions, 0);
});
