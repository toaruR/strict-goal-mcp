import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { resolvePluginData } from '../src/paths/plugin_data.js';

test('T003: PLUGIN_DATA resolution hierarchy and ephemeral fallback', () => {
  const tmpDir = path.join(os.tmpdir(), `rl-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const res1 = resolvePluginData({ RUBRIC_LOOP_DATA: tmpDir });
  assert.equal(res1.mode, 'persistent');
  assert.equal(path.normalize(res1.dir), path.normalize(tmpDir));

  // Conflict warning
  const res2 = resolvePluginData({
    RUBRIC_LOOP_DATA: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'other')
  });
  assert.ok(res2.warnings.some(w => w.startsWith('data_dir_conflict:')));

  // Ephemeral mode when no writable dir
  const res3 = resolvePluginData({
    RUBRIC_LOOP_DATA: 'Z:\\non_existent_drive_12345\\impossible',
    CLAUDE_PLUGIN_DATA: 'Z:\\non_existent_drive_12345\\impossible2',
    XDG_STATE_HOME: 'Z:\\non_existent_drive_12345\\impossible3',
    LOCALAPPDATA: 'Z:\\non_existent_drive_12345\\impossible4'
  }, 'Z:\\non_existent_drive_12345\\impossible_home');
  assert.equal(res3.mode, 'ephemeral');
  assert.ok(res3.warnings.includes('ephemeral'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
