import { pathToFileURL } from 'node:url';
import { resolvePluginRoot } from './src/paths/plugin_root.js';
import { resolvePluginData } from './src/paths/plugin_data.js';
import { createRouter } from './src/mcp/router.js';
import { handleDiscover } from './src/mcp/discover.js';
import { handleToolsList } from './src/mcp/tools_list.js';
import { handleToolsCall } from './src/mcp/tools_call.js';
import { handleInitialize } from './src/mcp/initialize.js';
import { startStdioServer } from './src/mcp/transport_stdio.js';
import { VERSION, NAME } from './src/version.js';

export function parseArgs(argv) {
  const args = { dataDir: undefined, showVersion: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--version' || argv[i] === '-v') {
      args.showVersion = true;
    } else if (argv[i] === '--data-dir') {
      args.dataDir = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

export function buildRouter({ env = process.env, argv1 = process.argv[1], dataDir, cwd = process.cwd() } = {}) {
  const pluginRootResult = resolvePluginRoot(env, argv1);
  const pluginData = dataDir
    ? { dir: dataDir, mode: 'persistent', source: 'cli', warnings: [] }
    : resolvePluginData(env, process.platform, cwd);

  const pluginRoot = pluginRootResult.root;
  const pluginRootSource = pluginRootResult.source;

  const router = createRouter();
  router.register('initialize', (params) => handleInitialize(params));
  router.register('notifications/initialized', () => ({}));
  router.register('ping', () => ({}));
  router.register('server/discover', () => handleDiscover());
  router.register('tools/list', () => handleToolsList());
  router.register('tools/call', (params) => handleToolsCall(params, { pluginRoot, pluginRootSource, persistence: pluginData }));

  return { router, pluginRoot, pluginData };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.showVersion) {
    console.log(`${NAME} ${VERSION}`);
    process.exit(0);
  }
  const { router } = buildRouter({ dataDir: args.dataDir });
  startStdioServer({ onRequest: (request) => router.dispatch(request) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
