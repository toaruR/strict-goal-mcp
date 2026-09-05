import { readSession, sessionExists } from '../store/session_store.js';

// plan の直前段は design、implement の直前段は plan（§19.2.1）。
const EXPECTED_UPSTREAM_MODE = Object.freeze({ plan: 'design', implement: 'plan' });
const FINAL_STATES = new Set(['FINAL', 'FINAL_WITH_RELAXATION']);

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// §19.2.1 の4検査を順に行い、通れば解決済みの upstream ピン情報を返す。
export function validatePin(dataDir, loopMode, upstream) {
  const { session_id: upstreamSessionId, artifact_digest: artifactDigest } = upstream;

  if (!sessionExists(dataDir, upstreamSessionId)) {
    fail('E_UPSTREAM_NOT_FOUND', `upstream session not found: ${upstreamSessionId}`, {
      session_id: upstreamSessionId,
    });
  }

  const upstreamSession = readSession(dataDir, upstreamSessionId);

  if (!FINAL_STATES.has(upstreamSession.state)) {
    fail('E_UPSTREAM_NOT_FINAL', 'upstream session is not FINAL', { upstream_state: upstreamSession.state });
  }

  const expectedMode = EXPECTED_UPSTREAM_MODE[loopMode];
  if (upstreamSession.loop_mode !== expectedMode) {
    fail('E_UPSTREAM_MODE_MISMATCH', 'upstream loop_mode does not match the expected predecessor', {
      expected: expectedMode,
      actual: upstreamSession.loop_mode,
    });
  }

  const currentDigest = upstreamSession.current_artifact?.digest ?? null;
  if (currentDigest !== artifactDigest) {
    fail('E_UPSTREAM_DIGEST_MISMATCH', 'artifact_digest does not match the upstream final artifact', {
      expected: currentDigest,
      actual: artifactDigest,
    });
  }

  return {
    session_id: upstreamSessionId,
    mode: upstreamSession.loop_mode,
    loop_mode: upstreamSession.loop_mode,
    artifact_digest: artifactDigest,
    verdict: upstreamSession.state,
    chain_id: upstreamSession.chain_id,
    pinned_at: new Date().toISOString(),
    drift: false,
  };
}
