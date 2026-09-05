import { pathToFileURL } from 'node:url';
import { resolvePluginRoot } from './src/paths/plugin_root.js';
import { resolvePluginData } from './src/paths/plugin_data.js';
import { createRouter } from './src/mcp/router.js';
import { handleDiscover } from './src/mcp/discover.js';
import { handleToolsList } from './src/mcp/tools_list.js';
import { startStdioServer } from './src/mcp/transport_stdio.js';

function parseArgs(argv) {
  const args = { dataDir: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data-dir') {
      args.dataDir = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

export function buildRouter({ env = process.env, argv1 = process.argv[1], dataDir } = {}) {
  const pluginRoot = resolvePluginRoot(env, argv1);
  const pluginData = dataDir
    ? { dir: dataDir, mode: 'persistent', source: 'cli', warnings: [] }
    : resolvePluginData(env);

  const router = createRouter();
  router.register('server/discover', () => handleDiscover());
  router.register('tools/list', () => handleToolsList());

  return { router, pluginRoot, pluginData };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { router } = buildRouter({ dataDir: args.dataDir });
  startStdioServer({ onRequest: (request) => router.dispatch(request) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
