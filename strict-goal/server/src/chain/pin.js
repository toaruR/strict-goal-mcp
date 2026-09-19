import { readSession, sessionExists } from '../store/session_store.js';
import { readIndex } from '../store/index_store.js';

// plan の直前段は design、implement の直前段は plan（§19.2.1）。
const EXPECTED_UPSTREAM_MODE = Object.freeze({ plan: 'design', implement: 'plan' });
const FINAL_STATES = new Set(['FINAL', 'FINAL_WITH_RELAXATION']);

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

/**
 * 上流セッションおよびダイジェストを自動解決または検証する。
 * - upstream が指定されていれば、digest 補完と検証を行う。
 * - upstream が省略されている場合、index.json を走査して直近の FINAL な直前セッションを自動解決する。
 */
export function resolveUpstreamPin(dataDir, loopMode, upstream) {
  const expectedMode = EXPECTED_UPSTREAM_MODE[loopMode];

  let candidateSessionId = upstream?.session_id;
  let candidateDigest = upstream?.artifact_digest;

  // 1. upstream が完全に省略されている場合: implement モードのみ index.json から最新の FINAL な plan セッションを自動解決
  if (!candidateSessionId) {
    if (loopMode !== 'implement') {
      fail('E_UPSTREAM_REQUIRED', `upstream is required when loop_mode is "${loopMode}"`, {
        loop_mode: loopMode,
      });
    }
    const index = readIndex(dataDir);
    const sessionIds = Object.keys(index.sessions ?? {});

    const candidates = [];
    for (const sid of sessionIds) {
      if (!sessionExists(dataDir, sid)) continue;
      try {
        const s = readSession(dataDir, sid);
        if (s.loop_mode === expectedMode && FINAL_STATES.has(s.state) && s.current_artifact?.digest) {
          candidates.push(s);
        }
      } catch {
        // パースエラー等はスキップ
      }
    }

    if (candidates.length === 0) {
      fail('E_UPSTREAM_REQUIRED', `loop_mode:${loopMode} requires an upstream ${expectedMode} session, but none was found in state FINAL`, {
        loop_mode: loopMode,
        expected_mode: expectedMode,
      });
    }

    // updated_at 降順で最新のものを選択
    candidates.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
    const best = candidates[0];
    candidateSessionId = best.session_id;
    candidateDigest = best.current_artifact.digest;
  }

  // 2. session_id はあるが artifact_digest が省略されている場合: セッションから自動補完
  if (candidateSessionId && !candidateDigest) {
    if (sessionExists(dataDir, candidateSessionId)) {
      const s = readSession(dataDir, candidateSessionId);
      candidateDigest = s.current_artifact?.digest;
    }
  }

  return validatePin(dataDir, loopMode, {
    session_id: candidateSessionId,
    artifact_digest: candidateDigest,
  });
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
    artifact_digest: artifactDigest,
    verdict: upstreamSession.state,
    chain_id: upstreamSession.chain_id,
    pinned_at: new Date().toISOString(),
  };
}
