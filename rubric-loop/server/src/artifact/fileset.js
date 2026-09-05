import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validate } from '../schema/validate.js';
import { sha256Hex } from '../hash/digest.js';

const filesetSchemaPath = fileURLToPath(new URL('../../schemas/fileset.json', import.meta.url));
export const FILESET_SCHEMA = JSON.parse(readFileSync(filesetSchemaPath, 'utf8'));

const MANIFEST_MAX_BYTES = 2 * 1024 * 1024;

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// §19.5.3: files[i] を "<sha256>  <path>\n" に正規化し、path の UTF-8 バイト昇順で連結した文字列の SHA-256。
export function computeManifestDigest(files) {
  const sorted = [...files].sort((a, b) => {
    const bufA = Buffer.from(a.path, 'utf8');
    const bufB = Buffer.from(b.path, 'utf8');
    return Buffer.compare(bufA, bufB);
  });
  const manifestText = sorted.map((f) => `${f.sha256}  ${f.path}\n`).join('');
  return sha256Hex(manifestText);
}

// manifest_command / manifest_output_sha256 はサーバが実行して検証できない（仮定 A3）ので、
// サーバが担保できるのは「申告された files[] から独自に再計算した digest と
// manifest_output_sha256 が一致する」という内部整合性のみ。
export function validateFilesetManifest({ files, manifest_command: manifestCommand, manifest_output_sha256: manifestOutputSha256 }) {
  if (!manifestCommand || !manifestOutputSha256) {
    fail('E_MANIFEST_UNVERIFIABLE', 'manifest_command and manifest_output_sha256 are required when files is used', {
      manifest_command: Boolean(manifestCommand),
      manifest_output_sha256: Boolean(manifestOutputSha256),
    });
  }

  validate(FILESET_SCHEMA, { files, manifest_command: manifestCommand, manifest_output_sha256: manifestOutputSha256 });

  const manifestBytes = Buffer.byteLength(JSON.stringify(files), 'utf8');
  if (manifestBytes > MANIFEST_MAX_BYTES) {
    fail('E_VALIDATION', `manifest exceeds ${MANIFEST_MAX_BYTES} bytes`, { path: '$.files', reason: 'too_large' });
  }

  const expectedDigest = computeManifestDigest(files);
  if (manifestOutputSha256 !== expectedDigest) {
    fail('E_MANIFEST_UNVERIFIABLE', 'manifest_output_sha256 does not match the recomputed manifest digest', {
      expected: expectedDigest,
      actual: manifestOutputSha256,
    });
  }

  return { manifest_digest: expectedDigest };
}
