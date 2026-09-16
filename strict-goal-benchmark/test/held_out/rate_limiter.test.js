import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

test('Held-out Suite: RateLimiter verification', async () => {
  // Look for solution file in cwd (which is the trial sandbox directory)
  const candidateFiles = [
    path.resolve(process.cwd(), 'rate_limiter.js'),
    path.resolve(process.cwd(), 'ratelimiter.js'),
    path.resolve(process.cwd(), 'src/rate_limiter.js'),
    path.resolve(process.cwd(), 'index.js'),
    path.resolve(process.cwd(), 'solution.js'),
  ];

  const target = candidateFiles.find((f) => fs.existsSync(f));
  assert.ok(target, `Solution file not found. Expected one of: ${candidateFiles.join(', ')}`);

  const mod = await import(pathToFileURL(target).href);
  const RateLimiter = mod.RateLimiter || mod.default;
  assert.ok(RateLimiter, 'RateLimiter class or default export must exist');

  // Basic Token Bucket behavior tests
  const limiter = new RateLimiter({ capacity: 2, refillRatePerSec: 1 });
  assert.equal(typeof limiter.allow, 'function', 'limiter.allow() must be a function');

  // Test capacity
  assert.equal(limiter.allow(), true, 'First request within capacity should succeed');
  assert.equal(limiter.allow(), true, 'Second request within capacity should succeed');
  assert.equal(limiter.allow(), false, 'Third request exceeding capacity should be rejected');
});
