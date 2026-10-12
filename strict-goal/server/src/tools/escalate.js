import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { withIdempotency } from '../idempotency/guard.js';
import { checkStateTransition } from '../fsm/guard.js';
import { readSession, sessionDir, sessionExists } from '../store/session_store.js';
import { persistSession } from '../store/persist.js';
import { createEscalation, createMrtrEscalation, resolveMrtrEscalation, consumeToken, recordSystemEvent } from '../escalation/token.js';
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

function toEscalationInfo(record, tokenPath) {
  return {
    escalation_id: record.escalation_id,
    created_at: record.created_at,
    ...(record.channel !== undefined ? { channel: record.channel } : {}),
    ...(tokenPath !== undefined ? { token_path: tokenPath } : {}),
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
  if (input.action === 'resolve' || input.action === 'kickback') {
    if (!input.human_token && (!input.escalation_id || !input.human_reply?.trim())) {
      fail('E_VALIDATION', `${input.action} requires either escalation_id + human_reply or human_token`,
        { path: '$.escalation_id|$.human_reply|$.human_token' });
    }
    if (input.human_token && (input.escalation_id || input.human_reply !== undefined)) {
      fail('E_VALIDATION', `${input.action} must use a single approval channel`);
    }
  }
  if (input.action === 'reopen' && !input.human_token) {
    fail('E_VALIDATION', 'reopen requires human_token', { path: '$.human_token' });
  }
  if (input.action === 'kickback' && !input.target_criteria) {
    fail('E_VALIDATION', 'kickback requires target_criteria', { path: '$.target_criteria' });
  }
  if (input.action === 'rebase' && !input.upstream_digest) {
    fail('E_VALIDATION', 'rebase requires upstream_digest', { path: '$.upstream_digest' });
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

// §6.4.6 / §7.3。T040 の対象は request_human / resolve(continue|accept_as_is|relax_rubric|abort) /
// abort のみ。reopen / rebase / kickback はチェーン機能と合わせて T041-T043 で実装する。
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
    const requestKickback = input.action === 'request_human' && input.target_criteria && input.approval_channel !== 'token_file';
    checkStateTransition(session.state, 'escalate', {
      action: input.action, approvalAction: requestKickback ? 'kickback' : undefined,
    });

    let escalationInfo;
    let chainInfo;
    let mrtrUnavailable = false;

    if (input.action === 'request_human') {
      const mrtrAnswer = extractInputResponse(meta);
      if (mrtrAnswer && session.state === 'ESCALATED') {
        // MRTR 往復の2回目: クライアントが inputResponses を付けて同じ要求を再試行してきた。
        const resolved = resolveMrtrEscalation(sDir, mrtrAnswer.escalationId, { resolution: mrtrAnswer.resolution });
        chainInfo = applyResolution(session, mrtrAnswer.resolution, resolved.escalation_id, dataDir);
        escalationInfo = toEscalationInfo(resolved, '');
      } else {
        if (session.state === 'ESCALATED') {
          fail('E_STATE_VIOLATION', 'session is already ESCALATED', {
            expected_tools: ['loop_state', 'escalate', 'audit_export'],
          });
        }
        const kickbackProposal = requestKickback
          ? prepareKickback(dataDir, session, { targetCriteria: input.target_criteria, note: input.note })
          : undefined;
        const reason = requestKickback ? 'kickback_requested' : session.state === 'STALLED' && session.last_evaluation
          ? session.last_evaluation.verdict_reason
          : 'manual_request';
        const summaryForHuman = buildSummaryForHuman(session);

        if (clientSupportsMrtr(meta) && !input.approval_channel && !requestKickback) {
          const { escalationId, record } = createMrtrEscalation(sDir, { reason, summaryForHuman });
          session.state = 'ESCALATED';
          session.updated_at = new Date().toISOString();
          persistSession(dataDir, session);
          return buildElicitationRequest(escalationId, record.summary_for_human);
        }

        if (input.approval_channel === 'token_file') {
          const { tokenPath, record } = createEscalation(sDir, { reason, summaryForHuman, channel: 'token_file' });
          escalationInfo = toEscalationInfo(record, tokenPath);
          mrtrUnavailable = true;
        } else {
          const { record } = createChatEscalation(sDir, {
            reason, summaryForHuman,
            ...(kickbackProposal ? { detail: {
              action: 'kickback', target_criteria: input.target_criteria,
              upstream_session_id: kickbackProposal.upstreamSessionId,
            } } : {}),
          });
          escalationInfo = toEscalationInfo(record);
        }
        session.state = 'ESCALATED';
      }
    } else if (input.action === 'resolve') {
      if (session.state !== 'ESCALATED') {
        fail('E_RESOLUTION_NOT_APPLICABLE', 'resolve is only valid in ESCALATED', { state: session.state });
      }
      if (!input.human_token && pendingChatApproval(sDir, input.escalation_id).detail?.action === 'kickback' && input.resolution !== 'abort') {
        fail('E_RESOLUTION_NOT_APPLICABLE', 'this approval request is for kickback; use kickback or abort');
      }
      const consumed = input.human_token
        ? consumeToken(sDir, input.human_token, { resolution: input.resolution })
        : resolveChatEscalation(sDir, input.escalation_id, {
          resolution: input.resolution, humanReply: input.human_reply,
        });
      chainInfo = applyResolution(session, input.resolution, consumed.escalation_id, dataDir);
      escalationInfo = toEscalationInfo(consumed, consumed.channel === 'chat' ? undefined : '');
    } else if (input.action === 'abort') {
      const reason = session.last_evaluation?.verdict_reason ?? 'manual_abort';
      const { tokenPath, record } = recordSystemEvent(sDir, { reason, resolution: 'abort' });
      session.state = 'ABORTED';
      escalationInfo = toEscalationInfo(record, tokenPath);
    } else if (input.action === 'rebase') {
      if (session.state !== 'SUPERSEDED') {
        fail('E_STATE_VIOLATION', 'rebase is only valid in SUPERSEDED', { expected_tools: ['loop_state', 'escalate', 'audit_export'] });
      }
      const { record } = performRebase(dataDir, session, sDir, { newDigest: input.upstream_digest });
      escalationInfo = { escalation_id: `rebase_${record.seq}`, created_at: record.at, token_path: '', reason: 'upstream_rebase' };
    } else if (input.action === 'kickback') {
      if (input.human_token) {
        // Preserve the legacy A10 token-presence path, including calls from FINAL.
        performKickback(dataDir, session, { targetCriteria: input.target_criteria, note: input.note });
      } else {
        if (session.state !== 'ESCALATED') {
          fail('E_RESOLUTION_NOT_APPLICABLE', 'chat-approved kickback is only valid in ESCALATED');
        }
        const approval = pendingChatApproval(sDir, input.escalation_id);
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
      }
    } else if (input.action === 'reopen') {
      if (session.state !== 'FINAL' && session.state !== 'FINAL_WITH_RELAXATION') {
        fail('E_STATE_VIOLATION', 'reopen is only valid in FINAL or FINAL_WITH_RELAXATION', {
          state: session.state,
        });
      }
      const previousFinalDigest = session.current_artifact?.digest ?? null;
      session.state = 'DRAFTING';
      session.round += 1;
      session.reopened = [
        ...(session.reopened ?? []),
        { at: new Date().toISOString(), by: 'human', reason: input.note, previous_final_digest: previousFinalDigest },
      ];
      // reopen 専用の承認要求は FINAL から作れないため、従来どおりトークンの存在だけを
      // 検査して system event を記録する（存在検査は assertActionInputs 済み）。
      const { record } = recordSystemEvent(sDir, { reason: 'reopen', resolution: 'reopen' });
      escalationInfo = toEscalationInfo(record, '');
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
      warnings: mrtrUnavailable ? ['mrtr_unavailable'] : [],
      nextAction: pendingChatNextAction(sDir, session),
      escalation: escalationInfo,
      reopened: session.reopened,
      chain: chainInfo,
    });
  });
}
