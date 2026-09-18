import { TOOL_PERMISSIONS, allowedTools } from './states.js';

function violation(state, tool, expectedTools) {
  let message = `${tool} is not callable in state ${state}`;
  if (tool === 'artifact_commit' && state === 'SCORING') {
    // 実測で最も多い誤りへの誘導: 採点前に本文を直して再 commit しようとする
    message += '. The committed artifact is frozen until score_submit returns; call score_submit (or delegate it) now. ' +
      'Do not revert your working file: the verifier scores the stored copy (artifact.stored_path / loop_state{include:["artifact_head"]}.current_artifact.stored_path), ' +
      'so edits made since the commit simply become the next round.';
  }
  const err = new Error(message);
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
