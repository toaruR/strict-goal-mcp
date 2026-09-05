import { readSession, sessionDir } from '../store/session_store.js';
import { loadRubric } from '../rubric/store.js';
import { loadRubricDiff } from '../rubric/diff.js';
import { readArtifactContent, artifactRelativePath } from '../artifact/store.js';
import { listAcceptedRounds, listRejectedSubmissions, readCommitForRound } from '../judge/round_store.js';
import { listEscalations } from '../escalation/token.js';
import { AUDIT_VERSION_SESSION } from '../config/defaults.js';

const VERIFICATION_RECIPE = Object.freeze({
  artifact_hash_algo: 'sha256',
  normalization: 'UTF-8 NFC / CRLF→LF / 末尾空白除去 / 末尾改行1個に正規化',
  steps: [
    '各 rounds[].artifact.path のファイルを正規化して sha256 を取り、artifact.digest と一致することを確認する',
    "kind:'command' の evidence を再実行し、exit_code と出力の sha256 が記録と一致することを確認する",
    "kind:'locator' の evidence の excerpt が、その周の成果物本文に正規化後に存在することを確認する",
    "rubric_versions[] の classification に 'relaxation' があれば、escalations[] に対応する承認があるか確認する",
    '最終周の per_criterion.score が全て policy.pass_score 以上で、weighted_mean が policy.pass_weighted_mean 以上であることを再計算する',
    'rejected_submissions[] を読み、ごまかしの試行がどの機構で止まったかを確認する',
  ],
});

export function buildRubricVersions(sDir, rubricVersion, includeDiffs) {
  const versions = [];
  for (let v = 1; v <= rubricVersion; v += 1) {
    const rubric = loadRubric(sDir, v);
    const diffRecord = v === 1 ? null : loadRubricDiff(sDir, v);
    const entry = {
      version: v,
      digest: rubric.rubric_digest,
      created_at: rubric.created_at,
      classification: v === 1 ? 'initial' : diffRecord.classification,
      reason: v === 1 ? '初版' : diffRecord.reason,
      criteria: rubric.criteria,
    };
    if (includeDiffs && diffRecord) entry.diff = diffRecord.diff;
    versions.push(entry);
  }
  return versions;
}

function buildArtifactSection(sDir, artifactKind, round, recordDigest, { includeArtifacts, includeDiffs }) {
  const commit = readCommitForRound(sDir, round);
  const digest = commit?.digest ?? recordDigest;
  const artifact = {
    digest,
    bytes: commit?.bytes ?? null,
    previous_digest: commit?.previous_digest ?? null,
    change_note: commit?.change_note ?? null,
    addresses: commit?.addresses ?? [],
    committed_at: commit?.committed_at ?? null,
  };
  if (includeDiffs && commit?.diff) artifact.diff = commit.diff;
  if (includeArtifacts) {
    artifact.content = readArtifactContent(sDir, digest, artifactKind);
  } else {
    artifact.path = artifactRelativePath(digest, artifactKind);
  }
  return artifact;
}

export function buildRounds(sDir, artifactKind, { includeArtifacts, includeDiffs }) {
  return listAcceptedRounds(sDir).map(({ round, record }) => {
    const scores = record.submission.scores.map((score) => ({
      criterion_id: score.criterion_id,
      score: score.score,
      previous_score: score.previous_score,
      passed: score.passed,
      rationale: score.rationale,
      weakness: score.weakness,
      evidence: score.evidence.map((ev, i) => ({ ...ev, evidence_digest: score.evidence_digests[i] })),
    }));
    return {
      round,
      state_at_scoring: 'SCORING',
      artifact: buildArtifactSection(sDir, artifactKind, round, record.artifact_digest, { includeArtifacts, includeDiffs }),
      submission: {
        submitted_at: record.submitted_at,
        self_verdict_note: record.submission.self_verdict_note,
        scores,
      },
      evaluation: {
        weighted_mean: record.weighted_mean,
        min_score: record.min_score,
        passed_count: scores.filter((s) => s.passed).length,
        total_count: scores.length,
        verdict: record.verdict,
        verdict_reason: record.verdict_reason,
        decided_by: 'server',
        decided_at: record.submitted_at,
      },
    };
  });
}

export function buildRejectedSubmissions(sDir) {
  return listRejectedSubmissions(sDir).map((rejected) => ({
    round: rejected.round,
    attempt: rejected.attempt,
    submitted_at: rejected.submitted_at,
    error_code: rejected.error_code,
    detail: rejected.error_detail,
  }));
}

// §12.1 / §12.2。第三者が再検証できる情報だけで1セッション分の監査 JSON(version 1)を組み立てる。
export function buildSessionAudit(dataDir, sessionId, { includeArtifacts, includeRejected, includeDiffs }) {
  const session = readSession(dataDir, sessionId);
  const sDir = sessionDir(dataDir, sessionId);

  const rounds = buildRounds(sDir, session.artifact_kind, { includeArtifacts, includeDiffs });
  const rejectedSubmissions = includeRejected ? buildRejectedSubmissions(sDir) : [];

  return {
    schema: 'https://agent-plugins.org/x/rubric-loop/v1/audit.json',
    audit_version: AUDIT_VERSION_SESSION,
    exported_at: new Date().toISOString(),
    session: {
      session_id: session.session_id,
      task: session.task,
      artifact_kind: session.artifact_kind,
      loop_mode: session.loop_mode,
      chain_id: session.chain_id,
      upstream: session.upstream,
      created_at: session.created_at,
      final_state: session.state,
      final_verdict: session.last_evaluation?.verdict ?? null,
      final_verdict_reason: session.last_evaluation?.verdict_reason ?? null,
      rounds: rounds.length,
      policy: session.policy,
      server: session.server,
    },
    rubric_versions: buildRubricVersions(sDir, session.rubric_version, includeDiffs),
    rounds,
    rejected_submissions: rejectedSubmissions,
    escalations: listEscalations(sDir),
    verification_recipe: VERIFICATION_RECIPE,
  };
}
