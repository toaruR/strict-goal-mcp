import { readSession, writeSession, sessionExists } from '../store/session_store.js';
import { sessionDir } from '../store/session_store.js';
import { loadRubric } from '../rubric/store.js';
import { readChain, appendKickback } from './store.js';
import { assertKickbackBudget } from './budget.js';
import { MUST_FIX_MAX } from '../config/defaults.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

function buildKickbackMustFix(upstreamSDir, upstreamRubricVersion, targetCriteria, note) {
  const rubric = loadRubric(upstreamSDir, upstreamRubricVersion);
  const criteriaById = new Map(rubric.criteria.map((c) => [c.id, c]));
  return targetCriteria.slice(0, MUST_FIX_MAX).map((criterionId) => {
    const criterion = criteriaById.get(criterionId);
    return {
      criterion_id: criterionId,
      score: 0,
      gap: rubric.policy.pass_score,
      anchor_9: criterion?.anchors?.['9'],
      verify_hint: criterion?.verify_hint,
      weakness: note,
    };
  });
}

// §19.4。下流からの差し戻し: 上流を FINAL -> DRAFTING に再オープンし、下流を FROZEN にする。
// human_token の消費(E_TOKEN_INVALID)は呼び出し元(escalate.js)が resolve と同じ経路で行う。
export function performKickback(dataDir, session, { targetCriteria, note }) {
  const upstreamSessionId = session.upstream?.session_id;
  if (!upstreamSessionId) {
    fail('E_UPSTREAM_NOT_FOUND', 'session has no upstream to kick back to', { session_id: session.session_id });
  }
  if (!sessionExists(dataDir, upstreamSessionId)) {
    fail('E_UPSTREAM_NOT_FOUND', `upstream session not found: ${upstreamSessionId}`, { session_id: upstreamSessionId });
  }

  const chain = readChain(dataDir, session.chain_id);
  assertKickbackBudget(chain);

  const upstreamSession = readSession(dataDir, upstreamSessionId);
  const upstreamSDir = sessionDir(dataDir, upstreamSessionId);
  const previousFinalDigest = upstreamSession.current_artifact?.digest ?? null;
  const now = new Date().toISOString();

  upstreamSession.state = 'DRAFTING';
  upstreamSession.round += 1;
  upstreamSession.reopened = [
    ...(upstreamSession.reopened ?? []),
    { at: now, by: 'kickback', from_session: session.session_id, reason: note, previous_final_digest: previousFinalDigest },
  ];
  if (upstreamSession.last_evaluation) {
    upstreamSession.last_evaluation.must_fix = buildKickbackMustFix(
      upstreamSDir,
      upstreamSession.rubric_version,
      targetCriteria,
      note,
    );
  }
  upstreamSession.updated_at = now;
  writeSession(dataDir, upstreamSession);

  session.state = 'FROZEN';

  appendKickback(dataDir, session.chain_id, {
    at: now,
    from: session.session_id,
    to: upstreamSessionId,
    target_criteria: targetCriteria,
    note,
  });

  return { upstreamSessionId };
}
