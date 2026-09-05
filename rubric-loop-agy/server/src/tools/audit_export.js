import path from 'node:path';
import fs from 'node:fs';
import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { readSession, sessionDir, sessionExists } from '../store/session_store.js';
import { generateSessionAuditV1 } from '../audit/session_v1.js';
import { generateChainAuditV2 } from '../audit/chain_v2.js';
import { writeAtomic } from '../store/atomic.js';
import { sha256Hex } from '../hash/digest.js';
import { buildEnvelope } from '../mcp/envelope.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

export function auditExport({ input, persistence }) {
  validate(TOOL_SCHEMAS.audit_export.input, input);

  const dataDir = persistence.dir;
  if (!sessionExists(dataDir, input.session_id)) {
    fail('E_SESSION_NOT_FOUND', `session_id not found: ${input.session_id}`, { session_id: input.session_id });
  }

  const session = readSession(dataDir, input.session_id);
  const sDir = sessionDir(dataDir, input.session_id);
  const scope = input.scope ?? 'session';

  let auditData;
  if (scope === 'chain') {
    if (!session.chain_id) {
      fail('E_VALIDATION', 'session has no associated chain_id for scope: "chain"', { session_id: input.session_id });
    }
    auditData = generateChainAuditV2(dataDir, session.chain_id, input);
  } else {
    auditData = generateSessionAuditV1(dataDir, session, input);
  }

  const jsonContent = JSON.stringify(auditData, null, 2);
  const jsonBytes = Buffer.byteLength(jsonContent, 'utf8');
  const jsonSha256 = sha256Hex(jsonContent);

  const exportsDir = path.join(sDir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const filename = `audit-${ts}.json`;
  const exportFilePath = path.join(exportsDir, filename);

  writeAtomic(exportFilePath, jsonContent);

  const summary = {
    rounds: session.round,
    final_verdict: session.last_evaluation?.verdict ?? session.state,
    rubric_versions: session.rubric_version,
    relaxations: session.counters?.relaxation_count ?? 0,
    rejected_submissions: auditData.rejected_submissions ? auditData.rejected_submissions.length : (session.counters?.rejected_submissions ?? 0),
  };

  return buildEnvelope({
    ok: true,
    sessionId: session.session_id,
    state: session.state,
    round: session.round,
    rubricVersion: session.rubric_version,
    persistence: persistence.mode,
    warnings: [],
    export: {
      path: exportFilePath,
      bytes: jsonBytes,
      sha256: jsonSha256,
      schema: auditData.schema,
      summary,
    },
  });
}
