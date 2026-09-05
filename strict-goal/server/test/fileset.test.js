import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFilesetManifest, computeManifestDigest } from '../src/artifact/fileset.js';

function fileEntry(overrides = {}) {
  return { path: 'src/a.js', sha256: 'a'.repeat(64), bytes: 10, role: 'source', ...overrides };
}

function validManifest(overrides = {}) {
  const files = overrides.files ?? [fileEntry()];
  const manifestOutputSha256 = overrides.manifest_output_sha256 ?? computeManifestDigest(files);
  return {
    files,
    manifest_command: 'git ls-files -z | xargs -0 sha256sum | sort -k2',
    manifest_output_sha256: manifestOutputSha256,
    ...overrides,
  };
}

// path 全体のバイト長を ASCII のみで固定し、指定バイト数ぴったりの files[] を組み立てる。
function buildFilesOfSize(targetBytes) {
  const files = [];
  const fullPath = 'a'.repeat(900);
  while (Buffer.byteLength(JSON.stringify([...files, fileEntry({ path: fullPath })]), 'utf8') <= targetBytes) {
    files.push(fileEntry({ path: fullPath }));
  }
  files.push(fileEntry({ path: '' }));
  while (Buffer.byteLength(JSON.stringify(files), 'utf8') < targetBytes) {
    const last = files[files.length - 1];
    last.path += 'a';
  }
  assert.equal(Buffer.byteLength(JSON.stringify(files), 'utf8'), targetBytes);
  assert.ok(files[files.length - 1].path.length <= 1024);
  return files;
}

test('manifest の各要素が path/sha256/bytes/role の4キーを持つ', () => {
  for (const key of ['path', 'sha256', 'bytes', 'role']) {
    const entry = fileEntry();
    delete entry[key];
    assert.throws(() => validateFilesetManifest(validManifest({ files: [entry] })), { code: 'E_VALIDATION' }, key);
  }
});

test('manifest_output_sha256 が manifest_command 実行結果の正規化ダイジェストと一致しないとき E_MANIFEST_UNVERIFIABLE になる', () => {
  assert.throws(
    () => validateFilesetManifest(validManifest({ manifest_output_sha256: 'b'.repeat(64) })),
    { code: 'E_MANIFEST_UNVERIFIABLE' },
  );
});

test('manifest_command / manifest_output_sha256 が欠けていると E_MANIFEST_UNVERIFIABLE になる', () => {
  const manifest = validManifest();
  delete manifest.manifest_command;
  assert.throws(() => validateFilesetManifest(manifest), { code: 'E_MANIFEST_UNVERIFIABLE' });
});

test('妥当な manifest は例外を投げず manifest_digest を返す', () => {
  const result = validateFilesetManifest(validManifest());
  assert.equal(result.manifest_digest, computeManifestDigest([fileEntry()]));
});

test('files が5001件のとき E_VALIDATION、5000件は通る', () => {
  const tooMany = Array.from({ length: 5001 }, (_, i) => fileEntry({ path: `src/${i}.js` }));
  assert.throws(() => validateFilesetManifest(validManifest({ files: tooMany })), { code: 'E_VALIDATION' });

  const exactlyMax = Array.from({ length: 5000 }, (_, i) => fileEntry({ path: `src/${i}.js` }));
  const result = validateFilesetManifest(validManifest({ files: exactlyMax }));
  assert.ok(result.manifest_digest);
});

test('path が1025バイトのとき E_VALIDATION、1024バイトは通る', () => {
  const tooLong = [fileEntry({ path: 'a'.repeat(1025) })];
  assert.throws(() => validateFilesetManifest(validManifest({ files: tooLong })), { code: 'E_VALIDATION' });

  const exactlyMax = [fileEntry({ path: 'a'.repeat(1024) })];
  const result = validateFilesetManifest(validManifest({ files: exactlyMax }));
  assert.ok(result.manifest_digest);
});

test('manifest が2097153バイトのとき E_VALIDATION、2097152バイトは通る', () => {
  const tooLarge = buildFilesOfSize(2 * 1024 * 1024 + 1);
  assert.throws(() => validateFilesetManifest(validManifest({ files: tooLarge })), { code: 'E_VALIDATION' });

  const exactlyMax = buildFilesOfSize(2 * 1024 * 1024);
  const result = validateFilesetManifest(validManifest({ files: exactlyMax }));
  assert.ok(result.manifest_digest);
});
