import { ERROR_CODES, fail } from '../errors/codes.js';

/**
 * Checks whether a tool invocation is allowed given the current benchmark FSM state.
 * Throws appropriate error code from §4.2 matrix if forbidden.
 *
 * @param {string} state - Current benchmark state
 * @param {string} toolName - benchmark_run, benchmark_collect, benchmark_evaluate, benchmark_report
 * @param {object} [options] - Additional call metadata, e.g. { action: "status" }
 */
export function checkMatrixGuard(state, toolName, options = {}) {
  const action = options.action;

  switch (state) {
    case 'INIT': {
      if (toolName === 'benchmark_run') {
        if (action === 'start') return true;
        // status is also benign in INIT
        if (action === 'status') return true;
      }
      fail(ERROR_CODES.E_STATE_INVALID, `Tool ${toolName} is not permitted in INIT state`, { state, toolName });
      break;
    }

    case 'PREPARING': {
      fail(ERROR_CODES.E_STATE_BUSY, `Benchmark is currently preparing environment`, { state, toolName });
      break;
    }

    case 'RUNNING_TRIAL': {
      if (toolName === 'benchmark_run') {
        if (action === 'status' || action === 'abort') return true;
        fail(ERROR_CODES.E_STATE_BUSY, `Benchmark trial is currently running`, { state, toolName, action });
      }
      fail(ERROR_CODES.E_TRIAL_ACTIVE, `Trial is actively executing; tool ${toolName} is prohibited`, { state, toolName });
      break;
    }

    case 'EVALUATING': {
      if (toolName === 'benchmark_evaluate') return true;
      if (toolName === 'benchmark_collect') {
        fail(ERROR_CODES.E_EVAL_IN_PROGRESS, `Cannot collect while evaluation is in progress`, { state, toolName });
      }
      fail(ERROR_CODES.E_STATE_BUSY, `Benchmark is currently evaluating`, { state, toolName });
      break;
    }

    case 'COLLECTING': {
      if (toolName === 'benchmark_collect') return true;
      if (toolName === 'benchmark_evaluate') {
        fail(ERROR_CODES.E_ALREADY_EVALUATED, `Trial has already been evaluated`, { state, toolName });
      }
      fail(ERROR_CODES.E_STATE_BUSY, `Benchmark is currently collecting metrics`, { state, toolName });
      break;
    }

    case 'COMPLETED': {
      if (toolName === 'benchmark_report') return true;
      if (toolName === 'benchmark_collect') return true; // read-only allowed
      if (toolName === 'benchmark_run' && action === 'status') return true;
      fail(ERROR_CODES.E_ALREADY_COMPLETED, `Benchmark has already completed`, { state, toolName });
      break;
    }

    case 'FAILED': {
      if (toolName === 'benchmark_report') return true;
      if (toolName === 'benchmark_run' && action === 'status') return true;
      fail(ERROR_CODES.E_SESSION_FAILED, `Benchmark session failed`, { state, toolName });
      break;
    }

    case 'ABORTED': {
      if (toolName === 'benchmark_report') return true;
      if (toolName === 'benchmark_run' && action === 'status') return true;
      fail(ERROR_CODES.E_SESSION_ABORTED, `Benchmark session was aborted`, { state, toolName });
      break;
    }

    default:
      fail(ERROR_CODES.E_STATE_INVALID, `Unknown state: ${state}`, { state, toolName });
  }

  return true;
}
