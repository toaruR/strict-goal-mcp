import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTestInventoryRequired,
  checkRemovedTests,
  checkSkipIncrease,
  checkTestNotGreen,
} from '../src/implement/test_inventory.js';

function inventory(overrides = {}) {
  return {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'a'.repeat(64),
    counts: { total: 2, passed: 2, failed: 0, skipped: 0 },
    tests: [
      { id: 'test/a.test.js::works', file: 'test/a.test.js', status: 'passed' },
      { id: 'test/b.test.js::works', file: 'test/b.test.js', status: 'passed' },
    ],
    ...overrides,
  };
}

test('implement モードの artifact_commit で test_inventory 未添付なら E_TEST_INVENTORY_REQUIRED になる', () => {
  assert.throws(() => assertTestInventoryRequired('fileset', undefined), { code: 'E_TEST_INVENTORY_REQUIRED' });
});

test('design / plan モードでは test_inventory を要求しない', () => {
  assert.doesNotThrow(() => assertTestInventoryRequired('markdown', undefined));
  assert.doesNotThrow(() => assertTestInventoryRequired('plan', undefined));
});

test('前周に存在したテスト名が説明なく消えたとき E_TEST_REGRESSION になり detail に消えたテスト名が入る', () => {
  const prev = inventory();
  const now = inventory({
    counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    tests: [{ id: 'test/a.test.js::works', file: 'test/a.test.js', status: 'passed' }],
  });
  assert.throws(
    () => checkRemovedTests(prev, now),
    (err) => err.code === 'E_TEST_REGRESSION' && err.detail.unexplained.includes('test/b.test.js::works'),
  );
});

test('skip 数が前周より増えたとき E_TEST_REGRESSION になる', () => {
  const prev = inventory();
  const now = inventory({ counts: { total: 2, passed: 1, failed: 0, skipped: 1 } });
  assert.throws(() => checkSkipIncrease(prev, now), { code: 'E_TEST_REGRESSION' });
});

test('削除の説明が添えられた場合は通り、監査に削除理由が残る', () => {
  const prev = inventory();
  const now = inventory({
    counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    tests: [{ id: 'test/a.test.js::works', file: 'test/a.test.js', status: 'passed' }],
    removed_tests: [{ id: 'test/b.test.js::works', reason: '重複していたテストを整理のため削除した' }],
  });
  assert.doesNotThrow(() => checkRemovedTests(prev, now));
  assert.equal(now.removed_tests[0].id, 'test/b.test.js::works');
});

test('test_inventory がテストの失敗を報告している状態で pass_score 以上のスコアを出すと E_TEST_NOT_GREEN になる', () => {
  const failing = inventory({ counts: { total: 2, passed: 1, failed: 1, skipped: 0 } });
  assert.throws(
    () => checkTestNotGreen(failing, [{ criterion_id: 'impl_works', score: 9 }], 7),
    { code: 'E_TEST_NOT_GREEN' },
  );
});

test('test_inventory が green のときは pass_score 以上でも通る', () => {
  const green = inventory();
  assert.doesNotThrow(() => checkTestNotGreen(green, [{ criterion_id: 'impl_works', score: 9 }], 7));
});
