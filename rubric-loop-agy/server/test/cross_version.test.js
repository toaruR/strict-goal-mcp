import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffRubric } from '../src/rubric/diff.js';
import {
  resolvePreviousScore,
  shouldResetStallCounter,
  recomputeBaselineWeightedMean,
  buildCrossVersionContext,
} from '../src/judge/cross_version.js';
import { checkScoreInflation, checkScoreJump, checkEvidenceStale } from '../src/judge/anti_gaming.js';

function criterion(id, overrides = {}) {
  return {
    id,
    statement: `${id} の基準文で20文字以上になるように書いた文章`,
    weight: 1,
    verification: 'manual',
    anchors: { 1: '全く満たさない', 5: '半分程度満たす', 9: '完全に満たす' },
    ...overrides,
  };
}

function policy() {
  return { pass_score: 9, pass_weighted_mean: 9.0, max_rounds: 12, stall_window: 3, stall_epsilon: 0.25, max_score_jump: 3 };
}

test('アンカーが stricter に変わった基準は previous_score を保持し warning:stricter_anchor_score_up を出す', () => {
  const prevRubric = { criteria: [criterion('a'), criterion('b'), criterion('c')], policy: policy() };
  const nextRubric = {
    criteria: [
      criterion('a', { anchors: { 1: '全く満たさない', 5: '半分程度満たす', 9: '完全に満たす、かつ自動テストで示す' } }),
      criterion('b'),
      criterion('d'),
    ],
    policy: policy(),
  };
  const { diff } = diffRubric(prevRubric, nextRubric);
  assert.deepEqual(diff.added, ['d']);
  assert.deepEqual(diff.removed, ['c']);

  const resolvedA = resolvePreviousScore('a', { criterion_id: 'a', score: 9 }, diff.anchor_changes);
  assert.equal(resolvedA.previousScore, 9);
  assert.equal(resolvedA.exemptInflation, true);
  assert.equal(resolvedA.warning, 'stricter_anchor_score_up');

  const resolvedB = resolvePreviousScore('b', { criterion_id: 'b', score: 5 }, diff.anchor_changes);
  assert.equal(resolvedB.exemptInflation, false);
  assert.equal(resolvedB.warning, null);

  // a のスコアが 9→10 に上がっても、exempt な基準を除外して渡せば E_SCORE_INFLATION にならない。
  const perCriterion = [
    { criterion_id: 'a', previous_score: 9, score: 10 },
    { criterion_id: 'b', previous_score: 5, score: 5 },
  ];
  const nonExempt = perCriterion.filter((c) => c.criterion_id !== 'a');
  assert.doesNotThrow(() => checkScoreInflation(nonExempt, true));
  // 除外せずに渡すと通常どおり検出されることの対比確認。
  assert.throws(() => checkScoreInflation(perCriterion, true), { code: 'E_SCORE_INFLATION' });
});

test('追加された新基準は previous_score が null になり インフレ/ジャンプ/使い回し検査がスキップされる', () => {
  const prevRubric = { criteria: [criterion('a')], policy: policy() };
  const nextRubric = { criteria: [criterion('a'), criterion('d')], policy: policy() };
  const { diff } = diffRubric(prevRubric, nextRubric);

  const resolvedD = resolvePreviousScore('d', undefined, diff.anchor_changes);
  assert.equal(resolvedD.previousScore, null);
  assert.equal(resolvedD.isNew, true);

  assert.doesNotThrow(() => checkScoreJump('d', 10, resolvedD.previousScore, [], 3));
  assert.doesNotThrow(() => checkEvidenceStale('d', 10, resolvedD.previousScore, ['sha256:aaa'], undefined));
});

test('基準を追加した周では停滞カウンタが0にリセットされる', () => {
  const prevRubric = { criteria: [criterion('a'), criterion('b')], policy: policy() };
  const nextRubricWithAddition = { criteria: [criterion('a'), criterion('b'), criterion('d')], policy: policy() };
  const nextRubricNoAddition = { criteria: [criterion('a'), criterion('b')], policy: policy() };

  const withAddition = diffRubric(prevRubric, nextRubricWithAddition);
  const noAddition = diffRubric(prevRubric, nextRubricNoAddition);

  assert.equal(shouldResetStallCounter(withAddition.diff), true);
  assert.equal(shouldResetStallCounter(noAddition.diff), false);
});

test('基準を削除したとき、比較対象の weighted_mean が新しい基準集合で再計算される', () => {
  const prevRubric = { criteria: [criterion('a'), criterion('b'), criterion('c')], policy: policy() };
  const nextRubric = { criteria: [criterion('a'), criterion('b')], policy: policy() };
  const { diff } = diffRubric(prevRubric, nextRubric);
  assert.deepEqual(diff.removed, ['c']);

  const previousScores = [
    { criterion_id: 'a', score: 9 },
    { criterion_id: 'b', score: 5 },
    { criterion_id: 'c', score: 2 },
  ];
  const criteriaById = new Map(nextRubric.criteria.map((c) => [c.id, c]));

  const recomputed = recomputeBaselineWeightedMean(previousScores, criteriaById, diff.removed);
  assert.equal(recomputed, 7); // (9+5)/2、c を除外した値
  const naive = (9 + 5 + 2) / 3;
  assert.notEqual(recomputed, naive);
});

test('低い点の基準を削除しても improvement が生まれない', () => {
  const prevRubric = { criteria: [criterion('a'), criterion('b'), criterion('c')], policy: policy() };
  const nextRubric = { criteria: [criterion('a'), criterion('b')], policy: policy() };
  const { diff } = diffRubric(prevRubric, nextRubric);

  const previousEvaluation = {
    weighted_mean: (9 + 9 + 2) / 3,
    scores: [
      { criterion_id: 'a', score: 9 },
      { criterion_id: 'b', score: 9 },
      { criterion_id: 'c', score: 2 },
    ],
  };
  const criteriaById = new Map(nextRubric.criteria.map((c) => [c.id, c]));

  // 削除後の周でも a, b が同じ点のままなら、素朴に前周の weighted_mean と比べると
  // 見かけ上の改善が出てしまうが、再計算したベースラインと比べれば改善は0になる。
  const currentWeightedMean = (9 + 9) / 2;
  const naiveImprovement = currentWeightedMean - previousEvaluation.weighted_mean;
  assert.ok(naiveImprovement > 0);

  const baseline = recomputeBaselineWeightedMean(previousEvaluation.scores, criteriaById, diff.removed);
  const realImprovement = currentWeightedMean - baseline;
  assert.equal(realImprovement, 0);
});

test('buildCrossVersionContext が per-criterion 解決・warnings・停滞リセット・ベースラインをまとめて返す', () => {
  const prevRubric = { criteria: [criterion('a'), criterion('b'), criterion('c')], policy: policy() };
  const nextRubric = {
    criteria: [
      criterion('a', { anchors: { 1: '全く満たさない', 5: '半分程度満たす', 9: '完全に満たす、かつ自動テストで示す' } }),
      criterion('b'),
      criterion('d'),
    ],
    policy: policy(),
  };
  const diffResult = diffRubric(prevRubric, nextRubric);
  const previousEvaluation = {
    weighted_mean: (9 + 5 + 2) / 3,
    scores: [
      { criterion_id: 'a', score: 9 },
      { criterion_id: 'b', score: 5 },
      { criterion_id: 'c', score: 2 },
    ],
  };
  const criteriaById = new Map(nextRubric.criteria.map((c) => [c.id, c]));

  const ctx = buildCrossVersionContext({ diffResult, previousEvaluation, criteriaById });
  assert.equal(ctx.perCriterion.get('a').exemptInflation, true);
  assert.equal(ctx.perCriterion.get('b').exemptInflation, false);
  assert.equal(ctx.perCriterion.get('d').previousScore, null);
  assert.deepEqual(ctx.warnings, ['stricter_anchor_score_up']);
  assert.equal(ctx.resetStallCounter, true);
  assert.equal(ctx.baselineWeightedMean, 7); // c を除外した (9+5)/2
});
