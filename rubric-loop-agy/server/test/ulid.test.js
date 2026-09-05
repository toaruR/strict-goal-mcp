import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSessionId, generateChainId, isValidSessionId, isValidChainId } from '../src/id/ulid.js';

test('T007: ULID generation and format validation', () => {
  const sid = generateSessionId();
  assert.ok(isValidSessionId(sid), `Session ID ${sid} must be valid`);

  const cid = generateChainId();
  assert.ok(isValidChainId(cid), `Chain ID ${cid} must be valid`);

  assert.equal(isValidSessionId('invalid'), false);
  assert.equal(isValidSessionId('rl_01JQ8Z9K7M3N4P5R6S7T8V9WX'), false); // length 25
  assert.equal(isValidChainId('ch_invalid'), false);

  // Monotonic / Unique
  const sids = new Set();
  for (let i = 0; i < 100; i++) {
    const s = generateSessionId();
    assert.equal(sids.has(s), false);
    sids.add(s);
  }
});
