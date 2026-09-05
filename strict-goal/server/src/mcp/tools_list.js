import { TOOLS_LIST_TTL_MS, TOOLS_LIST_CACHE_SCOPE } from '../config/defaults.js';

const TOOL_ORDER = [
  'loop_open',
  'loop_state',
  'artifact_commit',
  'score_submit',
  'rubric_amend',
  'escalate',
  'audit_export',
];

export function handleToolsList() {
  return {
    tools: TOOL_ORDER.map((name) => ({ name })),
    ttlMs: TOOLS_LIST_TTL_MS,
    cacheScope: TOOLS_LIST_CACHE_SCOPE,
  };
}

export { TOOL_ORDER };
