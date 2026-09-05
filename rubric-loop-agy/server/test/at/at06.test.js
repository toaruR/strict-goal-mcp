import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../../src/tools/loop_open_create.js';
import { loopOpenResume } from '../../src/tools/loop_open_resume.js';
import { loopState } from '../../src/tools/loop_state.js';
import { artifactCommit } from '../../src/tools/artifact_commit.js';
import { scoreSubmit } from '../../src/tools/score_submit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at06-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir, source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at06-${subCounter}`.padEnd(8, '0');
}

const CRITERION_A = {
  id: 'self_hosting',
  statement: 'セルフホスティングの記録が十分に文書化されていること',
  weight: 2,
  verification: 'manual',
  anchors: {
    1: 'セルフホスティングの記録が全く存在しない状態である。',
    5: '一部の周回についてのみ記録が存在する状態である。',
    9: '全周回について完全なトレースログが存在する状態である。',
  },
};

function makeContent(r) {
  return `# 設計書 第${r}版
本設計書は rubric-loop MCP サーバのセッション再開と冪等性を検証するための文書である。
第${r}周のセルフホスティング記録として収束プロセスを完全に記載している。
`;
}

function makeEvidence(r) {
  return [
    {
      kind: 'locator',
      locator: `spec.md#self_hosting-r${r}`,
      excerpt: `本設計書は rubric-loop MCP サーバのセッション再開と冪等性を検証するための文書である。`,
    },
  ];
}

test('AT-6: セッション再開シナリオ（ホスト再起動後のresume、loop_state、冪等性再送、E_RUBRIC_ON_RESUME、E_CONCURRENT、E_HANDLE_NOT_ACCEPTED）', () => {
  const dataDir = tmpDataDir();
  const persistence1 = durablePersistence(dataDir);

  // 1. 初期セッション作成
  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'rubric-loop-design',
      task: 'セッション再開と冪等性をテストするためのタスク説明文である。',
      rubric: {
        criteria: [CRITERION_A],
      },
    },
    pluginRoot,
    persistence: persistence1,
  });

  const sessionId = openRes.session_id;

  // round 1〜4 を実行して round 5 の DRAFTING 状態まで進める
  for (let r = 1; r <= 4; r++) {
    const c = artifactCommit({
      input: {
        session_id: sessionId,
        submission_id: subId(),
        expected_round: r,
        content: makeContent(r),
        change_note: `第${r}周のコミットを行い内容を更新した。十分な長さの説明文である。`,
        ...(r > 1 ? { addresses: ['self_hosting'] } : {}),
      },
      persistence: persistence1,
    });

    const s = scoreSubmit({
      input: {
        session_id: sessionId,
        submission_id: subId(),
        expected_round: r,
        artifact_digest: c.artifact.digest,
        scores: [
          {
            criterion_id: 'self_hosting',
            score: r + 2,
            rationale: `第${r}周の採点結果として${r + 2}点を付与した十分な長さの説明文であり40文字以上を満たす。`,
            weakness: 'トレースログが3周分しかないため更なる記録の蓄積を要する。',
            evidence: makeEvidence(r),
          },
        ],
      },
      persistence: persistence1,
    });
    assert.equal(s.round, r + 1);
  }

  // ここで round 5 の DRAFTING 状態に到達。
  // サーバプロセスが落ちて再起動した状態をシミュレート（新しい persistence インスタンス、メモリ上モデルコンテキスト空）
  const persistence2 = durablePersistence(dataDir);

  // Step 1: loop_open(mode: "resume", session_id: S) -> rubric, must_fix, state復元
  const resumeRes = loopOpenResume({
    input: {
      mode: 'resume',
      session_id: sessionId,
      submission_id: subId(),
    },
    persistence: persistence2,
  });

  assert.equal(resumeRes.ok, true);
  assert.equal(resumeRes.resumed, true);
  assert.equal(resumeRes.state, 'DRAFTING');
  assert.equal(resumeRes.round, 5);
  assert.equal(resumeRes.rubric_version, 1);
  assert.deepEqual(resumeRes.rubric.criteria[0].anchors, CRITERION_A.anchors);
  assert.equal(resumeRes.next_action.tool, 'artifact_commit');

  // label でも引けることを確認
  const resumeByLabelRes = loopOpenResume({
    input: {
      mode: 'resume',
      label: 'rubric-loop-design',
      submission_id: subId(),
    },
    persistence: persistence2,
  });
  assert.equal(resumeByLabelRes.session_id, sessionId);

  // Step 2: loop_state(S, include: ["rubric", "must_fix", "last_scores", "artifact_head"])
  const stateRes = loopState({
    input: {
      session_id: sessionId,
      include: ['rubric', 'must_fix', 'last_scores', 'artifact_head'],
      artifact_head_bytes: 2000,
    },
    persistence: persistence2,
  });

  assert.equal(stateRes.must_fix[0].criterion_id, 'self_hosting');
  assert.equal(stateRes.must_fix[0].score, 6);
  assert.ok(stateRes.current_artifact.digest);
  assert.ok(stateRes.current_artifact.head.includes('設計書 第4版'));

  // Step 3: loop_open(mode: "resume", rubric: {...}) -> E_RUBRIC_ON_RESUME
  assert.throws(
    () =>
      loopOpenResume({
        input: {
          mode: 'resume',
          session_id: sessionId,
          submission_id: subId(),
          rubric: { criteria: [CRITERION_A] },
        },
        persistence: persistence2,
      }),
    { code: 'E_RUBRIC_ON_RESUME' }
  );

  // Step 4: artifact_commit(S, expected_round: 4) (古い周番号) -> E_CONCURRENT
  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: sessionId,
          submission_id: subId(),
          expected_round: 4,
          content: makeContent(5),
          change_note: '古い周番号でのコミットを試行して拒否されることを確認する。',
          addresses: ['self_hosting'],
        },
        persistence: persistence2,
      }),
    (err) => {
      assert.equal(err.code, 'E_CONCURRENT');
      assert.equal(err.detail.server_round, 5);
      return true;
    }
  );

  // Step 5: artifact_commit(S, submission_id: "a5-00001", expected_round: 5) -> ok: true, state: SCORING
  const subCommitId = 'a5-00001000';
  const commitRes5 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subCommitId,
      expected_round: 5,
      content: makeContent(5),
      change_note: '第5周の正規のコミットを提出してSCORING状態へ遷移させる。',
      addresses: ['self_hosting'],
    },
    persistence: persistence2,
  });

  assert.equal(commitRes5.ok, true);
  assert.equal(commitRes5.state, 'SCORING');

  // Step 6: 同一 submission_id の再送 -> 冪等性により全く同じ応答が返り二重登録なし
  const commitRes5Retry = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subCommitId,
      expected_round: 5,
      content: makeContent(5),
      change_note: '第5周の正規のコミットを提出してSCORING状態へ遷移させる。',
      addresses: ['self_hosting'],
    },
    persistence: persistence2,
  });

  assert.equal(commitRes5Retry.ok, true);
  assert.equal(commitRes5Retry.state, 'SCORING');
  assert.equal(commitRes5Retry.artifact.digest, commitRes5.artifact.digest);

  // Step 7: score_submit(S, submission_id: "s5-00001") -> 応答未達時の再送でも同一verdict, roundは1つしか進まない
  const subScoreId = 's5-00001000';
  const scoreInput = {
    session_id: sessionId,
    submission_id: subScoreId,
    expected_round: 5,
    artifact_digest: commitRes5.artifact.digest,
    scores: [
      {
        criterion_id: 'self_hosting',
        score: 7,
        rationale: '第5周の採点結果として7点を付与した十分な長さの説明文であり40文字以上を満たす。',
        weakness: '更なるブラッシュアップが必要である。',
        evidence: makeEvidence(5),
      },
    ],
  };

  const scoreRes5 = scoreSubmit({ input: scoreInput, persistence: persistence2 });
  assert.equal(scoreRes5.verdict, 'ITERATING');
  assert.equal(scoreRes5.round, 6);

  // 再送
  const scoreRes5Retry = scoreSubmit({ input: scoreInput, persistence: persistence2 });
  assert.equal(scoreRes5Retry.verdict, 'ITERATING');
  assert.equal(scoreRes5Retry.round, 6); // roundが進みすぎていないことの確認

  // Step 8: loop_open(mode: "create", session_id: S) -> E_HANDLE_NOT_ACCEPTED
  assert.throws(
    () =>
      loopOpenCreate({
        input: {
          mode: 'create',
          session_id: sessionId,
          submission_id: subId(),
          task: 'ハンドルを指定して作成を試行する不正なリクエストの説明文。',
          rubric: { criteria: [CRITERION_A] },
        },
        pluginRoot,
        persistence: persistence2,
      }),
    { code: 'E_HANDLE_NOT_ACCEPTED' }
  );
});
