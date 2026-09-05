import { TOOLS_LIST_TTL_MS, TOOLS_LIST_CACHE_SCOPE } from '../config/defaults.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';

const TOOL_ORDER = [
  'loop_open',
  'loop_state',
  'artifact_commit',
  'score_submit',
  'rubric_amend',
  'escalate',
  'audit_export',
];

// MCP tools/list はクライアントが tool を登録するために description と
// inputSchema を要求する（name のみだと不正なエントリとして黙って捨てられる）。
const TOOL_DESCRIPTIONS = {
  loop_open: 'Open a new rubric-verified loop session (create) or resume an existing one.',
  loop_state: 'Read the current state of a loop session, including round, verdict, and next_action.',
  artifact_commit: 'Commit the full artifact for the current round of a loop session.',
  score_submit: 'Submit a self-score with rationale and evidence for every rubric criterion.',
  rubric_amend: 'Amend the rubric of a session (add/modify/remove criteria) with a justification.',
  escalate: 'Request human review, rebase onto a changed upstream, kick back a flawed upstream, or resolve/abort/reopen a session.',
  audit_export: 'Export the audit trail for a session or its whole chain.',
};

export function handleToolsList() {
  return {
    tools: TOOL_ORDER.map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: TOOL_SCHEMAS[name].input,
    })),
    ttlMs: TOOLS_LIST_TTL_MS,
    cacheScope: TOOLS_LIST_CACHE_SCOPE,
  };
}

export { TOOL_ORDER };
