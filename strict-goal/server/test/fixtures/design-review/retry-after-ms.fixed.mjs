import assert from 'node:assert/strict';

// Sliding window parameters
const windowMs = 1000;
const limit = 10;

// Current state at time t = 800ms
const t = 800;
const previousCount = 0;
const currentCount = 10; // limit reached

// Fixed retryAfterMs: accounts for sliding window carryover into next window
function calculateRetryAfterFixed(t, windowMs, currentCount, limit, requested = 1) {
  const elapsedInWindow = t % windowMs;
  const timeToBoundary = windowMs - elapsedInWindow;
  // In the next window, the previous window count will be currentCount (10).
  // We need: currentCount * (1 - delta / windowMs) + requested <= limit
  // 1 - delta / windowMs <= (limit - requested) / currentCount
  // delta / windowMs >= 1 - (limit - requested) / currentCount
  const maxPrevWeight = (limit - requested) / currentCount;
  if (maxPrevWeight < 0) {
    return timeToBoundary + windowMs; // must wait out entire next window
  }
  const deltaNeeded = Math.ceil(windowMs * (1 - maxPrevWeight));
  return timeToBoundary + deltaNeeded;
}

const retryAfterMs = calculateRetryAfterFixed(t, windowMs, currentCount, limit, 1);
const newTime = t + retryAfterMs; // 800 + 200 + 100 = 1100ms

// At newTime:
const elapsedInNewWindow = newTime % windowMs; // 100ms
const weight = (windowMs - elapsedInNewWindow) / windowMs; // 900 / 1000 = 0.9
const estimatedCount = 10 * weight + 0; // 9.0

// Checking if 1 request is allowed:
const allowed = (estimatedCount + 1) <= limit;

assert.equal(allowed, true, 'Request must be allowed after fixed retryAfterMs');
