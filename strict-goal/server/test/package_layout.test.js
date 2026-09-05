import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..', '..');

function readJson(relPath) {
  return JSON.parse(readFileSync(path.join(packageRoot, relPath), 'utf8'));
}

test('plugin.json は正しいスキーマと名前を持つ', () => {
  const plugin = readJson('plugin.json');
  assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/v1.0.0/plugin.json');
  assert.equal(plugin.name, 'strict-goal');
});

test('plugin.json に資格情報キーが無い', () => {
  const plugin = readJson('plugin.json');
  const credentialPattern = /token|key|secret|password/i;
  const badKeys = Object.keys(plugin).filter((k) => credentialPattern.test(k));
  assert.deepEqual(badKeys, []);
});

test('server/package.json の type が module', () => {
  const pkg = readJson('server/package.json');
  assert.equal(pkg.type, 'module');
});

test('骨格ディレクトリが存在する', () => {
  assert.ok(existsSync(path.join(packageRoot, 'skills')), 'skills/ が必要');
  assert.ok(existsSync(path.join(packageRoot, 'server')), 'server/ が必要');
});

test('presets/ と server/ はコンポーネントとして plugin.json に列挙されない', () => {
  const plugin = readJson('plugin.json');
  const serialized = JSON.stringify(plugin);
  assert.ok(!serialized.includes('presets'));
  assert.ok(!serialized.includes('"server"'));
});
