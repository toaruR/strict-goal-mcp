import { readBenchConfig, readBenchState, writeBenchState } from '../store/bench_store.js';
import { ERROR_CODES, fail } from '../errors/codes.js';

/**
 * Resumes an interrupted benchmark session in 0 turns.
 *
 * @param {string} baseDir - Base workspace directory
 * @param {string} benchId - Benchmark session ID (bn_...)
 * @returns {object} Resume plan containing config, current state, and next trial index
 */
export function resumeBench(baseDir, benchId) {
  const config = readBenchConfig(baseDir, benchId);
  const state = readBenchState(baseDir, benchId);

  if (state.state === 'COMPLETED') {
    fail(ERROR_CODES.E_ALREADY_COMPLETED, `Benchmark ${benchId} is already completed`, { benchId });
  }
  if (state.state === 'FAILED') {
    fail(ERROR_CODES.E_SESSION_FAILED, `Benchmark ${benchId} has failed`, { benchId });
  }
  if (state.state === 'ABORTED') {
    fail(ERROR_CODES.E_SESSION_ABORTED, `Benchmark ${benchId} was aborted`, { benchId });
  }

  // Determine which trial to resume from
  const nextTrialIndex = state.completed_trials;
  const updatedState = writeBenchState(baseDir, benchId, {
    state: 'RUNNING_TRIAL',
    resumed_at: new Date().toISOString(),
  });

  return {
    ok: true,
    bench_id: benchId,
    config,
    state: updatedState,
    resume_from_trial: nextTrialIndex,
  };
}
