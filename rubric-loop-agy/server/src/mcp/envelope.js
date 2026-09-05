const TERMINAL_STATES = new Set(['FINAL', 'FINAL_WITH_RELAXATION', 'ABORTED']);

function defaultNextAction(state) {
  if (state && TERMINAL_STATES.has(state)) {
    return { tool: 'audit_export', input_skeleton: {} };
  }
  if (state === 'SCORING') {
    return { tool: 'score_submit', input_skeleton: {} };
  }
  if (state === 'DRAFTING') {
    return { tool: 'artifact_commit', input_skeleton: {} };
  }
  if (state === 'STALLED' || state === 'ESCALATED') {
    return { tool: 'escalate', input_skeleton: {} };
  }
  return { tool: 'loop_state', input_skeleton: { session_id: null } };
}

export function buildEnvelope({
  ok,
  sessionId,
  state,
  round,
  rubricVersion,
  persistence = 'durable',
  warnings = [],
  nextAction,
  loopMode,
  chainId,
  upstream,
  error,
  resumed,
  label,
  task,
  rubric,
  mustFix,
  history,
  lastScores,
  currentArtifact,
  upstreamArtifact,
  lastArtifact,
  chain,
  artifact,
  verdict,
  verdictReason,
  evaluation,
  stall,
  classification,
  diff,
  finalReachable,
  relaxationCount,
  escalation,
  export: exportData,
  handleMinted,
  artifactKind,
  planChecks,
  accepted,
  orphan,
  rebaseResult,
  reopened,
  freezeReason,
} = {}) {
  const envelope = {
    resultType: 'complete',
    ok,
    session_id: sessionId,
    state,
    round,
    rubric_version: rubricVersion,
    persistence,
    next_action: nextAction ?? defaultNextAction(state),
    warnings,
  };
  if (accepted !== undefined) envelope.accepted = accepted;
  if (artifactKind !== undefined) envelope.artifact_kind = artifactKind;
  if (loopMode !== undefined) envelope.loop_mode = loopMode;
  if (chainId !== undefined) envelope.chain_id = chainId;
  if (upstream !== undefined) envelope.upstream = upstream;
  if (error !== undefined) envelope.error = error;
  if (resumed !== undefined) envelope.resumed = resumed;
  if (label !== undefined) envelope.label = label;
  if (task !== undefined) envelope.task = task;
  if (rubric !== undefined) envelope.rubric = rubric;
  if (mustFix !== undefined) envelope.must_fix = mustFix;
  if (history !== undefined) envelope.history = history;
  if (lastScores !== undefined) envelope.last_scores = lastScores;
  if (currentArtifact !== undefined) envelope.current_artifact = currentArtifact;
  if (upstreamArtifact !== undefined) envelope.upstream_artifact = upstreamArtifact;
  if (lastArtifact !== undefined) envelope.last_artifact = lastArtifact;
  if (chain !== undefined) envelope.chain = chain;
  if (artifact !== undefined) envelope.artifact = artifact;
  if (planChecks !== undefined) envelope.plan_checks = planChecks;
  if (orphan !== undefined) envelope.orphan = orphan;
  if (verdict !== undefined) envelope.verdict = verdict;
  if (verdictReason !== undefined) envelope.verdict_reason = verdictReason;
  if (evaluation !== undefined) envelope.evaluation = evaluation;
  if (stall !== undefined) envelope.stall = stall;
  if (classification !== undefined) envelope.classification = classification;
  if (diff !== undefined) envelope.diff = diff;
  if (finalReachable !== undefined) envelope.final_reachable = finalReachable;
  if (relaxationCount !== undefined) envelope.relaxation_count = relaxationCount;
  if (escalation !== undefined) envelope.escalation = escalation;
  if (exportData !== undefined) envelope.export = exportData;
  if (handleMinted !== undefined) envelope.handle_minted = handleMinted;
  if (rebaseResult !== undefined) envelope.rebase_result = rebaseResult;
  if (reopened !== undefined) envelope.reopened = reopened;
  if (freezeReason !== undefined) envelope.freeze_reason = freezeReason;
  return envelope;
}

export function buildErrorEnvelope({ sessionId, state, error, warnings = [] } = {}) {
  return buildEnvelope({ ok: false, sessionId, state, warnings, error });
}

export { TERMINAL_STATES };
