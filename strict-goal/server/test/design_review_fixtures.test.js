import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const helperPath = path.resolve(__dirname, '..', 'helper.js');

function runDesignCheck(fixtureRelPath) {
  const fixtureAbsPath = path.resolve(__dirname, fixtureRelPath);
  const cmd = `node "${fixtureAbsPath}"`;
  return spawnSync(process.execPath, [helperPath, 'design-check', cmd], {
    encoding: 'utf8',
    cwd: repoRoot,
    ...(process.platform === 'win32' ? { windowsVerbatimArguments: true } : {}),
  });
}

test('欠陥1回帰フィクスチャ: retry-after-ms.defective.mjs は design-check 経由で exit 非0 になる', () => {
  const res = runDesignCheck('fixtures/design-review/retry-after-ms.defective.mjs');
  assert.notEqual(res.status, 0, 'defective fixture must exit with non-zero code');
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.design_check_evidence);
  assert.notEqual(parsed.design_check_evidence.exit_code, 0);
  assert.match(parsed.design_check_evidence.output_excerpt, /AssertionError/);
});

test('欠陥1修正版フィクスチャ: retry-after-ms.fixed.mjs は design-check 経由で exit 0 になる', () => {
  const res = runDesignCheck('fixtures/design-review/retry-after-ms.fixed.mjs');
  assert.equal(res.status, 0, 'fixed fixture must exit with code 0');
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.design_check_evidence);
  assert.equal(parsed.design_check_evidence.exit_code, 0);
});
