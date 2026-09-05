import { validate } from '../schema/validate.js';
import { TOOL_SCHEMAS } from '../schema/tools_schema.js';
import { withIdempotency } from '../idempotency/guard.js';
import { checkStateTransition } from '../fsm/guard.js';
import { readSession, writeSession, sessionDir, sessionExists } from '../store/session_store.js';
import {
  saveContentArtifact,
  saveFilesetArtifact,
  readFilesetArtifact,
  readArtifactContent,
  recordArtifactForRound,
  computeContentDiff,
} from '../artifact/store.js';
import { checkSupersede } from '../chain/supersede.js';
import { CHANGE_NOTE_MIN_LENGTH, ARTIFACT_MAX_BYTES } from '../config/defaults.js';
import { buildEnvelope } from '../mcp/envelope.js';
import { parsePlanContent } from '../artifact/plan_schema.js';
import { checkPlan } from '../artifact/plan_checks.js';
import { checkDesignRefs } from '../artifact/design_refs.js';
import {
  assertTestInventoryRequired,
  checkTestInventoryOnCommit,
  saveTestInventory,
  readTestInventory,
} from '../implement/test_inventory.js';
import { validateFilesetManifest } from '../artifact/fileset.js';
import { checkAssertMutation, honestLimitWarnings } from '../implement/assert_mutation.js';
import { recordRejectedSubmission } from '../judge/round_store.js';

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

  const dataDir = persistence.dir;
  if (!sessionExists(dataDir, input.session_id)) {
    fail('E_SESSION_NOT_FOUND', `session_id not found: ${input.session_id}`, { session_id: input.session_id });
  }

  const sDir = sessionDir(dataDir, input.session_id);

  return withIdempotency(sDir, input.submission_id, () => {
    const session = readSession(dataDir, input.session_id);
    let planChecks;
    const warnings = [];

    checkSupersede(dataDir, session, 'artifact_commit');
    checkStateTransition(session.state, 'artifact_commit');

    if (input.expected_round !== session.round) {
      fail('E_CONCURRENT', 'expected_round does not match the current round', {
        server_round: session.round,
        expected: session.round,
        actual: input.expected_round,
      });
    }

    try {

      if (session.round >= 2) {
        const requiredCriterion = session.last_evaluation?.must_fix?.[0]?.criterion_id;
        if (requiredCriterion && !(input.addresses ?? []).includes(requiredCriterion)) {
          fail('E_ADDRESS_MISSING', `addresses must include the top must_fix criterion: ${requiredCriterion}`, {
            required: requiredCriterion,
            addresses: input.addresses ?? [],
          });
        }
      }

      let digest;
      let bytes;

      if (session.artifact_kind === 'plan') {
        if (!hasContent) {
          fail('E_ARTIFACT_KIND_MISMATCH', 'content is required for plan artifact_kind', {
            artifact_kind: session.artifact_kind,
          });
        }
        const plan = parsePlanContent(input.content);
        checkPlan(plan);
        if (session.upstream) {
          checkDesignRefs(dataDir, plan, session.upstream);
        }
        const designRefsCount = plan.tasks.reduce((sum, t) => sum + (t.design_refs?.length || 0), 0);
        planChecks = {
          tasks: plan.tasks.length,
          toposort: 'ok',
          design_refs_verified: designRefsCount,
        };
        const saved = saveContentArtifact(sDir, session.artifact_kind, input.content);
        digest = saved.digest;
        bytes = saved.bytes;
      } else if (session.artifact_kind === 'fileset') {
        if (!hasFiles) {
          fail('E_ARTIFACT_KIND_MISMATCH', 'files is required for fileset artifact_kind', {
            artifact_kind: session.artifact_kind,
          });
        }
        assertTestInventoryRequired(session.artifact_kind, input.test_inventory);
        validateFilesetManifest({
          files: input.files,
          manifest_command: input.manifest_command,
          manifest_output_sha256: input.manifest_output_sha256,
        });

        if (session.round >= 2 || session.current_artifact) {
          const prevFileset = readFilesetArtifact(sDir, session.current_artifact?.digest);
          if (prevFileset) {
            checkAssertMutation(prevFileset.files, input.files, input.test_inventory);
          }
          const prevInventory = readTestInventory(sDir, session.round - 1);
          if (input.test_inventory && prevInventory) {
            if (input.test_inventory.counts.total < prevInventory.counts.total && (input.test_inventory.removed_tests?.length ?? 0) > 0) {
              warnings.push('test_count_decreased');
            }
          }
          checkTestInventoryOnCommit(prevInventory, input.test_inventory);
        }

        saveTestInventory(sDir, session.round, input.test_inventory);
        const saved = saveFilesetArtifact(sDir, input.files, input.manifest_command, input.manifest_output_sha256);
        digest = saved.digest;
        bytes = saved.bytes;

        for (const w of honestLimitWarnings()) {
          warnings.push(w);
        }
      } else {
        if (!hasContent) {
          fail('E_ARTIFACT_KIND_MISMATCH', 'content is required for text/markdown artifact_kind', {
            artifact_kind: session.artifact_kind,
          });
        }
        const saved = saveContentArtifact(sDir, session.artifact_kind, input.content);
        digest = saved.digest;
        bytes = saved.bytes;
      }

      const previousArtifact = session.current_artifact;
      const previousDigest = previousArtifact?.digest ?? null;
      const unchanged = previousDigest === digest;

      const artifact = { digest, bytes, unchanged, previous_digest: previousDigest };

      if (previousDigest && !unchanged && session.artifact_kind !== 'fileset') {
        const previousContent = readArtifactContent(sDir, previousDigest, session.artifact_kind);
        artifact.diff = computeContentDiff(previousContent, input.content);
        if (artifact.diff.changed_ratio >= 0.9) warnings.push('near_total_rewrite');
        if (bytes < previousArtifact.bytes * 0.5) warnings.push('suspicious_shrink');
      }
      if (unchanged) warnings.push('artifact_unchanged');

      recordArtifactForRound(sDir, session.round, digest);

      session.state = 'SCORING';
      session.current_artifact = { digest, bytes, committed_at: new Date().toISOString() };
      session.updated_at = new Date().toISOString();
      writeSession(dataDir, session);

      return buildEnvelope({
        ok: true,
        accepted: true,
        sessionId: session.session_id,
        state: 'SCORING',
        round: session.round,
        rubricVersion: session.rubric_version,
        persistence: persistence.mode,
        warnings,
        artifact,
        planChecks,
      });
    } catch (err) {
      if (session && sDir) {
        try {
          recordRejectedSubmission(sDir, session.round, {
            round: session.round,
            submission_id: input.submission_id,
            submitted_at: new Date().toISOString(),
            error: { code: err.code ?? 'E_INTERNAL', message: err.message, detail: err.detail },
            submission: input,
          });
          session.counters.rejected_submissions = (session.counters.rejected_submissions ?? 0) + 1;
          session.updated_at = new Date().toISOString();
          writeSession(dataDir, session);
        } catch {
          // ignore secondary errors
        }
      }
      throw err;
    }
  });
}
