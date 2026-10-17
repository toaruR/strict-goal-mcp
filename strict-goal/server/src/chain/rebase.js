import fs from 'node:fs';
import path from 'node:path';
import { readSession, sessionDir, sessionExists } from '../store/session_store.js';
import { readArtifactContent, computeContentDigest } from '../artifact/store.js';
import { computeManifestDigest } from '../artifact/fileset.js';
import { normalizeForMatch } from '../hash/digest.js';
import { writeJson } from '../store/atomic.js';
import { loadRubric } from '../rubric/store.js';
import { MUST_FIX_MAX } from '../config/defaults.js';
import { isCacheReuseEligible } from '../evaluation/cache_key.js';
import { deriveUpstreamChanges } from './upstream_diff.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

function rebasesDir(sDir) {
  return path.join(sDir, 'rebases');
}

function nextRebaseSeq(sDir) {
  const dir = rebasesDir(sDir);
  if (!fs.existsSync(dir)) return 1;
  const nums = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => Number.parseInt(name, 10))
    .filter((n) => Number.isInteger(n));
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

export function dependencyKeys(score) {
  const declaration = score.dependency_declaration;
  if (!declaration) return null;
  if (!Array.isArray(declaration.artifact_paths) || !Array.isArray(declaration.upstream_contract_ids) ||
      !Array.isArray(declaration.scope_ids) || !Array.isArray(declaration.rubric_clause_ids) ||
      !Array.isArray(declaration.evidence_kinds) || !Array.isArray(declaration.verification_env_keys)) {
    return null;
  }
  if (declaration.artifact_paths.length + declaration.upstream_contract_ids.length === 0) return null;
  return new Set([
    ...declaration.artifact_paths.map((key) => `artifact:${key}`),
    ...declaration.upstream_contract_ids.map((key) => `upstream:${key}`),
    ...declaration.scope_ids.map((key) => `scope:${key}`),
    ...declaration.rubric_clause_ids.map((key) => `rubric:${key}`),
    ...declaration.evidence_kinds.map((key) => `evidence:${key}`),
    ...declaration.verification_env_keys.map((key) => `environment:${key}`),
  ]);
}

function graphNeighbours(graph, criterionId) {
  if (!graph || typeof graph !== 'object') return [];
  const value = graph[criterionId];
  return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
}

function pathMatches(pattern, actual) {
  if (typeof pattern !== 'string' || !pattern || pattern.startsWith('/') || pattern.includes('\\') || pattern.split('/').some((part) => !part || part === '.' || part === '..')) return false;
  let expression = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') { expression += '(?:.*/)?'; i += 2; }
        else { expression += '.*'; i += 1; }
      }
      else expression += '[^/]*';
    } else if (ch === '?') expression += '[^/]';
    else expression += ch.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(expression + '$').test(actual);
}

/**
 * Finds the criterion-local invalidation closure.  A malformed declaration or
 * unknown environment is intentionally invalidated; cache reuse must fail
 * closed rather than infer that a dependency was unchanged.
 */
export function calculateInvalidatedCriteria(scores, {
  changedDependencyKeys = [],
  criterionGraph = {},
  environmentKnown = true,
} = {}) {
  const changed = new Set(changedDependencyKeys);
  const globalChange = [...changed].some((key) => /^(scope|rubric|test_selection|verification):/.test(key));
  const invalidated = new Set();
  const knownIds = new Set(scores.map((score) => score.criterion_id));

  for (const score of scores) {
    const keys = dependencyKeys(score);
    const paths = score.dependency_declaration?.artifact_paths ?? [];
    const badPath = paths.some((p) => !pathMatches(p, p.replaceAll('*', 'x').replaceAll('?', 'x')));
    const pathChanged = [...changed].some((key) => key.startsWith('artifact:') && paths.some((p) => pathMatches(p, key.slice('artifact:'.length))));
    if (!keys || badPath || !environmentKnown || globalChange || pathChanged || [...keys].some((key) => changed.has(key))) {
      invalidated.add(score.criterion_id);
    }
  }

  // Graph edges are dependency -> dependent criterion IDs.  Traverse only
  // known criteria so a malformed edge cannot create a phantom evaluation.
  const queue = [...invalidated];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbour of graphNeighbours(criterionGraph, current)) {
      if (knownIds.has(neighbour) && !invalidated.has(neighbour)) {
        invalidated.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return invalidated;
}

function legacyUpstreamInvalidation(scoreEntry, normalizedNewBody) {
  const upstreamEvidence = (scoreEntry.evidence ?? []).filter((e) => e.kind === 'upstream');
  const stillValid = upstreamEvidence.every((e) => normalizedNewBody.includes(normalizeForMatch(e.excerpt)));
  return upstreamEvidence.length > 0 && !stillValid;
}

function changedDependencyKeys(session) {
  const reasons = Array.isArray(session.rebase_change_reasons)
    ? session.rebase_change_reasons
    : Array.isArray(session.last_evaluation?.change_reasons)
      ? session.last_evaluation.change_reasons
      : null;
  if (reasons === null) return null;
  const changed = new Set();
  for (const reason of reasons) {
    if (reason?.condition_status !== 'changed') continue;
    for (const key of reason.affected_dependency_keys ?? []) changed.add(key);
  }
  return changed;
}

// §19.3.3。SUPERSEDED から新しい上流 digest にピンし直し、直前受理提出の kind:"upstream"
// 根拠だけを新しい上流本文に再照合して carry_over/invalidated に分類する。session/rebases への
// 書き込みは呼び出し元(escalate.js)で writeSession するので、ここでは session を書き換えるだけ。
export function performRebase(dataDir, session, sDir, { newDigest }) {
  const upstreamSessionId = session.upstream.session_id;
  if (!sessionExists(dataDir, upstreamSessionId)) {
    fail('E_UPSTREAM_NOT_FOUND', `upstream session not found: ${upstreamSessionId}`, {
      session_id: upstreamSessionId,
    });
  }
  const upstreamSession = readSession(dataDir, upstreamSessionId);
  const upstreamCurrentDigest = upstreamSession.current_artifact?.digest ?? null;
  if (newDigest !== upstreamCurrentDigest) {
    fail('E_UPSTREAM_DIGEST_MISMATCH', 'upstream_digest does not match the upstream current artifact', {
      expected: upstreamCurrentDigest,
      actual: newDigest,
    });
  }

  const upstreamSDir = sessionDir(dataDir, upstreamSessionId);
  const newUpstreamBody = readArtifactContent(upstreamSDir, newDigest, upstreamSession.artifact_kind);
  const normalizedNewBody = normalizeForMatch(newUpstreamBody);

  const previousScores = session.last_evaluation?.scores ?? [];
  const carriedOver = [];
  const invalidated = [];
  let declaredChanges = changedDependencyKeys(session);
  let knownUpstreamKeys = null;
  const v2 = session.evaluation_policy?.schema_version === 2;
  if (v2) {
    declaredChanges = null;
    try {
      const oldBody = readArtifactContent(upstreamSDir, session.upstream.artifact_digest, upstreamSession.artifact_kind);
      const validDigest = (body, digest) => upstreamSession.artifact_kind === 'fileset'
        ? `sha256:${computeManifestDigest(JSON.parse(body).files)}` === digest
        : computeContentDigest(body) === digest;
      if (validDigest(oldBody, session.upstream.artifact_digest) && validDigest(newUpstreamBody, newDigest)) {
        const derived = deriveUpstreamChanges(upstreamSession.artifact_kind, oldBody, newUpstreamBody);
        if (derived !== null) {
          declaredChanges = new Set(derived.changed);
          knownUpstreamKeys = new Set(derived.known);
        }
      }
    } catch { /* Missing or invalid committed bytes mean unknown dependencies. */ }
  }
  const declaredInvalidated = declaredChanges === null ? new Set() : calculateInvalidatedCriteria(previousScores, {
    changedDependencyKeys: declaredChanges,
    criterionGraph: session.criterion_dependency_graph,
    environmentKnown: v2 ? true : session.verification_environment_digest !== 'unknown',
  });
  for (const scoreEntry of previousScores) {
    const declared = dependencyKeys(scoreEntry) !== null;
    const declaration = scoreEntry.dependency_declaration;
    const supportedDependencies = !v2 || (knownUpstreamKeys !== null && (upstreamSession.artifact_kind === 'plan'
      ? declaration?.upstream_contract_ids?.every((key) => knownUpstreamKeys.has(key))
      : upstreamSession.artifact_kind === 'fileset'
        ? declaration?.upstream_contract_ids?.length === 0 && declaration?.artifact_paths?.every((pattern) => [...knownUpstreamKeys].some((key) => pathMatches(pattern, key)))
        : false));
    const dependencyChanged = declared && (declaredChanges === null || declaredInvalidated.has(scoreEntry.criterion_id));
    const locatorPresent = (scoreEntry.evidence ?? []).every((e) => e.kind !== 'upstream' ||
      normalizedNewBody.includes(normalizeForMatch(e.excerpt)));
    const changedKeys = dependencyChanged || (!declared && legacyUpstreamInvalidation(scoreEntry, normalizedNewBody)) ? 1 : 0;
    const environmentKnown = v2 ? Boolean(scoreEntry.context_key) : session.verification_environment_digest !== 'unknown';
    if (v2 && (!declared || !supportedDependencies || declaredChanges === null || !scoreEntry.context_key)) {
      invalidated.push(scoreEntry.criterion_id);
      continue;
    }
    if (!isCacheReuseEligible({ changedKeys, locatorPresent, environmentKnown })) {
      invalidated.push(scoreEntry.criterion_id);
    } else {
      carriedOver.push(scoreEntry.criterion_id);
    }
  }

  const rubric = loadRubric(sDir, session.rubric_version);
  const criteriaById = new Map(rubric.criteria.map((c) => [c.id, c]));
  const scoreByCriterion = new Map(previousScores.map((s) => [s.criterion_id, s]));
  const mustFix = invalidated.slice(0, MUST_FIX_MAX).map((criterionId) => {
    const criterion = criteriaById.get(criterionId);
    const prevScore = scoreByCriterion.get(criterionId);
    return {
      criterion_id: criterionId,
      score: 0,
      gap: rubric.policy.pass_score,
      anchor_9: criterion.anchors['9'],
      verify_hint: criterion.verify_hint,
      weakness: prevScore?.weakness ?? 'upstream evidence invalidated by rebase',
    };
  });

  const fromDigest = session.upstream.artifact_digest;

  if (session.last_evaluation) {
    // invalidated 基準は previous_score を null 扱いにするため、last_evaluation から外す
    // (score_submit.js の previousScoreById 検索は「見つからなければ null」で既にこの意味になる)。
    session.last_evaluation.scores = previousScores.filter((s) => !invalidated.includes(s.criterion_id));
    session.last_evaluation.must_fix = mustFix;
  }

  session.state = 'DRAFTING';
  if (invalidated.length > 0) session.round += 1;
  session.upstream = { ...session.upstream, artifact_digest: newDigest, pinned_at: new Date().toISOString() };
  if (v2) session.verified_reuse = { to_digest: newDigest, criterion_ids: carriedOver, changed_keys: declaredChanges === null ? null : [...declaredChanges] };
  session.updated_at = new Date().toISOString();

  const seq = nextRebaseSeq(sDir);
  fs.mkdirSync(rebasesDir(sDir), { recursive: true });
  const record = {
    seq,
    at: session.updated_at,
    from_digest: fromDigest,
    to_digest: newDigest,
    invalidated,
    carried_over: carriedOver,
  };
  writeJson(path.join(rebasesDir(sDir), `${seq}.json`), record);

  return { carriedOver, invalidated, record };
}
