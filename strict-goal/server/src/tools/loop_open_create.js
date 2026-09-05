import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { withIdempotency } from '../idempotency/guard.js';
import { enforceEphemeralPolicy } from '../paths/plugin_data.js';
import { loadPreset } from '../rubric/presets.js';
import { convertInputRubric } from '../rubric/from_input.js';
import { validateRubric } from '../rubric/schema.js';
import { saveRubric } from '../rubric/store.js';
import { writeSession, sessionDir } from '../store/session_store.js';
import { generateSessionId, generateChainId } from '../id/ulid.js';
import { buildEnvelope } from '../mcp/envelope.js';
import { ARTIFACT_KIND_BY_MODE } from '../config/defaults.js';
import { createChain, appendMember } from '../chain/store.js';
import { validatePin } from '../chain/pin.js';
import { assertRoundBudget } from '../chain/budget.js';
import { assertArtifactKind } from '../artifact/kind.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

function freshCounters() {
  return {
    rounds_without_improvement: 0,
    relaxation_count: 0,
    relaxation_approved: false,
    rejected_submissions: 0,
    extra_rounds_granted: 0,
  };
}

// mode:"create" のみを扱う（resume は T022）。
export function loopOpenCreate({ input, pluginRoot, pluginRootSource, persistence }) {
  validate(TOOL_SCHEMAS.loop_open.input, input);

  if (input.mode !== 'create') {
    fail('E_VALIDATION', 'loopOpenCreate only handles mode:"create"', { path: '$.mode', reason: 'must be create' });
  }
  if (input.session_id) {
    fail('E_HANDLE_NOT_ACCEPTED', 'session_id must not be specified on mode:"create"; the server issues the handle');
  }
  if (!input.task) {
    fail('E_VALIDATION', 'task is required for mode:"create"', { path: '$.task', reason: 'required' });
  }

  const loopMode = input.loop_mode ?? 'design';
  if (loopMode === 'design' && input.upstream) {
    fail('E_UPSTREAM_NOT_ALLOWED', 'design mode must not specify upstream');
  }
  if (loopMode !== 'design' && !input.upstream) {
    fail('E_UPSTREAM_REQUIRED', `loop_mode:${loopMode} requires upstream`, { loop_mode: loopMode });
  }

  const ephemeralResult = enforceEphemeralPolicy(persistence.mode, input.allow_ephemeral);

  let dataDir = persistence.dir;
  if (!dataDir) {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'strict-goal-ephemeral-'));
  }

  return withIdempotency(dataDir, input.submission_id, () => {
    const warnings = [...ephemeralResult.warnings];

    let sourceRubric = input.rubric;
    if (sourceRubric && input.rubric_preset) {
      warnings.push('preset_overridden');
    }
    if (!sourceRubric) {
      const presetName = input.rubric_preset ?? loopMode;
      const preset = loadPreset(pluginRoot, presetName);
      if (!preset) {
        fail('E_VALIDATION', 'rubric or rubric_preset is required', {
          path: '$.rubric',
          reason: 'rubric_or_preset_required',
        });
      }
      sourceRubric = preset;
    }

    const persistedRubric = convertInputRubric(sourceRubric, { loopMode });
    validateRubric(persistedRubric);

    let chainId;
    let resolvedUpstream = null;
    if (loopMode === 'design') {
      chainId = generateChainId();
      createChain(dataDir, chainId);
    } else {
      resolvedUpstream = validatePin(dataDir, loopMode, input.upstream);
      chainId = resolvedUpstream.chain_id;
      assertRoundBudget(dataDir, chainId);
    }

    const sessionId = generateSessionId();
    const sDir = sessionDir(dataDir, sessionId);
    const savedRubric = saveRubric(sDir, 1, persistedRubric);

    const now = new Date().toISOString();
    const artifactKind = input.artifact_kind
      ? assertArtifactKind(loopMode, input.artifact_kind)
      : ARTIFACT_KIND_BY_MODE[loopMode];

    appendMember(dataDir, chainId, {
      session_id: sessionId,
      loop_mode: loopMode,
      upstream: resolvedUpstream ? resolvedUpstream.session_id : null,
      joined_at: now,
    });

    const session = {
      session_id: sessionId,
      created_at: now,
      updated_at: now,
      task: input.task,
      artifact_kind: artifactKind,
      loop_mode: loopMode,
      state: 'DRAFTING',
      round: 1,
      rubric_version: 1,
      rubric_digest: savedRubric.rubric_digest,
      policy: savedRubric.policy,
      label: input.label ?? null,
      upstream: resolvedUpstream,
      chain_id: chainId,
      current_artifact: null,
      counters: freshCounters(),
      last_evaluation: null,
      server: {
        plugin_root: pluginRoot,
        plugin_root_source: pluginRootSource,
        data_dir: dataDir,
        data_dir_source: persistence.source,
        persistence: persistence.mode,
      },
    };

    writeSession(dataDir, session);

    return buildEnvelope({
      ok: true,
      sessionId,
      state: 'DRAFTING',
      round: 1,
      rubricVersion: 1,
      persistence: persistence.mode,
      warnings,
      loopMode,
      chainId,
      upstream: session.upstream,
    });
  });
}
