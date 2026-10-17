import { V1_POLICY, pinSessionPolicy } from '../policy/session_policy.js';
// Legacy sessions have no header. This adapter is read-only and additive.
export function readSessionVersion(session) {
  if (!session.evaluation_policy) return { ...session, evaluation_policy: { ...V1_POLICY } };
  const policy = session.evaluation_policy;
  if (typeof policy.stage !== 'string') {
    const error = new Error('missing pinned policy stage');
    error.code = 'E_SESSION_POLICY_INVALID';
    throw error;
  }
  const expected = pinSessionPolicy(policy.stage);
  if (policy.schema_version !== expected.schema_version || policy.policy_version !== expected.policy_version) {
    const error = new Error('inconsistent pinned evaluation policy');
    error.code = 'E_SESSION_POLICY_INVALID';
    throw error;
  }
  return session;
}
