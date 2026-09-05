import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffRubric, isFinalReachable } from '../src/rubric/diff.js';

function criterion(id, overrides = {}) {
  return {
    id,
    title: `title-${id}`,
    description: `description for ${id}`,
    weight: 3,
    anchors: { 1: 'weak', 5: 'ok', 9: 'excellent' },
    verification: 'manual',
    verify_hint: 'read it',
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    pass_score: 9,
    pass_weighted_mean: 9.0,
    max_rounds: 12,
    stall_window: 3,
    stall_epsilon: 0.25,
    max_score_jump: 3,
    ...overrides,
  };
}

function rubric(criteria, policyOverrides = {}) {
  return { criteria, policy: policy(policyOverrides) };
}

test('重みを下げる変更は relaxation に分類される', () => {
  const prev = rubric([criterion('c1', { weight: 4 })]);
  const next = rubric([criterion('c1', { weight: 2 })]);
  const result = diffRubric(prev, next);
  assert.equal(result.classification, 'relaxation');
  assert.equal(result.diff.weight_changes[0].from, 4);
  assert.equal(result.diff.weight_changes[0].to, 2);
});

test('基準を削除する変更は relaxation に分類される', () => {
  const prev = rubric([criterion('c1'), criterion('c2')]);
  const next = rubric([criterion('c1')]);
  const result = diffRubric(prev, next);
  assert.equal(result.classification, 'relaxation');
  assert.deepEqual(result.diff.removed, ['c2']);
});

test('アンカーの文言を緩める変更は relaxation に分類される', () => {
  const prev = rubric([criterion('c1', { anchors: { 1: 'weak', 5: 'ok', 9: 'must pass all tests with full coverage' } })]);
  const next = rubric([criterion('c1', { anchors: { 1: 'weak', 5: 'ok', 9: 'must pass tests' } })]);
  const result = diffRubric(prev, next);
  assert.equal(result.classification, 'relaxation');
  const change = result.diff.anchor_changes.find((c) => c.anchor === '9');
  assert.equal(change.direction, 'looser');
});

test('アンカーを厳しくする変更は anchor_changes 上で stricter と記録される', () => {
  const prev = rubric([criterion('c1', { anchors: { 1: 'weak', 5: 'ok', 9: 'must pass tests' } })]);
  const next = rubric([criterion('c1', { anchors: { 1: 'weak', 5: 'ok', 9: 'must pass tests with full coverage' } })]);
  const result = diffRubric(prev, next);
  const change = result.diff.anchor_changes.find((c) => c.anchor === '9');
  assert.equal(change.direction, 'stricter');
  assert.equal(result.classification, 'addition');
});

test('pass_score / pass_weighted_mean / max_score_jump の変更は E_THRESHOLD_IMMUTABLE', () => {
  const prev = rubric([criterion('c1')]);
  assert.throws(() => diffRubric(prev, rubric([criterion('c1')], { pass_score: 8 })), { code: 'E_THRESHOLD_IMMUTABLE' });
  assert.throws(() => diffRubric(prev, rubric([criterion('c1')], { pass_weighted_mean: 8.5 })), { code: 'E_THRESHOLD_IMMUTABLE' });
  assert.throws(() => diffRubric(prev, rubric([criterion('c1')], { max_score_jump: 4 })), { code: 'E_THRESHOLD_IMMUTABLE' });
});

test('relaxation / mixed は isFinalReachable が false、addition / clarification は true', () => {
  assert.equal(isFinalReachable('relaxation'), false);
  assert.equal(isFinalReachable('mixed'), false);
  assert.equal(isFinalReachable('addition'), true);
  assert.equal(isFinalReachable('clarification'), true);
});

test('mixed: 削除と追加が同時に起きた場合の分類', () => {
  const prev = rubric([criterion('c1'), criterion('c2')]);
  const next = rubric([criterion('c1'), criterion('c3')]);
  const result = diffRubric(prev, next);
  assert.equal(result.classification, 'mixed');
  assert.deepEqual(result.diff.added, ['c3']);
  assert.deepEqual(result.diff.removed, ['c2']);
});

test('タイトル・説明のみの変更は clarification に分類される', () => {
  const prev = rubric([criterion('c1', { title: 'old title' })]);
  const next = rubric([criterion('c1', { title: 'new title' })]);
  const result = diffRubric(prev, next);
  assert.equal(result.classification, 'clarification');
});
