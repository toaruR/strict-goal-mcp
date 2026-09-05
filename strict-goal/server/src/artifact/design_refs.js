import { readSession, sessionDir } from '../store/session_store.js';
import { readArtifactContent } from './store.js';
import { normalizeForMatch } from '../hash/digest.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// plan の全タスクの design_refs が、ピンした upstream.artifact_digest に対応する
// 本文（＝現在の上流最新版ではなく、ピン止め時点の本文）に正規化後の部分一致で実在するか照合する。
export function checkDesignRefs(dataDir, plan, upstream) {
  const upstreamSession = readSession(dataDir, upstream.session_id);
  const upstreamSDir = sessionDir(dataDir, upstream.session_id);
  const body = readArtifactContent(upstreamSDir, upstream.artifact_digest, upstreamSession.artifact_kind);
  const normalizedBody = normalizeForMatch(body);

  for (const task of plan.tasks) {
    for (const ref of task.design_refs) {
      if (!normalizedBody.includes(normalizeForMatch(ref))) {
        fail('E_PLAN_DESIGN_REF', `design_refs not found in upstream: ${ref}`, { task_id: task.id, ref });
      }
    }
  }

  return true;
}
