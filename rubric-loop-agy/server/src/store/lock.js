import fs from 'node:fs';
import path from 'node:path';

const LOCK_TTL_MS = 60 * 1000;

export class LockError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export function acquireLock(locksDir, sessionId, ttlMs = LOCK_TTL_MS) {
  if (!locksDir) return { lockPath: null, reclaimed: false };
  fs.mkdirSync(locksDir, { recursive: true });
  const lockPath = path.join(locksDir, `${sessionId}.lock`);

  const now = Date.now();
  let reclaimed = false;

  try {
    // wx: fail if exists
    const fd = fs.openSync(lockPath, 'wx');
    const data = JSON.stringify({ pid: process.pid, createdAt: now });
    fs.writeSync(fd, data);
    fs.closeSync(fd);
    return { lockPath, reclaimed };
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Check if stale
      try {
        const stat = fs.statSync(lockPath);
        if (now - stat.mtimeMs > ttlMs) {
          // Stale lock, attempt remove & reclaim
          try {
            fs.unlinkSync(lockPath);
            const fd = fs.openSync(lockPath, 'wx');
            const data = JSON.stringify({ pid: process.pid, createdAt: now, reclaimed: true });
            fs.writeSync(fd, data);
            fs.closeSync(fd);
            return { lockPath, reclaimed: true };
          } catch {
            throw new LockError('E_CONCURRENT', { reason: 'concurrent_lock_acquisition_conflict' });
          }
        }
      } catch (statErr) {
        if (statErr instanceof LockError) throw statErr;
      }
      throw new LockError('E_CONCURRENT', { reason: 'session_locked' });
    }
    throw err;
  }
}

export function releaseLock(lockResult) {
  if (!lockResult || !lockResult.lockPath) return;
  try {
    if (fs.existsSync(lockResult.lockPath)) {
      fs.unlinkSync(lockResult.lockPath);
    }
  } catch {
    // ignore
  }
}

export async function withLock(locksDir, sessionId, fn, ttlMs = LOCK_TTL_MS) {
  const lockResult = acquireLock(locksDir, sessionId, ttlMs);
  try {
    return await fn(lockResult);
  } finally {
    releaseLock(lockResult);
  }
}
