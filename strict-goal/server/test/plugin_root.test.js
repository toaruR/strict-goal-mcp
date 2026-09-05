import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePluginRoot } from '../src/paths/plugin_root.js';

test('RUBRIC_LOOP_ROOT を採用し source が PLUGIN_ROOT になる', () => {
  const result = resolvePluginRoot({ RUBRIC_LOOP_ROOT: '/a/root' }, '/x/server/main.js');
  assert.equal(result.root, '/a/root');
  assert.equal(result.source, 'PLUGIN_ROOT');
  assert.deepEqual(result.warnings, []);
});

test('RUBRIC_LOOP_ROOT と CLAUDE_PLUGIN_ROOT が異値のとき 1 を採用し root_conflict 警告が出る', () => {
  const result = resolvePluginRoot(
    { RUBRIC_LOOP_ROOT: '/a/root', CLAUDE_PLUGIN_ROOT: '/b/root' },
    '/x/server/main.js'
  );
  assert.equal(result.root, '/a/root');
  assert.equal(result.source, 'PLUGIN_ROOT');
  assert.ok(result.warnings.some((w) => w === 'root_conflict: RUBRIC_LOOP_ROOT=/a/root CLAUDE_PLUGIN_ROOT=/b/root using=/a/root'));
});

test('CLAUDE_PLUGIN_ROOT のみでも採用され source が PLUGIN_ROOT になる', () => {
  const result = resolvePluginRoot({ CLAUDE_PLUGIN_ROOT: '/b/root' }, '/x/server/main.js');
  assert.equal(result.root, '/b/root');
  assert.equal(result.source, 'PLUGIN_ROOT');
});

test('素の PLUGIN_ROOT も拾う', () => {
  const result = resolvePluginRoot({ PLUGIN_ROOT: '/c/root' }, '/x/server/main.js');
  assert.equal(result.root, '/c/root');
  assert.equal(result.source, 'PLUGIN_ROOT');
});

test('env が1つも無いとき main.js の親の親を root とし source が argv0 になる', () => {
  const result = resolvePluginRoot({}, '/pkg/server/main.js');
  assert.equal(result.root, path_normalize('/pkg'));
  assert.equal(result.source, 'argv0');
});

test('どれも解決できないとき root は null で warnings に root_unresolved が出る', () => {
  const result = resolvePluginRoot({}, undefined);
  assert.equal(result.root, null);
  assert.equal(result.source, 'unresolved');
  assert.ok(result.warnings.includes('root_unresolved'));
});

function path_normalize(p) {
  return p.replace(/\\/g, '/').replace(/\/$/, '');
}
