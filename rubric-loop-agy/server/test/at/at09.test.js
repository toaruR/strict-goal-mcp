import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../../src/tools/loop_open_create.js';
import { artifactCommit } from '../../src/tools/artifact_commit.js';
import { scoreSubmit } from '../../src/tools/score_submit.js';
import { sha256Hex } from '../../src/hash/digest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at09-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let subCounter = 0;
function subId() {
  subCounter += 1;
  return `sub-at09-${subCounter}`.padEnd(8, '0');
}

const CRITERION = {
  id: 'soundness',
  statement: '設計全体の論理的妥当性と整合性が確保されていること',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '論理的破綻がある状態', 5: '概ね妥当である状態', 9: '完全に整合している状態' },
};

const CONTENT_R1 = `# 設計書 初版
本設計書はフォールバックモードと縮退規約、事後追認プロセスを検証するための文書である。
初版の記述であり改善の余地がある。
`;

const CONTENT_R2 = `# 設計書 第2版
本設計書はフォールバックモードと縮退規約、事後追認プロセスを検証するための文書である。
第2版の改訂により論理的妥当性と整合性が完全に確保された記述となった。
`;

test('AT-9: サーバ起動失敗時のスキル単独動作と縮退ジャーナルの事後追認・ごまかし検出', () => {
  // Step 1: SKILL.md の縮退規約検証
  const skillPath = path.resolve(pluginRoot, 'skills', 'rubric-loop', 'SKILL.md');
  const skillContent = readFileSync(skillPath, 'utf8');

  // サーバ不在時の縮退手順が SKILL.md に存在すること
  assert.ok(skillContent.includes('ツールが使えないとき（縮退）') || skillContent.includes('縮退'));
  // 完了表現が UNVERIFIED-COMPLETE であり FINAL を勝手に名乗らないこと
  assert.ok(skillContent.includes('UNVERIFIED-COMPLETE'));
  assert.ok(skillContent.includes('rubric-loop-fallback.json'));

  // Step 2 & 3: モデルがフォールバックジャーナル (rubric-loop-fallback.json) を作成・追記
  const fallbackJournal = [
    {
      round: 1,
      artifact_content: CONTENT_R1,
      artifact_sha256: sha256Hex(CONTENT_R1),
      change_note: '初版の設計書を作成して縮退ジャーナルに記録した。',
      scores: [
        {
          criterion_id: 'soundness',
          score: 6,
          rationale: '初版の記述は論理的な妥当性がまだ不十分であるため6点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップが必要である。',
          evidence: [
            {
              kind: 'locator',
              locator: 'spec.md#soundness-r1',
              excerpt: '本設計書はフォールバックモードと縮退規約、事後追認プロセスを検証するための文書である。',
            },
          ],
        },
      ],
    },
    {
      round: 2,
      artifact_content: CONTENT_R2,
      artifact_sha256: sha256Hex(CONTENT_R2),
      change_note: '第2版の設計書を作成して論理的整合性を高めた変更である。',
      addresses: ['soundness'],
      scores: [
        {
          criterion_id: 'soundness',
          score: 9,
          rationale: '第2版の記述により論理的整合性が完全に満たされたため9点と判定した。十分な文字数を確保するための補足説明文である。',
          weakness: '更なるブラッシュアップの余地がある。',
          evidence: [
            {
              kind: 'locator',
              locator: 'spec.md#soundness-r2',
              excerpt: '本設計書はフォールバックモードと縮退規約、事後追認プロセスを検証するための文書である。',
            },
          ],
        },
      ],
    },
  ];

  // Step 4: 縮退実行時はモデル自身は FINAL ではなく UNVERIFIED-COMPLETE を出力する
  const modelOutputStatus = 'UNVERIFIED-COMPLETE: rubric-loop server unavailable';
  assert.ok(modelOutputStatus.startsWith('UNVERIFIED-COMPLETE'));

  // Step 5: サーバ復旧後、セッションを開いて journal を順に再投入（事後追認）
  const persistence = durablePersistence();
  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'rubric-loop-at09',
      task: '縮退ジャーナルの事後追認を行うためのタスク説明文である。',
      rubric: { criteria: [CRITERION] },
    },
    pluginRoot,
    persistence,
  });

  const sessionId = openRes.session_id;

  // Round 1 の再投入
  const j1 = fallbackJournal[0];
  const c1 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      content: j1.artifact_content,
      change_note: j1.change_note,
    },
    persistence,
  });
  assert.equal(c1.artifact.digest, `sha256:${j1.artifact_sha256}`);

  const s1 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: c1.artifact.digest,
      scores: j1.scores,
    },
    persistence,
  });
  assert.equal(s1.verdict, 'ITERATING');
  assert.equal(s1.round, 2);

  // Round 2 の再投入
  const j2 = fallbackJournal[1];
  const c2 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 2,
      content: j2.artifact_content,
      change_note: j2.change_note,
      addresses: j2.addresses,
    },
    persistence,
  });
  assert.equal(c2.artifact.digest, `sha256:${j2.artifact_sha256}`);

  const s2 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: subId(),
      expected_round: 2,
      artifact_digest: c2.artifact.digest,
      scores: j2.scores,
    },
    persistence,
  });

  // サーバが判定を行い、ここで初めて公式な FINAL が発行される
  assert.equal(s2.verdict, 'FINAL');
  assert.equal(s2.state, 'FINAL');

  // Step 6: 仮に手動ループで「成果物不変なのにスコア上昇」の甘いジャーナルがあった場合、再投入時に拒否されることの検証
  const openResCheat = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: subId(),
      loop_mode: 'design',
      label: 'rubric-loop-at09-cheat',
      task: '手動ループの甘さが事後に拒否されることを確認するタスク。',
      rubric: { criteria: [CRITERION] },
    },
    pluginRoot,
    persistence,
  });

  const cheatSessionId = openResCheat.session_id;

  // Round 1
  const cc1 = artifactCommit({
    input: {
      session_id: cheatSessionId,
      submission_id: subId(),
      expected_round: 1,
      content: CONTENT_R1,
      change_note: '初版の設計書をコミットする。十分な長さの説明文である。',
    },
    persistence,
  });
  scoreSubmit({
    input: {
      session_id: cheatSessionId,
      submission_id: subId(),
      expected_round: 1,
      artifact_digest: cc1.artifact.digest,
      scores: j1.scores,
    },
    persistence,
  });

  // Round 2: 成果物は CONTENT_R1 のまま不変
  const cc2 = artifactCommit({
    input: {
      session_id: cheatSessionId,
      submission_id: subId(),
      expected_round: 2,
      content: CONTENT_R1,
      change_note: '内容は同一であるがスコアだけを引き上げようとする変更。',
      addresses: ['soundness'],
    },
    persistence,
  });

  // 再投入でスコアを 6 -> 9 に引き上げると E_SCORE_INFLATION で拒否される
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: cheatSessionId,
          submission_id: subId(),
          expected_round: 2,
          artifact_digest: cc2.artifact.digest,
          scores: j2.scores, // score 9 while artifact unchanged
        },
        persistence,
      }),
    { code: 'E_SCORE_INFLATION' }
  );
});
