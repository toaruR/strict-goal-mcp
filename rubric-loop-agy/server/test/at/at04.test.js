import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../../src/tools/loop_open_create.js';
import { artifactCommit } from '../../src/tools/artifact_commit.js';
import { scoreSubmit } from '../../src/tools/score_submit.js';
import { escalate } from '../../src/tools/escalate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at04-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at04-${subCounter}`.padEnd(8, '0');
}

const CRITERION_MANUAL = {
  id: 'quality',
  statement: '設計の全体的な品質と詳細度が十分に記述されていること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '低品質である状態', 5: '中品質である状態', 9: '高品質である状態' },
};

function makeContent(r) {
  return `# 設計書 第${r}版
本設計書は品質とアーキテクチャの妥当性を検証するためのテスト用ドキュメントである。
第${r}周の更新により記述の具体性を段階的に向上させている。
`;
}

function makeEvidence(r) {
  return [
    {
      kind: 'locator',
      locator: `spec.md#r${r}`,
      excerpt: `本設計書は品質とアーキテクチャの妥当性を検証するためのテスト用ドキュメントである。`,
    },
  ];
}

test('AT-4: 停滞打ち切りシナリオ（3周連続停滞でSTALLED、escalate/request_human、resolve/continueで復旧）', () => {
  const persistence = durablePersistence();

  // 1. loop_open with custom policy: stall_window: 3, stall_epsilon: 0.25, max_rounds: 12
  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'rubric-loop-at04',
      task: '停滞打ち切りシナリオを検証するためのセッションを作成する。',
      rubric: {
        policy: {
          pass_score: 9,
          pass_weighted_mean: 9.0,
          stall_window: 3,
          stall_epsilon: 0.25,
          max_rounds: 12,
          max_score_jump: 3,
        },
        criteria: [CRITERION_MANUAL],
      },
    },
    pluginRoot,
    persistence,
  });

  const sessionId = openRes.session_id;

  // 周回を進めてベースラインスコアを作成
  // Round 1 (score 6)
  const c1 = artifactCommit({
    input: { session_id: sessionId, submission_id: subId(), expected_round: 1, content: makeContent(1), change_note: '第1版の成果物を提出してベースラインとする。' },
    persistence,
  });
  scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: c1.artifact.digest,
      scores: [{ criterion_id: 'quality', score: 6, rationale: '第1周の評価結果として品質基準を6点と判定したテスト用の十分な説明文であり40文字以上を満たす。', weakness: '改善の余地が大きい。', evidence: makeEvidence(1) }],
    },
    persistence,
  });

  // Round 2 (score 7 -> improvement 1.0)
  const c2 = artifactCommit({
    input: { session_id: sessionId, submission_id: subId(), expected_round: 2, content: makeContent(2), change_note: '第2版の成果物を提出して品質を向上させた。', addresses: ['quality'] },
    persistence,
  });
  scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 2,
      artifact_digest: c2.artifact.digest,
      scores: [{ criterion_id: 'quality', score: 7, rationale: '第2周の評価結果として品質基準を7点と判定したテスト用の十分な説明文であり40文字以上を満たす。', weakness: '更なる改善が必要である。', evidence: makeEvidence(2) }],
    },
    persistence,
  });

  // Round 3 (score 8 -> improvement 1.0)
  const c3 = artifactCommit({
    input: { session_id: sessionId, submission_id: subId(), expected_round: 3, content: makeContent(3), change_note: '第3版の成果物を提出して品質を向上させた。', addresses: ['quality'] },
    persistence,
  });
  scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 3,
      artifact_digest: c3.artifact.digest,
      scores: [{ criterion_id: 'quality', score: 8, rationale: '第3周の評価結果として品質基準を8点と判定したテスト用の十分な説明文であり40文字以上を満たす。', weakness: '細部の詰めが必要である。', evidence: makeEvidence(3) }],
    },
    persistence,
  });

  // Round 4 (score 8 -> improvement 0.0 -> stall count 1)
  const c4 = artifactCommit({
    input: { session_id: sessionId, submission_id: subId(), expected_round: 4, content: makeContent(4), change_note: '第4版の成果物を提出したがスコアは据え置き。', addresses: ['quality'] },
    persistence,
  });
  const s4 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 4,
      artifact_digest: c4.artifact.digest,
      scores: [{ criterion_id: 'quality', score: 8, rationale: '第4周の評価結果として品質基準を8点と判定したテスト用の十分な説明文であり40文字以上を満たす。', weakness: '細部の詰めが必要である。', evidence: makeEvidence(4) }],
    },
    persistence,
  });
  assert.equal(s4.verdict, 'ITERATING');
  assert.equal(s4.stall.rounds_without_improvement, 1);

  // Round 5 (score 8 -> improvement 0.0 -> stall count 2)
  const c5 = artifactCommit({
    input: { session_id: sessionId, submission_id: subId(), expected_round: 5, content: makeContent(5), change_note: '第5版の成果物を提出したがスコアは据え置き。', addresses: ['quality'] },
    persistence,
  });
  const s5 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 5,
      artifact_digest: c5.artifact.digest,
      scores: [{ criterion_id: 'quality', score: 8, rationale: '第5周の評価結果として品質基準を8点と判定したテスト用の十分な説明文であり40文字以上を満たす。', weakness: '細部の詰めが必要である。', evidence: makeEvidence(5) }],
    },
    persistence,
  });
  assert.equal(s5.verdict, 'ITERATING');
  assert.equal(s5.stall.rounds_without_improvement, 2);

  // Round 6 (score 8 -> improvement 0.0 -> stall count 3 == stall_window -> STALLED!)
  const c6 = artifactCommit({
    input: { session_id: sessionId, submission_id: subId(), expected_round: 6, content: makeContent(6), change_note: '第6版の成果物を提出したがスコアは据え置き。', addresses: ['quality'] },
    persistence,
  });
  const s6 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 6,
      artifact_digest: c6.artifact.digest,
      scores: [{ criterion_id: 'quality', score: 8, rationale: '第6周の評価結果として品質基準を8点と判定したテスト用の十分な説明文であり40文字以上を満たす。', weakness: '細部の詰めが必要である。', evidence: makeEvidence(6) }],
    },
    persistence,
  });

  assert.equal(s6.verdict, 'STALLED');
  assert.equal(s6.verdict_reason, 'no_improvement');
  assert.equal(s6.state, 'STALLED');
  assert.equal(s6.round, 6); // round stays at 6
  assert.equal(s6.next_action.tool, 'escalate');

  // Step 4: STALLED状態で artifact_commit / score_submit は E_STATE_VIOLATION
  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 6,
          content: makeContent(7),
          change_note: 'STALLED状態でのコミットを試行して拒否されることを確認する。',
          addresses: ['quality'],
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_STATE_VIOLATION');
      assert.ok(err.detail.expected_tools.includes('escalate'));
      return true;
    }
  );

  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 6,
          artifact_digest: c6.artifact.digest,
          scores: [{ criterion_id: 'quality', score: 8, rationale: 'STALLED状態での採点提出を試行して拒否されることを確認するための十分な長さの説明文。', weakness: '細部の詰めが必要である。', evidence: makeEvidence(6) }],
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_STATE_VIOLATION');
      assert.ok(err.detail.expected_tools.includes('escalate'));
      return true;
    }
  );

  // Step 5: escalate(request_human) -> ESCALATED
  const escRes = escalate({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      action: 'request_human',
      note: '3周連続でスコアが改善しないため、人間の判断を仰ぐためのエスカレーション要求を行う。',
    },
    persistence,
  });

  assert.equal(escRes.state, 'ESCALATED');
  assert.ok(escRes.escalation.token_path);
  assert.ok(existsSync(escRes.escalation.token_path));

  // トークン値がレスポンスに含まれないことを確認
  const realToken = readFileSync(escRes.escalation.token_path, 'utf8').trim();
  assert.ok(!JSON.stringify(escRes).includes(realToken));

  // Step 6: 誤った human_token での resolve/continue -> E_TOKEN_INVALID
  assert.throws(
    () =>
      escalate({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          action: 'resolve',
          resolution: 'continue',
          human_token: 'wrong-token-invalid-value',
          note: '誤ったトークンで続行を試行して拒否されることを確認するためのテスト用ノートであり40文字以上を満たす。',
        },
        persistence,
      }),
    { code: 'E_TOKEN_INVALID' }
  );

  // Step 7: 正しい human_token での resolve/continue -> DRAFTING, round進む, stall reset
  const resolveRes = escalate({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      action: 'resolve',
      resolution: 'continue',
      human_token: realToken,
      note: '人間による確認が完了し、追加周回を付与してループの継続を指示するための十分な長さのノート。',
    },
    persistence,
  });

  assert.equal(resolveRes.state, 'DRAFTING');
  assert.equal(resolveRes.round, 7); // round progressed from 6 to 7

  // DRAFTING状態での resolve は E_RESOLUTION_NOT_APPLICABLE
  assert.throws(
    () =>
      escalate({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          action: 'resolve',
          resolution: 'continue',
          human_token: realToken,
          note: '消費済みトークンでの再試行テストを行い拒否されることを確認するための十分な長さの説明文。',
        },
        persistence,
      }),
    { code: 'E_RESOLUTION_NOT_APPLICABLE' }
  );
});
