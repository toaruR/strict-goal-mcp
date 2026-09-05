import { normalizeForMatch } from '../hash/digest.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// スキーマの minItems:1 に対する防御的な二重チェック。
export function assertEvidenceRequired(criterionId, evidence) {
  if (!evidence || evidence.length === 0) {
    fail('E_EVIDENCE_REQUIRED', 'evidence must not be empty', { criterion_id: criterionId });
  }
}

// verification:"auto" の基準には command 根拠が最低1つ必要。
export function assertEvidenceKindForAuto(criterionId, verification, evidence) {
  if (verification !== 'auto') return;
  const hasCommand = evidence.some((e) => e.kind === 'command');
  if (!hasCommand) {
    fail('E_EVIDENCE_KIND', 'verification:"auto" criteria require at least one command evidence', {
      criterion_id: criterionId,
    });
  }
}

// locator 根拠の excerpt が、登録済み成果物本文に正規化後の部分一致で実在するか。
export function verifyLocatorEvidence(criterionId, evidence, artifactBody) {
  const normalizedBody = normalizeForMatch(artifactBody);
  const normalizedExcerpt = normalizeForMatch(evidence.excerpt);
  if (!normalizedBody.includes(normalizedExcerpt)) {
    fail('E_EVIDENCE_NOT_FOUND', 'locator excerpt not found in artifact body', {
      criterion_id: criterionId,
      excerpt: evidence.excerpt.slice(0, 80),
    });
  }
}

// upstream 根拠は design モードでは使用禁止。それ以外ではピンした上流本文に対して照合する。
export function verifyUpstreamEvidence(criterionId, evidence, loopMode, upstreamBody) {
  if (loopMode === 'design') {
    fail('E_UPSTREAM_NOT_ALLOWED', 'kind:"upstream" evidence is not allowed in loop_mode:"design"', {
      criterion_id: criterionId,
    });
  }
  const normalizedBody = normalizeForMatch(upstreamBody);
  const normalizedExcerpt = normalizeForMatch(evidence.excerpt);
  if (!normalizedBody.includes(normalizedExcerpt)) {
    fail('E_EVIDENCE_NOT_FOUND', 'upstream excerpt not found in pinned upstream body', {
      criterion_id: criterionId,
      excerpt: evidence.excerpt.slice(0, 80),
    });
  }
}

// implement モードの command 根拠は target_digest が現在のマニフェスト digest と一致必須。
export function verifyCommandTargetDigest(evidence, currentArtifactDigest, loopMode, criterionId) {
  if (loopMode !== 'implement') return;
  if (!evidence.target_digest) {
    fail('E_EVIDENCE_TARGET', 'target_digest is required in implement mode', {
      reason: 'target_digest_required_in_implement_mode',
    });
  }
  if (evidence.target_digest !== currentArtifactDigest) {
    fail('E_EVIDENCE_TARGET', 'command evidence target_digest does not match current artifact digest', {
      expected: currentArtifactDigest,
      actual: evidence.target_digest,
      ...(criterionId ? { criterion_id: criterionId } : {}),
    });
  }
}
