import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODES, TOOL_ERRORS } from '../src/errors/codes.js';
import * as defaults from '../src/config/defaults.js';
import { validateRubric } from '../src/rubric/schema.js';

test('defaults.js に MIN_ROUNDS_DEFAULT(2), FIRST_ROUND_CEILING_DEFAULT(8), MIN_FIRST_ROUND_MUST_FIX_DEFAULT(1) がエクスポートされていること', () => {
  assert.equal(defaults.MIN_ROUNDS_DEFAULT, 2);
  assert.equal(defaults.FIRST_ROUND_CEILING_DEFAULT, 8);
  assert.equal(defaults.MIN_FIRST_ROUND_MUST_FIX_DEFAULT, 1);
});

test('codes.js に新規3件のエラーコードが正しくエクスポートされ、既存コードと重複しないこと', () => {
  assert.ok('E_MIN_ROUNDS_NOT_REACHED' in CODES);
  assert.ok('E_FIRST_ROUND_UNCRITICAL' in CODES);
  assert.ok('E_WEAKNESS_EVASIVE' in CODES);
  assert.ok(TOOL_ERRORS.score_submit.includes('E_FIRST_ROUND_UNCRITICAL'));
  assert.ok(TOOL_ERRORS.score_submit.includes('E_WEAKNESS_EVASIVE'));
});

test('rubric schema のバリデーションにおいて min_rounds, first_round_ceiling, min_first_round_must_fix を含む policy が正常通過すること', () => {
  const sampleRubric = {
    criteria: [
      {
        id: 'c1',
        title: 'c1',
        description: 'desc',
        weight: 1,
        anchors: { '1': 'a', '5': 'b', '9': 'c' },
        verification: 'manual',
        verify_hint: 'hint',
      },
    ],
    policy: {
      pass_score: 9,
      pass_weighted_mean: 9.0,
      max_rounds: 12,
      stall_window: 3,
      stall_epsilon: 0.25,
      max_score_jump: 3,
      min_rounds: 2,
      first_round_ceiling: 8,
      min_first_round_must_fix: 1,
    },
  };
  assert.doesNotThrow(() => validateRubric(sampleRubric));
});
