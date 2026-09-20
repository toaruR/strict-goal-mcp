import http from 'node:http';

export function handleJsonRpc(requestObj, onRequest) {
  const result = onRequest(requestObj);
  return { jsonrpc: '2.0', id: requestObj.id, ...result };
}

export function createHttpHandler({ onRequest }) {
  return function handleRequest(req, res) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
      }
      const response = handleJsonRpc(parsed, onRequest);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  };
}

export function startHttpServer({ onRequest, port = 8971, host = '127.0.0.1', onListening }) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404);
      res.end();
      return;
    }
    createHttpHandler({ onRequest })(req, res);
  });
  server.listen(port, host, onListening);
  return server;
}
