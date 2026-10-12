import { readCurrentEscalation, createApproval, consumeApproval, pendingApproval } from './approval.js';

// The agent waits for an explicit chat reply. This records the reply; it does not authenticate its author.
export function createChatEscalation(sDir, { reason, summaryForHuman, detail }) {
  return createApproval(sDir, { reason, summaryForHuman, detail });
}

export function pendingChatApproval(sDir, escalationId) {
  return pendingApproval(sDir, escalationId);
}

export function resolveChatEscalation(sDir, escalationId, { resolution, humanReply }) {
  return consumeApproval(sDir, escalationId, { resolution, humanReply });
}

export function pendingChatNextAction(sDir, session) {
  if (session.state !== 'ESCALATED') return undefined;
  const record = readCurrentEscalation(sDir);
  if (!record || record.channel === 'system' || record.consumed) return undefined;
  const kickback = record.detail?.action === 'kickback';
  const reopen = record.detail?.action === 'reopen';
  return {
    tool: 'escalate',
    instruction: (kickback ? 'Present the proposed upstream kickback and target criteria in chat. ' : reopen ? 'Ask the user whether to reopen this completed session. ' : 'Present the reason and choices in chat. ') +
      'Wait for an explicit user reply to this request. Do not infer approval from silence or earlier permission to run the task. If ambiguous, clarify. Copy the reply verbatim into human_reply.',
    input_skeleton: {
      session_id: session.session_id,
      submission_id: '<fresh_submission_id>',
      action: kickback ? 'kickback' : reopen ? 'reopen' : 'resolve',
      escalation_id: record.escalation_id,
      ...(kickback ? { target_criteria: record.detail.target_criteria } : reopen ? {} : { resolution: '<continue|accept_as_is|relax_rubric|abort>' }),
      human_reply: '<verbatim explicit user reply>',
      note: '<explanation of the user decision, at least 40 characters>',
    },
  };
}
