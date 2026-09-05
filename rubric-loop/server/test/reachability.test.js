import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachableStates, nextRound, EDGES } from '../src/fsm/reachability.js';

test('design モード（upstream無し）の到達可能状態集合に SUPERSEDED と FROZEN が含まれない', () => {
  const reachable = reachableStates('DRAFTING', { hasUpstream: false });
  assert.ok(!reachable.has('SUPERSEDED'));
  assert.ok(!reachable.has('FROZEN'));
});

test('plan / implement モード（upstream有り）の到達可能状態集合には両方含まれる', () => {
  const reachable = reachableStates('DRAFTING', { hasUpstream: true });
  assert.ok(reachable.has('SUPERSEDED'));
  assert.ok(reachable.has('FROZEN'));
});

test('到達可能性の計算が実行時状態ではなく状態遷移表のみを入力とする', () => {
  assert.ok(Array.isArray(EDGES));
  assert.ok(EDGES.length > 0);
  // 同じ入力(startState, hasUpstream)なら常に同じ結果になる(=外部の実行時状態を参照しない)。
  const a = reachableStates('DRAFTING', { hasUpstream: false });
  const b = reachableStates('DRAFTING', { hasUpstream: false });
  assert.deepEqual([...a].sort(), [...b].sort());
});

test('round は verdict:ITERATING のときだけ +1 される', () => {
  assert.equal(nextRound(3, 'ITERATING'), 4);
  assert.equal(nextRound(3, 'FINAL'), 3);
  assert.equal(nextRound(3, 'STALLED'), 3);
  assert.equal(nextRound(3, 'ESCALATED'), 3);
});

test('拒否された提出では round が進まない', () => {
  assert.equal(nextRound(3, undefined), 3);
});
