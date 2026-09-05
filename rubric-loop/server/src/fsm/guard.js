import { TOOL_PERMISSIONS, allowedTools } from './states.js';

function violation(state, tool, expectedTools) {
  const err = new Error(`${tool} is not callable in state ${state}`);
  err.code = 'E_STATE_VIOLATION';
  err.detail = { expected_tools: expectedTools };
  return err;
}

export function checkStateTransition(state, tool, { action } = {}) {
  const table = TOOL_PERMISSIONS[state];
  if (!table) {
    const err = new Error(`unknown state: ${state}`);
    err.code = 'E_INTERNAL';
    throw err;
  }

  const permission = table[tool];
  if (!permission || !permission.allowed) {
    throw violation(state, tool, allowedTools(state));
  }

  if (tool === 'escalate' && permission.actions && action && !permission.actions.includes(action)) {
    throw violation(state, tool, allowedTools(state));
  }

  return true;
}
