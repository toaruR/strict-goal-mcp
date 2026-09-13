// §7.1 手順10〜12（集計・停滞カウンタ・判定）。F5/F8/F9 のごまかし検出（手順7〜9）は
// T036、rubric 版またぎの比較規則（§7.1.1）は T037、停滞・max_rounds 判定の内訳（§7.3）は
// T038 で別モジュールとして追加した（judge/stall.js）。

import { nextRoundsWithoutImprovement, decideStallVerdict } from './stall.js';

export { nextRoundsWithoutImprovement };

export function computeWeightedMean(scores, criteriaById) {
  let weightedSum = 0;
  let weightSum = 0;
  for (const score of scores) {
    const weight = criteriaById.get(score.criterion_id).weight;
    weightedSum += score.score * weight;
    weightSum += weight;
  }
  return weightedSum / weightSum;
}

export function computeMinScore(scores) {
  return Math.min(...scores.map((s) => s.score));
}

export function decideVerdict({ minScoreValue, weightedMeanValue, policy, session, roundsWithoutImprovement }) {
  const passed = minScoreValue >= policy.pass_score && weightedMeanValue >= policy.pass_weighted_mean;

  // 1. min_rounds ハードガード: 最低ラウンド数に達していない場合は FINAL を絶対に発行しない
  if (passed && policy.min_rounds && session.round < policy.min_rounds) {
    return {
      verdict: 'ITERATING',
      verdict_reason: 'min_rounds_not_reached',
      enforced_iteration: true,
    };
  }

  if (passed) {
    if (session.counters.relaxation_count > 0) {
      if (!session.counters.relaxation_approved) {
        return { verdict: 'ESCALATED', verdict_reason: 'relaxation_pending_approval' };
      }
      return { verdict: 'FINAL_WITH_RELAXATION', verdict_reason: 'all_criteria_passed' };
    }
    return { verdict: 'FINAL', verdict_reason: 'all_criteria_passed' };
  }

  const stall = decideStallVerdict({
    round: session.round,
    maxRounds: policy.max_rounds + (session.counters.extra_rounds_granted ?? 0),
    roundsWithoutImprovement,
    stallWindow: policy.stall_window,
  });
  if (stall) return stall;

  return {
    verdict: 'ITERATING',
    verdict_reason: minScoreValue < policy.pass_score ? 'below_pass_score' : 'below_weighted_mean',
  };
}
