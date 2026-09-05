import { readSession, sessionExists, writeSession } from '../store/session_store.js';

const FINAL_STATES = new Set(['FINAL', 'FINAL_WITH_RELAXATION']);

// この4ツールは states.js の表でも SUPERSEDED/FROZEN 下で ALWAYS/ESCALATE_ANY 相当のまま
// なので、ここでは状態遷移だけ行い専用エラーは投げない(実際の action 制限は checkStateTransition 側)。
const ALWAYS_ALLOWED_TOOLS = new Set(['loop_open', 'loop_state', 'escalate', 'audit_export']);

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// §19.3.2: 上流の現在地とピン時点を比較し、必要なら session.state を
// SUPERSEDED/FROZEN に落としてから、許可されていないツールなら専用エラーを投げる。
// 比較ロジックはここに一元化し、各ツールの入口からは checkSupersede を1回呼ぶだけにする(T041)。
export function checkSupersede(dataDir, session, toolName) {
  if (!session.upstream || session.state === 'ABORTED') return session;

  if (!sessionExists(dataDir, session.upstream.session_id)) {
    fail('E_UPSTREAM_NOT_FOUND', `upstream session not found: ${session.upstream.session_id}`, {
      session_id: session.upstream.session_id,
    });
  }
  const upstreamSession = readSession(dataDir, session.upstream.session_id);

  let target = null;
  if (!FINAL_STATES.has(upstreamSession.state)) {
    target = {
      state: 'FROZEN',
      code: 'E_FROZEN',
      detail: { upstream_session_id: session.upstream.session_id },
    };
  } else {
    const currentDigest = upstreamSession.current_artifact?.digest ?? null;
    if (currentDigest !== session.upstream.artifact_digest) {
      target = {
        state: 'SUPERSEDED',
        code: 'E_SUPERSEDED',
        detail: { pinned: session.upstream.artifact_digest, current: currentDigest },
      };
    }
  }

  if (!target) return session;

  if (session.state !== target.state) {
    session.state = target.state;
    session.updated_at = new Date().toISOString();
    writeSession(dataDir, session);
  }

  if (ALWAYS_ALLOWED_TOOLS.has(toolName)) return session;

  fail(target.code, `session is ${target.state} relative to its upstream`, target.detail);
  return session;
}
