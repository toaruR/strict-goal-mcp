import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineTransport } from '../src/mcp/transport_stdio.js';
import { handleJsonRpc } from '../src/mcp/transport_http.js';
import { createRouter } from '../src/mcp/router.js';
import { handleDiscover } from '../src/mcp/discover.js';

function buildTestRouter() {
  const router = createRouter();
  router.register('server/discover', () => handleDiscover());
  return router;
}

test('同一のツール呼び出しが stdio と streamable-http で同一の結果 JSON を返す', () => {
  const router = buildTestRouter();
  const onRequest = (req) => router.dispatch(req);
  const request = { jsonrpc: '2.0', id: 7, method: 'server/discover', params: {} };

  const stdioTransport = createLineTransport({ onRequest });
  const stdioResponse = JSON.parse(stdioTransport.handleLine(JSON.stringify(request)));
  const httpResponse = handleJsonRpc(request, onRequest);

  assert.deepEqual(stdioResponse, httpResponse);
});
