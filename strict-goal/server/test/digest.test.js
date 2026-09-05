import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, sha256Hex } from '../src/hash/digest.js';

test('CRLF 版と LF 版の同一文章が同じダイジェストになる', () => {
  const crlf = 'line1\r\nline2\r\n';
  const lf = 'line1\nline2\n';
  assert.equal(sha256Hex(crlf), sha256Hex(lf));
});

test('行末空白のみが異なる2文章が同じダイジェストになる', () => {
  const a = 'line1  \nline2\t\n';
  const b = 'line1\nline2\n';
  assert.equal(sha256Hex(a), sha256Hex(b));
});

test('末尾改行が0個・1個・3個の同一文章が同じダイジェストになる', () => {
  const zero = 'content';
  const one = 'content\n';
  const three = 'content\n\n\n';
  assert.equal(sha256Hex(zero), sha256Hex(one));
  assert.equal(sha256Hex(one), sha256Hex(three));
});

test('NFD 合成前の文字列と NFC 正規化後の文字列が同じダイジェストになる', () => {
  const nfd = 'が'.normalize('NFD');
  const nfc = 'が'.normalize('NFC');
  assert.equal(sha256Hex(nfd), sha256Hex(nfc));
});

test('sha256Hex("a\\n") が sha256sum コマンドの出力と一致する', () => {
  assert.equal(
    sha256Hex('a\n'),
    '87428fc522803d31065e7bce3cf03fe475096631e5e07bbd7a0fde60c4cf25c7'
  );
});
