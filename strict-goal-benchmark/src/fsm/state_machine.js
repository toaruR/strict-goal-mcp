import { ERROR_CODES, fail } from '../errors/codes.js';

export const BENCHMARK_STATES = [
  'INIT',
  'PREPARING',
  'RUNNING_TRIAL',
  'EVALUATING',
  'COLLECTING',
  'COMPLETED',
  'FAILED',
  'ABORTED',
];

export const VALID_TRANSITIONS = {
  INIT: ['PREPARING', 'FAILED', 'ABORTED'],
  PREPARING: ['RUNNING_TRIAL', 'FAILED', 'ABORTED'],
  RUNNING_TRIAL: ['EVALUATING', 'FAILED', 'ABORTED'],
  EVALUATING: ['COLLECTING', 'FAILED', 'ABORTED'],
  COLLECTING: ['RUNNING_TRIAL', 'COMPLETED', 'FAILED', 'ABORTED'],
  COMPLETED: [],
  FAILED: [],
  ABORTED: [],
};

export class BenchmarkStateMachine {
  constructor(initialState = 'INIT') {
    if (!BENCHMARK_STATES.includes(initialState)) {
      fail(ERROR_CODES.E_STATE_INVALID, `Invalid initial state: ${initialState}`);
    }
    this.state = initialState;
  }

  canTransition(toState) {
    const allowed = VALID_TRANSITIONS[this.state] || [];
    return allowed.includes(toState);
  }

  transition(toState, reason = '') {
    if (!BENCHMARK_STATES.includes(toState)) {
      fail(ERROR_CODES.E_STATE_INVALID, `Target state does not exist: ${toState}`);
    }
    if (!this.canTransition(toState)) {
      fail(ERROR_CODES.E_STATE_INVALID, `Cannot transition from ${this.state} to ${toState}`, {
        from: this.state,
        to: toState,
        reason,
      });
    }
    this.state = toState;
    return this.state;
  }

  getState() {
    return this.state;
  }

  isTerminal() {
    return ['COMPLETED', 'FAILED', 'ABORTED'].includes(this.state);
  }
}
