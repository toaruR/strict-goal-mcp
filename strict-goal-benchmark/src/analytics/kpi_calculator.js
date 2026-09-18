export function calculateGroupMetrics(trials) {
  if (!trials || trials.length === 0) {
    return {
      resolved_rate: 0,
      shortcut_rate: 0,
      avg_tokens: 0,
      avg_prompt_tokens: 0,
      avg_cached_tokens: 0,
      avg_uncached_input_tokens: 0,
      avg_completion_tokens: 0,
      avg_cost_usd: 0,
      avg_rounds: 0,
      timeout_rate: 0,
      total_trials: 0,
    };
  }

  let resolvedCount = 0;
  let shortcutCount = 0;
  let timeoutCount = 0;
  let totalTokens = 0;
  let totalPromptTokens = 0;
  let totalCachedTokens = 0;
  let totalUncachedInputTokens = 0;
  let totalCompletionTokens = 0;
  let totalCost = 0;
  let totalRounds = 0;

  for (const trial of trials) {
    const isResolved = trial.ground_truth_eval?.resolved === true;
    const isTampered = trial.ground_truth_eval?.tampering_detected === true;

    if (isResolved) resolvedCount++;
    if (isTampered) shortcutCount++;
    if (trial.ground_truth_eval?.timed_out === true) timeoutCount++;

    const usage = trial.resource_usage || {};
    totalTokens += usage.total_tokens || 0;
    totalPromptTokens += usage.prompt_tokens || 0;
    totalCachedTokens += usage.cached_tokens || 0;
    totalUncachedInputTokens += usage.uncached_input_tokens ?? Math.max(0, (usage.prompt_tokens || 0) - (usage.cached_tokens || 0));
    totalCompletionTokens += usage.completion_tokens || 0;
    totalCost += trial.resource_usage?.estimated_cost_usd || 0;
    totalRounds += trial.resource_usage?.rounds ?? (trial.fsm_history?.length || 1);
  }

  const n = trials.length;
  return {
    resolved_rate: Math.round((resolvedCount / n) * 100) / 100,
    shortcut_rate: Math.round((shortcutCount / n) * 100) / 100,
    avg_tokens: Math.round(totalTokens / n),
    avg_prompt_tokens: Math.round(totalPromptTokens / n),
    avg_cached_tokens: Math.round(totalCachedTokens / n),
    avg_uncached_input_tokens: Math.round(totalUncachedInputTokens / n),
    avg_completion_tokens: Math.round(totalCompletionTokens / n),
    avg_cost_usd: Math.round((totalCost / n) * 1000) / 1000,
    avg_rounds: Math.round((totalRounds / n) * 10) / 10,
    timeout_rate: Math.round((timeoutCount / n) * 100) / 100,
    total_trials: n,
  };
}
