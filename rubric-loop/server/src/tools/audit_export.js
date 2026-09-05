import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { readSession, sessionDir, sessionExists } from '../store/session_store.js';
import { writeAtomic } from '../store/atomic.js';
import { buildSessionAudit } from '../audit/session_v1.js';
import { buildChainAudit } from '../audit/chain_v2.js';
import { buildEnvelope } from '../mcp/envelope.js';
import { AUDIT_DEFAULTS } from '../config/defaults.js';

const CHAIN_AUDIT_SCHEMA = 'https://agent-plugins.org/x/rubric-loop/v1/audit-chain.json';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

function exportsDir(sDir) {
  return path.join(sDir, 'exports');
}

// exports/audit-<ISO8601 basic UTC>.json（例: audit-20260904T110244Z.json）。
function exportFileName() {
  const basic = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `audit-${basic}.json`;
}

function summarize(audit) {
  const relaxations = audit.rubric_versions.filter((v) => v.classification === 'relaxation' || v.classification === 'mixed').length;
  return {
    rounds: audit.session.rounds,
    final_verdict: audit.session.final_verdict ?? audit.session.final_state,
    rubric_versions: audit.rubric_versions.length,
    relaxations,
    rejected_submissions: audit.rejected_submissions.length,
  };
}

function summarizeChain(audit, anchorSessionId) {
  const anchor = audit.sessions.find((s) => s.session_id === anchorSessionId) ?? null;
  let rubricVersions = 0;
  let relaxations = 0;
  let rejectedSubmissions = 0;
  for (const session of audit.sessions) {
    rubricVersions += session.rubric_versions.length;
    relaxations += session.rubric_versions.filter((v) => v.classification === 'relaxation' || v.classification === 'mixed').length;
    rejectedSubmissions += session.rejected.length;
  }
  return {
    rounds: audit.policy.chain_rounds_used,
    final_verdict: anchor?.final?.verdict ?? anchor?.state ?? 'UNKNOWN',
    rubric_versions: rubricVersions,
    relaxations,
    rejected_submissions: rejectedSubmissions,
  };
}

// §6.4.7 / §12 / §19.13。scope:"session" は audit_version:1、scope:"chain" は audit_version:2。
export function auditExport({ input, persistence }) {
  validate(TOOL_SCHEMAS.audit_export.input, input);

  const dataDir = persistence.dir;
  if (!sessionExists(dataDir, input.session_id)) {
    fail('E_SESSION_NOT_FOUND', `session_id not found: ${input.session_id}`, { session_id: input.session_id });
  }

  const scope = input.scope ?? AUDIT_DEFAULTS.scope;
  const includeArtifacts = input.include_artifacts ?? AUDIT_DEFAULTS.include_artifacts;
  const includeRejected = input.include_rejected ?? AUDIT_DEFAULTS.include_rejected;
  const includeDiffs = input.include_diffs ?? AUDIT_DEFAULTS.include_diffs;

  const session = readSession(dataDir, input.session_id);
  const sDir = sessionDir(dataDir, input.session_id);

  const audit =
    scope === 'chain'
      ? buildChainAudit(dataDir, input.session_id, { includeArtifacts, includeRejected, includeDiffs })
      : buildSessionAudit(dataDir, input.session_id, { includeArtifacts, includeRejected, includeDiffs });
  const auditSchema = scope === 'chain' ? CHAIN_AUDIT_SCHEMA : audit.schema;
  const summary = scope === 'chain' ? summarizeChain(audit, input.session_id) : summarize(audit);

  const json = `${JSON.stringify(audit, null, 2)}\n`;
  const bytes = Buffer.byteLength(json, 'utf8');
  const sha256 = crypto.createHash('sha256').update(json, 'utf8').digest('hex');

  const dir = exportsDir(sDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, exportFileName());
  writeAtomic(filePath, json);

  const warnings = [];
  if (persistence.mode === 'ephemeral') warnings.push('ephemeral_export_lost_on_exit');

  return buildEnvelope({
    ok: true,
    sessionId: session.session_id,
    state: session.state,
    round: session.round,
    rubricVersion: session.rubric_version,
    persistence: persistence.mode,
    warnings,
    exportInfo: {
      path: filePath,
      bytes,
      sha256,
      schema: auditSchema,
      summary,
    },
  });
}
