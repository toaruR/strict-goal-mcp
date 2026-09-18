import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateRubric } from '../src/rubric/schema.js';
import { saveRubric, loadRubric, computeRubricDigest } from '../src/rubric/store.js';

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

function tmpSessionDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-rubric-'));
}

test('criteria が41件のとき E_VALIDATION になり、40件は通る', () => {
  const criteria41 = Array.from({ length: 41 }, (_, i) => criterion(`c-${i}`));
  const criteria40 = Array.from({ length: 40 }, (_, i) => criterion(`c-${i}`));
  assert.throws(() => validateRubric({ criteria: criteria41, policy: policy() }), { code: 'E_VALIDATION' });
  assert.doesNotThrow(() => validateRubric({ criteria: criteria40, policy: policy() }));
});

test('criterion の verification が auto または manual のいずれかに限られる', () => {
  assert.throws(
    () => validateRubric({ criteria: [criterion('c1', { verification: 'other' })], policy: policy() }),
    { code: 'E_VALIDATION' },
  );
  assert.doesNotThrow(() => validateRubric({ criteria: [criterion('c1', { verification: 'auto' })], policy: policy() }));
});

test('同一内容の rubric を2回保存すると rubric_digest が一致する', () => {
  const rubric = { criteria: [criterion('c1')], policy: policy() };
  const digestA = computeRubricDigest(rubric);
  const digestB = computeRubricDigest(JSON.parse(JSON.stringify(rubric)));
  assert.equal(digestA, digestB);
  assert.match(digestA, /^sha256:[0-9a-f]{64}$/);
});

test('rubric/1.json が保存され、版番号が1から始まる', () => {
  const sessionDir = tmpSessionDir();
  const rubric = { criteria: [criterion('c1')], policy: policy() };
  const saved = saveRubric(sessionDir, 1, rubric);
  assert.equal(saved.rubric_version, 1);
  const readBack = loadRubric(sessionDir, 1);
  assert.equal(readBack.rubric_version, 1);
  assert.equal(readBack.rubric_digest, saved.rubric_digest);
});

test('policy に必須の閾値フィールドが含まれる', () => {
  const rubric = { criteria: [criterion('c1')], policy: policy() };
  assert.doesNotThrow(() => validateRubric(rubric));
  for (const key of ['pass_score', 'pass_weighted_mean', 'max_rounds', 'stall_window', 'stall_epsilon', 'max_score_jump']) {
    assert.ok(key in rubric.policy, key);
  }
});

test('criterion の priority は 0〜3 の整数のみ受理され、範囲外や型違いは E_VALIDATION になる', () => {
  assert.doesNotThrow(() => validateRubric({ criteria: [criterion('c1', { priority: 0 })], policy: policy() }));
  assert.doesNotThrow(() => validateRubric({ criteria: [criterion('c1', { priority: 3 })], policy: policy() }));
  assert.throws(() => validateRubric({ criteria: [criterion('c1', { priority: -1 })], policy: policy() }), { code: 'E_VALIDATION' });
  assert.throws(() => validateRubric({ criteria: [criterion('c1', { priority: 4 })], policy: policy() }), { code: 'E_VALIDATION' });
  assert.throws(() => validateRubric({ criteria: [criterion('c1', { priority: 1.5 })], policy: policy() }), { code: 'E_VALIDATION' });
});

test('policy の scope_guard_terms は配列として受理され、未知キーは additionalProperties:false で E_VALIDATION になる', () => {
  assert.doesNotThrow(() => validateRubric({ criteria: [criterion('c1')], policy: policy({ scope_guard_terms: ['配布', 'CI'] }) }));
  assert.throws(() => validateRubric({ criteria: [criterion('c1')], policy: policy({ unknown_policy_key: 'invalid' }) }), { code: 'E_VALIDATION' });
});

