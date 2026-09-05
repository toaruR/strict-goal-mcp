export function handleDiscover() {
  return {
    protocolVersions: ['2026-07-28', '2025-11-25'],
    serverInfo: { name: 'rubric-loop', version: '1.0.0' },
    capabilities: { tools: {} },
  };
}
