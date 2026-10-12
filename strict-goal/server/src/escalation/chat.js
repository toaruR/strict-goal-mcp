import { readCurrentEscalation, createMrtrEscalation, resolveMrtrEscalation } from './token.js';

// The agent waits for an explicit chat reply. This records the reply; it does not authenticate its author.
export function createChatEscalation(sDir, { reason, summaryForHuman }) {
  return createMrtrEscalation(sDir, { reason, summaryForHuman, channel: 'chat' });
}

export function resolveChatEscalation(sDir, escalationId, { resolution, humanReply }) {
  return resolveMrtrEscalation(sDir, escalationId, { resolution, humanReply, channel: 'chat' });
}

export function pendingChatNextAction(sDir, session) {
  if (session.state !== 'ESCALATED') return undefined;
  const record = readCurrentEscalation(sDir);
  if (!record || record.channel !== 'chat' || record.consumed) return undefined;
  return {
    tool: 'escalate',
    instruction: 'Present the stalled reason and choices in chat. Wait for an explicit user reply to this request. Do not infer approval from silence or earlier permission to run the task. If ambiguous, clarify. Copy the reply verbatim into human_reply.',
    input_skeleton: {
      session_id: session.session_id,
      submission_id: '<fresh_submission_id>',
      action: 'resolve',
      escalation_id: record.escalation_id,
      resolution: '<continue|accept_as_is|relax_rubric|abort>',
      human_reply: '<verbatim explicit user reply>',
      note: '<explanation of the user decision, at least 40 characters>',
    },
  };
}
