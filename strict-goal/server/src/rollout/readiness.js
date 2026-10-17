import { evaluateReleaseGate } from '../metrics/round_reduction.js';

// This is a report only: it never changes the rollout flag or session policy.
export function buildReadiness({ tests, pairs } = {}) {
  const count = (n) => Number.isSafeInteger(n) && n >= 0;
  const fields = ['collected', 'selected', 'deselected', 'skipped', 'passed', 'failed'];
  const valid = tests && fields.every((key) => count(tests[key]))
    && tests.collected === tests.selected + tests.deselected
    && tests.selected === tests.passed + tests.failed + tests.skipped
    && (tests.deselected === 0 || tests.deselection_reason === 'approved_selection')
    && (tests.skipped === 0 || tests.skip_reason === 'environment_unavailable');
  const gate = evaluateReleaseGate(pairs);
  const testsPassed = Boolean(valid && tests.exit_code === 0 && tests.failed === 0
    && tests.skipped === 0 && tests.deselected === 0 && tests.selected > 0);
  return {
    status: testsPassed && gate.eligible ? 'ready' : 'hold',
    tests: valid ? {
      collected: tests.collected, selected: tests.selected, deselected: tests.deselected,
      skipped: tests.skipped, passed: tests.passed, failed: tests.failed,
      deselection_reason: tests.deselected ? 'approved_selection' : null,
      skip_reason: tests.skipped ? 'environment_unavailable' : null,
      result: testsPassed ? 'pass' : 'incomplete_or_failed',
    } : { result: 'unknown' },
    quality_gate: { result: gate.eligible ? 'pass' : 'hold', reasons: gate.reasons },
  };
}
