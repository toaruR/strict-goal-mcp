import { canonicalStringify, sha256Hex } from '../hash/digest.js';

export const UNKNOWN = 'unknown';
const known = (value) => value === undefined || value === null ? UNKNOWN : value;

// This record contains only observations supplied by the caller; unavailable
// client and timing data are unknown, never zero or estimated savings.
export function collectRoundMetrics({ session, round, context, invalidation, scores, issueEvents, measurements = {} }) {
  return {
    phase: known(session?.loop_mode), round: known(round),
    client: known(measurements.client), model: known(measurements.model),
    reasoning: known(measurements.reasoning),
    snapshot_digest: context ? `sha256:${sha256Hex(canonicalStringify(context))}` : UNKNOWN,
    fresh_count: Array.isArray(scores) ? scores.filter((s) => s.evaluation_basis === 'fresh').length : UNKNOWN,
    reused_count: Array.isArray(scores) ? scores.filter((s) => s.evaluation_basis === 'reused').length : UNKNOWN,
    invalidation: known(invalidation), issue_events: known(issueEvents),
    tokens: { parent: known(measurements.tokens?.parent), child: known(measurements.tokens?.child), total: known(measurements.tokens?.total) },
    timing_ms: {
      llm: known(measurements.timing_ms?.llm), command: known(measurements.timing_ms?.command),
      approval: known(measurements.timing_ms?.approval), idle: known(measurements.timing_ms?.idle),
      wall: known(measurements.timing_ms?.wall),
    },
  };
}

const dimensions = ['artifact', 'upstream', 'scope', 'rubric', 'environment'];
const interventions = ['A', 'B', 'C', 'D'];
const isNumber = (n) => Number.isFinite(n) && n >= 0;

// Inputs are independent audit and measurement results, not fixture estimates.
// Each intervention is compared separately against its matched baseline.
export function evaluateReleaseGate(pairs) {
  const reasons = [];
  if (!Array.isArray(pairs)) return { eligible: false, reasons: ['missing_pairs'] };
  for (const intervention of interventions) {
    const matches = pairs.filter((p) => p?.intervention === intervention);
    if (matches.length !== 1) { reasons.push(`${intervention}:missing_or_duplicate_pair`); continue; }
    const { baseline, candidate } = matches[0];
    if (!baseline || !candidate) { reasons.push(`${intervention}:missing_run`); continue; }
    if (dimensions.some((key) => typeof baseline.snapshot?.[key] !== 'string'
      || baseline.snapshot[key] === '' || baseline.snapshot[key] === UNKNOWN
      || baseline.snapshot[key] !== candidate.snapshot?.[key])) {
      reasons.push(`${intervention}:snapshot_mismatch`);
    }
    for (const [name, run] of [['baseline', baseline], ['candidate', candidate]]) {
      if (run.audit?.independent !== true || !isNumber(run.audit?.escaped_defects)
        || !isNumber(run.audit?.false_positives)) reasons.push(`${intervention}:${name}:missing_audit`);
      const cost = run.cost;
      if (!isNumber(cost?.rounds) || !isNumber(cost?.tokens?.parent) || !isNumber(cost?.tokens?.child)
        || !isNumber(cost?.tokens?.total) || cost.tokens.total !== cost.tokens.parent + cost.tokens.child
        || !isNumber(cost?.timing_ms?.llm) || !isNumber(cost?.timing_ms?.command)
        || !isNumber(cost?.timing_ms?.approval) || !isNumber(cost?.timing_ms?.idle)
        || !isNumber(cost?.timing_ms?.wall)
        || cost.timing_ms.wall < cost.timing_ms.llm + cost.timing_ms.command + cost.timing_ms.approval + cost.timing_ms.idle) {
        reasons.push(`${intervention}:${name}:missing_breakdown`);
      }
    }
    if (isNumber(baseline.audit?.escaped_defects) && isNumber(candidate.audit?.escaped_defects)
      && candidate.audit.escaped_defects > baseline.audit.escaped_defects) reasons.push(`${intervention}:escaped_defects_increased`);
    if (isNumber(baseline.audit?.false_positives) && isNumber(candidate.audit?.false_positives)
      && candidate.audit.false_positives > baseline.audit.false_positives) reasons.push(`${intervention}:false_positives_increased`);
  }
  if (pairs.some((p) => !interventions.includes(p?.intervention))) reasons.push('unknown_intervention');
  return { eligible: reasons.length === 0, reasons };
}
