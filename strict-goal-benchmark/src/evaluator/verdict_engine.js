/**
 * Determines whether a trial task is Resolved based solely on objective external measurements (§7.1).
 * Model self-claims are completely ignored.
 *
 * @param {object} param0
 * @param {number} param0.exit_code - Subprocess exit code
 * @param {number} param0.failed_tests - Number of failed tests in held-out suite
 * @param {boolean} param0.tampering_detected - Whether AST / diff tampering was detected
 * @param {boolean} param0.timed_out - Whether the agent process hit the wall-clock timeout
 * @returns {object} { resolved: boolean, reason: string }
 */
export function computeVerdict({ exit_code = 1, failed_tests = 0, tampering_detected = false, timed_out = false }) {
  // タイムアウトした試行は、途中成果物が held-out を通っても未解決扱い（サーバ FINAL 未到達）
  if (timed_out) {
    return {
      resolved: false,
      reason: 'Agent process timed out before completing the task',
    };
  }

  if (tampering_detected) {
    return {
      resolved: false,
      reason: 'Tampering detected in test code or mock environment',
    };
  }

  if (exit_code !== 0) {
    return {
      resolved: false,
      reason: `Test execution failed with exit code ${exit_code}`,
    };
  }

  if (failed_tests > 0) {
    return {
      resolved: false,
      reason: `${failed_tests} tests failed in held-out suite`,
    };
  }

  return {
    resolved: true,
    reason: 'All held-out tests passed cleanly with no tampering detected',
  };
}
