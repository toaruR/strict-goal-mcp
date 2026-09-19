import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VERSION, NAME } from '../src/version.js';
import { handleInitialize } from '../src/mcp/initialize.js';
import { handleDiscover } from '../src/mcp/discover.js';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';

test('VERSION と NAME が正しく定義されている', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const plugin = JSON.parse(readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
  assert.equal(pkg.version, plugin.version);
  assert.match(VERSION, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  assert.equal(NAME, 'strict-goal');
});

test('main.js --version でバージョンを出力して正常終了する', () => {
  const mainPath = path.resolve(import.meta.dirname, '../main.js');
  const result = spawnSync(process.execPath, [mainPath, '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), `${NAME} ${VERSION}`);
});

test('main.js -v でバージョンを出力して正常終了する', () => {
  const mainPath = path.resolve(import.meta.dirname, '../main.js');
  const result = spawnSync(process.execPath, [mainPath, '-v'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), `${NAME} ${VERSION}`);
});

test('helper.js version でバージョンを出力して正常終了する', () => {
  const helperPath = path.resolve(import.meta.dirname, '../helper.js');
  const result = spawnSync(process.execPath, [helperPath, 'version'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), `${NAME} ${VERSION}`);
});

test('helper.js --version でバージョンを出力して正常終了する', () => {
  const helperPath = path.resolve(import.meta.dirname, '../helper.js');
  const result = spawnSync(process.execPath, [helperPath, '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), `${NAME} ${VERSION}`);
});

test('helper.js -v でバージョンを出力して正常終了する', () => {
  const helperPath = path.resolve(import.meta.dirname, '../helper.js');
  const result = spawnSync(process.execPath, [helperPath, '-v'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), `${NAME} ${VERSION}`);
});

test('handleInitialize が version.js の VERSION を返す', () => {
  const res = handleInitialize();
  assert.equal(res.serverInfo.name, NAME);
  assert.equal(res.serverInfo.version, VERSION);
});

test('handleDiscover が version.js の VERSION を返す', () => {
  const res = handleDiscover();
  assert.equal(res.serverInfo.name, NAME);
  assert.equal(res.serverInfo.version, VERSION);
});

test('loopOpenCreate で作成された session.json に server.version が記録される', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'sg-ver-test-'));
  const pluginRoot = path.resolve(import.meta.dirname, '../..');

  const res = loopOpenCreate({
    input: {
      mode: 'create',
      loop_mode: 'design',
      submission_id: 'sub_test_version_001',
      task: 'タスク記述は20文字以上である必要がありますので長めに設定します。',
      rubric_preset: 'design',
    },
    pluginRoot,
    pluginRootSource: 'TEST',
    persistence: { dir: tmpDir, mode: 'persistent', source: 'test', warnings: [] },
  });

  assert.equal(res.ok, true);
  const sessionPath = path.join(tmpDir, 'sessions', res.session_id, 'session.json');
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
  assert.equal(session.server.version, VERSION);
});
