#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeEvidenceDigest } from './src/evidence/model.js';
import { computeWeightedMean, computeMinScore } from './src/judge/engine.js';

export function verifyAudit(auditData) {
  const errors = [];

  const rubricById = new Map();
  for (const r of (auditData.rubric_versions ?? [])) {
    rubricById.set(r.version, r);
  }

  const rounds = auditData.rounds ?? [];
  for (const round of rounds) {
    const rubric = rubricById.get(round.rubric_version ?? round.round) ?? auditData.rubric_versions?.[auditData.rubric_versions.length - 1];
    const criteriaById = new Map((rubric?.criteria ?? []).map((c) => [c.id, c]));

    const submissionScores = round.submission?.scores ?? [];
    if (submissionScores.length > 0 && criteriaById.size > 0) {
      const recomputedMean = computeWeightedMean(submissionScores, criteriaById);
      const recomputedMin = computeMinScore(submissionScores);

      const recordedMean = round.evaluation?.weighted_mean ?? round.weighted_mean;
      const recordedMin = round.evaluation?.min_score ?? round.min_score;

      if (recordedMean !== undefined && Math.abs(recordedMean - recomputedMean) > 1e-4) {
        errors.push(`Round ${round.round}: weighted_mean mismatch (recorded: ${recordedMean}, calculated: ${recomputedMean})`);
      }
      if (recordedMin !== undefined && recordedMin !== recomputedMin) {
        errors.push(`Round ${round.round}: min_score mismatch (recorded: ${recordedMin}, calculated: ${recomputedMin})`);
      }

      for (const s of submissionScores) {
        if (s.evidence) {
          const recordedDigests = s.evidence_digests ?? s.evidence.map((e) => e.evidence_digest).filter(Boolean);
          if (recordedDigests.length > 0) {
            const recomputedDigests = s.evidence.map((e) => computeEvidenceDigest(e));
            if (JSON.stringify(recomputedDigests) !== JSON.stringify(recordedDigests)) {
              errors.push(`Round ${round.round}, criterion ${s.criterion_id}: evidence_digests mismatch`);
            }
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile === currentFile) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node verify_audit.js <audit.json>');
    process.exit(2);
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const auditData = JSON.parse(raw);
    const result = verifyAudit(auditData);
    if (result.ok) {
      console.log('Audit verification successful: all scores and digests match.');
      process.exit(0);
    } else {
      console.error('Audit verification failed:');
      for (const e of result.errors) console.error(`  - ${e}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error reading audit file: ${err.message}`);
    process.exit(1);
  }
}
