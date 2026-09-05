import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './atomic.js';
import { LOCK_STALE_MS as STALE_MS } from '../config/defaults.js';

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function isStale(existing, now, currentBootInfo) {
  const elapsed = now - existing.acquired_at;
  const sameOsBootId =
    existing.boot_id_source === 'os' &&
    currentBootInfo.boot_id_source === 'os' &&
    existing.boot_id === currentBootInfo.boot_id;

  if (sameOsBootId) {
    return !isProcessAlive(existing.pid) && elapsed >= STALE_MS;
  }
  return elapsed >= STALE_MS;
}

export function acquireLock(sessionDir, bootInfo, { pid = process.pid, now = Date.now() } = {}) {
  const lockPath = path.join(sessionDir, 'LOCK');
  const record = {
    pid,
    boot_id: bootInfo.boot_id,
    boot_id_source: bootInfo.boot_id_source,
    acquired_at: now,
  };
  const warnings = [];
  if (bootInfo.boot_id_source === 'instance') {
    warnings.push('lock_staleness_time_only');
  }

  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, JSON.stringify(record));
    fs.closeSync(fd);
    return { ok: true, warnings };
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }

  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    existing = null;
  }

  if (existing && !isStale(existing, now, bootInfo)) {
    const error = new Error('lock held by another process');
    error.code = 'E_CONCURRENT';
    throw error;
  }

  if (existing?.boot_id_source === 'instance' || (existing && bootInfo.boot_id_source === 'instance')) {
    warnings.push('lock_staleness_time_only');
  }

  writeAtomic(lockPath, JSON.stringify(record));
  return { ok: true, warnings, recovered: true };
}

export function releaseLock(sessionDir) {
  const lockPath = path.join(sessionDir, 'LOCK');
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}
