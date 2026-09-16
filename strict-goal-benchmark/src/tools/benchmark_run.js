import { ERROR_CODES, fail } from '../errors/codes.js';
import { checkMatrixGuard } from '../fsm/matrix_guard.js';
import { BenchmarkStateMachine } from '../fsm/state_machine.js';
import {
  initBenchStore,
  readBenchState,
  writeBenchState,
  readBenchConfig,
} from '../store/bench_store.js';
import { resumeBench } from '../runner/resume.js';
import { DEFAULTS } from '../config/defaults.js';

function generateBenchId() {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let str = '';
  for (let i = 0; i < 26; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return `bn_${str}`;
}

export function benchmarkRun(input, baseDir = process.cwd()) {
  const { action, submission_id } = input;
  if (!action || !['start', 'resume', 'status', 'abort'].includes(action)) {
    fail(ERROR_CODES.E_INVALID_ACTION, `Invalid or missing action: ${action}`, { action });
  }
  if (!submission_id || submission_id.length < 8 || submission_id.length > 128) {
    fail(ERROR_CODES.E_VALIDATION, `submission_id must be between 8 and 128 chars`, { submission_id });
  }

  if (action === 'start') {
    const benchId = input.bench_id || generateBenchId();
    const targetGroups = input.target_groups || [
      'vanilla',
      'prompt_rubric',
      'default_goal',
      'strict_single',
      'strict_hierarchical',
    ];
    const seeds = input.seeds || DEFAULTS.default_seeds;
    const taskSuite = input.task_suite || 'tdd_synthetic';
    const maxRounds = input.max_rounds_per_trial || DEFAULTS.max_rounds_per_trial;

    // Total trials = groups * seeds
    const totalTrials = targetGroups.length * seeds;

    const trialsList = [];
    for (const group of targetGroups) {
      for (let s = 1; s <= seeds; s++) {
        trialsList.push({
          trial_id: `tr_${generateBenchId().slice(3)}`,
          group,
          task_id: `${taskSuite}_task_${s.toString().padStart(3, '0')}`,
          seed: s,
        });
      }
    }

    const config = {
      bench_id: benchId,
      submission_id,
      target_groups: targetGroups,
      task_suite: taskSuite,
      seeds,
      max_rounds_per_trial: maxRounds,
      total_trials: totalTrials,
      trials: trialsList,
    };

    initBenchStore(baseDir, benchId, config);

    // Transition INIT -> PREPARING -> RUNNING_TRIAL
    const fsm = new BenchmarkStateMachine('INIT');
    checkMatrixGuard('INIT', 'benchmark_run', { action: 'start' });

    fsm.transition('PREPARING');
    writeBenchState(baseDir, benchId, { state: 'PREPARING' });

    fsm.transition('RUNNING_TRIAL');
    const firstTrial = trialsList[0] || null;
    const state = writeBenchState(baseDir, benchId, {
      state: 'RUNNING_TRIAL',
      current_trial: firstTrial,
      completed_trials: 0,
      total_trials: totalTrials,
    });

    return {
      ok: true,
      bench_id: benchId,
      state: state.state,
      total_trials: totalTrials,
      completed_trials: 0,
      current_trial: firstTrial,
    };
  }

  if (action === 'resume') {
    const benchId = input.bench_id;
    if (!benchId) {
      fail(ERROR_CODES.E_BENCH_NOT_FOUND, 'bench_id required for resume action');
    }
    const res = resumeBench(baseDir, benchId);
    const config = res.config;
    const currentTrial = config.trials?.[res.resume_from_trial] || null;

    return {
      ok: true,
      bench_id: benchId,
      state: res.state.state,
      total_trials: res.state.total_trials,
      completed_trials: res.state.completed_trials,
      current_trial: currentTrial,
    };
  }

  if (action === 'status') {
    const benchId = input.bench_id;
    if (!benchId) {
      fail(ERROR_CODES.E_BENCH_NOT_FOUND, 'bench_id required for status action');
    }
    const state = readBenchState(baseDir, benchId);
    return {
      ok: true,
      bench_id: benchId,
      state: state.state,
      total_trials: state.total_trials,
      completed_trials: state.completed_trials,
      current_trial: state.current_trial,
    };
  }

  if (action === 'abort') {
    const benchId = input.bench_id;
    if (!benchId) {
      fail(ERROR_CODES.E_BENCH_NOT_FOUND, 'bench_id required for abort action');
    }
    const state = readBenchState(baseDir, benchId);
    if (['COMPLETED', 'FAILED', 'ABORTED'].includes(state.state)) {
      fail(ERROR_CODES.E_ALREADY_COMPLETED, `Cannot abort terminal state: ${state.state}`);
    }
    const updated = writeBenchState(baseDir, benchId, { state: 'ABORTED' });
    return {
      ok: true,
      bench_id: benchId,
      state: updated.state,
      total_trials: updated.total_trials,
      completed_trials: updated.completed_trials,
      current_trial: updated.current_trial,
    };
  }
}
