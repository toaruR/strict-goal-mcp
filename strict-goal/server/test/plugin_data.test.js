import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePluginData, enforceEphemeralPolicy } from '../src/paths/plugin_data.js';

function tmpBase() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-test-'));
}

test('STRICT_GOAL_DATA と CLAUDE_PLUGIN_DATA が異値のとき 1 を採用し data_dir_conflict 警告が出る', () => {
  const a = tmpBase();
  const b = tmpBase();
  const result = resolvePluginData({ STRICT_GOAL_DATA: a, CLAUDE_PLUGIN_DATA: b });
  assert.equal(result.root, a);
  assert.equal(result.mode, 'persistent');
  assert.ok(result.warnings.some((w) => w.startsWith('data_dir_conflict:')));
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
});

test('書き込み可能な候補が1つも無いとき mode が ephemeral になる', () => {
  const result = resolvePluginData({});
  assert.equal(result.mode, 'ephemeral');
  assert.equal(result.dir, null);
});

test('mode が ephemeral のとき allow_ephemeral 未指定は E_NO_PERSISTENCE を投げる', () => {
  assert.throws(
    () => enforceEphemeralPolicy('ephemeral', undefined),
    (err) => err.code === 'E_NO_PERSISTENCE'
  );
});

test('mode が ephemeral かつ allow_ephemeral:true は成功し warnings に ephemeral が含まれる', () => {
  const result = enforceEphemeralPolicy('ephemeral', true);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.includes('ephemeral'));
});

test('persistent モードでは enforceEphemeralPolicy が警告なしで成功する', () => {
  const result = enforceEphemeralPolicy('persistent', undefined);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
});

test('解決したディレクトリ配下に strict-goal/ が作られ、以後のパスがその下に閉じる', () => {
  const a = tmpBase();
  const result = resolvePluginData({ STRICT_GOAL_DATA: a });
  assert.equal(result.dir, path.join(a, 'strict-goal'));
  assert.ok(existsSync(result.dir));
  rmSync(a, { recursive: true, force: true });
});

test('STRICT_GOAL_DATA でも下位互換で strict-goal/ が作られる', () => {
  const a = tmpBase();
  const result = resolvePluginData({ STRICT_GOAL_DATA: a });
  assert.equal(result.dir, path.join(a, 'strict-goal'));
  assert.ok(existsSync(result.dir));
  rmSync(a, { recursive: true, force: true });
});

test('環境変数未指定で cwd が git リポジトリ配下のとき <repo>/.strict-goal を直下に使う', () => {
  const repo = tmpBase();
  mkdirSync(path.join(repo, '.git'));
  const nestedCwd = path.join(repo, 'sub', 'dir');
  mkdirSync(nestedCwd, { recursive: true });

  const result = resolvePluginData({}, process.platform, nestedCwd);
  assert.equal(result.source, 'PROJECT_ROOT');
  assert.equal(result.dir, path.join(repo, '.strict-goal'));
  assert.ok(existsSync(result.dir));
  rmSync(repo, { recursive: true, force: true });
});

test('STRICT_GOAL_DATA が指定されていれば cwd の git 検出より優先される', () => {
  const explicit = tmpBase();
  const repo = tmpBase();
  mkdirSync(path.join(repo, '.git'));

  const result = resolvePluginData({ STRICT_GOAL_DATA: explicit }, process.platform, repo);
  assert.equal(result.source, 'STRICT_GOAL_DATA');
  assert.equal(result.dir, path.join(explicit, 'strict-goal'));
  rmSync(explicit, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

test('cwd が git リポジトリ配下でなければ従来通り ephemeral にフォールバックする', () => {
  const notARepo = tmpBase();
  const result = resolvePluginData({}, process.platform, notARepo);
  assert.equal(result.mode, 'ephemeral');
  assert.equal(result.dir, null);
  rmSync(notARepo, { recursive: true, force: true });
});
