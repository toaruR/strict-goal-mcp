import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { withIdempotency } from '../idempotency/guard.js';
import { enforceEphemeralPolicy } from '../paths/plugin_data.js';
import { readSession, sessionExists, sessionDir } from '../store/session_store.js';
import { resolveByLabel } from '../store/index_store.js';
import { loadRubric } from '../rubric/store.js';
import { checkSupersede } from '../chain/supersede.js';
import { buildEnvelope } from '../mcp/envelope.js';
import {
  resolveDataDirFromWorkspace,
  resolveSessionDataDir,
  registerSessionDataDir,
  registerChainDataDir,
} from '../store/session_registry.js';

const MAX_CANDIDATES = 10;

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

function toCandidate(dataDir, sessionId, label) {
  const session = readSession(dataDir, sessionId);
  return {
    session_id: sessionId,
    label: label ?? session.label,
    state: session.state,
    round: session.round,
    updated_at: session.updated_at,
  };
}

function resolveSessionId(dataDir, { sessionId, label }) {
  if (sessionId) {
    if (!sessionExists(dataDir, sessionId)) {
      fail('E_SESSION_NOT_FOUND', `session_id not found: ${sessionId}`, { session_id: sessionId, candidates: [] });
    }
    return sessionId;
  }

  const matches = resolveByLabel(dataDir, label);
  if (matches.length === 0) {
    fail('E_SESSION_NOT_FOUND', `label not found: ${label}`, { label, candidates: [] });
  }
  if (matches.length > 1) {
    fail('E_AMBIGUOUS_LABEL', `label matches multiple sessions: ${label}`, {
      label,
      candidates: matches.slice(0, MAX_CANDIDATES).map((m) => toCandidate(dataDir, m.session_id, label)),
    });
  }
  return matches[0].session_id;
}

// mode:"resume" のみを扱う（create は T021）。
export function loopOpenResume({ input, persistence }) {
  validate(TOOL_SCHEMAS.loop_open.input, input);

  if (input.mode !== 'resume') {
    fail('E_VALIDATION', 'loopOpenResume only handles mode:"resume"', { path: '$.mode', reason: 'must be resume' });
  }
  if (!input.session_id && !input.label) {
    fail('E_VALIDATION', 'mode:"resume" requires session_id or label', {
      path: '$.session_id',
      reason: 'session_id_or_label_required',
    });
  }
  if (input.rubric) {
    fail('E_RUBRIC_ON_RESUME', 'rubric must not be specified on mode:"resume"; use rubric_amend to change it');
  }

  const ephemeralResult = enforceEphemeralPolicy(persistence.mode, input.allow_ephemeral);

  let dataDir = persistence.dir;
  if (input.workspace_dir) {
    dataDir = resolveDataDirFromWorkspace(input.workspace_dir);
  } else if (input.session_id && resolveSessionDataDir(input.session_id)) {
    dataDir = resolveSessionDataDir(input.session_id);
  } else if (!dataDir) {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'strict-goal-ephemeral-'));
  }

  const sessionId = resolveSessionId(dataDir, { sessionId: input.session_id, label: input.label });
  const sDir = sessionDir(dataDir, sessionId);

  return withIdempotency(sDir, input.submission_id, () => {
    const warnings = [...ephemeralResult.warnings];
    const session = readSession(dataDir, sessionId);
    checkSupersede(dataDir, session, 'loop_open');
    const rubric = loadRubric(sDir, session.rubric_version);
    const mustFix = session.last_evaluation?.must_fix ?? [];

    registerSessionDataDir(sessionId, dataDir);
    if (session.chain_id) {
      registerChainDataDir(session.chain_id, dataDir);
    }

    return buildEnvelope({
      ok: true,
      sessionId,
      state: session.state,
      round: session.round,
      rubricVersion: session.rubric_version,
      persistence: input.workspace_dir ? 'persistent' : persistence.mode,
      warnings,
      loopMode: session.loop_mode,
      chainId: session.chain_id,
      upstream: session.upstream,
      resumed: true,
      label: session.label ?? undefined,
      task: session.task,
      rubric,
      mustFix,
    });
  });
}
