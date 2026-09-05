import path from 'node:path';
import fs from 'node:fs';
import { readJson } from '../store/atomic.js';
import { sessionDir } from '../store/session_store.js';
import { loadRubric } from '../rubric/store.js';
import { readArtifactContent } from '../artifact/store.js';

export function generateSessionAuditV1(dataDir, session, options = {}) {
  const includeArtifacts = options.include_artifacts ?? false;
  const includeRejected = options.include_rejected ?? true;
  const includeDiffs = options.include_diffs ?? true;

  const sDir = sessionDir(dataDir, session.session_id);

  // Rubric versions
  const rubricVersions = [];
  for (let v = 1; v <= session.rubric_version; v += 1) {
    try {
      const rubric = loadRubric(sDir, v);
      let diffInfo = null;
      if (v > 1) {
        const diffPath = path.join(sDir, 'rubric_diff', `${v}.json`);
        if (fs.existsSync(diffPath)) {
          diffInfo = readJson(diffPath);
        }
      }
      rubricVersions.push({
        version: v,
        digest: rubric.rubric_digest,
        created_at: rubric.created_at ?? session.created_at,
        classification: diffInfo?.classification ?? (v === 1 ? 'initial' : 'unknown'),
        ...(includeDiffs && diffInfo ? { diff: diffInfo.diff } : {}),
        reason: rubric.reason ?? (v === 1 ? '初版' : ''),
        criteria: rubric.criteria,
      });
    } catch {
      // ignore missing older versions if any
    }
  }

  // Accepted rounds
  const rounds = [];
  const roundsDir = path.join(sDir, 'rounds');
  if (fs.existsSync(roundsDir)) {
    const roundFiles = fs
      .readdirSync(roundsDir)
      .filter((name) => /^\d+\.json$/.test(name))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

    for (const file of roundFiles) {
      const rec = readJson(path.join(roundsDir, file));
      const roundEntry = { ...rec };
      if (includeArtifacts && rec.artifact_digest) {
        try {
          roundEntry.artifact_content = readArtifactContent(sDir, rec.artifact_digest, session.artifact_kind);
        } catch {
          // ignore
        }
      }
      rounds.push(roundEntry);
    }
  }

  // Rejected submissions
  const rejectedSubmissions = [];
  if (includeRejected && fs.existsSync(roundsDir)) {
    const rejectedDirs = fs
      .readdirSync(roundsDir)
      .filter((name) => name.endsWith('.rejected'))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

    for (const rDir of rejectedDirs) {
      const roundNum = Number.parseInt(rDir, 10);
      const fullRDir = path.join(roundsDir, rDir);
      const subFiles = fs
        .readdirSync(fullRDir)
        .filter((name) => name.endsWith('.json'))
        .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

      for (const sFile of subFiles) {
        const attempt = Number.parseInt(sFile, 10);
        const data = readJson(path.join(fullRDir, sFile));
        rejectedSubmissions.push({
          round: roundNum,
          attempt,
          ...data,
        });
      }
    }
  }

  // Escalations
  const escalations = [];
  const escDir = path.join(sDir, 'escalations');
  if (fs.existsSync(escDir)) {
    const escFiles = fs
      .readdirSync(escDir)
      .filter((name) => name.endsWith('.json'))
      .sort();
    for (const file of escFiles) {
      escalations.push(readJson(path.join(escDir, file)));
    }
  }

  const latestRubric = rubricVersions.length > 0 ? rubricVersions[rubricVersions.length - 1] : null;

  return {
    schema: 'https://agent-plugins.org/x/rubric-loop/v1/audit.json',
    version: 1,
    exported_at: new Date().toISOString(),
    session: {
      session_id: session.session_id,
      task: session.task,
      loop_mode: session.loop_mode,
      artifact_kind: session.artifact_kind,
      created_at: session.created_at,
      final_state: session.state,
      final_verdict: session.last_evaluation?.verdict ?? null,
      final_verdict_reason: session.last_evaluation?.verdict_reason ?? null,
      rounds: session.round,
      policy: latestRubric?.policy ?? (latestRubric?.criteria ? loadRubric(sDir, session.rubric_version).policy : {}),
      server: {
        persistence: session.persistence ?? 'durable',
      },
    },
    rubric_versions: rubricVersions,
    rounds,
    rejected_submissions: rejectedSubmissions,
    escalations,
    verification_recipe: {
      artifact_hash_algo: 'sha256',
      normalization: 'UTF-8 NFC / CRLF->LF / 末尾空白除去 / 末尾改行1個に正規化',
      steps: [
        '各 rounds[].artifact.digest と成果物本文の sha256 が一致することを確認する',
        'kind:"command" の evidence の exit_code と出力ハッシュを確認する',
        'kind:"locator" の evidence の excerpt が成果物本文に存在することを確認する',
        'rubric_versions[] の classification に relaxation があれば escalations[] の承認を確認する',
        '最終周のスコアが pass 基準を満たすことを再計算する',
        'rejected_submissions[] を確認し、不正な提出が正しく阻止されたことを確認する',
      ],
    },
  };
}
