import { validate } from '../schema/validate.js';
import { CRITERIA_MAX, SCALE_MIN, SCALE_MAX } from '../config/defaults.js';

// §5.1/5.2 の rubric スキーマ。criteria は最大40件。
export const RUBRIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['criteria', 'policy'],
  properties: {
    rubric_version: { type: 'integer', minimum: 1 },
    criteria: {
      type: 'array',
      minItems: 1,
      maxItems: CRITERIA_MAX,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'description', 'weight', 'anchors', 'verification', 'verify_hint'],
        properties: {
          // §5.2 は id を `[a-z0-9-]` としているが、§19.7 の実プリセットは `[a-z0-9_]` の id
          // （例: failure_mode_mapping）を使っている。両方を受理する。
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{1,63}$' },
          title: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', minLength: 1, maxLength: 2000 },
          weight: { type: 'integer', minimum: 1, maximum: 5 },
          anchors: {
            type: 'object',
            additionalProperties: false,
            required: ['1', '5', '9'],
            properties: {
              1: { type: 'string', minLength: 1, maxLength: 1000 },
              5: { type: 'string', minLength: 1, maxLength: 1000 },
              9: { type: 'string', minLength: 1, maxLength: 1000 },
            },
          },
          verification: { type: 'string', enum: ['auto', 'manual'] },
          verify_hint: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    policy: {
      type: 'object',
      additionalProperties: false,
      required: ['pass_score', 'pass_weighted_mean', 'max_rounds', 'stall_window', 'stall_epsilon', 'max_score_jump'],
      properties: {
        scale_min: { type: 'integer' },
        scale_max: { type: 'integer' },
        pass_score: { type: 'integer', minimum: SCALE_MIN, maximum: SCALE_MAX },
        pass_weighted_mean: { type: 'number', minimum: SCALE_MIN, maximum: SCALE_MAX },
        max_rounds: { type: 'integer', minimum: 1, maximum: 50 },
        stall_window: { type: 'integer', minimum: 2, maximum: 10 },
        stall_epsilon: { type: 'number', minimum: 0, maximum: 5 },
        max_score_jump: { type: 'integer', minimum: 1, maximum: 9 },
        require_command_evidence_for: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string', enum: ['auto', 'manual'] },
        },
        chain_max_rounds: { type: 'integer', minimum: 1, maximum: 200 },
        min_rounds: { type: 'integer', minimum: 1, maximum: 10 },
        first_round_ceiling: { type: 'integer', minimum: 1, maximum: 10 },
        min_first_round_must_fix: { type: 'integer', minimum: 0, maximum: 5 },
      },
    },
  },
};

function fail(path, reason) {
  const err = new Error(`validation failed at ${path}: ${reason}`);
  err.code = 'E_VALIDATION';
  err.detail = { path, reason };
  throw err;
}

export function validateRubric(rubric) {
  validate(RUBRIC_SCHEMA, rubric);

  const seen = new Set();
  for (const criterion of rubric.criteria) {
    if (seen.has(criterion.id)) fail('$.criteria', `duplicate criterion id: ${criterion.id}`);
    seen.add(criterion.id);
  }

  return true;
}
