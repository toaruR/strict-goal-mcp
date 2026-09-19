import fs from 'node:fs';
import path from 'node:path';
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
  artifactStoredPath,
} from '../artifact/store.js';
import { validateFilesetManifest, computeFilesetDiff } from '../artifact/fileset.js';
import { assertTestInventoryRequired, checkTestInventoryOnCommit } from '../implement/test_inventory.js';
import { checkAssertMutation, honestLimitWarnings } from '../implement/assert_mutation.js';
import { parsePlanContent } from '../artifact/plan_schema.js';
import { checkPlan } from '../artifact/plan_checks.js';
import { checkDesignRefs } from '../artifact/design_refs.js';
import { checkSupersede } from '../chain/supersede.js';
import { loadRubric } from '../rubric/store.js';
import { recordCommitForRound } from '../judge/round_store.js';
import { recordVisitedFile } from '../store/trial_history.js';
import {
  CHANGE_NOTE_MIN_LENGTH,
  ARTIFACT_MAX_BYTES,
  DESTRUCTIVE_OVERWRITE_MIN_BYTES,
  DESTRUCTIVE_OVERWRITE_PREVIOUS_MULTIPLE,
  APPENDIX_ACCRETION_PATTERN,
  APPENDIX_TAIL_RATIO,
} from '../config/defaults.js';
import { scanHeadings } from '../artifact/heading_scan.js';
import { buildEnvelope } from '../mcp/envelope.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

import { workspaceRootFromDataDir } from '../paths/workspace_root.js';
export { workspaceRootFromDataDir };

// source_path をワークスペース根配下に限定して解決し、本文を読む。
// 成果物全文をモデル出力（content）で往復させずに済ませるための経路（§6.4 source_path）。
export function readSourcePath(dataDir, sourcePath) {
  const root = workspaceRootFromDataDir(dataDir);
  const abs = path.isAbsolute(sourcePath) ? path.resolve(sourcePath) : path.resolve(root, sourcePath);
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    fail('E_VALIDATION', 'source_path must point inside the workspace root', {
      path: '$.source_path',
      reason: 'outside_workspace',
    });
  }
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    fail('E_VALIDATION', `source_path not found: ${sourcePath}`, {
      path: '$.source_path',
      reason: 'source_not_found',
    });
  }
  if (!stat.isFile()) {
    fail('E_VALIDATION', 'source_path must be a regular file', {
      path: '$.source_path',
      reason: 'source_not_file',
    });
  }
  const content = fs.readFileSync(abs, 'utf8');
  if (content.length === 0) {
    fail('E_VALIDATION', 'source_path file is empty', {
      path: '$.source_path',
      reason: 'source_empty',
    });
  }
  return { content, resolved_path: abs, relative_path: rel.split(path.sep).join('/') };
}

export function artifactCommit({ input, persistence }) {
  validate(TOOL_SCHEMAS.artifact_commit.input, input);

  const hasInlineContent = input.content !== undefined;
  const hasSourcePath = input.source_path !== undefined;
  const hasFiles = input.files !== undefined;
  const provided = [hasInlineContent, hasSourcePath, hasFiles].filter(Boolean).length;
  if (provided !== 1) {
    fail('E_VALIDATION', 'exactly one of content, source_path or files must be provided', {
      path: hasFiles ? '$.files' : hasSourcePath ? '$.source_path' : '$.content',
      reason: 'oneOf_content_or_files',
    });
  }
  if (input.change_note.length < CHANGE_NOTE_MIN_LENGTH) {
    fail('E_VALIDATION', `change_note must be at least ${CHANGE_NOTE_MIN_LENGTH} characters`, {
      path: '$.change_note',
      reason: 'too_short',
    });
  }

  const dataDir = persistence.dir;

  // source_path は本文をサーバ側で読み、以降は content と同じ経路で扱う
  let sourceInfo = null;
  let content = input.content;
  if (hasSourcePath) {
    sourceInfo = readSourcePath(dataDir, input.source_path);
    content = sourceInfo.content;
  }
  const hasContent = hasInlineContent || hasSourcePath;

  if (hasContent && Buffer.byteLength(content, 'utf8') > ARTIFACT_MAX_BYTES) {
    fail('E_VALIDATION', `content exceeds ${ARTIFACT_MAX_BYTES} bytes`, {
      path: hasSourcePath ? '$.source_path' : '$.content',
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
    const rubric = loadRubric(sDir, session.rubric_version);

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
        const plan = parsePlanContent(content);
        checkPlan(plan);
        if (session.upstream) {
          checkDesignRefs(dataDir, plan, session.upstream);
        }
      }
      ({ digest, bytes } = saveContentArtifact(sDir, session.artifact_kind, content));
      const unchanged = previousDigest === digest;

      artifact = { digest, bytes, unchanged, previous_digest: previousDigest };
      if (previousDigest && !unchanged) {
        const previousContent = readArtifactContent(sDir, previousDigest, session.artifact_kind);
        artifact.diff = computeContentDiff(previousContent, content);
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
      if (rubric?.policy?.artifact_budget_bytes && bytes > rubric.policy.artifact_budget_bytes) {
        warnings.push('over_budget');
        artifact.budget_bytes = rubric.policy.artifact_budget_bytes;
        artifact.over_budget_by = bytes - rubric.policy.artifact_budget_bytes;
      }
      if (session.artifact_kind === 'markdown' || session.artifact_kind === 'text') {
        const headings = scanHeadings(content, APPENDIX_TAIL_RATIO);
        if (headings.some((h) => h.isTail && APPENDIX_ACCRETION_PATTERN.test(h.raw))) {
          warnings.push('appendix_accretion');
        }
        const terms = rubric?.policy?.scope_guard_terms;
        if (Array.isArray(terms) && terms.length > 0) {
          if (headings.some((h) => terms.some((term) => h.raw.includes(term)))) {
            warnings.push('out_of_scope_section');
          }
        }
      }

      currentArtifactState = { digest, bytes, committed_at: null };
    }

    // Verifiers must inspect the immutable committed snapshot, not a source_path file
    // that the author may change while the session is in SCORING.
    artifact.stored_path = artifactStoredPath(sDir, digest, session.artifact_kind);

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
      ...(sourceInfo ? { source_path: sourceInfo.relative_path } : {}),
    });

    if (hasFiles && Array.isArray(input.files)) {
      for (const f of input.files) {
        if (f.path) recordVisitedFile(dataDir, session.session_id, f.path);
      }
    }

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
      warningHints: buildWarningHints(warnings, artifact),
      rubric,
    });
  });
}

// 警告ごとに「今なにをすべきか」を添える。commit 直後は SCORING で成果物が凍結されているため、
// 警告を見た著者が採点前に本文を直しに戻る（→ E_STATE_VIOLATION → 復元、で数分を失う）のを防ぐ。
const FROZEN_NOTE =
  'The artifact is frozen at this digest until score_submit returns. Do not edit or re-commit now; ' +
  'the verifier reads artifact.stored_path, so you may keep drafting the next round in your working file.';

export function buildWarningHints(warnings, artifact) {
  const hints = {};
  for (const w of warnings) {
    if (w === 'over_budget') {
      hints[w] =
        `bytes ${artifact.bytes} exceed artifact_budget_bytes ${artifact.budget_bytes} by ${artifact.over_budget_by}. ` +
        'This is a warning, not a rejection: score this round as-is and trim in the next round. ' + FROZEN_NOTE;
    } else if (w === 'near_total_rewrite' || w === 'suspicious_shrink' || w === 'destructive_overwrite') {
      hints[w] = 'Check that the committed body is the intended full artifact (not a placeholder or a partial file). ' +
        'If it is correct, proceed to score_submit. ' + FROZEN_NOTE;
    } else if (w === 'artifact_unchanged') {
      hints[w] = 'Identical to the previous round. Score it anyway; anti-gaming checks will reject score increases without new evidence.';
    } else if (w === 'appendix_accretion' || w === 'out_of_scope_section') {
      hints[w] = 'Structural warning for the next revision; do not edit before scoring. ' + FROZEN_NOTE;
    } else {
      hints[w] = FROZEN_NOTE;
    }
  }
  return hints;
}
