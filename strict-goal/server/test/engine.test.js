import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideVerdict } from '../src/judge/engine.js';

test('session.round < policy.min_rounds かつスコア合格条件を満たす場合、verdict: "ITERATING", verdict_reason: "min_rounds_not_reached", enforced_iteration: true が返されること', () => {
  const res = decideVerdict({
    minScoreValue: 9,
    weightedMeanValue: 9.0,
    policy: {
      pass_score: 9,
      pass_weighted_mean: 9.0,
      min_rounds: 2,
      max_rounds: 12,
      stall_window: 3,
      stall_epsilon: 0.25,
    },
    session: {
      round: 1,
      counters: { relaxation_count: 0, relaxation_approved: false, extra_rounds_granted: 0 },
    },
    roundsWithoutImprovement: 0,
  });

  assert.equal(res.verdict, 'ITERATING');
  assert.equal(res.verdict_reason, 'min_rounds_not_reached');
  assert.equal(res.enforced_iteration, true);
});

test('session.round >= policy.min_rounds に達した時点で初めて合格判定時に FINAL が発行されること', () => {
  const res = decideVerdict({
    minScoreValue: 9,
    weightedMeanValue: 9.0,
    policy: {
      pass_score: 9,
      pass_weighted_mean: 9.0,
      min_rounds: 2,
      max_rounds: 12,
      stall_window: 3,
      stall_epsilon: 0.25,
    },
    session: {
      round: 2,
      counters: { relaxation_count: 0, relaxation_approved: false, extra_rounds_granted: 0 },
    },
    roundsWithoutImprovement: 0,
  });

  assert.equal(res.verdict, 'FINAL');
  assert.equal(res.verdict_reason, 'all_criteria_passed');
});
