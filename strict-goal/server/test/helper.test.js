import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.resolve(__dirname, '..', 'helper.js');

function runHelper(args) {
  return spawnSync(process.execPath, [helperPath, ...args], {
    encoding: 'utf8',
    cwd: path.resolve(__dirname, '..', '..'),
  });
}

test('helper.js digest: ファイルの sha256 を出力する', () => {
  const res = runHelper(['digest', 'plugin.json']);
  assert.equal(res.status, 0);
  assert.match(res.stdout.trim(), /^[0-9a-f]{64}$/);
});

test('helper.js fileset: files 配列とマニフェストダイジェストを出力する', () => {
  const res = runHelper(['fileset', 'presets']);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.ok(Array.isArray(parsed.files));
  assert.ok(parsed.files.length >= 3);
  assert.match(parsed.manifest_output_sha256, /^[0-9a-f]{64}$/);
  assert.match(parsed.manifest_command, /^node /);
});

test('helper.js test-run: test_inventory と command_evidence を出力する', () => {
  const res = runHelper(['test-run', 'node --version']);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.test_inventory);
  assert.equal(parsed.test_inventory.source_exit_code, 0);
  assert.match(parsed.test_inventory.source_output_sha256, /^[0-9a-f]{64}$/);
  assert.ok(parsed.test_inventory.counts.total >= 1);
  assert.equal(parsed.command_evidence.kind, 'command');
});
