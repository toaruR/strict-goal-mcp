import { MODE_POLICY_DEFAULTS, PASS_SCORE, PASS_WEIGHTED_MEAN, MAX_SCORE_JUMP, CHAIN_MAX_ROUNDS } from '../config/defaults.js';

const VERIFY_HINT_MAX = 1000;

// §6.4.1 / §19.7 の入力形（statement ベース）を §5.1/5.2 の永続形（title/description/verify_hint）へ変換する。
// 設計書はこの2形の対応を明記していないため、title=id / description=statement / verify_hint=statement
// （1000文字超は切り詰め）という無損失かつ決定的な写像を採用した。
export function convertInputCriterion(criterion) {
  const hint = criterion.statement.length > VERIFY_HINT_MAX ? criterion.statement.slice(0, VERIFY_HINT_MAX) : criterion.statement;
  return {
    id: criterion.id,
    title: criterion.id,
    description: criterion.statement,
    weight: criterion.weight,
    priority: criterion.priority ?? 0,
    anchors: criterion.anchors,
    verification: criterion.verification,
    verify_hint: hint,
  };
}

export function resolvePolicy(loopMode, inputPolicy = {}) {
  const modeDefaults = MODE_POLICY_DEFAULTS[loopMode];
  return {
    pass_score: PASS_SCORE,
    pass_weighted_mean: PASS_WEIGHTED_MEAN,
    max_rounds: modeDefaults.max_rounds,
    stall_window: modeDefaults.stall_window,
    stall_epsilon: modeDefaults.stall_epsilon,
    max_score_jump: MAX_SCORE_JUMP,
    require_command_evidence_for: ['auto'],
    chain_max_rounds: CHAIN_MAX_ROUNDS,
    ...inputPolicy,
  };
}

export function convertInputRubric(inputRubric, { loopMode }) {
  return {
    criteria: inputRubric.criteria.map(convertInputCriterion),
    policy: resolvePolicy(loopMode, inputRubric.policy),
  };
}
