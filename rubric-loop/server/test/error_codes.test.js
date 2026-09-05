import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODES, TOOL_ERRORS, RESERVED_JSONRPC_RANGE } from '../src/errors/codes.js';
import { fromException } from '../src/errors/envelope.js';

test('レジストリが公開するエラーコードがちょうど42件で重複が0件', () => {
  const keys = Object.keys(CODES);
  assert.equal(keys.length, 42);
  assert.equal(new Set(keys).size, 42);
});

test('共通6件が含まれる', () => {
  for (const code of ['E_STATE_VIOLATION', 'E_SESSION_NOT_FOUND', 'E_CONCURRENT', 'E_VALIDATION', 'E_NO_PERSISTENCE', 'E_INTERNAL']) {
    assert.ok(code in CODES, code);
  }
});

test('全エラーが JSON-RPC の予約帯を使わず文字列として現れる', () => {
  for (const code of Object.keys(CODES)) {
    assert.equal(typeof code, 'string');
    assert.match(code, /^E_[A-Z0-9_]+$/);
  }
  assert.equal(RESERVED_JSONRPC_RANGE.min, -32099);
  assert.equal(RESERVED_JSONRPC_RANGE.max, -32020);
});

test('想定外の例外は E_INTERNAL に落ち、スタックトレースを含まない', () => {
  const err = new Error('boom\n    at somewhere.js:1:1');
  const envelope = fromException(err);
  assert.equal(envelope.error.code, 'E_INTERNAL');
  assert.ok(!JSON.stringify(envelope).includes('somewhere.js'));
});

test('E_STATE_VIOLATION は detail.expected_tools を持てる', () => {
  assert.ok(CODES.E_STATE_VIOLATION.detailKeys.includes('expected_tools'));
});

// 19.6.7 の総覧表は実装の到達可能性と食い違っていたため、T068-T070 で実装ベースに補正した
// （CLAUDE.md ハマりポイント参照）。件数はここが正であり設計書の数字ではない。
// score_submit の E_EVIDENCE_REQUIRED は schemas/tools.json の scores[].evidence が
// minItems:1 を強制するため公開スキーマ経由では到達不能（T070 で除外、19→17）。
test('ツール別のエラーコード割り当て件数が実装の到達可能性と一致する', () => {
  assert.equal(TOOL_ERRORS.loop_open.length, 13);
  assert.equal(TOOL_ERRORS.loop_state.length, 2);
  assert.equal(TOOL_ERRORS.artifact_commit.length, 13);
  assert.equal(TOOL_ERRORS.score_submit.length, 17);
  assert.equal(TOOL_ERRORS.rubric_amend.length, 8);
  assert.equal(TOOL_ERRORS.escalate.length, 8);
  assert.equal(TOOL_ERRORS.audit_export.length, 2);
});

test('E_VALIDATION は7ツールすべてに割り当てられている', () => {
  for (const tool of Object.keys(TOOL_ERRORS)) {
    assert.ok(TOOL_ERRORS[tool].includes('E_VALIDATION'), tool);
  }
});
