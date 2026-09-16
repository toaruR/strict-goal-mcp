export function calculateGroupMetrics(trials) {
  if (!trials || trials.length === 0) {
    return {
      resolved_rate: 0,
      shortcut_rate: 0,
      avg_tokens: 0,
      avg_cost_usd: 0,
      avg_rounds: 0,
      total_trials: 0,
    };
  }

  let resolvedCount = 0;
  let shortcutCount = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let totalRounds = 0;

  for (const trial of trials) {
    const isResolved = trial.ground_truth_eval?.resolved === true;
    const isTampered = trial.ground_truth_eval?.tampering_detected === true;

    if (isResolved) resolvedCount++;
    if (isTampered) shortcutCount++;

    totalTokens += trial.resource_usage?.total_tokens || 0;
    totalCost += trial.resource_usage?.estimated_cost_usd || 0;
    totalRounds += trial.resource_usage?.rounds ?? (trial.fsm_history?.length || 1);
  }

  const n = trials.length;
  return {
    resolved_rate: Math.round((resolvedCount / n) * 100) / 100,
    shortcut_rate: Math.round((shortcutCount / n) * 100) / 100,
    avg_tokens: Math.round(totalTokens / n),
    avg_cost_usd: Math.round((totalCost / n) * 1000) / 1000,
    avg_rounds: Math.round((totalRounds / n) * 10) / 10,
    total_trials: n,
  };
}
