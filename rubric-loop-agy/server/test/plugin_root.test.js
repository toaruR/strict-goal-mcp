import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolvePluginRoot } from '../src/paths/plugin_root.js';

test('T002: PLUGIN_ROOT resolution hierarchy', () => {
  // 1. RUBRIC_LOOP_ROOT
  const res1 = resolvePluginRoot({ RUBRIC_LOOP_ROOT: 'D:/tmp/root1' }, null);
  assert.equal(res1.source, 'PLUGIN_ROOT');
  assert.equal(path.normalize(res1.root), path.normalize('D:/tmp/root1'));

  // 2. Conflict between RUBRIC_LOOP_ROOT and CLAUDE_PLUGIN_ROOT
  const res2 = resolvePluginRoot({
    RUBRIC_LOOP_ROOT: 'D:/tmp/root1',
    CLAUDE_PLUGIN_ROOT: 'D:/tmp/root2'
  }, null);
  assert.equal(path.normalize(res2.root), path.normalize('D:/tmp/root1'));
  assert.ok(res2.warnings.some(w => w.startsWith('root_conflict:')));

  // 3. Fallback to argv1
  const fakeArgv1 = 'D:/test/rubric-loop-pkg/server/main.js';
  const res3 = resolvePluginRoot({}, fakeArgv1);
  assert.equal(res3.source, 'argv0');
  assert.equal(path.normalize(res3.root), path.normalize('D:/test/rubric-loop-pkg'));

  // 4. Unresolved
  const res4 = resolvePluginRoot({}, null);
  assert.ok(res4.warnings.includes('root_unresolved'));
});
