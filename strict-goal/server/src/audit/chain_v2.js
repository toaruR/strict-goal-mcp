import path from 'node:path';
import fs from 'node:fs';
import { readJson } from '../store/atomic.js';
import { readSession, sessionDir, sessionExists } from '../store/session_store.js';
import { readChain } from '../chain/store.js';
import { computeChainRounds } from '../chain/budget.js';
import { listEscalations } from '../escalation/token.js';
import { sha256Hex } from '../hash/digest.js';
import { buildRubricVersions, buildRounds, buildRejectedSubmissions } from './session_v1.js';
import { AUDIT_VERSION_CHAIN } from '../config/defaults.js';

const MODE_ORDER = Object.freeze({ design: 1, plan: 2, implement: 3 });

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

function rebasesDir(sDir) {
  return path.join(sDir, 'rebases');
}

function readRebases(sDir) {
  const dir = rebasesDir(sDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => Number.parseInt(name, 10))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b)
    .map((seq) => readJson(path.join(dir, `${seq}.json`)));
}

function buildFinal(session) {
  const evaluation = session.last_evaluation;
  if (!evaluation || (evaluation.verdict !== 'FINAL' && evaluation.verdict !== 'FINAL_WITH_RELAXATION')) return null;
  return {
    verdict: evaluation.verdict,
    verdict_reason: evaluation.verdict_reason ?? null,
    artifact_digest: session.current_artifact?.digest ?? null,
    weighted_mean: evaluation.weighted_mean ?? null,
  };
}

function buildSessionEntry(dataDir, sessionId, options) {
  const session = readSession(dataDir, sessionId);
  const sDir = sessionDir(dataDir, sessionId);
  return {
    session_id: session.session_id,
    loop_mode: session.loop_mode,
    label: session.label,
    task: session.task,
    artifact_kind: session.artifact_kind,
    state: session.state,
    upstream: session.upstream ?? null,
    rubric_versions: buildRubricVersions(sDir, session.rubric_version, options.includeDiffs),
    rounds: buildRounds(sDir, session.artifact_kind, options),
    rejected: options.includeRejected ? buildRejectedSubmissions(sDir) : [],
    escalations: listEscalations(sDir),
    rebases: readRebases(sDir),
    final: buildFinal(session),
  };
}

// 上流の確定 digest と下流のピンが一致していたことを、export 時点の実データで再検証する
// (loop_open 時点の validatePin 通過は「その時点で」正しかっただけで、上流が escalate/rebase
// で後から動いている可能性があるため、ここで改めて突き合わせる)。
function buildLink(dataDir, session) {
  const upstream = session.upstream;
  if (!upstream) return null;
  const upstreamExists = sessionExists(dataDir, upstream.session_id);
  const upstreamCurrentDigest = upstreamExists
    ? readSession(dataDir, upstream.session_id).current_artifact?.digest ?? null
    : null;
  const rebases = readRebases(sessionDir(dataDir, session.session_id));
  return {
    from: upstream.session_id,
    to: session.session_id,
    upstream_digest: upstream.artifact_digest,
    pinned_at: upstream.pinned_at,
    verified: upstreamExists && upstreamCurrentDigest === upstream.artifact_digest,
    rebased_from: rebases.length > 0 ? rebases[rebases.length - 1].from_digest : null,
  };
}

function computeChainDigest(sessionEntries) {
  const sorted = [...sessionEntries].sort((a, b) => (a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0));
  const payload = sorted
    .map((entry) => `${entry.session_id} ${entry.loop_mode} ${entry.final?.artifact_digest ?? 'null'}\n`)
    .join('');
  return `sha256:${sha256Hex(payload)}`;
}

// §19.13.2。session_id が属するチェーンの全メンバーを1つの audit_version:2 JSON にまとめる。
export function buildChainAudit(dataDir, sessionId, options) {
  const anchorSession = readSession(dataDir, sessionId);
  const chainId = anchorSession.chain_id;
  if (!chainId) {
    fail('E_VALIDATION', 'session does not belong to a chain', { session_id: sessionId });
  }
  const chain = readChain(dataDir, chainId);

  // members[] は参加順(=依存順)の追記だが、§19.13.2 は design/plan/implement の並びを
  // 求めているため、同順位内の参加順を保ったまま安定ソートし直す。
  const orderedMembers = [...chain.members].sort(
    (a, b) => (MODE_ORDER[a.loop_mode] ?? 99) - (MODE_ORDER[b.loop_mode] ?? 99),
  );

  const sessions = orderedMembers.map((member) => buildSessionEntry(dataDir, member.session_id, options));
  const links = orderedMembers
    .map((member) => buildLink(dataDir, readSession(dataDir, member.session_id)))
    .filter((link) => link !== null);

  const { chainRounds } = computeChainRounds(dataDir, chain);
  const limit = chain.policy.chain_max_rounds + chain.granted_extra_rounds;

  return {
    audit_version: AUDIT_VERSION_CHAIN,
    chain_id: chainId,
    exported_at: new Date().toISOString(),
    policy: {
      ...chain.policy,
      granted_extra_rounds: chain.granted_extra_rounds,
      chain_rounds_used: chainRounds,
      chain_rounds_consumption_rate: chainRounds / limit,
    },
    sessions,
    links,
    kickbacks: chain.kickbacks,
    integrity: {
      hash_algorithm: 'sha256',
      normalization: 'UTF-8 NFC / CRLF→LF / 末尾空白除去 / 末尾改行1個に正規化',
      chain_digest: computeChainDigest(sessions),
    },
  };
}
