import { createEscalation } from '../escalation/token.js';
import { readSession, writeSession, sessionDir } from '../store/session_store.js';
import { EXTRA_ROUNDS } from '../config/defaults.js';

export function isMrtrSupported(clientCapabilities) {
  return Boolean(clientCapabilities?.elicitation || clientCapabilities?.mrtr);
}

export function handleMrtrEscalation({ session, sDir, persistence, clientCapabilities, note }) {
  if (isMrtrSupported(clientCapabilities)) {
    const { escalationId } = createEscalation(sDir, { reason: 'mrtr_request', summaryForHuman: { rounds: session.round } });
    return {
      channel: 'mrtr',
      resultType: 'input_required',
      requestState: { session_id: session.session_id, escalation_id: escalationId },
      inputRequests: [
        {
          type: 'elicitation',
          message: note ?? 'Human escalation input required: continue / accept_as_is / abort',
          schema: {
            type: 'object',
            required: ['resolution'],
            properties: {
              resolution: { type: 'string', enum: ['continue', 'accept_as_is', 'abort'] },
              note: { type: 'string' },
            },
          },
        },
      ],
      warnings: [],
    };
  }

  // Fallback to token file
  const { escalationId, tokenPath, record } = createEscalation(sDir, { reason: 'manual_request' });
  session.state = 'ESCALATED';
  writeSession(persistence.dir, session);
  return {
    channel: 'token_file',
    state: 'ESCALATED',
    escalation_id: escalationId,
    token_path: tokenPath,
    warnings: ['mrtr_unavailable'],
  };
}

export function completeMrtrEscalation({ requestState, inputResponses, persistence }) {
  const { session_id: sessionId, escalation_id: escalationId } = requestState;
  const session = readSession(persistence.dir, sessionId);
  const resolution = inputResponses?.resolution ?? 'continue';

  if (resolution === 'continue') {
    session.state = 'DRAFTING';
    session.counters.rounds_without_improvement = 0;
    session.counters.extra_rounds_granted = (session.counters.extra_rounds_granted ?? 0) + EXTRA_ROUNDS;
  } else if (resolution === 'accept_as_is') {
    session.state = 'FINAL_WITH_RELAXATION';
    session.audit_flags = [
      ...(session.audit_flags ?? []),
      { type: 'accepted_as_is_below_threshold', at: new Date().toISOString(), escalation_id: escalationId, channel: 'mrtr' },
    ];
  } else if (resolution === 'abort') {
    session.state = 'ABORTED';
  }

  session.updated_at = new Date().toISOString();
  writeSession(persistence.dir, session);

  return {
    resultType: 'complete',
    session_id: sessionId,
    state: session.state,
    resolution,
    channel: 'mrtr',
  };
}
