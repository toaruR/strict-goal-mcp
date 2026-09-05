import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAssertMutation, honestLimitWarnings } from '../src/implement/assert_mutation.js';

function fileEntry(overrides = {}) {
  return { path: 'test/a.test.js', sha256: 'a'.repeat(64), bytes: 10, role: 'test', ...overrides };
}

test('前周と sha256 が異なるテストファイルに差分が添付されていないとき E_TEST_MUTATED_WITHOUT_DIFF になる', () => {
  const prev = [fileEntry()];
  const now = [fileEntry({ sha256: 'b'.repeat(64) })];
  assert.throws(
    () => checkAssertMutation(prev, now, { diffs: [] }),
    (err) => err.code === 'E_TEST_MUTATED_WITHOUT_DIFF' && err.detail.files.includes('test/a.test.js'),
  );
});

test('差分が添付されていれば受理され、差分が test_inventory に残る', () => {
  const prev = [fileEntry()];
  const now = [fileEntry({ sha256: 'b'.repeat(64) })];
  const testInventory = {
    diffs: [{ file: 'test/a.test.js', before_sha256: 'a'.repeat(64), after_sha256: 'b'.repeat(64), reason: 'アサートを追加した' }],
  };
  assert.doesNotThrow(() => checkAssertMutation(prev, now, testInventory));
  assert.equal(testInventory.diffs[0].file, 'test/a.test.js');
});

test('テストファイル以外の変更は差分添付を要求しない', () => {
  const prev = [fileEntry({ path: 'src/a.js', role: 'source' })];
  const now = [fileEntry({ path: 'src/a.js', role: 'source', sha256: 'c'.repeat(64) })];
  assert.doesNotThrow(() => checkAssertMutation(prev, now, { diffs: [] }));
});

test('新規追加のテストファイル（前周に無い path）は改変扱いにならない', () => {
  const prev = [];
  const now = [fileEntry({ path: 'test/new.test.js' })];
  assert.doesNotThrow(() => checkAssertMutation(prev, now, { diffs: [] }));
});

test('sha256 が変わっていないテストファイルは差分添付を要求しない', () => {
  const prev = [fileEntry()];
  const now = [fileEntry()];
  assert.doesNotThrow(() => checkAssertMutation(prev, now, { diffs: [] }));
});

test('19.8.4 の検出不能な手口が honest_limits として列挙される', () => {
  const warnings = honestLimitWarnings();
  assert.equal(warnings.length, 4);
  assert.ok(warnings.includes('honest_limits:hash_authenticity_unverifiable'));
  assert.ok(warnings.includes('honest_limits:command_execution_unverifiable'));
  assert.ok(warnings.includes('honest_limits:genuine_pass_then_weaken_undetectable'));
  assert.ok(warnings.includes('honest_limits:semantic_assertion_weakening_undetectable'));
});
