import path from 'node:path';
import fs from 'node:fs';
import { writeAtomic, writeJson, readJson } from '../store/atomic.js';
import { sha256Hex, normalize } from '../hash/digest.js';

// artifact_kind ごとの拡張子（§8.1 の artifacts/sha256-<hex>.<ext>）。
// fileset は本文を持たず manifest.json（files[] のスナップショット）を本文相当として保存する。
const EXT_BY_KIND = Object.freeze({
  markdown: '.md',
  text: '.txt',
  plan: '.json',
  fileset: '.manifest.json',
});

function artifactsDir(sDir) {
  return path.join(sDir, 'artifacts');
}

function indexPath(sDir) {
  return path.join(artifactsDir(sDir), 'index.json');
}

export function computeContentDigest(content) {
  return `sha256:${sha256Hex(content)}`;
}

function artifactPath(sDir, digest, artifactKind) {
  const hex = digest.slice('sha256:'.length);
  const ext = EXT_BY_KIND[artifactKind] ?? '.txt';
  return path.join(artifactsDir(sDir), `sha256-${hex}${ext}`);
}

// 内容アドレス保存。正規化後の内容が同じなら同じファイルを指すので、
// 同一内容を2回 commit しても artifacts/ に1ファイルしか増えない。
export function saveContentArtifact(sDir, artifactKind, content) {
  const digest = computeContentDigest(content);
  const normalized = normalize(content);
  const target = artifactPath(sDir, digest, artifactKind);
  fs.mkdirSync(artifactsDir(sDir), { recursive: true });
  if (!fs.existsSync(target)) {
    writeAtomic(target, normalized);
  }
  return { digest, bytes: Buffer.byteLength(normalized, 'utf8') };
}

export function readArtifactContent(sDir, digest, artifactKind) {
  return fs.readFileSync(artifactPath(sDir, digest, artifactKind), 'utf8');
}

// fileset は本文ではなく manifest（files[] + 再現コマンド）を内容アドレスで保存する。
// digest は §19.5.3 のマニフェスト digest（saveContentArtifact の「文字列の sha256」とは別式）。
export function saveFilesetArtifact(sDir, digest, manifest) {
  const target = artifactPath(sDir, digest, 'fileset');
  const serialized = JSON.stringify(manifest, null, 2);
  fs.mkdirSync(artifactsDir(sDir), { recursive: true });
  if (!fs.existsSync(target)) {
    writeAtomic(target, serialized);
  }
  return { bytes: manifest.files.reduce((sum, f) => sum + f.bytes, 0) };
}

// audit_export(§12.2 rounds[].artifact.path) 用。セッションディレクトリ相対の
// スラッシュ区切りパスを返す（監査 JSON はプラットフォーム非依存であるべきなので）。
export function artifactRelativePath(digest, artifactKind) {
  const hex = digest.slice('sha256:'.length);
  const ext = EXT_BY_KIND[artifactKind] ?? '.txt';
  return `artifacts/sha256-${hex}${ext}`;
}

// 保存済み成果物の絶対パス。検証者は作業ファイルではなくこのコピーを読む
// （コミット後に作業ファイルを編集しても採点対象がずれない＝著者は次周の下書きを続けられる）。
export function artifactStoredPath(sDir, digest, artifactKind) {
  return path.resolve(artifactPath(sDir, digest, artifactKind));
}

export function readArtifactIndex(sDir) {
  const target = indexPath(sDir);
  if (!fs.existsSync(target)) return {};
  return readJson(target);
}

export function recordArtifactForRound(sDir, round, digest) {
  const index = readArtifactIndex(sDir);
  index[round] = digest;
  fs.mkdirSync(artifactsDir(sDir), { recursive: true });
  writeJson(indexPath(sDir), index);
  return index;
}

// 行の多重集合差分による近似 diff。正確な位置合わせ（Myers 法など）は
// 1MB・数万行の本文で O(n*m) が破綻するため、O(n log n) で済むこの近似で足りる
// （用途は near_total_rewrite / suspicious_shrink の検知であり、厳密な行番号は不要）。
export function computeContentDiff(previousContent, currentContent) {
  const beforeLines = normalize(previousContent).split('\n');
  const afterLines = normalize(currentContent).split('\n');

  const remaining = new Map();
  for (const line of beforeLines) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }

  let common = 0;
  for (const line of afterLines) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      common += 1;
      remaining.set(line, count - 1);
    }
  }

  const addedLines = afterLines.length - common;
  const removedLines = beforeLines.length - common;
  const denominator = Math.max(beforeLines.length, afterLines.length, 1);
  const changedRatio = Math.min(1, (addedLines + removedLines) / denominator);

  return { added_lines: addedLines, removed_lines: removedLines, changed_ratio: changedRatio };
}
