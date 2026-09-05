// 状態遷移表のみを入力とする到達可能性計算（実行時状態は見ない）。§19.9.1 の遷移図の実装。
export const EDGES = Object.freeze([
  { from: 'DRAFTING', to: 'SCORING', requiresUpstream: false },
  { from: 'SCORING', to: 'DRAFTING', requiresUpstream: false },
  { from: 'SCORING', to: 'STALLED', requiresUpstream: false },
  { from: 'SCORING', to: 'FINAL', requiresUpstream: false },
  { from: 'STALLED', to: 'ESCALATED', requiresUpstream: false },
  { from: 'STALLED', to: 'ABORTED', requiresUpstream: false },
  { from: 'ESCALATED', to: 'DRAFTING', requiresUpstream: false },
  { from: 'ESCALATED', to: 'FINAL_WITH_RELAXATION', requiresUpstream: false },
  { from: 'ESCALATED', to: 'ABORTED', requiresUpstream: false },
  { from: 'FINAL', to: 'DRAFTING', requiresUpstream: false },
  { from: 'FINAL_WITH_RELAXATION', to: 'DRAFTING', requiresUpstream: false },
  // SUPERSEDED / FROZEN は upstream ピンを持つセッションだけが到達しうる（§19.9.3）。
  { from: 'DRAFTING', to: 'SUPERSEDED', requiresUpstream: true },
  { from: 'SCORING', to: 'SUPERSEDED', requiresUpstream: true },
  { from: 'STALLED', to: 'SUPERSEDED', requiresUpstream: true },
  { from: 'ESCALATED', to: 'SUPERSEDED', requiresUpstream: true },
  { from: 'DRAFTING', to: 'FROZEN', requiresUpstream: true },
  { from: 'SCORING', to: 'FROZEN', requiresUpstream: true },
  { from: 'STALLED', to: 'FROZEN', requiresUpstream: true },
  { from: 'ESCALATED', to: 'FROZEN', requiresUpstream: true },
  { from: 'SUPERSEDED', to: 'DRAFTING', requiresUpstream: true },
  { from: 'SUPERSEDED', to: 'ABORTED', requiresUpstream: true },
  { from: 'FROZEN', to: 'SUPERSEDED', requiresUpstream: true },
  { from: 'FROZEN', to: 'ABORTED', requiresUpstream: true },
]);

export function reachableStates(startState, { hasUpstream }) {
  const visited = new Set([startState]);
  const queue = [startState];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of EDGES) {
      if (edge.from !== current) continue;
      if (edge.requiresUpstream && !hasUpstream) continue;
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return visited;
}

// §4.3 ラウンド番号の進み方: ITERATING のときだけ +1。他の verdict では据え置き。
export function nextRound(round, verdict) {
  return verdict === 'ITERATING' ? round + 1 : round;
}
