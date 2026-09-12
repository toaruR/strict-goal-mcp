import test from 'node:test';
import assert from 'node:assert';
import { extractFailures, sanitizeStackTrace, executeAndSanitize } from '../src/implement/sanitize_test.js';

test('sanitize_test: cleans stack trace and extracts failure correctly', () => {
  const dummyOutput = `
✔ should pass (1.2ms)
✖ should fail with assertion (5.4ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 1
  - 2
      at TestContext.<anonymous> (test/example.test.js:10:12)
      at node:internal/test_runner/test:540:25
      at async Test.run (node:internal/test_runner/test:576:9)
`;

  const failures = extractFailures(dummyOutput);
  assert.strictEqual(failures.length, 1);
  assert.strictEqual(failures[0].test_name, 'should fail with assertion (5.4ms)');
  assert.match(failures[0].assertion_error, /AssertionError/);
  assert.strictEqual(failures[0].assertion_error.includes('node:internal'), false);

  const res = executeAndSanitize({ combined: dummyOutput, exitCode: 1 });
  assert.strictEqual(res.exit_code, 1);
  assert.strictEqual(res.failures.length, 1);
  assert.match(res.summary, /1 test\(s\) failed/);
  assert.ok(res.log_path);
});

test('sanitize_test: truncates very long error to SANITIZE_MAX_ERROR_CHARS', () => {
  const longText = 'A'.repeat(1000);
  const sanitized = sanitizeStackTrace(longText, 500);
  assert.strictEqual(sanitized.length, 500 + '... (truncated)'.length);
});
