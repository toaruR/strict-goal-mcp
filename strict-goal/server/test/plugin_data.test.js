import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
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
