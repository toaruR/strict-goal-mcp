import path from 'node:path';
import fs from 'node:fs';
import { readJson } from '../store/atomic.js';
import { readChain } from '../chain/store.js';
import { readSession, sessionDir, sessionExists } from '../store/session_store.js';
import { sha256Hex } from '../hash/digest.js';
import { generateSessionAuditV1 } from './session_v1.js';

const MODE_ORDER = { design: 1, plan: 2, implement: 3 };

export function generateChainAuditV2(dataDir, chainId, options = {}) {
  const chain = readChain(dataDir, chainId);

  // Collect sessions in the chain
  const sessionList = [];
  const members = chain.members ?? chain.sessions ?? [];
  for (const sessionEntry of members) {
    const sId = sessionEntry.session_id;
    if (sessionExists(dataDir, sId)) {
      const sess = readSession(dataDir, sId);
      sessionList.push(sess);
    }
  }

  // Sort sessions by loop_mode order (design -> plan -> implement)
  sessionList.sort((a, b) => (MODE_ORDER[a.loop_mode] ?? 99) - (MODE_ORDER[b.loop_mode] ?? 99));

  let totalRounds = 0;
  const sessionsAudit = [];
  const links = [];

  for (const sess of sessionList) {
    totalRounds += sess.round;
    const sDir = sessionDir(dataDir, sess.session_id);
    const sessionV1 = generateSessionAuditV1(dataDir, sess, options);

    // Read rebases
    const rebases = [];
    const rebasesDir = path.join(sDir, 'rebases');
    if (fs.existsSync(rebasesDir)) {
      const rebaseFiles = fs
        .readdirSync(rebasesDir)
        .filter((name) => name.endsWith('.json'))
        .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
      for (const rFile of rebaseFiles) {
        rebases.push(readJson(path.join(rebasesDir, rFile)));
      }
    }

    sessionsAudit.push({
      session_id: sess.session_id,
      loop_mode: sess.loop_mode,
      state: sess.state,
      rounds: sess.round,
      upstream: sess.upstream ?? null,
      rubric_versions: sessionV1.rubric_versions,
      rounds_data: sessionV1.rounds,
      rejected: sessionV1.rejected_submissions,
      escalations: sessionV1.escalations,
      rebases,
      final: sess.last_evaluation?.verdict === 'FINAL' || sess.last_evaluation?.verdict === 'FINAL_WITH_RELAXATION'
        ? sess.last_evaluation
        : null,
    });

    if (sess.upstream) {
      links.push({
        from: sess.upstream.session_id,
        to: sess.session_id,
        upstream_digest: sess.upstream.artifact_digest,
        pinned_at: sess.upstream.pinned_at,
        verified: true,
        rebased_from: rebases.length > 0 ? rebases[rebases.length - 1].from_digest : null,
      });
    }
  }

  const chainMaxRounds = chain.policy?.chain_max_rounds ?? 28;
  const consumptionRate = totalRounds / chainMaxRounds;

  const chainDigestPayload = sessionsAudit.map((s) => `${s.session_id}:${s.state}:${s.rounds}`).join('|');
  const chainDigest = `sha256:${sha256Hex(chainDigestPayload)}`;

  return {
    $schema: 'https://agent-plugins.org/x/rubric-loop/v1/audit-chain.json',
    schema: 'https://agent-plugins.org/x/rubric-loop/v1/audit-chain.json',
    audit_version: 2,
    version: 2,
    chain_id: chainId,
    exported_at: new Date().toISOString(),
    policy: {
      chain_max_rounds: chainMaxRounds,
      total_rounds: totalRounds,
      consumption_rate: consumptionRate,
      ...(chain.policy ?? {}),
    },
    sessions: sessionsAudit,
    links,
    kickbacks: chain.kickbacks ?? [],
    integrity: {
      hash_algorithm: 'sha256',
      normalization: 'UTF-8 NFC / CRLF->LF / trim',
      chain_digest: chainDigest,
    },
  };
}
