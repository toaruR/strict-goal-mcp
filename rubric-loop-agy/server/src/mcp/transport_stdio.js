import readline from 'node:readline';

export function createLineTransport({ onRequest }) {
  function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }
    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    }

    // Mcp-Session-Id 相当のプロトコルセッション識別子や initialize ハンドシェイクには一切依存しない。
    // 送られてきても request オブジェクトの余剰フィールドとして無視される。
    const result = onRequest(request);
    if (request.id === undefined) {
      return null; // 通知には応答しない
    }
    return JSON.stringify({ jsonrpc: '2.0', id: request.id, ...result });
  }

  return { handleLine };
}

export function startStdioServer({ onRequest, stdin = process.stdin, stdout = process.stdout }) {
  const transport = createLineTransport({ onRequest });
  const rl = readline.createInterface({ input: stdin, terminal: false });
  rl.on('line', (line) => {
    const response = transport.handleLine(line);
    if (response !== null) {
      stdout.write(`${response}\n`);
    }
  });
  return rl;
}
