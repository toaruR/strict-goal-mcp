import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { withIdempotency } from '../idempotency/guard.js';
import { checkStateTransition } from '../fsm/guard.js';
import { readSession, sessionDir, sessionExists } from '../store/session_store.js';
import { persistSession } from '../store/persist.js';
import { createApproval, consumeApproval, pendingApproval, recordSystemEvent } from '../escalation/approval.js';
import { createChatEscalation, resolveChatEscalation, pendingChatApproval, pendingChatNextAction } from '../escalation/chat.js';
import { checkSupersede } from '../chain/supersede.js';
import { chainExists, readChain } from '../chain/store.js';
import { grantExtraRounds, effectiveRoundLimit, computeChainRounds } from '../chain/budget.js';
import { performRebase } from '../chain/rebase.js';
import { performKickback, prepareKickback } from '../chain/kickback.js';
import { clientSupportsMrtr, buildElicitationRequest, extractInputResponse } from '../mcp/mrtr.js';
import { buildEnvelope } from '../mcp/envelope.js';
import { EXTRA_ROUNDS } from '../config/defaults.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

function buildSummaryForHuman(session) {
  const evaluation = session.last_evaluation;
  if (!evaluation) return undefined;
  return {
    rounds: session.round,
    weighted_mean_trend: [evaluation.weighted_mean],
    blocking_criteria: (evaluation.must_fix ?? []).map((m) => m.criterion_id),
  };
}

function toEscalationInfo(record) {
  return {
    escalation_id: record.escalation_id,
    created_at: record.created_at,
    ...(record.channel !== undefined ? { channel: record.channel } : {}),
    reason: record.reason,
    ...(record.summary_for_human ? { summary_for_human: record.summary_for_human } : {}),
  };
}

// 入力スキーマの allOf 条件分岐(§6.4.6)は共有 validate() が対応しないキーワードのため、
// ここで手動検査する(score_submit.js の weakness 検査と同じ理由。CLAUDE.md ハマりポイント参照)。
function assertActionInputs(input) {
  if (input.action === 'resolve' && !input.resolution) {
    fail('E_VALIDATION', 'resolve requires resolution', { path: '$.resolution' });
  }
  if (['resolve', 'kickback', 'reopen'].includes(input.action) && (!input.escalation_id || !input.human_reply?.trim())) {
    fail('E_VALIDATION', `${input.action} requires escalation_id and human_reply`, { path: '$.escalation_id|$.human_reply' });
  }
  if (input.action === 'kickback' && !input.target_criteria) {
    fail('E_VALIDATION', 'kickback requires target_criteria', { path: '$.target_criteria' });
  }
  if (input.action === 'rebase' && !input.upstream_digest) {
    fail('E_VALIDATION', 'rebase requires upstream_digest', { path: '$.upstream_digest' });
  }
  if (input.action === 'request_human' && input.approval_action === 'kickback' && !input.target_criteria) {
    fail('E_VALIDATION', 'kickback approval requires target_criteria', { path: '$.target_criteria' });
  }
  if (input.action === 'request_human' && input.target_criteria && input.approval_action && input.approval_action !== 'kickback') {
    fail('E_VALIDATION', 'target_criteria requires a kickback approval');
  }
}

function applyResolution(session, resolution, escalationId, dataDir) {
  let chainInfo;
  if (resolution === 'continue') {
    session.state = 'DRAFTING';
    session.round += 1;
    session.counters.rounds_without_improvement = 0;
    session.counters.extra_rounds_granted = (session.counters.extra_rounds_granted ?? 0) + EXTRA_ROUNDS;
    if (dataDir && session.chain_id && chainExists(dataDir, session.chain_id)) {
      const currentChain = readChain(dataDir, session.chain_id);
      const { chainRounds } = computeChainRounds(dataDir, currentChain);
      const effectiveLimit = effectiveRoundLimit(currentChain);
      if (chainRounds >= effectiveLimit || session.last_evaluation?.verdict_reason === 'chain_budget_exhausted') {
        grantExtraRounds(dataDir, session.chain_id);
        const updated = readChain(dataDir, session.chain_id);
        chainInfo = { limit: effectiveRoundLimit(updated), granted_extra_rounds: updated.granted_extra_rounds };
      }
    }
  } else if (resolution === 'accept_as_is') {
    session.state = 'FINAL_WITH_RELAXATION';
    session.audit_flags = [
      ...(session.audit_flags ?? []),
      { type: 'accepted_as_is_below_threshold', at: new Date().toISOString(), escalation_id: escalationId },
    ];
  } else if (resolution === 'relax_rubric') {
    session.state = 'SCORING';
    session.counters.relaxation_approved = true;
  } else if (resolution === 'abort') {
    session.state = 'ABORTED';
  }
  return chainInfo;
}

// Human decisions consume a pending confirmation and preserve the user reply.
// meta は MCP の _meta 相当（§18.3 MRTR）。省略時は非対応クライアントとして扱う。
export function escalate({ input, persistence, meta }) {
  validate(TOOL_SCHEMAS.escalate.input, input);
  assertActionInputs(input);

  const dataDir = persistence.dir;
  if (!sessionExists(dataDir, input.session_id)) {
    fail('E_SESSION_NOT_FOUND', `session_id not found: ${input.session_id}`, { session_id: input.session_id });
  }
  const sDir = sessionDir(dataDir, input.session_id);

  return withIdempotency(sDir, input.submission_id, () => {
    const session = readSession(dataDir, input.session_id);
    checkSupersede(dataDir, session, 'escalate');
    const purpose = input.approval_action ?? (input.target_criteria ? 'kickback' : 'resolve');
    const requestKickback = input.action === 'request_human' && purpose === 'kickback';
    const requestReopen = input.action === 'request_human' && purpose === 'reopen';
    checkStateTransition(session.state, 'escalate', {
      action: input.action, approvalAction: requestKickback ? 'kickback' : requestReopen ? 'reopen' : undefined,
    });

    let escalationInfo;
    let chainInfo;

    if (input.action === 'request_human') {
      const mrtrAnswer = extractInputResponse(meta);
      if (mrtrAnswer && session.state === 'ESCALATED') {
        // MRTR 往復の2回目: クライアントが inputResponses を付けて同じ要求を再試行してきた。
        const approval = pendingApproval(sDir, mrtrAnswer.escalationId, { channel: 'mrtr' });
        if (approval.detail?.action && mrtrAnswer.resolution !== 'abort') {
          fail('E_RESOLUTION_NOT_APPLICABLE', 'this approval is for a specific action');
        }
        chainInfo = applyResolution(session, mrtrAnswer.resolution, approval.escalation_id, dataDir);
        const resolved = consumeApproval(sDir, mrtrAnswer.escalationId, {
          resolution: mrtrAnswer.resolution, humanReply: mrtrAnswer.note || mrtrAnswer.resolution, channel: 'mrtr',
        });
        escalationInfo = toEscalationInfo(resolved);
      } else {
        if (session.state === 'ESCALATED') {
          fail('E_STATE_VIOLATION', 'session is already ESCALATED', {
            expected_tools: ['loop_state', 'escalate', 'audit_export'],
          });
        }
        if (requestReopen && !['FINAL', 'FINAL_WITH_RELAXATION'].includes(session.state)) {
          fail('E_STATE_VIOLATION', 'reopen approval is only valid for a completed session');
        }
        const kickbackProposal = requestKickback
          ? prepareKickback(dataDir, session, { targetCriteria: input.target_criteria, note: input.note })
          : undefined;
        const reason = requestKickback ? 'kickback_requested' : requestReopen ? 'reopen_requested' : session.state === 'STALLED' && session.last_evaluation
          ? session.last_evaluation.verdict_reason
          : 'manual_request';
        const summaryForHuman = buildSummaryForHuman(session);

        if (clientSupportsMrtr(meta) && !input.approval_channel && !requestKickback && !requestReopen) {
          const { escalationId, record } = createApproval(sDir, { reason, summaryForHuman, channel: 'mrtr' });
          session.state = 'ESCALATED';
          session.updated_at = new Date().toISOString();
          persistSession(dataDir, session);
          return buildElicitationRequest(escalationId, record.summary_for_human);
        }

        const { record } = createChatEscalation(sDir, {
          reason, summaryForHuman,
          ...(kickbackProposal ? { detail: {
            action: 'kickback', target_criteria: input.target_criteria,
            upstream_session_id: kickbackProposal.upstreamSessionId,
          } } : {}),
          ...(requestReopen ? { detail: { action: 'reopen', artifact_digest: session.current_artifact?.digest ?? null } } : {}),
        });
        escalationInfo = toEscalationInfo(record);
        session.state = 'ESCALATED';
      }
    } else if (input.action === 'resolve') {
      if (session.state !== 'ESCALATED') {
        fail('E_RESOLUTION_NOT_APPLICABLE', 'resolve is only valid in ESCALATED', { state: session.state });
      }
      const approval = pendingChatApproval(sDir, input.escalation_id);
      if (approval.detail?.action && input.resolution !== 'abort') {
        fail('E_RESOLUTION_NOT_APPLICABLE', 'use the pending approval action or abort');
      }
      chainInfo = applyResolution(session, input.resolution, approval.escalation_id, dataDir);
      const consumed = resolveChatEscalation(sDir, input.escalation_id, {
        resolution: input.resolution, humanReply: input.human_reply,
      });
      escalationInfo = toEscalationInfo(consumed);
    } else if (input.action === 'abort') {
      const reason = session.last_evaluation?.verdict_reason ?? 'manual_abort';
      const { record } = recordSystemEvent(sDir, { reason, resolution: 'abort' });
      session.state = 'ABORTED';
      escalationInfo = toEscalationInfo(record);
    } else if (input.action === 'rebase') {
      if (session.state !== 'SUPERSEDED') {
        fail('E_STATE_VIOLATION', 'rebase is only valid in SUPERSEDED', { expected_tools: ['loop_state', 'escalate', 'audit_export'] });
      }
      const { record } = performRebase(dataDir, session, sDir, { newDigest: input.upstream_digest });
      escalationInfo = { escalation_id: `rebase_${record.seq}`, created_at: record.at, reason: 'upstream_rebase' };
    } else if (input.action === 'kickback') {
      if (session.state !== 'ESCALATED') {
        fail('E_RESOLUTION_NOT_APPLICABLE', 'chat-approved kickback is only valid in ESCALATED');
      }
      const approval = pendingChatApproval(sDir, input.escalation_id);
      if (approval.detail?.action && approval.detail.action !== 'kickback') {
        fail('E_RESOLUTION_NOT_APPLICABLE', 'this approval is not for kickback');
      }
      const proposal = approval.detail;
      if (proposal?.action === 'kickback' &&
        (proposal.upstream_session_id !== session.upstream?.session_id ||
         JSON.stringify([...proposal.target_criteria].sort()) !== JSON.stringify([...input.target_criteria].sort()))) {
        fail('E_RESOLUTION_NOT_APPLICABLE', 'kickback does not match the pending proposal');
      }
      const prepared = prepareKickback(dataDir, session, { targetCriteria: input.target_criteria, note: input.note });
      const consumed = resolveChatEscalation(sDir, input.escalation_id, { resolution: 'kickback', humanReply: input.human_reply });
      performKickback(dataDir, session, { targetCriteria: input.target_criteria, note: input.note, prepared });
      escalationInfo = toEscalationInfo(consumed);
    } else if (input.action === 'reopen') {
      if (session.state !== 'ESCALATED') {
        fail('E_RESOLUTION_NOT_APPLICABLE', 'reopen requires a pending approval');
      }
      const approval = pendingChatApproval(sDir, input.escalation_id);
      if (approval.detail?.action !== 'reopen' || approval.detail.artifact_digest !== (session.current_artifact?.digest ?? null)) {
        fail('E_RESOLUTION_NOT_APPLICABLE', 'this approval does not match the completed artifact');
      }
      const consumed = resolveChatEscalation(sDir, input.escalation_id, { resolution: 'reopen', humanReply: input.human_reply });
      const previousFinalDigest = session.current_artifact?.digest ?? null;
      session.state = 'DRAFTING';
      session.round += 1;
      session.reopened = [
        ...(session.reopened ?? []),
        { at: new Date().toISOString(), by: 'human', reason: input.note, previous_final_digest: previousFinalDigest },
      ];
      escalationInfo = toEscalationInfo(consumed);
    } else {
      fail('E_INTERNAL', `action not implemented in this build: ${input.action}`, { action: input.action });
    }

    session.updated_at = new Date().toISOString();
    persistSession(dataDir, session);

    return buildEnvelope({
      ok: true,
      sessionId: session.session_id,
      state: session.state,
      round: session.round,
      rubricVersion: session.rubric_version,
      persistence: persistence.mode,
      warnings: [],
      nextAction: pendingChatNextAction(sDir, session),
      escalation: escalationInfo,
      reopened: session.reopened,
      chain: chainInfo,
    });
  });
}
