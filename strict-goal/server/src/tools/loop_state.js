import fs from 'node:fs';
import path from 'node:path';
import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { readSession, sessionExists, sessionDir } from '../store/session_store.js';
import { loadRubric } from '../rubric/store.js';
import { readChain } from '../chain/store.js';
import { computeChainRounds } from '../chain/budget.js';
import { checkSupersede } from '../chain/supersede.js';
import { buildEnvelope } from '../mcp/envelope.js';

const DEFAULT_INCLUDE = ['rubric', 'history', 'last_scores', 'must_fix'];

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// rounds/<round>.json（score_submit が周ごとに書く想定。§19.11.1）から履歴を読む。
// 未実装のツールがまだ何も書いていない間は空配列を返す。
function readHistory(sDir) {
  const roundsDir = path.join(sDir, 'rounds');
  if (!fs.existsSync(roundsDir)) return [];
  const roundNumbers = fs
    .readdirSync(roundsDir)
    .map((name) => Number.parseInt(name, 10))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  return roundNumbers.map((round) => {
    const record = JSON.parse(fs.readFileSync(path.join(roundsDir, `${round}.json`), 'utf8'));
    return {
      round: record.round,
      artifact_digest: record.artifact_digest,
      weighted_mean: record.weighted_mean,
      min_score: record.min_score,
      verdict: record.verdict,
    };
  });
}

function buildUpstreamArtifact(dataDir, session, warnings) {
  const upstreamSessionId = session.upstream.session_id;
  if (!sessionExists(dataDir, upstreamSessionId)) {
    warnings.push('upstream_missing');
    return undefined;
  }
  const upstreamSession = readSession(dataDir, upstreamSessionId);
  const currentDigest = upstreamSession.current_artifact?.digest ?? null;
  const pinnedDigest = session.upstream.artifact_digest;
  return {
    session_id: upstreamSessionId,
    loop_mode: upstreamSession.loop_mode,
    state: upstreamSession.state,
    pinned_digest: pinnedDigest,
    current_digest: currentDigest,
    drifted: currentDigest !== pinnedDigest,
  };
}

function buildChainSummary(dataDir, session) {
  const chain = readChain(dataDir, session.chain_id);
  const { chainRounds, perSession } = computeChainRounds(dataDir, chain);
  return {
    chain_id: chain.chain_id,
    links: perSession.map((entry) => ({
      session_id: entry.session_id,
      loop_mode: entry.loop_mode,
      state: readSession(dataDir, entry.session_id).state,
      rounds: entry.round,
    })),
    chain_rounds: chainRounds,
    chain_max_rounds: chain.policy.chain_max_rounds + chain.granted_extra_rounds,
    kickbacks: chain.kickbacks.length,
  };
}

// 読み取り専用。文章の良し悪しは一切判断せず、状態・rubric・履歴・must_fix を再供給するだけ。
// 全9状態で呼べる（§6.4.2）。session.json への書き込みは一切行わない。
export function loopState({ input, persistence }) {
  validate(TOOL_SCHEMAS.loop_state.input, input);

  const include = input.include ?? DEFAULT_INCLUDE;
  const dataDir = persistence.dir;

  if (!sessionExists(dataDir, input.session_id)) {
    fail('E_SESSION_NOT_FOUND', `session_id not found: ${input.session_id}`, { session_id: input.session_id });
  }

  const session = readSession(dataDir, input.session_id);
  checkSupersede(dataDir, session, 'loop_state');
  const sDir = sessionDir(dataDir, input.session_id);
  const warnings = [];
  const extra = {};

  if (include.includes('rubric')) {
    extra.rubric = loadRubric(sDir, session.rubric_version);
  }
  if (include.includes('history')) {
    extra.history = readHistory(sDir);
  }
  if (include.includes('last_scores')) {
    extra.lastScores = session.last_evaluation?.scores ?? [];
  }
  if (include.includes('must_fix')) {
    extra.mustFix = session.last_evaluation?.must_fix ?? [];
  }
  if (include.includes('artifact_head') && session.current_artifact) {
    extra.currentArtifact = session.current_artifact;
  }
  if (include.includes('upstream')) {
    if (!session.upstream) {
      warnings.push('no_upstream');
    } else {
      const upstreamArtifact = buildUpstreamArtifact(dataDir, session, warnings);
      if (upstreamArtifact) extra.upstreamArtifact = upstreamArtifact;
    }
  }
  if (include.includes('chain')) {
    extra.chain = buildChainSummary(dataDir, session);
  }

  return buildEnvelope({
    ok: true,
    sessionId: session.session_id,
    state: session.state,
    round: session.round,
    rubricVersion: session.rubric_version,
    persistence: persistence.mode,
    warnings,
    loopMode: session.loop_mode,
    chainId: session.chain_id,
    task: session.task,
    ...extra,
  });
}
