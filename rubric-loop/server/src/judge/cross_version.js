// §7.1.1 rubric 版をまたぐときの比較規則。diffRubric() (src/rubric/diff.js) が返す
// added / removed / anchor_changes を受け取り、previous_score の解決と
// weighted_mean 比較のベースライン再計算を行う。

// 既存基準は前周の値をそのまま使う。9点アンカーが stricter に変わった基準は
// E_SCORE_INFLATION の対象外にし warnings に stricter_anchor_score_up を出す
// （ジャンプ検査・使い回し検査は通常どおり適用する）。
// 新規基準は previous_score を null にして3検査（インフレ/ジャンプ/使い回し）を丸ごとスキップする。
export function resolvePreviousScore(criterionId, previousScoreEntry, anchorChanges = []) {
  if (!previousScoreEntry) {
    return { previousScore: null, isNew: true, exemptInflation: false, warning: null };
  }
  const stricter9 = anchorChanges.some(
    (c) => c.criterion_id === criterionId && c.anchor === '9' && c.direction === 'stricter',
  );
  return {
    previousScore: previousScoreEntry.score,
    isNew: false,
    exemptInflation: stricter9,
    warning: stricter9 ? 'stricter_anchor_score_up' : null,
  };
}

// 基準が追加された周は、前周との比較が等価でないため停滞カウンタを0にリセットする。
export function shouldResetStallCounter(diff) {
  return (diff?.added ?? []).length > 0;
}

// 削除された基準を除いた新しい基準集合で前周の weighted_mean を再計算する。
// 「低い点の基準を消して平均を上げる」を improvement の偽陽性にしないための処理。
export function recomputeBaselineWeightedMean(previousScores, criteriaById, removedIds = []) {
  const removed = new Set(removedIds);
  let weightedSum = 0;
  let weightSum = 0;
  for (const s of previousScores) {
    if (removed.has(s.criterion_id)) continue;
    const criterion = criteriaById.get(s.criterion_id);
    if (!criterion) continue;
    weightedSum += s.score * criterion.weight;
    weightSum += criterion.weight;
  }
  return weightSum > 0 ? weightedSum / weightSum : null;
}

// score_submit から使う想定の集約関数。rubric 版が変わっていない周（diffResult が null）
// では、全基準を「既存・変更なし」として扱う。
export function buildCrossVersionContext({ diffResult, previousEvaluation, criteriaById }) {
  const diff = diffResult?.diff ?? { added: [], removed: [], anchor_changes: [] };
  const previousScoreById = new Map((previousEvaluation?.scores ?? []).map((s) => [s.criterion_id, s]));

  const perCriterion = new Map();
  for (const criterionId of criteriaById.keys()) {
    perCriterion.set(criterionId, resolvePreviousScore(criterionId, previousScoreById.get(criterionId), diff.anchor_changes));
  }

  const warnings = [...new Set([...perCriterion.values()].map((r) => r.warning).filter(Boolean))];

  const baselineWeightedMean =
    diff.removed.length > 0 && previousEvaluation
      ? recomputeBaselineWeightedMean(previousEvaluation.scores, criteriaById, diff.removed)
      : (previousEvaluation?.weighted_mean ?? null);

  return {
    perCriterion,
    warnings,
    resetStallCounter: shouldResetStallCounter(diff),
    baselineWeightedMean,
  };
}
