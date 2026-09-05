// session.json / rubric / chain から人間向け HTML を組み立てる純関数群。
// dashboard_view ツールが持っていた「state -> next_action」導出表・criteria/must_fix の写像をそのまま流用する。

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function deriveNextAction(sessionId, state, warnings) {
  switch (state) {
    case 'DRAFTING':
    case 'ITERATING':
      return { tool: 'artifact_commit', input_skeleton: { session_id: sessionId } };
    case 'SCORED':
      warnings.push('transient_state');
      return { tool: null };
    case 'STALLED':
      return { tool: 'escalate', input_skeleton: { session_id: sessionId, action: 'request_human' } };
    case 'ESCALATED':
      return { tool: 'escalate', input_skeleton: { session_id: sessionId, action: 'resolve' } };
    case 'SUPERSEDED':
      return { tool: 'escalate', input_skeleton: { session_id: sessionId, action: 'rebase' } };
    case 'FROZEN':
      warnings.push('frozen_awaiting_kickback_resolution');
      return { tool: null };
    case 'FINAL':
    case 'FINAL_WITH_RELAXATION':
      return { tool: null };
    default:
      return { tool: null };
  }
}

function buildCriteria(rubric, session) {
  const scoresById = new Map((session.last_evaluation?.scores ?? []).map((s) => [s.criterion_id, s]));
  return rubric.criteria.map((criterion) => {
    const scored = scoresById.get(criterion.id);
    return {
      criterion_id: criterion.id,
      weight: criterion.weight,
      score: scored?.score ?? null,
      weakness: scored?.weakness ?? '',
    };
  });
}

function buildMustFix(session) {
  return (session.last_evaluation?.must_fix ?? []).map((m) => ({
    criterion_id: m.criterion_id,
    weakness: m.weakness,
  }));
}

function buildChainInfo(dataDir, session, chainDeps) {
  const chain = chainDeps.readChain(dataDir, session.chain_id);
  const { chainRounds, perSession } = chainDeps.computeChainRounds(dataDir, chain);
  return {
    chain_id: chain.chain_id,
    chain_rounds: chainRounds,
    chain_max_rounds: chain.policy.chain_max_rounds + chain.granted_extra_rounds,
    links: perSession.map((entry) => ({
      session_id: entry.session_id,
      loop_mode: entry.loop_mode,
      state: chainDeps.readSession(dataDir, entry.session_id).state,
      round: entry.round,
    })),
  };
}

// session/rubric/chain の生データから HTML 描画用のデータモデルを組み立てる。
export function buildDashboardModel(dataDir, session, rubric, chainDeps) {
  const warnings = [];
  const nextAction = deriveNextAction(session.session_id, session.state, warnings);
  return {
    session_id: session.session_id,
    chain_id: session.chain_id,
    loop_mode: session.loop_mode,
    task: session.task,
    state: session.state,
    round: session.round,
    verdict: session.last_evaluation?.verdict ?? null,
    updated_at: session.updated_at,
    next_action: nextAction,
    criteria: buildCriteria(rubric, session),
    must_fix: buildMustFix(session),
    warnings,
    chain: buildChainInfo(dataDir, session, chainDeps),
  };
}

const PAGE_STYLE = `
body { font-family: -apple-system, Segoe UI, sans-serif; margin: 2rem; color: #1a1a1a; background: #fafafa; }
h1, h2 { margin-bottom: 0.3em; }
table { border-collapse: collapse; width: 100%; margin-bottom: 1.5em; background: #fff; }
th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 0.9em; }
th { background: #f0f0f0; }
.state { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: bold; color: #fff; }
.state-DRAFTING, .state-ITERATING { background: #3b82f6; }
.state-SCORED { background: #a3a3a3; }
.state-STALLED, .state-ESCALATED { background: #f59e0b; }
.state-SUPERSEDED, .state-FROZEN { background: #ef4444; }
.state-FINAL, .state-FINAL_WITH_RELAXATION { background: #22c55e; }
.warn { color: #b45309; }
code { background: #eee; padding: 1px 4px; border-radius: 3px; }
a { color: #2563eb; }
`;

export function renderSessionHtml(model) {
  const criteriaRows = model.criteria.map((c) => `<tr>
    <td>${escapeHtml(c.criterion_id)}</td>
    <td>${escapeHtml(c.weight)}</td>
    <td>${c.score ?? '-'}</td>
    <td>${escapeHtml(c.weakness)}</td>
  </tr>`).join('\n');

  const mustFixRows = model.must_fix.length
    ? model.must_fix.map((m) => `<li><code>${escapeHtml(m.criterion_id)}</code>: ${escapeHtml(m.weakness)}</li>`).join('\n')
    : '<li>(なし)</li>';

  const chainRows = model.chain.links.map((l) => `<tr>
    <td>${l.session_id === model.session_id ? '<strong>' + escapeHtml(l.session_id) + '</strong>' : `<a href="./${escapeHtml(l.session_id)}.html">${escapeHtml(l.session_id)}</a>`}</td>
    <td>${escapeHtml(l.loop_mode)}</td>
    <td><span class="state state-${escapeHtml(l.state)}">${escapeHtml(l.state)}</span></td>
    <td>${escapeHtml(l.round)}</td>
  </tr>`).join('\n');

  const nextActionText = model.next_action.tool
    ? `<code>${escapeHtml(model.next_action.tool)}</code> ${escapeHtml(JSON.stringify(model.next_action.input_skeleton ?? {}))}`
    : '(待機中 — 呼ぶべきツールなし)';

  const warningsText = model.warnings.length
    ? `<p class="warn">warnings: ${model.warnings.map(escapeHtml).join(', ')}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(model.session_id)} dashboard</title><style>${PAGE_STYLE}</style></head>
<body>
<p><a href="./index.html">&larr; 全セッション一覧</a></p>
<h1>${escapeHtml(model.session_id)}</h1>
<p>${escapeHtml(model.task)}</p>
<p>
  <span class="state state-${escapeHtml(model.state)}">${escapeHtml(model.state)}</span>
  loop_mode=${escapeHtml(model.loop_mode)}
  round=${escapeHtml(model.round)}
  verdict=${escapeHtml(model.verdict ?? '-')}
  chain=<a href="./index.html#${escapeHtml(model.chain_id)}">${escapeHtml(model.chain_id)}</a>
</p>
${warningsText}
<h2>次のアクション</h2>
<p>${nextActionText}</p>

<h2>Criteria</h2>
<table>
<tr><th>criterion_id</th><th>weight</th><th>score</th><th>weakness</th></tr>
${criteriaRows}
</table>

<h2>Must Fix</h2>
<ul>${mustFixRows}</ul>

<h2>Chain (${escapeHtml(model.chain.chain_rounds)}/${escapeHtml(model.chain.chain_max_rounds)} rounds)</h2>
<table>
<tr><th>session_id</th><th>loop_mode</th><th>state</th><th>round</th></tr>
${chainRows}
</table>

<p><small>updated_at: ${escapeHtml(model.updated_at)}</small></p>
</body></html>
`;
}

export function renderIndexHtml(entries) {
  const byChain = new Map();
  for (const entry of entries) {
    const list = byChain.get(entry.chain_id) ?? [];
    list.push(entry);
    byChain.set(entry.chain_id, list);
  }

  const sections = Array.from(byChain.entries()).map(([chainId, sessions]) => {
    const rows = sessions.map((s) => `<tr>
      <td><a href="./${escapeHtml(s.session_id)}.html">${escapeHtml(s.session_id)}</a></td>
      <td>${escapeHtml(s.loop_mode)}</td>
      <td><span class="state state-${escapeHtml(s.state)}">${escapeHtml(s.state)}</span></td>
      <td>${escapeHtml(s.round)}</td>
      <td>${escapeHtml(s.task)}</td>
      <td><small>${escapeHtml(s.updated_at)}</small></td>
    </tr>`).join('\n');
    return `<h2 id="${escapeHtml(chainId)}">chain: ${escapeHtml(chainId)}</h2>
<table>
<tr><th>session_id</th><th>loop_mode</th><th>state</th><th>round</th><th>task</th><th>updated_at</th></tr>
${rows}
</table>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>rubric-loop dashboard</title><style>${PAGE_STYLE}</style></head>
<body>
<h1>全セッション一覧</h1>
${sections || '<p>(セッションなし)</p>'}
</body></html>
`;
}
