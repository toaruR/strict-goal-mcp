const TERMINAL_STATES = new Set(['FINAL', 'FINAL_WITH_RELAXATION', 'ABORTED']);

// next_action.input_skeleton は「次の呼び出しをそのまま埋めれば通る形」を返す。
// 空 {} だとモデルが根拠（evidence）の形をサーバソースや tests/ から逆引きし始め、
// 1採点あたり数回の E_VALIDATION 往復と数万トークンを浪費する（2026-09-18 ベンチ実測）。
const EVIDENCE_SKELETON = {
  locator: {
    kind: 'locator',
    locator: '<section id, e.g. "§2.3" or heading text>',
    excerpt: '<>=20 chars copied verbatim from ONE line of the committed artifact (no joins across lines)>',
  },
  command: {
    kind: 'command',
    command: '<shell command that was actually run>',
    exit_code: 0,
    output_excerpt: '<stdout/stderr excerpt, <=8000 chars>',
    output_sha256: '<sha256 hex of the full output>',
    target_digest: '<artifact_digest returned by artifact_commit (required in implement)>',
  },
  upstream: {
    kind: 'upstream',
    upstream_locator: '<location in the pinned upstream artifact>',
    excerpt: '<>=20 chars copied verbatim from the upstream artifact>',
  },
};

export function scoreSubmitSkeleton(sessionId, round, artifactDigest) {
  return {
    session_id: sessionId ?? '<session_id>',
    submission_id: '<unique 8-64 chars [A-Za-z0-9._-]>',
    expected_round: round ?? 1,
    artifact_digest: artifactDigest ?? '<sha256:... returned by artifact_commit>',
    scores: [
      {
        criterion_id: '<every criterion id from rubric.criteria, one entry each>',
        score: '<integer 1-10>',
        rationale: '<>=40 chars: why this score, tied to the evidence>',
        weakness: '<>=10 chars concrete shortcoming; "none" only when score is 10>',
        evidence: [EVIDENCE_SKELETON.locator],
      },
    ],
    evidence_kinds: EVIDENCE_SKELETON,
    notes: [
      'verification:"auto" criteria need at least one kind:"command" evidence',
      'fileset sessions: locator excerpt must match the manifest JSON, not file contents',
      'do not read the server source to discover formats; this skeleton is authoritative',
    ],
  };
}

export function artifactCommitSkeleton(sessionId, round, requiredAddress) {
  return {
    session_id: sessionId ?? '<session_id>',
    submission_id: '<unique 8-128 chars>',
    expected_round: round ?? 1,
    change_note: '<>=20 chars: what changed and why>',
    addresses: requiredAddress ? [requiredAddress, '<other must_fix criterion ids>'] : ['<criterion ids this commit addresses>'],
    one_of: {
      source_path: '<path under the workspace root, e.g. "specification.md" (preferred for files on disk)>',
      content: '<full artifact text, only when it is not on disk>',
      files: '<implement/fileset only: files[] + manifest_command + manifest_output_sha256 + test_inventory>',
    },
  };
}

function defaultNextAction(state, ctx = {}) {
  const { sessionId, round, artifactDigest, requiredAddress } = ctx;
  if (state && TERMINAL_STATES.has(state)) {
    return { tool: 'audit_export', input_skeleton: { session_id: sessionId ?? '<session_id>', scope: 'session' } };
  }
  if (state === 'SCORING') {
    return { tool: 'score_submit', input_skeleton: scoreSubmitSkeleton(sessionId, round, artifactDigest) };
  }
  if (state === 'DRAFTING') {
    return { tool: 'artifact_commit', input_skeleton: artifactCommitSkeleton(sessionId, round, requiredAddress) };
  }
  if (state === 'STALLED' || state === 'ESCALATED') {
    return { tool: 'escalate', input_skeleton: { session_id: sessionId ?? '<session_id>', action: '<resolve|request_human|rebase|kickback|reopen>' } };
  }
  return { tool: 'loop_state', input_skeleton: { session_id: sessionId ?? null } };
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
  reopened,
  exportInfo,
  skillState,
} = {}) {
  const envelope = {
    resultType: 'complete',
    ok,
    session_id: sessionId,
    state,
    round,
    rubric_version: rubricVersion,
    persistence,
    next_action: nextAction ?? defaultNextAction(state, {
      sessionId,
      round,
      artifactDigest: artifact?.digest ?? currentArtifact?.digest,
      requiredAddress: Array.isArray(mustFix) && mustFix.length > 0 ? mustFix[0]?.criterion_id : undefined,
    }),
    warnings,
  };
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
  if (chain !== undefined) envelope.chain = chain;
  if (artifact !== undefined) envelope.artifact = artifact;
  if (verdict !== undefined) envelope.verdict = verdict;
  if (verdictReason !== undefined) envelope.verdict_reason = verdictReason;
  if (evaluation !== undefined) envelope.evaluation = evaluation;
  if (stall !== undefined) envelope.stall = stall;
  if (classification !== undefined) envelope.classification = classification;
  if (diff !== undefined) envelope.diff = diff;
  if (finalReachable !== undefined) envelope.final_reachable = finalReachable;
  if (relaxationCount !== undefined) envelope.relaxation_count = relaxationCount;
  if (escalation !== undefined) envelope.escalation = escalation;
  if (reopened !== undefined) envelope.reopened = reopened;
  if (exportInfo !== undefined) envelope.export = exportInfo;
  if (skillState !== undefined) envelope.skill_state = skillState;
  return envelope;
}

export function buildErrorEnvelope({ sessionId, state, error, warnings = [] } = {}) {
  return buildEnvelope({ ok: false, sessionId, state, warnings, error });
}

export { TERMINAL_STATES };
