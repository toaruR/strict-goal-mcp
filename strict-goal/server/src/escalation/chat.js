import { readCurrentEscalation, createMrtrEscalation, resolveMrtrEscalation } from './token.js';

// The agent waits for an explicit chat reply. This records the reply; it does not authenticate its author.
export function createChatEscalation(sDir, { reason, summaryForHuman, detail }) {
  return createMrtrEscalation(sDir, { reason, summaryForHuman, detail, channel: 'chat' });
}

export function pendingChatApproval(sDir, escalationId) {
  const record = readCurrentEscalation(sDir);
  if (!record || record.channel !== 'chat' || record.consumed || record.escalation_id !== escalationId) {
    const err = new Error('escalation is not an active chat approval request');
    err.code = 'E_RESOLUTION_NOT_APPLICABLE';
    throw err;
  }
  return record;
}

export function resolveChatEscalation(sDir, escalationId, { resolution, humanReply }) {
  return resolveMrtrEscalation(sDir, escalationId, { resolution, humanReply, channel: 'chat' });
}

export function pendingChatNextAction(sDir, session) {
  if (session.state !== 'ESCALATED') return undefined;
  const record = readCurrentEscalation(sDir);
  if (!record || record.channel !== 'chat' || record.consumed) return undefined;
  const kickback = record.detail?.action === 'kickback';
  return {
    tool: 'escalate',
    instruction: (kickback ? 'Present the proposed upstream kickback and target criteria in chat. ' : 'Present the stalled reason and choices in chat. ') +
      'Wait for an explicit user reply to this request. Do not infer approval from silence or earlier permission to run the task. If ambiguous, clarify. Copy the reply verbatim into human_reply.',
    input_skeleton: {
      session_id: session.session_id,
      submission_id: '<fresh_submission_id>',
      action: kickback ? 'kickback' : 'resolve',
      escalation_id: record.escalation_id,
      ...(kickback ? { target_criteria: record.detail.target_criteria } : { resolution: '<continue|accept_as_is|relax_rubric|abort>' }),
      human_reply: '<verbatim explicit user reply>',
      note: '<explanation of the user decision, at least 40 characters>',
    },
  };
}
