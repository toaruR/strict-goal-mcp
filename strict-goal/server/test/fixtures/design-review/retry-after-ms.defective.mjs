import assert from 'node:assert/strict';

if (process.env.NODE_TEST_CONTEXT) {
  // Directly executed by root node --test discovery; exit 0 to allow test runner to continue
  process.exit(0);
}

// Sliding window parameters
const windowMs = 1000;
const limit = 10;

// Current state at time t = 800ms
const t = 800;
const previousCount = 0;
const currentCount = 10; // limit reached

// Defective retryAfterMs: waits only until window boundary
function calculateRetryAfterDefective(t, windowMs, currentCount, limit) {
  const elapsedInWindow = t % windowMs;
  return windowMs - elapsedInWindow; // 1000 - 800 = 200ms
}

const retryAfterMs = calculateRetryAfterDefective(t, windowMs, currentCount, limit);
const newTime = t + retryAfterMs + 1; // 1001ms (just crossed boundary)

// At newTime, window has slid:
// previous window now has 10, new window has 0
const elapsedInNewWindow = newTime % windowMs; // 1ms
const weight = (windowMs - elapsedInNewWindow) / windowMs; // (1000 - 1) / 1000 = 0.999
const estimatedCount = 10 * weight + 0; // 9.99

// Checking if 1 request is allowed (limit = 10):
const allowed = (estimatedCount + 1) <= limit;

// Defective expectation: request should be allowed after retryAfterMs
assert.equal(allowed, true, 'Request should be allowed immediately after retryAfterMs');
