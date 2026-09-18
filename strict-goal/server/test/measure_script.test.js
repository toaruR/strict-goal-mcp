import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function toBashPath(winPath) {
  return winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
}

test('measure-rubric-effect.sh --dry-run が終了コード0でヘッダ列数5を出力すること', () => {
  const result = spawnSync('bash', ['scripts/measure-rubric-effect.sh', '--dry-run'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  const cols = lines[0].split('\t');
  assert.equal(cols.length, 5);
  assert.equal(cols[0], 'group');
});

test('.benchmark が存在しない一時ディレクトリでも --dry-run が異常終了しないこと', () => {
  const tmpDir = process.env.TEMP || process.env.TMP || '/tmp';
  const scriptBashPath = toBashPath(path.join(repoRoot, 'scripts', 'measure-rubric-effect.sh'));
  const result = spawnSync('bash', [scriptBashPath, '--dry-run'], {
    cwd: tmpDir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  const cols = result.stdout.trim().split('\n')[0].split('\t');
  assert.equal(cols.length, 5);
});

test('実環境で実行時に各群の行が出力され、out_of_scope_sections が0以上の整数であること', () => {
  const result = spawnSync('bash', ['scripts/measure-rubric-effect.sh', '配布,CI'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  const lines = result.stdout.trim().split('\n');
  assert.ok(lines.length >= 2, 'header and at least one data line');
  const headerCols = lines[0].split('\t');
  assert.equal(headerCols.length, 5);

  const seenGroups = new Set();
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split('\t');
    assert.equal(row.length, 5);
    seenGroups.add(row[0]);
    const outOfScope = parseInt(row[3], 10);
    assert.ok(!Number.isNaN(outOfScope) && outOfScope >= 0);
  }
  assert.ok(seenGroups.size > 0);
});
