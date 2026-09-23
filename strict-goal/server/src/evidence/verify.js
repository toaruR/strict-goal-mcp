import fs from 'node:fs';
import path from 'node:path';
import { normalizeForMatch, matchesExcerpt } from '../hash/digest.js';
import { workspaceRootFromDataDir } from '../paths/workspace_root.js';

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
// numeric_roundtrip 等「数式が本文に存在しない」非該当免除は、grep等で不在を確認した
// command 根拠（exit_code:0）を提出すれば本チェックを満たす。専用の kind は用意しない。
export function assertEvidenceKindForAuto(criterionId, verification, evidence) {
  if (verification !== 'auto') return;
  const hasCommand = evidence.some((e) => e.kind === 'command');
  if (!hasCommand) {
    fail('E_EVIDENCE_KIND', 'verification:"auto" criteria require at least one command evidence', {
      criterion_id: criterionId,
    });
  }
}

// locator 根拠の excerpt が、登録済み成果物本文に実在するか。
// 1. 単純な行内一致に加えて、改行跨ぎや空白の揺れも matchesExcerpt で自動吸収する。
// 2. fileset モードの場合、マニフェスト文字列に一致しなくても、マニフェスト内の個別ファイル本文に
//    一致すれば合格とする（モデルがソースコード行を直接引用できる救済機構）。
export function verifyLocatorEvidence(criterionId, evidence, artifactBody, options = {}) {
  if (matchesExcerpt(artifactBody, evidence.excerpt)) {
    return;
  }

  if (options.dataDir && typeof artifactBody === 'string' && artifactBody.trim().startsWith('{')) {
    try {
      const manifest = JSON.parse(artifactBody);
      if (Array.isArray(manifest.files) && manifest.files.length > 0) {
        const root = workspaceRootFromDataDir(options.dataDir);
        for (const fileEntry of manifest.files) {
          if (!fileEntry.path) continue;
          const fullPath = path.resolve(root, fileEntry.path);
          try {
            if (fs.existsSync(fullPath)) {
              const fileContent = fs.readFileSync(fullPath, 'utf8');
              if (matchesExcerpt(fileContent, evidence.excerpt)) {
                return;
              }
            }
          } catch {
            // 個別ファイルの読み込みエラーはスキップ
          }
        }
      }
    } catch {
      // JSON パース失敗時は通常エラーへ
    }
  }

  fail('E_EVIDENCE_NOT_FOUND', 'locator excerpt not found in artifact body', {
    criterion_id: criterionId,
    excerpt: evidence.excerpt.slice(0, 80),
  });
}

// upstream 根拠は design モードでは使用禁止。それ以外ではピンした上流本文に対して照合する。
export function verifyUpstreamEvidence(criterionId, evidence, loopMode, upstreamBody) {
  if (loopMode === 'design') {
    fail('E_UPSTREAM_NOT_ALLOWED', 'kind:"upstream" evidence is not allowed in loop_mode:"design"', {
      criterion_id: criterionId,
    });
  }
  if (!matchesExcerpt(upstreamBody, evidence.excerpt)) {
    fail('E_EVIDENCE_NOT_FOUND', 'upstream excerpt not found in pinned upstream body', {
      criterion_id: criterionId,
      excerpt: evidence.excerpt.slice(0, 80),
    });
  }
}

// implement モードの command 根拠は target_digest が現在のマニフェスト digest と一致必須。
export function verifyCommandTargetDigest(evidence, currentArtifactDigest, loopMode) {
  if (loopMode !== 'implement') return;
  if (evidence.target_digest !== currentArtifactDigest) {
    fail('E_EVIDENCE_TARGET', 'command evidence target_digest does not match current artifact digest', {
      expected: currentArtifactDigest,
      actual: evidence.target_digest,
    });
  }
}
