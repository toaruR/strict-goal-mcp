import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope, buildErrorEnvelope, TERMINAL_STATES } from '../src/mcp/envelope.js';
import { TOOL_ORDER } from '../src/mcp/tools_list.js';

const SESSION_ID = 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY';

test('成功・失敗を問わず resultType が存在する', () => {
  const ok = buildEnvelope({ ok: true, sessionId: SESSION_ID, state: 'SCORING', round: 3, rubricVersion: 1 });
  const ng = buildErrorEnvelope({ sessionId: SESSION_ID, state: 'SCORING', error: { code: 'E_VALIDATION', message: 'x', detail: {} } });
  assert.equal(ok.resultType, 'complete');
  assert.equal(ng.resultType, 'complete');
});

test('終端状態以外の全応答に next_action が存在する', () => {
  for (const state of ['DRAFTING', 'SCORING', 'AMENDING', 'ESCALATED']) {
    const envelope = buildEnvelope({ ok: true, sessionId: SESSION_ID, state, round: 1, rubricVersion: 1 });
    assert.ok(envelope.next_action, state);
  }
});

test('next_action.tool は7ツールのいずれかである', () => {
  for (const state of ['DRAFTING', 'SCORING', 'AMENDING', 'ESCALATED', ...TERMINAL_STATES]) {
    const envelope = buildEnvelope({ ok: true, sessionId: SESSION_ID, state, round: 1, rubricVersion: 1 });
    assert.ok(TOOL_ORDER.includes(envelope.next_action.tool), state);
  }
});

test('session_id は rl_ 前置の ULID 形式である', () => {
  const envelope = buildEnvelope({ ok: true, sessionId: SESSION_ID, state: 'DRAFTING', round: 1, rubricVersion: 1 });
  assert.match(envelope.session_id, /^rl_[0-9A-HJKMNP-TV-Z]{26}$/);
});

test('warnings は常に配列で、無指定時は空配列', () => {
  const envelope = buildEnvelope({ ok: true, sessionId: SESSION_ID, state: 'DRAFTING', round: 1, rubricVersion: 1 });
  assert.ok(Array.isArray(envelope.warnings));
  assert.equal(envelope.warnings.length, 0);
});

test('終端状態でも next_action は埋まり audit_export を指す', () => {
  for (const state of TERMINAL_STATES) {
    const envelope = buildEnvelope({ ok: true, sessionId: SESSION_ID, state, round: 5, rubricVersion: 1 });
    assert.equal(envelope.next_action.tool, 'audit_export', state);
  }
});
