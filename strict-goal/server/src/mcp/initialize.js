export function handleInitialize(params = {}) {
  const requestedVersion = params?.protocolVersion ?? '2024-11-05';
  return {
    protocolVersion: requestedVersion,
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
    serverInfo: {
      name: 'strict-goal',
      version: '1.0.0',
    },
  };
}
