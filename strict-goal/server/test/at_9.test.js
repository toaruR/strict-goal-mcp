// AT-9: サーバ起動失敗時のスキル単独動作。docs/design-rubric-loop-mcp.md §13 AT-9。
// #1-4(スキルがツール不在を検知し会話内で縮退モードに入り、UNVERIFIED-COMPLETEを出す)は
// プラグイン/スキルのプロンプト運用であってサーバコードではないため、
// 本テストではコード検証可能な #5-6(サーバ復旧後の再投入で初めてFINALが出て、
// 縮退中の甘い採点はE_SCORE_INFLATION等で事後に拒否される)のみを対象にする。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-at9-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at9-${submissionCounter}`.padEnd(8, '0');
}

const CRITERION = {
  id: 'impl_works',
  statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
};

function createSession(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      label: 'strict-goal-at9',
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: { criteria: [CRITERION] },
    },
    persistence,
  });
}

// スキル縮退モードで手動収集したfallbackログを模した固定データ(rubric-loop-fallback.json相当)。
const FALLBACK_ROUNDS = [
  { round: 1, excerpt: '実装は一部だけ動作することを目視で確認したという記録がある。', score: 6 },
  { round: 2, excerpt: '実装は一部だけ動作することを目視で確認したという記録がある。', score: 9 }, // 縮退中モデルが甘く自己採点した周(同一根拠のまま9に飛ばす)
  { round: 3, excerpt: '実装は追加テストも通り完全に動作することを確認したという記録が新たに加わった。', score: 9 },
];

function content(excerpt, round) {
  return `# 設計書\n${excerpt}\n改訂 ${round} 回目の追記文です。`;
}

function commit(persistence, sessionId, expectedRound, excerpt, addresses) {
  return artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      content: content(excerpt, expectedRound),
      change_note: `第${expectedRound}版の改訂理由をここに20文字以上で説明する`,
      ...(addresses ? { addresses } : {}),
    },
    persistence,
  });
}

function score(persistence, sessionId, expectedRound, digest, value, excerpt) {
  return scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      artifact_digest: digest,
      scores: [
        {
          criterion_id: 'impl_works',
          score: value,
          rationale: 'a'.repeat(45),
          weakness: value === 10 ? 'none' : 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt }],
        },
      ],
    },
    persistence,
  });
}

test('AT-9: サーバ復旧後にfallbackログを再投入すると縮退中の甘い採点はE_SCORE_INFLATIONで拒否され、正しい周でのみFINALが出る', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  // round1: fallback通りに再投入 → ITERATING(FINALはまだ出ない)
  const round1 = FALLBACK_ROUNDS[0];
  const c1 = commit(persistence, created.session_id, 1, round1.excerpt);
  const r1 = score(persistence, created.session_id, 1, c1.artifact.digest, round1.score, round1.excerpt);
  assert.equal(r1.verdict, 'ITERATING');
  assert.equal(r1.round, 2);

  // round2: fallbackログどおり成果物を変えずにスコアだけ6→9に飛ばした縮退中の記録を再投入すると、
  // サーバの検査でE_SCORE_INFLATIONとして拒否される(縮退が検証の抜け穴にならない)。
  // commit自体は同一内容でも許可される(artifact.unchanged:trueの改訂)ため、まずそれで round2 のcommitを再現する。
  const round2 = FALLBACK_ROUNDS[1];
  const c2unchanged = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      content: content(round1.excerpt, 1),
      change_note: '第2版の改訂理由をここに20文字以上で説明する',
      addresses: ['impl_works'],
    },
    persistence,
  });
  assert.equal(c2unchanged.artifact.unchanged, true);
  assert.throws(
    () => score(persistence, created.session_id, 2, c2unchanged.artifact.digest, round2.score, '動作することを目視で確認したという記録がある'),
    (err) => {
      assert.equal(err.code, 'E_SCORE_INFLATION');
      return true;
    },
  );

  // 拒否された飛躍は取り下げ、同じ点数のまま再提出して周だけ進める(サーバが甘い自己採点を素通りさせない)。
  const r2safe = score(persistence, created.session_id, 2, c2unchanged.artifact.digest, round1.score, '動作することを目視で確認したという記録がある');
  assert.equal(r2safe.verdict, 'ITERATING');
  assert.equal(r2safe.round, 3);

  // round3: fallbackどおり新しい根拠を伴うcommitで正しく再投入 → ここで初めてサーバがFINALを出す
  const round3 = FALLBACK_ROUNDS[2];
  const c3 = commit(persistence, created.session_id, 3, round3.excerpt, ['impl_works']);
  const r3 = score(persistence, created.session_id, 3, c3.artifact.digest, round3.score, round3.excerpt);
  assert.equal(r3.verdict, 'FINAL');
  assert.equal(r3.state, 'FINAL');

  // FINAL到達後の追加commitはE_STATE_VIOLATION。「サーバが検査した最終周で初めてFINALが出る」ことの確認。
  assert.throws(
    () => commit(persistence, created.session_id, 4, round3.excerpt),
    { code: 'E_STATE_VIOLATION' },
  );
});
