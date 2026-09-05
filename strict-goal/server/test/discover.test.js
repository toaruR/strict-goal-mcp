import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineTransport } from '../src/mcp/transport_stdio.js';
import { createRouter } from '../src/mcp/router.js';
import { handleDiscover } from '../src/mcp/discover.js';

function buildTestRouter() {
  const router = createRouter();
  router.register('server/discover', () => handleDiscover());
  return router;
}

test('initialize を一度も送らずに server/discover を呼んで結果が返る', () => {
  const router = buildTestRouter();
  const transport = createLineTransport({ onRequest: (req) => router.dispatch(req) });
  const line = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} });
  const responseLine = transport.handleLine(line);
  const response = JSON.parse(responseLine);
  assert.equal(response.id, 1);
  assert.ok(response.result);
});

test('protocolVersions が固定順で返る', () => {
  const result = handleDiscover();
  assert.deepEqual(result.protocolVersions, ['2026-07-28', '2025-11-25']);
});

test('Mcp-Session-Id 相当のヘッダやプロトコルセッション識別子を要求せず、送られても無視する', () => {
  const router = buildTestRouter();
  const transport = createLineTransport({ onRequest: (req) => router.dispatch(req) });
  const line = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'server/discover',
    params: {},
    'Mcp-Session-Id': 'should-be-ignored',
  });
  const response = JSON.parse(transport.handleLine(line));
  assert.equal(response.id, 2);
  assert.ok(response.result);
});
