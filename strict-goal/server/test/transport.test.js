import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineTransport } from '../src/mcp/transport_stdio.js';
import { handleJsonRpc, startHttpServer } from '../src/mcp/transport_http.js';
import { createRouter } from '../src/mcp/router.js';
import { handleDiscover } from '../src/mcp/discover.js';
import { parseArgs } from '../main.js';

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

test('parseArgs: デフォルト値および --http, --port, --host オプションを解析できる', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.http, false);
  assert.equal(defaults.port, 8971);
  assert.equal(defaults.host, '127.0.0.1');
  assert.equal(defaults.showVersion, false);
  assert.equal(defaults.dataDir, undefined);

  const custom = parseArgs(['--http', '--port', '9099', '--host', '0.0.0.0', '--data-dir', '/tmp/data']);
  assert.equal(custom.http, true);
  assert.equal(custom.port, 9099);
  assert.equal(custom.host, '0.0.0.0');
  assert.equal(custom.dataDir, '/tmp/data');
});

test('startHttpServer: /mcp エンドポイントで JSON-RPC リクエストを処理する', async () => {
  const router = buildTestRouter();
  const testPort = 18971;
  const server = startHttpServer({
    onRequest: (req) => router.dispatch(req),
    port: testPort,
    host: '127.0.0.1',
  });

  try {
    const res = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'server/discover', params: {} }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.jsonrpc, '2.0');
    assert.equal(data.id, 42);
    assert.ok(data.result);

    const notFoundRes = await fetch(`http://127.0.0.1:${testPort}/invalid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(notFoundRes.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('CLI: node main.js --http --port で HTTP サーバが起動し POST /mcp を処理できる', async () => {
  const { spawn } = await import('node:child_process');
  const path = await import('node:path');
  const mainPath = path.resolve(import.meta.dirname, '../main.js');
  const testPort = 18972;

  const child = spawn(process.execPath, [mainPath, '--http', '--port', String(testPort)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server start timeout')), 5000);
      child.stderr.on('data', (data) => {
        if (data.toString().includes('HTTP server listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const res = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'ping', params: {} }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.jsonrpc, '2.0');
    assert.equal(data.id, 99);
  } finally {
    child.kill('SIGTERM');
  }
});


