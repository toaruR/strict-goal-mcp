import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
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
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at05-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at05-${subCounter}`.padEnd(8, '0');
}

const CRITERION_A = {
  id: 'quality',
  statement: '設計の全体的な品質と詳細度が十分に記述されていること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '低品質である状態', 5: '中品質である状態', 9: '高品質である状態' },
};

const CRITERION_B = {
  id: 'clarity',
  statement: '記述の明快さと論理構造が明確に整理されていること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '不明瞭である状態', 5: '中程度である状態', 9: '明快である状態' },
};

function makeContent(r) {
  return `# 設計書 第${r}版
本設計書は品質とアーキテクチャの妥当性を検証するためのテスト用ドキュメントである。
第${r}周の改善事項として記述の詳細度を段階的に高めている。
`;
}

function makeEvidence(r, cid) {
  return [
    {
      kind: 'locator',
      locator: `spec.md#${cid}-r${r}`,
      excerpt: `本設計書は品質とアーキテクチャの妥当性を検証するためのテスト用ドキュメントである。`,
    },
  ];
}

test('AT-5: max_rounds 到達シナリオ（max_rounds到達でSTALLED、abortでABORTED終端、事後escalate拒否）', () => {
  const persistence = durablePersistence();

  // 1. loop_open: loop_mode: "design" (max_rounds 既定値 12)
  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'rubric-loop-at05',
      task: 'max_rounds 到達による打ち切りと中断を検証するタスクの説明文。',
      rubric: {
        criteria: [CRITERION_A, CRITERION_B],
      },
    },
    pluginRoot,
    persistence,
  });

  const sessionId = openRes.session_id;

  // 毎周 0.5 ずつ改善させながら round 1〜11 を回す（rounds_without_improvement は常に 0）
  for (let r = 1; r <= 11; r++) {
    const commitRes = artifactCommit({
      input: {
        session_id: sessionId,
        submission_id: subId(),
        expected_round: r,
        content: makeContent(r),
        change_note: `第${r}周の改訂を行い内容を向上させた。変更箇所の説明文である。`,
        ...(r > 1 ? { addresses: ['quality'] } : {}),
      },
      persistence,
    });

    const scoreA = Math.floor((r + 1) / 2);
    const scoreB = Math.floor(r / 2) + 1;
    const scoreRes = scoreSubmit({
      input: {
        session_id: sessionId,
        submission_id: subId(),
        expected_round: r,
        artifact_digest: commitRes.artifact.digest,
        scores: [
          {
            criterion_id: 'quality',
            score: scoreA,
            rationale: `第${r}周の評価結果として品質基準を${scoreA}点と判定したテスト用の十分な説明文であり40文字以上を満たす。`,
            weakness: '更なるブラッシュアップが必要である。',
            evidence: makeEvidence(r, 'quality'),
          },
          {
            criterion_id: 'clarity',
            score: scoreB,
            rationale: `第${r}周の評価結果として明快さ基準を${scoreB}点と判定したテスト用の十分な説明文であり40文字以上を満たす。`,
            weakness: '更なるブラッシュアップが必要である。',
            evidence: makeEvidence(r, 'clarity'),
          },
        ],
      },
      persistence,
    });

    assert.equal(scoreRes.verdict, 'ITERATING');
    assert.equal(scoreRes.round, r + 1);
  }

  // Step 1: round 12 の artifact_commit & score_submit -> max_rounds 到達により STALLED
  const commitRes12 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 12,
      content: makeContent(12),
      change_note: '第12周の改訂を行い内容を向上させた。変更箇所の説明文である。',
      addresses: ['quality'],
    },
    persistence,
  });

  const scoreRes12 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 12,
      artifact_digest: commitRes12.artifact.digest,
      scores: [
        {
          criterion_id: 'quality',
          score: 8,
          rationale: '第12周の評価結果として品質基準を8点と判定したテスト用の十分な説明文であり40文字以上を満たす。',
          weakness: '更なるブラッシュアップが必要である。',
          evidence: makeEvidence(12, 'quality'),
        },
        {
          criterion_id: 'clarity',
          score: 8,
          rationale: '第12周の評価結果として明快さ基準を8点と判定したテスト用の十分な説明文であり40文字以上を満たす。',
          weakness: '更なるブラッシュアップが必要である。',
          evidence: makeEvidence(12, 'clarity'),
        },
      ],
    },
    persistence,
  });

  assert.equal(scoreRes12.verdict, 'STALLED');
  assert.equal(scoreRes12.verdict_reason, 'max_rounds_reached');
  assert.equal(scoreRes12.state, 'STALLED');
  assert.equal(scoreRes12.next_action.tool, 'escalate');

  // Step 2: escalate(action: "abort") -> ABORTED (終端状態)
  const abortRes = escalate({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      action: 'abort',
      note: '要件自体を見直すためこれ以上のループを中断しセッションを中止することを正式に決定する。',
    },
    persistence,
  });

  assert.equal(abortRes.state, 'ABORTED');
  assert.equal(abortRes.next_action.tool, 'audit_export');

  // Step 3: ABORTED は終端であるため、以後の escalate は E_STATE_VIOLATION
  assert.throws(
    () =>
      escalate({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          action: 'request_human',
          note: '中断後に再度人間の判断を仰ごうとする不正なエスカレーションの試行であり拒否されるべきである。',
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_STATE_VIOLATION');
      return true;
    }
  );
});
