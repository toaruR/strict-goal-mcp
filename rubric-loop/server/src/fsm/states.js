export const STATES = Object.freeze([
  'DRAFTING',
  'SCORING',
  'STALLED',
  'ESCALATED',
  'FINAL',
  'FINAL_WITH_RELAXATION',
  'ABORTED',
  'SUPERSEDED',
  'FROZEN',
]);

export const TOOLS = Object.freeze([
  'loop_open',
  'loop_state',
  'artifact_commit',
  'score_submit',
  'rubric_amend',
  'escalate',
  'audit_export',
]);

const ALWAYS = { allowed: true };
const NEVER = { allowed: false };
const ESCALATE_ANY = { allowed: true, actions: null };

function escalateOnly(actions) {
  return { allowed: true, actions };
}

// §19.9.2「状態ごとに呼べるツール（改訂後・全状態）」のとおり。
// loop_open は resume のみで常に許可（作成後は state に関わらず再開できる）。
export const TOOL_PERMISSIONS = Object.freeze({
  DRAFTING: {
    loop_open: ALWAYS,
    loop_state: ALWAYS,
    artifact_commit: ALWAYS,
    score_submit: NEVER,
    rubric_amend: ALWAYS,
    escalate: ESCALATE_ANY,
    audit_export: ALWAYS,
  },
  SCORING: {
    loop_open: ALWAYS,
    loop_state: ALWAYS,
    artifact_commit: NEVER,
    score_submit: ALWAYS,
    rubric_amend: NEVER,
    escalate: ESCALATE_ANY,
    audit_export: ALWAYS,
  },
  STALLED: {
    loop_open: ALWAYS,
    loop_state: ALWAYS,
    artifact_commit: NEVER,
    score_submit: NEVER,
    rubric_amend: NEVER,
    escalate: ESCALATE_ANY,
    audit_export: ALWAYS,
  },
  ESCALATED: {
    loop_open: ALWAYS,
    loop_state: ALWAYS,
    artifact_commit: NEVER,
    score_submit: NEVER,
    rubric_amend: NEVER,
    escalate: ESCALATE_ANY,
    audit_export: ALWAYS,
  },
  FINAL: {
    loop_open: ALWAYS,
    loop_state: ALWAYS,
    artifact_commit: NEVER,
    score_submit: NEVER,
    rubric_amend: NEVER,
    escalate: escalateOnly(['reopen', 'kickback']),
    audit_export: ALWAYS,
  },
  FINAL_WITH_RELAXATION: {
    loop_open: ALWAYS,
    loop_state: ALWAYS,
    artifact_commit: NEVER,
    score_submit: NEVER,
    rubric_amend: NEVER,
    escalate: escalateOnly(['reopen', 'kickback']),
    audit_export: ALWAYS,
  },
  ABORTED: {
    loop_open: ALWAYS,
    loop_state: ALWAYS,
    artifact_commit: NEVER,
    score_submit: NEVER,
    rubric_amend: NEVER,
    escalate: NEVER,
    audit_export: ALWAYS,
  },
  SUPERSEDED: {
    loop_open: ALWAYS,
    loop_state: ALWAYS,
    artifact_commit: NEVER,
    score_submit: NEVER,
    rubric_amend: NEVER,
    escalate: escalateOnly(['rebase', 'abort']),
    audit_export: ALWAYS,
  },
  FROZEN: {
    loop_open: ALWAYS,
    loop_state: ALWAYS,
    artifact_commit: NEVER,
    score_submit: NEVER,
    rubric_amend: NEVER,
    escalate: escalateOnly(['abort']),
    audit_export: ALWAYS,
  },
});

export function allowedTools(state) {
  const table = TOOL_PERMISSIONS[state];
  return TOOLS.filter((tool) => table[tool].allowed);
}
