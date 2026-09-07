import { VERSION, NAME } from '../version.js';

export function handleDiscover() {
  return {
    protocolVersions: ['2026-07-28', '2025-11-25'],
    serverInfo: { name: NAME, version: VERSION },
    capabilities: { tools: {} },
  };
}
