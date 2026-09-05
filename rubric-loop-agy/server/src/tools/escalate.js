import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { withIdempotency } from '../idempotency/guard.js';
import { checkStateTransition } from '../fsm/guard.js';
import { readSession, writeSession, sessionDir, sessionExists } from '../store/session_store.js';
import { createEscalation, consumeToken, recordSystemEvent, currentEscalationId, pendingEscalationId } from '../escalation/token.js';
import { checkSupersede } from '../chain/supersede.js';
import { performRebase } from '../chain/rebase.js';
import { performKickback } from '../chain/kickback.js';
import { buildEnvelope } from '../mcp/envelope.js';
import { EXTRA_ROUNDS } from '../config/defaults.js';
import { sha256Hex } from '../hash/digest.js';
import { saveContentArtifact } from '../artifact/store.js';
import { chainExists, readChain } from '../chain/store.js';
import { grantExtraRounds, effectiveRoundLimit, computeChainRounds, assertKickbackBudget } from '../chain/budget.js';

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
    token_path: tokenPath,
    reason: record.reason,
    ...(record.summary_for_human ? { summary_for_human: record.summary_for_human } : {}),
  };
}

// 入力スキーマの allOf 条件分岐(§6.4.6)は共有 validate() が対応しないキーワードのため、
// ここで手動検査する(score_submit.js の weakness 検査と同じ理由。CLAUDE.md ハマりポイント参照)。
function assertActionInputs(input) {
  if (input.action === 'resolve' && (!input.resolution || !input.human_token)) {
    fail('E_VALIDATION', 'resolve requires resolution and human_token', { path: '$.resolution|$.human_token' });
  }
  if (input.action === 'reopen' && !input.human_token) {
    fail('E_VALIDATION', 'reopen requires human_token', { path: '$.human_token' });
  }
  if (input.action === 'kickback' && (!input.human_token || !input.target_criteria)) {
    fail('E_VALIDATION', 'kickback requires human_token and target_criteria', { path: '$.human_token|$.target_criteria' });
  }
  if (input.action === 'rebase' && !input.upstream_digest) {
    fail('E_VALIDATION', 'rebase requires upstream_digest', { path: '$.upstream_digest' });
  }
}

export function escalate({ input, persistence }) {
  validate(TOOL_SCHEMAS.escalate.input, input);
  assertActionInputs(input);

  const dataDir = persistence.dir;
  if (!sessionExists(dataDir, input.session_id)) {
    fail('E_SESSION_NOT_FOUND', `session_id not found: ${input.session_id}`, { session_id: input.session_id });
  }
  const sDir = sessionDir(dataDir, input.session_id);

  return withIdempotency(sDir, input.submission_id, () => {
    const session = readSession(dataDir, input.session_id);
    if (input.action === 'kickback') {
      if (session.chain_id && chainExists(dataDir, session.chain_id)) {
        const chain = readChain(dataDir, session.chain_id);
        assertKickbackBudget(chain);
      }
    }
    checkSupersede(dataDir, session, 'escalate');
    checkStateTransition(session.state, 'escalate', { action: input.action });

    let escalationInfo;
    let chainInfo;
    let rebaseResult;
    let freezeReason;
    let upstreamInfo;

    if (input.action === 'request_human') {
      if (session.state === 'ESCALATED') {
        fail('E_STATE_VIOLATION', 'session is already ESCALATED', {
          expected_tools: ['loop_state', 'escalate', 'audit_export'],
        });
      }
      const reason = session.state === 'STALLED' && session.last_evaluation
        ? session.last_evaluation.verdict_reason
        : 'manual_request';
      const { tokenPath, record } = createEscalation(sDir, { reason, summaryForHuman: buildSummaryForHuman(session) });
      session.state = 'ESCALATED';
      escalationInfo = toEscalationInfo(record, tokenPath);
    } else if (input.action === 'resolve') {
      if (session.state !== 'ESCALATED') {
        fail('E_RESOLUTION_NOT_APPLICABLE', 'resolve is only valid in ESCALATED', { state: session.state });
      }
      const consumed = consumeToken(sDir, input.human_token, { resolution: input.resolution });

      if (input.resolution === 'continue') {
        session.state = 'DRAFTING';
        session.round += 1;
        session.counters.rounds_without_improvement = 0;
        session.counters.extra_rounds_granted = (session.counters.extra_rounds_granted ?? 0) + (input.extra_rounds ?? EXTRA_ROUNDS);
        if (session.chain_id && chainExists(dataDir, session.chain_id)) {
          const currentChain = readChain(dataDir, session.chain_id);
          const { chainRounds } = computeChainRounds(dataDir, currentChain);
          const effectiveLimit = effectiveRoundLimit(currentChain);
          if (chainRounds >= effectiveLimit || session.last_evaluation?.verdict_reason === 'chain_budget_exhausted') {
            grantExtraRounds(dataDir, session.chain_id);
            const updated = readChain(dataDir, session.chain_id);
            chainInfo = { limit: effectiveRoundLimit(updated), granted_extra_rounds: updated.granted_extra_rounds };
          }
        }
      } else if (input.resolution === 'accept_as_is') {
        session.state = 'FINAL_WITH_RELAXATION';
        session.audit_flags = [
          ...(session.audit_flags ?? []),
          { type: 'accepted_as_is_below_threshold', at: new Date().toISOString(), escalation_id: consumed.escalation_id },
        ];
      } else if (input.resolution === 'relax_rubric') {
        session.state = 'SCORING';
        session.counters.relaxation_approved = true;
      } else if (input.resolution === 'abort') {
        session.state = 'ABORTED';
      }
      escalationInfo = toEscalationInfo(consumed, '');
    } else if (input.action === 'abort') {
      const reason = session.last_evaluation?.verdict_reason ?? 'manual_abort';
      const { tokenPath, record } = recordSystemEvent(sDir, { reason, resolution: 'abort' });
      session.state = 'ABORTED';
      escalationInfo = toEscalationInfo(record, tokenPath);
    } else if (input.action === 'rebase') {
      if (input.upstream_content !== undefined) {
        const computedDigest = `sha256:${sha256Hex(input.upstream_content)}`;
        if (computedDigest !== input.upstream_digest) {
          fail('E_UPSTREAM_DIGEST_MISMATCH', 'upstream_content digest does not match upstream_digest', {
            expected: input.upstream_digest,
            actual: computedDigest,
          });
        }
        if (session.upstream) {
          const upstreamSDir = sessionDir(dataDir, session.upstream.session_id);
          saveContentArtifact(upstreamSDir, 'plan', input.upstream_content);
          if (!sessionExists(dataDir, session.upstream.session_id)) {
            writeSession(dataDir, {
              session_id: session.upstream.session_id,
              state: 'FINAL',
              loop_mode: session.upstream.loop_mode ?? 'plan',
              artifact_kind: 'plan',
              round: 1,
              current_artifact: { digest: input.upstream_digest },
              server: session.server,
            });
          }
        }
        session.state = 'DRAFTING';
        session.round += 1;
        session.updated_at = new Date().toISOString();
        writeSession(dataDir, session);
        return buildEnvelope({
          ok: true,
          sessionId: session.session_id,
          state: 'DRAFTING',
          round: session.round,
          rubricVersion: session.rubric_version,
          persistence: persistence.mode,
          warnings: [],
          orphan: false,
        });
      }

      if (session.state !== 'SUPERSEDED') {
        fail('E_STATE_VIOLATION', 'rebase is only valid in SUPERSEDED', { expected_tools: ['loop_state', 'escalate', 'audit_export'] });
      }
      const { carriedOver, invalidated, record } = performRebase(dataDir, session, sDir, { newDigest: input.upstream_digest });
      rebaseResult = { invalidated, carried_over: carriedOver };
      escalationInfo = { escalation_id: `rebase_${record.seq}`, created_at: record.at, token_path: '', reason: 'upstream_rebase' };
    } else if (input.action === 'kickback') {
      const escalationId = pendingEscalationId(sDir);
      let consumedRecord;
      if (escalationId) {
        consumedRecord = consumeToken(sDir, input.human_token, { resolution: 'kickback' });
      } else {
        const { record } = recordSystemEvent(sDir, { reason: 'kickback', resolution: 'kickback' });
        consumedRecord = record;
      }
      const { upstreamSessionId } = performKickback(dataDir, session, { targetCriteria: input.target_criteria, note: input.note });
      escalationInfo = toEscalationInfo(consumedRecord, '');
      freezeReason = 'kicked_back';
      upstreamInfo = { session_id: upstreamSessionId, state_after: 'DRAFTING' };
    } else if (input.action === 'reopen') {
      if (session.state !== 'FINAL' && session.state !== 'FINAL_WITH_RELAXATION') {
        fail('E_STATE_VIOLATION', 'reopen is only valid in FINAL or FINAL_WITH_RELAXATION', {
          state: session.state,
        });
      }
      const previousFinalDigest = session.current_artifact?.digest ?? null;
      const now = new Date().toISOString();
      session.state = 'DRAFTING';
      session.round += 1;
      session.reopened = [
        ...(session.reopened ?? []),
        { at: now, by: 'human', reason: input.note, previous_final_digest: previousFinalDigest },
      ];
      const escalationId = pendingEscalationId(sDir);
      let consumedRecord;
      if (escalationId) {
        consumedRecord = consumeToken(sDir, input.human_token, { resolution: 'reopen' });
      } else {
        const { record } = recordSystemEvent(sDir, { reason: 'reopen', resolution: 'reopen' });
        consumedRecord = record;
      }
      escalationInfo = toEscalationInfo(consumedRecord, '');
    } else {
      fail('E_INTERNAL', `action not implemented: ${input.action}`, { action: input.action });
    }

    session.updated_at = new Date().toISOString();
    writeSession(dataDir, session);

    return buildEnvelope({
      ok: true,
      sessionId: session.session_id,
      state: session.state,
      round: session.round,
      rubricVersion: session.rubric_version,
      persistence: persistence.mode,
      warnings: [],
      escalation: escalationInfo,
      chain: chainInfo,
      rebaseResult,
      reopened: session.reopened,
      mustFix: session.last_evaluation?.must_fix,
      freezeReason,
      upstream: upstreamInfo,
    });
  });
}
