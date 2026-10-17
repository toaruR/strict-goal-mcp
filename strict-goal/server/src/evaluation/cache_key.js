import { digestJson } from '../hash/digest.js';

function fail(message) {
  const error = new Error(message);
  error.code = 'E_CACHE_KEY_INVALID';
  throw error;
}

function requireDigest(name, value) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail(`${name} must be a sha256 digest`);
  }
}

/**
 * Builds the v2 criterion cache identity.  Dependency values are represented as
 * key/value pairs so an artifact digest is only one of several inputs.
 */
export function buildCriterionCacheKey({
  criterionId,
  rubricDigest,
  dependencyValues,
  verificationEnvDigest,
  evidenceSetDigest,
}) {
  if (typeof criterionId !== 'string' || criterionId.length === 0) fail('criterionId is required');
  requireDigest('rubricDigest', rubricDigest);
  requireDigest('verificationEnvDigest', verificationEnvDigest);
  requireDigest('evidenceSetDigest', evidenceSetDigest);
  if (!dependencyValues || typeof dependencyValues !== 'object' || Array.isArray(dependencyValues)) {
    fail('dependencyValues must be an object');
  }

  return `sha256:${digestJson({
    criterion_id: criterionId,
    rubric_digest: rubricDigest,
    dependency_values: Object.fromEntries(
      Object.entries(dependencyValues).sort(([left], [right]) => left.localeCompare(right)),
    ),
    verification_env_digest: verificationEnvDigest,
    evidence_set_digest: evidenceSetDigest,
  })}`;
}

// AC-RR-09: a cache entry can be reused only when every safety condition is
// positively known.  Undefined values intentionally fail closed.
export function isCacheReuseEligible({ changedKeys, locatorPresent, environmentKnown }) {
  return changedKeys === 0 && locatorPresent === true && environmentKnown === true;
}
