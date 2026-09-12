import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureLogsDir, saveSessionLog, rotateSessionLogs, listSessionLogs, readSessionLog } from '../src/store/log_store.js';

test('log_store: logs directory creation and log rotation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log_store_test_'));
  const sessionId = 'rl_test_log_store_01';

  const dir = ensureLogsDir(tmpDir, sessionId);
  assert.strictEqual(fs.existsSync(dir), true);

  // Save 7 log files
  for (let i = 1; i <= 7; i++) {
    saveSessionLog(tmpDir, sessionId, `test_r${i}.log`, `Log content ${i}\n`);
  }

  // Check rotation: default maxKeep is 5
  const logs = listSessionLogs(tmpDir, sessionId);
  assert.strictEqual(logs.length, 5);

  const content = readSessionLog(tmpDir, sessionId, 'test_r7.log');
  assert.strictEqual(content, 'Log content 7\n');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
