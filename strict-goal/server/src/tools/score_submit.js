import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { withIdempotency } from '../idempotency/guard.js';
import { checkStateTransition } from '../fsm/guard.js';
import { readSession, sessionDir, sessionExists } from '../store/session_store.js';
import { persistSession } from '../store/persist.js';
import { loadRubric } from '../rubric/store.js';
import { readArtifactContent, computeContentDigest } from '../artifact/store.js';
import { validateEvidenceShape, computeEvidenceDigest } from '../evidence/model.js';
import {
  assertEvidenceRequired,
  assertEvidenceKindForAuto,
  verifyLocatorEvidence,
  verifyExactLocatorEvidence,
  verifyUpstreamEvidence,
  verifyCommandTargetDigest,
} from '../evidence/verify.js';
import { canonicalStringify, sha256Hex } from '../hash/digest.js';
import { computeWeightedMean, computeMinScore, nextRoundsWithoutImprovement, decideVerdict } from '../judge/engine.js';
import { checkScoreInflation, checkScoreJump, checkEvidenceStale, checkBelowPassBindings } from '../judge/anti_gaming.js';
import { appendIssueEvent, readIssueLedger, unresolvedIssueSummary } from '../evidence/issue_ledger.js';
import { checkTestNotGreen } from '../implement/test_inventory.js';
import { listRejectedSubmissions, recordAcceptedRound, recordRejectedSubmission } from '../judge/round_store.js';
import { createChatEscalation, pendingChatNextAction } from '../escalation/chat.js';
import { checkSupersede } from '../chain/supersede.js';
import { chainExists, readChain } from '../chain/store.js';
import { computeChainRounds, effectiveRoundLimit } from '../chain/budget.js';
import { buildEnvelope } from '../mcp/envelope.js';
import { WEAKNESS_REQUIRED_BELOW_SCORE, WEAKNESS_MIN_LENGTH, WEAKNESS_NONE_VALUE, MUST_FIX_MAX } from '../config/defaults.js';
import { recordFailedHypothesis } from '../store/trial_history.js';
import {
  consumeApprovalBindings,
  deriveConditionChanges,
  persistEvaluationContext,
  validateConditionChanges,
} from '../evidence/evaluation_context.js';
import fs from 'node:fs';
import path from 'node:path';
import { enforceV2 } from '../policy/session_policy.js';
import { buildCriterionCacheKey } from '../evaluation/cache_key.js';
import { dependencyKeys } from '../chain/rebase.js';
import { collectRoundMetrics } from '../metrics/round_reduction.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

function payloadDigest(input) {
  return `sha256:${sha256Hex(canonicalStringify(input))}`;
}

function hasMatchingPrevalidationRecord(sDir, round, submissionId, digest) {
  const dir = path.join(sDir, 'rounds', `${round}.rejected`);
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((name) => {
    if (!/^\d+\.json$/.test(name)) return false;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      return record.event_type === 'rejected_prevalidation'
        && record.submission_id === submissionId
        && record.payload_digest === digest;
    } catch {
      return false;
    }
  });
}

function auditPrevalidationFailure(sDir, session, input, error) {
  const digest = payloadDigest(input);
  if (!hasMatchingPrevalidationRecord(sDir, session.round, input?.submission_id, digest)) {
    recordRejectedSubmission(sDir, session.round, {
      event_type: 'rejected_prevalidation',
      round: session.round,
      submission_id: input?.submission_id ?? null,
      payload_digest: digest,
      submitted_at: new Date().toISOString(),
      error_code: error.code ?? 'E_VALIDATION',
      error_detail: error.detail ?? null,
    });
  }
  error.prevalidationAudited = true;
}

function prevalidateSubmission(input, session, sDir) {
  validate(TOOL_SCHEMAS.score_submit.input, input);
  input.scores.forEach((score, i) => {
    score.evidence.forEach((ev, j) => validateEvidenceShape(ev, `$.scores[${i}].evidence[${j}]`));
  });

  const currentDigest = session.current_artifact?.digest;
  if (input.artifact_digest !== currentDigest) {
    fail('E_DIGEST_MISMATCH', 'artifact_digest does not match the current committed artifact', {
      expected: currentDigest,
      actual: input.artifact_digest,
    });
  }

  const artifactBody = readArtifactContent(sDir, currentDigest, session.artifact_kind);
  if (session.artifact_kind !== 'fileset' && computeContentDigest(artifactBody) !== currentDigest) {
    fail('E_COMMITTED_DIGEST_MISMATCH', 'stored committed artifact bytes do not match their digest', {
      expected: currentDigest,
      actual: computeContentDigest(artifactBody),
    });
  }
  for (const score of input.scores) {
    for (const evidence of score.evidence) {
      if (enforceV2(session.evaluation_policy) && evidence.kind === 'locator') {
        verifyExactLocatorEvidence(score.criterion_id, evidence, artifactBody);
      }
    }
  }
  return artifactBody;
}

export const EVASIVE_WEAKNESS_PATTERNS = [
  /(?:将来|今後|次フェーズ|将来期|後日).*?(?:課題|対応|検討|拡張|改善)/u,
  /(?:スコープ外|対象外|考慮外|対象としていない)/u,
  /(?:OS|ブラウザ|プラットフォーム|外部ライブラリ|インフラ).*?に(?:依存|委ねる|任せる)/u,
  /(?:特になし|問題なし|満たしている|完璧である|十分である)/u,
];

function assertWeaknessValid(score, index) {
  if (typeof score.weakness === 'string') {
    const trimmed = score.weakness.trim();
    const lower = trimmed.toLowerCase();
    if (lower === 'none' || lower === 'none.' || lower === 'n/a' || lower === 'na' || trimmed === '') {
      score.weakness = WEAKNESS_NONE_VALUE;
    }
  }

  if (score.weakness === WEAKNESS_NONE_VALUE) {
    if (score.score !== WEAKNESS_REQUIRED_BELOW_SCORE) {
      fail('E_WEAKNESS_REQUIRED', 'weakness:"none" is only allowed when score is 10', {
        criterion_id: score.criterion_id,
      });
    }
    return;
  }
  if (score.weakness.length < WEAKNESS_MIN_LENGTH) {
    fail('E_VALIDATION', `weakness must be at least ${WEAKNESS_MIN_LENGTH} characters`, {
      path: `$.scores[${index}].weakness`,
      reason: 'too_short',
    });
  }
  for (const pattern of EVASIVE_WEAKNESS_PATTERNS) {
    if (pattern.test(score.weakness)) {
      fail('E_WEAKNESS_EVASIVE', `weakness contains evasive language: ${score.weakness.slice(0, 50)}`, {
        criterion_id: score.criterion_id,
        matched_pattern: pattern.source,
        weakness_excerpt: score.weakness.slice(0, 200),
      });
    }
  }
}

function checkCompleteness(scores, criteria) {
  const rubricIds = new Set(criteria.map((c) => c.id));
  const submittedIds = new Set(scores.map((s) => s.criterion_id));
  const missing = [...rubricIds].filter((id) => !submittedIds.has(id));
  const unknown = [...submittedIds].filter((id) => !rubricIds.has(id));
  if (missing.length > 0 || unknown.length > 0) {
    fail('E_INCOMPLETE_SCORES', 'scores must cover exactly the rubric criteria ids', { missing, unknown });
  }
}

function buildMustFix(perCriterion, criteriaById, passScore) {
  return [...perCriterion]
    .filter((c) => c.score < passScore)
    .sort((a, b) => {
      const pA = criteriaById.get(a.criterion_id)?.priority ?? 0;
      const pB = criteriaById.get(b.criterion_id)?.priority ?? 0;
      return (pB - pA) || (a.score - b.score);
    })
    .slice(0, MUST_FIX_MAX)
    .map((c) => ({
      criterion_id: c.criterion_id,
      score: c.score,
      gap: passScore - c.score,
      anchor_9: criteriaById.get(c.criterion_id).anchors['9'],
      verify_hint: criteriaById.get(c.criterion_id).verify_hint,
      weakness: c.weakness,
    }));
}

// §7.1 手順0〜6.5, 10〜13。手順7〜9（インフレ/ジャンプ/根拠使い回し）は T036、
// §7.1.1 の rubric 版またぎ比較規則は T037 で追加する。
export function scoreSubmit({ input, persistence }) {
  const dataDir = persistence.dir;
  const sessionId = input?.session_id;
  const sDir = typeof sessionId === 'string' && sessionExists(dataDir, sessionId)
    ? sessionDir(dataDir, sessionId)
    : null;
  if (!sDir) {
    validate(TOOL_SCHEMAS.score_submit.input, input);
    fail('E_SESSION_NOT_FOUND', `session_id not found: ${input.session_id}`, { session_id: input.session_id });
  }

  const prevalidationSession = readSession(dataDir, input.session_id);
  try {
    validate(TOOL_SCHEMAS.score_submit.input, input);
  } catch (err) {
    auditPrevalidationFailure(sDir, prevalidationSession, input, err);
    throw err;
  }

  return withIdempotency(sDir, input.submission_id, () => {
    const session = readSession(dataDir, input.session_id);
    const submittedDigest = payloadDigest(input);
    const previousRejection = listRejectedSubmissions(sDir).find((record) =>
      record.submission_id === input.submission_id && record.payload_digest === submittedDigest);
    if (previousRejection) {
      fail(previousRejection.error_code, 'submission was previously rejected', previousRejection.error_detail ?? {});
    }

    try {
      checkSupersede(dataDir, session, 'score_submit');
      checkStateTransition(session.state, 'score_submit');
      let prevalidatedArtifactBody;
      try {
        prevalidatedArtifactBody = prevalidateSubmission(input, session, sDir);
      } catch (err) {
        auditPrevalidationFailure(sDir, session, input, err);
        throw err;
      }
      input.scores.forEach((score, i) => assertWeaknessValid(score, i));
      if (input.expected_round !== session.round) {
        fail('E_CONCURRENT', 'expected_round does not match the current round', {
          expected: session.round,
          actual: input.expected_round,
        });
      }

      const currentDigest = session.current_artifact?.digest;

      const rubric = loadRubric(sDir, session.rubric_version);
      const criteriaById = new Map(rubric.criteria.map((c) => [c.id, c]));

      checkCompleteness(input.scores, rubric.criteria);

      // Round 1 初回スコア上限および粗探し強制バリデーション
      if (session.round === 1 && rubric.policy.min_first_round_must_fix) {
        const requiredFailingCount = rubric.policy.min_first_round_must_fix;
        const passScore = rubric.policy.pass_score;
        const failingCount = input.scores.filter((s) => s.score < passScore).length;
        if (failingCount < requiredFailingCount) {
          fail('E_FIRST_ROUND_UNCRITICAL', `Round 1 requires at least ${requiredFailingCount} criteria below pass_score (${passScore}), but found ${failingCount}`, {
            round: 1,
            failing_criteria_count: failingCount,
            required_failing_count: requiredFailingCount,
          });
        }
      }

      const artifactBody = prevalidatedArtifactBody;

      // R4: fileset の test_inventory が green でないのに auto 基準へ pass_score 以上を付けていないか
      // （artifact_commit 側の R1-R3/R5 と対になる、採点時点でのみ判定可能な検査）。
      if (session.artifact_kind === 'fileset' && session.current_artifact.test_inventory) {
        const autoScores = input.scores.filter((s) => criteriaById.get(s.criterion_id).verification === 'auto');
        checkTestNotGreen(session.current_artifact.test_inventory, autoScores, rubric.policy.pass_score);
      }

      let upstreamBody = null;
      const needsUpstream = input.scores.some((s) => s.evidence.some((e) => e.kind === 'upstream'));
      if (needsUpstream && session.upstream) {
        const upstreamSDir = sessionDir(dataDir, session.upstream.session_id);
        const upstreamSession = readSession(dataDir, session.upstream.session_id);
        upstreamBody = readArtifactContent(upstreamSDir, session.upstream.artifact_digest, upstreamSession.artifact_kind);
      }

      const previousEvaluation = session.last_evaluation;
      const submittedContext = input.evaluation_context ?? null;
      if (session.evaluation_policy.schema_version === 1 && submittedContext) {
        fail('E_SESSION_POLICY_INVALID', 'v2 evaluation context cannot be submitted to a v1 session');
      }
      if (session.evaluation_policy.schema_version === 1 && input.scores.some((score) => score.dependency_declaration)) {
        fail('E_SESSION_POLICY_INVALID', 'v2 dependencies cannot be submitted to a v1 session');
      }
      if (enforceV2(session.evaluation_policy)) {
        const snapshot = submittedContext?.snapshot;
        for (const field of ['artifact_digest', 'scope_digest', 'rubric_digest', 'environment_digest', 'test_selection_digest']) {
          if (!/^sha256:[0-9a-f]{64}$/.test(snapshot?.[field] ?? '')) {
            fail('E_EVALUATION_CONTEXT_INVALID', `complete v2 context requires ${field}`, { field });
          }
        }
        if (snapshot.artifact_digest !== currentDigest || snapshot.rubric_digest !== session.rubric_digest) {
          fail('E_EVALUATION_CONTEXT_INVALID', 'context artifact or rubric digest does not match the session');
        }
      }
      const policyWarnings = [];
      if (session.evaluation_policy.stage === 'dual-read' && !submittedContext) {
        policyWarnings.push('v2_context_required');
      }
      let approvedConditionChanges = [];
      let contextSnapshot = null;
      if (submittedContext) {
        try {
        const derived = deriveConditionChanges(dataDir, session.session_id, submittedContext.snapshot);
        const submittedChanges = submittedContext.condition_changes ?? [];
        const submittedByReason = new Map(submittedChanges.map((change) => [change.reason, change]));
        const missing = derived.required.find((change) => {
          const submitted = submittedByReason.get(change.reason);
          return !submitted
            || submitted.before_digest !== change.before_digest
            || submitted.after_digest !== change.after_digest;
        });
        if (missing) {
          const code = {
            scope_change: 'E_SCOPE_APPROVAL_REQUIRED',
            rubric_change: 'E_RUBRIC_APPROVAL_REQUIRED',
            environment_change: 'E_ENVIRONMENT_APPROVAL_REQUIRED',
            test_selection_change: 'E_TEST_SELECTION_CHANGED',
          }[missing.reason];
          fail(code, `${missing.reason} requires a matching digest-bound approval`, missing);
        }
        approvedConditionChanges = validateConditionChanges(dataDir, session.session_id, submittedChanges);
        contextSnapshot = derived.snapshot;
        } catch (error) {
          const advisoryCodes = ['E_SCOPE_APPROVAL_REQUIRED', 'E_RUBRIC_APPROVAL_REQUIRED', 'E_ENVIRONMENT_APPROVAL_REQUIRED', 'E_TEST_SELECTION_CHANGED'];
          if (enforceV2(session.evaluation_policy) || !advisoryCodes.includes(error.code)) throw error;
          approvedConditionChanges = [];
          contextSnapshot = null;
          if (session.evaluation_policy.stage === 'dual-read') policyWarnings.push(`v2_${error.code}`);
        }
      }
      const previousScoreById = new Map((previousEvaluation?.scores ?? []).map((s) => [s.criterion_id, s]));

      const perCriterion = input.scores.map((score) => {
        const criterion = criteriaById.get(score.criterion_id);

        assertEvidenceRequired(score.criterion_id, score.evidence);
        assertEvidenceKindForAuto(score.criterion_id, criterion.verification, score.evidence);

        for (const ev of score.evidence) {
          if (ev.kind === 'locator') {
            verifyLocatorEvidence(score.criterion_id, ev, artifactBody, { dataDir });
          } else if (ev.kind === 'upstream') {
            verifyUpstreamEvidence(score.criterion_id, ev, session.loop_mode, upstreamBody);
          } else if (ev.kind === 'command') {
            verifyCommandTargetDigest(ev, currentDigest, session.loop_mode);
          }
        }

        const previous = previousScoreById.get(score.criterion_id);
        const previousScoreValue = previous ? previous.score : null;
        const evidenceDigests = score.evidence.map((ev) => computeEvidenceDigest(ev));

        checkEvidenceStale(score.criterion_id, score.score, previousScoreValue, evidenceDigests, previous?.evidence_digests);
        checkScoreJump(score.criterion_id, score.score, previousScoreValue, score.evidence, rubric.policy.max_score_jump);
        if (enforceV2(session.evaluation_policy)) {
          checkBelowPassBindings(score.criterion_id, score.score, rubric.policy.pass_score, score.evidence, score.weakness);
        } else if (session.evaluation_policy.stage === 'dual-read') {
          try {
            checkBelowPassBindings(score.criterion_id, score.score, rubric.policy.pass_score, score.evidence, score.weakness);
          } catch (error) {
            if (error.code !== 'E_ISSUE_BINDING_REQUIRED') throw error;
            policyWarnings.push(`v2_${error.code}:${score.criterion_id}`);
          }
        }

        let contextKey = null;
        let evaluationBasis = 'fresh';
        if (enforceV2(session.evaluation_policy)) {
          contextKey = buildCriterionCacheKey({
            criterionId: score.criterion_id,
            rubricDigest: session.rubric_digest,
            dependencyValues: { artifact_digest: currentDigest, scope_digest: submittedContext.snapshot.scope_digest, test_selection_digest: submittedContext.snapshot.test_selection_digest, declaration: score.dependency_declaration ?? 'unknown' },
            verificationEnvDigest: submittedContext.snapshot.environment_digest,
            evidenceSetDigest: `sha256:${sha256Hex(canonicalStringify(evidenceDigests))}`,
          });
          const proof = session.verified_reuse;
          if (dependencyKeys(score) !== null && previous?.passed && previous.context_key === contextKey
            && previous.score === score.score && proof?.to_digest === session.upstream?.artifact_digest
            && proof.criterion_ids.includes(score.criterion_id)
            && score.evidence.some((evidence) => evidence.kind === 'locator')) {
            evaluationBasis = 'reused';
          }
        }
        return {
          criterion_id: score.criterion_id,
          score: score.score,
          previous_score: previousScoreValue,
          passed: score.score >= rubric.policy.pass_score,
          rationale: score.rationale,
          weakness: score.weakness,
          evidence_digests: evidenceDigests,
          // rebase(§19.3.3) が kind:"upstream" 根拠を新しい上流本文に再照合するため、
          // 生の evidence も保持する(digest だけでは再照合できない)。
          evidence: score.evidence,
          ...(enforceV2(session.evaluation_policy) ? {
            context_key: contextKey,
            evaluation_basis: evaluationBasis,
            dependency_declaration: score.dependency_declaration ?? null,
          } : {}),
        };
      });

      const artifactUnchanged = previousEvaluation !== null && previousEvaluation !== undefined
        && previousEvaluation.artifact_digest === input.artifact_digest;
      checkScoreInflation(perCriterion, artifactUnchanged);

      const weightedMeanValue = computeWeightedMean(input.scores, criteriaById);
      const minScoreValue = computeMinScore(input.scores);
      const passedCount = perCriterion.filter((c) => c.passed).length;

      const previousWeightedMean = previousEvaluation?.weighted_mean ?? null;
      const improvement = previousWeightedMean === null ? null : weightedMeanValue - previousWeightedMean;
      const roundsWithoutImprovement =
        improvement === null
          ? session.counters.rounds_without_improvement
          : nextRoundsWithoutImprovement(improvement, rubric.policy.stall_epsilon, session.counters.rounds_without_improvement);

      const { verdict, verdict_reason: verdictReason, enforced_iteration: enforcedIteration } = decideVerdict({
        minScoreValue,
        weightedMeanValue,
        policy: rubric.policy,
        session,
        roundsWithoutImprovement,
      });
      if ((verdict === 'FINAL' || verdict === 'FINAL_WITH_RELAXATION') && perCriterion.every((entry) => entry.evaluation_basis === 'reused')) {
        for (const entry of perCriterion) entry.evaluation_basis = 'fresh';
      }

      let unresolvedIssues = null;
      if (session.evaluation_policy.schema_version === 2) {
      const issueStates = new Map(readIssueLedger(dataDir, session.session_id)
        .map((event) => [event.issue_id, event.lifecycle === 'resolved' ? 'resolved' : 'open']));
      for (const criterion of perCriterion.filter((entry) => !entry.passed)) {
        const issueId = `ISS-score-${criterion.criterion_id}`;
        appendIssueEvent(dataDir, session.session_id, {
          issue_id: issueId,
          lifecycle: issueStates.get(issueId) === 'resolved'
            ? 'reopened'
            : issueStates.get(issueId) === 'open'
              ? 'reaffirmed'
              : 'opened',
          severity: 'blocking',
          blocking: true,
          criterion_ids: [criterion.criterion_id],
          submission_id: input.submission_id,
          round: session.round,
        });
      }

      unresolvedIssues = unresolvedIssueSummary(dataDir, session.session_id);
      if (enforceV2(session.evaluation_policy) && (verdict === 'FINAL' || verdict === 'FINAL_WITH_RELAXATION') && unresolvedIssues.unresolved_count > 0) {
        fail('E_ISSUE_STATE_INVALID', 'cannot finalize while blocking issues remain open', {
          open_blocking: unresolvedIssues.unresolved_count,
          issue_ids: unresolvedIssues.must_fix,
        });
      }
      if (session.evaluation_policy.stage === 'dual-read' && (verdict === 'FINAL' || verdict === 'FINAL_WITH_RELAXATION') && unresolvedIssues.unresolved_count > 0) {
        policyWarnings.push('v2_E_ISSUE_STATE_INVALID');
      }
      }

      if (enforcedIteration) {
        session.counters.min_rounds_enforced_count = (session.counters.min_rounds_enforced_count || 0) + 1;
      }
      if (session.round === 1) {
        const failingCount = input.scores.filter((s) => s.score < rubric.policy.pass_score).length;
        session.counters.first_round_must_fix_count = failingCount;
      }

      let chainBudgetExhausted = false;
      let chainBudgetDetail = null;
      let chainObj = null;
      let chainRoundsCount = 0;
      let chainLimit = 0;
      if (session.chain_id && chainExists(dataDir, session.chain_id)) {
        chainObj = readChain(dataDir, session.chain_id);
        const { chainRounds, perSession } = computeChainRounds(dataDir, chainObj);
        chainRoundsCount = chainRounds;
        chainLimit = effectiveRoundLimit(chainObj);
        if (chainRounds >= chainLimit) {
          chainBudgetExhausted = true;
          chainBudgetDetail = { chain_rounds: chainRounds, limit: chainLimit, per_session: perSession };
        }
      }

      const scoredRound = session.round;
      let effectiveVerdict = verdict;
      let effectiveVerdictReason = verdictReason;
      let escalationData = null;
      const warnings = [...policyWarnings];

      if (verdict === 'FINAL' || verdict === 'FINAL_WITH_RELAXATION') {
        if (chainBudgetExhausted) {
          effectiveVerdict = 'PASS';
          session.state = 'FINAL';
          warnings.push('chain_budget_exceeded');
        } else {
          session.state = verdict;
        }
      } else {
        if (chainBudgetExhausted) {
          if (chainRoundsCount > chainLimit) {
            fail('E_CHAIN_BUDGET_EXHAUSTED', 'chain round budget exhausted', chainBudgetDetail);
          }
          effectiveVerdict = 'REVISE';
          effectiveVerdictReason = 'chain_budget_exhausted';
          session.state = 'ESCALATED';
          escalationData = { reason: 'chain_budget_exhausted', detail: chainBudgetDetail };
        } else {
          session.state = verdict === 'ITERATING' ? 'DRAFTING' : verdict;
          if (verdict === 'ITERATING') session.round += 1;
        }
      }

      const isFinal = session.state === 'FINAL' || session.state === 'FINAL_WITH_RELAXATION';
      const mustFix = isFinal ? [] : buildMustFix(perCriterion, criteriaById, rubric.policy.pass_score);

      if (!isFinal && mustFix && mustFix.length > 0) {
        for (const mf of mustFix) {
          const id = typeof mf === 'string' ? mf : mf.criterion_id;
          recordFailedHypothesis(dataDir, session.session_id, `Failed criterion: ${id} at round ${scoredRound}`);
        }
      }

      const record = {
        round: scoredRound,
        evaluation_schema_version: session.evaluation_policy.schema_version,
        rubric_version: session.rubric_version,
        submission_id: input.submission_id,
        submitted_at: new Date().toISOString(),
        artifact_digest: input.artifact_digest,
        weighted_mean: weightedMeanValue,
        min_score: minScoreValue,
        verdict: effectiveVerdict,
        verdict_reason: effectiveVerdictReason,
        enforced_iteration: Boolean(enforcedIteration),
        submission: { self_verdict_note: input.self_verdict_note ?? null, scores: perCriterion },
        quality_delta: {
          artifact_improved: approvedConditionChanges.length === 0 && improvement !== null && improvement > 0,
          condition_changed: approvedConditionChanges.length > 0,
        },
      };
      if (session.evaluation_policy.schema_version === 2) {
        record.metrics = collectRoundMetrics({
          session, round: scoredRound, context: contextSnapshot,
          invalidation: contextSnapshot ? approvedConditionChanges : undefined,
          scores: enforceV2(session.evaluation_policy) ? perCriterion : undefined,
          issueEvents: readIssueLedger(dataDir, session.session_id)
            .filter((event) => event.round === scoredRound && event.submission_id === input.submission_id),
        });
      }
      if (contextSnapshot) {
        persistEvaluationContext(dataDir, session.session_id, {
          context: contextSnapshot,
          invalidation: approvedConditionChanges,
          submission_id: input.submission_id,
          round: scoredRound,
        });
        consumeApprovalBindings(dataDir, session.session_id, approvedConditionChanges, {
          submission_id: input.submission_id,
          round: scoredRound,
        });
      } else if (session.evaluation_policy.schema_version === 2 && !enforceV2(session.evaluation_policy)) {
        persistEvaluationContext(dataDir, session.session_id, {
          context: { artifact_digest: currentDigest, rubric_digest: session.rubric_digest },
          unknown_fields: ['scope_digest', 'environment_digest', 'test_selection_digest'],
          invalidation: [], submission_id: input.submission_id, round: scoredRound,
        });
      }
      recordAcceptedRound(sDir, scoredRound, record);

      session.counters.rounds_without_improvement = roundsWithoutImprovement;
      delete session.verified_reuse;
      session.last_evaluation = {
        round: scoredRound,
        artifact_digest: input.artifact_digest,
        weighted_mean: weightedMeanValue,
        min_score: minScoreValue,
        verdict: effectiveVerdict,
        verdict_reason: effectiveVerdictReason,
        enforced_iteration: Boolean(enforcedIteration),
        scores: perCriterion,
        must_fix: mustFix,
        quality_delta: record.quality_delta,
      };
      session.updated_at = new Date().toISOString();
      persistSession(dataDir, session);

      let escalationInfo;
      // 緩和承認待ちや予算超過等の自動 ESCALATED（§7.1 手順12）
      if (session.state === 'ESCALATED') {
        const { record: escRecord } = createChatEscalation(sDir, {
          reason: escalationData?.reason ?? effectiveVerdictReason,
          summaryForHuman: { rounds: scoredRound, weighted_mean_trend: [weightedMeanValue], blocking_criteria: mustFix.map((m) => m.criterion_id) },
          ...(escalationData?.detail ? { detail: escalationData.detail } : {}),
        });
        escalationInfo = {
          escalation_id: escRecord.escalation_id,
          created_at: escRecord.created_at,
          channel: 'chat',
          reason: escRecord.reason,
          ...(escalationData?.detail ? { detail: escalationData.detail } : {}),
          ...(escRecord.summary_for_human ? { summary_for_human: escRecord.summary_for_human } : {}),
        };
      }

      return buildEnvelope({
        nextAction: pendingChatNextAction(sDir, session),
        ok: true,
        sessionId: session.session_id,
        state: session.state,
        round: session.round,
        rubricVersion: session.rubric_version,
        persistence: persistence.mode,
        warnings,
        verdict: effectiveVerdict,
        verdictReason: effectiveVerdictReason,
        escalation: escalationInfo,
        evaluation: {
          scored_round: scoredRound,
          artifact_digest: input.artifact_digest,
          weighted_mean: weightedMeanValue,
          min_score: minScoreValue,
          passed_count: passedCount,
          total_count: perCriterion.length,
          enforced_iteration: Boolean(enforcedIteration),
          quality_delta: record.quality_delta,
          ...(unresolvedIssues ? { issue_summary: {
            must_fix: unresolvedIssues.must_fix,
            unresolved_count: unresolvedIssues.unresolved_count,
            undisplayed_count: unresolvedIssues.undisplayed_issue_ids.length,
            ledger_ref: unresolvedIssues.ledger_ref,
          } } : {}),
          ...(improvement !== null ? { improvement } : {}),
          per_criterion: perCriterion.map((c) => ({
            criterion_id: c.criterion_id,
            score: c.score,
            previous_score: c.previous_score,
            passed: c.passed,
            evidence_digests: c.evidence_digests,
            ...(c.evaluation_basis ? { evaluation_basis: c.evaluation_basis } : {}),
          })),
        },
        mustFix: isFinal ? undefined : mustFix,
        stall: {
          rounds_without_improvement: roundsWithoutImprovement,
          stall_window: rubric.policy.stall_window,
          rounds_remaining: Math.max(0, rubric.policy.stall_window - roundsWithoutImprovement),
        },
      });
    } catch (err) {
      if (err.code && !err.prevalidationAudited) {
        recordRejectedSubmission(sDir, session.round, {
          round: session.round,
          submission_id: input.submission_id,
          payload_digest: submittedDigest,
          submitted_at: new Date().toISOString(),
          error_code: err.code,
          error_detail: err.detail ?? null,
        });
      }
      throw err;
    }
  });
}
