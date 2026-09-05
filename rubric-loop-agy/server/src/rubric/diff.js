import path from 'node:path';
import fs from 'node:fs';
import { writeJson } from '../store/atomic.js';

const POLICY_KEYS = [
  'pass_score',
  'pass_weighted_mean',
  'max_rounds',
  'stall_window',
  'stall_epsilon',
  'max_score_jump',
  'require_command_evidence_for',
  'chain_max_rounds',
  'scale_min',
  'scale_max',
];

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// 9点アンカーの文言比較で方向を決める。既存文言を包含したまま伸びれば stricter、
// 既存文言が失われれば looser、それ以外の変更は reworded。
function anchorDirection(oldText, newText) {
  if (oldText === newText) return null;
  if (newText.includes(oldText) && newText.length >= oldText.length) return 'stricter';
  if (!newText.includes(oldText)) return 'looser';
  return 'reworded';
}

export function diffRubric(prevRubric, nextRubric) {
  for (const key of POLICY_KEYS) {
    const before = prevRubric.policy?.[key];
    const after = nextRubric.policy?.[key];
    if (before !== undefined && after !== undefined && JSON.stringify(before) !== JSON.stringify(after)) {
      fail('E_THRESHOLD_IMMUTABLE', `policy.${key} is immutable after loop_open`, { path: `policy.${key}` });
    }
  }

  const prevById = new Map(prevRubric.criteria.map((c) => [c.id, c]));
  const nextById = new Map(nextRubric.criteria.map((c) => [c.id, c]));

  const added = [...nextById.keys()].filter((id) => !prevById.has(id));
  const removed = [...prevById.keys()].filter((id) => !nextById.has(id));
  const weightChanges = [];
  const anchorChanges = [];

  let hasAdditionSignal = added.length > 0;
  let hasRelaxationSignal = removed.length > 0;
  let hasClarificationSignal = false;

  for (const id of nextById.keys()) {
    if (!prevById.has(id)) continue;
    const before = prevById.get(id);
    const after = nextById.get(id);

    if (before.weight !== after.weight) {
      weightChanges.push({ criterion_id: id, from: before.weight, to: after.weight });
      if (after.weight > before.weight) hasAdditionSignal = true;
      if (after.weight < before.weight) hasRelaxationSignal = true;
    }

    for (const level of ['1', '5', '9']) {
      const direction = anchorDirection(before.anchors[level], after.anchors[level]);
      if (!direction) continue;
      anchorChanges.push({ criterion_id: id, anchor: level, direction });
      if (level === '9') {
        if (direction === 'stricter') hasAdditionSignal = true;
        if (direction === 'looser') hasRelaxationSignal = true;
      }
    }

    if (before.verification === 'auto' && after.verification === 'manual') {
      hasRelaxationSignal = true;
    }

    if (before.title !== after.title || before.description !== after.description || before.verify_hint !== after.verify_hint) {
      hasClarificationSignal = true;
    }
  }

  let classification;
  if (hasRelaxationSignal && (hasAdditionSignal || hasClarificationSignal)) {
    classification = 'mixed';
  } else if (hasRelaxationSignal) {
    classification = 'relaxation';
  } else if (hasAdditionSignal) {
    classification = 'addition';
  } else {
    classification = 'clarification';
  }

  return {
    classification,
    diff: { added, removed, weight_changes: weightChanges, anchor_changes: anchorChanges },
    isRelaxation: hasRelaxationSignal,
  };
}

// relaxation を1件でも含むと、以後そのセッションは FINAL に到達できない
// （閾値を満たしても人間承認による FINAL_WITH_RELAXATION のみ。§5.3）。
export function isFinalReachable(classification) {
  return classification !== 'relaxation' && classification !== 'mixed';
}

export function saveRubricDiff(sessionDir, version, diffResult) {
  const target = path.join(sessionDir, 'rubric_diff', `${version}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeJson(target, diffResult);
  return diffResult;
}
