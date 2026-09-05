import fs from 'node:fs';
import path from 'node:path';
import { readSession, sessionDir, sessionExists } from '../store/session_store.js';
import { readArtifactContent } from '../artifact/store.js';
import { normalizeForMatch } from '../hash/digest.js';
import { writeJson } from '../store/atomic.js';
import { loadRubric } from '../rubric/store.js';
import { MUST_FIX_MAX } from '../config/defaults.js';

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
  for (const scoreEntry of previousScores) {
    const upstreamEvidence = (scoreEntry.evidence ?? []).filter((e) => e.kind === 'upstream');
    const stillValid = upstreamEvidence.every((e) => normalizedNewBody.includes(normalizeForMatch(e.excerpt)));
    if (upstreamEvidence.length === 0 || stillValid) {
      carriedOver.push(scoreEntry.criterion_id);
    } else {
      invalidated.push(scoreEntry.criterion_id);
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
