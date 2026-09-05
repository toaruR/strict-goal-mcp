import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { writeAtomic, readJson, writeJson } from '../src/store/atomic.js';

test('T004: atomic write and read utilities', () => {
  const tmpDir = path.join(os.tmpdir(), `rl-atomic-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const targetFile = path.join(tmpDir, 'test.json');
  const payload = { hello: 'world', count: 42 };

  writeJson(targetFile, payload);
  const loaded = readJson(targetFile);
  assert.deepEqual(loaded, payload);

  // Check no leftover tmp files
  const files = fs.readdirSync(tmpDir);
  assert.equal(files.length, 1);
  assert.equal(files[0], 'test.json');

  // Overwrite atomically
  const payload2 = { hello: 'updated', count: 99 };
  writeJson(targetFile, payload2);
  const loaded2 = readJson(targetFile);
  assert.deepEqual(loaded2, payload2);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
