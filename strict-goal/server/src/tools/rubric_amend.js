import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { withIdempotency } from '../idempotency/guard.js';
import { checkStateTransition } from '../fsm/guard.js';
import { readSession, writeSession, sessionDir, sessionExists } from '../store/session_store.js';
import { loadRubric, saveRubric } from '../rubric/store.js';
import { validateRubric } from '../rubric/schema.js';
import { convertInputCriterion } from '../rubric/from_input.js';
import { diffRubric, saveRubricDiff, isFinalReachable } from '../rubric/diff.js';
import { checkSupersede } from '../chain/supersede.js';
import { buildEnvelope } from '../mcp/envelope.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// §6.4.5 / §5.3。rubric を新版として保存し、緩和方向の変更(重み減・基準削除・アンカー緩和)を
// classification:"relaxation"|"mixed" として rubric_diff に記録する。policy は入力に存在せず
// (additionalProperties:false で送信自体が E_VALIDATION になる)、常に前版から引き継ぐ。
export function rubricAmend({ input, persistence }) {
  validate(TOOL_SCHEMAS.rubric_amend.input, input);

  const seenIds = new Set();
  for (const criterion of input.criteria) {
    if (seenIds.has(criterion.id)) {
      fail('E_VALIDATION', `duplicate criterion id: ${criterion.id}`, { path: '$.criteria', reason: 'duplicate_id' });
    }
    seenIds.add(criterion.id);
  }

  const dataDir = persistence.dir;
  if (!sessionExists(dataDir, input.session_id)) {
    fail('E_SESSION_NOT_FOUND', `session_id not found: ${input.session_id}`, { session_id: input.session_id });
  }
  const sDir = sessionDir(dataDir, input.session_id);

  return withIdempotency(sDir, input.submission_id, () => {
    const session = readSession(dataDir, input.session_id);
    checkSupersede(dataDir, session, 'rubric_amend');

    checkStateTransition(session.state, 'rubric_amend');

    if (input.expected_round !== session.round) {
      fail('E_CONCURRENT', 'expected_round does not match the current round', {
        expected: session.round,
        actual: input.expected_round,
      });
    }

    const prevRubric = loadRubric(sDir, session.rubric_version);
    const nextRubric = { criteria: input.criteria.map(convertInputCriterion), policy: prevRubric.policy };
    validateRubric(nextRubric);

    const { classification, diff, isRelaxation } = diffRubric(prevRubric, nextRubric);

    if (isRelaxation && !input.acknowledge_relaxation) {
      fail('E_RELAXATION_UNACKNOWLEDGED', 'relaxation-classified changes require acknowledge_relaxation:true', {
        classification,
      });
    }

    const nextVersion = session.rubric_version + 1;
    const savedRubric = saveRubric(sDir, nextVersion, nextRubric);
    saveRubricDiff(sDir, nextVersion, { classification, diff, reason: input.reason });

    session.rubric_version = nextVersion;
    session.rubric_digest = savedRubric.rubric_digest;
    if (isRelaxation) {
      session.counters.relaxation_count += 1;
      session.counters.relaxation_approved = false;
    }
    session.updated_at = new Date().toISOString();
    writeSession(dataDir, session);

    return buildEnvelope({
      ok: true,
      sessionId: session.session_id,
      state: session.state,
      round: session.round,
      rubricVersion: nextVersion,
      persistence: persistence.mode,
      warnings: [],
      classification,
      diff,
      finalReachable: isFinalReachable(classification),
      relaxationCount: session.counters.relaxation_count,
    });
  });
}
