import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { acquireLock, releaseLock, withLock, LockError } from '../src/store/lock.js';

test('T006: file lock acquisition, mutual exclusion and release', async () => {
  const tmpDir = path.join(os.tmpdir(), `rl-lock-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const sessionId = 'rl_testsession123';

  // 1. Normal acquire and release
  const res = acquireLock(tmpDir, sessionId);
  assert.equal(res.reclaimed, false);
  assert.ok(fs.existsSync(res.lockPath));

  // 2. Conflict throws E_CONCURRENT
  assert.throws(() => {
    acquireLock(tmpDir, sessionId);
  }, (err) => err instanceof LockError && err.code === 'E_CONCURRENT');

  // 3. Release
  releaseLock(res);
  assert.equal(fs.existsSync(res.lockPath), false);

  // 4. withLock
  let ran = false;
  await withLock(tmpDir, sessionId, async () => {
    ran = true;
    assert.throws(() => {
      acquireLock(tmpDir, sessionId);
    }, (err) => err instanceof LockError && err.code === 'E_CONCURRENT');
  });
  assert.equal(ran, true);

  // 5. Stale reclaim
  const lockFile = path.join(tmpDir, `${sessionId}.lock`);
  fs.writeFileSync(lockFile, 'old');
  // modify mtime to 100 seconds ago
  const oldTime = (Date.now() - 100 * 1000) / 1000;
  fs.utimesSync(lockFile, oldTime, oldTime);

  const resStale = acquireLock(tmpDir, sessionId, 50 * 1000);
  assert.equal(resStale.reclaimed, true);
  releaseLock(resStale);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
