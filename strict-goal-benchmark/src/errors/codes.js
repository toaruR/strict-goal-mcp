export const ERROR_CODES = {
  E_INVALID_ACTION: 'E_INVALID_ACTION',
  E_BENCH_NOT_FOUND: 'E_BENCH_NOT_FOUND',
  E_TRIAL_NOT_FOUND: 'E_TRIAL_NOT_FOUND',
  E_STATE_INVALID: 'E_STATE_INVALID',
  E_STATE_BUSY: 'E_STATE_BUSY',
  E_TRIAL_ACTIVE: 'E_TRIAL_ACTIVE',
  E_EVAL_IN_PROGRESS: 'E_EVAL_IN_PROGRESS',
  E_ALREADY_EVALUATED: 'E_ALREADY_EVALUATED',
  E_ALREADY_COMPLETED: 'E_ALREADY_COMPLETED',
  E_SESSION_FAILED: 'E_SESSION_FAILED',
  E_SESSION_ABORTED: 'E_SESSION_ABORTED',
  E_EVAL_TIMEOUT: 'E_EVAL_TIMEOUT',
  E_AST_TAMPERING: 'E_AST_TAMPERING',
  E_VALIDATION: 'E_VALIDATION',
};

export function createError(code, message, detail = {}) {
  const err = new Error(message || code);
  err.code = code;
  err.detail = detail;
  return err;
}

export function fail(code, message, detail = {}) {
  throw createError(code, message, detail);
}
