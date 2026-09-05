import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { ensureStoreDirs, DIR_NAMES } from '../src/store/dirs.js';

test('T005: ensureStoreDirs creates all store subdirectories', () => {
  const tmpDir = path.join(os.tmpdir(), `rl-dirs-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const dirs = ensureStoreDirs(tmpDir);
  for (const name of DIR_NAMES) {
    assert.ok(fs.existsSync(dirs[name]), `Directory ${name} should exist`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
