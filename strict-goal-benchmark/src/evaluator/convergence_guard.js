import {
  MAX_ROUNDS_PER_TRIAL,
  WALL_CLOCK_TIMEOUT_SEC,
  STALL_WINDOW,
  STALL_EPSILON,
  MAX_TOKENS_PER_TRIAL,
} from '../config/defaults.js';

export function checkConvergence({
  round = 1,
  max_rounds = MAX_ROUNDS_PER_TRIAL,
  elapsed_sec = 0,
  timeout_sec = WALL_CLOCK_TIMEOUT_SEC,
  total_tokens = 0,
  max_tokens = MAX_TOKENS_PER_TRIAL,
  recent_scores = [], // array of average/weighted_mean scores from recent rounds
  stall_window = STALL_WINDOW,
  stall_epsilon = STALL_EPSILON,
  resolved = false,
  final_verdict = 'ITERATING',
}) {
  if (resolved && final_verdict === 'FINAL') {
    return { should_stop: true, status: 'COMPLETED', reason: 'Success: reached FINAL with Resolved = true' };
  }

  if (round >= max_rounds) {
    return { should_stop: true, status: 'TIMEOUT', reason: `Exceeded maximum rounds per trial (${max_rounds})` };
  }

  if (elapsed_sec >= timeout_sec) {
    return { should_stop: true, status: 'TIMEOUT', reason: `Exceeded wall-clock timeout (${timeout_sec}s)` };
  }

  if (total_tokens >= max_tokens) {
    return { should_stop: true, status: 'TIMEOUT', reason: `Exceeded maximum tokens per trial (${max_tokens})` };
  }

  // Check score stagnation
  if (recent_scores.length >= stall_window) {
    const windowScores = recent_scores.slice(-stall_window);
    const minScore = Math.min(...windowScores);
    const maxScore = Math.max(...windowScores);
    const delta = maxScore - minScore;
    if (delta <= stall_epsilon) {
      return {
        should_stop: true,
        status: 'STALLED',
        reason: `Score stagnated: delta ${delta.toFixed(2)} <= epsilon ${stall_epsilon} across last ${stall_window} rounds`,
      };
    }
  }

  return { should_stop: false, status: 'RUNNING', reason: 'Trial within normal operating bounds' };
}
