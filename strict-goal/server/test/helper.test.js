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

test('helper.js verify-doc: 完全な文書に対して exit 0 と score: 9 を返す', () => {
  const docPath = path.resolve(__dirname, '..', '..', '..', 'docs', 'plans', 'design-anti-round1-final.md');
  const res = runHelper(['verify-doc', docPath]);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.score, 9);
});

test('helper.js verify-doc: 短いセクションやプレースホルダがある文書に対して exit 1 と score: 6 を返す', async () => {
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const tmpFile = path.resolve(__dirname, '..', '..', 'temp_invalid_doc.md');
  try {
    writeFileSync(tmpFile, '# タイトル\n## セクション1\n短すぎる\nTODO: 後で書く');
    const res = runHelper(['verify-doc', 'temp_invalid_doc.md']);
    assert.equal(res.status, 1);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.score, 6);
    assert.ok(parsed.weaknesses.length >= 1);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
});

test('helper.js design-check: 終了コード 0 のコマンドに対して exit 0 と design_check_evidence を出力する', () => {
  const res = runHelper(['design-check', 'node', '-e', '"process.exit(0)"']);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.design_check_evidence);
  assert.equal(parsed.design_check_evidence.kind, 'command');
  assert.equal(parsed.design_check_evidence.exit_code, 0);
  assert.match(parsed.design_check_evidence.output_sha256, /^[0-9a-f]{64}$/);
  assert.equal(parsed.design_check_evidence.target_digest, '<fill_with_committed_artifact_digest>');
});

test('helper.js design-check: 終了コード非0 のコマンドに対してその exit code をそのまま伝播する', () => {
  const res = runHelper(['design-check', 'node', '-e', '"process.exit(42)"']);
  assert.equal(res.status, 42);
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.design_check_evidence);
  assert.equal(parsed.design_check_evidence.kind, 'command');
  assert.equal(parsed.design_check_evidence.exit_code, 42);
});

test('helper.js design-check: 3000文字を超える出力に対して末尾3000文字にクリッピングする', () => {
  const res = runHelper(['design-check', 'node', '-e', '"console.log(\'a\'.repeat(5000))"']);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.design_check_evidence);
  assert.equal(parsed.design_check_evidence.output_excerpt.length, 3000);
});

test('helper.js design-draft / design-fix: 設定なしで exit 2 (NO_CONFIG) を返す', () => {
  const resDraft = runHelper(['design-draft', 'docs/test.md', 'test-task']);
  assert.equal(resDraft.status, 2);
  assert.match(resDraft.stderr, /NO_CONFIG/);

  const resFix = runHelper(['design-fix', 'docs/test.md', 'test-fix']);
  assert.equal(resFix.status, 2);
  assert.match(resFix.stderr, /NO_CONFIG/);
});

test('helper.js design-draft / design-fix: STRICT_GOAL_CONFIG 指定時にテンプレートを展開して実行する', async () => {
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const tmpConfig = path.resolve(__dirname, '..', '..', 'temp_strict_goal_config.json');
  try {
    writeFileSync(tmpConfig, JSON.stringify({
      design: {
        draft_command: 'node -e "process.stdout.write(\'DRAFT:\' + process.argv[1] + \':\' + process.argv[2])" {path} {prompt}',
        fix_command: 'node -e "process.stdout.write(\'FIX:\' + process.argv[1] + \':\' + process.argv[2])" {path} {must_fix}',
      }
    }));

    const env = { ...process.env, STRICT_GOAL_CONFIG: tmpConfig };
    const resDraft = spawnSync(process.execPath, [helperPath, 'design-draft', 'docs/design-foo.md', 'my-task'], {
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..', '..'),
      env,
    });
    assert.equal(resDraft.status, 0);
    assert.equal(resDraft.stdout, 'DRAFT:docs/design-foo.md:my-task');

    const resFix = spawnSync(process.execPath, [helperPath, 'design-fix', 'docs/design-foo.md', 'my-fix-instruction'], {
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..', '..'),
      env,
    });
    assert.equal(resFix.status, 0);
    assert.equal(resFix.stdout, 'FIX:docs/design-foo.md:my-fix-instruction');
  } finally {
    try { unlinkSync(tmpConfig); } catch {}
  }
});


