import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { withIdempotency } from '../idempotency/guard.js';
import { checkStateTransition } from '../fsm/guard.js';
import { readSession, sessionDir, sessionExists } from '../store/session_store.js';
import { persistSession } from '../store/persist.js';
import {
  saveContentArtifact,
  saveFilesetArtifact,
  readArtifactContent,
  recordArtifactForRound,
  computeContentDiff,
} from '../artifact/store.js';
import { validateFilesetManifest, computeFilesetDiff } from '../artifact/fileset.js';
import { assertTestInventoryRequired, checkTestInventoryOnCommit } from '../implement/test_inventory.js';
import { checkAssertMutation, honestLimitWarnings } from '../implement/assert_mutation.js';
import { parsePlanContent } from '../artifact/plan_schema.js';
import { checkPlan } from '../artifact/plan_checks.js';
import { checkDesignRefs } from '../artifact/design_refs.js';
import { checkSupersede } from '../chain/supersede.js';
import { recordCommitForRound } from '../judge/round_store.js';
import {
  CHANGE_NOTE_MIN_LENGTH,
  ARTIFACT_MAX_BYTES,
  DESTRUCTIVE_OVERWRITE_MIN_BYTES,
  DESTRUCTIVE_OVERWRITE_PREVIOUS_MULTIPLE,
} from '../config/defaults.js';
import { buildEnvelope } from '../mcp/envelope.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

export function artifactCommit({ input, persistence }) {
  validate(TOOL_SCHEMAS.artifact_commit.input, input);

  const hasContent = input.content !== undefined;
  const hasFiles = input.files !== undefined;
  if (hasContent === hasFiles) {
    fail('E_VALIDATION', 'exactly one of content or files must be provided', {
      path: hasFiles ? '$.files' : '$.content',
      reason: 'oneOf_content_or_files',
    });
  }
  if (input.change_note.length < CHANGE_NOTE_MIN_LENGTH) {
    fail('E_VALIDATION', `change_note must be at least ${CHANGE_NOTE_MIN_LENGTH} characters`, {
      path: '$.change_note',
      reason: 'too_short',
    });
  }
  if (hasContent && Buffer.byteLength(input.content, 'utf8') > ARTIFACT_MAX_BYTES) {
    fail('E_VALIDATION', `content exceeds ${ARTIFACT_MAX_BYTES} bytes`, {
      path: '$.content',
      reason: 'too_large',
    });
  }

  let manifestDigest = null;
  if (hasFiles) {
    ({ manifest_digest: manifestDigest } = validateFilesetManifest({
      files: input.files,
      manifest_command: input.manifest_command,
      manifest_output_sha256: input.manifest_output_sha256,
    }));
    assertTestInventoryRequired('fileset', input.test_inventory);
  }

  const dataDir = persistence.dir;
  if (!sessionExists(dataDir, input.session_id)) {
    fail('E_SESSION_NOT_FOUND', `session_id not found: ${input.session_id}`, { session_id: input.session_id });
  }

  const sDir = sessionDir(dataDir, input.session_id);

  // 状態チェックは冪等性チェックより後（ハンドラ内）で行う。先に行うと、
  // 1回目の commit で DRAFTING -> SCORING に遷移した後の再送が
  // 「SCORING では呼べない」という誤った E_STATE_VIOLATION になってしまう。
  return withIdempotency(sDir, input.submission_id, () => {
    const session = readSession(dataDir, input.session_id);
    checkSupersede(dataDir, session, 'artifact_commit');
    checkStateTransition(session.state, 'artifact_commit');

    if (input.expected_round !== session.round) {
      fail('E_CONCURRENT', 'expected_round does not match the current round', {
        expected: session.round,
        actual: input.expected_round,
      });
    }

    if (hasFiles && session.artifact_kind !== 'fileset') {
      fail('E_ARTIFACT_KIND_MISMATCH', 'files was provided but session artifact_kind is not "fileset"', {
        artifact_kind: session.artifact_kind,
      });
    }
    if (hasContent && session.artifact_kind === 'fileset') {
      fail('E_ARTIFACT_KIND_MISMATCH', 'content was provided but session artifact_kind is "fileset"', {
        artifact_kind: session.artifact_kind,
      });
    }

    if (session.round >= 2) {
      const requiredCriterion = session.last_evaluation?.must_fix?.[0]?.criterion_id;
      if (requiredCriterion && !(input.addresses ?? []).includes(requiredCriterion)) {
        fail('E_ADDRESS_MISSING', `addresses must include the top must_fix criterion: ${requiredCriterion}`, {
          required: requiredCriterion,
          addresses: input.addresses ?? [],
        });
      }
    }

    const warnings = [];
    const previousArtifact = session.current_artifact;
    const previousDigest = previousArtifact?.digest ?? null;

    let digest;
    let bytes;
    let artifact;
    let currentArtifactState;

    if (hasFiles) {
      const previousFiles = previousArtifact?.files ?? [];
      const previousInventory = previousArtifact?.test_inventory ?? null;
      checkTestInventoryOnCommit(previousInventory, input.test_inventory);
      checkAssertMutation(previousFiles, input.files, input.test_inventory);

      digest = `sha256:${manifestDigest}`;
      const manifest = {
        files: input.files,
        manifest_command: input.manifest_command,
        manifest_output_sha256: input.manifest_output_sha256,
      };
      ({ bytes } = saveFilesetArtifact(sDir, digest, manifest));
      const unchanged = previousDigest === digest;

      artifact = { digest, bytes, unchanged, previous_digest: previousDigest };
      if (previousDigest && !unchanged) {
        artifact.diff = computeFilesetDiff(previousFiles, input.files);
        if (artifact.diff.changed_ratio >= 0.9) warnings.push('near_total_rewrite');
      }
      if (unchanged) warnings.push('artifact_unchanged');
      warnings.push(...honestLimitWarnings());

      currentArtifactState = {
        digest,
        bytes,
        committed_at: null,
        files: input.files,
        test_inventory: input.test_inventory,
      };
    } else {
      if (session.artifact_kind === 'plan') {
        const plan = parsePlanContent(input.content);
        checkPlan(plan);
        if (session.upstream) {
          checkDesignRefs(dataDir, plan, session.upstream);
        }
      }
      ({ digest, bytes } = saveContentArtifact(sDir, session.artifact_kind, input.content));
      const unchanged = previousDigest === digest;

      artifact = { digest, bytes, unchanged, previous_digest: previousDigest };
      if (previousDigest && !unchanged) {
        const previousContent = readArtifactContent(sDir, previousDigest, session.artifact_kind);
        artifact.diff = computeContentDiff(previousContent, input.content);
        if (artifact.diff.changed_ratio >= 0.9) warnings.push('near_total_rewrite');
        if (bytes < previousArtifact.bytes * 0.5) warnings.push('suspicious_shrink');
        if (
          artifact.diff.changed_ratio >= 0.9 &&
          bytes < DESTRUCTIVE_OVERWRITE_MIN_BYTES &&
          previousArtifact.bytes >= DESTRUCTIVE_OVERWRITE_MIN_BYTES * DESTRUCTIVE_OVERWRITE_PREVIOUS_MULTIPLE
        ) {
          warnings.push('destructive_overwrite');
        }
      }
      if (unchanged) warnings.push('artifact_unchanged');

      currentArtifactState = { digest, bytes, committed_at: null };
    }

    recordArtifactForRound(sDir, session.round, digest);

    const committedAt = new Date().toISOString();
    currentArtifactState.committed_at = committedAt;
    recordCommitForRound(sDir, session.round, {
      round: session.round,
      digest,
      bytes,
      previous_digest: previousDigest,
      change_note: input.change_note,
      addresses: input.addresses ?? [],
      diff: artifact.diff ?? null,
      committed_at: committedAt,
      ...(hasFiles ? { files: input.files, test_inventory: input.test_inventory } : {}),
    });

    session.state = 'SCORING';
    session.current_artifact = currentArtifactState;
    session.updated_at = new Date().toISOString();
    persistSession(dataDir, session);

    return buildEnvelope({
      ok: true,
      sessionId: session.session_id,
      state: 'SCORING',
      round: session.round,
      rubricVersion: session.rubric_version,
      persistence: persistence.mode,
      warnings,
      artifact,
    });
  });
}
