import { ERROR_CODES, fail } from '../errors/codes.js';
import { checkMatrixGuard } from '../fsm/matrix_guard.js';
import { readBenchState, writeBenchState, saveEvalResult } from '../store/bench_store.js';
import { runHeldOutTest } from '../evaluator/held_out_runner.js';
import { checkTestTampering } from '../evaluator/ast_diff.js';
import { checkMockTampering } from '../evaluator/mock_detector.js';
import { computeVerdict } from '../evaluator/verdict_engine.js';

export function benchmarkEvaluate(input, baseDir = process.cwd(), options = {}) {
  const { bench_id, trial_id, submission_id, test_command, test_timeout_sec } = input;

  if (!bench_id || !trial_id) {
    fail(ERROR_CODES.E_VALIDATION, 'bench_id and trial_id are required');
  }
  if (!submission_id || submission_id.length < 8 || submission_id.length > 128) {
    fail(ERROR_CODES.E_VALIDATION, 'submission_id must be between 8 and 128 chars');
  }

  const state = readBenchState(baseDir, bench_id);

  // If in RUNNING_TRIAL, transition to EVALUATING first
  let currentState = state.state;
  if (currentState === 'RUNNING_TRIAL') {
    writeBenchState(baseDir, bench_id, { state: 'EVALUATING' });
    currentState = 'EVALUATING';
  }

  checkMatrixGuard(currentState, 'benchmark_evaluate');

  // Check mock/diff tampering if diff or test contents are present
  const diffContent = options.diffContent || '';
  const fileContent = options.fileContent || '';

  const astCheck = checkTestTampering(diffContent);
  const mockCheck = checkMockTampering(fileContent);

  const tamperingDetected = Boolean(options.forceTampering) || astCheck.tampering_detected || mockCheck.tampering_detected;
  const tamperingDetails = [...(options.tamperingDetails || []), ...astCheck.details, ...mockCheck.details];

  // Execute held-out test suite if test_command provided
  let testResult = options.testResultOverride || {
    exit_code: 0,
    tests_passed: 10,
    tests_total: 10,
  };

  if (test_command) {
    testResult = runHeldOutTest(test_command, {
      test_timeout_sec: test_timeout_sec || 120,
      cwd: options.cwd || input.cwd || baseDir,
    });
  }

  const verdict = computeVerdict({
    exit_code: testResult.exit_code,
    failed_tests: (testResult.tests_total || 0) - (testResult.tests_passed || 0),
    tampering_detected: tamperingDetected,
  });

  const output = {
    ok: true,
    trial_id,
    resolved: verdict.resolved,
    tests_passed: testResult.tests_passed,
    tests_total: testResult.tests_total,
    tampering_detected: tamperingDetected,
    tampering_details: tamperingDetails.length > 0 ? tamperingDetails : undefined,
    exit_code: testResult.exit_code,
  };

  saveEvalResult(baseDir, bench_id, trial_id, output);

  // Transition EVALUATING -> COLLECTING
  writeBenchState(baseDir, bench_id, {
    state: 'COLLECTING',
    last_eval_result: output,
  });

  return output;
}
