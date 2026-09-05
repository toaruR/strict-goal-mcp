import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { withIdempotency } from '../idempotency/guard.js';
import { checkStateTransition } from '../fsm/guard.js';
import { readSession, writeSession, sessionDir, sessionExists } from '../store/session_store.js';
import { loadRubric } from '../rubric/store.js';
import { readArtifactContent } from '../artifact/store.js';
import { validateEvidenceShape, computeEvidenceDigest } from '../evidence/model.js';
import {
  assertEvidenceRequired,
  assertEvidenceKindForAuto,
  verifyLocatorEvidence,
  verifyUpstreamEvidence,
  verifyCommandTargetDigest,
} from '../evidence/verify.js';
import { computeWeightedMean, computeMinScore, nextRoundsWithoutImprovement, decideVerdict } from '../judge/engine.js';
import { checkScoreInflation, checkScoreJump, checkEvidenceStale } from '../judge/anti_gaming.js';
import { recordAcceptedRound, recordRejectedSubmission } from '../judge/round_store.js';
import { createEscalation } from '../escalation/token.js';
import { checkSupersede } from '../chain/supersede.js';
import { buildEnvelope } from '../mcp/envelope.js';
import { chainExists, readChain } from '../chain/store.js';
import { computeChainRounds, effectiveRoundLimit } from '../chain/budget.js';
import { readTestInventory, checkTestNotGreen } from '../implement/test_inventory.js';
import { WEAKNESS_REQUIRED_BELOW_SCORE, WEAKNESS_MIN_LENGTH, WEAKNESS_NONE_VALUE, MUST_FIX_MAX } from '../config/defaults.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// weakness は score==10 のときのみ "none" を許す。それ以外は最低文字数の本文が必須
// （スキーマの minLength は "none" を通すため外してあり、ここで手動検査する）。
function assertWeaknessValid(score, index) {
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
    .sort((a, b) => a.score - b.score)
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
  validate(TOOL_SCHEMAS.score_submit.input, input);

  input.scores.forEach((score, i) => {
    score.evidence.forEach((ev, j) => validateEvidenceShape(ev, `$.scores[${i}].evidence[${j}]`));
    assertWeaknessValid(score, i);
  });

  const dataDir = persistence.dir;
  if (!sessionExists(dataDir, input.session_id)) {
    fail('E_SESSION_NOT_FOUND', `session_id not found: ${input.session_id}`, { session_id: input.session_id });
  }
  const sDir = sessionDir(dataDir, input.session_id);

  return withIdempotency(sDir, input.submission_id, () => {
    const session = readSession(dataDir, input.session_id);

    try {
      checkSupersede(dataDir, session, 'score_submit');
      checkStateTransition(session.state, 'score_submit');

      if (input.expected_round !== session.round) {
        fail('E_CONCURRENT', 'expected_round does not match the current round', {
          expected: session.round,
          actual: input.expected_round,
        });
      }

      const currentDigest = session.current_artifact?.digest;
      if (input.artifact_digest !== currentDigest) {
        fail('E_DIGEST_MISMATCH', 'artifact_digest does not match the current committed artifact', {
          expected: currentDigest,
          actual: input.artifact_digest,
        });
      }

      const rubric = loadRubric(sDir, session.rubric_version);
      const criteriaById = new Map(rubric.criteria.map((c) => [c.id, c]));

      checkCompleteness(input.scores, rubric.criteria);

      const artifactBody = readArtifactContent(sDir, currentDigest, session.artifact_kind);

      let upstreamBody = null;
      const needsUpstream = input.scores.some((s) => s.evidence.some((e) => e.kind === 'upstream'));
      if (needsUpstream && session.upstream) {
        const upstreamSDir = sessionDir(dataDir, session.upstream.session_id);
        const upstreamSession = readSession(dataDir, session.upstream.session_id);
        upstreamBody = readArtifactContent(upstreamSDir, session.upstream.artifact_digest, upstreamSession.artifact_kind);
      }

      const previousEvaluation = session.last_evaluation;
      const previousScoreById = new Map((previousEvaluation?.scores ?? []).map((s) => [s.criterion_id, s]));

      const perCriterion = input.scores.map((score) => {
        const criterion = criteriaById.get(score.criterion_id);

        assertEvidenceRequired(score.criterion_id, score.evidence);
        assertEvidenceKindForAuto(score.criterion_id, criterion.verification, score.evidence);

        for (const ev of score.evidence) {
          if (ev.kind === 'locator') {
            verifyLocatorEvidence(score.criterion_id, ev, artifactBody);
          } else if (ev.kind === 'upstream') {
            verifyUpstreamEvidence(score.criterion_id, ev, session.loop_mode, upstreamBody);
          } else if (ev.kind === 'command') {
            verifyCommandTargetDigest(ev, currentDigest, session.loop_mode, score.criterion_id);
          }
        }

        const previous = previousScoreById.get(score.criterion_id);
        const previousScoreValue = previous ? previous.score : null;
        const evidenceDigests = score.evidence.map((ev) => computeEvidenceDigest(ev));

        checkEvidenceStale(score.criterion_id, score.score, previousScoreValue, evidenceDigests, previous?.evidence_digests);
        checkScoreJump(score.criterion_id, score.score, previousScoreValue, score.evidence, rubric.policy.max_score_jump);

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
        };
      });

      if (session.artifact_kind === 'fileset') {
        const inventory = readTestInventory(sDir, session.round);
        if (inventory) {
          const autoCriteria = input.scores.filter((s) => criteriaById.get(s.criterion_id)?.verification === 'auto');
          checkTestNotGreen(inventory, autoCriteria, rubric.policy.pass_score);

          // R2: skip_delta > 0 かつ 今回どれかの基準のスコアが前周より上がっている → E_TEST_REGRESSION
          if (previousEvaluation) {
            const prevInventory = readTestInventory(sDir, previousEvaluation.round);
            if (prevInventory) {
              const skipDelta = inventory.counts.skipped - prevInventory.counts.skipped;
              if (skipDelta > 0) {
                const raisedCriteria = perCriterion
                  .filter((c) => c.previous_score !== null && c.score > c.previous_score)
                  .map((c) => c.criterion_id);
                if (raisedCriteria.length > 0) {
                  fail('E_TEST_REGRESSION', 'skipped test count increased while scores were raised', {
                    prev: prevInventory.counts,
                    now: inventory.counts,
                    raised_criteria: raisedCriteria,
                  });
                }
              }
            }
          }
        }
      }

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

      const { verdict, verdict_reason: verdictReason } = decideVerdict({
        minScoreValue,
        weightedMeanValue,
        policy: rubric.policy,
        session,
        roundsWithoutImprovement,
      });

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

      let isOrphan = false;
      if (session.upstream && !sessionExists(dataDir, session.upstream.session_id)) {
        isOrphan = true;
      }

      const scoredRound = session.round;
      let effectiveVerdict = verdict;
      let effectiveVerdictReason = verdictReason;
      let escalationData = null;
      const warnings = [];

      if (verdict === 'FINAL' || verdict === 'FINAL_WITH_RELAXATION') {
        if (isOrphan) {
          effectiveVerdict = 'PASS';
          effectiveVerdictReason = 'upstream_missing';
          session.state = 'ESCALATED';
          escalationData = { reason: 'upstream_missing' };
        } else if (chainBudgetExhausted) {
          effectiveVerdict = 'PASS';
          session.state = 'FINAL';
          warnings.push('chain_budget_exceeded');
        } else {
          session.state = verdict;
        }
      } else {
        if (chainBudgetExhausted) {
          if (chainObj && (chainObj.granted_extra_rounds > 0 || chainRoundsCount > chainLimit)) {
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
      const record = {
        round: scoredRound,
        submission_id: input.submission_id,
        submitted_at: new Date().toISOString(),
        artifact_digest: input.artifact_digest,
        weighted_mean: weightedMeanValue,
        min_score: minScoreValue,
        verdict: effectiveVerdict,
        verdict_reason: effectiveVerdictReason,
        submission: { self_verdict_note: input.self_verdict_note ?? null, scores: perCriterion },
      };
      recordAcceptedRound(sDir, scoredRound, record);

      session.counters.rounds_without_improvement = roundsWithoutImprovement;
      session.last_evaluation = {
        round: scoredRound,
        artifact_digest: input.artifact_digest,
        weighted_mean: weightedMeanValue,
        min_score: minScoreValue,
        verdict: effectiveVerdict,
        verdict_reason: effectiveVerdictReason,
        scores: perCriterion,
        must_fix: mustFix,
      };
      session.updated_at = new Date().toISOString();
      writeSession(dataDir, session);

      // 緩和承認待ちや予算超過、孤立セッション等の自動 ESCALATED（§7.1 手順12）
      if (session.state === 'ESCALATED') {
        createEscalation(sDir, escalationData ?? {
          reason: effectiveVerdictReason,
          summaryForHuman: { rounds: scoredRound, weighted_mean_trend: [weightedMeanValue], blocking_criteria: mustFix.map((m) => m.criterion_id) },
        });
      }

      return buildEnvelope({
        ok: true,
        sessionId: session.session_id,
        state: session.state,
        round: session.round,
        rubricVersion: session.rubric_version,
        persistence: persistence.mode,
        warnings,
        verdict: effectiveVerdict,
        verdictReason: effectiveVerdictReason,
        escalation: escalationData ?? undefined,
        evaluation: {
          scored_round: scoredRound,
          artifact_digest: input.artifact_digest,
          weighted_mean: weightedMeanValue,
          min_score: minScoreValue,
          passed_count: passedCount,
          total_count: perCriterion.length,
          ...(improvement !== null ? { improvement } : {}),
          per_criterion: perCriterion.map((c) => ({
            criterion_id: c.criterion_id,
            score: c.score,
            previous_score: c.previous_score,
            passed: c.passed,
            evidence_digests: c.evidence_digests,
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
      if (err.code) {
        recordRejectedSubmission(sDir, session.round, {
          round: session.round,
          submission_id: input.submission_id,
          submitted_at: new Date().toISOString(),
          error_code: err.code,
          error_detail: err.detail ?? null,
        });
        session.counters.rejected_submissions = (session.counters.rejected_submissions ?? 0) + 1;
        session.updated_at = new Date().toISOString();
        writeSession(dataDir, session);
      }
      throw err;
    }
  });
}
