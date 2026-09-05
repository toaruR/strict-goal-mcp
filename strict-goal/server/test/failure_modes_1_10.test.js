// T072: 失敗モード F1-F10（設計書 §2 の表）の対策が実際に効くことを検査する。
// F1 は設計書の返り値欄が E_EVIDENCE_REQUIRED / E_EVIDENCE_KIND の2件を挙げているが、
// T070 で確認済みのとおり evidence:[] は schemas/tools.json の minItems:1 により
// E_VALIDATION が先に飛び E_EVIDENCE_REQUIRED には実行が到達しない（CLAUDE.md ハマりポイント参照）。
// ここでは実際に到達する E_VALIDATION と E_EVIDENCE_KIND の2件を F1 の検査対象とする。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { rubricAmend } from '../src/tools/rubric_amend.js';
import { escalate } from '../src/tools/escalate.js';
import { decideStallVerdict } from '../src/judge/stall.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-fm110-'));
}
function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-fm110-${submissionCounter}`.padEnd(8, '0');
}

const CHANGE_NOTE = 'これは20文字以上ある変更理由の説明文です';
const NOTE = 'a'.repeat(45);

const CRITERION_A = {
  id: 'impl_works',
  statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
  weight: 2,
  verification: 'manual',
  anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
};
const CRITERION_B = {
  id: 'docs_clear',
  statement: '文書が第三者にも明快に伝わることの根拠が十分に示されている',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '不明瞭で読めない', 5: 'まあまあ読める', 9: '非常に明瞭' },
};
const AUTO_CRITERION = {
  id: 'tests_green',
  statement: 'テストが実際に通過していることの根拠が十分に示されている',
  weight: 1,
  verification: 'auto',
  anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
};

const CONTENT = '# 設計書\n実装は一部だけ動作することを目視で確認したという記録がある。';
const EXCERPT = '実装は一部だけ動作することを目視で確認したという記録がある。';
const CONTENT_R2 = `${CONTENT}\n実装は完全に動作することを実行ログで確認したという記録が新たにある。`;
const EXCERPT_R2 = '実装は完全に動作することを実行ログで確認したという記録が新たにある。';
const CONTENT_TWO = `${CONTENT}\n詳細な実行ログを見ても実装の一部動作が確認できたという記録がある。`;
const EXCERPT_TWO = '詳細な実行ログを見ても実装の一部動作が確認できたという記録がある。';

function createSession(persistence, rubric, policyOverrides = {}) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: { criteria: rubric, policy: policyOverrides },
    },
    persistence,
  });
}

function commit(persistence, sessionId, expectedRound, content = CONTENT, addresses) {
  return artifactCommit({
    input: { session_id: sessionId, submission_id: submissionId(), expected_round: expectedRound, content, change_note: CHANGE_NOTE, ...(addresses ? { addresses } : {}) },
    persistence,
  });
}

function score(persistence, sessionId, expectedRound, digest, scores) {
  return scoreSubmit({ input: { session_id: sessionId, submission_id: submissionId(), expected_round: expectedRound, artifact_digest: digest, scores }, persistence });
}

function locatorScore(criterionId, scoreValue, excerpt = EXCERPT, overrides = {}) {
  return { criterion_id: criterionId, score: scoreValue, rationale: 'a'.repeat(45), weakness: scoreValue === 10 ? 'none' : 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt }], ...overrides };
}

// F1: 自己採点の甘え — evidence を空にすると(minItems:1により)E_VALIDATION、
// auto 基準に locator 根拠を出すと E_EVIDENCE_KIND で拒否される。
test('F1: evidence 必須と auto 基準の kind 制限が効く', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, [CRITERION_A]);
  const committed = commit(persistence, created.session_id, 1);
  assert.throws(
    () => scoreSubmit({ input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: committed.artifact.digest, scores: [{ criterion_id: 'impl_works', score: 9, rationale: 'a'.repeat(45), weakness: 'none', evidence: [] }] } , persistence }),
    { code: 'E_VALIDATION' },
  );

  const autoCreated = createSession(persistence, [AUTO_CRITERION]);
  const autoCommitted = commit(persistence, autoCreated.session_id, 1);
  assert.throws(
    () => score(persistence, autoCreated.session_id, 1, autoCommitted.artifact.digest, [locatorScore('tests_green', 9)]),
    { code: 'E_EVIDENCE_KIND' },
  );
});

// F2: 周回中にループを忘れる — 応答は必ず next_action を持ち、順序違反は状態機械が構造的に弾く。
test('F2: next_action が常に埋め込まれ、順序違反は E_STATE_VIOLATION(expected_tools付き) になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, [CRITERION_A]);
  assert.ok(created.next_action?.tool);

  try {
    scoreSubmit({ input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: `sha256:${'a'.repeat(64)}`, scores: [locatorScore('impl_works', 9)] }, persistence });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 'E_STATE_VIOLATION');
    assert.ok(err.detail.expected_tools.includes('artifact_commit'));
  }

  const committed = commit(persistence, created.session_id, 1);
  assert.ok(committed.next_action?.tool);
});

// F3: コンテキスト圧縮で rubric ごと消える — loop_state / ITERATING 応答が rubric とアンカーを再供給する。
test('F3: loop_state と ITERATING 応答が rubric 全文とアンカーを再供給する', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, [CRITERION_A, CRITERION_B]);
  const committed = commit(persistence, created.session_id, 1);
  const result = score(persistence, created.session_id, 1, committed.artifact.digest, [locatorScore('impl_works', 5), locatorScore('docs_clear', 9)]);
  assert.equal(result.verdict, 'ITERATING');
  assert.ok(result.must_fix.length > 0);
  assert.equal(result.must_fix[0].anchor_9, '完全に動作する');

  const state = loopState({ input: { session_id: created.session_id, include: ['rubric'] }, persistence });
  assert.equal(state.rubric.criteria.length, 2);
  assert.equal(state.rubric.criteria[0].anchors['9'], '完全に動作する');
});

// F4: 基準を後から緩める — 緩和方向の変更は relaxation として記録され、
// 人間の承認(escalate resolve)なしには FINAL に到達できない。
test('F4: 緩和は relaxation として記録され FINAL_WITH_RELAXATION 経由でしか収束しない', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, [CRITERION_A, CRITERION_B]);
  const committed1 = commit(persistence, created.session_id, 1);
  const r1 = score(persistence, created.session_id, 1, committed1.artifact.digest, [locatorScore('impl_works', 6), locatorScore('docs_clear', 6)]);
  assert.equal(r1.verdict, 'ITERATING');

  const amended = rubricAmend({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 2, criteria: [{ ...CRITERION_A, weight: 1 }, CRITERION_B], reason: 'a'.repeat(45), acknowledge_relaxation: true },
    persistence,
  });
  assert.equal(amended.classification, 'relaxation');
  assert.equal(amended.final_reachable, false);

  const committed2 = commit(persistence, created.session_id, 2, CONTENT_R2, ['impl_works', 'docs_clear']);
  const r2 = score(persistence, created.session_id, 2, committed2.artifact.digest, [locatorScore('impl_works', 9, EXCERPT_R2), locatorScore('docs_clear', 9, EXCERPT_R2)]);
  assert.equal(r2.verdict, 'ESCALATED');
  assert.equal(r2.verdict_reason, 'relaxation_pending_approval');
});

// F5: 成果物が変わってないのにスコアだけ上がる — digest 不変での上昇提出は E_SCORE_INFLATION。
test('F5: digest 不変のままスコアを上げると E_SCORE_INFLATION になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, [CRITERION_A]);
  const committed1 = commit(persistence, created.session_id, 1, CONTENT_TWO);
  score(persistence, created.session_id, 1, committed1.artifact.digest, [locatorScore('impl_works', 5)]);
  const committed2 = commit(persistence, created.session_id, 2, CONTENT_TWO, ['impl_works']);
  assert.equal(committed2.artifact.unchanged, true);
  assert.throws(
    () => score(persistence, created.session_id, 2, committed2.artifact.digest, [locatorScore('impl_works', 6, EXCERPT_TWO)]),
    { code: 'E_SCORE_INFLATION' },
  );
});

// F6: 早期 FINAL 宣言 — 閾値未満なら自己申告に関わらず ITERATING が強制される。
test('F6: 閾値未満の申告でも verdict は ITERATING に強制される', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, [CRITERION_A]);
  const committed = commit(persistence, created.session_id, 1);
  const result = score(persistence, created.session_id, 1, committed.artifact.digest, [locatorScore('impl_works', 8)]);
  assert.equal(result.verdict, 'ITERATING');
  assert.notEqual(result.verdict, 'FINAL');
});

// F7: 無限ループ — max_rounds 到達と停滞検知(改善なし連続)の2系統で STALLED になる。
test('F7: max_rounds 到達と改善なし連続の2系統で STALLED になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, [CRITERION_A], { max_rounds: 2 });
  const committed1 = commit(persistence, created.session_id, 1);
  const r1 = score(persistence, created.session_id, 1, committed1.artifact.digest, [locatorScore('impl_works', 5)]);
  assert.equal(r1.verdict, 'ITERATING');
  const committed2 = commit(persistence, created.session_id, 2, CONTENT_R2, ['impl_works']);
  const r2 = score(persistence, created.session_id, 2, committed2.artifact.digest, [locatorScore('impl_works', 5)]);
  assert.equal(r2.verdict, 'STALLED');
  assert.equal(r2.verdict_reason, 'max_rounds_reached');

  // 停滞検知(no_improvement)側は decideStallVerdict の判定単位で確認する（max_rounds を
  // 上回らない設定での再現は stall.test.js が既に統合レベルで検証済み）。
  const stalled = decideStallVerdict({ round: 3, maxRounds: 50, roundsWithoutImprovement: 3, stallWindow: 3 });
  assert.equal(stalled.verdict, 'STALLED');
  assert.equal(stalled.verdict_reason, 'no_improvement');
});

// F8: 根拠の使い回し — スコアが上昇した基準で前周と同一 evidence_digest は E_EVIDENCE_STALE。
test('F8: 前周と同一の根拠でスコアを上げると E_EVIDENCE_STALE になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, [CRITERION_A]);
  const committed1 = commit(persistence, created.session_id, 1);
  score(persistence, created.session_id, 1, committed1.artifact.digest, [locatorScore('impl_works', 5)]);
  const content2 = `${CONTENT}\n追加の一文がここに入る。`;
  const c2 = commit(persistence, created.session_id, 2, content2, ['impl_works']);
  assert.throws(
    () => score(persistence, created.session_id, 2, c2.artifact.digest, [locatorScore('impl_works', 6)]),
    { code: 'E_EVIDENCE_STALE' },
  );
});

// F9: 一気に9点へジャンプ — max_score_jump 超過は command 根拠2件以上が無ければ E_SCORE_JUMP。
test('F9: 大きな加点は command 根拠2件が無ければ E_SCORE_JUMP になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, [CRITERION_A]);
  const committed1 = commit(persistence, created.session_id, 1);
  score(persistence, created.session_id, 1, committed1.artifact.digest, [locatorScore('impl_works', 3)]);
  const c2 = commit(persistence, created.session_id, 2, CONTENT_R2, ['impl_works']);
  assert.throws(
    () => score(persistence, created.session_id, 2, c2.artifact.digest, [locatorScore('impl_works', 9, EXCERPT_R2)]),
    { code: 'E_SCORE_JUMP' },
  );

  const commandEvidence = (n) => Array.from({ length: n }, (_, i) => ({ kind: 'command', command: `npm test -- --n=${i}`, exit_code: 0, output_excerpt: 'ok', output_sha256: 'a'.repeat(64) }));
  const resolved = score(persistence, created.session_id, 2, c2.artifact.digest, [locatorScore('impl_works', 9, EXCERPT_R2, { evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_R2 }, ...commandEvidence(2)] })]);
  assert.equal(resolved.verdict, 'FINAL');
});

// F10: 成果物の差し替えごまかし — artifact_commit→score_submit の順序強制と digest 不一致検出。
test('F10: 順序強制(E_STATE_VIOLATION)と digest 不一致(E_DIGEST_MISMATCH)の両方が効く', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, [CRITERION_A]);
  assert.throws(
    () => score(persistence, created.session_id, 1, `sha256:${'a'.repeat(64)}`, [locatorScore('impl_works', 9)]),
    { code: 'E_STATE_VIOLATION' },
  );
  commit(persistence, created.session_id, 1);
  assert.throws(
    () => score(persistence, created.session_id, 1, `sha256:${'0'.repeat(64)}`, [locatorScore('impl_works', 9)]),
    { code: 'E_DIGEST_MISMATCH' },
  );
});
