import { spawnSync } from 'node:child_process';
import { ERROR_CODES, fail } from '../errors/codes.js';

/**
 * Runs the held-out test suite in an isolated subprocess.
 */
export function runHeldOutTest(testCommand, options = {}) {
  const timeoutMs = (options.test_timeout_sec || 120) * 1000;
  const cwd = options.cwd || process.cwd();

  // Strip NODE_TEST_CONTEXT to prevent recursion false-positive skip in nested tests
  const cleanEnv = { ...process.env };
  delete cleanEnv.NODE_TEST_CONTEXT;

  let result;
  try {
    result = spawnSync(testCommand, {
      cwd,
      env: cleanEnv,
      timeout: timeoutMs,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      shell: true,
    });
  } catch (err) {
    if (err.code === 'ETIMEDOUT') {
      fail(ERROR_CODES.E_EVAL_TIMEOUT, `Held-out test execution timed out after ${timeoutMs / 1000}s`, {
        testCommand,
        timeout_sec: timeoutMs / 1000,
      });
    }
    throw err;
  }

  if (result.error && (result.error.code === 'ETIMEDOUT' || result.error.signal === 'SIGTERM')) {
    fail(ERROR_CODES.E_EVAL_TIMEOUT, `Held-out test execution timed out after ${timeoutMs / 1000}s`, {
      testCommand,
      timeout_sec: timeoutMs / 1000,
    });
  }

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const rawOutput = `${stdout}\n${stderr}`;
  const exitCode = result.status ?? 1;

  // Parse counts
  let tests_passed = 0;
  let tests_failed = 0;

  const lines = rawOutput.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('ℹ') || trimmed.startsWith('#')) continue;
    if (/(?:✔|ok|PASS)\s+/i.test(line)) tests_passed++;
    if (/(?:✖|not ok|FAIL)\s+/i.test(line)) tests_failed++;
  }

  // Fallback: If no test lines matched, deduce from exitCode
  if (tests_passed === 0 && tests_failed === 0) {
    if (exitCode === 0) {
      tests_passed = 1;
    } else {
      tests_failed = 1;
    }
  }

  const tests_total = tests_passed + tests_failed;

  return {
    exit_code: exitCode,
    stdout,
    stderr,
    tests_passed,
    tests_failed,
    tests_total,
  };
}
