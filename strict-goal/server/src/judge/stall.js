// §7.1 手順11 / §7.3 打ち切りの出口。無限ループ（F7）を max_rounds と stall_window の
// 2系統で塞ぐ。verdict_reason で「打ち切り理由」を no_improvement / max_rounds_reached に区別する。

// 手順11: 改善が stall_epsilon 未満なら停滞カウンタを進める。改善が閾値以上ならリセットする。
export function nextRoundsWithoutImprovement(improvement, stallEpsilon, currentCount) {
  return improvement < stallEpsilon ? currentCount + 1 : 0;
}

export function isMaxRoundsReached(round, maxRounds) {
  return round >= maxRounds;
}

export function isStalledByWindow(roundsWithoutImprovement, stallWindow) {
  return roundsWithoutImprovement >= stallWindow;
}

// max_rounds 到達を stall_window 到達より優先する（同じ周に両方当てはまる場合は
// 「上限に達した」ことを理由として報告する）。どちらにも当てはまらなければ null。
export function decideStallVerdict({ round, maxRounds, roundsWithoutImprovement, stallWindow }) {
  if (isMaxRoundsReached(round, maxRounds)) {
    return { verdict: 'STALLED', verdict_reason: 'max_rounds_reached' };
  }
  if (isStalledByWindow(roundsWithoutImprovement, stallWindow)) {
    return { verdict: 'STALLED', verdict_reason: 'no_improvement' };
  }
  return null;
}
